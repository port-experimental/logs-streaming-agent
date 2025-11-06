/**
 * Port Kafka Self-Service Actions Consumer
 * 
 * This POC demonstrates how to consume action invocations from Port's Kafka topic
 * and report status back to Port.
 */

const { Kafka } = require('kafkajs');
const axios = require('axios');
require('dotenv').config();

class PortKafkaConsumer {
  constructor(config) {
    this.config = {
      portClientId: config.portClientId || process.env.PORT_CLIENT_ID,
      portClientSecret: config.portClientSecret || process.env.PORT_CLIENT_SECRET,
      orgId: config.orgId || process.env.PORT_ORG_ID,
      kafkaBrokers: config.kafkaBrokers || process.env.KAFKA_BROKERS?.split(',') || [],
      kafkaUsername: config.kafkaUsername || process.env.KAFKA_USERNAME,
      kafkaPassword: config.kafkaPassword || process.env.KAFKA_PASSWORD,
      consumerGroupId: config.consumerGroupId || process.env.KAFKA_CONSUMER_GROUP_ID,
    };

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
    });

    this.consumer = this.kafka.consumer({ 
      groupId: this.config.consumerGroupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    // Topic names
    this.actionsTopic = `${this.config.orgId}.runs`;
    this.changesTopic = `${this.config.orgId}.change.log`;
  }

  /**
   * Get Port API access token
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    console.log('🔑 Fetching new Port API access token...');
    
    try {
      const response = await axios.post(`${this.portApiUrl}/auth/access_token`, {
        clientId: this.config.portClientId,
        clientSecret: this.config.portClientSecret,
      });

      this.accessToken = response.data.accessToken;
      // Token typically expires in 1 hour, refresh 5 minutes before
      this.tokenExpiry = Date.now() + (55 * 60 * 1000);
      
      console.log('✅ Access token obtained');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Failed to get access token:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update action run status in Port
   */
  async updateActionRun(runId, updates) {
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

      console.log(`✅ Updated action run ${runId}:`, updates.status || 'IN_PROGRESS');
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to update action run ${runId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Add log entry to action run
   */
  async addActionRunLog(runId, message, terminationStatus = null, statusLabel = null) {
    const token = await this.getAccessToken();
    
    const body = { message };
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

      console.log(`📝 Added log to action run ${runId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to add log to action run ${runId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create or update entity in Port
   */
  async upsertEntity(blueprintId, entityData, runId = null) {
    const token = await this.getAccessToken();
    
    const params = runId ? { run_id: runId } : {};

    try {
      const response = await axios.post(
        `${this.portApiUrl}/blueprints/${blueprintId}/entities`,
        entityData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          params,
        }
      );

      console.log(`✅ Created/Updated entity: ${entityData.identifier} in blueprint: ${blueprintId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to upsert entity:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Process action invocation message
   */
  async processActionMessage(message) {
    console.log('\n' + '='.repeat(80));
    console.log('📨 Processing Action Invocation');
    console.log('='.repeat(80));

    const runId = message.context.runId;
    const action = message.action;
    const properties = message.properties;
    const entity = message.entity;

    console.log(`
        🔹 Run ID: ${runId}
        🔹 Action: ${action.identifier}
        🔹 User: ${message.context.by.email}
        🔹 Properties: ${JSON.stringify(properties, null, 2)}
        🔹 Entity: ${entity ? JSON.stringify(entity, null, 2) : 'N/A'}
    `);

    try {
      // Update status to indicate processing started
      await this.updateActionRun(runId, {
        status: 'IN_PROGRESS',
        statusLabel: 'Processing action...',
      });

      await this.addActionRunLog(runId, `Started processing action: ${action.identifier}`);

      // Call the action handler
      await this.handleAction(message);

      // Mark as successful
      await this.addActionRunLog(
        runId,
        `Action completed successfully`,
        'SUCCESS',
        'Completed'
      );

    } catch (error) {
      console.error('❌ Error processing action:', error);
      
      // Report failure to Port
      await this.addActionRunLog(
        runId,
        `Action failed: ${error.message}`,
        'FAILURE',
        'Failed'
      );
    }
  }

  /**
   * Handle specific action logic
   * Override this method or use a strategy pattern for different actions
   */
  async handleAction(message) {
    const action = message.action;
    const properties = message.properties;
    const runId = message.context.runId;

    console.log('🔧 Executing action handler...');
    console.log('📋 Action Properties:', JSON.stringify(properties, null, 2));

    // Example: Handle different action types
    switch (action.identifier) {
      case 'create_vm':
        await this.handleCreateVM(message);
        break;
      
      case 'deploy_service':
      case 'deploy_microservice_kafka':
        await this.handleDeployService(message);
        break;
      
      default:
        console.log(`⚠️  No specific handler for action: ${action.identifier}`);
        console.log('📝 Using default handler (logging only)');
        await this.addActionRunLog(runId, `Received action: ${action.identifier} with properties: ${JSON.stringify(properties)}`);
    }
  }

  /**
   * Example: Handle VM creation
   */
  async handleCreateVM(message) {
    const runId = message.context.runId;
    const properties = message.properties;

    await this.addActionRunLog(runId, 'Creating VM with specifications...');
    
    // Simulate VM creation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await this.addActionRunLog(runId, `VM created with ${properties.cpu_cores || 2} CPU cores, ${properties.memory_size || 4}GB RAM`);

    // Create entity in Port
    const entityData = {
      identifier: properties.title?.replace(/\s+/g, '-').toLowerCase() || `vm-${Date.now()}`,
      title: properties.title || 'New VM',
      properties: {
        cpu_cores: properties.cpu_cores || 2,
        memory_size: properties.memory_size || 4,
        storage_size: properties.storage_size || 100,
        region: properties.region || 'us-east-1',
        status: 'Running',
      },
    };

    await this.upsertEntity('vm', entityData, runId);
  }

  /**
   * Example: Handle service deployment
   */
  async handleDeployService(message) {
    const runId = message.context.runId;
    const props = message.properties;
    const entity = message.entity;

    await this.addActionRunLog(runId, '🚀 Starting service deployment...');
    
    const serviceName = props.serviceName || props.service_name || 'service';
    const version = props.version || '1.0.0';
    const environment = props.environment || 'dev';
    
    await this.addActionRunLog(runId, `Deploying ${serviceName} v${version} to ${environment}...`);
    
    // Simulate deployment steps
    await this.addActionRunLog(runId, 'Step 1/4: Building container image...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    await this.addActionRunLog(runId, 'Step 2/4: Pushing to registry...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    await this.addActionRunLog(runId, `Step 3/4: Deploying to ${environment} cluster...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await this.addActionRunLog(runId, 'Step 4/4: Running health checks...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.updateActionRun(runId, {
      link: [`https://example.com/deployments/${runId}`],
      statusLabel: `Deployed to ${environment}`,
    });
    
    await this.addActionRunLog(runId, `✅ Successfully deployed ${serviceName} v${version} to ${environment}!`);
  }

  /**
   * Process change log message
   */
  async processChangeMessage(message) {
    console.log('\n' + '='.repeat(80));
    console.log('📝 Processing Change Log');
    console.log('='.repeat(80));
    console.log(JSON.stringify(message, null, 2));
  }

  /**
   * Start consuming messages from Kafka
   */
  async start() {
    console.log('\n' + '🚀 Port Kafka Consumer Starting'.padEnd(80, '='));
    console.log('='.repeat(80));
    console.log(`
📊 Configuration:
   - Organization ID: ${this.config.orgId}
   - Actions Topic: ${this.actionsTopic}
   - Changes Topic: ${this.changesTopic}
   - Consumer Group: ${this.config.consumerGroupId}
   - Kafka Brokers: ${this.config.kafkaBrokers.join(', ')}
    `);

    try {
      // Connect to Kafka
      console.log('🔌 Connecting to Kafka...');
      await this.consumer.connect();
      console.log('✅ Connected to Kafka');

      // Subscribe to topics
      console.log(`📡 Subscribing to topic: ${this.actionsTopic}`);
      await this.consumer.subscribe({ 
        topic: this.actionsTopic,
        fromBeginning: false, // Only consume new messages
      });
      console.log('✅ Subscribed to actions topic');

      // Optionally subscribe to changes topic
      // await this.consumer.subscribe({ topic: this.changesTopic });

      console.log('\n' + '='.repeat(80));
      console.log('✅ Consumer Ready - Waiting for messages...');
      console.log('='.repeat(80) + '\n');

      // Start consuming
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const value = message.value.toString();
            const parsedMessage = JSON.parse(value);

            if (topic === this.actionsTopic) {
              await this.processActionMessage(parsedMessage);
            } else if (topic === this.changesTopic) {
              await this.processChangeMessage(parsedMessage);
            }

          } catch (error) {
            console.error('❌ Error processing message:', error);
            console.error('Message value:', message.value.toString());
          }
        },
      });

    } catch (error) {
      console.error('❌ Failed to start consumer:', error);
      throw error;
    }
  }

  /**
   * Gracefully shutdown the consumer
   */
  async shutdown() {
    console.log('\n🛑 Shutting down consumer...');
    await this.consumer.disconnect();
    console.log('✅ Consumer disconnected');
  }
}

// Main execution
if (require.main === module) {
  const consumer = new PortKafkaConsumer({});

  // Handle graceful shutdown
  const shutdown = async () => {
    await consumer.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start the consumer
  consumer.start().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = PortKafkaConsumer;
