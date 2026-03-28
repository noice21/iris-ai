import { query } from '../database/connection.js';
import { generateId } from '../utils/helpers.js';

/**
 * Initialize knowledge graph database tables
 */
export async function initKnowledgeGraphSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS knowledge_entities (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_ke_user (user_id),
      INDEX idx_ke_name (user_id, name),
      INDEX idx_ke_type (user_id, entity_type)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS knowledge_relations (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      from_entity_id VARCHAR(36) NOT NULL,
      to_entity_id VARCHAR(36) NOT NULL,
      relation_type VARCHAR(100) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (from_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (to_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
      INDEX idx_kr_from (from_entity_id),
      INDEX idx_kr_to (to_entity_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS knowledge_observations (
      id VARCHAR(36) PRIMARY KEY,
      entity_id VARCHAR(36) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
      INDEX idx_ko_entity (entity_id)
    )
  `);

  console.log('Knowledge graph schema initialized');
}

/**
 * Find an entity by name (case-insensitive) for a user
 */
async function findEntity(userId, name) {
  const rows = await query(
    'SELECT * FROM knowledge_entities WHERE user_id = ? AND LOWER(name) = LOWER(?)',
    [userId, name]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Create a new entity
 */
async function createEntity(userId, name, entityType, description = null) {
  // Check if entity already exists
  const existing = await findEntity(userId, name);
  if (existing) {
    return {
      success: false,
      error: `Entity "${name}" already exists (type: ${existing.entity_type}). Use add_observation to add more information.`
    };
  }

  const id = generateId();
  await query(
    'INSERT INTO knowledge_entities (id, user_id, name, entity_type, description) VALUES (?, ?, ?, ?, ?)',
    [id, userId, name, entityType, description]
  );

  return {
    success: true,
    entity: { id, name, entity_type: entityType, description },
    message: `Created ${entityType} entity "${name}"`
  };
}

/**
 * Create a relation between two entities
 */
async function createRelation(userId, fromEntityName, toEntityName, relationType, description = null) {
  const fromEntity = await findEntity(userId, fromEntityName);
  if (!fromEntity) {
    return {
      success: false,
      error: `Entity "${fromEntityName}" not found. Create it first with create_entity.`
    };
  }

  const toEntity = await findEntity(userId, toEntityName);
  if (!toEntity) {
    return {
      success: false,
      error: `Entity "${toEntityName}" not found. Create it first with create_entity.`
    };
  }

  const id = generateId();
  await query(
    'INSERT INTO knowledge_relations (id, user_id, from_entity_id, to_entity_id, relation_type, description) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, fromEntity.id, toEntity.id, relationType, description]
  );

  return {
    success: true,
    relation: {
      id,
      from: fromEntity.name,
      to: toEntity.name,
      relation_type: relationType,
      description
    },
    message: `Created relation: ${fromEntity.name} --[${relationType}]--> ${toEntity.name}`
  };
}

/**
 * Add an observation to an entity
 */
async function addObservation(userId, entityName, content) {
  const entity = await findEntity(userId, entityName);
  if (!entity) {
    return {
      success: false,
      error: `Entity "${entityName}" not found. Create it first with create_entity.`
    };
  }

  const id = generateId();
  await query(
    'INSERT INTO knowledge_observations (id, entity_id, content) VALUES (?, ?, ?)',
    [id, entity.id, content]
  );

  return {
    success: true,
    observation: { id, entity_name: entity.name, content },
    message: `Added observation to "${entity.name}": ${content}`
  };
}

/**
 * Search entities by name or description
 */
async function searchKnowledge(userId, searchQuery, entityType = null) {
  let sql = `
    SELECT e.*,
      (SELECT COUNT(*) FROM knowledge_relations WHERE from_entity_id = e.id OR to_entity_id = e.id) as relation_count,
      (SELECT COUNT(*) FROM knowledge_observations WHERE entity_id = e.id) as observation_count
    FROM knowledge_entities e
    WHERE e.user_id = ? AND (LOWER(e.name) LIKE LOWER(?) OR LOWER(e.description) LIKE LOWER(?))
  `;
  const params = [userId, `%${searchQuery}%`, `%${searchQuery}%`];

  if (entityType) {
    sql += ' AND e.entity_type = ?';
    params.push(entityType);
  }

  sql += ' ORDER BY e.updated_at DESC LIMIT 20';

  const entities = await query(sql, params);

  return {
    success: true,
    query: searchQuery,
    resultCount: entities.length,
    entities: entities.map(e => ({
      name: e.name,
      entity_type: e.entity_type,
      description: e.description,
      relation_count: e.relation_count,
      observation_count: e.observation_count
    }))
  };
}

/**
 * Get full entity details with relations and observations
 */
async function getEntity(userId, entityName) {
  const entity = await findEntity(userId, entityName);
  if (!entity) {
    return {
      success: false,
      error: `Entity "${entityName}" not found.`
    };
  }

  // Get relations where this entity is the source
  const outgoingRelations = await query(`
    SELECT kr.relation_type, kr.description, ke.name as target_name, ke.entity_type as target_type
    FROM knowledge_relations kr
    JOIN knowledge_entities ke ON kr.to_entity_id = ke.id
    WHERE kr.from_entity_id = ?
    ORDER BY kr.created_at DESC
  `, [entity.id]);

  // Get relations where this entity is the target
  const incomingRelations = await query(`
    SELECT kr.relation_type, kr.description, ke.name as source_name, ke.entity_type as source_type
    FROM knowledge_relations kr
    JOIN knowledge_entities ke ON kr.from_entity_id = ke.id
    WHERE kr.to_entity_id = ?
    ORDER BY kr.created_at DESC
  `, [entity.id]);

  // Get observations
  const observations = await query(
    'SELECT content, created_at FROM knowledge_observations WHERE entity_id = ? ORDER BY created_at DESC',
    [entity.id]
  );

  return {
    success: true,
    entity: {
      name: entity.name,
      entity_type: entity.entity_type,
      description: entity.description,
      created_at: entity.created_at
    },
    relations: {
      outgoing: outgoingRelations.map(r => ({
        relation: r.relation_type,
        target: r.target_name,
        target_type: r.target_type,
        description: r.description
      })),
      incoming: incomingRelations.map(r => ({
        relation: r.relation_type,
        source: r.source_name,
        source_type: r.source_type,
        description: r.description
      }))
    },
    observations: observations.map(o => ({
      content: o.content,
      created_at: o.created_at
    }))
  };
}

/**
 * Delete an entity and cascade relations/observations
 */
async function deleteEntity(userId, entityName) {
  const entity = await findEntity(userId, entityName);
  if (!entity) {
    return {
      success: false,
      error: `Entity "${entityName}" not found.`
    };
  }

  // CASCADE will handle relations and observations
  await query('DELETE FROM knowledge_entities WHERE id = ? AND user_id = ?', [entity.id, userId]);

  return {
    success: true,
    message: `Deleted entity "${entity.name}" and all its relations and observations`
  };
}

// Tool definitions
export const KNOWLEDGE_GRAPH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_entity',
      description: 'Create a new entity in the knowledge graph for long-term memory. Entities represent people, places, concepts, projects, or organizations that you want to remember.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the entity (e.g., "John Smith", "New York", "Project Alpha")'
          },
          entity_type: {
            type: 'string',
            description: 'Type of entity: person, place, concept, project, organization, or other'
          },
          description: {
            type: 'string',
            description: 'Brief description of the entity'
          }
        },
        required: ['name', 'entity_type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_relation',
      description: 'Create a relationship between two entities in the knowledge graph. Both entities must exist first.',
      parameters: {
        type: 'object',
        properties: {
          from_entity: {
            type: 'string',
            description: 'Name of the source entity'
          },
          to_entity: {
            type: 'string',
            description: 'Name of the target entity'
          },
          relation_type: {
            type: 'string',
            description: 'Type of relationship (e.g., "works_at", "lives_in", "knows", "part_of", "created_by", "manages")'
          },
          description: {
            type: 'string',
            description: 'Optional description of the relationship'
          }
        },
        required: ['from_entity', 'to_entity', 'relation_type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_observation',
      description: 'Add an observation or note about an existing entity. Use this to record new facts, events, or details about a person, place, or concept.',
      parameters: {
        type: 'object',
        properties: {
          entity_name: {
            type: 'string',
            description: 'Name of the entity to add the observation to'
          },
          content: {
            type: 'string',
            description: 'The observation or note to record'
          }
        },
        required: ['entity_name', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: 'Search the knowledge graph for entities matching a query. Searches entity names and descriptions.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match against entity names and descriptions'
          },
          entity_type: {
            type: 'string',
            description: 'Optional filter by entity type (person, place, concept, project, organization)'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_entity',
      description: 'Get full details of an entity including all its relationships and observations.',
      parameters: {
        type: 'object',
        properties: {
          entity_name: {
            type: 'string',
            description: 'Name of the entity to retrieve'
          }
        },
        required: ['entity_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_entity',
      description: 'Delete an entity and all its relationships and observations from the knowledge graph.',
      parameters: {
        type: 'object',
        properties: {
          entity_name: {
            type: 'string',
            description: 'Name of the entity to delete'
          }
        },
        required: ['entity_name']
      }
    }
  }
];

/**
 * Execute a knowledge graph tool
 */
export async function executeKnowledgeGraphTool(toolName, args = {}, context = {}) {
  const userId = context.userId;
  if (!userId) {
    return { success: false, error: 'User context not available for knowledge graph operations.' };
  }

  console.log(`[KnowledgeGraph] Executing tool: ${toolName}`, args);

  try {
    switch (toolName) {
      case 'create_entity':
        return await createEntity(userId, args.name, args.entity_type, args.description);

      case 'create_relation':
        return await createRelation(userId, args.from_entity, args.to_entity, args.relation_type, args.description);

      case 'add_observation':
        return await addObservation(userId, args.entity_name, args.content);

      case 'search_knowledge':
        return await searchKnowledge(userId, args.query, args.entity_type);

      case 'get_entity':
        return await getEntity(userId, args.entity_name);

      case 'delete_entity':
        return await deleteEntity(userId, args.entity_name);

      default:
        throw new Error(`Unknown knowledge graph tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[KnowledgeGraph] Tool execution failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
