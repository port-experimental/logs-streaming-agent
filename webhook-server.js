require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const JenkinsLogCapture = require('./jenkins-log-capture');
const logger = require('./logger');

/**
 * Jenkins Webhook Server
 * Receives webhook notifications from Jenkins builds and automatically captures logs
 * Logs captured via webhook are saved with 'webhookstream' prefix for easy identification
 */

const app = express();
app.use(express.json());

// Store active build monitoring tasks
const activeTasks = new Map();

// Initialize Jenkins log capture client
const jenkinsCapture = new JenkinsLogCapture({
  jenkinsUrl: process.env.JENKINS_URL || 'http://localhost:8080',
  username: process.env.JENKINS_USERNAME,
  apiToken: process.env.JENKINS_API_TOKEN,
  jobName: process.env.JENKINS_JOB_NAME || 'your-node-app'
});

/**
 * Save logs with webhookstream prefix to differentiate from manual captures
 */
async function saveWebhookLogs(buildNumber, logs) {
  const outputDir = './logs';
  
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = path.join(
      outputDir,
      `webhookstream-${jenkinsCapture.jobName}-build-${buildNumber}-${Date.now()}.log`
    );
    
    fs.writeFileSync(filename, logs, 'utf8');
    logger.info(`Logs saved to: ${filename}`);
    return filename;
  } catch (error) {
    logger.error(`Failed to save logs for build #${buildNumber}:`, error.message);
    throw error;
  }
}

/**
 * Main webhook endpoint - receives notifications from Jenkins
 */
app.post('/webhook', async (req, res) => {
  try {
    const notification = req.body;
    
    // Validate required fields
    if (!notification || !notification.buildNumber || !notification.jobName) {
      logger.warn('Invalid webhook payload received:', notification);
      return res.status(400).json({
        error: 'Invalid payload',
        message: 'Missing required fields: buildNumber, jobName'
      });
    }
    
    logger.info('\n=== Jenkins Webhook Received ===');
    logger.info(`Job: ${notification.jobName}`);
    logger.info(`Build: #${notification.buildNumber}`);
    logger.info(`Status: ${notification.status}`);
    logger.info(`URL: ${notification.buildUrl}`);
    logger.info(`Timestamp: ${new Date(notification.timestamp).toISOString()}`);
    
    // Acknowledge receipt immediately
    res.status(200).json({
      received: true,
      message: 'Webhook received successfully',
      buildNumber: notification.buildNumber,
      timestamp: new Date().toISOString()
    });

    // Process webhook asynchronously
    try {
      await handleWebhook(notification);
    } catch (error) {
      logger.error(`Error handling webhook: ${error.message}`, error);
    }
  } catch (error) {
    logger.error('Webhook endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Handle webhook notification and capture logs
 */
async function handleWebhook(notification) {
  const { jobName, buildNumber, status } = notification;
  const taskKey = `${jobName}-${buildNumber}`;

  // If build is starting or in progress, start real-time monitoring
  if (status === 'STARTED' || status === null || status === 'IN_PROGRESS') {
    logger.info(`\n📊 Starting real-time log capture for build #${buildNumber}...`);
    
    if (!activeTasks.has(taskKey)) {
      activeTasks.set(taskKey, true);
      
      try {
        let allLogs = '';
        
        // Stream logs in real-time
        await jenkinsCapture.streamLogs(buildNumber, (chunk) => {
          process.stdout.write(chunk);
          allLogs += chunk;
        });

        // Get final build status
        const buildStatus = await jenkinsCapture.getBuildStatus(buildNumber);
        logger.info('\n--- Build Status ---');
        logger.info(`Result: ${buildStatus.result}`);
        logger.info(`Duration: ${buildStatus.duration}ms`);

        // Save with webhookstream prefix
        await saveWebhookLogs(buildNumber, allLogs);
        
        logger.info(`\n✅ Build #${buildNumber} completed: ${buildStatus.result}`);
      } catch (error) {
        logger.error(`\n❌ Error monitoring build #${buildNumber}: ${error.message}`, error);
      } finally {
        activeTasks.delete(taskKey);
      }
    } else {
      logger.warn(`⚠️  Build #${buildNumber} is already being monitored`);
    }
  } 
  // If build is already completed, just fetch the logs
  else if (status === 'SUCCESS' || status === 'FAILURE' || status === 'UNSTABLE' || status === 'ABORTED') {
    logger.info(`\n📥 Fetching logs for completed build #${buildNumber}...`);
    
    try {
      const logs = await jenkinsCapture.getConsoleOutput(buildNumber);
      await saveWebhookLogs(buildNumber, logs);
      logger.info(`✅ Logs saved for build #${buildNumber} (${status})`);
    } catch (error) {
      logger.error(`❌ Error fetching logs: ${error.message}`, error);
    }
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeMonitors: activeTasks.size,
    activeTasks: Array.from(activeTasks.keys()),
    timestamp: new Date().toISOString()
  });
});

/**
 * Status endpoint - shows active monitoring tasks
 */
app.get('/status', (req, res) => {
  res.json({
    activeTasks: Array.from(activeTasks.keys()),
    count: activeTasks.size,
    jenkinsUrl: process.env.JENKINS_URL,
    jobName: process.env.JENKINS_JOB_NAME,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * List captured logs (all logs including webhookstream)
 */
app.get('/logs', (req, res) => {
  try {
    const logsDir = './logs';
    
    if (!fs.existsSync(logsDir)) {
      return res.json({ logs: [], count: 0 });
    }

    const files = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const stats = fs.statSync(path.join(logsDir, file));
        return {
          filename: file,
          size: stats.size,
          type: file.startsWith('webhookstream-') ? 'webhook' : 'manual',
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.created - a.created);

    res.json({ 
      logs: files, 
      count: files.length,
      webhookCount: files.filter(f => f.type === 'webhook').length,
      manualCount: files.filter(f => f.type === 'manual').length
    });
  } catch (error) {
    logger.error('Error listing logs:', error);
    res.status(500).json({ error: 'Failed to list logs', message: error.message });
  }
});

/**
 * List only webhook-captured logs
 */
app.get('/logs/webhook', (req, res) => {
  try {
    const logsDir = './logs';
    
    if (!fs.existsSync(logsDir)) {
      return res.json({ logs: [], count: 0 });
    }

    const files = fs.readdirSync(logsDir)
      .filter(file => file.startsWith('webhookstream-') && file.endsWith('.log'))
      .map(file => {
        const stats = fs.statSync(path.join(logsDir, file));
        return {
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.created - a.created);

    res.json({ logs: files, count: files.length });
  } catch (error) {
    logger.error('Error listing webhook logs:', error);
    res.status(500).json({ error: 'Failed to list webhook logs', message: error.message });
  }
});

/**
 * Get specific log file
 */
app.get('/logs/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const filepath = path.join('./logs', filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }

    res.sendFile(path.resolve(filepath));
  } catch (error) {
    logger.error(`Error retrieving log file ${req.params.filename}:`, error);
    res.status(500).json({ error: 'Failed to retrieve log file', message: error.message });
  }
});

// Global error handlers
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Start server
const PORT = process.env.WEBHOOK_PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info('\n🚀 Jenkins Webhook Server Started');
  logger.info('='.repeat(50));
  logger.info(`📡 Listening on port ${PORT}`);
  logger.info(`🔗 Webhook URL: http://localhost:${PORT}/webhook`);
  logger.info(`💚 Health check: http://localhost:${PORT}/health`);
  logger.info(`📊 Status: http://localhost:${PORT}/status`);
  logger.info(`📋 All logs: http://localhost:${PORT}/logs`);
  logger.info(`🔔 Webhook logs: http://localhost:${PORT}/logs/webhook`);
  logger.info('='.repeat(50));
  logger.info(`\n📝 Log file naming:`);
  logger.info(`   - Webhook: webhookstream-{job}-build-{number}-{timestamp}.log`);
  logger.info(`   - Manual:  {job}-build-{number}-{timestamp}.log`);
  logger.info('\n⏳ Waiting for Jenkins webhooks...\n');
});

// Handle server errors
server.on('error', (error) => {
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
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;
