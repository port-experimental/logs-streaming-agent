# Port Kafka Self-Service Actions - POC Documentation

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Workflow Diagram](#workflow-diagram)
- [Key Findings](#key-findings)
- [Message Structure](#message-structure)
- [Updating Action Status](#updating-action-status)
- [Setup Instructions](#setup-instructions)
- [Implementation Guide](#implementation-guide)
- [Testing](#testing)
- [Best Practices](#best-practices)

---

## Overview

This POC demonstrates how to consume Self-Service Action invocations from Port's Kafka topic and report execution status back to Port's API.

### What is Port Kafka SSA?

Port manages a dedicated Kafka topic per organization that publishes action execution requests. When a user triggers a self-service action in Port, the invocation is published to your organization's Kafka topic, allowing you to process it with any backend system.

### Key Components

1. **Kafka Topic** - Port-managed topic that receives action invocations
2. **Consumer Application** - Your code that listens to the topic
3. **Action Handler** - Business logic that executes the action
4. **Port API** - Used to report status, logs, and results back to Port

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Port Platform                            │
│                                                                  │
│  ┌──────────────┐                                               │
│  │   User       │  Triggers Action                              │
│  │   Portal     │────────────┐                                  │
│  └──────────────┘            │                                  │
│                              ▼                                  │
│                    ┌──────────────────┐                         │
│                    │  Action Engine   │                         │
│                    └────────┬─────────┘                         │
│                             │                                   │
│                             │ Publishes to Kafka                │
└─────────────────────────────┼─────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Kafka Topic     │
                    │  ORG_ID.runs     │
                    └────────┬─────────┘
                             │
                             │ Consumes
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Your Infrastructure                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Kafka Consumer Application                      │  │
│  │                                                            │  │
│  │  ┌──────────────┐      ┌──────────────┐                  │  │
│  │  │   Message    │──────▶│   Action     │                  │  │
│  │  │   Parser     │      │   Handler    │                  │  │
│  │  └──────────────┘      └──────┬───────┘                  │  │
│  │                               │                            │  │
│  │                               │ Execute Business Logic     │  │
│  │                               ▼                            │  │
│  │                        ┌──────────────┐                    │  │
│  │                        │  Jenkins /   │                    │  │
│  │                        │  Terraform / │                    │  │
│  │                        │  K8s / etc   │                    │  │
│  │                        └──────┬───────┘                    │  │
│  │                               │                            │  │
│  └───────────────────────────────┼────────────────────────────┘  │
│                                  │                               │
│                                  │ Reports Status                │
└──────────────────────────────────┼───────────────────────────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │   Port API       │
                         │  /actions/runs   │
                         │  /logs           │
                         │  /entities       │
                         └──────────────────┘
```

---

## Workflow Diagram

### Complete Action Execution Flow

```
┌─────────┐
│  Start  │
└────┬────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 1. User triggers action in Port UI  │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────┐
│ 2. Port publishes message to Kafka topic        │
│    Topic: ORG_ID.runs                           │
│    Message contains:                            │
│    - runId                                      │
│    - action details                             │
│    - user properties/inputs                     │
│    - entity context                             │
└────┬────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────┐
│ 3. Consumer receives message from Kafka         │
└────┬────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────┐
│ 4. Parse message and extract:                   │
│    - runId (for status updates)                 │
│    - action.identifier (which action)           │
│    - properties (user inputs)                   │
└────┬────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────┐
│ 5. Update Port: Status = IN_PROGRESS            │
│    PATCH /v1/actions/runs/{runId}               │
│    Body: { status: "IN_PROGRESS",              │
│            statusLabel: "Processing..." }       │
└────┬────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────┐
│ 6. Add initial log entry                        │
│    POST /v1/actions/runs/{runId}/logs           │
│    Body: { message: "Started processing..." }   │
└────┬────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────┐
│ 7. Execute business logic                       │
│    - Call external APIs                         │
│    - Trigger Jenkins job                        │
│    - Deploy infrastructure                      │
│    - Create resources                           │
└────┬────────────────────────────────────────────┘
     │
     ├─────────────────────────────────────────────┐
     │                                             │
     ▼                                             ▼
┌─────────────────────────────┐    ┌──────────────────────────────┐
│ 8a. SUCCESS PATH            │    │ 8b. FAILURE PATH             │
│                             │    │                              │
│ Add progress logs:          │    │ Capture error:               │
│ POST /logs (multiple times) │    │ - Error message              │
│                             │    │ - Stack trace                │
└────┬────────────────────────┘    └──────┬───────────────────────┘
     │                                     │
     ▼                                     ▼
┌─────────────────────────────┐    ┌──────────────────────────────┐
│ Update with links:          │    │ Report failure:              │
│ PATCH /runs/{runId}         │    │ POST /logs                   │
│ Body: {                     │    │ Body: {                      │
│   link: ["https://..."]     │    │   message: "Error: ...",     │
│ }                           │    │   terminationStatus: "FAIL", │
└────┬────────────────────────┘    │   statusLabel: "Failed"      │
     │                              │ }                            │
     ▼                              └──────────────────────────────┘
┌─────────────────────────────┐
│ Create/Update entity:       │
│ POST /blueprints/{id}/      │
│      entities               │
│ Params: { run_id: runId }   │
└────┬────────────────────────┘
     │
     ▼
┌─────────────────────────────┐
│ Final log with termination: │
│ POST /logs                  │
│ Body: {                     │
│   message: "Completed!",    │
│   terminationStatus:        │
│     "SUCCESS",              │
│   statusLabel: "Done"       │
│ }                           │
└────┬────────────────────────┘
     │
     ▼
┌─────────┐
│   End   │
└─────────┘
```

---

## Key Findings

### 1. Kafka Topic Structure

Port creates **two separate topics** per organization:

- **Actions Topic**: `ORG_ID.runs`
  - Contains action invocation messages
  - Triggered when users execute self-service actions
  
- **Changes Topic**: `ORG_ID.change.log`
  - Contains entity change events
  - Triggered when entities are created/updated/deleted

### 2. Consumer Group Requirements

Your consumer group ID must follow one of these patterns:
- Prefix with your org ID: `ORG_ID.my-consumer-group`
- Match your Port username

### 3. Authentication

**Kafka Authentication:**
- Mechanism: `SCRAM-SHA-512`
- SSL/TLS required
- Credentials provided by Port

**Port API Authentication:**
- OAuth 2.0 Client Credentials flow
- Endpoint: `POST https://api.getport.io/v1/auth/access_token`
- Token expires in ~1 hour
- Required for all status updates

### 4. Message Format

Messages are **base64 encoded** when received from Kafka (especially in AWS Lambda), but the decoded JSON structure is:

```json
{
  "context": {
    "runId": "r_abc123xyz",
    "blueprintIdentifier": "service",
    "entity": "my-service-id"
  },
  "payload": {
    "action": {
      "identifier": "deploy_service",
      "trigger": "CREATE",
      "blueprint": "service",
      "invocationMethod": {
        "type": "KAFKA"
      }
    },
    "properties": {
      "version": "1.2.3",
      "environment": "production",
      "region": "us-east-1"
    },
    "entity": {
      "identifier": "my-service",
      "title": "My Service",
      "properties": {}
    }
  },
  "trigger": {
    "by": {
      "user": {
        "email": "user@example.com",
        "userId": "user123"
      }
    },
    "at": "2024-11-06T19:54:00.000Z"
  }
}
```

### 5. Status Update Lifecycle

Actions have the following status flow:

```
IN_PROGRESS (initial) → SUCCESS or FAILURE (terminal)
```

**Important:**
- Initial status is automatically set to `IN_PROGRESS`
- You can update status multiple times before termination
- Once set to `SUCCESS` or `FAILURE`, the run is **locked**
- Use `terminationStatus` in log endpoint for final status

---

## Updating Action Status

### Method 1: PATCH /actions/runs/{runId}

**Use for:** Updating status, labels, and links during execution

```javascript
const response = await axios.patch(
  `https://api.getport.io/v1/actions/runs/${runId}`,
  {
    status: "IN_PROGRESS",  // or "SUCCESS" or "FAILURE"
    statusLabel: "Deploying to production...",
    link: [
      "https://jenkins.example.com/job/deploy/123",
      "https://logs.example.com/run/abc"
    ]
  },
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
);
```

**Fields:**
- `status`: `IN_PROGRESS`, `SUCCESS`, or `FAILURE`
- `statusLabel`: Custom message displayed in UI
- `link`: Array of URLs to external resources
- `summary`: Markdown summary of the run

**Notes:**
- Can be called multiple times
- Each call **overwrites** previous values for that field
- Setting status to `SUCCESS` or `FAILURE` terminates the run

### Method 2: POST /actions/runs/{runId}/logs

**Use for:** Adding log entries and optionally terminating

```javascript
const response = await axios.post(
  `https://api.getport.io/v1/actions/runs/${runId}/logs`,
  {
    message: "Deployment completed successfully!",
    terminationStatus: "SUCCESS",  // Optional - terminates run
    statusLabel: "Deployed"         // Optional
  },
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
);
```

**Fields:**
- `message`: Log message (required)
- `terminationStatus`: `SUCCESS` or `FAILURE` (optional, terminates run)
- `statusLabel`: Custom status label (optional)

**Notes:**
- Can be called multiple times for logs
- `terminationStatus` can only be sent **once**
- After termination, no more updates allowed

### Method 3: Create/Update Entity with run_id

**Use for:** Linking created entities to the action run

```javascript
const response = await axios.post(
  `https://api.getport.io/v1/blueprints/vm/entities`,
  {
    identifier: "vm-prod-001",
    title: "Production VM 001",
    properties: {
      cpu_cores: 4,
      memory_size: 16,
      region: "us-east-1"
    }
  },
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    params: {
      run_id: runId  // Links entity to action run
    }
  }
);
```

**Benefits:**
- Automatically links entity to action run
- Entity appears in action run details
- Provides traceability

---

## Setup Instructions

### 1. Prerequisites

- Node.js 14+ installed
- Port account with Kafka enabled
- Port API credentials (Client ID & Secret)
- Kafka credentials from Port

### 2. Install Dependencies

```bash
npm install kafkajs axios dotenv
```

### 3. Configure Environment Variables

Create a `.env` file:

```env
# Port API Credentials
PORT_CLIENT_ID=your_client_id_here
PORT_CLIENT_SECRET=your_client_secret_here
PORT_ORG_ID=your_org_id_here

# Kafka Configuration
KAFKA_BROKERS=broker1.kafka.port.io:9092,broker2.kafka.port.io:9092
KAFKA_USERNAME=your_kafka_username
KAFKA_PASSWORD=your_kafka_password
KAFKA_CONSUMER_GROUP_ID=your_org_id.my-consumer-group
```

### 4. Get Credentials from Port

**API Credentials:**
1. Go to Port → Settings → Developers
2. Create new API credentials
3. Copy Client ID and Secret

**Kafka Credentials:**
1. Contact Port support or check documentation
2. Request Kafka broker addresses and credentials
3. Note your organization ID

### 5. Run the Consumer

```bash
node port-kafka-consumer.js
```

Expected output:
```
🚀 Port Kafka Consumer Starting
================================================================================
📊 Configuration:
   - Organization ID: org_abc123
   - Actions Topic: org_abc123.runs
   - Changes Topic: org_abc123.change.log
   - Consumer Group: org_abc123.my-consumer-group
   - Kafka Brokers: broker1.kafka.port.io:9092, broker2.kafka.port.io:9092

🔌 Connecting to Kafka...
✅ Connected to Kafka
📡 Subscribing to topic: org_abc123.runs
✅ Subscribed to actions topic
================================================================================
✅ Consumer Ready - Waiting for messages...
================================================================================
```

---

## Implementation Guide

### Basic Consumer Structure

```javascript
const { Kafka } = require('kafkajs');
const axios = require('axios');

class PortKafkaConsumer {
  constructor(config) {
    // Initialize Kafka client
    this.kafka = new Kafka({
      clientId: 'port-consumer',
      brokers: config.kafkaBrokers,
      ssl: true,
      sasl: {
        mechanism: 'scram-sha-512',
        username: config.kafkaUsername,
        password: config.kafkaPassword,
      },
    });
    
    this.consumer = this.kafka.consumer({ 
      groupId: config.consumerGroupId 
    });
  }

  async start() {
    await this.consumer.connect();
    await this.consumer.subscribe({ 
      topic: `${this.orgId}.runs` 
    });
    
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const data = JSON.parse(message.value.toString());
        await this.processAction(data);
      },
    });
  }
}
```

### Action Handler Pattern

```javascript
async handleAction(message) {
  const { runId } = message.context;
  const { identifier } = message.payload.action;
  const properties = message.payload.properties;

  // Route to specific handler
  switch (identifier) {
    case 'deploy_service':
      await this.deployService(runId, properties);
      break;
    case 'create_vm':
      await this.createVM(runId, properties);
      break;
    default:
      await this.handleUnknownAction(runId, identifier);
  }
}
```

### Error Handling

```javascript
async processActionMessage(message) {
  const runId = message.context.runId;
  
  try {
    // Update to in-progress
    await this.updateActionRun(runId, {
      status: 'IN_PROGRESS',
      statusLabel: 'Processing...'
    });

    // Execute action
    await this.handleAction(message);

    // Report success
    await this.addActionRunLog(
      runId,
      'Action completed successfully',
      'SUCCESS',
      'Completed'
    );

  } catch (error) {
    // Report failure
    await this.addActionRunLog(
      runId,
      `Action failed: ${error.message}`,
      'FAILURE',
      'Failed'
    );
  }
}
```

---

## Testing

### 1. Create a Test Action in Port

1. Go to Port → Self-Service
2. Create new action:
   - **Identifier**: `test_action`
   - **Backend**: Kafka
   - **Inputs**: Add test properties (e.g., `message`, `count`)

### 2. Trigger the Action

1. Navigate to the entity or catalog page
2. Click the action button
3. Fill in the inputs
4. Execute

### 3. Monitor Logs

**Consumer logs:**
```
📨 Processing Action Invocation
================================================================================
🔹 Run ID: r_abc123xyz
🔹 Action: test_action
🔹 Trigger: CREATE
🔹 Blueprint: service
🔹 User: user@example.com

✅ Updated action run r_abc123xyz: IN_PROGRESS
📝 Added log to action run r_abc123xyz
🔧 Executing action handler...
```

**Port UI:**
- Go to Audit Log → Action Runs
- Find your run by ID
- View status, logs, and links

### 4. Verify Status Updates

Check that the action run shows:
- ✅ Status updates (IN_PROGRESS → SUCCESS/FAILURE)
- ✅ Log entries
- ✅ External links (if added)
- ✅ Created entities (if applicable)

---

## Best Practices

### 1. Token Management

```javascript
// Cache tokens to avoid rate limits
async getAccessToken() {
  if (this.accessToken && Date.now() < this.tokenExpiry) {
    return this.accessToken;
  }
  
  // Fetch new token
  const response = await axios.post(
    'https://api.getport.io/v1/auth/access_token',
    {
      clientId: this.clientId,
      clientSecret: this.clientSecret
    }
  );
  
  this.accessToken = response.data.accessToken;
  this.tokenExpiry = Date.now() + (55 * 60 * 1000); // 55 min
  
  return this.accessToken;
}
```

### 2. Idempotency

```javascript
// Use action runId as idempotency key
async processAction(message) {
  const runId = message.context.runId;
  
  // Check if already processed
  if (await this.isProcessed(runId)) {
    console.log(`Action ${runId} already processed, skipping`);
    return;
  }
  
  // Process and mark as done
  await this.executeAction(message);
  await this.markProcessed(runId);
}
```

### 3. Graceful Shutdown

```javascript
// Handle SIGTERM/SIGINT
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await consumer.disconnect();
  process.exit(0);
});
```

### 4. Logging Strategy

```javascript
// Provide meaningful progress updates
await this.addActionRunLog(runId, 'Step 1/5: Validating inputs...');
await this.addActionRunLog(runId, 'Step 2/5: Building container...');
await this.addActionRunLog(runId, 'Step 3/5: Pushing to registry...');
await this.addActionRunLog(runId, 'Step 4/5: Deploying to cluster...');
await this.addActionRunLog(runId, 'Step 5/5: Verifying deployment...');
```

### 5. External Links

```javascript
// Add links to external systems
await this.updateActionRun(runId, {
  link: [
    `https://jenkins.example.com/job/deploy/${buildNumber}`,
    `https://grafana.example.com/dashboard/${serviceId}`,
    `https://logs.example.com/query?runId=${runId}`
  ],
  statusLabel: 'Deployment in progress'
});
```

### 6. Entity Linking

```javascript
// Always link created entities to the action run
await this.upsertEntity(
  'deployment',
  {
    identifier: `deploy-${timestamp}`,
    title: 'Production Deployment',
    properties: { ... }
  },
  runId  // This creates the link
);
```

### 7. Error Context

```javascript
catch (error) {
  // Provide detailed error information
  await this.addActionRunLog(
    runId,
    `Failed at step: ${currentStep}\nError: ${error.message}\nStack: ${error.stack}`,
    'FAILURE',
    `Failed: ${error.message}`
  );
}
```

---

## Data Points Summary

### Critical Information

| Data Point | Value/Location | Purpose |
|------------|----------------|---------|
| **Organization ID** | Provided by Port | Topic naming, consumer group |
| **Actions Topic** | `ORG_ID.runs` | Consume action invocations |
| **Changes Topic** | `ORG_ID.change.log` | Consume entity changes |
| **Consumer Group** | `ORG_ID.your-name` | Kafka consumer group ID |
| **Run ID** | `message.context.runId` | Track and update action runs |
| **Action Identifier** | `message.payload.action.identifier` | Route to correct handler |
| **User Inputs** | `message.payload.properties` | Action parameters |
| **Port API Base** | `https://api.getport.io/v1` | All API calls |
| **Auth Endpoint** | `/auth/access_token` | Get access token |
| **Update Run** | `PATCH /actions/runs/{runId}` | Update status/links |
| **Add Logs** | `POST /actions/runs/{runId}/logs` | Add log entries |
| **Create Entity** | `POST /blueprints/{id}/entities?run_id={runId}` | Link entities to run |

### Message Structure Keys

```javascript
// Essential fields to extract
const runId = message.context.runId;
const actionId = message.payload.action.identifier;
const trigger = message.payload.action.trigger;
const blueprint = message.payload.action.blueprint;
const properties = message.payload.properties;
const entityId = message.payload.entity?.identifier;
const userEmail = message.trigger.by.user.email;
```

---

## Next Steps

1. **Customize Action Handlers**: Implement specific logic for your actions
2. **Add Monitoring**: Integrate with your observability stack
3. **Scale Horizontally**: Deploy multiple consumers with same group ID
4. **Add Retry Logic**: Handle transient failures gracefully
5. **Implement Circuit Breakers**: Protect downstream services
6. **Add Metrics**: Track processing time, success rate, etc.
7. **Security Hardening**: Rotate credentials, use secrets manager
8. **Deploy to Production**: Use AWS Lambda, Kubernetes, or ECS

---

## Troubleshooting

### Consumer not receiving messages

- ✅ Verify Kafka credentials
- ✅ Check consumer group ID format
- ✅ Ensure topic name is correct
- ✅ Verify network connectivity to Kafka brokers

### Authentication failures

- ✅ Verify Port API credentials
- ✅ Check token expiry handling
- ✅ Ensure correct API endpoint

### Status updates not appearing

- ✅ Verify runId is correct
- ✅ Check API response for errors
- ✅ Ensure token is valid
- ✅ Verify action run exists in Port

### Messages not being processed

- ✅ Check for JSON parsing errors
- ✅ Verify message structure
- ✅ Check consumer logs for exceptions
- ✅ Ensure consumer is running

---

## Resources

- [Port Kafka Documentation](https://docs.port.io/actions-and-automations/setup-backend/webhook/kafka/)
- [Port API Reference](https://docs.port.io/api-reference/port-api)
- [Update Action Run API](https://docs.port.io/api-reference/update-an-action-run)
- [Add Log to Action Run](https://docs.port.io/api-reference/add-a-log-to-an-action-run)
- [KafkaJS Documentation](https://kafka.js.org/)

---

**POC Created**: November 2024  
**Status**: ✅ Complete and Tested
