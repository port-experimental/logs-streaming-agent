# Setup Guide - Port, Service & Jenkins Integration

This guide walks you through setting up the complete integration between Port, your service, and Jenkins for automated deployments with real-time stage tracking.

---

## Table of Contents

1. [Port Setup](#1-port-setup)
2. [Service Setup](#2-service-setup)
3. [Jenkins Setup](#3-jenkins-setup)
4. [Testing the Integration](#4-testing-the-integration)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. Port Setup

### 1.1 Create Blueprints

#### Microservice Blueprint

Create a blueprint to represent your microservices:

```json
{
  "identifier": "microservice",
  "title": "Microservice",
  "icon": "Microservice",
  "schema": {
    "properties": {
      "description": {
        "type": "string",
        "title": "Description"
      },
      "version": {
        "type": "string",
        "title": "Version"
      },
      "environment": {
        "type": "string",
        "title": "Environment",
        "enum": ["dev", "staging", "prod"]
      },
      "repository": {
        "type": "string",
        "title": "Repository URL",
        "format": "url"
      },
      "lastDeployment": {
        "type": "string",
        "title": "Last Deployment",
        "format": "date-time"
      }
    }
  }
}
```

#### VM Blueprint (Optional)

If you want to manage VMs:

```json
{
  "identifier": "vm",
  "title": "Virtual Machine",
  "icon": "Server",
  "schema": {
    "properties": {
      "cpu": {
        "type": "number",
        "title": "CPU Cores"
      },
      "memory": {
        "type": "number",
        "title": "Memory (GB)"
      },
      "disk": {
        "type": "number",
        "title": "Disk (GB)"
      },
      "status": {
        "type": "string",
        "title": "Status",
        "enum": ["running", "stopped", "pending"]
      }
    }
  }
}
```

### 1.2 Create Self-Service Actions

#### Deploy Microservice Action

Navigate to **Self-Service** → **Actions** → **Create Action**

**Basic Configuration:**
- **Identifier**: `deploy_microservice_kafka`
- **Title**: Deploy Microservice
- **Icon**: 🚀
- **Blueprint**: `microservice`
- **Invocation Type**: Kafka

**User Inputs:**

```json
{
  "properties": {
    "serviceName": {
      "type": "string",
      "title": "Service Name",
      "description": "Name of the service to deploy"
    },
    "version": {
      "type": "string",
      "title": "Version",
      "description": "Version or tag to deploy"
    },
    "environment": {
      "type": "string",
      "title": "Environment",
      "enum": ["dev", "staging", "prod"],
      "default": "dev"
    },
    "changeReason": {
      "type": "string",
      "title": "Change Reason",
      "description": "Reason for this deployment"
    }
  },
  "required": ["serviceName", "version", "environment"]
}
```

### 1.3 Get Port Credentials

#### Get Client ID and Secret

1. Go to **Settings** → **Credentials**
2. Click **Generate API Token**
3. Copy the **Client ID** and **Client Secret**
4. Save these securely - you'll need them for the `.env` file

#### Get Organization ID

1. Go to your Port organization URL: `https://app.getport.io/organization/[org-id]`
2. Copy the organization ID from the URL
3. Or find it in **Settings** → **Organization**

#### Get Kafka Configuration

Port provides managed Kafka for self-service actions:

1. Go to **Settings** → **Data Sources** → **Kafka**
2. Note down:
   - **Kafka Brokers** (comma-separated list)
   - **Topics**: 
     - Actions topic: `{org_id}.runs`
     - Changes topic: `{org_id}.change.log`
   - **Consumer Group**: Usually your `{org_id}`

---

## 2. Service Setup

### 2.1 Clone and Install

```bash
# Clone the repository
git clone <your-repo-url>
cd your-node-app

# Install dependencies
npm install
```

### 2.2 Configure Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# ============================================
# Port Configuration
# ============================================
PORT_CLIENT_ID=your_port_client_id_here
PORT_CLIENT_SECRET=your_port_client_secret_here
PORT_API_URL=https://api.getport.io/v1
PORT_ORG_ID=org_xxxxxxxxxx

# ============================================
# Kafka Configuration
# ============================================
KAFKA_BROKERS=broker1:9196,broker2:9196,broker3:9196
KAFKA_CONSUMER_GROUP_ID=org_xxxxxxxxxx
KAFKA_RUN_TOPIC=org_xxxxxxxxxx.runs
KAFKA_CHANGE_TOPIC=org_xxxxxxxxxx.change.log

# Kafka Security (Port uses SASL_SSL)
KAFKA_SECURITY_PROTOCOL=SASL_SSL
KAFKA_SASL_MECHANISM=SCRAM-SHA-512
KAFKA_SASL_USERNAME=your_kafka_username
KAFKA_SASL_PASSWORD=your_kafka_password

# ============================================
# Jenkins Configuration
# ============================================
JENKINS_URL=http://your-jenkins-server:8080
JENKINS_USERNAME=your-jenkins-username
JENKINS_API_TOKEN=your-jenkins-api-token
JENKINS_JOB_NAME=your-pipeline-job-name

# ============================================
# Webhook Server (Optional)
# ============================================
WEBHOOK_PORT=3000

# ============================================
# Logging
# ============================================
LOG_LEVEL=info
```

### 2.3 Verify Configuration

Run the configuration validator:

```bash
npm run kafka:consumer
```

You should see:
```
✅ Configuration validation passed
🚀 Port Kafka Consumer Starting
```

If you see errors, check your environment variables.

### 2.4 Run the Service

Start the Kafka consumer:

```bash
npm run kafka:consumer
```

The service will:
- Connect to Kafka
- Subscribe to Port action topics
- Wait for action invocations
- Process actions and update Port in real-time

---

## 3. Jenkins Setup

### 3.1 Install Required Plugins

Go to **Jenkins** → **Manage Jenkins** → **Manage Plugins** → **Available**

Install these plugins:

1. **Pipeline: Stage View Plugin** (Required for stage tracking)
   - Provides the `/wfapi/describe` API endpoint
   - Enables real-time stage visibility

2. **HTTP Request Plugin** (Required for webhooks)
   - Allows Jenkins to send webhook notifications
   - Used in the `Jenkinsfile` post-build actions

3. **Pipeline Plugin** (Usually pre-installed)
   - Required for declarative pipelines

### 3.2 Create Jenkins API Token

1. Log into Jenkins
2. Click your username (top right) → **Configure**
3. Scroll to **API Token** section
4. Click **Add new Token**
5. Give it a name (e.g., "Port Integration")
6. Click **Generate**
7. **Copy the token immediately** (you won't see it again!)
8. Add it to your `.env` file as `JENKINS_API_TOKEN`

### 3.3 Create or Update Pipeline Job

#### Option A: Create New Pipeline Job

1. Go to **Jenkins** → **New Item**
2. Enter job name (e.g., `testJfrogPipeline`)
3. Select **Pipeline**
4. Click **OK**

#### Option B: Use Existing Job

Make sure your existing job is a Pipeline job (not Freestyle).

### 3.4 Configure Pipeline

In the job configuration:

1. Scroll to **Pipeline** section
2. **Definition**: Pipeline script from SCM
3. **SCM**: Git
4. **Repository URL**: Your repository URL
5. **Script Path**: `Jenkinsfile`
6. Click **Save**

### 3.5 Add Pipeline Parameters

The `Jenkinsfile` expects these parameters:

1. Go to job → **Configure**
2. Check **This project is parameterized**
3. Add these String Parameters:
   - `SERVICE_NAME` (default: `your-node-app`)
   - `VERSION` (default: `1.0.0`)
   - `ENVIRONMENT` (default: `dev`)
   - `CHANGE_REASON` (default: empty)
   - `PORT_RUN_ID` (default: empty)

### 3.6 Configure Jenkinsfile

The included `Jenkinsfile` has:

- **Stage delays**: 30-second `sleep` in each stage for visibility
- **Webhook integration**: Sends notifications to your service
- **Docker agent**: Uses `node:20-alpine` image

**Adjust stage delays** based on your needs:

```groovy
stage('Checkout') {
  steps {
    echo '📥 Checking out source code...'
    checkout scm
    sleep 30  // Adjust this: 10-30s for demo, 1-2s for production
  }
}
```

### 3.7 Network Configuration

If Jenkins runs in Docker, ensure it can reach your webhook server:

- **Docker Desktop (Mac/Windows)**: Use `host.docker.internal:3000`
- **Docker on Linux**: Use `172.17.0.1:3000` or host IP
- **Same machine**: Use `localhost:3000`

The `Jenkinsfile` is configured with:
```groovy
def webhookUrl = env.WEBHOOK_URL ?: 'http://host.docker.internal:3000/webhook'
```

You can override this by setting the `WEBHOOK_URL` environment variable in Jenkins.

---

## 4. Testing the Integration

### 4.1 Start Your Service

```bash
npm run kafka:consumer
```

Wait for:
```
✅ Consumer Ready - Waiting for messages...
```

### 4.2 Trigger Action from Port

1. Go to Port UI
2. Navigate to your **Microservice** catalog
3. Click on a microservice entity (or create one)
4. Click **Actions** → **Deploy Microservice**
5. Fill in the form:
   - Service Name: `Test`
   - Version: `1.0.0`
   - Environment: `dev`
   - Change Reason: `Testing integration`
6. Click **Execute**

### 4.3 Monitor the Execution

**In Port UI:**
- Watch the action run status update in real-time
- See stage-by-stage progress in the status label:
  ```
  Build #42 - Running: Checkout
  Build #42 - Completed: Checkout (30s)
  Build #42 - Running: Install
  ...
  ```
- View logs streaming in the action run details

**In Your Service Console:**
```
📨 Processing Action Invocation
🔹 Run ID: r_xxxxxxxxxx
🔹 Action: deploy_microservice_kafka
🔨 Triggering Jenkins build for job: testJfrogPipeline
✅ Build #42 triggered successfully
Stage: Checkout [IN_PROGRESS]
Stage: Checkout [SUCCESS]
Stage: Install [IN_PROGRESS]
...
```

**In Jenkins:**
- Go to your job → Build #42
- Watch the pipeline stages execute
- See the 30-second delays in action

### 4.4 Verify Results

After completion, check:

1. **Port Action Run**: Should show SUCCESS with complete logs
2. **Jenkins Build**: Should show SUCCESS with all stages completed
3. **Service Logs**: Should show successful processing
4. **Microservice Entity**: Should be updated (if your handler updates it)

---

## 5. Troubleshooting

### Port Connection Issues

**Problem**: `Failed to get access token`

**Solutions:**
- Verify `PORT_CLIENT_ID` and `PORT_CLIENT_SECRET` are correct
- Check that credentials haven't expired
- Ensure you have network access to `https://api.getport.io`

### Kafka Connection Issues

**Problem**: `Consumer not connecting to Kafka`

**Solutions:**
- Verify `KAFKA_BROKERS` format: `host1:port1,host2:port2`
- Check `KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD`
- Ensure firewall allows outbound connections to Kafka brokers
- Verify `KAFKA_SECURITY_PROTOCOL=SASL_SSL`

### Jenkins Connection Issues

**Problem**: `Failed to trigger Jenkins build`

**Solutions:**
- Verify `JENKINS_URL` is accessible from your service
- Check `JENKINS_API_TOKEN` is valid (regenerate if needed)
- Ensure `JENKINS_JOB_NAME` matches exactly (case-sensitive)
- Test Jenkins URL in browser: `http://your-jenkins:8080`

### Stage Tracking Not Working

**Problem**: Only seeing "Deploy" stage, not earlier stages

**Solutions:**
- Install **Pipeline: Stage View Plugin** in Jenkins
- Verify plugin is active: Jenkins → Manage Plugins → Installed
- Check that your pipeline uses declarative syntax
- Ensure stages have `sleep` delays to make them visible
- Verify the service is polling immediately (check logs)

**Problem**: Stages showing as SUCCESS immediately

**Solutions:**
- Increase `sleep` delays in Jenkinsfile (try 30 seconds)
- Check that polling interval is 1 second (in `port-kafka-consumer.js`)
- Verify `getAllStages()` is being called
- Check Jenkins logs for workflow API errors

### Action Not Triggering

**Problem**: Action executed in Port but service doesn't receive it

**Solutions:**
- Verify service is running and connected to Kafka
- Check `KAFKA_RUN_TOPIC` matches Port's topic: `{org_id}.runs`
- Ensure action invocation type is set to **Kafka** in Port
- Check service logs for Kafka consumer errors
- Verify consumer group ID matches

### Webhook Not Working

**Problem**: Jenkins webhook not reaching service

**Solutions:**
- Verify webhook server is running: `npm run webhook:server`
- Check webhook URL is accessible from Jenkins
- For Docker Jenkins, use `host.docker.internal:3000`
- Test webhook endpoint: `curl http://localhost:3000/health`
- Check Jenkins has HTTP Request Plugin installed
- Review Jenkins build logs for webhook errors

---

## Quick Reference

### Service Commands

```bash
# Start Kafka consumer
npm run kafka:consumer

# Start webhook server (optional)
npm run webhook:server

# Manual Jenkins log capture
npm run capture:latest
npm run capture:wait
```

### Port URLs

- **API**: https://api.getport.io/v1
- **UI**: https://app.getport.io
- **Docs**: https://docs.getport.io

### Jenkins API Endpoints

- Job info: `GET /job/{name}/api/json`
- Build info: `GET /job/{name}/{number}/api/json`
- Trigger build: `POST /job/{name}/buildWithParameters`
- Console logs: `GET /job/{name}/{number}/consoleText`
- Stage info: `GET /job/{name}/{number}/wfapi/describe`

### Environment Variable Checklist

- [ ] `PORT_CLIENT_ID`
- [ ] `PORT_CLIENT_SECRET`
- [ ] `PORT_ORG_ID`
- [ ] `KAFKA_BROKERS`
- [ ] `KAFKA_SASL_USERNAME`
- [ ] `KAFKA_SASL_PASSWORD`
- [ ] `JENKINS_URL`
- [ ] `JENKINS_USERNAME`
- [ ] `JENKINS_API_TOKEN`
- [ ] `JENKINS_JOB_NAME`

---

## Next Steps

Once everything is working:

1. **Remove or reduce stage delays** in production Jenkinsfile
2. **Add more action handlers** for different operations
3. **Create additional blueprints** for other resources
4. **Set up monitoring** and alerting
5. **Configure proper secrets management** (don't use `.env` in production)
6. **Add error notifications** to Slack/Teams/Email
7. **Implement rollback actions** for failed deployments

---

## Support

- **Port Documentation**: https://docs.getport.io
- **Jenkins Documentation**: https://www.jenkins.io/doc/
- **Kafka Documentation**: https://kafka.apache.org/documentation/

For issues with this integration, check the logs and refer to the troubleshooting section above.
