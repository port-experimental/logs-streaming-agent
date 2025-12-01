/**
 * Consumer Failure Scenario Tests
 * Tests for error handling, connection failures, and edge cases
 */

import PortKafkaConsumer from '../consumer';
import { Kafka } from 'kafkajs';
import axios from 'axios';

// Mock kafkajs
jest.mock('kafkajs');
const MockedKafka = Kafka as jest.MockedClass<typeof Kafka>;

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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

describe('PortKafkaConsumer - Failure Scenarios', () => {
  const mockConfig = {
    portClientId: 'test-client-id',
    portClientSecret: 'test-secret',
    orgId: 'test-org',
    kafkaBrokers: ['broker1:9092', 'broker2:9092'],
    kafkaUsername: 'test-user',
    kafkaPassword: 'test-password',
    consumerGroupId: 'test-group',
  };

  let mockConsumer: any;
  let mockKafkaInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Kafka consumer with events property
    mockConsumer = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      subscribe: jest.fn(),
      run: jest.fn(),
      on: jest.fn(),
      events: {
        CRASH: 'consumer.crash',
        DISCONNECT: 'consumer.disconnect',
        CONNECT: 'consumer.connect',
      },
    };

    mockKafkaInstance = {
      consumer: jest.fn(() => mockConsumer),
    };

    MockedKafka.mockImplementation(() => mockKafkaInstance as any);
  });

  describe('Configuration Validation', () => {
    // Save original env vars
    const originalEnv = {
      PORT_CLIENT_ID: process.env.PORT_CLIENT_ID,
      PORT_CLIENT_SECRET: process.env.PORT_CLIENT_SECRET,
      PORT_ORG_ID: process.env.PORT_ORG_ID,
      KAFKA_BROKERS: process.env.KAFKA_BROKERS,
      KAFKA_USERNAME: process.env.KAFKA_USERNAME,
      KAFKA_PASSWORD: process.env.KAFKA_PASSWORD,
      KAFKA_CONSUMER_GROUP_ID: process.env.KAFKA_CONSUMER_GROUP_ID,
    };

    beforeEach(() => {
      // Clear env vars for validation tests
      delete process.env.PORT_CLIENT_ID;
      delete process.env.PORT_CLIENT_SECRET;
      delete process.env.PORT_ORG_ID;
      delete process.env.KAFKA_BROKERS;
      delete process.env.KAFKA_USERNAME;
      delete process.env.KAFKA_PASSWORD;
      delete process.env.KAFKA_CONSUMER_GROUP_ID;
    });

    afterEach(() => {
      // Restore env vars
      Object.assign(process.env, originalEnv);
    });

    it('should throw error if PORT_CLIENT_ID is missing', () => {
      expect(() => {
        new PortKafkaConsumer({
          ...mockConfig,
          portClientId: '',
        });
      }).toThrow('PORT_CLIENT_ID is required');
    });

    it('should throw error if PORT_CLIENT_SECRET is missing', () => {
      expect(() => {
        new PortKafkaConsumer({
          ...mockConfig,
          portClientSecret: '',
        });
      }).toThrow('PORT_CLIENT_SECRET is required');
    });

    it('should throw error if PORT_ORG_ID is missing', () => {
      expect(() => {
        new PortKafkaConsumer({
          ...mockConfig,
          orgId: '',
        });
      }).toThrow('PORT_ORG_ID is required');
    });

    it('should throw error if KAFKA_BROKERS is missing', () => {
      expect(() => {
        new PortKafkaConsumer({
          ...mockConfig,
          kafkaBrokers: [],
        });
      }).toThrow('KAFKA_BROKERS is required');
    });

    it('should throw error if KAFKA_USERNAME is missing', () => {
      expect(() => {
        new PortKafkaConsumer({
          ...mockConfig,
          kafkaUsername: '',
        });
      }).toThrow('KAFKA_USERNAME is required');
    });

    it('should throw error if KAFKA_PASSWORD is missing', () => {
      expect(() => {
        new PortKafkaConsumer({
          ...mockConfig,
          kafkaPassword: '',
        });
      }).toThrow('KAFKA_PASSWORD is required');
    });
  });

  describe('Kafka Connection Failures', () => {
    it('should handle Kafka connection failures', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      mockConsumer.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(consumer.start()).rejects.toThrow('Connection failed');
    });

    it('should handle Kafka connection timeout', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      const timeoutError: any = new Error('Connection timeout');
      timeoutError.code = 'ETIMEDOUT';
      mockConsumer.connect.mockRejectedValue(timeoutError);

      await expect(consumer.start()).rejects.toThrow();
    });

    it('should handle subscription failures', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      mockConsumer.connect.mockResolvedValue(undefined);
      mockConsumer.subscribe.mockRejectedValue(new Error('Subscription failed'));

      await expect(consumer.start()).rejects.toThrow('Subscription failed');
    });
  });

  describe('Port API Failures', () => {
    it('should handle Port API token refresh failures', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      mockedAxios.post.mockRejectedValue(new Error('Auth failed'));

      await expect(consumer.getAccessToken()).rejects.toThrow();
    });

    it('should handle 401 Unauthorized from Port API', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      const error: any = new Error('Unauthorized');
      error.response = { status: 401, data: { message: 'Invalid credentials' } };
      mockedAxios.post.mockRejectedValue(error);

      await expect(consumer.getAccessToken()).rejects.toThrow();
    });

    it('should handle network errors when updating action run', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      
      // Mock successful token
      mockedAxios.post.mockResolvedValueOnce({
        data: { accessToken: 'test-token' },
      });

      // Mock failure on update
      const error: any = new Error('Network error');
      error.code = 'ECONNREFUSED';
      mockedAxios.patch = jest.fn().mockRejectedValue(error);

      await expect(
        consumer.updateActionRun('run-123', { status: 'SUCCESS' })
      ).rejects.toThrow();
    });

    it('should handle 429 Too Many Requests from Port API', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      
      mockedAxios.post.mockResolvedValueOnce({
        data: { accessToken: 'test-token' },
      });

      const error: any = new Error('Too Many Requests');
      error.response = { status: 429, data: { message: 'Rate limit exceeded' } };
      mockedAxios.patch = jest.fn().mockRejectedValue(error);

      await expect(
        consumer.updateActionRun('run-123', { status: 'SUCCESS' })
      ).rejects.toThrow();
    });
  });

  describe('Message Processing Failures', () => {
    it('should handle invalid JSON in Kafka message', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      mockConsumer.connect.mockResolvedValue(undefined);
      mockConsumer.subscribe.mockResolvedValue(undefined);
      
      // Mock run to process invalid message
      mockConsumer.run.mockImplementation(({ eachMessage }: any) => {
        const invalidMessage = {
          value: Buffer.from('invalid json'),
        };
        return eachMessage({
          topic: 'test.runs',
          partition: 0,
          message: invalidMessage,
        });
      });

      // Should not throw - invalid messages should be handled gracefully
      await consumer.start();
      
      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should handle missing required fields in message', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      mockConsumer.connect.mockResolvedValue(undefined);
      mockConsumer.subscribe.mockResolvedValue(undefined);
      
      mockConsumer.run.mockImplementation(({ eachMessage }: any) => {
        const invalidMessage = {
          value: Buffer.from(JSON.stringify({
            // Missing context.runId
            action: { identifier: 'test' },
          })),
        };
        return eachMessage({
          topic: 'test.runs',
          partition: 0,
          message: invalidMessage,
        });
      });

      // Should handle gracefully
      await consumer.start();
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('Reconnection Failures', () => {
    it('should handle reconnection failures after max retries', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      const originalExit = process.exit;
      const exitSpy = jest.fn() as any;
      process.exit = exitSpy;

      // Mock multiple reconnection failures
      mockConsumer.disconnect.mockResolvedValue(undefined);
      mockConsumer.connect.mockRejectedValue(new Error('Connection failed'));

      // Trigger reconnection
      const reconnectPromise = (consumer as any).reconnect(2, 100);
      
      // Wait for reconnection attempts
      await new Promise(resolve => setTimeout(resolve, 500));

      // Restore process.exit
      process.exit = originalExit;

      // Note: This test verifies the reconnection logic exists
      // Actual exit behavior is hard to test without affecting test runner
      expect(mockConsumer.disconnect).toHaveBeenCalled();
    });
  });

  describe('Shutdown Failures', () => {
    it('should handle errors during graceful shutdown', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      // Mark as connected so shutdown will attempt disconnect
      (consumer as any).isConnected = true;
      mockConsumer.disconnect.mockRejectedValue(new Error('Disconnect failed'));

      await expect(consumer.shutdown()).rejects.toThrow('Disconnect failed');
    });

    it('should not start if already shutting down', async () => {
      const consumer = new PortKafkaConsumer(mockConfig);
      (consumer as any).isShuttingDown = true;

      // Should return early without attempting connection
      await consumer.start();
      expect(mockConsumer.connect).not.toHaveBeenCalled();
    });
  });
});

