# CI/CD Integration Monorepo

A **pluggable, TypeScript-based monorepo** for integrating multiple CI/CD providers (Jenkins, CircleCI, GitHub Actions, etc.) with Port.io using Yarn workspaces.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18.0-green.svg)](https://nodejs.org/)
[![Yarn](https://img.shields.io/badge/Yarn-Workspaces-2c8ebb.svg)](https://yarnpkg.com/)

## What This Does

This monorepo provides a **plugin-based architecture** that allows you to:

- **Integrate any CI/CD provider** without modifying core code
- **Receive webhooks** from CI/CD platforms and stream build logs
- **Trigger builds** from Port.io self-service actions via Kafka
- **Stream logs to Port** in real-time
- **Add new providers** in under 30 minutes

## Quick Start

```bash
# 1. Install dependencies
yarn install

# 2. Build all packages
yarn build

# 3. Configure environment
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

**Example Port Action:**
```json
{
  "action": {
    "identifier": "trigger_build"
  },
  "properties": {
    "provider": "jenkins",
    "serviceName": "my-service",
    "version": "1.0.0",
    "environment": "production"
  }
}
```

### Entity Auto-Creation

When `AUTO_CREATE_ENTITIES=true`, the system automatically creates/updates a Port entity after successful builds:

**What gets created:**
- **Entity ID**: `{serviceName}-{environment}` (e.g., `my-service-production`)
- **Blueprint**: Specified by `ENTITY_BLUEPRINT_ID` (default: `microservice`)
- **Properties**: Build info, version, environment, timestamps, etc.

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

Health check endpoint.

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
