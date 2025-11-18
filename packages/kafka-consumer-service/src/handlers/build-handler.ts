/**
 * Build action handler - triggers CI/CD builds and streams logs to Port
 */

import { pluginRegistry, logger } from '@cicd/shared';
import type PortKafkaConsumer from '../consumer';

export async function handleBuildAction(message: any, consumer: PortKafkaConsumer): Promise<void> {
  const runId = message.context.runId;
  const props = message.properties;
  
  // Determine which CI/CD provider to use
  const provider = props.provider || props.ci_provider || 'jenkins';
  const ciProvider = pluginRegistry.getProvider(provider);
  
  if (!ciProvider) {
    throw new Error(`CI/CD provider '${provider}' is not registered. Available providers: ${pluginRegistry.getProviderNames().join(', ')}`);
  }
  
  await consumer.addActionRunLog(runId, `🚀 Starting build using ${provider}...`);
  
  const serviceName = props.serviceName || props.service_name || 'service';
  const version = props.version || '1.0.0';
  const environment = props.environment || 'dev';
  const branch = props.branch || 'main';
  
  await consumer.addActionRunLog(runId, `Service: ${serviceName}`);
  await consumer.addActionRunLog(runId, `Version: ${version}`);
  await consumer.addActionRunLog(runId, `Environment: ${environment}`);
  await consumer.addActionRunLog(runId, `Branch: ${branch}`);
  
  try {
    // Step 1: Trigger build
    await consumer.addActionRunLog(runId, '📡 Triggering build...');
    
    const buildInfo = await ciProvider.triggerBuild({
      SERVICE_NAME: serviceName,
      VERSION: version,
      ENVIRONMENT: environment,
      BRANCH: branch,
      PORT_RUN_ID: runId,
      ...props, // Pass through any additional properties
    });
    
    await consumer.addActionRunLog(runId, `✅ Build #${buildInfo.buildNumber} started`);
    
    // Step 2: Update Port with build link
    await consumer.updateActionRun(runId, {
      link: [buildInfo.buildUrl],
      statusLabel: `Build #${buildInfo.buildNumber} in progress`,
    });
    
    // Step 3: Stream build logs to Port in real-time
    await consumer.addActionRunLog(runId, '📋 Streaming build logs...');
    await consumer.addActionRunLog(runId, '─'.repeat(80));
    
    let logBuffer = '';
    const CHUNK_SIZE = 500; // Send logs in chunks to avoid overwhelming Port API
    
    await ciProvider.streamLogs(buildInfo.buildId, async (logChunk: string) => {
      logBuffer += logChunk;
      
      // Send logs in chunks to Port
      if (logBuffer.length >= CHUNK_SIZE) {
        await consumer.addActionRunLog(runId, logBuffer);
        logBuffer = '';
      }
    });
    
    // Send any remaining logs
    if (logBuffer.length > 0) {
      await consumer.addActionRunLog(runId, logBuffer);
    }
    
    await consumer.addActionRunLog(runId, '─'.repeat(80));
    
    // Step 4: Get final build status
    const buildStatus = await ciProvider.getBuildStatus(buildInfo.buildId);
    const isSuccess = buildStatus.status === 'success';
    const duration = buildStatus.duration ? (buildStatus.duration / 1000).toFixed(2) : 'N/A';
    
    await consumer.updateActionRun(runId, {
      statusLabel: `Build ${buildStatus.result} (${duration}s)`,
    });
    
    if (isSuccess) {
      await consumer.addActionRunLog(
        runId,
        `✅ Successfully completed build #${buildInfo.buildNumber}!\nDuration: ${duration}s`
      );
    } else {
      throw new Error(`Build failed with status: ${buildStatus.result}`);
    }
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await consumer.addActionRunLog(
      runId,
      `❌ Build failed: ${errorMsg}`
    );
    throw error;
  }
}
