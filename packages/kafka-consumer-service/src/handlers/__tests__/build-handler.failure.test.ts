/**
 * Build Handler Failure Scenario Tests
 * Tests for error handling, failures, and edge cases
 */

import { handleBuildAction } from '../build-handler';
import { pluginRegistry } from '@cicd/shared';
import { JenkinsProvider } from '../../../../shared/src/providers/jenkins/JenkinsProvider';
import { BlueprintHandler } from '../blueprint-handler';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock the consumer
const mockConsumer = {
  addActionRunLog: jest.fn().mockResolvedValue({}),
  updateActionRun: jest.fn().mockResolvedValue({}),
};

// Mock logger
jest.mock('@cicd/shared', () => ({
  ...jest.requireActual('@cicd/shared'),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock BlueprintHandler
jest.mock('../blueprint-handler');

describe('handleBuildAction - Failure Scenarios', () => {
  let mockProvider: JenkinsProvider;
  let mockAxiosInstance: any;
  const baseMessage = {
    context: {
      runId: 'run-123',
      by: { email: 'test@example.com' },
    },
    action: {
      identifier: 'deploy_microservice_kafka',
    },
    properties: {
      serviceName: 'TestService',
      version: '1.0.0',
      environment: 'dev',
      branch: 'main',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create = jest.fn(() => mockAxiosInstance as any);

    // Create a mock Jenkins provider
    mockProvider = new JenkinsProvider({
      jenkinsUrl: 'http://jenkins.test',
      username: 'test',
      apiToken: 'token',
      jobName: 'test-job',
    });

    // Register the provider
    pluginRegistry.unregister('jenkins');
    pluginRegistry.register(JenkinsProvider as any, {
      jenkinsUrl: 'http://jenkins.test',
      username: 'test',
      apiToken: 'token',
      jobName: 'test-job',
    });
  });

  afterEach(() => {
    pluginRegistry.unregister('jenkins');
  });

  describe('triggerBuild Failures', () => {
    it('should handle triggerBuild failure', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockRejectedValue(
        new Error('Jenkins connection failed')
      );

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow('Jenkins connection failed');

      expect(mockConsumer.addActionRunLog).toHaveBeenCalledWith(
        'run-123',
        expect.stringContaining('Build failed')
      );
    });

    it('should handle network timeout during triggerBuild', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      const timeoutError: any = new Error('timeout of 30000ms exceeded');
      timeoutError.code = 'ECONNABORTED';
      jest.spyOn(registeredProvider, 'triggerBuild').mockRejectedValue(timeoutError);

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow();
    });

    it('should handle 401 Unauthorized during triggerBuild', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      const authError: any = new Error('Unauthorized');
      authError.response = { status: 401 };
      jest.spyOn(registeredProvider, 'triggerBuild').mockRejectedValue(authError);

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow();
    });
  });

  describe('streamLogs Failures', () => {
    it('should handle streamLogs failure', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });
      jest.spyOn(registeredProvider, 'streamLogs').mockRejectedValue(
        new Error('Log streaming failed')
      );
      jest.spyOn(registeredProvider, 'getBuildStatus').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        status: 'success',
        result: 'SUCCESS',
        building: false,
        duration: 10000,
        timestamp: Date.now(),
      });
      if ('getAllStages' in registeredProvider) {
        (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
      }

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow();
    });

    it('should handle timeout during log streaming', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });
      const timeoutError: any = new Error('timeout');
      timeoutError.code = 'ECONNABORTED';
      jest.spyOn(registeredProvider, 'streamLogs').mockRejectedValue(timeoutError);
      jest.spyOn(registeredProvider, 'getBuildStatus').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        status: 'success',
        result: 'SUCCESS',
        building: false,
        duration: 10000,
        timestamp: Date.now(),
      });
      if ('getAllStages' in registeredProvider) {
        (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
      }

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow();
    });
  });

  describe('getBuildStatus Failures', () => {
    it('should handle getBuildStatus failure', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });
      jest.spyOn(registeredProvider, 'streamLogs').mockResolvedValue(undefined);
      jest.spyOn(registeredProvider, 'getBuildStatus').mockRejectedValue(
        new Error('Failed to get build status')
      );
      if ('getAllStages' in registeredProvider) {
        (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
      }

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow();
    });
  });

  describe('Entity Creation Failures', () => {
    it('should handle entity creation failure gracefully', async () => {
      // Set environment to enable entity creation
      const originalEnv = process.env.AUTO_CREATE_ENTITIES;
      process.env.AUTO_CREATE_ENTITIES = 'true';
      const originalBlueprintId = process.env.ENTITY_BLUEPRINT_ID;
      process.env.ENTITY_BLUEPRINT_ID = 'test-blueprint';

      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });
      jest.spyOn(registeredProvider, 'getBuildStatus').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        status: 'success',
        result: 'SUCCESS',
        building: false,
        duration: 10000,
        timestamp: Date.now(),
      });
      jest.spyOn(registeredProvider, 'streamLogs').mockResolvedValue(undefined);
      if ('getAllStages' in registeredProvider) {
        (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
      }

      // Mock BlueprintHandler to fail
      const mockCreateEntity = jest.fn().mockRejectedValue(new Error('Entity creation failed'));
      jest.spyOn(BlueprintHandler.prototype, 'createEntity').mockImplementation(mockCreateEntity);

      // Should not throw - entity creation failure is handled gracefully
      await handleBuildAction(baseMessage, mockConsumer as any);

      // Check that warning was logged (may be called multiple times, so check if any call matches)
      const warningCalls = (mockConsumer.addActionRunLog as jest.Mock).mock.calls.filter(
        (call: any[]) => call[1] && call[1].includes('Warning: Failed to create entity')
      );
      expect(warningCalls.length).toBeGreaterThan(0);

      // Restore environment
      if (originalEnv) {
        process.env.AUTO_CREATE_ENTITIES = originalEnv;
      } else {
        delete process.env.AUTO_CREATE_ENTITIES;
      }
      if (originalBlueprintId) {
        process.env.ENTITY_BLUEPRINT_ID = originalBlueprintId;
      } else {
        delete process.env.ENTITY_BLUEPRINT_ID;
      }
    });

    it('should continue even if entity creation throws unexpected error', async () => {
      const originalEnv = process.env.AUTO_CREATE_ENTITIES;
      process.env.AUTO_CREATE_ENTITIES = 'true';
      const originalBlueprintId = process.env.ENTITY_BLUEPRINT_ID;
      process.env.ENTITY_BLUEPRINT_ID = 'test-blueprint';

      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });
      jest.spyOn(registeredProvider, 'getBuildStatus').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        status: 'success',
        result: 'SUCCESS',
        building: false,
        duration: 10000,
        timestamp: Date.now(),
      });
      jest.spyOn(registeredProvider, 'streamLogs').mockResolvedValue(undefined);
      if ('getAllStages' in registeredProvider) {
        (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
      }

      // Mock BlueprintHandler to throw non-Error
      jest.spyOn(BlueprintHandler.prototype, 'createEntity').mockRejectedValue('String error');

      // Should not throw
      await handleBuildAction(baseMessage, mockConsumer as any);

      // Check that warning was logged
      const warningCalls = (mockConsumer.addActionRunLog as jest.Mock).mock.calls.filter(
        (call: any[]) => call[1] && call[1].includes('Warning: Failed to create entity')
      );
      expect(warningCalls.length).toBeGreaterThan(0);

      if (originalEnv) {
        process.env.AUTO_CREATE_ENTITIES = originalEnv;
      } else {
        delete process.env.AUTO_CREATE_ENTITIES;
      }
      if (originalBlueprintId) {
        process.env.ENTITY_BLUEPRINT_ID = originalBlueprintId;
      } else {
        delete process.env.ENTITY_BLUEPRINT_ID;
      }
    });
  });

  describe('Port API Failures', () => {
    it('should handle Port API failures during log updates', async () => {
      mockConsumer.addActionRunLog.mockRejectedValueOnce(
        new Error('Port API error')
      );

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow();
    });

    it('should handle Port API failures during status updates', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });

      mockConsumer.updateActionRun.mockRejectedValueOnce(
        new Error('Port API update failed')
      );

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow();
    });
  });

  describe('Invalid Message Format', () => {
    it('should handle missing runId', async () => {
      const invalidMessage = {
        context: {
          // Missing runId
          by: { email: 'test@example.com' },
        },
        action: {
          identifier: 'deploy_microservice_kafka',
        },
        properties: {},
      };

      await expect(
        handleBuildAction(invalidMessage as any, mockConsumer as any)
      ).rejects.toThrow();
    });

    it('should handle missing context', async () => {
      const invalidMessage = {
        // Missing context
        action: {
          identifier: 'deploy_microservice_kafka',
        },
        properties: {},
      };

      await expect(
        handleBuildAction(invalidMessage as any, mockConsumer as any)
      ).rejects.toThrow();
    });

    it('should handle missing action identifier', async () => {
      const invalidMessage = {
        context: {
          runId: 'run-123',
          by: { email: 'test@example.com' },
        },
        action: {
          // Missing identifier
        },
        properties: {},
      };

      // This might not throw immediately, but should handle gracefully
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });
      jest.spyOn(registeredProvider, 'getBuildStatus').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        status: 'success',
        result: 'SUCCESS',
        building: false,
        duration: 10000,
        timestamp: Date.now(),
      });
      jest.spyOn(registeredProvider, 'streamLogs').mockResolvedValue(undefined);
      if ('getAllStages' in registeredProvider) {
        (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
      }

      // Should still work with default values
      await handleBuildAction(invalidMessage as any, mockConsumer as any);
      expect(registeredProvider.triggerBuild).toHaveBeenCalled();
    });
  });

  describe('Build Status Failures', () => {
    it('should handle ABORTED build status', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });
      jest.spyOn(registeredProvider, 'getBuildStatus').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        status: 'cancelled',
        result: 'ABORTED',
        building: false,
        duration: 5000,
        timestamp: Date.now(),
      });
      jest.spyOn(registeredProvider, 'streamLogs').mockResolvedValue(undefined);
      if ('getAllStages' in registeredProvider) {
        (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
      }

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow('Build failed with status: ABORTED');
    });

    it('should handle UNSTABLE build status', async () => {
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;
      jest.spyOn(registeredProvider, 'triggerBuild').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        buildUrl: 'http://jenkins.test/job/test-job/42',
      });
      jest.spyOn(registeredProvider, 'getBuildStatus').mockResolvedValue({
        buildId: '42',
        buildNumber: 42,
        status: 'failure',
        result: 'UNSTABLE',
        building: false,
        duration: 5000,
        timestamp: Date.now(),
      });
      jest.spyOn(registeredProvider, 'streamLogs').mockResolvedValue(undefined);
      if ('getAllStages' in registeredProvider) {
        (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
      }

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow('Build failed with status: UNSTABLE');
    });
  });

  describe('Provider Registration Failures', () => {
    it('should throw error if provider not registered', async () => {
      pluginRegistry.unregister('jenkins');

      await expect(
        handleBuildAction(baseMessage, mockConsumer as any)
      ).rejects.toThrow("CI/CD provider 'jenkins' is not registered");
    });

    it('should throw error if invalid provider specified', async () => {
      const messageWithInvalidProvider = {
        ...baseMessage,
        properties: {
          ...baseMessage.properties,
          provider: 'nonexistent-provider',
        },
      };

      await expect(
        handleBuildAction(messageWithInvalidProvider, mockConsumer as any)
      ).rejects.toThrow("CI/CD provider 'nonexistent-provider' is not registered");
    });
  });
});

