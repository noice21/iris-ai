export * from './mediaDashboard.js';
export * from './imageGeneration.js';
export * from './osControl.js';
export * from './lights.js';
import { MEDIA_DASHBOARD_TOOLS, executeTool as executeMediaTool } from './mediaDashboard.js';
import { IMAGE_GENERATION_TOOLS, executeImageTool } from './imageGeneration.js';
import { OS_CONTROL_TOOLS, executeOSTool } from './osControl.js';
import { LIGHTS_TOOLS, executeTool as executeLightsTool } from './lights.js';

// Combine all available tools
export const ALL_TOOLS = [
  ...MEDIA_DASHBOARD_TOOLS,
  ...IMAGE_GENERATION_TOOLS,
  ...OS_CONTROL_TOOLS,
  ...LIGHTS_TOOLS
];

/**
 * Execute any tool by name
 */
export async function executeTool(toolName, args = {}) {
  // Media dashboard tools
  if (MEDIA_DASHBOARD_TOOLS.some(t => t.function.name === toolName)) {
    return await executeMediaTool(toolName, args);
  }

  // Image generation tools
  if (IMAGE_GENERATION_TOOLS.some(t => t.function.name === toolName)) {
    return await executeImageTool(toolName, args);
  }

  // OS control tools
  if (OS_CONTROL_TOOLS.some(t => t.function.name === toolName)) {
    return await executeOSTool(toolName, args);
  }

  // Lights control tools
  if (LIGHTS_TOOLS.some(t => t.function.name === toolName)) {
    return await executeLightsTool(toolName, args);
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

/**
 * Format tool result for LLM context
 */
export function formatToolResult(toolName, result) {
  if (result.error) {
    return `Tool "${toolName}" failed: ${result.error}`;
  }
  return JSON.stringify(result, null, 2);
}
