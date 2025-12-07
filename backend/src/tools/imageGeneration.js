import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ComfyUI API configuration
let currentModel = null; // Runtime model selection

function getConfig() {
  return {
    url: process.env.COMFYUI_URL || 'http://127.0.0.1:8188',
    outputDir: process.env.IMAGE_OUTPUT_DIR || path.join(__dirname, '../../output/images'),
    defaultModel: currentModel || process.env.COMFYUI_DEFAULT_MODEL || 'animagineXLV31_v31.safetensors'
  };
}

// Default workflow for text-to-image generation
// Optimized for AMD GPUs (DirectML) - lower defaults for faster generation
const DEFAULT_WORKFLOW = {
  "3": {
    "inputs": {
      "seed": 0,
      "steps": 15,
      "cfg": 7,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1,
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    },
    "class_type": "KSampler"
  },
  "4": {
    "inputs": {
      "ckpt_name": ""  // Will be set dynamically
    },
    "class_type": "CheckpointLoaderSimple"
  },
  "5": {
    "inputs": {
      "width": 832,
      "height": 832,
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage"
  },
  "6": {
    "inputs": {
      "text": "",
      "clip": ["4", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "7": {
    "inputs": {
      "text": "blurry, bad quality, worst quality, low quality, watermark, text, signature",
      "clip": ["4", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "8": {
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    },
    "class_type": "VAEDecode"
  },
  "9": {
    "inputs": {
      "filename_prefix": "iris_generated",
      "images": ["8", 0]
    },
    "class_type": "SaveImage"
  }
};

/**
 * Check if ComfyUI server is running
 */
export async function checkComfyUIHealth() {
  const config = getConfig();
  try {
    const response = await fetch(`${config.url}/system_stats`);
    if (response.ok) {
      const stats = await response.json();
      return {
        status: 'online',
        ...stats
      };
    }
    return { status: 'offline', error: 'Server not responding' };
  } catch (error) {
    return { status: 'offline', error: error.message };
  }
}

/**
 * Queue a prompt for image generation
 */
async function queuePrompt(workflow) {
  const config = getConfig();
  const response = await fetch(`${config.url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to queue prompt: ${error}`);
  }

  return await response.json();
}

/**
 * Get the history/output for a prompt
 */
async function getHistory(promptId) {
  const config = getConfig();
  const response = await fetch(`${config.url}/history/${promptId}`);
  if (!response.ok) {
    throw new Error('Failed to get history');
  }
  return await response.json();
}

/**
 * Estimate generation time based on parameters
 * Returns estimated time in milliseconds
 */
function estimateGenerationTime(width, height, steps) {
  // Base time: ~2 seconds per step on average hardware
  // Resolution multiplier: larger images take longer
  const pixelCount = width * height;
  const basePixels = 832 * 832; // Default resolution
  const resolutionMultiplier = pixelCount / basePixels;

  // Time estimation (rough approximation)
  const baseTimePerStep = 2000; // 2 seconds per step
  const estimatedMs = steps * baseTimePerStep * resolutionMultiplier;

  return Math.max(estimatedMs, 60000); // Minimum 1 minute
}

/**
 * Wait for image generation to complete with dynamic timeout
 * Adjusts timeout based on resolution and steps
 */
async function waitForCompletion(promptId, estimatedTime = 300000) {
  const startTime = Date.now();
  let lastLogTime = Date.now();

  // Dynamic timeout: use estimated time + 50% buffer, minimum 2 minutes, max 15 minutes
  const minTimeout = 120000; // 2 minutes
  const maxTimeout = 900000; // 15 minutes
  const maxWaitMs = Math.min(Math.max(estimatedTime * 1.5, minTimeout), maxTimeout);

  console.log(`[ImageGen] Timeout set to ${Math.floor(maxWaitMs / 1000)}s (estimated: ${Math.floor(estimatedTime / 1000)}s)`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const history = await getHistory(promptId);
      if (history[promptId]) {
        const outputs = history[promptId].outputs;
        if (outputs && Object.keys(outputs).length > 0) {
          return outputs;
        }

        // Check for errors in the prompt execution
        const status = history[promptId].status;
        if (status?.status_str === 'error') {
          const errorMessage = status?.messages?.[0]?.[1] || 'Unknown error';
          throw new Error(`ComfyUI generation failed: ${errorMessage}`);
        }
      }
    } catch (e) {
      // Check if it's a real error or just still processing
      if (e.message.includes('ComfyUI generation failed') ||
          e.message.includes('Could not allocate tensor') ||
          e.message.includes('not enough GPU')) {
        throw e; // Re-throw actual errors
      }
      // Otherwise, still processing
    }

    // Log progress every 10 seconds
    const now = Date.now();
    if (now - lastLogTime > 10000) {
      const elapsed = Math.floor((now - startTime) / 1000);
      const remaining = Math.floor((maxWaitMs - (now - startTime)) / 1000);
      console.log(`[ImageGen] Still generating... (${elapsed}s elapsed, ~${remaining}s remaining)`);
      lastLogTime = now;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error(`Image generation timed out after ${Math.floor(maxWaitMs / 1000)}s`);
}

/**
 * Get generated image from ComfyUI
 */
async function getImage(filename, subfolder, folderType) {
  const config = getConfig();
  const params = new URLSearchParams({ filename, subfolder, type: folderType });
  const response = await fetch(`${config.url}/view?${params}`);

  if (!response.ok) {
    throw new Error('Failed to retrieve image');
  }

  return await response.buffer();
}

/**
 * Generate an image using Stable Diffusion via ComfyUI
 * @param {string} prompt - Text description of the image to generate
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} - Generation result with image path
 */
export async function generateImage(prompt, options = {}) {
  const config = getConfig();
  console.log(`[ImageGen] Generating image for prompt: "${prompt}"`);

  // Check if ComfyUI is running
  const health = await checkComfyUIHealth();
  if (health.status !== 'online') {
    return {
      success: false,
      error: 'ComfyUI server is not running. Please start ComfyUI first.',
      instructions: 'Run: python main.py --listen in your ComfyUI directory'
    };
  }

  // Create workflow with user's prompt
  const workflow = JSON.parse(JSON.stringify(DEFAULT_WORKFLOW));

  // Set the positive prompt
  workflow["6"].inputs.text = prompt;

  // Set model (use option > current default > env default)
  workflow["4"].inputs.ckpt_name = options.model || config.defaultModel;

  // Apply options
  if (options.negative_prompt) {
    workflow["7"].inputs.text = options.negative_prompt;
  }
  if (options.width) {
    workflow["5"].inputs.width = Math.min(Math.max(options.width, 512), 1536);
  }
  if (options.height) {
    workflow["5"].inputs.height = Math.min(Math.max(options.height, 512), 1536);
  }
  if (options.steps) {
    workflow["3"].inputs.steps = Math.min(Math.max(options.steps, 10), 50);
  }
  if (options.cfg_scale) {
    workflow["3"].inputs.cfg = Math.min(Math.max(options.cfg_scale, 1), 20);
  }
  if (options.seed !== undefined && options.seed >= 0) {
    workflow["3"].inputs.seed = options.seed;
  } else {
    workflow["3"].inputs.seed = Math.floor(Math.random() * 2147483647);
  }

  try {
    // Calculate estimated generation time
    const finalWidth = workflow["5"].inputs.width;
    const finalHeight = workflow["5"].inputs.height;
    const finalSteps = workflow["3"].inputs.steps;
    const estimatedTime = estimateGenerationTime(finalWidth, finalHeight, finalSteps);

    console.log(`[ImageGen] Estimated generation time: ${Math.floor(estimatedTime / 1000)}s for ${finalWidth}x${finalHeight} @ ${finalSteps} steps`);

    // Queue the generation
    console.log('[ImageGen] Queuing prompt...');
    const { prompt_id } = await queuePrompt(workflow);
    console.log(`[ImageGen] Prompt queued with ID: ${prompt_id}`);

    // Wait for completion with dynamic timeout
    console.log('[ImageGen] Waiting for generation...');
    const outputs = await waitForCompletion(prompt_id, estimatedTime);

    // Get the output image info
    const saveImageNode = Object.values(outputs).find(o => o.images);
    if (!saveImageNode || !saveImageNode.images.length) {
      throw new Error('No images generated');
    }

    const imageInfo = saveImageNode.images[0];
    console.log(`[ImageGen] Image generated: ${imageInfo.filename}`);

    // Get the image data
    const imageBuffer = await getImage(
      imageInfo.filename,
      imageInfo.subfolder || '',
      imageInfo.type || 'output'
    );

    // Save locally
    const outputDir = config.outputDir;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = Date.now();
    const localFilename = `iris_${timestamp}_${imageInfo.filename}`;
    const localPath = path.join(outputDir, localFilename);
    fs.writeFileSync(localPath, imageBuffer);

    console.log(`[ImageGen] Image saved to: ${localPath}`);

    // Convert image to base64 for sending to client
    const base64Image = imageBuffer.toString('base64');
    const imageSize = imageBuffer.length;

    return {
      success: true,
      prompt: prompt,
      seed: workflow["3"].inputs.seed,
      filename: localFilename,
      path: localPath,
      comfyui_filename: imageInfo.filename,
      size: {
        width: workflow["5"].inputs.width,
        height: workflow["5"].inputs.height
      },
      base64: base64Image, // Image data for client
      imageSize: imageSize // Size in bytes
    };

  } catch (error) {
    console.error(`[ImageGen] Generation failed: ${error.message}`);

    // Check if it's a GPU memory error
    const isMemoryError = error.message.includes('Could not allocate tensor') ||
                          error.message.includes('not enough GPU') ||
                          error.message.includes('out of memory') ||
                          error.message.includes('CUDA out of memory');

    if (isMemoryError) {
      // Attempt to recover by reducing resolution
      const currentWidth = workflow["5"].inputs.width;
      const currentHeight = workflow["5"].inputs.height;

      // Try lower resolution (reduce by ~30%)
      const reducedWidth = Math.floor(currentWidth * 0.7);
      const reducedHeight = Math.floor(currentHeight * 0.7);

      console.log(`[ImageGen] GPU memory error detected. Attempting retry with reduced resolution: ${reducedWidth}x${reducedHeight}`);

      return {
        success: false,
        error: `Not enough GPU memory for ${currentWidth}x${currentHeight}. Try a smaller resolution like ${reducedWidth}x${reducedHeight}, or reduce the number of steps.`,
        suggestion: {
          width: reducedWidth,
          height: reducedHeight,
          steps: Math.max(10, workflow["3"].inputs.steps - 5)
        },
        prompt: prompt
      };
    }

    return {
      success: false,
      error: error.message,
      prompt: prompt
    };
  }
}

/**
 * Get list of available models/checkpoints
 */
export async function getAvailableModels() {
  const config = getConfig();
  try {
    const response = await fetch(`${config.url}/object_info/CheckpointLoaderSimple`);
    if (response.ok) {
      const data = await response.json();
      const models = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
      return {
        success: true,
        models,
        currentModel: config.defaultModel
      };
    }
    return { success: false, models: [], error: 'Could not fetch models' };
  } catch (error) {
    return { success: false, models: [], error: error.message };
  }
}

/**
 * Set the default image generation model
 */
export function setDefaultModel(modelName) {
  currentModel = modelName;
  console.log(`[ImageGen] Default model changed to: ${modelName}`);
  return {
    success: true,
    currentModel: modelName,
    message: `Image generation model changed to ${modelName}`
  };
}

// Tool definitions for OpenRouter function calling
export const IMAGE_GENERATION_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate an image using Stable Diffusion based on a text description. Use this when the user asks for an image, artwork, concept design, illustration, or any visual content to be created.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate. Be specific about style, subjects, colors, lighting, etc.'
          },
          negative_prompt: {
            type: 'string',
            description: 'Things to avoid in the image (default: blurry, bad quality, watermark)'
          },
          width: {
            type: 'number',
            description: 'Image width in pixels (512-1536, default: 832 for speed)'
          },
          height: {
            type: 'number',
            description: 'Image height in pixels (512-1536, default: 832 for speed)'
          },
          steps: {
            type: 'number',
            description: 'Number of generation steps (10-50, default: 15). More steps = better quality but slower.'
          },
          model: {
            type: 'string',
            description: 'Model/checkpoint to use (e.g., "animagineXLV31_v31.safetensors"). If not specified, uses default.'
          }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_image_generator_status',
      description: 'Check if the Stable Diffusion image generator (ComfyUI) is running and available.',
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
      name: 'list_image_models',
      description: 'List available Stable Diffusion models/checkpoints for image generation and show the current default model.',
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
      name: 'set_image_model',
      description: 'Change the default Stable Diffusion model/checkpoint used for image generation. Use this when the user asks to change, switch, or use a different model.',
      parameters: {
        type: 'object',
        properties: {
          model_name: {
            type: 'string',
            description: 'The exact filename of the model to use (e.g., "animagineXLV31_v31.safetensors"). Must match a model from list_image_models.'
          }
        },
        required: ['model_name']
      }
    }
  }
];

/**
 * Execute an image generation tool
 */
export async function executeImageTool(toolName, args = {}) {
  console.log(`[ImageGen] Executing tool: ${toolName}`, args);

  try {
    switch (toolName) {
      case 'generate_image':
        return await generateImage(args.prompt, {
          negative_prompt: args.negative_prompt,
          width: args.width,
          height: args.height,
          steps: args.steps,
          model: args.model
        });

      case 'check_image_generator_status':
        return await checkComfyUIHealth();

      case 'list_image_models':
        return await getAvailableModels();

      case 'set_image_model':
        return setDefaultModel(args.model_name);

      default:
        throw new Error(`Unknown image tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[ImageGen] Tool execution failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
