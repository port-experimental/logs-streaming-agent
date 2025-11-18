/**
 * Jenkins CI/CD Provider Plugin
 */
import { CIProviderInterface } from '../../core/CIProviderInterface';
import { BuildInfo, BuildStatusInfo, NormalizedBuildData, WebhookPayload } from '../../core/types';
export interface JenkinsConfig {
    jenkinsUrl: string;
    username: string;
    apiToken: string;
    jobName: string;
    timeout?: number;
}
export declare class JenkinsProvider extends CIProviderInterface {
    private jenkinsUrl;
    private username;
    private apiToken;
    private jobName;
    private timeout;
    private client;
    constructor(config: JenkinsConfig);
    getName(): string;
    validateConfig(): void;
    triggerBuild(parameters?: Record<string, any>): Promise<BuildInfo>;
    getBuildStatus(buildId: string): Promise<BuildStatusInfo>;
    streamLogs(buildId: string, onLogChunk: (chunk: string) => void): Promise<void>;
    getCompleteLogs(buildId: string): Promise<string>;
    parseWebhookPayload(payload: WebhookPayload): Partial<NormalizedBuildData>;
    private mapJenkinsStatus;
    normalizeBuildData(providerData: Partial<NormalizedBuildData>): NormalizedBuildData;
}
//# sourceMappingURL=JenkinsProvider.d.ts.map