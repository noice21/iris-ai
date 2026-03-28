export * from './mediaDashboard.js';
export * from './imageGeneration.js';
export * from './osControl.js';
export * from './lights.js';
export * from './csvDatabase.js';
export * from './webSearch.js';
export * from './knowledgeGraph.js';
export * from './filesystem.js';
export * from './docker.js';
import { MEDIA_DASHBOARD_TOOLS, executeTool as executeMediaTool } from './mediaDashboard.js';
import { IMAGE_GENERATION_TOOLS, executeImageTool } from './imageGeneration.js';
import { OS_CONTROL_TOOLS, executeOSTool } from './osControl.js';
import { LIGHTS_TOOLS, executeTool as executeLightsTool } from './lights.js';
import { CSV_DATABASE_TOOLS, executeCsvDatabaseTool } from './csvDatabase.js';
import { WEB_SEARCH_TOOLS, executeWebSearchTool } from './webSearch.js';
import { KNOWLEDGE_GRAPH_TOOLS, executeKnowledgeGraphTool } from './knowledgeGraph.js';
import { FILESYSTEM_TOOLS, executeFilesystemTool } from './filesystem.js';
import { DOCKER_TOOLS, executeDockerTool } from './docker.js';

// Combine all available tools
export const ALL_TOOLS = [
  ...MEDIA_DASHBOARD_TOOLS,
  ...IMAGE_GENERATION_TOOLS,
  ...OS_CONTROL_TOOLS,
  ...LIGHTS_TOOLS,
  ...CSV_DATABASE_TOOLS,
  ...WEB_SEARCH_TOOLS,
  ...KNOWLEDGE_GRAPH_TOOLS,
  ...FILESYSTEM_TOOLS,   // Empty array when CLOUD_MODE=true
  ...DOCKER_TOOLS         // Empty array when CLOUD_MODE=true
];

/**
 * Execute any tool by name
 * @param {string} toolName - Tool name
 * @param {Object} args - Tool arguments
 * @param {Object} context - Execution context (e.g., { userId })
 */
export async function executeTool(toolName, args = {}, context = {}) {
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

  // CSV database tools
  if (CSV_DATABASE_TOOLS.some(t => t.function.name === toolName)) {
    return await executeCsvDatabaseTool(toolName, args);
  }

  // Web search tools
  if (WEB_SEARCH_TOOLS.some(t => t.function.name === toolName)) {
    return await executeWebSearchTool(toolName, args);
  }

  // Knowledge graph tools (needs userId context)
  if (KNOWLEDGE_GRAPH_TOOLS.some(t => t.function.name === toolName)) {
    return await executeKnowledgeGraphTool(toolName, args, context);
  }

  // Filesystem tools (local mode only)
  if (FILESYSTEM_TOOLS.some(t => t.function.name === toolName)) {
    return await executeFilesystemTool(toolName, args);
  }

  // Docker tools (local mode only)
  if (DOCKER_TOOLS.some(t => t.function.name === toolName)) {
    return await executeDockerTool(toolName, args);
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
