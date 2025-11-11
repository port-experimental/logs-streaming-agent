# Jenkins + Port Kafka Integration

## Overview

This integration enables Port Self-Service Actions (via Kafka) to trigger Jenkins builds and stream logs back to Port in real-time. Users can see Jenkins build logs directly in the Port UI without leaving the platform.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Port Platform                           │
│                                                              │
│  User triggers action → Kafka Topic (ORG_ID.runs)          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              port-kafka-consumer.js                          │
│                                                              │
│  1. Receives Kafka message                                  │
│  2. Triggers Jenkins build (with parameters)                │
│  3. Streams Jenkins logs in real-time                       │
│  4. Sends logs to Port API                                  │
│  5. Reports final status                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Jenkins Server                             │
│                                                              │
│  - Executes build pipeline                                  │
│  - Generates logs                                           │
│  - Returns build status                                     │
└─────────────────────────────────────────────────────────────┘
```

## Flow Diagram

```
Port UI (User clicks action)
    │
    ▼
Kafka Topic publishes message
    │
    ▼
Kafka Consumer receives message
    │
    ├─► Extract: serviceName, version, environment
    │
    ├─► Trigger Jenkins build with parameters
    │
    ├─► Update Port with Jenkins build link
    │
    ├─► Stream Jenkins logs (real-time)
    │   │
    │   ├─► Log chunk 1 → Port API
    │   ├─► Log chunk 2 → Port API
    │   ├─► Log chunk 3 → Port API
    │   └─► ...
    │
    ├─► Get final build status
    │
    └─► Report SUCCESS/FAILURE to Port
```

## Features

✅ **Real-time log streaming** - Jenkins logs appear in Port UI as they're generated  
✅ **Direct Jenkins links** - Clickable links to Jenkins build in Port  
✅ **Parameter passing** - Action inputs are passed as Jenkins build parameters  
✅ **Status tracking** - Build status (SUCCESS/FAILURE) reported back to Port  
✅ **Error handling** - Failures are captured and reported  
✅ **Audit trail** - All logs associated with Port action run  

## Prerequisites

1. **Jenkins Server** with:
   - REST API enabled
   - User with API token
   - Job configured to accept parameters (optional)

2. **Port Account** with:
   - Kafka enabled
   - API credentials (Client ID & Secret)
   - Kafka credentials

3. **Node.js** 14+ installed

## Setup Instructions

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Jenkins Configuration
JENKINS_URL=http://your-jenkins-server:8080
JENKINS_USERNAME=your-jenkins-username
JENKINS_API_TOKEN=your-jenkins-api-token
JENKINS_JOB_NAME=your-job-name

# Port API Credentials
PORT_CLIENT_ID=your_port_client_id
PORT_CLIENT_SECRET=your_port_client_secret
PORT_ORG_ID=org_your_org_id

# Kafka Configuration
KAFKA_BROKERS=broker1.kafka.port.io:9092,broker2.kafka.port.io:9092
KAFKA_USERNAME=your_kafka_username
KAFKA_PASSWORD=your_kafka_password
KAFKA_CONSUMER_GROUP_ID=org_your_org_id.jenkins-consumer
```

### 2. Create Jenkins API Token

1. Go to Jenkins → Your Profile → Configure
2. Under "API Token", click "Add new Token"
3. Give it a name (e.g., "Port Integration")
4. Copy the generated token
5. Add to `.env` as `JENKINS_API_TOKEN`

### 3. Configure Jenkins Job (Optional)

If you want to pass parameters from Port to Jenkins, configure your Jenkins job to accept parameters:

1. Go to your Jenkins job → Configure
2. Check "This project is parameterized"
3. Add String Parameters:
   - `SERVICE_NAME`
   - `VERSION`
   - `ENVIRONMENT`
   - `CHANGE_REASON`
   - `PORT_RUN_ID`

Example Jenkinsfile usage:

```groovy
pipeline {
  agent any
  
  parameters {
    string(name: 'SERVICE_NAME', defaultValue: 'my-service')
    string(name: 'VERSION', defaultValue: '1.0.0')
    string(name: 'ENVIRONMENT', defaultValue: 'dev')
    string(name: 'CHANGE_REASON', defaultValue: '')
    string(name: 'PORT_RUN_ID', defaultValue: '')
  }
  
  stages {
    stage('Deploy') {
      steps {
        echo "Deploying ${params.SERVICE_NAME} v${params.VERSION}"
        echo "Environment: ${params.ENVIRONMENT}"
        echo "Reason: ${params.CHANGE_REASON}"
        echo "Port Run ID: ${params.PORT_RUN_ID}"
        
        // Your deployment logic here
      }
    }
  }
}
```

### 4. Create Port Self-Service Action

In Port, create a new Self-Service Action with the following JSON:

```json
{
  "identifier": "deploy_microservice_kafka",
  "title": "Deploy Microservice (Kafka)",
  "icon": "Kafka",
  "description": "Deploy a microservice version via Kafka runner with Jenkins.",
  "trigger": {
    "type": "self-service",
    "operation": "CREATE",
    "userInputs": {
      "properties": {
        "serviceName": {
          "title": "Service Name",
          "type": "string",
          "minLength": 1,
          "description": "Name of the service to deploy"
        },
        "version": {
          "title": "Version (tag)",
          "type": "string",
          "minLength": 1,
          "description": "Version or tag to deploy"
        },
        "environment": {
          "title": "Environment",
          "type": "string",
          "enum": ["dev", "staging", "prod"],
          "default": "dev",
          "description": "Target environment"
        },
        "changeReason": {
          "title": "Reason (optional)",
          "type": "string",
          "description": "Reason for this deployment"
        }
      },
      "required": ["serviceName", "version", "environment"],
      "order": ["serviceName", "version", "environment", "changeReason"]
    }
  },
  "invocationMethod": {
    "type": "KAFKA",
    "payload": {
      "context": {
        "runId": "{{ .run.id }}",
        "by": {
          "userId": "{{ .trigger.by.user.id }}",
          "email": "{{ .trigger.by.user.email }}"
        },
        "timestamp": "{{ .now }}"
      },
      "action": {
        "identifier": "{{ .action.identifier }}",
        "title": "{{ .action.title }}"
      },
      "properties": {
        "serviceName": "{{ .inputs.serviceName }}",
        "version": "{{ .inputs.version }}",
        "environment": "{{ .inputs.environment }}",
        "changeReason": "{{ .inputs.changeReason }}"
      }
    }
  }
}
```

### 5. Start the Kafka Consumer

```bash
npm run kafka:consumer
```

Expected output:

```
🚀 Port Kafka Consumer Starting
================================================================================
📊 Configuration:
   - Organization ID: org_abc123
   - Actions Topic: org_abc123.runs
   - Consumer Group: org_abc123.jenkins-consumer
   - Kafka Brokers: broker1.kafka.port.io:9092, ...

🔌 Connecting to Kafka...
✅ Connected to Kafka
📡 Subscribing to topic: org_abc123.runs
✅ Subscribed to actions topic
================================================================================
✅ Consumer Ready - Waiting for messages...
================================================================================
```

## Testing

### 1. Trigger the Action in Port

1. Go to Port UI
2. Navigate to the page where the action is available
3. Click "Deploy Microservice (Kafka)"
4. Fill in the form:
   - Service Name: `my-service`
   - Version: `1.2.3`
   - Environment: `dev`
   - Reason: `Testing Jenkins integration`
5. Click "Execute"

### 2. Monitor in Port UI

In Port, you'll see:

1. **Action Run Created** - Status: IN_PROGRESS
2. **Initial Logs**:
   ```
   🚀 Starting service deployment via Jenkins...
   Deploying my-service v1.2.3 to dev...
   Reason: Testing Jenkins integration
   📡 Triggering Jenkins build...
   ✅ Jenkins build #42 started
   ```
3. **Jenkins Link** - Clickable link to Jenkins build
4. **Real-time Jenkins Logs** - Streaming as build runs
5. **Final Status** - SUCCESS or FAILURE with duration

### 3. Monitor Consumer Logs

In your terminal running the consumer:

```
================================================================================
📨 Processing Action Invocation
================================================================================
🔹 Run ID: r_abc123xyz
🔹 Action: deploy_microservice_kafka
🔹 User: user@example.com

✅ Updated action run r_abc123xyz: IN_PROGRESS
📝 Added log to action run r_abc123xyz
🔧 Executing action handler...
Starting log stream for build #42...
[Jenkins logs streaming...]
✅ Build completed: SUCCESS
```

## How It Works

### 1. Message Reception

When a user triggers the action in Port, the Kafka consumer receives:

```javascript
{
  "context": {
    "runId": "r_abc123xyz"
  },
  "action": {
    "identifier": "deploy_microservice_kafka"
  },
  "properties": {
    "serviceName": "my-service",
    "version": "1.2.3",
    "environment": "dev",
    "changeReason": "Testing"
  }
}
```

### 2. Jenkins Build Trigger

The consumer triggers a Jenkins build:

```javascript
POST /job/your-job-name/buildWithParameters
Params:
  - SERVICE_NAME: my-service
  - VERSION: 1.2.3
  - ENVIRONMENT: dev
  - CHANGE_REASON: Testing
  - PORT_RUN_ID: r_abc123xyz
```

### 3. Log Streaming

The consumer uses Jenkins Progressive Text API to stream logs:

```javascript
GET /job/your-job-name/42/logText/progressiveText?start=0
```

Logs are sent to Port in chunks:

```javascript
POST /v1/actions/runs/r_abc123xyz/logs
Body: { message: "Build started...\nStep 1/5..." }
```

### 4. Status Reporting

Final status is reported:

```javascript
POST /v1/actions/runs/r_abc123xyz/logs
Body: {
  message: "✅ Successfully deployed my-service v1.2.3 to dev!",
  terminationStatus: "SUCCESS",
  statusLabel: "Build SUCCESS (45.2s)"
}
```

## Configuration Options

### Log Chunk Size

Control how often logs are sent to Port (default: 500 characters):

```javascript
const CHUNK_SIZE = 500; // Adjust in port-kafka-consumer.js line 372
```

**Smaller chunks** = More API calls, more real-time  
**Larger chunks** = Fewer API calls, less real-time

### Poll Interval

Control how often Jenkins is polled for new logs (default: 2000ms):

```javascript
await this.jenkinsCapture.streamLogs(buildNumber, callback, 2000);
```

## Troubleshooting

### Consumer not receiving messages

- ✅ Verify Kafka credentials in `.env`
- ✅ Check consumer group ID format: `ORG_ID.name`
- ✅ Ensure action uses `KAFKA` invocation method
- ✅ Check consumer logs for connection errors

### Jenkins build not triggering

- ✅ Verify Jenkins URL is accessible from consumer
- ✅ Check Jenkins username and API token
- ✅ Ensure job name matches `JENKINS_JOB_NAME`
- ✅ Check Jenkins job exists and is enabled

### Logs not appearing in Port

- ✅ Verify Port API credentials
- ✅ Check access token is valid
- ✅ Look for API errors in consumer logs
- ✅ Ensure runId is correct

### Build parameters not working

- ✅ Ensure Jenkins job is configured to accept parameters
- ✅ Check parameter names match exactly
- ✅ Verify parameters are being sent (check consumer logs)

## Advanced Usage

### Custom Action Handlers

Add more action handlers in `port-kafka-consumer.js`:

```javascript
async handleAction(message) {
  const action = message.action;
  
  switch (action.identifier) {
    case 'deploy_microservice_kafka':
      await this.handleDeployService(message);
      break;
    
    case 'run_tests':
      await this.handleRunTests(message);
      break;
    
    case 'rollback_deployment':
      await this.handleRollback(message);
      break;
    
    default:
      await this.handleUnknownAction(message);
  }
}
```

### Multiple Jenkins Servers

Pass Jenkins config per action:

```javascript
const jenkinsCapture = new JenkinsLogCapture({
  jenkinsUrl: props.jenkinsUrl || process.env.JENKINS_URL,
  username: process.env.JENKINS_USERNAME,
  apiToken: process.env.JENKINS_API_TOKEN,
  jobName: props.jobName || process.env.JENKINS_JOB_NAME,
});
```

### Entity Creation

Create Port entities after successful deployment:

```javascript
if (isSuccess) {
  await this.upsertEntity(
    'deployment',
    {
      identifier: `deploy-${Date.now()}`,
      title: `${serviceName} v${version} - ${environment}`,
      properties: {
        service: serviceName,
        version: version,
        environment: environment,
        buildNumber: buildNumber,
        buildUrl: buildUrl,
        deployedAt: new Date().toISOString(),
        deployedBy: message.context.by.email,
      },
    },
    runId
  );
}
```

## Benefits

### For Users
- 🎯 **Single Interface** - No need to switch between Port and Jenkins
- 📊 **Real-time Feedback** - See build progress live
- 🔗 **Quick Access** - Direct links to Jenkins for details
- 📝 **Audit Trail** - All deployments tracked in Port

### For Teams
- 🚀 **Self-Service** - Developers can deploy without Jenkins access
- 🔒 **Controlled Access** - Port permissions control who can deploy
- 📈 **Metrics** - Track deployment frequency and success rates
- 🔄 **Consistency** - Standardized deployment process

## Next Steps

1. **Add more actions** - Tests, rollbacks, scaling, etc.
2. **Create entities** - Track deployments as Port entities
3. **Add notifications** - Slack/email on deployment completion
4. **Implement approvals** - Require approval for production deploys
5. **Add metrics** - Track deployment success rates
6. **Scale horizontally** - Run multiple consumers for high availability

## Resources

- [Port Kafka Documentation](https://docs.port.io/actions-and-automations/setup-backend/webhook/kafka/)
- [Port API Reference](https://docs.port.io/api-reference/port-api)
- [Jenkins REST API](https://www.jenkins.io/doc/book/using/remote-access-api/)
- [KafkaJS Documentation](https://kafka.js.org/)

---

**Status**: ✅ Production Ready  
**Last Updated**: November 2024
