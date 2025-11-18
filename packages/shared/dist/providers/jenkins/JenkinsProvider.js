"use strict";
/**
 * Jenkins CI/CD Provider Plugin
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JenkinsProvider = void 0;
const CIProviderInterface_1 = require("../../core/CIProviderInterface");
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../../utils/logger");
class JenkinsProvider extends CIProviderInterface_1.CIProviderInterface {
    jenkinsUrl;
    username;
    apiToken;
    jobName;
    timeout;
    client;
    constructor(config) {
        super(config);
        this.jenkinsUrl = config.jenkinsUrl;
        this.username = config.username;
        this.apiToken = config.apiToken;
        this.jobName = config.jobName;
        this.timeout = config.timeout || 30000;
        // Create axios instance with authentication
        this.client = axios_1.default.create({
            baseURL: this.jenkinsUrl,
            auth: {
                username: this.username,
                password: this.apiToken
            },
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: this.timeout
        });
    }
    getName() {
        return 'jenkins';
    }
    validateConfig() {
        const errors = [];
        if (!this.jenkinsUrl)
            errors.push('jenkinsUrl is required');
        if (!this.username)
            errors.push('username is required');
        if (!this.apiToken)
            errors.push('apiToken is required');
        if (!this.jobName)
            errors.push('jobName is required');
        if (errors.length > 0) {
            throw new Error(`Jenkins configuration invalid: ${errors.join(', ')}`);
        }
    }
    async triggerBuild(parameters = {}) {
        try {
            logger_1.logger.info(`🔨 Triggering Jenkins build for job: ${this.jobName}`);
            const hasParameters = parameters && Object.keys(parameters).length > 0;
            const endpoint = hasParameters ? 'buildWithParameters' : 'build';
            const url = `/job/${this.jobName}/${endpoint}`;
            await this.client.post(url, null, {
                params: hasParameters ? parameters : undefined
            });
            // Wait for build to be queued
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Get the latest build number
            const response = await this.client.get(`/job/${this.jobName}/api/json`);
            const buildNumber = response.data.lastBuild?.number;
            if (!buildNumber) {
                throw new Error('No build number returned from Jenkins');
            }
            const buildUrl = `${this.jenkinsUrl}/job/${this.jobName}/${buildNumber}`;
            logger_1.logger.info(`✅ Build #${buildNumber} triggered successfully`);
            return {
                buildId: buildNumber.toString(),
                buildNumber: buildNumber,
                buildUrl: buildUrl,
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger_1.logger.error('❌ Jenkins trigger error:', errorMsg);
            throw new Error(`Failed to trigger Jenkins build: ${errorMsg}`);
        }
    }
    async getBuildStatus(buildId) {
        try {
            const response = await this.client.get(`/job/${this.jobName}/${buildId}/api/json`);
            const data = response.data;
            let status = 'pending';
            if (data.building) {
                status = 'running';
            }
            else if (data.result === 'SUCCESS') {
                status = 'success';
            }
            else if (data.result === 'FAILURE') {
                status = 'failure';
            }
            else if (data.result === 'ABORTED') {
                status = 'cancelled';
            }
            return {
                buildId: buildId.toString(),
                buildNumber: data.number,
                status: status,
                result: data.result,
                building: data.building,
                duration: data.duration,
                timestamp: data.timestamp,
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`Failed to get build status for #${buildId}:`, errorMsg);
            throw new Error(`Failed to get build status: ${errorMsg}`);
        }
    }
    async streamLogs(buildId, onLogChunk) {
        let start = 0;
        let isBuilding = true;
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;
        logger_1.logger.info(`Starting log stream for build #${buildId}...`);
        while (isBuilding) {
            try {
                const response = await this.client.get(`/job/${this.jobName}/${buildId}/logText/progressiveText?start=${start}`, { responseType: 'text' });
                const logChunk = response.data;
                const moreData = response.headers['x-more-data'];
                const nextStart = response.headers['x-text-size'];
                if (logChunk) {
                    onLogChunk(logChunk);
                }
                if (nextStart) {
                    start = parseInt(nextStart, 10);
                }
                isBuilding = moreData === 'true';
                consecutiveErrors = 0;
                if (isBuilding) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            catch (error) {
                consecutiveErrors++;
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger_1.logger.error(`Error streaming logs (attempt ${consecutiveErrors}/${maxConsecutiveErrors}):`, errorMsg);
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    throw new Error(`Failed to stream logs after ${maxConsecutiveErrors} attempts`);
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        logger_1.logger.info('Log stream completed.');
    }
    async getCompleteLogs(buildId) {
        try {
            const response = await this.client.get(`/job/${this.jobName}/${buildId}/consoleText`, { responseType: 'text' });
            return response.data;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`Failed to get console output for #${buildId}:`, errorMsg);
            throw new Error(`Failed to get console output: ${errorMsg}`);
        }
    }
    parseWebhookPayload(payload) {
        // Jenkins webhook payload structure
        return {
            buildId: payload.buildNumber?.toString(),
            buildNumber: payload.buildNumber,
            buildUrl: payload.buildUrl,
            jobName: payload.jobName,
            status: this.mapJenkinsStatus(payload.status),
            result: payload.status,
            duration: payload.duration,
            timestamp: payload.timestamp,
        };
    }
    mapJenkinsStatus(jenkinsStatus) {
        const statusMap = {
            'STARTED': 'running',
            'IN_PROGRESS': 'running',
            'SUCCESS': 'success',
            'FAILURE': 'failure',
            'UNSTABLE': 'failure',
            'ABORTED': 'cancelled',
        };
        return statusMap[jenkinsStatus] || 'pending';
    }
    normalizeBuildData(providerData) {
        return {
            provider: this.getName(),
            buildId: providerData.buildNumber?.toString() || '',
            buildNumber: providerData.buildNumber || 0,
            buildUrl: providerData.buildUrl || '',
            status: this.mapJenkinsStatus(providerData.result || providerData.status || ''),
            result: providerData.result || '',
            duration: providerData.duration || null,
            timestamp: providerData.timestamp || Date.now(),
            jobName: providerData.jobName || this.jobName,
        };
    }
}
exports.JenkinsProvider = JenkinsProvider;
//# sourceMappingURL=JenkinsProvider.js.map