import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { setupRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';
import { getPool, closePool } from '../database/connection.js';
import { initializeSchema } from '../database/memory.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({
  logger: true
});

// Python service process reference
let pythonProcess = null;

// Start Python TTS/STT service if using local providers
function startPythonService() {
  const ttsProvider = (process.env.TTS_PROVIDER || 'local').toLowerCase();
  const sttProvider = (process.env.STT_PROVIDER || 'local').toLowerCase();

  if (ttsProvider !== 'local' && sttProvider !== 'local') {
    console.log('[Python Service] Not starting - using external TTS/STT providers');
    return;
  }

  const pythonServicePath = join(__dirname, '../../python_service');

  console.log('[Python Service] Starting local TTS/STT service...');
  console.log('[Python Service] Path:', pythonServicePath);

  // Set environment for Python service (PORT=5000, not 3001)
  const pythonEnv = {
    ...process.env,
    PORT: process.env.LOCAL_TTS_PORT || '5000',
    WHISPER_MODEL: process.env.WHISPER_MODEL || 'base',
    DEBUG: 'false'
  };

  pythonProcess = spawn('python', ['server.py'], {
    cwd: pythonServicePath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: pythonEnv
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python Service] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();
    // Filter out Flask development server warnings
    if (!message.includes('WARNING: This is a development server')) {
      console.error(`[Python Service] ${message}`);
    }
  });

  pythonProcess.on('error', (error) => {
    console.error('[Python Service] Failed to start:', error.message);
    console.error('[Python Service] Make sure Python is installed and in your PATH');
  });

  pythonProcess.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[Python Service] Exited with code ${code}`);
    } else if (signal) {
      console.log(`[Python Service] Terminated with signal ${signal}`);
    }
    pythonProcess = null;
  });

  console.log('[Python Service] Started with PID:', pythonProcess.pid);
}

async function start() {
  // Initialize database
  await getPool();
  await initializeSchema();
  console.log('Database initialized');

  // Start Python service for local TTS/STT
  startPythonService();

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
async function shutdown() {
  console.log('Shutting down...');

  // Stop Python service if running
  if (pythonProcess && !pythonProcess.killed) {
    console.log('[Python Service] Stopping...');
    pythonProcess.kill('SIGTERM');
    // Give it 2 seconds to gracefully shut down
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (pythonProcess && !pythonProcess.killed) {
      pythonProcess.kill('SIGKILL');
    }
  }

  await fastify.close();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();

export { fastify };
