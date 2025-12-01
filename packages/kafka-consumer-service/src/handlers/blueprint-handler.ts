/**
 * Blueprint handler - manages Port.io blueprints and entities
 */

import { logger } from '@cicd/shared';
import type PortKafkaConsumer from '../consumer';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface BlueprintDefinition {
  identifier: string;
  title: string;
  icon?: string;
  schema: {
    properties: Record<string, any>;
    required?: string[];
  };
  relations?: Record<string, any>;
  calculationProperties?: Record<string, any>;
}

interface EntityData {
  identifier: string;
  title: string;
  properties: Record<string, any>;
  relations?: Record<string, any>;
}

export class BlueprintHandler {
  private consumer: PortKafkaConsumer;
  private blueprintsDir: string;

  constructor(consumer: PortKafkaConsumer, blueprintsDir?: string) {
    this.consumer = consumer;
    this.blueprintsDir = blueprintsDir || path.join(process.cwd(), 'blueprints');
  }

  /**
   * Load blueprint from JSON file
   */
  loadBlueprintFromFile(filename: string): BlueprintDefinition {
    const filePath = path.join(this.blueprintsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Blueprint file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Create or update a blueprint in Port
   */
  async createOrUpdateBlueprint(blueprint: BlueprintDefinition): Promise<void> {
    const token = await this.consumer.getAccessToken();
    const orgId = process.env.PORT_ORG_ID;

    logger.info(`Creating/updating blueprint: ${blueprint.identifier}`);

    try {
      const response = await axios.put(
        `https://api.getport.io/v1/blueprints/${blueprint.identifier}`,
        blueprint,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info(`Blueprint ${blueprint.identifier} created/updated successfully`);
      return response.data;
    } catch (error: any) {
      logger.error(`Failed to create/update blueprint: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create entity from blueprint
   */
  async createEntity(
    blueprintId: string,
    entityData: EntityData,
    runId?: string
  ): Promise<void> {
    const token = await this.consumer.getAccessToken();

    logger.info(`Creating entity: ${entityData.identifier} (blueprint: ${blueprintId})`);

    if (runId) {
      await this.consumer.addActionRunLog(
        runId,
        `Creating ${blueprintId} entity: ${entityData.title}`
      );
    }

    try {
      const response = await axios.post(
        `https://api.getport.io/v1/blueprints/${blueprintId}/entities?upsert=true&merge=true`,
        entityData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info(`Entity ${entityData.identifier} created successfully`);
      
      if (runId) {
        await this.consumer.addActionRunLog(
          runId,
          `Entity created: ${entityData.identifier}`,
          'SUCCESS'
        );
      }

      return response.data;
    } catch (error: any) {
      logger.error(`Failed to create entity: ${error.message}`);
      
      if (runId) {
        await this.consumer.addActionRunLog(
          runId,
          `Failed to create entity: ${error.message}`,
          'FAILURE'
        );
      }
      
      throw error;
    }
  }

  /**
   * Handle blueprint creation action from Port
   */
  async handleCreateBlueprintAction(message: any, consumer: PortKafkaConsumer): Promise<void> {
    const runId = message.context.runId;
    const properties = message.payload.properties || {};

    try {
      // Load blueprint from file or use provided definition
      let blueprint: BlueprintDefinition;

      if (properties.blueprintFile) {
        // Load from file
        blueprint = this.loadBlueprintFromFile(properties.blueprintFile);
        await consumer.addActionRunLog(
          runId,
          `Loaded blueprint from file: ${properties.blueprintFile}`
        );
      } else if (properties.blueprintDefinition) {
        // Use provided definition
        blueprint = properties.blueprintDefinition;
        await consumer.addActionRunLog(
          runId,
          `Using provided blueprint definition`
        );
      } else {
        throw new Error('No blueprint file or definition provided');
      }

      // Create/update the blueprint
      await this.createOrUpdateBlueprint(blueprint);

      await consumer.addActionRunLog(
        runId,
        `Blueprint ${blueprint.identifier} created successfully`,
        'SUCCESS'
      );

    } catch (error: any) {
      logger.error('Error creating blueprint:', error);
      await consumer.addActionRunLog(
        runId,
        `Failed to create blueprint: ${error.message}`,
        'FAILURE'
      );
      throw error;
    }
  }

  /**
   * Handle entity creation action from Port
   */
  async handleCreateEntityAction(message: any, consumer: PortKafkaConsumer): Promise<void> {
    const runId = message.context.runId;
    const properties = message.payload.properties || {};

    try {
      const blueprintId = properties.blueprintId || properties.blueprint;
      
      if (!blueprintId) {
        throw new Error('Blueprint ID is required');
      }

      // Build entity data from properties
      const entityData: EntityData = {
        identifier: properties.identifier || properties.title?.replace(/\s+/g, '-').toLowerCase() || `entity-${Date.now()}`,
        title: properties.title || 'New Entity',
        properties: properties.entityProperties || {},
        relations: properties.relations || {},
      };

      await consumer.addActionRunLog(
        runId,
        `Creating entity in blueprint: ${blueprintId}`
      );

      // Create the entity
      await this.createEntity(blueprintId, entityData, runId);

      await consumer.addActionRunLog(
        runId,
        `Entity ${entityData.identifier} created successfully`,
        'SUCCESS'
      );

    } catch (error: any) {
      logger.error('Error creating entity:', error);
      await consumer.addActionRunLog(
        runId,
        `Failed to create entity: ${error.message}`,
        'FAILURE'
      );
      throw error;
    }
  }
}

/**
 * Main handler function for blueprint-related actions
 */
export async function handleBlueprintAction(message: any, consumer: PortKafkaConsumer): Promise<void> {
  const action = message.payload.action;
  const handler = new BlueprintHandler(consumer);

  if (action.identifier.includes('create_blueprint')) {
    await handler.handleCreateBlueprintAction(message, consumer);
  } else if (action.identifier.includes('create_entity')) {
    await handler.handleCreateEntityAction(message, consumer);
  } else {
    throw new Error(`Unknown blueprint action: ${action.identifier}`);
  }
}
