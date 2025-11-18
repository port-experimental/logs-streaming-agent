/**
 * Jenkins CI/CD Provider Plugin
 */

import { CIProviderInterface } from '../../core/CIProviderInterface';
import { BuildInfo, BuildStatusInfo, BuildStatus, NormalizedBuildData, WebhookPayload } from '../../core/types';
import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';

export interface JenkinsConfig {
  jenkinsUrl: string;
  username: string;
  apiToken: string;
  jobName: string;
  timeout?: number;
}

export class JenkinsProvider extends CIProviderInterface {
  private jenkinsUrl: string;
  private username: string;
  private apiToken: string;
  private jobName: string;
  private timeout: number;
  private client: AxiosInstance;

  constructor(config: JenkinsConfig) {
    super(config);
    
    this.jenkinsUrl = config.jenkinsUrl;
    this.username = config.username;
    this.apiToken = config.apiToken;
    this.jobName = config.jobName;
    this.timeout = config.timeout || 30000;
    
    // Create axios instance with authentication
    this.client = axios.create({
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

  getName(): string {
    return 'jenkins';
  }

  validateConfig(): void {
    const errors: string[] = [];
    
    if (!this.jenkinsUrl) errors.push('jenkinsUrl is required');
    if (!this.username) errors.push('username is required');
    if (!this.apiToken) errors.push('apiToken is required');
    if (!this.jobName) errors.push('jobName is required');
    
    if (errors.length > 0) {
      throw new Error(`Jenkins configuration invalid: ${errors.join(', ')}`);
    }
  }

  async triggerBuild(parameters: Record<string, any> = {}): Promise<BuildInfo> {
    try {
      logger.info(`Triggering Jenkins build for job: ${this.jobName}`);
      
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
      
      logger.info(`Build #${buildNumber} triggered successfully`);
      
      return {
        buildId: buildNumber.toString(),
        buildNumber: buildNumber,
        buildUrl: buildUrl,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Jenkins trigger error:', errorMsg);
      throw new Error(`Failed to trigger Jenkins build: ${errorMsg}`);
    }
  }

  async getBuildStatus(buildId: string): Promise<BuildStatusInfo> {
    try {
      const response = await this.client.get(
        `/job/${this.jobName}/${buildId}/api/json`
      );
      
      const data = response.data;
      let status: BuildStatus = 'pending';
      
      if (data.building) {
        status = 'running';
      } else if (data.result === 'SUCCESS') {
        status = 'success';
      } else if (data.result === 'FAILURE') {
        status = 'failure';
      } else if (data.result === 'ABORTED') {
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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get build status for #${buildId}:`, errorMsg);
      throw new Error(`Failed to get build status: ${errorMsg}`);
    }
  }

  async streamLogs(buildId: string, onLogChunk: (chunk: string) => void): Promise<void> {
    let start = 0;
    let isBuilding = true;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    logger.info(`Starting log stream for build #${buildId}...`);

    while (isBuilding) {
      try {
        const response = await this.client.get(
          `/job/${this.jobName}/${buildId}/logText/progressiveText?start=${start}`,
          { responseType: 'text' }
        );

        const logChunk = response.data;
        const moreData = response.headers['x-more-data'];
        const nextStart = response.headers['x-text-size'];

        if (logChunk) {
          onLogChunk(logChunk);
        }

        if (nextStart) {
          start = parseInt(nextStart as string, 10);
        }

        isBuilding = moreData === 'true';
        consecutiveErrors = 0;

        if (isBuilding) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        consecutiveErrors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Error streaming logs (attempt ${consecutiveErrors}/${maxConsecutiveErrors}):`, errorMsg);
        
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Failed to stream logs after ${maxConsecutiveErrors} attempts`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    logger.info('Log stream completed.');
  }

  async getCompleteLogs(buildId: string): Promise<string> {
    try {
      const response = await this.client.get(
        `/job/${this.jobName}/${buildId}/consoleText`,
        { responseType: 'text' }
      );
      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get console output for #${buildId}:`, errorMsg);
      throw new Error(`Failed to get console output: ${errorMsg}`);
    }
  }

  parseWebhookPayload(payload: WebhookPayload): Partial<NormalizedBuildData> {
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

  private mapJenkinsStatus(jenkinsStatus: string): BuildStatus {
    const statusMap: Record<string, BuildStatus> = {
      'STARTED': 'running',
      'IN_PROGRESS': 'running',
      'SUCCESS': 'success',
      'FAILURE': 'failure',
      'UNSTABLE': 'failure',
      'ABORTED': 'cancelled',
    };
    return statusMap[jenkinsStatus] || 'pending';
  }

  normalizeBuildData(providerData: Partial<NormalizedBuildData>): NormalizedBuildData {
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
