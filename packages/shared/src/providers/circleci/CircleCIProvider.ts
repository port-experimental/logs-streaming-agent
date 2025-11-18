/**
 * CircleCI Provider Plugin
 */

import { CIProviderInterface } from '../../core/CIProviderInterface';
import { BuildInfo, BuildStatusInfo, BuildStatus, NormalizedBuildData, WebhookPayload } from '../../core/types';
import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import * as crypto from 'crypto';

export interface CircleCIConfig {
  apiToken: string;
  projectSlug: string; // e.g., 'gh/username/repo'
  webhookSecret?: string;
}

export class CircleCIProvider extends CIProviderInterface {
  private apiToken: string;
  private projectSlug: string;
  private webhookSecret?: string;
  private baseUrl: string;
  private client: AxiosInstance;

  constructor(config: CircleCIConfig) {
    super(config);
    
    this.apiToken = config.apiToken;
    this.projectSlug = config.projectSlug;
    this.webhookSecret = config.webhookSecret;
    this.baseUrl = 'https://circleci.com/api/v2';
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Circle-Token': this.apiToken,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  getName(): string {
    return 'circleci';
  }

  validateConfig(): void {
    const errors: string[] = [];
    
    if (!this.apiToken) errors.push('apiToken is required');
    if (!this.projectSlug) errors.push('projectSlug is required (format: vcs/org/repo)');
    
    if (errors.length > 0) {
      throw new Error(`CircleCI configuration invalid: ${errors.join(', ')}`);
    }
  }

  async triggerBuild(parameters: Record<string, any> = {}): Promise<BuildInfo> {
    try {
      logger.info(`Triggering CircleCI pipeline for: ${this.projectSlug}`);
      
      const response = await this.client.post(
        `/project/${this.projectSlug}/pipeline`,
        {
          parameters: parameters,
          branch: parameters.branch || 'main',
        }
      );

      const pipelineId = response.data.id;
      const pipelineNumber = response.data.number;
      
      // Wait a bit for workflow to start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get workflow ID
      const workflowResponse = await this.client.get(
        `/pipeline/${pipelineId}/workflow`
      );
      
      const workflow = workflowResponse.data.items[0];
      const buildUrl = `https://app.circleci.com/pipelines/${this.projectSlug}/${pipelineNumber}/workflows/${workflow.id}`;
      
      logger.info(`Pipeline #${pipelineNumber} triggered successfully`);
      
      return {
        buildId: workflow.id,
        buildNumber: pipelineNumber,
        buildUrl: buildUrl,
        pipelineId: pipelineId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('CircleCI trigger error:', errorMsg);
      throw new Error(`Failed to trigger CircleCI pipeline: ${errorMsg}`);
    }
  }

  async getBuildStatus(buildId: string): Promise<BuildStatusInfo> {
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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get workflow status for ${buildId}:`, errorMsg);
      throw new Error(`Failed to get workflow status: ${errorMsg}`);
    }
  }

  async streamLogs(buildId: string, onLogChunk: (chunk: string) => void): Promise<void> {
    // CircleCI doesn't support real-time log streaming via API
    // We need to poll for job logs
    logger.info(`Starting log polling for workflow ${buildId}...`);
    
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
      
      logger.info('Log polling completed.');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error polling logs:', errorMsg);
      throw error;
    }
  }

  private async getJobLogs(jobNumber: number): Promise<string> {
    try {
      // Note: CircleCI API v2 doesn't provide direct log access
      // You may need to use v1.1 API or implement alternative approach
      const response = await axios.get(
        `https://circleci.com/api/v1.1/project/${this.projectSlug}/${jobNumber}/output/0/0`,
        {
          headers: {
            'Circle-Token': this.apiToken,
          },
        }
      );
      
      // Parse log output
      return response.data.map((step: any) => 
        step.actions.map((action: any) => 
          action.output_url ? `${action.name}: See ${action.output_url}` : ''
        ).join('\n')
      ).join('\n');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Could not fetch logs for job ${jobNumber}:`, errorMsg);
      return `[Logs not available for job ${jobNumber}]`;
    }
  }

  async getCompleteLogs(buildId: string): Promise<string> {
    let allLogs = '';
    await this.streamLogs(buildId, (chunk) => {
      allLogs += chunk;
    });
    return allLogs;
  }

  parseWebhookPayload(payload: WebhookPayload): Partial<NormalizedBuildData> {
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

  validateWebhook(headers: Record<string, any>, payload: WebhookPayload): boolean {
    if (!this.webhookSecret) {
      logger.warn('CircleCI webhook secret not configured, skipping validation');
      return true;
    }
    
    const signature = headers['circleci-signature'];
    if (!signature) {
      logger.warn('No CircleCI signature in webhook headers');
      return false;
    }
    
    // Validate signature
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const expectedSignature = hmac.update(JSON.stringify(payload)).digest('hex');
    
    return signature === expectedSignature;
  }

  private mapCircleCIStatus(circleCIStatus: string): BuildStatus {
    const statusMap: Record<string, BuildStatus> = {
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

  private calculateDuration(startTime: string, endTime: string | null): number | null {
    if (!endTime) return null;
    return new Date(endTime).getTime() - new Date(startTime).getTime();
  }

  normalizeBuildData(providerData: Partial<NormalizedBuildData>): NormalizedBuildData {
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
