"use strict";
/**
 * Base CI/CD Provider Interface
 * All CI/CD providers must extend this class and implement required methods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CIProviderInterface = void 0;
class CIProviderInterface {
    config;
    providerName;
    constructor(config) {
        this.config = config;
        this.providerName = this.constructor.name;
    }
    /**
     * Validate webhook signature/authentication
     * @param headers - Request headers
     * @param payload - Request payload
     * @returns True if webhook is authentic
     */
    validateWebhook(headers, payload) {
        // Optional: Override if provider supports webhook validation
        return true;
    }
    /**
     * Get webhook endpoint path for this provider
     * @returns Webhook path (e.g., '/webhook/jenkins')
     */
    getWebhookPath() {
        return `/webhook/${this.getName()}`;
    }
    /**
     * Normalize build data to common format
     * @param providerData - Provider-specific build data
     * @returns Normalized build data
     */
    normalizeBuildData(providerData) {
        return {
            provider: this.getName(),
            buildId: providerData.buildId || '',
            buildNumber: providerData.buildNumber || 0,
            buildUrl: providerData.buildUrl || '',
            status: providerData.status || 'pending',
            result: providerData.result || '',
            duration: providerData.duration || null,
            timestamp: providerData.timestamp || Date.now(),
            branch: providerData.branch,
            commit: providerData.commit,
            author: providerData.author,
            parameters: providerData.parameters || {},
            jobName: providerData.jobName,
        };
    }
}
exports.CIProviderInterface = CIProviderInterface;
//# sourceMappingURL=CIProviderInterface.js.map