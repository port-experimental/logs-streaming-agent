"use strict";
/**
 * Plugin Registry
 * Manages registration and retrieval of CI/CD provider plugins
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pluginRegistry = exports.PluginRegistry = void 0;
const logger_1 = require("../utils/logger");
class PluginRegistry {
    providers = new Map();
    /**
     * Register a CI/CD provider plugin
     * @param ProviderClass - Provider class
     * @param config - Provider configuration
     */
    register(ProviderClass, config = {}) {
        try {
            const provider = new ProviderClass(config);
            const name = provider.getName();
            // Validate configuration
            provider.validateConfig();
            this.providers.set(name, provider);
            logger_1.logger.info(`✅ Registered CI/CD provider: ${name}`);
            return provider;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`❌ Failed to register provider ${ProviderClass.name}: ${errorMsg}`);
            throw error;
        }
    }
    /**
     * Get a registered provider by name
     * @param name - Provider name
     * @returns Provider instance or null
     */
    getProvider(name) {
        return this.providers.get(name) || null;
    }
    /**
     * Get all registered providers
     * @returns Array of provider instances
     */
    getAllProviders() {
        return Array.from(this.providers.values());
    }
    /**
     * Get all provider names
     * @returns Array of provider names
     */
    getProviderNames() {
        return Array.from(this.providers.keys());
    }
    /**
     * Check if a provider is registered
     * @param name - Provider name
     * @returns True if provider is registered
     */
    hasProvider(name) {
        return this.providers.has(name);
    }
    /**
     * Unregister a provider
     * @param name - Provider name
     * @returns True if provider was removed
     */
    unregister(name) {
        const removed = this.providers.delete(name);
        if (removed) {
            logger_1.logger.info(`Unregistered provider: ${name}`);
        }
        return removed;
    }
    /**
     * Get webhook routes for all registered providers
     * @returns Array of webhook route information
     */
    getWebhookRoutes() {
        return this.getAllProviders().map(provider => ({
            path: provider.getWebhookPath(),
            provider: provider,
        }));
    }
}
exports.PluginRegistry = PluginRegistry;
// Singleton instance
exports.pluginRegistry = new PluginRegistry();
//# sourceMappingURL=PluginRegistry.js.map