"use strict";
/**
 * CircleCI Provider Plugin
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircleCIProvider = void 0;
const CIProviderInterface_1 = require("../../core/CIProviderInterface");
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../../utils/logger");
const crypto = __importStar(require("crypto"));
class CircleCIProvider extends CIProviderInterface_1.CIProviderInterface {
    apiToken;
    projectSlug;
    webhookSecret;
    baseUrl;
    client;
    constructor(config) {
        super(config);
        this.apiToken = config.apiToken;
        this.projectSlug = config.projectSlug;
        this.webhookSecret = config.webhookSecret;
        this.baseUrl = 'https://circleci.com/api/v2';
        this.client = axios_1.default.create({
            baseURL: this.baseUrl,
            headers: {
                'Circle-Token': this.apiToken,
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });
    }
    getName() {
        return 'circleci';
    }
    validateConfig() {
        const errors = [];
        if (!this.apiToken)
            errors.push('apiToken is required');
        if (!this.projectSlug)
            errors.push('projectSlug is required (format: vcs/org/repo)');
        if (errors.length > 0) {
            throw new Error(`CircleCI configuration invalid: ${errors.join(', ')}`);
        }
    }
    async triggerBuild(parameters = {}) {
        try {
            logger_1.logger.info(`🔨 Triggering CircleCI pipeline for: ${this.projectSlug}`);
            const response = await this.client.post(`/project/${this.projectSlug}/pipeline`, {
                parameters: parameters,
                branch: parameters.branch || 'main',
            });
            const pipelineId = response.data.id;
            const pipelineNumber = response.data.number;
            // Wait a bit for workflow to start
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Get workflow ID
            const workflowResponse = await this.client.get(`/pipeline/${pipelineId}/workflow`);
            const workflow = workflowResponse.data.items[0];
            const buildUrl = `https://app.circleci.com/pipelines/${this.projectSlug}/${pipelineNumber}/workflows/${workflow.id}`;
            logger_1.logger.info(`✅ Pipeline #${pipelineNumber} triggered successfully`);
            return {
                buildId: workflow.id,
                buildNumber: pipelineNumber,
                buildUrl: buildUrl,
                pipelineId: pipelineId,
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger_1.logger.error('❌ CircleCI trigger error:', errorMsg);
            throw new Error(`Failed to trigger CircleCI pipeline: ${errorMsg}`);
        }
    }
    async getBuildStatus(buildId) {
        try {
            // buildId is workflow ID
            const response = await this.client.get(`/workflow/${buildId}`);
            const data = response.data;
            return {
                buildId: buildId,
                buildNumber: data.pipeline_number,
                status: this.mapCircleCIStatus(data.status),
                result: data.status,
                duration: this.calculateDuration(data.created_at, data.stopped_at),
                timestamp: new Date(data.created_at).getTime(),
                branch: data.branch,
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`Failed to get workflow status for ${buildId}:`, errorMsg);
            throw new Error(`Failed to get workflow status: ${errorMsg}`);
        }
    }
    async streamLogs(buildId, onLogChunk) {
        // CircleCI doesn't support real-time log streaming via API
        // We need to poll for job logs
        logger_1.logger.info(`Starting log polling for workflow ${buildId}...`);
        try {
            // Get jobs in workflow
            const jobsResponse = await this.client.get(`/workflow/${buildId}/job`);
            const jobs = jobsResponse.data.items;
            for (const job of jobs) {
                const jobNumber = job.job_number;
                // Get job details to find project slug
                const logs = await this.getJobLogs(jobNumber);
                onLogChunk(`\n=== Job: ${job.name} ===\n`);
                onLogChunk(logs);
            }
            logger_1.logger.info('Log polling completed.');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger_1.logger.error('Error polling logs:', errorMsg);
            throw error;
        }
    }
    async getJobLogs(jobNumber) {
        try {
            // Note: CircleCI API v2 doesn't provide direct log access
            // You may need to use v1.1 API or implement alternative approach
            const response = await axios_1.default.get(`https://circleci.com/api/v1.1/project/${this.projectSlug}/${jobNumber}/output/0/0`, {
                headers: {
                    'Circle-Token': this.apiToken,
                },
            });
            // Parse log output
            return response.data.map((step) => step.actions.map((action) => action.output_url ? `${action.name}: See ${action.output_url}` : '').join('\n')).join('\n');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger_1.logger.warn(`Could not fetch logs for job ${jobNumber}:`, errorMsg);
            return `[Logs not available for job ${jobNumber}]`;
        }
    }
    async getCompleteLogs(buildId) {
        let allLogs = '';
        await this.streamLogs(buildId, (chunk) => {
            allLogs += chunk;
        });
        return allLogs;
    }
    parseWebhookPayload(payload) {
        // CircleCI webhook payload structure
        const workflow = payload.workflow || {};
        const pipeline = payload.pipeline || {};
        return {
            buildId: workflow.id,
            buildNumber: pipeline.number,
            buildUrl: workflow.url,
            status: this.mapCircleCIStatus(workflow.status),
            result: workflow.status,
            timestamp: new Date(workflow.created_at).getTime(),
            branch: pipeline.vcs?.branch,
            commit: pipeline.vcs?.revision,
            author: pipeline.trigger?.actor?.login,
        };
    }
    validateWebhook(headers, payload) {
        if (!this.webhookSecret) {
            logger_1.logger.warn('CircleCI webhook secret not configured, skipping validation');
            return true;
        }
        const signature = headers['circleci-signature'];
        if (!signature) {
            logger_1.logger.warn('No CircleCI signature in webhook headers');
            return false;
        }
        // Validate signature
        const hmac = crypto.createHmac('sha256', this.webhookSecret);
        const expectedSignature = hmac.update(JSON.stringify(payload)).digest('hex');
        return signature === expectedSignature;
    }
    mapCircleCIStatus(circleCIStatus) {
        const statusMap = {
            'running': 'running',
            'success': 'success',
            'failed': 'failure',
            'error': 'failure',
            'failing': 'failure',
            'on_hold': 'pending',
            'canceled': 'cancelled',
            'unauthorized': 'failure',
        };
        return statusMap[circleCIStatus] || 'pending';
    }
    calculateDuration(startTime, endTime) {
        if (!endTime)
            return null;
        return new Date(endTime).getTime() - new Date(startTime).getTime();
    }
    normalizeBuildData(providerData) {
        return {
            provider: this.getName(),
            buildId: providerData.buildId || '',
            buildNumber: providerData.buildNumber || 0,
            buildUrl: providerData.buildUrl || '',
            status: this.mapCircleCIStatus(providerData.result || providerData.status || ''),
            result: providerData.result || '',
            duration: providerData.duration || null,
            timestamp: providerData.timestamp || Date.now(),
            branch: providerData.branch,
            commit: providerData.commit,
            author: providerData.author,
        };
    }
}
exports.CircleCIProvider = CircleCIProvider;
//# sourceMappingURL=CircleCIProvider.js.map