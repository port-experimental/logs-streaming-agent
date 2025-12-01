/**
 * Jenkins Provider Tests
 */

import { JenkinsProvider } from '../JenkinsProvider';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('JenkinsProvider', () => {
  const mockConfig = {
    jenkinsUrl: 'http://jenkins.example.com',
    username: 'testuser',
    apiToken: 'test-token',
    jobName: 'test-job',
  };

  let provider: JenkinsProvider;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };

    mockedAxios.create = jest.fn(() => mockAxiosInstance as any);
    mockedAxios.post = jest.fn();

    provider = new JenkinsProvider(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create provider with valid config', () => {
      expect(provider).toBeInstanceOf(JenkinsProvider);
      expect(provider.getName()).toBe('jenkins');
    });

    it('should create axios instance with correct config', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: mockConfig.jenkinsUrl,
        auth: {
          username: mockConfig.username,
          password: mockConfig.apiToken,
        },
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
    });
  });

  describe('getName', () => {
    it('should return "jenkins"', () => {
      expect(provider.getName()).toBe('jenkins');
    });
  });

  describe('validateConfig', () => {
    it('should pass with valid config', () => {
      expect(() => provider.validateConfig()).not.toThrow();
    });

    it('should throw error if jenkinsUrl is missing', () => {
      const invalidProvider = new JenkinsProvider({
        ...mockConfig,
        jenkinsUrl: '',
      });
      expect(() => invalidProvider.validateConfig()).toThrow('jenkinsUrl is required');
    });

    it('should throw error if username is missing', () => {
      const invalidProvider = new JenkinsProvider({
        ...mockConfig,
        username: '',
      });
      expect(() => invalidProvider.validateConfig()).toThrow('username is required');
    });

    it('should throw error if apiToken is missing', () => {
      const invalidProvider = new JenkinsProvider({
        ...mockConfig,
        apiToken: '',
      });
      expect(() => invalidProvider.validateConfig()).toThrow('apiToken is required');
    });

    it('should throw error if jobName is missing', () => {
      const invalidProvider = new JenkinsProvider({
        ...mockConfig,
        jobName: '',
      });
      expect(() => invalidProvider.validateConfig()).toThrow('jobName is required');
    });
  });

  describe('triggerBuild', () => {
    it('should trigger build without parameters', async () => {
      // Mock client.post (used in triggerBuild)
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          lastBuild: { number: 42 },
        },
      });

      // Mock setTimeout to avoid waiting
      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      
      // Wait for post to complete
      await Promise.resolve();
      // Advance timers past the 3 second delay
      jest.advanceTimersByTime(3000);
      // Wait for get to complete
      await Promise.resolve();
      
      const result = await triggerPromise;
      jest.useRealTimers();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/job/test-job/build',
        null,
        { params: undefined }
      );
      expect(result.buildNumber).toBe(42);
      expect(result.buildId).toBe('42');
    }, 10000);

    it('should trigger build with parameters', async () => {
      const parameters = { SERVICE_NAME: 'test', VERSION: '1.0.0' };
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          lastBuild: { number: 43 },
        },
      });

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild(parameters);
      
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      
      const result = await triggerPromise;
      jest.useRealTimers();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/job/test-job/buildWithParameters',
        null,
        { params: parameters }
      );
      expect(result.buildNumber).toBe(43);
    }, 10000);

    it('should throw error if no build number returned', async () => {
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockResolvedValue({
        data: { lastBuild: null },
      });

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      
      await expect(triggerPromise).rejects.toThrow('No build number returned from Jenkins');
      jest.useRealTimers();
    }, 10000);

    it('should handle axios errors', async () => {
      const error = new Error('Network error');
      mockAxiosInstance.post.mockRejectedValue(error);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });
  });

  describe('getBuildStatus', () => {
    it('should return build status for running build', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          number: 42,
          building: true,
          result: null,
          duration: 5000,
          timestamp: 1234567890,
        },
      });

      const status = await provider.getBuildStatus('42');

      expect(status.buildId).toBe('42');
      expect(status.buildNumber).toBe(42);
      expect(status.status).toBe('running');
      expect(status.building).toBe(true);
    });

    it('should return build status for successful build', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          number: 42,
          building: false,
          result: 'SUCCESS',
          duration: 10000,
          timestamp: 1234567890,
        },
      });

      const status = await provider.getBuildStatus('42');

      expect(status.status).toBe('success');
      expect(status.result).toBe('SUCCESS');
      expect(status.building).toBe(false);
    });

    it('should return build status for failed build', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          number: 42,
          building: false,
          result: 'FAILURE',
          duration: 8000,
          timestamp: 1234567890,
        },
      });

      const status = await provider.getBuildStatus('42');

      expect(status.status).toBe('failure');
      expect(status.result).toBe('FAILURE');
    });
  });

  describe('getCurrentStage', () => {
    it('should return current running stage', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          stages: [
            { name: 'Build', status: 'SUCCESS', durationMillis: 5000 },
            { name: 'Deploy', status: 'IN_PROGRESS', durationMillis: 2000 },
          ],
        },
      });

      const stage = await provider.getCurrentStage('42');

      expect(stage).not.toBeNull();
      expect(stage?.name).toBe('Deploy');
      expect(stage?.status).toBe('IN_PROGRESS');
    });

    it('should return last completed stage when no running stage', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          stages: [
            { name: 'Build', status: 'SUCCESS', durationMillis: 5000 },
            { name: 'Test', status: 'SUCCESS', durationMillis: 3000 },
          ],
        },
      });

      const stage = await provider.getCurrentStage('42');

      expect(stage).not.toBeNull();
      expect(stage?.name).toBe('Test');
      expect(stage?.status).toBe('SUCCESS');
    });

    it('should return null if no stages found', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { stages: [] },
      });

      const stage = await provider.getCurrentStage('42');

      expect(stage).toBeNull();
    });

    it('should handle 404 error gracefully', async () => {
      const error: any = new Error('Not found');
      error.response = { status: 404 };
      mockAxiosInstance.get.mockRejectedValue(error);

      const stage = await provider.getCurrentStage('42');

      expect(stage).toBeNull();
    });
  });

  describe('streamLogs', () => {
    it('should stream logs in chunks', async () => {
      const logChunks: string[] = [];
      
      // Mock the get calls - first returns more data, second returns no more data
      let callCount = 0;
      mockAxiosInstance.get.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: 'chunk1\n',
            headers: { 'x-more-data': 'true', 'x-text-size': '10' },
          });
        } else {
          return Promise.resolve({
            data: 'chunk2\n',
            headers: { 'x-more-data': 'false', 'x-text-size': '20' },
          });
        }
      });

      jest.useFakeTimers();
      const streamPromise = provider.streamLogs('42', (chunk) => {
        logChunks.push(chunk);
      });
      
      // Wait for first request
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      
      // Wait for second request (which should exit the loop)
      await Promise.resolve();
      
      await streamPromise;
      jest.useRealTimers();

      expect(logChunks.length).toBeGreaterThan(0);
      expect(mockAxiosInstance.get).toHaveBeenCalled();
    }, 10000);
  });

  describe('getCompleteLogs', () => {
    it('should return complete logs', async () => {
      const expectedLogs = 'Complete build logs\nLine 1\nLine 2';
      mockAxiosInstance.get.mockResolvedValue({
        data: expectedLogs,
      });

      const logs = await provider.getCompleteLogs('42');

      expect(logs).toBe(expectedLogs);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/job/test-job/42/consoleText',
        { responseType: 'text' }
      );
    });
  });
});

