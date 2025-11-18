"use strict";
/**
 * Generic CI/CD Webhook Server with Plugin Support
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load .env from monorepo root
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../../.env') });
const express_1 = __importDefault(require("express"));
const shared_1 = require("@cicd/shared");
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Store active build monitoring tasks
const activeTasks = new Map();
/**
 * Initialize and register CI/CD providers based on environment config
 */
function initializeProviders() {
    shared_1.logger.info('\n🔌 Initializing CI/CD Providers...');
    shared_1.logger.info('='.repeat(80));
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
            shared_1.logger.error(`Failed to register Jenkins provider: ${errorMsg}`);
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
            shared_1.logger.error(`Failed to register CircleCI provider: ${errorMsg}`);
        }
    }
    const registeredProviders = shared_1.pluginRegistry.getProviderNames();
    shared_1.logger.info(`\n✅ Registered providers: ${registeredProviders.join(', ')}`);
    shared_1.logger.info('='.repeat(80) + '\n');
}
/**
 * Generic webhook handler for any CI/CD provider
 */
async function handleWebhook(providerName, payload) {
    const provider = shared_1.pluginRegistry.getProvider(providerName);
    if (!provider) {
        throw new Error(`Provider ${providerName} not registered`);
    }
    // Parse webhook payload
    const buildData = provider.parseWebhookPayload(payload);
    const normalizedData = provider.normalizeBuildData(buildData);
    shared_1.logger.info(`\n📨 ${providerName.toUpperCase()} Webhook Received`);
    shared_1.logger.info(`Build: #${normalizedData.buildNumber}`);
    shared_1.logger.info(`Status: ${normalizedData.status}`);
    shared_1.logger.info(`URL: ${normalizedData.buildUrl}`);
    const taskKey = `${providerName}-${normalizedData.buildId}`;
    // Handle based on build status
    if (normalizedData.status === 'running' || normalizedData.status === 'pending') {
        shared_1.logger.info(`\n📊 Starting real-time log capture for build #${normalizedData.buildNumber}...`);
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
                shared_1.logger.info('\n--- Build Status ---');
                shared_1.logger.info(`Result: ${buildStatus.result}`);
                shared_1.logger.info(`Duration: ${buildStatus.duration}ms`);
                shared_1.logger.info(`\n✅ Build #${normalizedData.buildNumber} completed: ${buildStatus.result}`);
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                shared_1.logger.error(`\n❌ Error monitoring build #${normalizedData.buildNumber}: ${errorMsg}`);
            }
            finally {
                activeTasks.delete(taskKey);
            }
        }
    }
    else {
        // Build already completed, just fetch logs
        shared_1.logger.info(`\n📥 Fetching logs for completed build #${normalizedData.buildNumber}...`);
        try {
            const logs = await provider.getCompleteLogs(normalizedData.buildId);
            shared_1.logger.info(`✅ Logs retrieved for build #${normalizedData.buildNumber} (${normalizedData.status})`);
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            shared_1.logger.error(`❌ Error fetching logs: ${errorMsg}`);
        }
    }
}
/**
 * Setup webhook routes dynamically based on registered providers
 */
function setupWebhookRoutes() {
    const routes = shared_1.pluginRegistry.getWebhookRoutes();
    routes.forEach(({ path, provider }) => {
        app.post(path, async (req, res) => {
            try {
                const payload = req.body;
                // Validate webhook if provider supports it
                if (!provider.validateWebhook(req.headers, payload)) {
                    shared_1.logger.warn(`Invalid webhook signature for ${provider.getName()}`);
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
                }
                catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    shared_1.logger.error(`Error handling webhook: ${errorMsg}`);
                }
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                shared_1.logger.error('Webhook endpoint error:', errorMsg);
                res.status(500).json({
                    error: 'Internal server error',
                    message: errorMsg
                });
            }
        });
        shared_1.logger.info(`📍 Registered webhook route: POST ${path}`);
    });
}
/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeMonitors: activeTasks.size,
        activeTasks: Array.from(activeTasks.keys()),
        registeredProviders: shared_1.pluginRegistry.getProviderNames(),
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
        providers: shared_1.pluginRegistry.getProviderNames(),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});
// Global error handlers
app.use((err, req, res, next) => {
    shared_1.logger.error('Unhandled error:', err);
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
    // Initialize providers
    initializeProviders();
    // Setup webhook routes
    setupWebhookRoutes();
    shared_1.logger.info('\n🚀 CI/CD Webhook Server Started');
    shared_1.logger.info('='.repeat(80));
    shared_1.logger.info(`📡 Listening on port ${PORT}`);
    shared_1.logger.info(`💚 Health check: http://localhost:${PORT}/health`);
    shared_1.logger.info(`📊 Status: http://localhost:${PORT}/status`);
    shared_1.logger.info('='.repeat(80));
    shared_1.logger.info('\n⏳ Waiting for webhooks...\n');
});
// Handle server errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        shared_1.logger.error(`Port ${PORT} is already in use`);
    }
    else {
        shared_1.logger.error('Server error:', error);
    }
    process.exit(1);
});
// Graceful shutdown
process.on('SIGINT', () => {
    shared_1.logger.info('\n\n👋 Shutting down webhook server...');
    shared_1.logger.info(`Active monitors: ${activeTasks.size}`);
    server.close(() => {
        shared_1.logger.info('Server closed');
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    shared_1.logger.info('\n\n👋 SIGTERM received, shutting down...');
    server.close(() => {
        shared_1.logger.info('Server closed');
        process.exit(0);
    });
});
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    shared_1.logger.error('Uncaught exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    shared_1.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
exports.default = app;
//# sourceMappingURL=server.js.map