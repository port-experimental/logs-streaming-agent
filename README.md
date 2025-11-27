# CI/CD Integration Monorepo

A **pluggable, TypeScript-based monorepo** for integrating multiple CI/CD providers (Jenkins, CircleCI, GitHub Actions, etc.) with Port.io using Yarn workspaces.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18.0-green.svg)](https://nodejs.org/)
[![Yarn](https://img.shields.io/badge/Yarn-Workspaces-2c8ebb.svg)](https://yarnpkg.com/)

## What This Does

### Port Kafka Self-Service Actions
- **Kafka consumer**: Connect to Port's managed Kafka topics
- **Action routing**: Route actions to specific handlers based on identifier
- **Status updates**: Report progress back to Port in real-time
- **Stage tracking**: Real-time Jenkins pipeline stage visibility in Port status labels
- **Log streaming**: Add log entries visible in Port UI
- **Entity linking**: Create/update entities linked to action runs
- **Error handling**: Graceful error handling with failure reporting
- **Example handlers**: Pre-built handlers for common actions (deploy, scaffold, scale, etc.)
- **Jenkins integration**: Trigger builds and stream logs with stage-by-stage progress tracking

## Quick Start

```bash
# 1. Install dependencies
yarn install

# 2. Build all packages
yarn build

# Run the consumer
npm run kafka:consumer
```

---

## Jenkins Log Capture Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get Jenkins API Token

1. Log into your Jenkins server
2. Click your name (top right corner) → **Configure**
3. Scroll to **API Token** section
4. Click **Add new Token**
5. Give it a name and click **Generate**
6. Copy the generated token (you won't be able to see it again!)

### 3. Configure environment variables

Create a `.env` file from the example:

```bash
cp .env.example .env
# Edit .env with your credentials

# 4. Run services
yarn dev:webhook    # Terminal 1
yarn dev:kafka      # Terminal 2
```

## Packages

| Package | Description | Entry Point |
|---------|-------------|-------------|
| **`@cicd/shared`** | Core interfaces, providers, and utilities | `packages/shared/src/index.ts` |
| **`@cicd/webhook-service`** | Generic webhook server with auto-registration | `packages/webhook-service/src/server.ts` |
| **`@cicd/kafka-consumer-service`** | Port.io Kafka consumer for action handling | `packages/kafka-consumer-service/src/consumer.ts` |

## Supported Providers

| Provider | Status | Trigger Builds | Stream Logs | Webhooks |
|----------|--------|----------------|-------------|----------|
| **Jenkins** | Ready | | | |
| **CircleCI** | Ready | | | |
| **GitHub Actions** | Coming Soon | - | - | - |
| **GitLab CI** | Coming Soon | - | - | - |

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Jenkins (optional - only if you want Jenkins support)
JENKINS_URL=http://localhost:8080
JENKINS_USERNAME=admin
JENKINS_API_TOKEN=your-token
JENKINS_JOB_NAME=your-job

# CircleCI (optional - only if you want CircleCI support)
CIRCLECI_API_TOKEN=your-token
CIRCLECI_PROJECT_SLUG=gh/username/repo
CIRCLECI_WEBHOOK_SECRET=your-secret

# Port.io (required for Kafka consumer)
PORT_CLIENT_ID=your-client-id
PORT_CLIENT_SECRET=your-secret
PORT_ORG_ID=your-org-id

# Kafka (required for Kafka consumer)
KAFKA_BROKERS=broker1:9092,broker2:9092
KAFKA_USERNAME=your-username
KAFKA_PASSWORD=your-password
KAFKA_CONSUMER_GROUP_ID=your-org-id.consumer-group

# General
WEBHOOK_PORT=3000
LOG_LEVEL=info
NODE_ENV=development

# Port Entity Auto-Creation (optional)
AUTO_CREATE_ENTITIES=true              # Enable/disable auto-creation after builds
ENTITY_BLUEPRINT_ID=microservice       # Default blueprint for auto-created entities
```

## 📖 Usage

### Webhook Service

Receives webhooks from CI/CD providers and streams build logs:

```bash
# Start webhook server
yarn dev:webhook

# Test health endpoint
curl http://localhost:3000/health

# Check registered providers
curl http://localhost:3000/status
```

**Webhook Endpoints:**
- `POST /webhook/jenkins` - Jenkins webhooks
- `POST /webhook/circleci` - CircleCI webhooks
- `GET /health` - Health check
- `GET /status` - Service status

### Kafka Consumer

Consumes Port.io actions and triggers builds:

```bash
# Start Kafka consumer
yarn dev:kafka
```

**List only webhook-captured logs:**
```bash
curl http://localhost:3000/logs/webhook
```

**Download a specific log:**
```bash
curl http://localhost:3000/logs/webhookstream-testJfrogPipeline-build-47-1699219234567.log
```

### File Naming Convention

Logs are saved with different prefixes to easily distinguish their source:

- **Webhook logs**: `webhookstream-{job}-build-{number}-{timestamp}.log`
- **Manual logs**: `{job}-build-{number}-{timestamp}.log`

Example:
```
logs/
├── webhookstream-testJfrogPipeline-build-10-1699219234567.log  ← From webhook
├── webhookstream-testJfrogPipeline-build-11-1699219456789.log  ← From webhook
└── testJfrogPipeline-build-9-1699218123456.log                 ← Manual capture
```

---

## How It Works

### Real-time Streaming

The application uses Jenkins' `progressiveText` API endpoint to fetch logs incrementally:

1. Polls `/job/{jobName}/{buildNumber}/logText/progressiveText?start={position}`
2. Uses `start` parameter to get only new log content since last request
3. Checks `X-More-Data` response header to determine if build is still running
4. Checks `X-Text-Size` header to know the next starting position
5. Continues polling until build completes (when `X-More-Data` is `false`)

### Post-build Retrieval

For completed builds, uses `/job/{jobName}/{buildNumber}/consoleText` to fetch complete console output in one request.

## API Reference

## Jenkins Pipeline Stage Tracking

The Port Kafka consumer includes advanced Jenkins pipeline stage tracking that provides real-time visibility into pipeline execution.

### Features

- **Real-time stage updates**: Polls Jenkins Workflow API every 1 second to detect stage changes
- **Stage transitions**: Tracks both IN_PROGRESS and completion states for each stage
- **Status label updates**: Updates Port action run status labels with current stage information
- **Duration tracking**: Shows how long each stage takes to complete
- **Continuous monitoring**: Continues polling until build actually completes (not just when logs stop)

### How It Works

1. **Immediate polling**: Starts checking stages immediately when build is triggered
2. **Fast intervals**: Polls every 1 second to catch quick stage transitions
3. **Comprehensive tracking**: Uses `getAllStages()` to track all stages including completed ones
4. **Unique transitions**: Tracks each stage transition (e.g., "Deploy-IN_PROGRESS" and "Deploy-SUCCESS") separately
5. **Build completion**: Waits for build to fully complete before stopping stage monitoring

### Stage Visibility in Port

When a Jenkins build runs, you'll see status label updates like:

```
Build #42 - Running: Deployment Info
Build #42 - Completed: Deployment Info (3s)
Build #42 - Running: Checkout
Build #42 - Completed: Checkout (30s)
Build #42 - Running: Install
Build #42 - Completed: Install (30s)
Build #42 - Running: Test
Build #42 - Completed: Test (30s)
Build #42 - Running: Build
Build #42 - Completed: Build (30s)
Build #42 - Running: Deploy
Build #42 - Completed: Deploy (30s)
Build #42 - SUCCESS (2m 45s)
```

### Pipeline Stage Delays

The included `Jenkinsfile` has configurable `sleep` delays in each stage to make them visible in the Port UI. You can adjust these delays based on your needs:

```groovy
stage('Checkout') {
  steps {
    echo '📥 Checking out source code...'
    checkout scm
    sleep 30  // Adjust this value (in seconds)
  }
}
```

**Recommended values:**
- **Development/Demo**: 10-30 seconds per stage for clear visibility
- **Production**: Remove or reduce to 1-2 seconds to minimize overhead

### JenkinsLogCapture Class

You can also use this as a module in your own Node.js applications:

```javascript
const JenkinsLogCapture = require('./jenkins-log-capture');

const capture = new JenkinsLogCapture({
  jenkinsUrl: 'http://localhost:8080',
  username: 'your-username',
  apiToken: 'your-api-token',
  jobName: 'your-job-name'
});

// Example: Monitor latest build
(async () => {
  const buildNumber = await capture.getLatestBuildNumber();
  await capture.monitorBuild(buildNumber);
})();
```

#### Methods

##### `getLatestBuildNumber()`
Returns the latest build number for the configured job.

```javascript
const buildNumber = await capture.getLatestBuildNumber();
console.log(`Latest build: #${buildNumber}`);
```

##### `getBuildStatus(buildNumber)`
Gets detailed status information for a specific build.

```javascript
const status = await capture.getBuildStatus(42);
console.log(status);
// {
//   number: 42,
//   result: 'SUCCESS',
//   building: false,
//   duration: 45000,
//   timestamp: 1699219234567
// }
```

##### `streamLogs(buildNumber, onLogChunk, pollInterval)`
Streams logs in real-time with a callback for each chunk.

```javascript
await capture.streamLogs(42, (chunk) => {
  console.log(chunk);
}, 2000); // Poll every 2 seconds
```

##### `getAllStages(buildNumber)`
Gets all stages for a build from the Jenkins Workflow API.

```javascript
const stages = await capture.getAllStages(42);
console.log(stages);
// [
//   { name: 'Checkout', status: 'SUCCESS', durationMillis: 2000 },
//   { name: 'Build', status: 'IN_PROGRESS', durationMillis: null },
//   { name: 'Deploy', status: 'NOT_EXECUTED', durationMillis: null }
// ]
```

**Note**: Requires the [Pipeline: Stage View Plugin](https://plugins.jenkins.io/pipeline-stage-view/) to be installed in Jenkins.

##### `getCurrentStage(buildNumber)`
Gets the currently running or last completed stage.

```javascript
const stage = await capture.getCurrentStage(42);
console.log(stage);
// { name: 'Build', status: 'IN_PROGRESS', durationMillis: 15000 }
```

##### `getConsoleOutput(buildNumber)`
Gets the complete console output for a build.

```javascript
const logs = await capture.getConsoleOutput(42);
console.log(logs);
```

##### `saveLogsToFile(buildNumber, outputDir)`
Saves logs to a file in the specified directory.

```javascript
const filename = await capture.saveLogsToFile(42, './logs');
console.log(`Saved to: ${filename}`);
```

##### `monitorBuild(buildNumber, saveToFile)`
Monitors a build, streams logs, and optionally saves to file.

```javascript
const result = await capture.monitorBuild(42, true);
console.log(result.status);
```

##### `waitForNewBuild(previousBuildNumber, timeout)`
Waits for a new build to start (useful after triggering a build).

```javascript
const newBuildNumber = await capture.waitForNewBuild(41, 300000); // 5 min timeout
console.log(`New build: #${newBuildNumber}`);
```

## Log Files

Logs are automatically saved to the `./logs/` directory with the following naming format:

```
{jobName}-build-{buildNumber}-{timestamp}.log
```

Example: `your-node-app-build-42-1699219234567.log`

## Troubleshooting

### Authentication errors

```
Error: Failed to get latest build: Request failed with status code 401
```

**Solutions:**
- Verify your API token is correct (regenerate if needed)
- Ensure username matches your Jenkins login exactly
- Check that the token hasn't expired

### Connection errors

```
Error: connect ECONNREFUSED 127.0.0.1:8080
```

**Solutions:**
- Verify Jenkins server is running and accessible
- Check firewall/network settings
- Ensure Jenkins URL includes the correct protocol (`http://` or `https://`)
- Test the URL in your browser first

### Job not found

```
Error: Failed to get latest build: Request failed with status code 404
```

**Solutions:**
- Verify job name matches exactly (case-sensitive)
- For jobs in folders, use format: `folder-name/job-name`
- Check that the job exists and you have permission to access it

### No builds found

```
No builds found
```

**Solutions:**
- Run at least one build in Jenkins first
- Verify the job has been executed at least once

### Stage tracking not working

```
Workflow API not available (404). Install 'Pipeline: Stage View Plugin' in Jenkins.
```

**Solutions:**
- Install the **Pipeline: Stage View Plugin** in Jenkins
  1. Go to Jenkins → Manage Jenkins → Manage Plugins
  2. Click the "Available" tab
  3. Search for "Pipeline: Stage View"
  4. Check the box and click "Install without restart"
- Verify your pipeline is using declarative or scripted pipeline syntax
- Ensure the build has at least started (stages won't appear until build begins)

### Stages completing too fast to see

**Solutions:**
- Add `sleep` delays in your Jenkinsfile stages (see Pipeline Stage Delays section)
- Reduce the polling interval in `port-kafka-consumer.js` (currently 1 second)
- Check that the stage tracking is starting immediately (not waiting for first poll)

## Security Best Practices

- ✅ **Never commit `.env` file** to version control (already in `.gitignore`)
- ✅ **Use Jenkins API tokens**, not passwords
- ✅ **Limit API token permissions** if possible in Jenkins security settings
- ✅ **Store tokens securely** in production environments (use secrets management)
- ✅ **Rotate tokens regularly** for better security
- ✅ **Use HTTPS** for Jenkins URL in production

## Integration Examples

### Trigger build and capture logs

```javascript
const JenkinsLogCapture = require('./jenkins-log-capture');

const capture = new JenkinsLogCapture({
  jenkinsUrl: process.env.JENKINS_URL,
  username: process.env.JENKINS_USERNAME,
  apiToken: process.env.JENKINS_API_TOKEN,
  jobName: process.env.JENKINS_JOB_NAME
});

(async () => {
  // Get current build number
  const currentBuild = await capture.getLatestBuildNumber();
  
  // Trigger a new build (you'd use Jenkins API for this)
  // ... trigger build code ...
  
  // Wait for new build and monitor it
  const newBuild = await capture.waitForNewBuild(currentBuild);
  const result = await capture.monitorBuild(newBuild);
  
  console.log(`Build ${result.status.result}`);
})();
```

### Capture logs for multiple builds

```javascript
const builds = [42, 43, 44];

for (const buildNumber of builds) {
  await capture.saveLogsToFile(buildNumber);
}
```

### Entity Auto-Creation

When `AUTO_CREATE_ENTITIES=true`, the system automatically creates/updates a Port entity after successful builds:

- `GET /job/{name}/api/json` - Get job information
- `GET /job/{name}/{number}/api/json` - Get build information
- `GET /job/{name}/{number}/consoleText` - Get complete console output
- `GET /job/{name}/{number}/logText/progressiveText` - Stream logs progressively
- `GET /job/{name}/{number}/wfapi/describe` - Get pipeline stage information (requires Pipeline: Stage View Plugin)

**Control auto-creation:**
```env
# Enable auto-creation (default: false)
AUTO_CREATE_ENTITIES=true

# Specify blueprint (default: microservice)
ENTITY_BLUEPRINT_ID=microservice
```

**Override per action:**
```json
{
  "properties": {
    "serviceName": "my-service",
    "version": "2.0.0",
    "environment": "production",
    "blueprintId": "custom-blueprint",
    "entityIdentifier": "custom-id",
    "entityProperties": {
      "custom_field": "value"
    }
  }
}
```

**Manual entity creation:**
```json
{
  "action": {
    "identifier": "create_entity"
  },
  "properties": {
    "blueprintId": "microservice",
    "title": "User Service",
    "identifier": "user-service-prod",
    "entityProperties": {
      "service_name": "user-service",
      "version": "1.0.0",
      "environment": "production"
    }
  }
}
```

## Development

### Available Commands

```bash
# Build all packages
yarn build

# Run services in dev mode (auto-reload)
yarn dev:webhook
yarn dev:kafka

# Type check all packages
yarn typecheck

# Clean build artifacts
yarn clean

# Build specific package
yarn workspace @cicd/shared build
```

### Project Structure

```
your-node-app/
├── packages/
│   ├── shared/                  # @cicd/shared
│   │   ├── src/
│   │   │   ├── core/            # Plugin system
│   │   │   ├── providers/       # CI/CD providers
│   │   │   └── utils/           # Shared utilities
│   │   └── package.json
│   │
│   ├── webhook-service/         # @cicd/webhook-service
│   │   ├── src/
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   └── kafka-consumer-service/  # @cicd/kafka-consumer-service
│       ├── src/
│       │   ├── consumer.ts
│       │   └── handlers/
│       └── package.json
│
├── .env                         # Environment variables
├── package.json                 # Root workspace config
└── tsconfig.json                # Root TypeScript config
```

## ➕ Adding a New Provider

### Step 1: Create Provider Class

Create `packages/shared/src/providers/your-provider/YourProvider.ts`:

```typescript
import { CIProviderInterface } from '../../core/CIProviderInterface';
import { BuildInfo, BuildStatusInfo } from '../../core/types';

export class YourProvider extends CIProviderInterface {
  getName() { return 'your-provider'; }
  
  validateConfig() {
    // Validate configuration
  }
  
  async triggerBuild(parameters) {
    // Trigger build logic
  }
  
  async getBuildStatus(buildId) {
    // Get build status
  }
  
  async streamLogs(buildId, onLogChunk) {
    // Stream logs in real-time
  }
  
  async getCompleteLogs(buildId) {
    // Get complete logs
  }
  
  parseWebhookPayload(payload) {
    // Parse webhook payload
  }
}
```

### Step 2: Export Provider

Add to `packages/shared/src/index.ts`:

```typescript
export * from './providers/your-provider/YourProvider';
```

### Step 3: Add Environment Variables

```env
YOUR_PROVIDER_API_TOKEN=token
YOUR_PROVIDER_PROJECT=project
```

### Step 4: Auto-Registration

Add to both services (webhook and Kafka consumer):

```typescript
if (process.env.YOUR_PROVIDER_API_TOKEN) {
  pluginRegistry.register(YourProvider, {
    apiToken: process.env.YOUR_PROVIDER_API_TOKEN,
    project: process.env.YOUR_PROVIDER_PROJECT,
  });
}
```

**That's it!** Your provider is now available in both services.

## Error Handling & Retry Logic

### HTTP Retry (All API Calls)

Automatic retry with exponential backoff:
- **Retries:** 3 attempts
- **Backoff:** 1s, 2s, 4s
- **Conditions:** Network errors, 5xx responses, timeouts

### Kafka Reconnection

Automatic reconnection on failure:
- **Retries:** 5 attempts
- **Backoff:** Exponential (5s, 10s, 15s, etc.)
- **Graceful shutdown:** On max retries

### Log Streaming Retry

Consecutive error tracking:
- **Max errors:** 5 consecutive failures
- **Retry delay:** 2 seconds
- **Fail-safe:** Throws after max attempts

## Logging

Winston-based logging with multiple transports:

```typescript
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');
logger.debug('Debug message');
```

**Log Outputs:**
- **Console:** Colorized, timestamped
- **`logs/error.log`:** Errors only
- **`logs/combined.log`:** All logs

**Configuration:**
```env
LOG_LEVEL=info  # debug | info | warn | error
```

## 🚢 Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json yarn.lock ./
COPY packages ./packages
RUN yarn install --frozen-lockfile
RUN yarn build
CMD ["node", "packages/webhook-service/dist/server.js"]
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webhook-service
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: webhook-service
        image: your-registry/webhook-service:latest
        envFrom:
        - secretRef:
            name: ci-secrets
```

## Troubleshooting

### Build Errors

```bash
yarn clean
yarn install
yarn build
```

### Provider Not Registered

Check environment variables are set:
```bash
echo $JENKINS_URL
echo $CIRCLECI_API_TOKEN
```

### Webhook Not Working

1. Check provider is registered: `curl http://localhost:3000/status`
2. Verify webhook URL format: `/webhook/{provider}`
3. Check logs for errors

### Kafka Consumer Not Connecting

1. Verify Kafka credentials
2. Check broker addresses are reachable
3. Ensure consumer group ID format is correct
4. Review consumer logs

## API Reference

### Webhook Endpoints

#### `POST /webhook/{provider}`

Receive webhook from CI/CD provider.

**Example:**
```bash
curl -X POST http://localhost:3000/webhook/jenkins \
  -H "Content-Type: application/json" \
  -d '{
    "jobName": "my-job",
    "buildNumber": 42,
    "status": "SUCCESS"
  }'
```

#### `GET /health`

- Node.js 14+ (for optional chaining support)
- Jenkins 2.0+ with REST API enabled
- Valid Jenkins user account with job read permissions
- **[Pipeline: Stage View Plugin](https://plugins.jenkins.io/pipeline-stage-view/)** (required for stage tracking feature)
  - Install via Jenkins → Manage Jenkins → Manage Plugins → Available → Search "Pipeline: Stage View"

**Response:**
```json
{
  "status": "healthy",
  "activeMonitors": 0,
  "registeredProviders": ["jenkins", "circleci"],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### `GET /status`

Service status and active tasks.

**Response:**
```json
{
  "activeTasks": [],
  "count": 0,
  "providers": ["jenkins", "circleci"],
  "uptime": 123.456
}
```

## 🤝 Contributing

1. Create a new provider following the guide above
2. Implement the `CIProviderInterface`
3. Export from `packages/shared/src/index.ts`
4. Add environment variables to `.env.example`
5. Update this README

## License

ISC

## Acknowledgments

- Built with TypeScript, Yarn Workspaces, and Express
- Integrates with Port.io for self-service actions
- Supports multiple CI/CD providers through a plugin system

---

**Made for DevOps teams**
