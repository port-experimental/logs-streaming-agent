/**
 * CircleCI Provider Plugin
 */
import { CIProviderInterface } from '../../core/CIProviderInterface';
import { BuildInfo, BuildStatusInfo, NormalizedBuildData, WebhookPayload } from '../../core/types';
export interface CircleCIConfig {
    apiToken: string;
    projectSlug: string;
    webhookSecret?: string;
}
export declare class CircleCIProvider extends CIProviderInterface {
    private apiToken;
    private projectSlug;
    private webhookSecret?;
    private baseUrl;
    private client;
    constructor(config: CircleCIConfig);
    getName(): string;
    validateConfig(): void;
    triggerBuild(parameters?: Record<string, any>): Promise<BuildInfo>;
    getBuildStatus(buildId: string): Promise<BuildStatusInfo>;
    streamLogs(buildId: string, onLogChunk: (chunk: string) => void): Promise<void>;
    private getJobLogs;
    getCompleteLogs(buildId: string): Promise<string>;
    parseWebhookPayload(payload: WebhookPayload): Partial<NormalizedBuildData>;
    validateWebhook(headers: Record<string, any>, payload: WebhookPayload): boolean;
    private mapCircleCIStatus;
    private calculateDuration;
    normalizeBuildData(providerData: Partial<NormalizedBuildData>): NormalizedBuildData;
}
//# sourceMappingURL=CircleCIProvider.d.ts.map