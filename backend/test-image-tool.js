import { executeImageTool } from './src/tools/imageGeneration.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('Testing image generation tool...\n');

// Test 1: Check ComfyUI health
console.log('Test 1: Checking ComfyUI status...');
const health = await executeImageTool('check_image_generator_status');
console.log('Result:', JSON.stringify(health, null, 2), '\n');

if (health.status === 'online') {
  // Test 2: List models
  console.log('Test 2: Listing available models...');
  const models = await executeImageTool('list_image_models');
  console.log('Result:', JSON.stringify(models, null, 2), '\n');

  // Test 3: Generate a simple image
  console.log('Test 3: Generating a test image...');
  const result = await executeImageTool('generate_image', {
    prompt: 'anime girl with blue hair, high quality'
  });
  console.log('Result:', JSON.stringify(result, null, 2));
} else {
  console.log('ComfyUI is not running. Start ComfyUI first!');
}
