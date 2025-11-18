"use strict";
/**
 * Port Kafka Self-Service Actions Consumer with CI/CD Integration
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const kafkajs_1 = require("kafkajs");
const shared_1 = require("@cicd/shared");
const build_handler_1 = require("./handlers/build-handler");
const axios_1 = __importDefault(require("axios"));
class PortKafkaConsumer {
    config;
    portApiUrl;
    accessToken;
    tokenExpiry;
    kafka;
    consumer;
    actionsTopic;
    isConnected;
    isShuttingDown;
    constructor(config) {
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
        this.kafka = new kafkajs_1.Kafka({
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
    validateConfig() {
        const errors = [];
        if (!this.config.portClientId)
            errors.push('PORT_CLIENT_ID is required');
        if (!this.config.portClientSecret)
            errors.push('PORT_CLIENT_SECRET is required');
        if (!this.config.orgId)
            errors.push('PORT_ORG_ID is required');
        if (!this.config.kafkaBrokers || this.config.kafkaBrokers.length === 0) {
            errors.push('KAFKA_BROKERS is required');
        }
        if (!this.config.kafkaUsername)
            errors.push('KAFKA_USERNAME is required');
        if (!this.config.kafkaPassword)
            errors.push('KAFKA_PASSWORD is required');
        if (!this.config.consumerGroupId)
            errors.push('KAFKA_CONSUMER_GROUP_ID is required');
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
        shared_1.logger.info('✅ Configuration validation passed');
    }
    setupKafkaErrorHandlers() {
        this.consumer.on(this.consumer.events.CRASH, (event) => {
            shared_1.logger.error('Consumer crashed:', event.payload?.error || event);
            if (!this.isShuttingDown) {
                shared_1.logger.info('Attempting to reconnect...');
                this.reconnect();
            }
        });
        this.consumer.on(this.consumer.events.DISCONNECT, () => {
            shared_1.logger.warn('Consumer disconnected');
            this.isConnected = false;
        });
        this.consumer.on(this.consumer.events.CONNECT, () => {
            shared_1.logger.info('Consumer connected');
            this.isConnected = true;
        });
    }
    async reconnect(retries = 5, delay = 5000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                shared_1.logger.info(`Reconnection attempt ${attempt}/${retries}...`);
                await this.consumer.disconnect();
                await new Promise(resolve => setTimeout(resolve, delay));
                await this.start();
                shared_1.logger.info('Reconnection successful');
                return;
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                shared_1.logger.error(`Reconnection attempt ${attempt} failed: ${errorMsg}`);
                if (attempt === retries) {
                    shared_1.logger.error('Max reconnection attempts reached, exiting...');
                    process.exit(1);
                }
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }
    async getAccessToken() {
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }
        shared_1.logger.info('🔑 Fetching new Port API access token...');
        try {
            const response = await axios_1.default.post(`${this.portApiUrl}/auth/access_token`, {
                clientId: this.config.portClientId,
                clientSecret: this.config.portClientSecret,
            });
            this.accessToken = response.data.accessToken;
            this.tokenExpiry = Date.now() + (55 * 60 * 1000);
            shared_1.logger.info('✅ Access token obtained');
            return this.accessToken;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            shared_1.logger.error('❌ Failed to get access token:', errorMsg);
            throw error;
        }
    }
    async updateActionRun(runId, updates) {
        const token = await this.getAccessToken();
        try {
            const response = await axios_1.default.patch(`${this.portApiUrl}/actions/runs/${runId}`, updates, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            shared_1.logger.info(`✅ Updated action run ${runId}: ${updates.status || 'IN_PROGRESS'}`);
            return response.data;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            shared_1.logger.error(`❌ Failed to update action run ${runId}: ${errorMsg}`);
            throw error;
        }
    }
    async addActionRunLog(runId, message, terminationStatus, statusLabel) {
        const token = await this.getAccessToken();
        const body = { message };
        if (terminationStatus)
            body.terminationStatus = terminationStatus;
        if (statusLabel)
            body.statusLabel = statusLabel;
        try {
            const response = await axios_1.default.post(`${this.portApiUrl}/actions/runs/${runId}/logs`, body, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            shared_1.logger.debug(`📝 Added log to action run ${runId}`);
            return response.data;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            shared_1.logger.error(`❌ Failed to add log to action run ${runId}: ${errorMsg}`);
            throw error;
        }
    }
    async processActionMessage(message) {
        shared_1.logger.info('\n' + '='.repeat(80));
        shared_1.logger.info('📨 Processing Action Invocation');
        shared_1.logger.info('='.repeat(80));
        const runId = message.context.runId;
        const action = message.action;
        const properties = message.properties;
        shared_1.logger.info(`
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
                await (0, build_handler_1.handleBuildAction)(message, this);
            }
            else {
                shared_1.logger.warn(`⚠️  No specific handler for action: ${action.identifier}`);
                await this.addActionRunLog(runId, `Received action: ${action.identifier}`);
            }
            await this.addActionRunLog(runId, 'Action completed successfully', 'SUCCESS', 'Completed');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            shared_1.logger.error('❌ Error processing action:', errorMsg);
            await this.addActionRunLog(runId, `Action failed: ${errorMsg}`, 'FAILURE', 'Failed');
        }
    }
    initializeProviders() {
        shared_1.logger.info('\n🔌 Initializing CI/CD Providers...');
        // Register Jenkins if configured
        if (process.env.JENKINS_URL && process.env.JENKINS_API_TOKEN) {
            try {
                shared_1.pluginRegistry.register(shared_1.JenkinsProvider, {
                    jenkinsUrl: process.env.JENKINS_URL,
                    username: process.env.JENKINS_USERNAME || '',
                    apiToken: process.env.JENKINS_API_TOKEN,
                    jobName: process.env.JENKINS_JOB_NAME || '',
                });
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                shared_1.logger.error(`Failed to register Jenkins: ${errorMsg}`);
            }
        }
        // Register CircleCI if configured
        if (process.env.CIRCLECI_API_TOKEN && process.env.CIRCLECI_PROJECT_SLUG) {
            try {
                shared_1.pluginRegistry.register(shared_1.CircleCIProvider, {
                    apiToken: process.env.CIRCLECI_API_TOKEN,
                    projectSlug: process.env.CIRCLECI_PROJECT_SLUG,
                    webhookSecret: process.env.CIRCLECI_WEBHOOK_SECRET,
                });
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                shared_1.logger.error(`Failed to register CircleCI: ${errorMsg}`);
            }
        }
        shared_1.logger.info(`✅ Registered providers: ${shared_1.pluginRegistry.getProviderNames().join(', ')}`);
    }
    async start() {
        if (this.isShuttingDown) {
            shared_1.logger.warn('Consumer is shutting down, cannot start');
            return;
        }
        shared_1.logger.info('\n' + '🚀 Port Kafka Consumer Starting'.padEnd(80, '='));
        shared_1.logger.info('='.repeat(80));
        shared_1.logger.info(`
📊 Configuration:
   - Organization ID: ${this.config.orgId}
   - Actions Topic: ${this.actionsTopic}
   - Consumer Group: ${this.config.consumerGroupId}
   - Kafka Brokers: ${this.config.kafkaBrokers.join(', ')}
    `);
        // Initialize CI/CD providers
        this.initializeProviders();
        try {
            shared_1.logger.info('🔌 Connecting to Kafka...');
            await this.consumer.connect();
            this.isConnected = true;
            shared_1.logger.info('✅ Connected to Kafka');
            shared_1.logger.info(`📡 Subscribing to topic: ${this.actionsTopic}`);
            await this.consumer.subscribe({
                topic: this.actionsTopic,
                fromBeginning: false,
            });
            shared_1.logger.info('✅ Subscribed to actions topic');
            shared_1.logger.info('\n' + '='.repeat(80));
            shared_1.logger.info('✅ Consumer Ready - Waiting for messages...');
            shared_1.logger.info('='.repeat(80) + '\n');
            await this.consumer.run({
                eachMessage: async ({ topic, partition, message }) => {
                    try {
                        const value = message.value?.toString();
                        if (!value)
                            return;
                        const parsedMessage = JSON.parse(value);
                        await this.processActionMessage(parsedMessage);
                    }
                    catch (error) {
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        shared_1.logger.error('❌ Error processing message:', errorMsg);
                    }
                },
            });
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            shared_1.logger.error('❌ Failed to start consumer:', errorMsg);
            this.isConnected = false;
            throw error;
        }
    }
    async shutdown() {
        this.isShuttingDown = true;
        shared_1.logger.info('\n🛑 Shutting down consumer...');
        try {
            if (this.isConnected) {
                await this.consumer.disconnect();
                this.isConnected = false;
            }
            shared_1.logger.info('✅ Consumer disconnected');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            shared_1.logger.error('Error during shutdown:', errorMsg);
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
        }
        catch (error) {
            shared_1.logger.error('Error during shutdown:', error);
            process.exit(1);
        }
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('uncaughtException', (error) => {
        shared_1.logger.error('Uncaught exception:', error);
        shutdown();
    });
    process.on('unhandledRejection', (reason) => {
        shared_1.logger.error('Unhandled rejection:', reason);
        shutdown();
    });
    consumer.start().catch((error) => {
        shared_1.logger.error('Fatal error:', error);
        process.exit(1);
    });
}
exports.default = PortKafkaConsumer;
//# sourceMappingURL=consumer.js.map