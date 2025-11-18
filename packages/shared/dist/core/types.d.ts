/**
 * Common types for CI/CD providers
 */
export type BuildStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
export interface BuildInfo {
    buildId: string;
    buildNumber: number;
    buildUrl: string;
    pipelineId?: string;
}
export interface BuildStatusInfo {
    buildId: string;
    buildNumber: number;
    status: BuildStatus;
    result: string;
    building?: boolean;
    duration: number | null;
    timestamp: number;
    branch?: string;
    commit?: string;
    author?: string;
}
export interface NormalizedBuildData {
    provider: string;
    buildId: string;
    buildNumber: number;
    buildUrl: string;
    status: BuildStatus;
    result: string;
    duration: number | null;
    timestamp: number;
    branch?: string;
    commit?: string;
    author?: string;
    parameters?: Record<string, any>;
    jobName?: string;
}
export interface WebhookPayload {
    [key: string]: any;
}
export interface ProviderConfig {
    [key: string]: any;
}
//# sourceMappingURL=types.d.ts.map