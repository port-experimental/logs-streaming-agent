/**
 * Port Kafka Self-Service Actions Consumer
 * 
 * This POC demonstrates how to consume action invocations from Port's Kafka topic
 * and report status back to Port.
 */

const { Kafka } = require('kafkajs');
const axios = require('axios');
const JenkinsLogCapture = require('./jenkins-log-capture');
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

    // Initialize Jenkins client
    this.jenkinsCapture = new JenkinsLogCapture({
      jenkinsUrl: config.jenkinsUrl || process.env.JENKINS_URL || 'http://localhost:8080',
      username: config.jenkinsUsername || process.env.JENKINS_USERNAME,
      apiToken: config.jenkinsApiToken || process.env.JENKINS_API_TOKEN,
      jobName: config.jenkinsJobName || process.env.JENKINS_JOB_NAME || 'your-node-app',
    });

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
      // Update status label to indicate processing started
      // Note: Don't set status to IN_PROGRESS - it's already set automatically
      await this.updateActionRun(runId, {
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
   * Trigger Jenkins build with parameters
   */
  async triggerJenkinsBuild(parameters = {}) {
    const jenkinsUrl = this.jenkinsCapture.jenkinsUrl;
    const jobName = this.jenkinsCapture.jobName;
    const auth = {
      username: this.jenkinsCapture.username,
      password: this.jenkinsCapture.apiToken,
    };

    try {
      console.log(`🔨 Triggering Jenkins build for job: ${jobName}`);
      
      const hasParameters = parameters && Object.keys(parameters).length > 0;
      
      if (hasParameters) {
        console.log(`📋 Build Parameters:`, parameters);
      }
      
      // Use buildWithParameters endpoint if parameters exist, otherwise use build
      const endpoint = hasParameters ? 'buildWithParameters' : 'build';
      const url = `${jenkinsUrl}/job/${jobName}/${endpoint}`;
      
      // Trigger build with parameters as query string
      await axios.post(
        url,
        null,
        { 
          auth,
          params: hasParameters ? parameters : undefined
        }
      );

      // Wait for build to be queued
      console.log('⏳ Waiting for build to be queued...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get the latest build number
      const latestBuild = await this.jenkinsCapture.getLatestBuildNumber();
      
      if (!latestBuild) {
        throw new Error('No build number returned from Jenkins');
      }
      
      console.log(`✅ Build #${latestBuild} triggered successfully`);
      return latestBuild;
    } catch (error) {
      console.error('❌ Jenkins trigger error:', error.response?.data || error.message);
      throw new Error(`Failed to trigger Jenkins build: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Handle service deployment with Jenkins integration
   */
  async handleDeployService(message) {
    const runId = message.context.runId;
    const props = message.properties;
    const entity = message.entity;

    await this.addActionRunLog(runId, '🚀 Starting service deployment via Jenkins...');
    
    const serviceName = props.serviceName || props.service_name || 'service';
    const version = props.version || '1.0.0';
    const environment = props.environment || 'dev';
    const changeReason = props.changeReason || 'Deployment triggered via Port';
    
    await this.addActionRunLog(runId, `Deploying ${serviceName} v${version} to ${environment}...`);
    await this.addActionRunLog(runId, `Reason: ${changeReason}`);

    try {
      // Step 1: Trigger Jenkins build
      await this.addActionRunLog(runId, '📡 Triggering Jenkins build...');
      
      const buildNumber = await this.triggerJenkinsBuild({
        SERVICE_NAME: serviceName,
        VERSION: version,
        ENVIRONMENT: environment,
        CHANGE_REASON: changeReason,
        PORT_RUN_ID: runId,
      });

      const jenkinsUrl = this.jenkinsCapture.jenkinsUrl;
      const jobName = this.jenkinsCapture.jobName;
      const buildUrl = `${jenkinsUrl}/job/${jobName}/${buildNumber}`;

      await this.addActionRunLog(runId, `✅ Jenkins build #${buildNumber} started`);
      
      // Step 2: Update Port with Jenkins link
      await this.updateActionRun(runId, {
        link: [buildUrl],
        statusLabel: `Jenkins build #${buildNumber} in progress`,
      });

      // Step 3: Stream Jenkins logs to Port in real-time
      await this.addActionRunLog(runId, '📋 Streaming Jenkins logs...');
      await this.addActionRunLog(runId, '─'.repeat(80));

      let logBuffer = '';
      const CHUNK_SIZE = 500; // Send logs in chunks to avoid overwhelming Port API

      await this.jenkinsCapture.streamLogs(buildNumber, async (logChunk) => {
        logBuffer += logChunk;
        
        // Send logs in chunks to Port
        if (logBuffer.length >= CHUNK_SIZE) {
          await this.addActionRunLog(runId, logBuffer);
          logBuffer = '';
        }
      });

      // Send any remaining logs
      if (logBuffer.length > 0) {
        await this.addActionRunLog(runId, logBuffer);
      }

      await this.addActionRunLog(runId, '─'.repeat(80));

      // Step 4: Get final build status
      const buildStatus = await this.jenkinsCapture.getBuildStatus(buildNumber);
      const isSuccess = buildStatus.result === 'SUCCESS';
      const duration = (buildStatus.duration / 1000).toFixed(2);

      await this.updateActionRun(runId, {
        statusLabel: `Build ${buildStatus.result} (${duration}s)`,
      });


      if (isSuccess) {
        await this.addActionRunLog(
          runId,
          `✅ Successfully deployed ${serviceName} v${version} to ${environment}!\nBuild #${buildNumber} completed in ${duration}s`
        );
      } else {
        throw new Error(`Jenkins build failed with status: ${buildStatus.result}`);
      }

    } catch (error) {
      await this.addActionRunLog(
        runId,
        `❌ Deployment failed: ${error.message}`
      );
      throw error;
    }
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
