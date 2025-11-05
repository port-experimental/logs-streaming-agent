require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Jenkins Log Capture Application
 * Captures logs from Jenkins pipeline builds using Jenkins REST API
 */
class JenkinsLogCapture {
  constructor(config) {
    this.jenkinsUrl = config.jenkinsUrl;
    this.username = config.username;
    this.apiToken = config.apiToken;
    this.jobName = config.jobName;
    
    // Create axios instance with authentication
    this.client = axios.create({
      baseURL: this.jenkinsUrl,
      auth: {
        username: this.username,
        password: this.apiToken
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Get the latest build number for a job
   */
  async getLatestBuildNumber() {
    try {
      const response = await this.client.get(`/job/${this.jobName}/api/json`);
      return response.data.lastBuild?.number || null;
    } catch (error) {
      throw new Error(`Failed to get latest build: ${error.message}`);
    }
  }

  /**
   * Get build status
   */
  async getBuildStatus(buildNumber) {
    try {
      const response = await this.client.get(
        `/job/${this.jobName}/${buildNumber}/api/json`
      );
      return {
        number: response.data.number,
        result: response.data.result,
        building: response.data.building,
        duration: response.data.duration,
        timestamp: response.data.timestamp
      };
    } catch (error) {
      throw new Error(`Failed to get build status: ${error.message}`);
    }
  }

  /**
   * Stream logs in real-time (progressive text)
   * This fetches logs incrementally as the build runs
   */
  async streamLogs(buildNumber, onLogChunk, pollInterval = 2000) {
    let start = 0;
    let isBuilding = true;

    console.log(`Starting log stream for build #${buildNumber}...`);

    while (isBuilding) {
      try {
        // Use progressiveText API for incremental log retrieval
        const response = await this.client.get(
          `/job/${this.jobName}/${buildNumber}/logText/progressiveText?start=${start}`,
          { responseType: 'text' }
        );

        const logChunk = response.data;
        const moreData = response.headers['x-more-data'];
        const nextStart = response.headers['x-text-size'];

        if (logChunk) {
          onLogChunk(logChunk);
        }

        // Update start position for next request
        if (nextStart) {
          start = parseInt(nextStart, 10);
        }

        // Check if build is still running
        isBuilding = moreData === 'true';

        if (isBuilding) {
          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      } catch (error) {
        console.error(`Error streaming logs: ${error.message}`);
        break;
      }
    }

    console.log('Log stream completed.');
  }

  /**
   * Get complete console output for a build
   * Use this for completed builds
   */
  async getConsoleOutput(buildNumber) {
    try {
      const response = await this.client.get(
        `/job/${this.jobName}/${buildNumber}/consoleText`,
        { responseType: 'text' }
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get console output: ${error.message}`);
    }
  }

  /**
   * Save logs to file
   */
  async saveLogsToFile(buildNumber, outputDir = './logs') {
    try {
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const logs = await this.getConsoleOutput(buildNumber);
      const filename = path.join(
        outputDir,
        `${this.jobName}-build-${buildNumber}-${Date.now()}.log`
      );
      
      fs.writeFileSync(filename, logs, 'utf8');
      console.log(`Logs saved to: ${filename}`);
      return filename;
    } catch (error) {
      throw new Error(`Failed to save logs: ${error.message}`);
    }
  }

  /**
   * Monitor a build and capture logs in real-time
   */
  async monitorBuild(buildNumber, saveToFile = true) {
    let allLogs = '';

    // Stream logs in real-time
    await this.streamLogs(buildNumber, (chunk) => {
      process.stdout.write(chunk);
      allLogs += chunk;
    });

    // Get final build status
    const status = await this.getBuildStatus(buildNumber);
    console.log('\n--- Build Status ---');
    console.log(`Result: ${status.result}`);
    console.log(`Duration: ${status.duration}ms`);

    // Save to file if requested
    if (saveToFile) {
      const outputDir = './logs';
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const filename = path.join(
        outputDir,
        `${this.jobName}-build-${buildNumber}-${Date.now()}.log`
      );
      fs.writeFileSync(filename, allLogs, 'utf8');
      console.log(`Logs saved to: ${filename}`);
    }

    return { logs: allLogs, status };
  }

  /**
   * Wait for a new build to start and monitor it
   */
  async waitForNewBuild(previousBuildNumber, timeout = 300000) {
    const startTime = Date.now();
    console.log(`Waiting for new build (previous: #${previousBuildNumber})...`);

    while (Date.now() - startTime < timeout) {
      const latestBuild = await this.getLatestBuildNumber();
      
      if (latestBuild && latestBuild > previousBuildNumber) {
        console.log(`New build detected: #${latestBuild}`);
        return latestBuild;
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error('Timeout waiting for new build');
  }
}

// Example usage
if (require.main === module) {
  const config = {
    jenkinsUrl: process.env.JENKINS_URL || 'http://localhost:8080',
    username: process.env.JENKINS_USERNAME,
    apiToken: process.env.JENKINS_API_TOKEN,
    jobName: process.env.JENKINS_JOB_NAME || 'your-node-app'
  };

  // Validate configuration
  if (!config.username || !config.apiToken) {
    console.error('Error: JENKINS_USERNAME and JENKINS_API_TOKEN must be set');
    console.error('Create a .env file with:');
    console.error('JENKINS_URL=http://your-jenkins-server:8080');
    console.error('JENKINS_USERNAME=your-username');
    console.error('JENKINS_API_TOKEN=your-api-token');
    console.error('JENKINS_JOB_NAME=your-job-name');
    process.exit(1);
  }

  const capture = new JenkinsLogCapture(config);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const command = args[0] || 'latest';

  (async () => {
    try {
      switch (command) {
        case 'latest':
          // Monitor the latest build
          const latestBuild = await capture.getLatestBuildNumber();
          if (latestBuild) {
            console.log(`Monitoring latest build: #${latestBuild}`);
            await capture.monitorBuild(latestBuild);
          } else {
            console.log('No builds found');
          }
          break;

        case 'build':
          // Monitor specific build number
          const buildNumber = parseInt(args[1], 10);
          if (!buildNumber) {
            console.error('Usage: node jenkins-log-capture.js build <build-number>');
            process.exit(1);
          }
          console.log(`Monitoring build: #${buildNumber}`);
          await capture.monitorBuild(buildNumber);
          break;

        case 'fetch':
          // Fetch logs for completed build
          const fetchBuildNumber = parseInt(args[1], 10);
          if (!fetchBuildNumber) {
            console.error('Usage: node jenkins-log-capture.js fetch <build-number>');
            process.exit(1);
          }
          console.log(`Fetching logs for build: #${fetchBuildNumber}`);
          await capture.saveLogsToFile(fetchBuildNumber);
          break;

        case 'wait':
          // Wait for next build and monitor it
          const currentBuild = await capture.getLatestBuildNumber();
          const newBuild = await capture.waitForNewBuild(currentBuild || 0);
          await capture.monitorBuild(newBuild);
          break;

        default:
          console.log('Usage:');
          console.log('  node jenkins-log-capture.js latest          - Monitor latest build');
          console.log('  node jenkins-log-capture.js build <number>  - Monitor specific build');
          console.log('  node jenkins-log-capture.js fetch <number>  - Fetch logs for completed build');
          console.log('  node jenkins-log-capture.js wait            - Wait for next build and monitor');
          break;
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  })();
}

module.exports = JenkinsLogCapture;
