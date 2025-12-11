/**
 * Port Kafka Self-Service Actions Consumer
 * 
 * This POC demonstrates how to consume action invocations from Port's Kafka topic
 * and report status back to Port.
 * 
 * Features:
 * - Generic parameter pass-through: Any properties defined in Port actions are
 *   automatically passed to Jenkins as build parameters
 * - Flexible action handling: Add custom handlers for specific actions or use
 *   the default generic deployment handler
 * - Real-time Jenkins log streaming to Port
 * 
 * Usage:
 * 1. Define your action in Port with any properties you need
 * 2. Properties will be automatically converted to UPPERCASE and sent to Jenkins
 * 3. Jenkins job receives all parameters and can use them as needed
 */

const { Kafka } = require('kafkajs');
const axios = require('./axios-config');
const JenkinsLogCapture = require('./jenkins-log-capture');
const { BUILD_STATUS, STAGE_STATUS } = require('./jenkins-log-capture');
const logger = require('./logger');
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

    // Validate required configuration
    this.validateConfig();

    this.portApiUrl = 'https://api.getport.io/v1';
    this.accessToken = null;
    this.tokenExpiry = null;

    // Initialize Jenkins client
    this.jenkinsCapture = new JenkinsLogCapture({
      jenkinsUrl: config.jenkinsUrl || process.env.JENKINS_URL,
      username: config.jenkinsUsername || process.env.JENKINS_USERNAME,
      apiToken: config.jenkinsApiToken || process.env.JENKINS_API_TOKEN,
      jobName: config.jenkinsJobName || process.env.JENKINS_JOB_NAME,
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

    // Setup Kafka error handlers
    this.setupKafkaErrorHandlers();

    // Topic names
    this.actionsTopic = `${this.config.orgId}.runs`;
    this.changesTopic = `${this.config.orgId}.change.log`;
    
    // Track connection state
    this.isConnected = false;
    this.isShuttingDown = false;
  }

  /**
   * Setup Kafka error handlers
   */
  setupKafkaErrorHandlers() {
    // Consumer error events
    this.consumer.on('consumer.crash', ({ error, groupId }) => {
      logger.error(`Consumer crashed in group ${groupId}:`, error);
      if (!this.isShuttingDown) {
        logger.info('Attempting to reconnect...');
        this.reconnect();
      }
    });

    this.consumer.on('consumer.disconnect', () => {
      logger.warn('Consumer disconnected');
      this.isConnected = false;
    });

    this.consumer.on('consumer.connect', () => {
      logger.info('Consumer connected');
      this.isConnected = true;
    });

    this.consumer.on('consumer.network.request_timeout', ({ broker, clientId }) => {
      logger.warn(`Network request timeout for broker ${broker}`);
    });
  }

  /**
   * Reconnect to Kafka after connection failure
   */
  async reconnect(retries = 5, delay = 5000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.info(`Reconnection attempt ${attempt}/${retries}...`);
        await this.consumer.disconnect();
        await new Promise(resolve => setTimeout(resolve, delay));
        await this.start();
        logger.info('Reconnection successful');
        return;
      } catch (error) {
        logger.error(`Reconnection attempt ${attempt} failed:`, error.message);
        if (attempt === retries) {
          logger.error('Max reconnection attempts reached, exiting...');
          process.exit(1);
        }
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }

  /**
   * Validate required configuration
   */
  validateConfig() {
    const errors = [];

    // Port API credentials
    if (!this.config.portClientId) {
      errors.push('PORT_CLIENT_ID is required (set via config or environment variable)');
    }
    if (!this.config.portClientSecret) {
      errors.push('PORT_CLIENT_SECRET is required (set via config or environment variable)');
    }
    if (!this.config.orgId) {
      errors.push('PORT_ORG_ID is required (set via config or environment variable)');
    }

    // Kafka configuration
    if (!this.config.kafkaBrokers || this.config.kafkaBrokers.length === 0) {
      errors.push('KAFKA_BROKERS is required (comma-separated list of broker addresses)');
    } else {
      // Validate broker format
      const invalidBrokers = this.config.kafkaBrokers.filter(broker => {
        return !broker || !broker.includes(':');
      });
      if (invalidBrokers.length > 0) {
        errors.push(`Invalid Kafka broker format. Expected format: host:port. Invalid brokers: ${invalidBrokers.join(', ')}`);
      }
    }

    if (!this.config.kafkaUsername) {
      errors.push('KAFKA_USERNAME is required (set via config or environment variable)');
    }
    if (!this.config.kafkaPassword) {
      errors.push('KAFKA_PASSWORD is required (set via config or environment variable)');
    }
    if (!this.config.consumerGroupId) {
      errors.push('KAFKA_CONSUMER_GROUP_ID is required (set via config or environment variable)');
    }

    // Throw error if any validation failed
    if (errors.length > 0) {
      const errorMessage = [
        '\n❌ Configuration Validation Failed:',
        '='.repeat(80),
        ...errors.map(err => `  • ${err}`),
        '='.repeat(80),
        '\nPlease check your .env file or configuration object.',
        'See .env.kafka.example for reference.\n'
      ].join('\n');
      
      throw new Error(errorMessage);
    }

    logger.info('✅ Configuration validation passed');
  }

  /**
   * Get Port API access token
   */
  async getAccessToken() {
    // Return cached token if still valid
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
      // Token typically expires in 1 hour, refresh 5 minutes before
      this.tokenExpiry = Date.now() + (55 * 60 * 1000);
      
      logger.info('✅ Access token obtained');
      return this.accessToken;
    } catch (error) {
      logger.error('❌ Failed to get access token:', error.response?.data || error.message);
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

      logger.info(`✅ Updated action run ${runId}:`, updates.status || 'IN_PROGRESS');
      return response.data;
    } catch (error) {
      logger.error(`❌ Failed to update action run ${runId}:`, error.response?.data || error.message);
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

      logger.debug(`📝 Added log to action run ${runId}`);
      return response.data;
    } catch (error) {
      logger.error(`❌ Failed to add log to action run ${runId}:`, error.response?.data || error.message);
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

      logger.info(`✅ Created/Updated entity: ${entityData.identifier} in blueprint: ${blueprintId}`);
      return response.data;
    } catch (error) {
      logger.error(`❌ Failed to upsert entity:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Process action invocation message
   */
  async processActionMessage(message) {
    logger.info('\n' + '='.repeat(80));
    logger.info('📨 Processing Action Invocation');
    logger.info('='.repeat(80));

    const runId = message.context.runId;
    const action = message.action;
    const properties = message.properties;
    const entity = message.entity;

    logger.info(`
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
      logger.error('❌ Error processing action:', error);
      
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

    logger.info('🔧 Executing action handler...');
    logger.debug('📋 Action Properties:', JSON.stringify(properties, null, 2));

    // Handle different action types
    // Add your custom action handlers here
    switch (action.identifier) {
      case 'create_vm':
        await this.handleCreateVM(message);
        break;
      
      // Generic deployment handler - works with any Jenkins job
      case 'deploy_service':
      case 'deploy_microservice_kafka':
      case 'deploy_application':
      case 'trigger_build':
        await this.handleDeployService(message);
        break;
      
      default:
        // Default: Try to use the generic deployment handler
        // This allows any action to trigger Jenkins with parameters
        logger.info(`ℹ️  No specific handler for action: ${action.identifier}`);
        logger.info('📝 Using generic deployment handler');
        await this.handleDeployService(message);
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
      logger.info(`🔨 Triggering Jenkins build for job: ${jobName}`);
      
      const hasParameters = parameters && Object.keys(parameters).length > 0;
      
      if (hasParameters) {
        logger.debug(`📋 Build Parameters:`, parameters);
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
      logger.info('⏳ Waiting for build to be queued...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get the latest build number
      const latestBuild = await this.jenkinsCapture.getLatestBuildNumber();
      
      if (!latestBuild) {
        throw new Error('No build number returned from Jenkins');
      }
      
      logger.info(`✅ Build #${latestBuild} triggered successfully`);
      return latestBuild;
    } catch (error) {
      logger.error('❌ Jenkins trigger error:', error.response?.data || error.message);
      throw new Error(`Failed to trigger Jenkins build: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Handle service deployment with Jenkins integration
   * Generic handler that passes all Port properties to Jenkins
   * 
   * Example:
   * Port action with properties: { branch: "main", tag: "v1.0", replicas: 3, enableDebug: true }
   * Will send to Jenkins: { BRANCH: "main", TAG: "v1.0", REPLICAS: 3, ENABLEDEBUG: true, PORT_RUN_ID: "..." }
   * 
   * Works with ANY properties - no specific parameters required.
   * Define whatever your Jenkins job needs in your Port action configuration.
   */
  async handleDeployService(message) {
    const runId = message.context.runId;
    const props = message.properties;
    const entity = message.entity;

    await this.addActionRunLog(runId, '🚀 Starting Jenkins build via Port...');
    await this.addActionRunLog(runId, `Action: ${message.action.identifier}`);
    await this.addActionRunLog(runId, `Parameters: ${JSON.stringify(props, null, 2)}`);

    try {
      // Step 1: Trigger Jenkins build with all parameters from Port
      await this.addActionRunLog(runId, 'Triggering Jenkins build...');
      
      // Build parameters - pass ALL properties from Port to Jenkins
      // This makes it flexible for any action configuration in Port
      const buildParameters = {};
      
      // Convert all Port properties to Jenkins parameters
      for (const [key, value] of Object.entries(props)) {
        if (value !== undefined && value !== null) {
          // Convert property names to Jenkins convention (optional)
          // You can customize this transformation based on your needs:
          // - Keep original: buildParameters[key] = value;
          // - Or convert to UPPER_CASE for Jenkins convention
          const jenkinsKey = key.toUpperCase();
          buildParameters[jenkinsKey] = value;
        }
      }
      
      // Always add run ID for tracking
      buildParameters.PORT_RUN_ID = runId;
      
      logger.info('📋 Sending parameters to Jenkins:', JSON.stringify(buildParameters, null, 2));
      
      const buildNumber = await this.triggerJenkinsBuild(buildParameters);

      const jenkinsUrl = this.jenkinsCapture.jenkinsUrl;
      const jobName = this.jenkinsCapture.jobName;
      const buildUrl = `${jenkinsUrl}/job/${jobName}/${buildNumber}`;

      await this.addActionRunLog(runId, `Jenkins build #${buildNumber} started`);
      
      // Step 2: Update Port with Jenkins link
      await this.updateActionRun(runId, {
        link: [buildUrl],
        statusLabel: `Jenkins build #${buildNumber} in progress`,
      });

      // Step 3: Stream Jenkins logs to Port in real-time
      await this.addActionRunLog(runId, 'Streaming Jenkins logs...');
      await this.addActionRunLog(runId, '─'.repeat(80));

      let logBuffer = '';
      const CHUNK_SIZE = 500; // Send logs in chunks to avoid overwhelming Port API
      const seenStages = new Set(); // Track which stages we've already reported

      // Function to check and report stages
      const checkStages = async () => {
        try {
          const allStages = await this.jenkinsCapture.getAllStages(buildNumber);
          
          // Process all stages to find new ones
          for (const stage of allStages) {
            const stageKey = `${stage.name}-${stage.status}`;
            
            // Report each stage transition (when it starts or completes)
            if (!seenStages.has(stageKey) && stage.status !== 'NOT_EXECUTED') {
              seenStages.add(stageKey);
              
              const duration = stage.durationMillis ? `(${(stage.durationMillis / 1000).toFixed(0)}s)` : '';
              const statusText = stage.status === STAGE_STATUS.IN_PROGRESS ? 'Running' : 'Completed';
              
              await this.updateActionRun(runId, {
                statusLabel: `Build #${buildNumber} - ${statusText}: ${stage.name} ${duration}`.trim(),
              });
              
              logger.info(`Stage: ${stage.name} [${stage.status}]`);
            }
          }
        } catch (error) {
          logger.debug(`Stage check error: ${error.message}`);
        }
      };

      // Check stages immediately (don't wait for first interval)
      await checkStages();

      // Start polling for stage changes every 1 second (faster to catch quick stages)
      const stageCheckInterval = setInterval(checkStages, 1000);

      try {
        // Stream logs
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

        // Continue polling for stages even after log streaming completes
        // Wait for build to actually finish
        logger.info('Waiting for build to complete...');
        let buildComplete = false;
        while (!buildComplete) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const buildStatus = await this.jenkinsCapture.getBuildStatus(buildNumber);
          buildComplete = buildStatus.building === false;
        }
      } finally {
        // Stop polling when build is actually complete
        clearInterval(stageCheckInterval);
      }

      await this.addActionRunLog(runId, '─'.repeat(80));

      // Step 4: Get final build status
      const buildStatus = await this.jenkinsCapture.getBuildStatus(buildNumber);
      const isSuccess = buildStatus.result === BUILD_STATUS.SUCCESS;
      const duration = (buildStatus.duration / 1000).toFixed(2);

      await this.updateActionRun(runId, {
        statusLabel: `Build ${buildStatus.result} (${duration}s)`,
      });


      if (isSuccess) {
        await this.addActionRunLog(
          runId,
          `✅ Jenkins build #${buildNumber} completed successfully in ${duration}s`
        );
      } else {
        throw new Error(`Jenkins build failed with status: ${buildStatus.result}`);
      }

    } catch (error) {
      await this.addActionRunLog(
        runId,
        `Deployment failed: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Process change log message
   */
  async processChangeMessage(message) {
    logger.info('\n' + '='.repeat(80));
    logger.info('📝 Processing Change Log');
    logger.info('='.repeat(80));
    logger.debug(JSON.stringify(message, null, 2));
  }

  /**
   * Start consuming messages from Kafka
   */
  async start() {
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
   - Changes Topic: ${this.changesTopic}
   - Consumer Group: ${this.config.consumerGroupId}
   - Kafka Brokers: ${this.config.kafkaBrokers.join(', ')}
    `);

    try {
      // Connect to Kafka
      logger.info('🔌 Connecting to Kafka...');
      await this.consumer.connect();
      this.isConnected = true;
      logger.info('✅ Connected to Kafka');

      // Subscribe to topics
      logger.info(`📡 Subscribing to topic: ${this.actionsTopic}`);
      await this.consumer.subscribe({ 
        topic: this.actionsTopic,
        fromBeginning: false, // Only consume new messages
      });
      logger.info('✅ Subscribed to actions topic');

      // Optionally subscribe to changes topic
      // await this.consumer.subscribe({ topic: this.changesTopic });

      logger.info('\n' + '='.repeat(80));
      logger.info('✅ Consumer Ready - Waiting for messages...');
      logger.info('='.repeat(80) + '\n');

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
            logger.error('❌ Error processing message:', error);
            logger.error('Message value:', message.value.toString());
            // Don't throw - continue processing other messages
          }
        },
      });

    } catch (error) {
      logger.error('❌ Failed to start consumer:', error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Gracefully shutdown the consumer
   */
  async shutdown() {
    this.isShuttingDown = true;
    logger.info('\n🛑 Shutting down consumer...');
    
    try {
      if (this.isConnected) {
        await this.consumer.disconnect();
        this.isConnected = false;
      }
      logger.info('✅ Consumer disconnected');
    } catch (error) {
      logger.error('Error during shutdown:', error);
      throw error;
    }
  }
}

// Main execution
if (require.main === module) {
  const consumer = new PortKafkaConsumer({});

  // Handle graceful shutdown
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

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    shutdown();
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    shutdown();
  });

  // Start the consumer
  consumer.start().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = PortKafkaConsumer;
