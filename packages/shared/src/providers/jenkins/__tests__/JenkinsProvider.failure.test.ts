/**
 * Jenkins Provider Failure Scenario Tests
 * Tests for error handling, network failures, and edge cases
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

describe('JenkinsProvider - Failure Scenarios', () => {
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

  describe('triggerBuild - Network Failures', () => {
    it('should handle network timeout errors', async () => {
      const timeoutError: any = new Error('timeout of 30000ms exceeded');
      timeoutError.code = 'ECONNABORTED';
      mockAxiosInstance.post.mockRejectedValue(timeoutError);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });

    it('should handle connection refused errors', async () => {
      const connectionError: any = new Error('Connection refused');
      connectionError.code = 'ECONNREFUSED';
      mockAxiosInstance.post.mockRejectedValue(connectionError);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });

    it('should handle DNS resolution failures', async () => {
      const dnsError: any = new Error('getaddrinfo ENOTFOUND jenkins.example.com');
      dnsError.code = 'ENOTFOUND';
      mockAxiosInstance.post.mockRejectedValue(dnsError);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });
  });

  describe('triggerBuild - HTTP Error Responses', () => {
    it('should handle 401 Unauthorized', async () => {
      const error: any = new Error('Unauthorized');
      error.response = { status: 401, statusText: 'Unauthorized', data: { message: 'Invalid credentials' } };
      mockAxiosInstance.post.mockRejectedValue(error);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });

    it('should handle 403 Forbidden', async () => {
      const error: any = new Error('Forbidden');
      error.response = { status: 403, statusText: 'Forbidden', data: { message: 'Access denied' } };
      mockAxiosInstance.post.mockRejectedValue(error);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });

    it('should handle 404 Not Found (job does not exist)', async () => {
      const error: any = new Error('Not Found');
      error.response = { status: 404, statusText: 'Not Found', data: { message: 'Job not found' } };
      mockAxiosInstance.post.mockRejectedValue(error);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });

    it('should handle 500 Internal Server Error', async () => {
      const error: any = new Error('Internal Server Error');
      error.response = { status: 500, statusText: 'Internal Server Error', data: { message: 'Server error' } };
      mockAxiosInstance.post.mockRejectedValue(error);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });

    it('should handle 503 Service Unavailable', async () => {
      const error: any = new Error('Service Unavailable');
      error.response = { status: 503, statusText: 'Service Unavailable' };
      mockAxiosInstance.post.mockRejectedValue(error);

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      jest.advanceTimersByTime(3000);
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });
  });

  describe('triggerBuild - Invalid Responses', () => {
    it('should handle malformed JSON responses', async () => {
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockResolvedValue({
        data: null, // Invalid response
      });

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      await expect(triggerPromise).rejects.toThrow();
      jest.useRealTimers();
    });

    it('should handle missing lastBuild in response', async () => {
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockResolvedValue({
        data: {}, // Missing lastBuild
      });

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      await expect(triggerPromise).rejects.toThrow('No build number returned from Jenkins');
      jest.useRealTimers();
    });

    it('should handle error when getting build number', async () => {
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockRejectedValue(new Error('Failed to get build number'));

      jest.useFakeTimers();
      const triggerPromise = provider.triggerBuild();
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      await expect(triggerPromise).rejects.toThrow('Failed to trigger Jenkins build');
      jest.useRealTimers();
    });
  });

  describe('getBuildStatus - Failure Scenarios', () => {
    it('should handle network errors when getting build status', async () => {
      const error: any = new Error('Network error');
      error.code = 'ECONNREFUSED';
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(provider.getBuildStatus('42')).rejects.toThrow('Failed to get build status');
    });

    it('should handle 404 when build does not exist', async () => {
      const error: any = new Error('Not Found');
      error.response = { status: 404, statusText: 'Not Found' };
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(provider.getBuildStatus('999')).rejects.toThrow('Failed to get build status');
    });

    it('should handle malformed build status response', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: null, // Invalid response
      });

      await expect(provider.getBuildStatus('42')).rejects.toThrow();
    });
  });

  describe('streamLogs - Failure Scenarios', () => {
    it('should handle log streaming errors after max retries', async () => {
      // Mock to fail all requests (will retry 5 times then throw)
      const streamError = new Error('Stream error');
      mockAxiosInstance.get.mockRejectedValue(streamError);

      const onLogChunk = jest.fn();
      
      // Use real timers since we're testing retry logic
      await expect(
        provider.streamLogs('42', onLogChunk)
      ).rejects.toThrow('Failed to stream logs after 5 attempts');
    }, 20000);

    it('should handle timeout during log streaming', async () => {
      const timeoutError: any = new Error('timeout');
      timeoutError.code = 'ECONNABORTED';
      // Mock to fail all requests
      mockAxiosInstance.get.mockRejectedValue(timeoutError);

      const onLogChunk = jest.fn();
      
      // Use real timers since we're testing retry logic
      await expect(
        provider.streamLogs('42', onLogChunk)
      ).rejects.toThrow('Failed to stream logs after 5 attempts');
    }, 20000);

    it('should handle missing headers in log response', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: 'some logs',
        headers: {}, // Missing x-more-data and x-text-size
      });

      const onLogChunk = jest.fn();
      
      jest.useFakeTimers();
      const streamPromise = provider.streamLogs('42', onLogChunk);
      await Promise.resolve();
      await streamPromise;
      jest.useRealTimers();

      expect(onLogChunk).toHaveBeenCalled();
    }, 10000);
  });

  // Note: getAllStages method doesn't exist in JenkinsProvider
  // These tests would apply if the method is added in the future

  describe('getCurrentStage - Failure Scenarios', () => {
    it('should handle network errors gracefully', async () => {
      const error: any = new Error('Network error');
      error.code = 'ECONNREFUSED';
      mockAxiosInstance.get.mockRejectedValue(error);

      const stage = await provider.getCurrentStage('42');
      expect(stage).toBeNull();
    });

    it('should handle timeout errors gracefully', async () => {
      const error: any = new Error('timeout');
      error.code = 'ECONNABORTED';
      mockAxiosInstance.get.mockRejectedValue(error);

      const stage = await provider.getCurrentStage('42');
      expect(stage).toBeNull();
    });
  });

  describe('getCompleteLogs - Failure Scenarios', () => {
    it('should handle network errors when getting complete logs', async () => {
      const error: any = new Error('Network error');
      error.code = 'ECONNREFUSED';
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(provider.getCompleteLogs('42')).rejects.toThrow();
    });

    it('should handle 404 when build logs not found', async () => {
      const error: any = new Error('Not Found');
      error.response = { status: 404 };
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(provider.getCompleteLogs('999')).rejects.toThrow();
    });
  });
});

