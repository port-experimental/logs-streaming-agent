/**
 * Build Handler Tests
 */

import { handleBuildAction } from '../build-handler';
import { pluginRegistry } from '@cicd/shared';
import { JenkinsProvider } from '../../../../shared/src/providers/jenkins/JenkinsProvider';
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

describe('handleBuildAction', () => {
  let mockProvider: JenkinsProvider;
  let mockAxiosInstance: any;

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

  it('should trigger build and update Port', async () => {
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
        branch: 'main',
      },
    };

    // Mock provider methods via the registered provider
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
    // Mock getAllStages if it exists (Jenkins-specific method)
    if ('getAllStages' in registeredProvider) {
      (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
    }

    await handleBuildAction(message, mockConsumer as any);

    expect(mockConsumer.addActionRunLog).toHaveBeenCalledWith(
      'run-123',
      expect.stringContaining('Starting build')
    );
    expect(mockConsumer.addActionRunLog).toHaveBeenCalledWith(
      'run-123',
      'Service: TestService'
    );
    expect(mockConsumer.addActionRunLog).toHaveBeenCalledWith(
      'run-123',
      'Version: 1.0.0'
    );
    expect(mockConsumer.updateActionRun).toHaveBeenCalledWith('run-123', {
      link: ['http://jenkins.test/job/test-job/42'],
      statusLabel: 'Build #42 in progress',
    });
  });

  it('should handle build failure', async () => {
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
      result: 'FAILURE',
      building: false,
      duration: 5000,
      timestamp: Date.now(),
    });

    jest.spyOn(registeredProvider, 'streamLogs').mockResolvedValue(undefined);
    // Mock getAllStages if it exists (Jenkins-specific method)
    if ('getAllStages' in registeredProvider) {
      (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
    }

    await expect(
      handleBuildAction(message, mockConsumer as any)
    ).rejects.toThrow('Build failed with status: FAILURE');

    expect(mockConsumer.addActionRunLog).toHaveBeenCalledWith(
      'run-123',
      expect.stringContaining('Build failed')
    );
  });

  it('should throw error if provider not registered', async () => {
    pluginRegistry.unregister('jenkins');

    const message = {
      context: {
        runId: 'run-123',
        by: { email: 'test@example.com' },
      },
      action: {
        identifier: 'deploy_microservice_kafka',
      },
      properties: {
        provider: 'jenkins',
        serviceName: 'TestService',
      },
    };

    await expect(
      handleBuildAction(message, mockConsumer as any)
    ).rejects.toThrow("CI/CD provider 'jenkins' is not registered");
  });

  it('should use default provider if not specified', async () => {
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
    // Mock getAllStages if it exists (Jenkins-specific method)
    if ('getAllStages' in registeredProvider) {
      (registeredProvider as any).getAllStages = jest.fn().mockResolvedValue([]);
    }

    await handleBuildAction(message, mockConsumer as any);

    expect(registeredProvider.triggerBuild).toHaveBeenCalled();
  });
});

