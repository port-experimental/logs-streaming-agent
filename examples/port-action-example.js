/**
 * Example: Custom Action Handler for Port Kafka Consumer
 * 
 * This example shows how to create custom action handlers
 * for different types of Port self-service actions.
 */

const PortKafkaConsumer = require('../port-kafka-consumer');

/**
 * Extended consumer with custom action handlers
 */
class CustomPortConsumer extends PortKafkaConsumer {
  constructor(config) {
    super(config);
  }

  /**
   * Override the main action handler to add custom logic
   */
  async handleAction(message) {
    const action = message.payload.action;
    const properties = message.payload.properties;
    const runId = message.context.runId;

    console.log('🎯 Custom Action Handler Invoked');
    console.log(`   Action: ${action.identifier}`);
    console.log(`   Blueprint: ${action.blueprint}`);

    // Route to specific handlers based on action identifier
    switch (action.identifier) {
      case 'scaffold_service':
        await this.scaffoldService(message);
        break;

      case 'deploy_to_production':
        await this.deployToProduction(message);
        break;

      case 'create_database':
        await this.createDatabase(message);
        break;

      case 'run_migration':
        await this.runMigration(message);
        break;

      case 'scale_service':
        await this.scaleService(message);
        break;

      default:
        // Fallback to parent class handler
        await super.handleAction(message);
    }
  }

  /**
   * Example 1: Scaffold a new service
   */
  async scaffoldService(message) {
    const runId = message.context.runId;
    const props = message.payload.properties;

    await this.addActionRunLog(runId, '🏗️  Starting service scaffolding...');

    // Step 1: Validate inputs
    await this.addActionRunLog(runId, 'Step 1/5: Validating inputs...');
    await this.simulateWork(1000);

    if (!props.service_name || !props.template) {
      throw new Error('Missing required fields: service_name or template');
    }

    // Step 2: Clone template repository
    await this.addActionRunLog(runId, `Step 2/5: Cloning template: ${props.template}`);
    await this.simulateWork(2000);

    // Step 3: Generate service files
    await this.addActionRunLog(runId, 'Step 3/5: Generating service files...');
    await this.simulateWork(1500);

    // Step 4: Create GitHub repository
    await this.addActionRunLog(runId, `Step 4/5: Creating GitHub repo: ${props.service_name}`);
    await this.simulateWork(2000);

    // Step 5: Push initial commit
    await this.addActionRunLog(runId, 'Step 5/5: Pushing initial commit...');
    await this.simulateWork(1500);

    // Update with repository link
    await this.updateActionRun(runId, {
      link: [`https://github.com/your-org/${props.service_name}`],
      statusLabel: 'Repository created',
    });

    // Create service entity in Port
    const serviceEntity = {
      identifier: props.service_name.toLowerCase().replace(/\s+/g, '-'),
      title: props.service_name,
      properties: {
        template: props.template,
        language: props.language || 'nodejs',
        created_at: new Date().toISOString(),
        repository_url: `https://github.com/your-org/${props.service_name}`,
        status: 'scaffolded',
      },
    };

    await this.upsertEntity('service', serviceEntity, runId);
    await this.addActionRunLog(runId, `✅ Service "${props.service_name}" scaffolded successfully!`);
  }

  /**
   * Example 2: Deploy to production
   */
  async deployToProduction(message) {
    const runId = message.context.runId;
    const props = message.payload.properties;
    const entity = message.payload.entity;

    await this.addActionRunLog(runId, '🚀 Starting production deployment...');

    // Step 1: Pre-deployment checks
    await this.addActionRunLog(runId, 'Step 1/6: Running pre-deployment checks...');
    await this.simulateWork(1500);

    // Step 2: Build Docker image
    await this.addActionRunLog(runId, `Step 2/6: Building Docker image for version ${props.version}`);
    await this.simulateWork(3000);

    const imageTag = `${entity.identifier}:${props.version}`;
    await this.addActionRunLog(runId, `   Built image: ${imageTag}`);

    // Step 3: Push to registry
    await this.addActionRunLog(runId, 'Step 3/6: Pushing image to registry...');
    await this.simulateWork(2500);

    // Step 4: Update Kubernetes manifests
    await this.addActionRunLog(runId, 'Step 4/6: Updating Kubernetes manifests...');
    await this.simulateWork(1500);

    // Step 5: Apply to cluster
    await this.addActionRunLog(runId, `Step 5/6: Deploying to ${props.environment} cluster...`);
    await this.simulateWork(3000);

    // Step 6: Health check
    await this.addActionRunLog(runId, 'Step 6/6: Running health checks...');
    await this.simulateWork(2000);

    // Add deployment links
    await this.updateActionRun(runId, {
      link: [
        `https://jenkins.example.com/job/deploy/${runId}`,
        `https://grafana.example.com/d/service/${entity.identifier}`,
        `https://app.example.com/${entity.identifier}`,
      ],
      statusLabel: 'Deployed successfully',
    });

    // Create deployment entity
    const deploymentEntity = {
      identifier: `deploy-${entity.identifier}-${Date.now()}`,
      title: `${entity.title} - v${props.version}`,
      properties: {
        service: entity.identifier,
        version: props.version,
        environment: props.environment,
        deployed_at: new Date().toISOString(),
        deployed_by: message.trigger.by.user.email,
        status: 'success',
      },
      relations: {
        service: entity.identifier,
      },
    };

    await this.upsertEntity('deployment', deploymentEntity, runId);
    await this.addActionRunLog(runId, `✅ Deployed ${entity.title} v${props.version} to ${props.environment}`);
  }

  /**
   * Example 3: Create database
   */
  async createDatabase(message) {
    const runId = message.context.runId;
    const props = message.payload.properties;

    await this.addActionRunLog(runId, '🗄️  Creating database...');

    // Validate database name
    const dbName = props.database_name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    await this.addActionRunLog(runId, `Database name: ${dbName}`);

    // Step 1: Check if database exists
    await this.addActionRunLog(runId, 'Step 1/4: Checking if database exists...');
    await this.simulateWork(1000);

    // Step 2: Create database
    await this.addActionRunLog(runId, `Step 2/4: Creating ${props.database_type} database...`);
    await this.simulateWork(2500);

    // Step 3: Configure access
    await this.addActionRunLog(runId, 'Step 3/4: Configuring access permissions...');
    await this.simulateWork(1500);

    // Step 4: Generate credentials
    await this.addActionRunLog(runId, 'Step 4/4: Generating credentials...');
    await this.simulateWork(1000);

    // Create database entity
    const dbEntity = {
      identifier: dbName,
      title: props.database_name,
      properties: {
        type: props.database_type,
        size: props.size || '20GB',
        region: props.region || 'us-east-1',
        created_at: new Date().toISOString(),
        endpoint: `${dbName}.db.example.com:5432`,
        status: 'available',
      },
    };

    await this.upsertEntity('database', dbEntity, runId);

    // Update with connection info
    await this.updateActionRun(runId, {
      link: [`https://console.aws.amazon.com/rds/home?region=us-east-1#database:id=${dbName}`],
      statusLabel: 'Database ready',
    });

    await this.addActionRunLog(runId, `✅ Database "${dbName}" created successfully!`);
    await this.addActionRunLog(runId, `   Endpoint: ${dbName}.db.example.com:5432`);
  }

  /**
   * Example 4: Run database migration
   */
  async runMigration(message) {
    const runId = message.context.runId;
    const props = message.payload.properties;
    const entity = message.payload.entity;

    await this.addActionRunLog(runId, '🔄 Running database migration...');

    // Step 1: Backup database
    await this.addActionRunLog(runId, 'Step 1/4: Creating database backup...');
    await this.simulateWork(2000);
    await this.addActionRunLog(runId, '   Backup created: backup-20241106-195400');

    // Step 2: Run migration
    await this.addActionRunLog(runId, `Step 2/4: Running migration: ${props.migration_name}`);
    await this.simulateWork(3000);

    // Step 3: Verify migration
    await this.addActionRunLog(runId, 'Step 3/4: Verifying migration...');
    await this.simulateWork(1500);

    // Step 4: Update schema version
    await this.addActionRunLog(runId, 'Step 4/4: Updating schema version...');
    await this.simulateWork(1000);

    await this.addActionRunLog(runId, `✅ Migration "${props.migration_name}" completed successfully!`);
  }

  /**
   * Example 5: Scale service
   */
  async scaleService(message) {
    const runId = message.context.runId;
    const props = message.payload.properties;
    const entity = message.payload.entity;

    await this.addActionRunLog(runId, '📊 Scaling service...');

    const currentReplicas = entity.properties?.replicas || 1;
    const targetReplicas = props.replicas;

    await this.addActionRunLog(runId, `Current replicas: ${currentReplicas}`);
    await this.addActionRunLog(runId, `Target replicas: ${targetReplicas}`);

    // Step 1: Update deployment
    await this.addActionRunLog(runId, 'Step 1/3: Updating Kubernetes deployment...');
    await this.simulateWork(2000);

    // Step 2: Wait for rollout
    await this.addActionRunLog(runId, 'Step 2/3: Waiting for rollout to complete...');
    await this.simulateWork(3000);

    // Step 3: Verify health
    await this.addActionRunLog(runId, 'Step 3/3: Verifying pod health...');
    await this.simulateWork(1500);

    // Update entity with new replica count
    const updatedEntity = {
      identifier: entity.identifier,
      properties: {
        ...entity.properties,
        replicas: targetReplicas,
        last_scaled: new Date().toISOString(),
      },
    };

    await this.upsertEntity('service', updatedEntity, runId);
    await this.addActionRunLog(runId, `✅ Scaled ${entity.title} from ${currentReplicas} to ${targetReplicas} replicas`);
  }

  /**
   * Helper: Simulate async work
   */
  async simulateWork(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main execution
if (require.main === module) {
  console.log('🎯 Starting Custom Port Kafka Consumer with Example Handlers\n');

  const consumer = new CustomPortConsumer({});

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

module.exports = CustomPortConsumer;
