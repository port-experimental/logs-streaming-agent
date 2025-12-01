/**
 * Plugin Registry Tests
 */

import { PluginRegistry } from '../PluginRegistry';
import { CIProviderInterface } from '../CIProviderInterface';
import { BuildInfo, BuildStatusInfo } from '../types';

// Mock provider for testing
class MockProvider extends CIProviderInterface {
  private name: string;

  constructor(config: any) {
    super(config);
    this.name = config.name || 'mock';
  }

  getName(): string {
    return this.name;
  }

  validateConfig(): void {
    if (!(this.config as any).required) {
      throw new Error('Required config missing');
    }
  }

  async triggerBuild(parameters?: Record<string, any>): Promise<BuildInfo> {
    return {
      buildId: '1',
      buildNumber: 1,
      buildUrl: 'http://example.com/build/1',
    };
  }

  async getBuildStatus(buildId: string): Promise<BuildStatusInfo> {
    return {
      buildId,
      buildNumber: 1,
      status: 'success',
      result: 'SUCCESS',
      building: false,
      duration: 1000,
      timestamp: Date.now(),
    };
  }

  async streamLogs(buildId: string, onLogChunk: (chunk: string) => void): Promise<void> {
    onLogChunk('test log');
  }

  async getCompleteLogs(buildId: string): Promise<string> {
    return 'complete logs';
  }

  parseWebhookPayload(payload: any): Partial<any> {
    return payload;
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('register', () => {
    it('should register a provider successfully', () => {
      const provider = registry.register(MockProvider, { name: 'test', required: true });
      
      expect(provider).toBeInstanceOf(MockProvider);
      expect(provider.getName()).toBe('test');
      expect(registry.hasProvider('test')).toBe(true);
    });

    it('should throw error if config validation fails', () => {
      expect(() => {
        registry.register(MockProvider, { name: 'test' }); // missing required
      }).toThrow('Required config missing');
    });

    it('should register multiple providers', () => {
      registry.register(MockProvider, { name: 'provider1', required: true });
      registry.register(MockProvider, { name: 'provider2', required: true });
      
      expect(registry.getProviderNames()).toHaveLength(2);
      expect(registry.getProviderNames()).toContain('provider1');
      expect(registry.getProviderNames()).toContain('provider2');
    });
  });

  describe('getProvider', () => {
    it('should return registered provider', () => {
      registry.register(MockProvider, { name: 'test', required: true });
      const provider = registry.getProvider('test');
      
      expect(provider).toBeInstanceOf(MockProvider);
      expect(provider?.getName()).toBe('test');
    });

    it('should return null for unregistered provider', () => {
      const provider = registry.getProvider('nonexistent');
      expect(provider).toBeNull();
    });
  });

  describe('getAllProviders', () => {
    it('should return all registered providers', () => {
      registry.register(MockProvider, { name: 'provider1', required: true });
      registry.register(MockProvider, { name: 'provider2', required: true });
      
      const providers = registry.getAllProviders();
      expect(providers).toHaveLength(2);
    });

    it('should return empty array when no providers registered', () => {
      const providers = registry.getAllProviders();
      expect(providers).toHaveLength(0);
    });
  });

  describe('getProviderNames', () => {
    it('should return all provider names', () => {
      registry.register(MockProvider, { name: 'provider1', required: true });
      registry.register(MockProvider, { name: 'provider2', required: true });
      
      const names = registry.getProviderNames();
      expect(names).toEqual(['provider1', 'provider2']);
    });
  });

  describe('hasProvider', () => {
    it('should return true for registered provider', () => {
      registry.register(MockProvider, { name: 'test', required: true });
      expect(registry.hasProvider('test')).toBe(true);
    });

    it('should return false for unregistered provider', () => {
      expect(registry.hasProvider('nonexistent')).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should remove registered provider', () => {
      registry.register(MockProvider, { name: 'test', required: true });
      expect(registry.hasProvider('test')).toBe(true);
      
      const removed = registry.unregister('test');
      expect(removed).toBe(true);
      expect(registry.hasProvider('test')).toBe(false);
    });

    it('should return false when removing non-existent provider', () => {
      const removed = registry.unregister('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('getWebhookRoutes', () => {
    it('should return webhook routes for all providers', () => {
      registry.register(MockProvider, { name: 'test', required: true });
      const routes = registry.getWebhookRoutes();
      
      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/webhook/test');
      expect(routes[0].provider).toBeInstanceOf(MockProvider);
    });
  });
});

