# Jenkins Webhook Log Capture - Workflow Documentation

## Overview

This document explains what data is captured, how the webhook integration works, and the complete event workflow from Jenkins build to log file storage.

---

## What Is Being Captured

### 1. **Build Metadata** (from Jenkins webhook)

When Jenkins sends a webhook notification, the following data is transmitted:

```json
{
  "jobName": "testJfrogPipeline",
  "buildNumber": "11",
  "buildUrl": "http://localhost:8080/job/testJfrogPipeline/11/",
  "status": "SUCCESS",
  "duration": 45000,
  "timestamp": 1699219452345
}
```

| Field | Description | Example |
|-------|-------------|---------|
| `jobName` | Jenkins job/pipeline name | `testJfrogPipeline` |
| `buildNumber` | Sequential build number | `11` |
| `buildUrl` | Full URL to the build | `http://localhost:8080/job/testJfrogPipeline/11/` |
| `status` | Build result | `SUCCESS`, `FAILURE`, `UNSTABLE`, `ABORTED` |
| `duration` | Build duration in milliseconds | `45000` (45 seconds) |
| `timestamp` | Build start time (Unix epoch) | `1699219452345` |

### 2. **Console Logs** (from Jenkins API)

The webhook server then fetches the complete console output:

- **Source**: Jenkins REST API endpoint `/job/{jobName}/{buildNumber}/consoleText`
- **Format**: Plain text (UTF-8)
- **Content**: Complete build console output including:
  - Pipeline initialization
  - Docker container setup
  - Stage execution logs (Checkout, Install, Test, Build)
  - Command outputs (`npm ci`, `npm test`, `npm run build`)
  - Timestamps and duration for each stage
  - Final build result

### 3. **Build Status Details** (from Jenkins API)

Additional build information retrieved:

```javascript
{
  number: 11,
  result: "SUCCESS",
  building: false,
  duration: 45000,
  timestamp: 1699219452345
}
```

---

## Event Workflow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         JENKINS BUILD                                │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ 1. Build Executes
                                  ▼
                    ┌──────────────────────────┐
                    │  Pipeline Stages Run     │
                    │  - Checkout              │
                    │  - Install               │
                    │  - Test                  │
                    │  - Build                 │
                    └──────────────────────────┘
                                  │
                                  │ 2. Build Completes
                                  ▼
                    ┌──────────────────────────┐
                    │  post { always { } }     │
                    │  Block Executes          │
                    └──────────────────────────┘
                                  │
                                  │ 3. Webhook Sent
                                  ▼
                    ┌──────────────────────────┐
                    │  HTTP POST Request       │
                    │  to Webhook Server       │
                    │  URL: localhost:3000     │
                    └──────────────────────────┘
                                  │
                                  │ 4. Webhook Received
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      WEBHOOK SERVER                                  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ 5. Parse Notification
                                  ▼
                    ┌──────────────────────────┐
                    │  Extract Build Info      │
                    │  - Job Name              │
                    │  - Build Number          │
                    │  - Status                │
                    └──────────────────────────┘
                                  │
                                  │ 6. Determine Action
                                  ▼
                    ┌──────────────────────────┐
                    │  Status Check            │
                    │  STARTED/IN_PROGRESS?    │
                    │  or COMPLETED?           │
                    └──────────────────────────┘
                         │                │
           ┌─────────────┘                └─────────────┐
           │                                            │
           ▼                                            ▼
    [STARTED]                                    [COMPLETED]
           │                                            │
           │ 7a. Real-time Stream                      │ 7b. Fetch Complete
           ▼                                            ▼
┌─────────────────────┐                    ┌─────────────────────┐
│ Stream Logs         │                    │ Get Console Output  │
│ (Progressive API)   │                    │ (consoleText API)   │
│ - Poll every 2s     │                    │ - Single request    │
│ - Get incremental   │                    │ - Full log content  │
└─────────────────────┘                    └─────────────────────┘
           │                                            │
           │ 8a. Display in Terminal                   │ 8b. Retrieve Logs
           ▼                                            ▼
┌─────────────────────┐                    ┌─────────────────────┐
│ Console Output      │                    │ Complete Log Text   │
│ (Real-time)         │                    │                     │
└─────────────────────┘                    └─────────────────────┘
           │                                            │
           └─────────────┬──────────────────────────────┘
                         │
                         │ 9. Save to File
                         ▼
              ┌──────────────────────────┐
              │  Write Log File          │
              │  webhookstream-{job}-    │
              │  build-{num}-{time}.log  │
              └──────────────────────────┘
                         │
                         │ 10. Confirmation
                         ▼
              ┌──────────────────────────┐
              │  ✅ Log Saved            │
              │  File: ./logs/...        │
              └──────────────────────────┘
```

---

## Detailed Event Sequence

### Phase 1: Jenkins Build Execution

**Event 1: Build Triggered**
- User clicks "Build Now" or build is triggered automatically
- Jenkins assigns build number (e.g., #11)
- Pipeline starts executing

**Event 2: Pipeline Stages Execute**
```
[Pipeline] Start of Pipeline
[Pipeline] node
[Pipeline] {
[Pipeline] stage (Checkout)
[Pipeline] stage (Install)
[Pipeline] stage (Test)
[Pipeline] stage (Build)
[Pipeline] }
```

**Event 3: Build Completes**
- All stages finish
- Build result determined: `SUCCESS`, `FAILURE`, `UNSTABLE`, or `ABORTED`
- `post { always { } }` block triggers

### Phase 2: Webhook Notification

**Event 4: Webhook Payload Created**

Jenkinsfile creates payload:
```groovy
def payload = [
  jobName: env.JOB_NAME,           // "testJfrogPipeline"
  buildNumber: env.BUILD_NUMBER,   // "11"
  buildUrl: env.BUILD_URL,         // "http://localhost:8080/..."
  status: currentBuild.result,     // "SUCCESS"
  duration: currentBuild.duration, // 45000
  timestamp: currentBuild.startTimeInMillis // 1699219452345
]
```

**Event 5: HTTP POST Request Sent**

```http
POST http://host.docker.internal:3000/webhook
Content-Type: application/json

{
  "jobName": "testJfrogPipeline",
  "buildNumber": "11",
  "buildUrl": "http://localhost:8080/job/testJfrogPipeline/11/",
  "status": "SUCCESS",
  "duration": 45000,
  "timestamp": 1699219452345
}
```

**Event 6: Jenkins Logs Result**
```
✅ Webhook notification sent successfully
```

### Phase 3: Webhook Server Processing

**Event 7: Webhook Received**

Server logs:
```
=== Jenkins Webhook Received ===
Job: testJfrogPipeline
Build: #11
Status: SUCCESS
URL: http://localhost:8080/job/testJfrogPipeline/11/
Timestamp: 2024-11-05T20:44:12.345Z
```

**Event 8: Immediate Response**

Server responds to Jenkins:
```json
{
  "received": true,
  "message": "Webhook received successfully",
  "buildNumber": "11",
  "timestamp": "2024-11-05T20:44:12.567Z"
}
```

**Event 9: Async Processing Starts**

Server determines action based on status:

**If status is `STARTED` or `IN_PROGRESS`:**
```javascript
// Real-time streaming
await jenkinsCapture.streamLogs(buildNumber, (chunk) => {
  process.stdout.write(chunk);  // Display in terminal
  allLogs += chunk;              // Accumulate for saving
});
```

**If status is `SUCCESS`, `FAILURE`, `UNSTABLE`, or `ABORTED`:**
```javascript
// Fetch complete logs
const logs = await jenkinsCapture.getConsoleOutput(buildNumber);
```

### Phase 4: Log Capture

**Event 10: API Request to Jenkins**

**For completed builds:**
```http
GET http://localhost:8080/job/testJfrogPipeline/11/consoleText
Authorization: Basic {base64(username:apiToken)}
```

**For streaming (progressive):**
```http
GET http://localhost:8080/job/testJfrogPipeline/11/logText/progressiveText?start=0
Authorization: Basic {base64(username:apiToken)}

Response Headers:
X-More-Data: true/false
X-Text-Size: 12345
```

**Event 11: Log Content Retrieved**

Example log content:
```
Started by user admin
Running in Durability level: MAX_SURVIVABILITY
[Pipeline] Start of Pipeline
[Pipeline] node
Running on Jenkins in /var/jenkins_home/workspace/testJfrogPipeline
[Pipeline] {
[Pipeline] stage
[Pipeline] { (Checkout)
[Pipeline] checkout
...
[Pipeline] End of Pipeline
Finished: SUCCESS
```

### Phase 5: File Storage

**Event 12: File Creation**

```javascript
const filename = path.join(
  './logs',
  `webhookstream-${jobName}-build-${buildNumber}-${Date.now()}.log`
);
// Result: webhookstream-testJfrogPipeline-build-11-1762374961887.log
```

**Event 13: File Written**

```javascript
fs.writeFileSync(filename, logs, 'utf8');
```

**Event 14: Confirmation Logged**

```
✅ Logs saved for build #11 (SUCCESS)
Logs saved to: ./logs/webhookstream-testJfrogPipeline-build-11-1762374961887.log
```

---

## File Naming Convention

### Webhook-Captured Logs

**Format:**
```
webhookstream-{jobName}-build-{buildNumber}-{timestamp}.log
```

**Example:**
```
webhookstream-testJfrogPipeline-build-11-1762374961887.log
```

**Breakdown:**
- `webhookstream-` - Prefix indicating webhook capture
- `testJfrogPipeline` - Jenkins job name
- `build-11` - Build number
- `1762374961887` - Unix timestamp (milliseconds) when file was saved

### Manual-Captured Logs

**Format:**
```
{jobName}-build-{buildNumber}-{timestamp}.log
```

**Example:**
```
testJfrogPipeline-build-9-1762372937868.log
```

**Difference:** No `webhookstream-` prefix

---

## Data Flow Summary

### Input (from Jenkins)
```
Jenkins Build → Webhook Notification → Webhook Server
```

### Processing (by Webhook Server)
```
Parse Notification → Determine Status → Fetch Logs → Save to File
```

### Output (log files)
```
./logs/webhookstream-{job}-build-{num}-{time}.log
```

---

## API Endpoints Used

### Jenkins REST API

| Endpoint | Purpose | Method | Response |
|----------|---------|--------|----------|
| `/job/{name}/api/json` | Get job info | GET | Job metadata, latest build number |
| `/job/{name}/{number}/api/json` | Get build info | GET | Build status, result, duration |
| `/job/{name}/{number}/consoleText` | Get complete logs | GET | Plain text console output |
| `/job/{name}/{number}/logText/progressiveText` | Stream logs | GET | Incremental log chunks |

### Webhook Server API

| Endpoint | Purpose | Method | Response |
|----------|---------|--------|----------|
| `/webhook` | Receive notifications | POST | `{received: true, ...}` |
| `/health` | Health check | GET | Server status |
| `/status` | Active monitors | GET | Current monitoring tasks |
| `/logs` | List all logs | GET | Array of log files |
| `/logs/webhook` | List webhook logs | GET | Array of webhook-only logs |
| `/logs/:filename` | Download log | GET | Log file content |

---

## Error Handling

### Jenkins Side

**If webhook fails:**
```groovy
catch (Exception e) {
  echo "⚠️  Failed to send webhook: ${e.message}"
  // Build continues - webhook failure doesn't fail the build
}
```

### Webhook Server Side

**If log capture fails:**
```javascript
catch (error) {
  console.error(`❌ Error fetching logs: ${error.message}`);
  // Server continues running - ready for next webhook
}
```

---

## Monitoring and Verification

### Check Webhook Was Sent (Jenkins)

View build console output:
```
✅ Webhook notification sent successfully
```

### Check Webhook Was Received (Webhook Server)

Terminal output:
```
=== Jenkins Webhook Received ===
Job: testJfrogPipeline
Build: #11
Status: SUCCESS
```

### Verify Log File Created

```bash
ls -lh logs/webhookstream-*
```

Output:
```
-rw-r--r--  1 user  staff   4.2K Nov  5 20:44 webhookstream-testJfrogPipeline-build-11-1762374961887.log
```

### Check Log Content

```bash
head -n 20 logs/webhookstream-testJfrogPipeline-build-11-1762374961887.log
```

---

## Performance Characteristics

### Timing

| Event | Typical Duration |
|-------|------------------|
| Build execution | 30-60 seconds (varies) |
| Webhook send | < 1 second |
| Webhook receive | < 100ms |
| Log fetch (completed) | 1-3 seconds |
| Log streaming (real-time) | Duration of build + 2s polling |
| File write | < 100ms |

### Network Requests

**Per build:**
- 1 webhook POST from Jenkins to server
- 1-2 GET requests from server to Jenkins (status + logs)

**For streaming:**
- Multiple GET requests (every 2 seconds during build)

---

## Security Considerations

### Authentication

**Jenkins API:**
- Uses HTTP Basic Auth
- Credentials: `username:apiToken`
- Token stored in `.env` file (gitignored)

**Webhook Server:**
- No authentication on webhook endpoint (localhost only)
- For production: Add API key or JWT validation

### Network

**Current setup:**
- Jenkins (Docker): `host.docker.internal:3000`
- Webhook Server: `localhost:3000`
- Both on same machine

**For production:**
- Use HTTPS for webhook endpoint
- Implement webhook signature verification
- Use firewall rules to restrict access

---

## Troubleshooting

### Webhook Not Received

**Check:**
1. Webhook server is running: `npm run webhook:server`
2. Port 3000 is not blocked
3. Jenkins can reach `host.docker.internal`
4. HTTP Request Plugin is installed

### Logs Not Captured

**Check:**
1. Jenkins credentials in `.env` are correct
2. API token has proper permissions
3. Job name matches exactly
4. Network connectivity to Jenkins

### File Not Created

**Check:**
1. `./logs` directory permissions
2. Disk space available
3. No file system errors in server logs

---

## Summary

**What is captured:**
- Build metadata (job, number, status, duration)
- Complete console output (all logs)
- Build status details

**How it's captured:**
- Jenkins sends webhook after build completes
- Webhook server receives notification
- Server fetches logs via Jenkins REST API
- Logs saved with `webhookstream-` prefix

**Event flow:**
1. Build runs → 2. Webhook sent → 3. Server receives → 4. Logs fetched → 5. File saved

**Result:**
- Automatic log capture for every build
- No manual intervention required
- Clear file naming for easy identification
