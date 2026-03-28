import { query } from './connection.js';
import { generateId } from '../utils/helpers.js';
import { initKnowledgeGraphSchema } from '../tools/knowledgeGraph.js';

/**
 * Initialize database schema
 */
export async function initializeSchema() {
  // Create users table
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255),
      device_id VARCHAR(255) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // Create conversations table
  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36),
      title VARCHAR(255),
      summary TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create messages table
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(36) PRIMARY KEY,
      conversation_id VARCHAR(36) NOT NULL,
      role ENUM('user', 'assistant', 'system') NOT NULL,
      content TEXT NOT NULL,
      tokens INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  // Create index for faster message retrieval
  await query(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at)
  `).catch(() => {}); // Index might already exist

  // Create user facts table for long-term memory
  await query(`
    CREATE TABLE IF NOT EXISTS user_facts (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      fact_type VARCHAR(50),
      fact_key VARCHAR(255),
      fact_value TEXT,
      confidence FLOAT DEFAULT 1.0,
      source_message_id VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Initialize knowledge graph tables
  await initKnowledgeGraphSchema();

  console.log('Database schema initialized');
}

/**
 * Get or create a user by device ID
 * @param {string} deviceId - Device identifier
 * @param {string} name - User name (optional)
 * @returns {Promise<Object>} - User object
 */
export async function getOrCreateUser(deviceId, name = null) {
  // Try to find existing user
  const users = await query(
    'SELECT * FROM users WHERE device_id = ?',
    [deviceId]
  );

  if (users.length > 0) {
    return users[0];
  }

  // Create new user
  const userId = generateId();
  await query(
    'INSERT INTO users (id, device_id, name) VALUES (?, ?, ?)',
    [userId, deviceId, name]
  );

  return { id: userId, device_id: deviceId, name };
}

/**
 * Create a new conversation
 * @param {string} userId - User ID
 * @param {string} title - Conversation title (optional)
 * @returns {Promise<Object>} - Conversation object
 */
export async function createConversation(userId, title = null) {
  const conversationId = generateId();

  await query(
    'INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)',
    [conversationId, userId, title || 'New Conversation']
  );

  return { id: conversationId, user_id: userId, title };
}

/**
 * Get user's recent conversations
 * @param {string} userId - User ID
 * @param {number} limit - Max conversations to return
 * @returns {Promise<Array>} - List of conversations
 */
export async function getUserConversations(userId, limit = 10) {
  return query(
    `SELECT c.*,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
     FROM conversations c
     WHERE c.user_id = ?
     ORDER BY c.updated_at DESC
     LIMIT ?`,
    [userId, limit]
  );
}

/**
 * Get or create active conversation for user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Conversation object
 */
export async function getActiveConversation(userId) {
  // Get most recent conversation from last 24 hours
  const conversations = await query(
    `SELECT * FROM conversations
     WHERE user_id = ? AND updated_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );

  if (conversations.length > 0) {
    return conversations[0];
  }

  // Create new conversation
  return createConversation(userId);
}

/**
 * Save a message to conversation
 * @param {string} conversationId - Conversation ID
 * @param {string} role - Message role (user/assistant/system)
 * @param {string} content - Message content
 * @returns {Promise<Object>} - Message object
 */
export async function saveMessage(conversationId, role, content) {
  const messageId = generateId();
  const tokens = Math.ceil(content.length / 4); // Rough token estimate

  await query(
    'INSERT INTO messages (id, conversation_id, role, content, tokens) VALUES (?, ?, ?, ?, ?)',
    [messageId, conversationId, role, content, tokens]
  );

  // Update conversation timestamp
  await query(
    'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
    [conversationId]
  );

  return { id: messageId, conversation_id: conversationId, role, content, tokens };
}

/**
 * Get conversation history
 * @param {string} conversationId - Conversation ID
 * @param {number} limit - Max messages to return
 * @returns {Promise<Array>} - List of messages
 */
export async function getConversationHistory(conversationId, limit = 50) {
  const messages = await query(
    `SELECT role, content, created_at FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC
     LIMIT ${parseInt(limit, 10)}`,
    [conversationId]
  );

  return messages.map(m => ({
    role: m.role,
    content: m.content
  }));
}

/**
 * Save a fact about the user (long-term memory)
 * @param {string} userId - User ID
 * @param {string} factType - Type of fact (name, preference, etc.)
 * @param {string} factKey - Fact key
 * @param {string} factValue - Fact value
 * @param {string} sourceMessageId - Source message ID (optional)
 */
export async function saveUserFact(userId, factType, factKey, factValue, sourceMessageId = null) {
  const factId = generateId();

  // Upsert fact
  await query(
    `INSERT INTO user_facts (id, user_id, fact_type, fact_key, fact_value, source_message_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE fact_value = VALUES(fact_value), updated_at = NOW()`,
    [factId, userId, factType, factKey, factValue, sourceMessageId]
  );
}

/**
 * Get user facts for context
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - List of facts
 */
export async function getUserFacts(userId) {
  return query(
    'SELECT fact_type, fact_key, fact_value FROM user_facts WHERE user_id = ? ORDER BY updated_at DESC',
    [userId]
  );
}

/**
 * Build memory context for LLM
 * @param {string} userId - User ID
 * @param {string} conversationId - Current conversation ID
 * @returns {Promise<string>} - Memory context string
 */
export async function buildMemoryContext(userId, conversationId) {
  const facts = await getUserFacts(userId);
  const history = await getConversationHistory(conversationId, 20);

  let context = '';

  // Add user facts
  if (facts.length > 0) {
    context += 'What I know about the user:\n';
    facts.forEach(f => {
      context += `- ${f.fact_key}: ${f.fact_value}\n`;
    });
    context += '\n';
  }

  return { context, history };
}

/**
 * Update conversation summary
 * @param {string} conversationId - Conversation ID
 * @param {string} summary - Conversation summary
 */
export async function updateConversationSummary(conversationId, summary) {
  await query(
    'UPDATE conversations SET summary = ? WHERE id = ?',
    [summary, conversationId]
  );
}

/**
 * Delete old conversations (cleanup)
 * @param {number} daysOld - Days threshold
 */
export async function cleanupOldConversations(daysOld = 30) {
  await query(
    'DELETE FROM conversations WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [daysOld]
  );
}
