import fetch from 'node-fetch';

/**
 * Smart Lights Control Tools
 * Control Govee and Nanoleaf LED lights through natural conversation
 */

// Configuration - read at runtime
function getConfig() {
  return {
    url: process.env.MEDIA_DASHBOARD_URL || 'http://localhost:3000',
    apiKey: process.env.MEDIA_DASHBOARD_API_KEY || ''
  };
}

/**
 * Make authenticated request to lights API
 */
async function makeRequest(endpoint, method = 'GET', body = null, timeout = 15000) {
  const config = getConfig();
  const url = `${config.url}${endpoint}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey
      },
      signal: controller.signal
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Lights API error: ${response.status} - ${error}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    console.error(`[Lights] Request failed: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Tool Implementation Functions
// ============================================================================

export async function getLights() {
  console.log('[Lights] Fetching all LED devices...');
  const data = await makeRequest('/api/lights');

  // Format response for easier understanding
  const devices = [
    ...data.govee.map(d => ({ ...d, brand: 'Govee' })),
    ...data.nanoleaf.map(d => ({ ...d, brand: 'Nanoleaf' }))
  ];

  return {
    devices,
    total: data.total,
    summary: `Found ${data.total} smart lights (${data.govee.length} Govee, ${data.nanoleaf.length} Nanoleaf)`
  };
}

export async function turnOnLight(deviceName) {
  console.log(`[Lights] Turning on: ${deviceName}`);
  // Get devices to find the ID
  const lightsData = await getLights();
  const device = lightsData.devices.find(d =>
    d.name.toLowerCase().includes(deviceName.toLowerCase()) ||
    d.id.toLowerCase().includes(deviceName.toLowerCase())
  );

  if (!device) {
    throw new Error(`Could not find device matching "${deviceName}". Available devices: ${lightsData.devices.map(d => d.name).join(', ')}`);
  }

  await makeRequest(`/api/lights/${device.id}/power`, 'POST', { state: true });
  return { success: true, device: device.name, action: 'turned on' };
}

export async function turnOffLight(deviceName) {
  console.log(`[Lights] Turning off: ${deviceName}`);
  const lightsData = await getLights();
  const device = lightsData.devices.find(d =>
    d.name.toLowerCase().includes(deviceName.toLowerCase()) ||
    d.id.toLowerCase().includes(deviceName.toLowerCase())
  );

  if (!device) {
    throw new Error(`Could not find device matching "${deviceName}". Available devices: ${lightsData.devices.map(d => d.name).join(', ')}`);
  }

  await makeRequest(`/api/lights/${device.id}/power`, 'POST', { state: false });
  return { success: true, device: device.name, action: 'turned off' };
}

export async function turnOnAllLights() {
  console.log('[Lights] Turning on all lights...');
  const lightsData = await getLights();

  const results = await Promise.allSettled(
    lightsData.devices.map(device =>
      makeRequest(`/api/lights/${device.id}/power`, 'POST', { state: true })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  return {
    success: true,
    action: 'turned on',
    devicesAffected: succeeded,
    total: lightsData.devices.length
  };
}

export async function turnOffAllLights() {
  console.log('[Lights] Turning off all lights...');
  const lightsData = await getLights();

  const results = await Promise.allSettled(
    lightsData.devices.map(device =>
      makeRequest(`/api/lights/${device.id}/power`, 'POST', { state: false })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  return {
    success: true,
    action: 'turned off',
    devicesAffected: succeeded,
    total: lightsData.devices.length
  };
}

export async function setBrightness(deviceName, brightness) {
  console.log(`[Lights] Setting brightness for ${deviceName} to ${brightness}%`);
  const lightsData = await getLights();
  const device = lightsData.devices.find(d =>
    d.name.toLowerCase().includes(deviceName.toLowerCase()) ||
    d.id.toLowerCase().includes(deviceName.toLowerCase())
  );

  if (!device) {
    throw new Error(`Could not find device matching "${deviceName}"`);
  }

  // Clamp brightness to 0-100
  const clampedBrightness = Math.max(0, Math.min(100, brightness));

  await makeRequest(`/api/lights/${device.id}/brightness`, 'POST', {
    brightness: clampedBrightness
  });

  return {
    success: true,
    device: device.name,
    brightness: clampedBrightness
  };
}

export async function setLightColor(deviceName, color) {
  console.log(`[Lights] Setting color for ${deviceName} to ${color}`);
  const lightsData = await getLights();
  const device = lightsData.devices.find(d =>
    d.name.toLowerCase().includes(deviceName.toLowerCase()) ||
    d.id.toLowerCase().includes(deviceName.toLowerCase())
  );

  if (!device) {
    throw new Error(`Could not find device matching "${deviceName}"`);
  }

  // Normalize color to hex format if needed
  let hexColor = color;
  if (!hexColor.startsWith('#')) {
    // Try to convert common color names to hex
    const colorMap = {
      red: '#FF0000',
      green: '#00FF00',
      blue: '#0000FF',
      yellow: '#FFFF00',
      purple: '#800080',
      pink: '#FFC0CB',
      orange: '#FFA500',
      white: '#FFFFFF',
      cyan: '#00FFFF',
      magenta: '#FF00FF'
    };
    hexColor = colorMap[color.toLowerCase()] || '#FFFFFF';
  }

  await makeRequest(`/api/lights/${device.id}/color`, 'POST', { color: hexColor });

  return {
    success: true,
    device: device.name,
    color: hexColor
  };
}

export async function applyScene(sceneName) {
  console.log(`[Lights] Applying scene: ${sceneName}`);

  const validScenes = ['relax', 'energize', 'party', 'movie', 'sleep'];
  const normalizedScene = sceneName.toLowerCase();

  if (!validScenes.includes(normalizedScene)) {
    throw new Error(`Unknown scene "${sceneName}". Available scenes: ${validScenes.join(', ')}`);
  }

  const result = await makeRequest('/api/lights/scene', 'POST', {
    scene: normalizedScene
  });

  return {
    success: true,
    scene: normalizedScene,
    devicesAffected: result.devicesUpdated,
    total: result.total
  };
}

// ============================================================================
// Tool Definitions for Function Calling
// ============================================================================

export const LIGHTS_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_smart_lights',
      description: 'Get a list of all available smart LED lights (Govee and Nanoleaf devices).',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'turn_on_light',
      description: 'Turn on a specific smart light by name.',
      parameters: {
        type: 'object',
        properties: {
          device_name: {
            type: 'string',
            description: 'Name or partial name of the light device (e.g., "bedroom", "strip", "govee")'
          }
        },
        required: ['device_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'turn_off_light',
      description: 'Turn off a specific smart light by name.',
      parameters: {
        type: 'object',
        properties: {
          device_name: {
            type: 'string',
            description: 'Name or partial name of the light device'
          }
        },
        required: ['device_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'turn_on_all_lights',
      description: 'Turn on all smart lights at once.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'turn_off_all_lights',
      description: 'Turn off all smart lights at once.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_light_brightness',
      description: 'Set the brightness level of a smart light (0-100%).',
      parameters: {
        type: 'object',
        properties: {
          device_name: {
            type: 'string',
            description: 'Name or partial name of the light device'
          },
          brightness: {
            type: 'number',
            description: 'Brightness level from 0 (off) to 100 (maximum)',
            minimum: 0,
            maximum: 100
          }
        },
        required: ['device_name', 'brightness']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_light_color',
      description: 'Change the color of a smart light. Accepts hex codes (#FF0000) or common color names (red, blue, etc.).',
      parameters: {
        type: 'object',
        properties: {
          device_name: {
            type: 'string',
            description: 'Name or partial name of the light device'
          },
          color: {
            type: 'string',
            description: 'Color as hex code (#FF0000) or name (red, blue, green, yellow, purple, pink, orange, white, cyan, magenta)'
          }
        },
        required: ['device_name', 'color']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_light_scene',
      description: 'Apply a preset lighting scene to all lights. Scenes include mood and activity-based configurations.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Scene name: "relax" (warm, cozy), "energize" (bright, cool), "party" (vibrant colors), "movie" (dim, ambient), "sleep" (minimal light)',
            enum: ['relax', 'energize', 'party', 'movie', 'sleep']
          }
        },
        required: ['scene_name']
      }
    }
  }
];

/**
 * Execute a lights tool call
 */
export async function executeTool(toolName, args = {}) {
  console.log(`[Lights Tools] Executing: ${toolName}`, args);

  try {
    switch (toolName) {
      case 'get_smart_lights':
        return await getLights();
      case 'turn_on_light':
        return await turnOnLight(args.device_name);
      case 'turn_off_light':
        return await turnOffLight(args.device_name);
      case 'turn_on_all_lights':
        return await turnOnAllLights();
      case 'turn_off_all_lights':
        return await turnOffAllLights();
      case 'set_light_brightness':
        return await setBrightness(args.device_name, args.brightness);
      case 'set_light_color':
        return await setLightColor(args.device_name, args.color);
      case 'apply_light_scene':
        return await applyScene(args.scene_name);
      default:
        throw new Error(`Unknown lights tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[Lights Tools] Execution failed: ${error.message}`);
    return { error: error.message };
  }
}
