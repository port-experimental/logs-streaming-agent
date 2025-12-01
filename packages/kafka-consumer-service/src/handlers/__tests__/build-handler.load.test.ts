/**
 * Build Handler Load Tests
 * Tests for concurrent build actions and performance
 */

import { handleBuildAction } from '../build-handler';
import { pluginRegistry } from '@cicd/shared';
import { JenkinsProvider } from '../../../../shared/src/providers/jenkins/JenkinsProvider';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock the consumer
const createMockConsumer = () => ({
  addActionRunLog: jest.fn().mockResolvedValue({}),
  updateActionRun: jest.fn().mockResolvedValue({}),
});

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

describe('handleBuildAction - Load Tests', () => {
  let mockProvider: JenkinsProvider;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create = jest.fn(() => mockAxiosInstance as any);

    mockProvider = new JenkinsProvider({
      jenkinsUrl: 'http://jenkins.test',
      username: 'test',
      apiToken: 'token',
      jobName: 'test-job',
    });

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

  describe('Concurrent Build Actions', () => {
    it('should handle concurrent build actions', async () => {
      const concurrentActions = 10;
      const registeredProvider = pluginRegistry.getProvider('jenkins') as any;

      // Mock provider methods
      jest.spyOn(registeredProvider, 'triggerBuild').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          buildId: '42',
          buildNumber: 42,
          buildUrl: 'http://jenkins.test/job/test-job/42',
        };
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

      const messages = Array(concurrentActions).fill(null).map((_, i) => ({
        context: {
          runId: `run-${i}`,
          by: { email: 'test@example.com' },
        },
        action: {
          identifier: 'deploy_microservice_kafka',
        },
        properties: {
          serviceName: `Service${i}`,
          version: '1.0.0',
          environment: 'dev',
        },
      }));

      const consumers = messages.map(() => createMockConsumer());

      const promises = messages.map((message, i) =>
        handleBuildAction(message, consumers[i] as any)
      );

      const results = await Promise.allSettled(promises);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBe(concurrentActions);
    }, 30000);

    it('should handle rapid sequential build actions', async () => {
      const actionCount = 20;
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

      const startTime = Date.now();

      for (let i = 0; i < actionCount; i++) {
        const message = {
          context: {
            runId: `run-${i}`,
            by: { email: 'test@example.com' },
          },
          action: {
            identifier: 'deploy_microservice_kafka',
          },
          properties: {
            serviceName: `Service${i}`,
            version: '1.0.0',
            environment: 'dev',
          },
        };

        const consumer = createMockConsumer();
        await handleBuildAction(message, consumer as any);
      }

      const duration = Date.now() - startTime;
      
      // Should complete in reasonable time
      expect(duration).toBeLessThan(10000);
    }, 30000);
  });

  describe('Performance Benchmarks', () => {
    it('should complete build action within acceptable time', async () => {
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

      const message = {
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
        },
      };

      const consumer = createMockConsumer();
      const startTime = Date.now();

      await handleBuildAction(message, consumer as any);

      const duration = Date.now() - startTime;
      
      // Should complete quickly with mocked dependencies
      expect(duration).toBeLessThan(1000);
    });
  });
});

