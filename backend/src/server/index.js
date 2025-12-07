import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import dotenv from 'dotenv';

import { setupRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';
import { getPool, closePool } from '../database/connection.js';
import { initializeSchema } from '../database/memory.js';

dotenv.config();

const fastify = Fastify({
  logger: true
});

async function start() {
  // Initialize database
  await getPool();
  await initializeSchema();
  console.log('Database initialized');

  // Register plugins
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB max file size
    }
  });

  await fastify.register(websocket);

  // Setup HTTP routes
  setupRoutes(fastify);

  // Setup WebSocket handlers
  setupWebSocket(fastify);

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Start server
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    console.log(`Server running at http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await fastify.close();
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await fastify.close();
  await closePool();
  process.exit(0);
});

start();

export { fastify };
