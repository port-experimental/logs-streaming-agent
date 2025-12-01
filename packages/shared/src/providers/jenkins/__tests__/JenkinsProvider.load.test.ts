/**
 * Jenkins Provider Load Tests
 * Tests for concurrent requests, performance, and load handling
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

describe('JenkinsProvider - Load Tests', () => {
  const mockConfig = {
    jenkinsUrl: 'http://jenkins.example.com',
    username: 'testuser',
    apiToken: 'test-token',
    jobName: 'test-job',
  };

  let provider: JenkinsProvider;
  let mockAxiosInstance: any;

  beforeEach(() => {
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

  describe('Concurrent Build Triggers', () => {
    it('should handle concurrent build triggers', async () => {
      const concurrentRequests = 10;
      
      // Mock successful responses
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockResolvedValue({
        data: { lastBuild: { number: 42 } },
      });

      jest.useFakeTimers();
      
      const promises = Array(concurrentRequests).fill(null).map((_, i) => 
        provider.triggerBuild({ TEST_PARAM: `value-${i}` })
      );

      // Advance timers for all requests
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      const results = await Promise.allSettled(promises);
      jest.useRealTimers();

      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBe(concurrentRequests);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(concurrentRequests);
    }, 30000);

    it('should handle rapid sequential build triggers', async () => {
      let buildNumber = 42;
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockImplementation(() => {
        buildNumber++;
        return Promise.resolve({
          data: { lastBuild: { number: buildNumber } },
        });
      });

      jest.useFakeTimers();
      
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 20; i++) {
        const promise = provider.triggerBuild();
        promises.push(promise);
        await Promise.resolve();
        jest.advanceTimersByTime(100); // Small delay between requests
      }

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      const results = await Promise.allSettled(promises);
      jest.useRealTimers();

      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBe(20);
    }, 30000);
  });

  describe('Rapid Status Polling', () => {
    it('should handle rapid status polling', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          number: 42,
          building: false,
          result: 'SUCCESS',
          duration: 10000,
          timestamp: Date.now(),
        },
      });

      const pollCount = 50;
      const startTime = Date.now();
      
      const promises = Array(pollCount).fill(null).map(() =>
        provider.getBuildStatus('42')
      );

      await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      // Should complete quickly (all mocked, so should be < 1s)
      expect(duration).toBeLessThan(1000);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(pollCount);
    });

    it('should handle concurrent status checks', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          number: 42,
          building: true,
          result: null,
          duration: 5000,
          timestamp: Date.now(),
        },
      });

      const concurrentChecks = 30;
      const promises = Array(concurrentChecks).fill(null).map(() =>
        provider.getBuildStatus('42')
      );

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(concurrentChecks);
      results.forEach(result => {
        expect(result.buildId).toBe('42');
        expect(result.building).toBe(true);
      });
    });
  });

  describe('Concurrent Log Streaming', () => {
    it('should handle multiple concurrent log streams', async () => {
      const streamCount = 5;
      const onLogChunk = jest.fn();
      
      // Mock log streaming responses
      let callCount = 0;
      mockAxiosInstance.get.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          data: `log chunk ${callCount}\n`,
          headers: { 'x-more-data': callCount < streamCount ? 'true' : 'false', 'x-text-size': `${callCount * 10}` },
        });
      });

      jest.useFakeTimers();
      
      const promises = Array(streamCount).fill(null).map((_, i) =>
        provider.streamLogs(`${i}`, onLogChunk)
      );

      // Advance timers for streaming
      await Promise.resolve();
      for (let i = 0; i < streamCount; i++) {
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
      }

      await Promise.allSettled(promises);
      jest.useRealTimers();

      // Verify all streams were called
      expect(mockAxiosInstance.get).toHaveBeenCalled();
    }, 30000);
  });

  describe('Stage Polling Performance', () => {
    it('should handle rapid stage polling with getCurrentStage', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          stages: [
            { name: 'Build', status: 'SUCCESS', durationMillis: 5000 },
            { name: 'Deploy', status: 'IN_PROGRESS', durationMillis: 2000 },
          ],
        },
      });

      const pollCount = 100;
      const startTime = Date.now();
      
      const promises = Array(pollCount).fill(null).map(() =>
        provider.getCurrentStage('42')
      );

      await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      // Should complete quickly
      expect(duration).toBeLessThan(2000);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(pollCount);
    });

    it('should handle concurrent stage checks', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          stages: [
            { name: 'Build', status: 'SUCCESS', durationMillis: 5000 },
          ],
        },
      });

      const concurrentChecks = 25;
      const promises = Array(concurrentChecks).fill(null).map(() =>
        provider.getCurrentStage('42')
      );

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(concurrentChecks);
      results.forEach(result => {
        expect(result).not.toBeNull();
        expect(result?.name).toBe('Build');
      });
    });
  });

  describe('Mixed Load Scenarios', () => {
    it('should handle mixed concurrent operations', async () => {
      mockAxiosInstance.post.mockResolvedValue({});
      mockAxiosInstance.get.mockImplementation((url: string) => {
        if (url.includes('api/json')) {
          return Promise.resolve({
            data: { lastBuild: { number: 42 } },
          });
        }
        if (url.includes('wfapi/describe')) {
          return Promise.resolve({
            data: {
              stages: [
                { name: 'Build', status: 'SUCCESS', durationMillis: 5000 },
              ],
            },
          });
        }
        return Promise.resolve({
          data: {
            number: 42,
            building: false,
            result: 'SUCCESS',
            duration: 10000,
            timestamp: Date.now(),
          },
        });
      });

      jest.useFakeTimers();

      // Mix of operations
      const operations = [
        provider.triggerBuild(),
        provider.getBuildStatus('42'),
        provider.getCurrentStage('42'),
        provider.getCurrentStage('42'),
        provider.triggerBuild({ PARAM: 'value' }),
      ];

      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      const results = await Promise.allSettled(operations);
      jest.useRealTimers();

      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBe(operations.length);
    }, 30000);
  });
});

