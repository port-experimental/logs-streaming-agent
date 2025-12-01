/**
 * Plugin Registry
 * Manages registration and retrieval of CI/CD provider plugins
 */

import { CIProviderInterface } from './CIProviderInterface';
import { ProviderConfig } from './types';
import { logger } from '../utils/logger';

type ProviderConstructor = new (config: any) => CIProviderInterface;

export class PluginRegistry {
  private providers: Map<string, CIProviderInterface> = new Map();

  /**
   * Register a CI/CD provider plugin
   * @param ProviderClass - Provider class
   * @param config - Provider configuration
   */
  register(ProviderClass: ProviderConstructor, config: any = {}): CIProviderInterface {
    try {
      const provider = new ProviderClass(config);
      const name = provider.getName();
      
      // Validate configuration
      provider.validateConfig();
      
      this.providers.set(name, provider);
      logger.info(`Registered CI/CD provider: ${name}`);
      
      return provider;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to register provider ${ProviderClass.name}: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Get a registered provider by name
   * @param name - Provider name
   * @returns Provider instance or null
   */
  getProvider(name: string): CIProviderInterface | null {
    return this.providers.get(name) || null;
  }

  /**
   * Get all registered providers
   * @returns Array of provider instances
   */
  getAllProviders(): CIProviderInterface[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all provider names
   * @returns Array of provider names
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is registered
   * @param name - Provider name
   * @returns True if provider is registered
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Unregister a provider
   * @param name - Provider name
   * @returns True if provider was removed
   */
  unregister(name: string): boolean {
    const removed = this.providers.delete(name);
    if (removed) {
      logger.info(`Unregistered provider: ${name}`);
    }
    return removed;
  }

  /**
   * Get webhook routes for all registered providers
   * @returns Array of webhook route information
   */
  getWebhookRoutes(): Array<{ path: string; provider: CIProviderInterface }> {
    return this.getAllProviders().map(provider => ({
      path: provider.getWebhookPath(),
      provider: provider,
    }));
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistry();
