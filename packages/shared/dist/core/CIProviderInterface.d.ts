/**
 * Base CI/CD Provider Interface
 * All CI/CD providers must extend this class and implement required methods
 */
import { BuildInfo, BuildStatusInfo, NormalizedBuildData, ProviderConfig, WebhookPayload } from './types';
export declare abstract class CIProviderInterface {
    protected config: ProviderConfig;
    protected providerName: string;
    constructor(config: ProviderConfig);
    /**
     * Get provider name (e.g., 'jenkins', 'circleci', 'github-actions')
     */
    abstract getName(): string;
    /**
     * Validate provider configuration
     * @throws {Error} if configuration is invalid
     */
    abstract validateConfig(): void;
    /**
     * Trigger a new build/pipeline
     * @param parameters - Build parameters
     * @returns Build information
     */
    abstract triggerBuild(parameters?: Record<string, any>): Promise<BuildInfo>;
    /**
     * Get build status
     * @param buildId - Build identifier
     * @returns Build status information
     */
    abstract getBuildStatus(buildId: string): Promise<BuildStatusInfo>;
    /**
     * Stream build logs in real-time
     * @param buildId - Build identifier
     * @param onLogChunk - Callback for each log chunk
     */
    abstract streamLogs(buildId: string, onLogChunk: (chunk: string) => void): Promise<void>;
    /**
     * Get complete build logs
     * @param buildId - Build identifier
     * @returns Complete logs
     */
    abstract getCompleteLogs(buildId: string): Promise<string>;
    /**
     * Parse webhook payload from this provider
     * @param payload - Raw webhook payload
     * @returns Normalized webhook data
     */
    abstract parseWebhookPayload(payload: WebhookPayload): Partial<NormalizedBuildData>;
    /**
     * Validate webhook signature/authentication
     * @param headers - Request headers
     * @param payload - Request payload
     * @returns True if webhook is authentic
     */
    validateWebhook(headers: Record<string, any>, payload: WebhookPayload): boolean;
    /**
     * Get webhook endpoint path for this provider
     * @returns Webhook path (e.g., '/webhook/jenkins')
     */
    getWebhookPath(): string;
    /**
     * Normalize build data to common format
     * @param providerData - Provider-specific build data
     * @returns Normalized build data
     */
    normalizeBuildData(providerData: Partial<NormalizedBuildData>): NormalizedBuildData;
}
//# sourceMappingURL=CIProviderInterface.d.ts.map