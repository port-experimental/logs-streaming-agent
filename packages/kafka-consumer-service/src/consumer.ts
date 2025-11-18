/**
 * Port Kafka Self-Service Actions Consumer with CI/CD Integration
 */

import dotenv from 'dotenv';
import path from 'path';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';

// Load .env from monorepo root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { logger, pluginRegistry, JenkinsProvider, CircleCIProvider } from '@cicd/shared';
import { handleBuildAction } from './handlers/build-handler';
import axios from 'axios';

interface PortConfig {
  portClientId: string;
  portClientSecret: string;
  orgId: string;
  kafkaBrokers: string[];
  kafkaUsername: string;
  kafkaPassword: string;
  consumerGroupId: string;
}

class PortKafkaConsumer {
  private config: PortConfig;
  private portApiUrl: string;
  private accessToken: string | null;
  private tokenExpiry: number | null;
  private kafka: Kafka;
  private consumer: Consumer;
  private actionsTopic: string;
  private isConnected: boolean;
  private isShuttingDown: boolean;

  constructor(config: Partial<PortConfig>) {
    this.config = {
      portClientId: config.portClientId || process.env.PORT_CLIENT_ID || '',
      portClientSecret: config.portClientSecret || process.env.PORT_CLIENT_SECRET || '',
      orgId: config.orgId || process.env.PORT_ORG_ID || '',
      kafkaBrokers: config.kafkaBrokers || process.env.KAFKA_BROKERS?.split(',') || [],
      kafkaUsername: config.kafkaUsername || process.env.KAFKA_USERNAME || '',
      kafkaPassword: config.kafkaPassword || process.env.KAFKA_PASSWORD || '',
      consumerGroupId: config.consumerGroupId || process.env.KAFKA_CONSUMER_GROUP_ID || '',
    };

    this.validateConfig();

    this.portApiUrl = 'https://api.getport.io/v1';
    this.accessToken = null;
    this.tokenExpiry = null;

    // Initialize Kafka client
    this.kafka = new Kafka({
      clientId: `port-consumer-${this.config.orgId}`,
      brokers: this.config.kafkaBrokers,
      ssl: true,
      sasl: {
        mechanism: 'scram-sha-512',
        username: this.config.kafkaUsername,
        password: this.config.kafkaPassword,
      },
      retry: {
        initialRetryTime: 1000,
        retries: 8,
        maxRetryTime: 30000,
        multiplier: 2,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    this.consumer = this.kafka.consumer({ 
      groupId: this.config.consumerGroupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      retry: {
        retries: 5,
      },
    });

    this.actionsTopic = `${this.config.orgId}.runs`;
    this.isConnected = false;
    this.isShuttingDown = false;

    this.setupKafkaErrorHandlers();
  }

  private validateConfig(): void {
    const errors: string[] = [];

    if (!this.config.portClientId) errors.push('PORT_CLIENT_ID is required');
    if (!this.config.portClientSecret) errors.push('PORT_CLIENT_SECRET is required');
    if (!this.config.orgId) errors.push('PORT_ORG_ID is required');
    if (!this.config.kafkaBrokers || this.config.kafkaBrokers.length === 0) {
      errors.push('KAFKA_BROKERS is required');
    }
    if (!this.config.kafkaUsername) errors.push('KAFKA_USERNAME is required');
    if (!this.config.kafkaPassword) errors.push('KAFKA_PASSWORD is required');
    if (!this.config.consumerGroupId) errors.push('KAFKA_CONSUMER_GROUP_ID is required');

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }

    logger.info('✅ Configuration validation passed');
  }

  private setupKafkaErrorHandlers(): void {
    this.consumer.on(this.consumer.events.CRASH, (event: any) => {
      logger.error('Consumer crashed:', event.payload?.error || event);
      if (!this.isShuttingDown) {
        logger.info('Attempting to reconnect...');
        this.reconnect();
      }
    });

    this.consumer.on(this.consumer.events.DISCONNECT, () => {
      logger.warn('Consumer disconnected');
      this.isConnected = false;
    });

    this.consumer.on(this.consumer.events.CONNECT, () => {
      logger.info('Consumer connected');
      this.isConnected = true;
    });
  }

  private async reconnect(retries = 5, delay = 5000): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.info(`Reconnection attempt ${attempt}/${retries}...`);
        await this.consumer.disconnect();
        await new Promise(resolve => setTimeout(resolve, delay));
        await this.start();
        logger.info('Reconnection successful');
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Reconnection attempt ${attempt} failed: ${errorMsg}`);
        if (attempt === retries) {
          logger.error('Max reconnection attempts reached, exiting...');
          process.exit(1);
        }
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    logger.info('🔑 Fetching new Port API access token...');
    
    try {
      const response = await axios.post(`${this.portApiUrl}/auth/access_token`, {
        clientId: this.config.portClientId,
        clientSecret: this.config.portClientSecret,
      });

      this.accessToken = response.data.accessToken;
      this.tokenExpiry = Date.now() + (55 * 60 * 1000);
      
      logger.info('✅ Access token obtained');
      return this.accessToken!;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('❌ Failed to get access token:', errorMsg);
      throw error;
    }
  }

  async updateActionRun(runId: string, updates: any): Promise<any> {
    const token = await this.getAccessToken();
    
    try {
      const response = await axios.patch(
        `${this.portApiUrl}/actions/runs/${runId}`,
        updates,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info(`✅ Updated action run ${runId}: ${updates.status || 'IN_PROGRESS'}`);
      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Failed to update action run ${runId}: ${errorMsg}`);
      throw error;
    }
  }

  async addActionRunLog(runId: string, message: string, terminationStatus?: string, statusLabel?: string): Promise<any> {
    const token = await this.getAccessToken();
    
    const body: any = { message };
    if (terminationStatus) body.terminationStatus = terminationStatus;
    if (statusLabel) body.statusLabel = statusLabel;

    try {
      const response = await axios.post(
        `${this.portApiUrl}/actions/runs/${runId}/logs`,
        body,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.debug(`📝 Added log to action run ${runId}`);
      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Failed to add log to action run ${runId}: ${errorMsg}`);
      throw error;
    }
  }

  private async processActionMessage(message: any): Promise<void> {
    logger.info('\n' + '='.repeat(80));
    logger.info('📨 Processing Action Invocation');
    logger.info('='.repeat(80));

    const runId = message.context.runId;
    const action = message.action;
    const properties = message.properties;

    logger.info(`
      🔹 Run ID: ${runId}
      🔹 Action: ${action.identifier}
      🔹 User: ${message.context.by.email}
      🔹 Properties: ${JSON.stringify(properties, null, 2)}
    `);

    try {
      await this.updateActionRun(runId, {
        statusLabel: 'Processing action...',
      });

      await this.addActionRunLog(runId, `Started processing action: ${action.identifier}`);

      // Route to appropriate handler
      if (action.identifier.includes('build') || action.identifier.includes('deploy')) {
        await handleBuildAction(message, this);
      } else {
        logger.warn(`⚠️  No specific handler for action: ${action.identifier}`);
        await this.addActionRunLog(runId, `Received action: ${action.identifier}`);
      }

      await this.addActionRunLog(
        runId,
        'Action completed successfully',
        'SUCCESS',
        'Completed'
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error processing action:', errorMsg);
      
      await this.addActionRunLog(
        runId,
        `Action failed: ${errorMsg}`,
        'FAILURE',
        'Failed'
      );
    }
  }

  private initializeProviders(): void {
    logger.info('\n🔌 Initializing CI/CD Providers...');
    
    // Register Jenkins if configured
    if (process.env.JENKINS_URL && process.env.JENKINS_API_TOKEN) {
      try {
        pluginRegistry.register(JenkinsProvider, {
          jenkinsUrl: process.env.JENKINS_URL,
          username: process.env.JENKINS_USERNAME || '',
          apiToken: process.env.JENKINS_API_TOKEN,
          jobName: process.env.JENKINS_JOB_NAME || '',
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to register Jenkins: ${errorMsg}`);
      }
    }
    
    // Register CircleCI if configured
    if (process.env.CIRCLECI_API_TOKEN && process.env.CIRCLECI_PROJECT_SLUG) {
      try {
        pluginRegistry.register(CircleCIProvider, {
          apiToken: process.env.CIRCLECI_API_TOKEN,
          projectSlug: process.env.CIRCLECI_PROJECT_SLUG,
          webhookSecret: process.env.CIRCLECI_WEBHOOK_SECRET,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to register CircleCI: ${errorMsg}`);
      }
    }
    
    logger.info(`✅ Registered providers: ${pluginRegistry.getProviderNames().join(', ')}`);
  }

  async start(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Consumer is shutting down, cannot start');
      return;
    }

    logger.info('\n' + '🚀 Port Kafka Consumer Starting'.padEnd(80, '='));
    logger.info('='.repeat(80));
    logger.info(`
📊 Configuration:
   - Organization ID: ${this.config.orgId}
   - Actions Topic: ${this.actionsTopic}
   - Consumer Group: ${this.config.consumerGroupId}
   - Kafka Brokers: ${this.config.kafkaBrokers.join(', ')}
    `);

    // Initialize CI/CD providers
    this.initializeProviders();

    try {
      logger.info('🔌 Connecting to Kafka...');
      await this.consumer.connect();
      this.isConnected = true;
      logger.info('✅ Connected to Kafka');

      logger.info(`📡 Subscribing to topic: ${this.actionsTopic}`);
      await this.consumer.subscribe({ 
        topic: this.actionsTopic,
        fromBeginning: false,
      });
      logger.info('✅ Subscribed to actions topic');

      logger.info('\n' + '='.repeat(80));
      logger.info('✅ Consumer Ready - Waiting for messages...');
      logger.info('='.repeat(80) + '\n');

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
          try {
            const value = message.value?.toString();
            if (!value) return;
            
            const parsedMessage = JSON.parse(value);
            await this.processActionMessage(parsedMessage);

          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error processing message:', errorMsg);
          }
        },
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('❌ Failed to start consumer:', errorMsg);
      this.isConnected = false;
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('\n🛑 Shutting down consumer...');
    
    try {
      if (this.isConnected) {
        await this.consumer.disconnect();
        this.isConnected = false;
      }
      logger.info('✅ Consumer disconnected');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error during shutdown:', errorMsg);
      throw error;
    }
  }
}

// Main execution
if (require.main === module) {
  const consumer = new PortKafkaConsumer({});

  const shutdown = async () => {
    try {
      await consumer.shutdown();
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception:', error);
    shutdown();
  });

  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled rejection:', reason);
    shutdown();
  });

  consumer.start().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export default PortKafkaConsumer;
