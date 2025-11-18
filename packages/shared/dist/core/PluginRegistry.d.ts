/**
 * Plugin Registry
 * Manages registration and retrieval of CI/CD provider plugins
 */
import { CIProviderInterface } from './CIProviderInterface';
type ProviderConstructor = new (config: any) => CIProviderInterface;
export declare class PluginRegistry {
    private providers;
    /**
     * Register a CI/CD provider plugin
     * @param ProviderClass - Provider class
     * @param config - Provider configuration
     */
    register(ProviderClass: ProviderConstructor, config?: any): CIProviderInterface;
    /**
     * Get a registered provider by name
     * @param name - Provider name
     * @returns Provider instance or null
     */
    getProvider(name: string): CIProviderInterface | null;
    /**
     * Get all registered providers
     * @returns Array of provider instances
     */
    getAllProviders(): CIProviderInterface[];
    /**
     * Get all provider names
     * @returns Array of provider names
     */
    getProviderNames(): string[];
    /**
     * Check if a provider is registered
     * @param name - Provider name
     * @returns True if provider is registered
     */
    hasProvider(name: string): boolean;
    /**
     * Unregister a provider
     * @param name - Provider name
     * @returns True if provider was removed
     */
    unregister(name: string): boolean;
    /**
     * Get webhook routes for all registered providers
     * @returns Array of webhook route information
     */
    getWebhookRoutes(): Array<{
        path: string;
        provider: CIProviderInterface;
    }>;
}
export declare const pluginRegistry: PluginRegistry;
export {};
//# sourceMappingURL=PluginRegistry.d.ts.map