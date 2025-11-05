# Jenkins Log Capture Application

Capture and monitor logs from Jenkins pipeline builds in real-time using the Jenkins REST API.

## Features

- **Real-time log streaming**: Monitor builds as they run with progressive text API
- **Post-build log retrieval**: Fetch complete logs from completed builds
- **Automatic log saving**: Save logs to files with timestamps
- **Build monitoring**: Wait for new builds and automatically capture logs
- **Multiple commands**: Flexible CLI for different use cases
- **Build status tracking**: Get build results, duration, and timestamps
- **Webhook integration**: Automatic log capture via Jenkins webhooks (event-driven)
- **Distinct file naming**: Webhook logs prefixed with `webhookstream-` for easy identification

## Setup

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
```

Edit `.env` with your Jenkins details:

```env
JENKINS_URL=http://your-jenkins-server:8080
JENKINS_USERNAME=your-username
JENKINS_API_TOKEN=your-api-token-here
JENKINS_JOB_NAME=your-node-app
WEBHOOK_PORT=3000
```

**Note**: For jobs in folders, use format: `folder-name/job-name`

## Usage

### Two Modes of Operation

This application supports two modes:

1. **Manual Mode**: Run CLI commands to capture logs on-demand
2. **Webhook Mode**: Automatic log capture when Jenkins sends webhook notifications

---

## Manual Mode (CLI)

### Monitor latest build

Captures logs from the most recent build:

```bash
npm run capture:latest
```

Or:

```bash
node jenkins-log-capture.js latest
```

### Monitor specific build number

Capture logs from a specific build:

```bash
node jenkins-log-capture.js build 42
```

### Fetch logs for completed build

Download logs from an already completed build:

```bash
node jenkins-log-capture.js fetch 42
```

### Wait for next build and monitor

Waits for a new build to start, then monitors it:

```bash
npm run capture:wait
```

Or:

```bash
node jenkins-log-capture.js wait
```

This is useful for CI/CD workflows where you trigger a build and want to immediately capture its logs.

---

## Webhook Mode (Automatic)

### Start the webhook server

```bash
npm run webhook:server
```

The server will start and display:

```
🚀 Jenkins Webhook Server Started
==================================================
📡 Listening on port 3000
🔗 Webhook URL: http://localhost:3000/webhook
💚 Health check: http://localhost:3000/health
📊 Status: http://localhost:3000/status
📋 All logs: http://localhost:3000/logs
🔔 Webhook logs: http://localhost:3000/logs/webhook
==================================================

📝 Log file naming:
   - Webhook: webhookstream-{job}-build-{number}-{timestamp}.log
   - Manual:  {job}-build-{number}-{timestamp}.log

⏳ Waiting for Jenkins webhooks...
```

### Configure Jenkins

The `Jenkinsfile` is already configured to send webhooks. When a build completes, Jenkins will automatically:

1. Send a POST request to `http://host.docker.internal:3000/webhook`
2. Include build information (job name, build number, status, duration)
3. Your webhook server receives it and automatically captures the logs

**Note**: `host.docker.internal` allows Docker containers to reach your host machine.

### Install HTTP Request Plugin (if needed)

If Jenkins doesn't have the HTTP Request Plugin:

1. Go to Jenkins → Manage Jenkins → Manage Plugins
2. Search for "HTTP Request Plugin"
3. Install and restart Jenkins

### Webhook Endpoints

Once the server is running:

**Health check:**
```bash
curl http://localhost:3000/health
```

**View active monitors:**
```bash
curl http://localhost:3000/status
```

**List all logs (webhook + manual):**
```bash
curl http://localhost:3000/logs
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

## Jenkins API Endpoints Used

This application uses the following Jenkins REST API endpoints:

- `GET /job/{name}/api/json` - Get job information
- `GET /job/{name}/{number}/api/json` - Get build information
- `GET /job/{name}/{number}/consoleText` - Get complete console output
- `GET /job/{name}/{number}/logText/progressiveText` - Stream logs progressively

## Requirements

- Node.js 14+ (for optional chaining support)
- Jenkins 2.0+ with REST API enabled
- Valid Jenkins user account with job read permissions

## Documentation

- **[WEBHOOK-WORKFLOW.md](./WEBHOOK-WORKFLOW.md)** - Detailed webhook workflow, event sequence, and data capture documentation

## License

ISC

## Contributing

Feel free to submit issues and enhancement requests!
