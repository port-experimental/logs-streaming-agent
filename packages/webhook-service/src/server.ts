/**
 * Generic CI/CD Webhook Server with Plugin Support
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env from monorepo root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import express, { Request, Response, NextFunction } from 'express';
import { logger, pluginRegistry, JenkinsProvider, CircleCIProvider, NormalizedBuildData } from '@cicd/shared';

const app = express();
app.use(express.json());

// Store active build monitoring tasks
const activeTasks = new Map<string, boolean>();

/**
 * Initialize and register CI/CD providers based on environment config
 */
function initializeProviders(): void {
  logger.info('\n🔌 Initializing CI/CD Providers...');
  logger.info('='.repeat(80));
  
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
      logger.error(`Failed to register Jenkins provider: ${errorMsg}`);
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
      logger.error(`Failed to register CircleCI provider: ${errorMsg}`);
    }
  }
  
  const registeredProviders = pluginRegistry.getProviderNames();
  logger.info(`\n✅ Registered providers: ${registeredProviders.join(', ')}`);
  logger.info('='.repeat(80) + '\n');
}

/**
 * Generic webhook handler for any CI/CD provider
 */
async function handleWebhook(providerName: string, payload: any): Promise<void> {
  const provider = pluginRegistry.getProvider(providerName);
  
  if (!provider) {
    throw new Error(`Provider ${providerName} not registered`);
  }
  
  // Parse webhook payload
  const buildData = provider.parseWebhookPayload(payload);
  const normalizedData = provider.normalizeBuildData(buildData);
  
  logger.info(`\n📨 ${providerName.toUpperCase()} Webhook Received`);
  logger.info(`Build: #${normalizedData.buildNumber}`);
  logger.info(`Status: ${normalizedData.status}`);
  logger.info(`URL: ${normalizedData.buildUrl}`);
  
  const taskKey = `${providerName}-${normalizedData.buildId}`;
  
  // Handle based on build status
  if (normalizedData.status === 'running' || normalizedData.status === 'pending') {
    logger.info(`\n📊 Starting real-time log capture for build #${normalizedData.buildNumber}...`);
    
    if (!activeTasks.has(taskKey)) {
      activeTasks.set(taskKey, true);
      
      try {
        let allLogs = '';
        
        // Stream logs in real-time
        await provider.streamLogs(normalizedData.buildId, (chunk) => {
          process.stdout.write(chunk);
          allLogs += chunk;
        });

        // Get final build status
        const buildStatus = await provider.getBuildStatus(normalizedData.buildId);
        logger.info('\n--- Build Status ---');
        logger.info(`Result: ${buildStatus.result}`);
        logger.info(`Duration: ${buildStatus.duration}ms`);

        logger.info(`\n✅ Build #${normalizedData.buildNumber} completed: ${buildStatus.result}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`\n❌ Error monitoring build #${normalizedData.buildNumber}: ${errorMsg}`);
      } finally {
        activeTasks.delete(taskKey);
      }
    }
  } else {
    // Build already completed, just fetch logs
    logger.info(`\n📥 Fetching logs for completed build #${normalizedData.buildNumber}...`);
    
    try {
      const logs = await provider.getCompleteLogs(normalizedData.buildId);
      logger.info(`✅ Logs retrieved for build #${normalizedData.buildNumber} (${normalizedData.status})`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error fetching logs: ${errorMsg}`);
    }
  }
}

/**
 * Setup webhook routes dynamically based on registered providers
 */
function setupWebhookRoutes(): void {
  const routes = pluginRegistry.getWebhookRoutes();
  
  routes.forEach(({ path, provider }) => {
    app.post(path, async (req: Request, res: Response) => {
      try {
        const payload = req.body;
        
        // Validate webhook if provider supports it
        if (!provider.validateWebhook(req.headers, payload)) {
          logger.warn(`Invalid webhook signature for ${provider.getName()}`);
          return res.status(401).json({ error: 'Invalid webhook signature' });
        }
        
        // Acknowledge receipt immediately
        res.status(200).json({
          received: true,
          message: 'Webhook received successfully',
          timestamp: new Date().toISOString()
        });

        // Process webhook asynchronously
        try {
          await handleWebhook(provider.getName(), payload);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(`Error handling webhook: ${errorMsg}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Webhook endpoint error:', errorMsg);
        res.status(500).json({
          error: 'Internal server error',
          message: errorMsg
        });
      }
    });
    
    logger.info(`📍 Registered webhook route: POST ${path}`);
  });
}

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    activeMonitors: activeTasks.size,
    activeTasks: Array.from(activeTasks.keys()),
    registeredProviders: pluginRegistry.getProviderNames(),
    timestamp: new Date().toISOString()
  });
});

/**
 * Status endpoint - shows active monitoring tasks
 */
app.get('/status', (req: Request, res: Response) => {
  res.json({
    activeTasks: Array.from(activeTasks.keys()),
    count: activeTasks.size,
    providers: pluginRegistry.getProviderNames(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Global error handlers
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Start server
const PORT = process.env.WEBHOOK_PORT || 3000;

const server = app.listen(PORT, () => {
  // Initialize providers
  initializeProviders();
  
  // Setup webhook routes
  setupWebhookRoutes();
  
  logger.info('\n🚀 CI/CD Webhook Server Started');
  logger.info('='.repeat(80));
  logger.info(`📡 Listening on port ${PORT}`);
  logger.info(`💚 Health check: http://localhost:${PORT}/health`);
  logger.info(`📊 Status: http://localhost:${PORT}/status`);
  logger.info('='.repeat(80));
  logger.info('\n⏳ Waiting for webhooks...\n');
});

// Handle server errors
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`);
  } else {
    logger.error('Server error:', error);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('\n\n👋 Shutting down webhook server...');
  logger.info(`Active monitors: ${activeTasks.size}`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logger.info('\n\n👋 SIGTERM received, shutting down...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default app;
