import fetch from 'node-fetch';

// Media Dashboard API configuration - read at runtime to ensure dotenv has loaded
function getConfig() {
  return {
    url: process.env.MEDIA_DASHBOARD_URL || 'http://localhost:3000',
    apiKey: process.env.MEDIA_DASHBOARD_API_KEY || ''
  };
}

/**
 * Make authenticated request to media dashboard
 */
async function makeRequest(endpoint, method = 'GET', timeout = 30000) {
  const config = getConfig();
  const url = `${config.url}${endpoint}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Media Dashboard API error: ${response.status} - ${error}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    console.error(`[MediaDashboard] Request failed: ${error.message}`);
    throw error;
  }
}

export async function getContainers() {
  console.log('[MediaDashboard] Fetching containers...');
  const data = await makeRequest('/api/containers');
  return data.containers || data;
}

export async function getContainerStats(name) {
  console.log(`[MediaDashboard] Fetching stats for: ${name}`);
  return await makeRequest(`/api/stats/${encodeURIComponent(name)}`);
}

export async function restartContainer(name) {
  console.log(`[MediaDashboard] Restarting container: ${name}`);

  // Fire off the restart request but don't wait for it to complete
  makeRequest(`/api/containers/${encodeURIComponent(name)}/restart`, 'POST', 60000)
    .then(() => console.log(`[MediaDashboard] ${name} restarted successfully`))
    .catch(err => console.error(`[MediaDashboard] Failed to restart ${name}:`, err.message));

  // Return immediately with status
  return {
    status: 'restarting',
    container: name,
    message: `Restarting ${name}... This may take a moment.`
  };
}

export async function stopContainer(name) {
  console.log(`[MediaDashboard] Stopping container: ${name}`);

  // Fire off the stop request but don't wait for it to complete
  // This prevents WebSocket timeout issues
  makeRequest(`/api/containers/${encodeURIComponent(name)}/stop`, 'POST', 60000)
    .then(() => console.log(`[MediaDashboard] ${name} stopped successfully`))
    .catch(err => console.error(`[MediaDashboard] Failed to stop ${name}:`, err.message));

  // Return immediately with status
  return {
    status: 'stopping',
    container: name,
    message: `Stopping ${name}... This may take a moment.`
  };
}

export async function startContainer(name) {
  console.log(`[MediaDashboard] Starting container: ${name}`);

  // Fire off the start request but don't wait for it to complete
  makeRequest(`/api/containers/${encodeURIComponent(name)}/start`, 'POST', 60000)
    .then(() => console.log(`[MediaDashboard] ${name} started successfully`))
    .catch(err => console.error(`[MediaDashboard] Failed to start ${name}:`, err.message));

  // Return immediately with status
  return {
    status: 'starting',
    container: name,
    message: `Starting ${name}... This may take a moment.`
  };
}

export async function getContainerLogs(name, lines = 100) {
  console.log(`[MediaDashboard] Fetching logs for: ${name}`);
  return await makeRequest(`/api/logs/${encodeURIComponent(name)}?lines=${lines}`);
}

export async function checkHealth() {
  console.log('[MediaDashboard] Checking health...');
  return await makeRequest('/health');
}

export async function getAllContainerStats() {
  console.log('[MediaDashboard] Fetching all container stats...');
  const containers = await getContainers();

  const statsPromises = containers
    .filter(c => c.State === 'running')
    .map(async (container) => {
      try {
        const name = container.Names?.[0]?.replace('/', '') || container.name;
        const stats = await getContainerStats(name);
        return { name, status: container.State, ...stats };
      } catch (error) {
        const name = container.Names?.[0]?.replace('/', '') || container.name;
        return { name, status: container.State, error: error.message };
      }
    });

  return await Promise.all(statsPromises);
}

// Tool definitions for OpenRouter function calling
export const MEDIA_DASHBOARD_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_media_containers',
      description: 'Get a list of all Docker containers running on the media server.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_container_stats',
      description: 'Get real-time statistics (CPU, RAM, network) for a specific Docker container.',
      parameters: {
        type: 'object',
        properties: {
          container_name: { type: 'string', description: 'Container name (e.g., "plex", "sonarr")' }
        },
        required: ['container_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_all_container_stats',
      description: 'Get statistics for all running containers at once.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'restart_container',
      description: 'Restart a Docker container when a service has issues.',
      parameters: {
        type: 'object',
        properties: {
          container_name: { type: 'string', description: 'Container name to restart' }
        },
        required: ['container_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stop_container',
      description: 'Stop a running Docker container.',
      parameters: {
        type: 'object',
        properties: {
          container_name: { type: 'string', description: 'Container name to stop' }
        },
        required: ['container_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'start_container',
      description: 'Start a stopped Docker container.',
      parameters: {
        type: 'object',
        properties: {
          container_name: { type: 'string', description: 'Container name to start' }
        },
        required: ['container_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_container_logs',
      description: 'Get recent logs from a Docker container for debugging.',
      parameters: {
        type: 'object',
        properties: {
          container_name: { type: 'string', description: 'Container name' },
          lines: { type: 'number', description: 'Number of log lines (default: 50)' }
        },
        required: ['container_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_media_server_health',
      description: 'Check if the media dashboard server is online.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }
];

/**
 * Execute a tool call
 */
export async function executeTool(toolName, args = {}) {
  console.log(`[Tools] Executing: ${toolName}`, args);

  try {
    switch (toolName) {
      case 'get_media_containers':
        return await getContainers();
      case 'get_container_stats':
        return await getContainerStats(args.container_name);
      case 'get_all_container_stats':
        return await getAllContainerStats();
      case 'restart_container':
        return await restartContainer(args.container_name);
      case 'stop_container':
        return await stopContainer(args.container_name);
      case 'start_container':
        return await startContainer(args.container_name);
      case 'get_container_logs':
        return await getContainerLogs(args.container_name, args.lines || 50);
      case 'check_media_server_health':
        return await checkHealth();
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[Tools] Execution failed: ${error.message}`);
    return { error: error.message };
  }
}
