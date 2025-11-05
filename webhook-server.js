require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const JenkinsLogCapture = require('./jenkins-log-capture');

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
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = path.join(
    outputDir,
    `webhookstream-${jenkinsCapture.jobName}-build-${buildNumber}-${Date.now()}.log`
  );
  
  fs.writeFileSync(filename, logs, 'utf8');
  console.log(`Logs saved to: ${filename}`);
  return filename;
}

/**
 * Main webhook endpoint - receives notifications from Jenkins
 */
app.post('/webhook', async (req, res) => {
  const notification = req.body;
  
  console.log('\n=== Jenkins Webhook Received ===');
  console.log(`Job: ${notification.jobName}`);
  console.log(`Build: #${notification.buildNumber}`);
  console.log(`Status: ${notification.status}`);
  console.log(`URL: ${notification.buildUrl}`);
  console.log(`Timestamp: ${new Date(notification.timestamp).toISOString()}`);
  
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
    console.error(`Error handling webhook: ${error.message}`);
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
    console.log(`\n📊 Starting real-time log capture for build #${buildNumber}...`);
    
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
        console.log('\n--- Build Status ---');
        console.log(`Result: ${buildStatus.result}`);
        console.log(`Duration: ${buildStatus.duration}ms`);

        // Save with webhookstream prefix
        await saveWebhookLogs(buildNumber, allLogs);
        
        console.log(`\n✅ Build #${buildNumber} completed: ${buildStatus.result}`);
      } catch (error) {
        console.error(`\n❌ Error monitoring build #${buildNumber}: ${error.message}`);
      } finally {
        activeTasks.delete(taskKey);
      }
    } else {
      console.log(`⚠️  Build #${buildNumber} is already being monitored`);
    }
  } 
  // If build is already completed, just fetch the logs
  else if (status === 'SUCCESS' || status === 'FAILURE' || status === 'UNSTABLE' || status === 'ABORTED') {
    console.log(`\n📥 Fetching logs for completed build #${buildNumber}...`);
    
    try {
      const logs = await jenkinsCapture.getConsoleOutput(buildNumber);
      await saveWebhookLogs(buildNumber, logs);
      console.log(`✅ Logs saved for build #${buildNumber} (${status})`);
    } catch (error) {
      console.error(`❌ Error fetching logs: ${error.message}`);
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
});

/**
 * List only webhook-captured logs
 */
app.get('/logs/webhook', (req, res) => {
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
});

/**
 * Get specific log file
 */
app.get('/logs/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join('./logs', filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Log file not found' });
  }

  res.sendFile(path.resolve(filepath));
});

// Start server
const PORT = process.env.WEBHOOK_PORT || 3000;

app.listen(PORT, () => {
  console.log('\n🚀 Jenkins Webhook Server Started');
  console.log('='.repeat(50));
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Status: http://localhost:${PORT}/status`);
  console.log(`📋 All logs: http://localhost:${PORT}/logs`);
  console.log(`🔔 Webhook logs: http://localhost:${PORT}/logs/webhook`);
  console.log('='.repeat(50));
  console.log(`\n📝 Log file naming:`);
  console.log(`   - Webhook: webhookstream-{job}-build-{number}-{timestamp}.log`);
  console.log(`   - Manual:  {job}-build-{number}-{timestamp}.log`);
  console.log('\n⏳ Waiting for Jenkins webhooks...\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down webhook server...');
  console.log(`Active monitors: ${activeTasks.size}`);
  process.exit(0);
});

module.exports = app;
