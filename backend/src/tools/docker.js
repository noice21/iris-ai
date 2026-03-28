import Docker from 'dockerode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Local mode only — export empty tools in cloud mode
function isLocalMode() {
  return process.env.CLOUD_MODE !== 'true';
}

// Initialize Docker client (auto-detects Windows named pipe / Unix socket)
const docker = new Docker();

/**
 * Sanitize input for CLI commands (used only by composeStatus)
 */
function sanitizeInput(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid input');
  }
  if (!/^[a-zA-Z0-9_\-./: ]+$/.test(input)) {
    throw new Error(`Invalid input: "${input}" contains disallowed characters`);
  }
  return input.trim();
}

/**
 * Format container data from dockerode
 */
function formatContainer(c) {
  return {
    id: c.Id.substring(0, 12),
    name: c.Names[0].replace(/^\//, ''),
    image: c.Image,
    status: c.Status,
    state: c.State,
    ports: (c.Ports || []).map(p => ({
      private: p.PrivatePort,
      public: p.PublicPort || null,
      type: p.Type
    })),
    created: new Date(c.Created * 1000).toISOString()
  };
}

/**
 * Calculate formatted stats from raw dockerode stats
 */
function formatStats(stats) {
  // CPU usage percentage
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuPercent = systemDelta > 0
    ? (cpuDelta / systemDelta) * (stats.cpu_stats.online_cpus || 1) * 100
    : 0;

  // Memory usage
  const memUsage = stats.memory_stats.usage || 0;
  const memLimit = stats.memory_stats.limit || 0;
  const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

  // Network I/O
  const networks = stats.networks || {};
  let rxBytes = 0;
  let txBytes = 0;
  Object.values(networks).forEach(net => {
    rxBytes += net.rx_bytes || 0;
    txBytes += net.tx_bytes || 0;
  });

  return {
    cpu: {
      percent: parseFloat(cpuPercent.toFixed(2)),
      cores: stats.cpu_stats.online_cpus || 1
    },
    memory: {
      usageMB: parseFloat((memUsage / 1024 / 1024).toFixed(2)),
      limitMB: parseFloat((memLimit / 1024 / 1024).toFixed(2)),
      percent: parseFloat(memPercent.toFixed(2))
    },
    network: {
      rxMB: parseFloat((rxBytes / 1024 / 1024).toFixed(2)),
      txMB: parseFloat((txBytes / 1024 / 1024).toFixed(2))
    }
  };
}

/**
 * List Docker containers
 */
async function listContainers(showAll = true) {
  const containers = await docker.listContainers({ all: showAll });

  return {
    success: true,
    containerCount: containers.length,
    containers: containers.map(formatContainer)
  };
}

/**
 * Get container stats
 */
async function containerStats(container) {
  const c = docker.getContainer(container);
  const stats = await c.stats({ stream: false });

  return {
    success: true,
    container,
    stats: formatStats(stats)
  };
}

/**
 * Start a container
 */
async function startContainer(container) {
  const c = docker.getContainer(container);
  await c.start();
  return {
    success: true,
    container,
    message: `Container "${container}" started successfully`
  };
}

/**
 * Stop a container
 */
async function stopContainer(container) {
  const c = docker.getContainer(container);
  await c.stop();
  return {
    success: true,
    container,
    message: `Container "${container}" stopped successfully`
  };
}

/**
 * Restart a container
 */
async function restartContainer(container) {
  const c = docker.getContainer(container);
  await c.restart();
  return {
    success: true,
    container,
    message: `Container "${container}" restarted successfully`
  };
}

/**
 * Get container logs
 */
async function containerLogs(container, lines = 50) {
  const numLines = Math.min(Math.max(parseInt(lines) || 50, 1), 500);
  const c = docker.getContainer(container);
  const logs = await c.logs({
    stdout: true,
    stderr: true,
    tail: numLines,
    timestamps: true
  });

  // Convert buffer to string, strip Docker log header (first 8 bytes per line)
  const logString = logs.toString('utf8');
  const logLines = logString
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.substring(8));

  return {
    success: true,
    container,
    lines: numLines,
    logs: logLines.join('\n')
  };
}

/**
 * List Docker images
 */
async function listImages() {
  const images = await docker.listImages();

  return {
    success: true,
    imageCount: images.length,
    images: images.map(i => ({
      repository: (i.RepoTags && i.RepoTags[0]) ? i.RepoTags[0].split(':')[0] : '<none>',
      tag: (i.RepoTags && i.RepoTags[0]) ? i.RepoTags[0].split(':')[1] : '<none>',
      id: i.Id.replace('sha256:', '').substring(0, 12),
      size: parseFloat((i.Size / 1024 / 1024).toFixed(2)) + ' MB',
      created: new Date(i.Created * 1000).toISOString()
    }))
  };
}

/**
 * Get docker compose status (still uses CLI — dockerode doesn't support compose)
 */
async function composeStatus(projectDir = null) {
  let command = 'docker compose ps --format json';
  if (projectDir) {
    const dir = sanitizeInput(projectDir);
    command = `docker compose -f "${dir}/docker-compose.yml" ps --format json`;
  }

  try {
    const { stdout } = await execAsync(command, { timeout: 30000 });

    let services = [];
    if (stdout.trim()) {
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      services = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    }

    return {
      success: true,
      serviceCount: services.length,
      services: services.map(s => ({
        name: s.Name || s.Service,
        service: s.Service,
        status: s.Status || s.State,
        ports: s.Ports || s.Publishers,
        image: s.Image
      }))
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: 'No docker-compose.yml found or docker compose is not available.'
    };
  }
}

// Tool definitions — empty in cloud mode
export const DOCKER_TOOLS = isLocalMode() ? [
  {
    type: 'function',
    function: {
      name: 'docker_list_containers',
      description: 'List Docker containers on the local machine. Shows container names, images, status, and ports.',
      parameters: {
        type: 'object',
        properties: {
          all: {
            type: 'boolean',
            description: 'Include stopped containers (default: true)'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_container_stats',
      description: 'Get real-time CPU, memory, and network stats for a Docker container.',
      parameters: {
        type: 'object',
        properties: {
          container: {
            type: 'string',
            description: 'Container name or ID'
          }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_start_container',
      description: 'Start a stopped Docker container.',
      parameters: {
        type: 'object',
        properties: {
          container: {
            type: 'string',
            description: 'Container name or ID to start'
          }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_stop_container',
      description: 'Stop a running Docker container.',
      parameters: {
        type: 'object',
        properties: {
          container: {
            type: 'string',
            description: 'Container name or ID to stop'
          }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_restart_container',
      description: 'Restart a Docker container.',
      parameters: {
        type: 'object',
        properties: {
          container: {
            type: 'string',
            description: 'Container name or ID to restart'
          }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_container_logs',
      description: 'Get recent log output from a Docker container.',
      parameters: {
        type: 'object',
        properties: {
          container: {
            type: 'string',
            description: 'Container name or ID'
          },
          lines: {
            type: 'number',
            description: 'Number of recent log lines to return (default: 50, max: 500)'
          }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_list_images',
      description: 'List Docker images on the local machine.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_compose_status',
      description: 'Get the status of docker compose services.',
      parameters: {
        type: 'object',
        properties: {
          project_dir: {
            type: 'string',
            description: 'Path to the directory containing docker-compose.yml (optional, uses current directory if not specified)'
          }
        },
        required: []
      }
    }
  }
] : [];

/**
 * Execute a Docker tool
 */
export async function executeDockerTool(toolName, args = {}) {
  console.log(`[Docker] Executing tool: ${toolName}`, args);

  try {
    switch (toolName) {
      case 'docker_list_containers':
        return await listContainers(args.all !== false);

      case 'docker_container_stats':
        return await containerStats(args.container);

      case 'docker_start_container':
        return await startContainer(args.container);

      case 'docker_stop_container':
        return await stopContainer(args.container);

      case 'docker_restart_container':
        return await restartContainer(args.container);

      case 'docker_container_logs':
        return await containerLogs(args.container, args.lines || 50);

      case 'docker_list_images':
        return await listImages();

      case 'docker_compose_status':
        return await composeStatus(args.project_dir);

      default:
        throw new Error(`Unknown Docker tool: ${toolName}`);
    }
  } catch (error) {
    // Friendly error if Docker daemon is unreachable
    if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED') || error.message.includes('EPIPE')) {
      return { success: false, error: 'Docker is not running or not installed. Please start Docker Desktop and try again.' };
    }
    console.error(`[Docker] Tool execution failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
