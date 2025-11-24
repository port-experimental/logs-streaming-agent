require('dotenv').config();
const axios = require('./axios-config');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Jenkins Build Status Constants
 */
const BUILD_STATUS = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  UNSTABLE: 'UNSTABLE',
  ABORTED: 'ABORTED',
  NOT_BUILT: 'NOT_BUILT',
  BUILDING: 'BUILDING'
};

/**
 * Jenkins Stage Status Constants
 */
const STAGE_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  ABORTED: 'ABORTED',
  NOT_EXECUTED: 'NOT_EXECUTED'
};

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
    this.timeout = config.timeout || 30000;
    
    // Create axios instance with authentication
    // Retry logic is handled by axios-config globally
    this.client = axios.create({
      baseURL: this.jenkinsUrl,
      auth: {
        username: this.username,
        password: this.apiToken
      },
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: this.timeout
    });
  }

  // Retry logic removed - now handled by axios-config globally

  /**
   * Get the latest build number for a job
   */
  async getLatestBuildNumber() {
    try {
      const response = await this.client.get(`/job/${this.jobName}/api/json`);
      return response.data.lastBuild?.number || null;
    } catch (error) {
      logger.error(`Failed to get latest build: ${error.message}`);
      throw new Error(`Failed to get latest build: ${error.message}`);
    }
  }

  /**
   * Get current running stage for a build using Jenkins Workflow API
   */
  async getCurrentStage(buildNumber) {
    try {
      const response = await this.client.get(
        `/job/${this.jobName}/${buildNumber}/wfapi/describe`,
        { timeout: 10000 }
      );
      
      logger.debug(`Stage API response for build #${buildNumber}: ${JSON.stringify(response.data)}`);
      
      const stages = response.data.stages || [];
      
      if (stages.length === 0) {
        logger.debug('No stages found in workflow API response');
        return null;
      }
      
      // Find the currently running stage
      const runningStage = stages.find(stage => stage.status === STAGE_STATUS.IN_PROGRESS);
      if (runningStage) {
        logger.info(`Current stage: ${runningStage.name} [${STAGE_STATUS.IN_PROGRESS}]`);
        return {
          name: runningStage.name,
          status: runningStage.status,
          durationMillis: runningStage.durationMillis
        };
      }
      
      // If no running stage, return the last completed stage
      const completedStages = stages.filter(stage => stage.status !== STAGE_STATUS.NOT_EXECUTED);
      if (completedStages.length > 0) {
        const lastStage = completedStages[completedStages.length - 1];
        logger.debug(`Last completed stage: ${lastStage.name} [${lastStage.status}]`);
        return {
          name: lastStage.name,
          status: lastStage.status,
          durationMillis: lastStage.durationMillis
        };
      }
      
      return null;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.error(`Workflow API not available (404). Install 'Pipeline: Stage View Plugin' in Jenkins.`);
      } else {
        logger.warn(`Could not get stage info: ${error.message}`);
      }
      return null;
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
      logger.error(`Failed to get build status for #${buildNumber}: ${error.message}`);
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
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    logger.info(`Starting log stream for build #${buildNumber}...`);

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

        // Reset error counter on success
        consecutiveErrors = 0;

        if (isBuilding) {
          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      } catch (error) {
        consecutiveErrors++;
        logger.error(`Error streaming logs (attempt ${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`);
        
        if (consecutiveErrors >= maxConsecutiveErrors) {
          logger.error(`Max consecutive errors reached, stopping log stream`);
          throw new Error(`Failed to stream logs after ${maxConsecutiveErrors} attempts`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    logger.info('Log stream completed.');
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
      logger.error(`Failed to get console output for #${buildNumber}: ${error.message}`);
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
      logger.info(`Logs saved to: ${filename}`);
      return filename;
    } catch (error) {
      logger.error(`Failed to save logs for #${buildNumber}: ${error.message}`);
      throw new Error(`Failed to save logs: ${error.message}`);
    }
  }

  /**
   * Monitor a build and capture logs in real-time
   */
  async monitorBuild(buildNumber, saveToFile = true) {
    let allLogs = '';

    try {
      // Stream logs in real-time
      await this.streamLogs(buildNumber, (chunk) => {
        process.stdout.write(chunk);
        allLogs += chunk;
      });

      // Get final build status
      const status = await this.getBuildStatus(buildNumber);
      logger.info('\n--- Build Status ---');
      logger.info(`Result: ${status.result}`);
      logger.info(`Duration: ${status.duration}ms`);

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
        logger.info(`Logs saved to: ${filename}`);
      }

      return { logs: allLogs, status };
    } catch (error) {
      logger.error(`Failed to monitor build #${buildNumber}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Wait for a new build to start and monitor it
   */
  async waitForNewBuild(previousBuildNumber, timeout = 300000) {
    const startTime = Date.now();
    logger.info(`Waiting for new build (previous: #${previousBuildNumber})...`);

    while (Date.now() - startTime < timeout) {
      try {
        const latestBuild = await this.getLatestBuildNumber();
        
        if (latestBuild && latestBuild > previousBuildNumber) {
          logger.info(`New build detected: #${latestBuild}`);
          return latestBuild;
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        logger.warn(`Error checking for new build: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    throw new Error('Timeout waiting for new build');
  }
}

// Example usage
if (require.main === module) {
  const config = {
    jenkinsUrl: process.env.JENKINS_URL,
    username: process.env.JENKINS_USERNAME,
    apiToken: process.env.JENKINS_API_TOKEN,
    jobName: process.env.JENKINS_JOB_NAME
  };

  // Validate configuration
  if (!config.username || !config.apiToken) {
    logger.error('Error: JENKINS_USERNAME and JENKINS_API_TOKEN must be set');
    logger.error('Create a .env file with:');
    logger.error('JENKINS_URL=http://your-jenkins-server:port');
    logger.error('JENKINS_USERNAME=your-username');
    logger.error('JENKINS_API_TOKEN=your-api-token');
    logger.error('JENKINS_JOB_NAME=your-job-name');
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
            logger.info(`Monitoring latest build: #${latestBuild}`);
            await capture.monitorBuild(latestBuild);
          } else {
            logger.info('No builds found');
          }
          break;

        case 'build':
          // Monitor specific build number
          const buildNumber = parseInt(args[1], 10);
          if (!buildNumber) {
            logger.error('Usage: node jenkins-log-capture.js build <build-number>');
            process.exit(1);
          }
          logger.info(`Monitoring build: #${buildNumber}`);
          await capture.monitorBuild(buildNumber);
          break;

        case 'fetch':
          // Fetch logs for completed build
          const fetchBuildNumber = parseInt(args[1], 10);
          if (!fetchBuildNumber) {
            logger.error('Usage: node jenkins-log-capture.js fetch <build-number>');
            process.exit(1);
          }
          logger.info(`Fetching logs for build: #${fetchBuildNumber}`);
          await capture.saveLogsToFile(fetchBuildNumber);
          break;

        case 'wait':
          // Wait for next build and monitor it
          const currentBuild = await capture.getLatestBuildNumber();
          const newBuild = await capture.waitForNewBuild(currentBuild || 0);
          await capture.monitorBuild(newBuild);
          break;

        default:
          logger.info('Usage:');
          logger.info('  node jenkins-log-capture.js latest          - Monitor latest build');
          logger.info('  node jenkins-log-capture.js build <number>  - Monitor specific build');
          logger.info('  node jenkins-log-capture.js fetch <number>  - Fetch logs for completed build');
          logger.info('  node jenkins-log-capture.js wait            - Wait for next build and monitor');
          break;
      }
    } catch (error) {
      logger.error(`Error: ${error.message}`, error);
      process.exit(1);
    }
  })();
}

module.exports = JenkinsLogCapture;
module.exports.BUILD_STATUS = BUILD_STATUS;
module.exports.STAGE_STATUS = STAGE_STATUS;
