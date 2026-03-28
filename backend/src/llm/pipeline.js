import fetch from 'node-fetch';
import {
  getOrCreateUser,
  getActiveConversation,
  saveMessage,
  buildMemoryContext,
  getUserFacts,
  saveUserFact
} from '../database/memory.js';
import { ALL_TOOLS, executeTool, formatToolResult } from '../tools/index.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// Read env vars lazily (they may not be loaded yet at module init time)
function getOllamaApiUrl() {
  return process.env.OLLAMA_URL || 'http://localhost:11434';
}

function getToolsEnabled() {
  return process.env.ENABLE_TOOLS !== 'false';
}

function getLlmProvider() {
  return (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
}

// Log provider on first use
let _providerLogged = false;
function logProvider() {
  if (!_providerLogged) {
    console.log(`[LLM] Using provider: ${getLlmProvider()}`);
    _providerLogged = true;
  }
}

/**
 * Build Ollama request headers (with optional auth for cloud)
 */
function getOllamaHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OLLAMA_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }
  return headers;
}

/**
 * Get API key for the current LLM provider
 * @returns {string} - API key
 */
function getApiKey() {
  if (getLlmProvider() === 'ollama') {
    // Ollama uses its own auth via getOllamaHeaders(), no API key needed here
    return '';
  }
  if (getLlmProvider() === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    return apiKey;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }
  return apiKey;
}

/**
 * Get default model from environment
 * @returns {string} - Model ID
 */
function getDefaultModel() {
  if (getLlmProvider() === 'ollama') {
    return process.env.OLLAMA_MODEL || 'llama3.1:8b';
  }
  if (getLlmProvider() === 'gemini') {
    return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  }
  return process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';
}

/**
 * Get system prompt for the AI avatar
 * @param {string} memoryContext - User memory context
 * @returns {string} - System prompt
 */
function getSystemPrompt(memoryContext = '') {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });

  const basePrompt = process.env.AI_SYSTEM_PROMPT || `You are Iris, a helpful and friendly AI assistant with memory.
You remember past conversations and facts about users.
You engage in natural conversation, providing helpful, accurate, and concise responses.
Keep your responses conversational and appropriate for spoken dialogue.
NEVER use markdown formatting in your responses. No hashtags (#), asterisks (*), dashes (-) as bullets, numbered lists, backticks, or any other markup. Your responses are read aloud by a text-to-speech engine, so any formatting characters will be spoken literally.
Speak naturally as if having a face-to-face conversation. When presenting data or lists, describe them in flowing sentences instead of using formatted lists.
The current date and time is ${dateStr}, ${timeStr}.

When the user tells you something important about themselves (like their name, preferences, job, interests),
acknowledge it naturally and remember it for future conversations.`;

  const toolsPrompt = getToolsEnabled() ? `

You have access to tools that allow you to:
1. Query the media server dashboard for real-time information about Docker containers (stats, health, logs)
2. Generate images using Stable Diffusion:
   - Use generate_image when the user asks for images, artwork, illustrations, concept art, or visual content
   - Image generation runs in the BACKGROUND - you can continue chatting while it processes
   - Tell the user the image is being generated and you'll send it when ready
   - Use list_image_models to show available models and the current default
   - Use set_image_model when the user wants to change or switch to a different model
3. Control the computer's operating system:
   - List running programs with list_running_processes
   - Check if a program is running with check_process_running
   - Stop a program with kill_process
   - Start a program with start_program
   - Restart a program with restart_program
4. Control smart LED lights (Govee and Nanoleaf devices):
   - List all available lights with get_smart_lights
   - Turn individual lights on/off with turn_on_light and turn_off_light
   - Turn all lights on/off with turn_on_all_lights and turn_off_all_lights
   - Set brightness levels (0-100%) with set_light_brightness
   - Change light colors (hex codes or color names) with set_light_color
   - Apply preset scenes (relax, energize, party, movie, sleep) with apply_light_scene
5. Query databases (read-only, supports multiple databases):
   - List all available databases with list_csv_databases
   - List tables in a specific database with list_csv_tables (requires database_name)
   - Get table structure and sample data with describe_csv_table (requires database_name, table_name)
   - Query specific rows with filtering, sorting, and pagination using query_csv_table (requires database_name, table_name)
   - Search for text across all columns of a table with search_csv_table (requires database_name, table_name, search_text)
6. Search the web and visit webpages:
   - Search the web with search_web for up-to-date information (runs invisibly in background)
   - Visit a specific webpage to read its content with visit_webpage
7. Manage your knowledge graph (long-term memory for people, places, concepts):
   - Create entities with create_entity (people, places, concepts, projects, organizations)
   - Link entities with create_relation (e.g., "John works_at Acme Corp")
   - Add observations to entities with add_observation
   - Search your knowledge with search_knowledge
   - Get full entity details with get_entity
   - Remove entities with delete_entity
8. File system operations (local mode only):
   - List directory contents with list_directory
   - Read text files with read_file
   - Write or create files with write_file
   - Search for files by name with search_files
   - Get file metadata with get_file_info
   - Move or rename files with move_file
9. Docker container management (local mode only):
   - List containers with docker_list_containers
   - View container stats with docker_container_stats
   - Start/stop/restart containers with docker_start_container, docker_stop_container, docker_restart_container
   - View container logs with docker_container_logs
   - List images with docker_list_images
   - Check docker compose status with docker_compose_status

When the user asks about container stats, server health, or media services, use the appropriate media dashboard tool.
When the user asks to create, generate, or draw images, artwork, or visual content, use the generate_image tool. Tell them you're generating it in the background and you can keep chatting.
When the user asks to change, switch, or use a different image model, first list models if needed, then use set_image_model.
When the user asks about running programs, to start/stop/restart programs, use the OS control tools.
When the user asks about lights, to control lights, change colors, set brightness, or apply lighting scenes, use the smart lights tools.
When the user asks about game data, CSV data, tables, or database content, use the database tools. First list databases with list_csv_databases, then list tables in the relevant database, then query or search as needed.
When you need up-to-date information or facts you don't know, use search_web to find the answer invisibly.
When the user asks you to visit or read a specific webpage, use visit_webpage.
When the user tells you about people, places, organizations, or wants you to remember relationships, use the knowledge graph tools to create entities and relations.
When the user asks to read, write, or manage files on the computer, use the filesystem tools.
When the user asks about Docker containers directly (not media server), use the docker tools.
After receiving tool results, summarize the information naturally in your response.` : '';

  if (memoryContext) {
    return `${basePrompt}${toolsPrompt}\n\n${memoryContext}`;
  }

  return `${basePrompt}${toolsPrompt}`;
}

/**
 * Generate a response using OpenRouter LLM with database memory
 * @param {string} message - User message
 * @param {string} deviceId - Device identifier for user lookup
 * @param {string} conversationId - Conversation ID (optional)
 * @returns {Promise<{text: string, conversationId: string, userId: string}>}
 */
export async function generateResponse(message, deviceId = 'default', conversationId = null) {
  logProvider();
  const apiKey = getApiKey();
  const model = getDefaultModel();

  // Get or create user
  const user = await getOrCreateUser(deviceId);

  // Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = { id: conversationId };
  } else {
    conversation = await getActiveConversation(user.id);
  }

  // Build memory context
  const { context, history } = await buildMemoryContext(user.id, conversation.id);

  // Save user message
  await saveMessage(conversation.id, 'user', message);

  // Build messages array
  const messages = [
    { role: 'system', content: getSystemPrompt(context) },
    ...history,
    { role: 'user', content: message }
  ];

  // Build request based on provider
  let apiUrl, headers, reqBody;
  if (getLlmProvider() === 'ollama') {
    apiUrl = `${getOllamaApiUrl()}/chat`;
    headers = getOllamaHeaders();
    reqBody = { model, messages, stream: false };
    if (getToolsEnabled() && ALL_TOOLS.length > 0) {
      reqBody.tools = ALL_TOOLS;
    }
  } else if (getLlmProvider() === 'gemini') {
    apiUrl = GEMINI_API_URL;
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    reqBody = { model, messages, max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '500'), temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7') };
  } else {
    apiUrl = OPENROUTER_API_URL;
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': process.env.APP_NAME || 'Iris AI Avatar'
    };
    reqBody = { model, messages, max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '500'), temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7') };
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${getLlmProvider()} API failed: ${response.status} - ${error}`);
  }

  let data = await response.json();

  // Check for tool calls (Ollama native or OpenAI-compatible)
  let toolCalls = getLlmProvider() === 'ollama'
    ? (data.message?.tool_calls || [])
    : (data.choices?.[0]?.message?.tool_calls || []);

  // Tool call loop - execute tools and get final response (max 3 rounds)
  let rounds = 0;
  while (toolCalls.length > 0 && rounds < 3) {
    rounds++;
    console.log(`[LLM] Non-streaming: processing ${toolCalls.length} tool calls (round ${rounds})...`);

    // Execute each tool
    const toolResultMessages = [];
    for (const tc of toolCalls) {
      const toolName = tc.function?.name;
      if (!toolName) continue;

      let toolArgs = {};
      try {
        toolArgs = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments || '{}')
          : (tc.function.arguments || {});
      } catch (e) {
        console.error(`[LLM] Failed to parse tool args: ${e.message}`);
      }

      console.log(`[LLM] Executing tool: ${toolName}`, toolArgs);
      try {
        const result = await executeTool(toolName, toolArgs, { userId: user.id });
        const resultStr = formatToolResult(toolName, result);
        toolResultMessages.push({ role: 'tool', content: resultStr });
      } catch (error) {
        toolResultMessages.push({ role: 'tool', content: `Tool "${toolName}" failed: ${error.message}` });
      }
    }

    // Add assistant tool_calls message and tool results, then re-request
    if (getLlmProvider() === 'ollama') {
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: toolCalls.map(tc => ({
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments || '{}')
              : (tc.function.arguments || {})
          }
        }))
      });
      for (const result of toolResultMessages) {
        messages.push(result);
      }

      reqBody = { model, messages, stream: false };
      if (getToolsEnabled() && ALL_TOOLS.length > 0) {
        reqBody.tools = ALL_TOOLS;
      }
    } else {
      messages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
      for (const result of toolResultMessages) {
        messages.push(result);
      }
      reqBody = { ...reqBody, messages };
    }

    const followUp = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody)
    });

    if (!followUp.ok) {
      const error = await followUp.text();
      throw new Error(`${getLlmProvider()} API follow-up failed: ${followUp.status} - ${error}`);
    }

    data = await followUp.json();
    toolCalls = getLlmProvider() === 'ollama'
      ? (data.message?.tool_calls || [])
      : (data.choices?.[0]?.message?.tool_calls || []);
  }

  // Extract final text response
  const assistantMessage = getLlmProvider() === 'ollama'
    ? (data.message?.content || '')
    : (data.choices?.[0]?.message?.content || '');

  // Save assistant response
  await saveMessage(conversation.id, 'assistant', assistantMessage);

  // Extract and save any facts mentioned (basic extraction)
  await extractAndSaveFacts(user.id, message);

  return {
    text: assistantMessage,
    conversationId: conversation.id,
    userId: user.id
  };
}

/**
 * Generate a streaming response using OpenRouter LLM with database memory
 * @param {string} message - User message
 * @param {string} deviceId - Device identifier
 * @param {string} conversationId - Conversation ID
 * @param {Function} onToken - Callback for each token
 * @param {Function} onComplete - Callback when complete
 */
export async function generateStreamingResponse(message, deviceId, conversationId, onToken, onComplete) {
  logProvider();
  const apiKey = getApiKey();
  const model = getDefaultModel();

  console.log(`[LLM] Generating response for: "${message}" (model: ${model})`);

  // Get or create user
  const user = await getOrCreateUser(deviceId);

  // Get conversation
  let conversation;
  if (conversationId) {
    conversation = { id: conversationId };
  } else {
    conversation = await getActiveConversation(user.id);
  }

  // Build memory context
  const { context, history } = await buildMemoryContext(user.id, conversation.id);

  // Save user message
  await saveMessage(conversation.id, 'user', message);

  const messages = [
    { role: 'system', content: getSystemPrompt(context) },
    ...history,
    { role: 'user', content: message }
  ];

  // Choose API endpoint, headers, and request format based on provider
  let apiUrl, headers, requestBody;

  if (getLlmProvider() === 'ollama') {
    // Ollama native API (works for both local and cloud)
    apiUrl = `${getOllamaApiUrl()}/chat`;
    headers = getOllamaHeaders();

    requestBody = {
      model,
      messages,
      stream: true
    };

    // Add tools if enabled (Ollama uses OpenAI-style tool format)
    if (getToolsEnabled() && ALL_TOOLS.length > 0) {
      requestBody.tools = ALL_TOOLS;
    }
  } else if (getLlmProvider() === 'gemini') {
    // Google Gemini API (OpenAI-compatible)
    apiUrl = GEMINI_API_URL;
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    requestBody = {
      model,
      messages,
      max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '500'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
      stream: true
    };

    // Add tools if enabled - Gemini handles tool_choice automatically
    if (getToolsEnabled() && ALL_TOOLS.length > 0) {
      requestBody.tools = ALL_TOOLS;
    }
  } else {
    // OpenRouter API (OpenAI-compatible)
    apiUrl = OPENROUTER_API_URL;
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': process.env.APP_NAME || 'Iris AI Avatar'
    };

    requestBody = {
      model,
      messages,
      max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '500'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
      stream: true
    };

    // Add tools if enabled
    if (getToolsEnabled() && ALL_TOOLS.length > 0) {
      requestBody.tools = ALL_TOOLS;
      // Don't set tool_choice for Gemini models as they handle it automatically
      if (!model.includes('gemini')) {
        requestBody.tool_choice = 'auto';
      }
    }
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[LLM] ${getLlmProvider()} error: ${response.status} - ${error}`);
    throw new Error(`${getLlmProvider()} streaming failed: ${response.status} - ${error}`);
  }

  console.log('[LLM] Streaming response started...');
  let fullResponse = '';
  let toolCalls = [];

  if (getLlmProvider() === 'ollama') {
    // Ollama native streaming - JSON lines format
    for await (const chunk of response.body) {
      const lines = chunk.toString().split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);

          // Extract text content (skip thinking field from qwen3.5)
          const token = parsed.message?.content || '';
          if (token) {
            fullResponse += token;
            onToken(token);
          }

          // Check for tool calls
          if (parsed.message?.tool_calls) {
            for (const tc of parsed.message.tool_calls) {
              toolCalls.push({
                id: `call_${Date.now()}_${toolCalls.length}`,
                type: 'function',
                function: {
                  name: tc.function.name,
                  arguments: JSON.stringify(tc.function.arguments || {})
                }
              });
              console.log(`[LLM] Tool call detected: ${tc.function.name}`);
            }
          }

          // Stream complete
          if (parsed.done) {
            if (toolCalls.length > 0) {
              console.log(`[LLM] Processing ${toolCalls.length} tool calls (Ollama)...`);
              await processOllamaToolCalls(toolCalls, messages, user, conversation, onToken, onComplete);
              return;
            }

            console.log(`[LLM] Response complete: "${fullResponse.substring(0, 100)}..."`);
            await saveMessage(conversation.id, 'assistant', fullResponse);
            await extractAndSaveFacts(user.id, message);
            onComplete(fullResponse, conversation.id, user.id);
            return;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Handle case where stream ends without done:true
    if (toolCalls.length > 0) {
      await processOllamaToolCalls(toolCalls, messages, user, conversation, onToken, onComplete);
      return;
    }

    await saveMessage(conversation.id, 'assistant', fullResponse);
    await extractAndSaveFacts(user.id, message);
    onComplete(fullResponse, conversation.id, user.id);
    return;
  } else {
    // OpenAI-compatible streaming format (OpenRouter & Gemini) - SSE with data: prefix
    for await (const chunk of response.body) {
      const lines = chunk.toString().split('\n').filter(line => line.trim());

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            // Check if we have tool calls to process
            if (toolCalls.length > 0) {
              console.log(`[LLM] Processing ${toolCalls.length} tool calls...`);
              await processToolCalls(toolCalls, messages, user, conversation, onToken, onComplete);
              return;
            }

            // Save complete response
            console.log(`[LLM] Response complete: "${fullResponse.substring(0, 100)}..."`);
            await saveMessage(conversation.id, 'assistant', fullResponse);
            await extractAndSaveFacts(user.id, message);

            onComplete(fullResponse, conversation.id, user.id);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            // Handle regular content
            const token = delta?.content || '';
            if (token) {
              fullResponse += token;
              onToken(token);
            }

            // Handle tool calls
            if (delta?.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                if (toolCallDelta.index !== undefined) {
                  // Initialize or get existing tool call
                  if (!toolCalls[toolCallDelta.index]) {
                    toolCalls[toolCallDelta.index] = {
                      id: toolCallDelta.id || '',
                      type: 'function',
                      function: { name: '', arguments: '' }
                    };
                  }
                  const currentToolCall = toolCalls[toolCallDelta.index];

                  if (toolCallDelta.id) {
                    currentToolCall.id = toolCallDelta.id;
                  }
                  if (toolCallDelta.function?.name) {
                    currentToolCall.function.name = toolCallDelta.function.name;
                  }
                  if (toolCallDelta.function?.arguments) {
                    currentToolCall.function.arguments += toolCallDelta.function.arguments;
                  }
                }
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  // Handle case where stream ends without [DONE]
  if (toolCalls.length > 0) {
    await processToolCalls(toolCalls, messages, user, conversation, onToken, onComplete);
    return;
  }

  await saveMessage(conversation.id, 'assistant', fullResponse);
  await extractAndSaveFacts(user.id, message);

  onComplete(fullResponse, conversation.id, user.id);
}

/**
 * Process tool calls and generate final response
 */
async function processToolCalls(toolCalls, messages, user, conversation, onToken, onComplete) {
  const apiKey = getApiKey();
  const model = getDefaultModel();

  // Execute each tool call
  const toolResults = [];
  const backgroundTasks = []; // Track background tasks

  for (const toolCall of toolCalls) {
    if (!toolCall.function?.name) continue;

    console.log(`[LLM] Executing tool: ${toolCall.function.name}`);

    // Notify client that we're using a tool
    onToken({ type: 'tool_use', tool: toolCall.function.name });

    let args = {};
    try {
      args = JSON.parse(toolCall.function.arguments || '{}');
    } catch (e) {
      console.error(`[LLM] Failed to parse tool arguments: ${e.message}`);
    }

    // Check if this is a background-capable tool (image generation, long-running tasks)
    const isBackgroundTask = toolCall.function.name === 'generate_image';

    if (isBackgroundTask) {
      // Run in background - provide immediate placeholder response
      console.log(`[LLM] Running ${toolCall.function.name} in background...`);

      // Notify user that task is running in background
      onToken({
        type: 'tool_background',
        tool: toolCall.function.name,
        message: 'Generating image in the background, I can keep chatting while it processes...'
      });

      // Add placeholder result for LLM to continue
      toolResults.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        content: `Image generation started in background with prompt: "${args.prompt}". The image will be sent when ready.`
      });

      // Execute in background
      const backgroundTask = executeTool(toolCall.function.name, args, { userId: user.id })
        .then(result => {
          console.log(`[LLM] Background task ${toolCall.function.name} completed`);

          // Send image to client when ready
          if (toolCall.function.name === 'generate_image' && result.success && result.base64) {
            console.log(`[LLM] Sending generated image to client (${result.imageSize} bytes)`);
            onToken({
              type: 'image_generated',
              image: {
                base64: result.base64,
                prompt: result.prompt,
                filename: result.filename,
                size: result.size,
                seed: result.seed
              }
            });
          } else if (!result.success) {
            // Notify client of failure
            onToken({
              type: 'tool_error',
              tool: toolCall.function.name,
              error: result.error || 'Task failed'
            });
          }
        })
        .catch(err => {
          console.error(`[LLM] Background task ${toolCall.function.name} failed:`, err.message);
          onToken({
            type: 'tool_error',
            tool: toolCall.function.name,
            error: err.message
          });
        });

      backgroundTasks.push(backgroundTask);

    } else {
      // Execute synchronously (blocking) for quick tools
      const result = await executeTool(toolCall.function.name, args, { userId: user.id });
      const formattedResult = formatToolResult(toolCall.function.name, result);

      toolResults.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        content: formattedResult
      });

      console.log(`[LLM] Tool ${toolCall.function.name} result: ${formattedResult.substring(0, 200)}...`);
    }
  }

  // Add assistant message with tool calls and tool results to messages
  const updatedMessages = [
    ...messages,
    {
      role: 'assistant',
      content: null,
      tool_calls: toolCalls
    },
    ...toolResults
  ];

  // Build follow-up request based on provider
  let followUpUrl, followUpHeaders;
  if (getLlmProvider() === 'gemini') {
    followUpUrl = GEMINI_API_URL;
    followUpHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
  } else {
    followUpUrl = OPENROUTER_API_URL;
    followUpHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': process.env.APP_NAME || 'Iris AI Avatar'
    };
  }

  const response = await fetch(followUpUrl, {
    method: 'POST',
    headers: followUpHeaders,
    body: JSON.stringify({
      model,
      messages: updatedMessages,
      max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '500'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
      stream: true
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[LLM] ${getLlmProvider()} error on tool follow-up: ${response.status} - ${error}`);
    throw new Error(`${getLlmProvider()} tool follow-up failed: ${response.status} - ${error}`);
  }

  let fullResponse = '';

  for await (const chunk of response.body) {
    const lines = chunk.toString().split('\n').filter(line => line.trim());

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);

        if (data === '[DONE]') {
          console.log(`[LLM] Tool response complete: "${fullResponse.substring(0, 100)}..."`);
          await saveMessage(conversation.id, 'assistant', fullResponse);

          onComplete(fullResponse, conversation.id, user.id);
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content || '';

          if (token) {
            fullResponse += token;
            onToken(token);
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  await saveMessage(conversation.id, 'assistant', fullResponse);
  onComplete(fullResponse, conversation.id, user.id);
}

/**
 * Process tool calls from Ollama (native format) and generate final response
 */
async function processOllamaToolCalls(toolCalls, messages, user, conversation, onToken, onComplete) {
  const model = getDefaultModel();

  // Execute each tool call
  const toolResultMessages = [];
  const backgroundTasks = [];

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function?.name;
    if (!toolName) continue;

    console.log(`[LLM] Executing tool (Ollama): ${toolName}`);
    onToken({ type: 'tool_use', tool: toolName });

    let args = {};
    try {
      args = JSON.parse(toolCall.function.arguments || '{}');
    } catch (e) {
      console.error(`[LLM] Failed to parse tool arguments: ${e.message}`);
    }

    const isBackgroundTask = toolName === 'generate_image';

    if (isBackgroundTask) {
      console.log(`[LLM] Running ${toolName} in background...`);
      onToken({
        type: 'tool_background',
        tool: toolName,
        message: 'Generating image in the background, I can keep chatting while it processes...'
      });

      toolResultMessages.push({
        role: 'tool',
        content: `Image generation started in background with prompt: "${args.prompt}". The image will be sent when ready.`
      });

      const backgroundTask = executeTool(toolName, args, { userId: user.id })
        .then(result => {
          console.log(`[LLM] Background task ${toolName} completed`);
          if (toolName === 'generate_image' && result.success && result.base64) {
            onToken({
              type: 'image_generated',
              image: { base64: result.base64, prompt: result.prompt, filename: result.filename, size: result.size, seed: result.seed }
            });
          } else if (!result.success) {
            onToken({ type: 'tool_error', tool: toolName, error: result.error || 'Task failed' });
          }
        })
        .catch(err => {
          console.error(`[LLM] Background task ${toolName} failed:`, err.message);
          onToken({ type: 'tool_error', tool: toolName, error: err.message });
        });
      backgroundTasks.push(backgroundTask);

    } else {
      const result = await executeTool(toolName, args, { userId: user.id });
      const formattedResult = formatToolResult(toolName, result);
      toolResultMessages.push({ role: 'tool', content: formattedResult });
      console.log(`[LLM] Tool ${toolName} result: ${formattedResult.substring(0, 200)}...`);
    }
  }

  // Build follow-up messages with tool calls and results (Ollama native format)
  let updatedMessages = [
    ...messages,
    {
      role: 'assistant',
      content: '',
      tool_calls: toolCalls.map(tc => ({
        function: {
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}')
        }
      }))
    },
    ...toolResultMessages
  ];

  // Use non-streaming for tool call chaining (faster, avoids round-trip overhead)
  // Chain up to 5 additional rounds of tool calls
  let rounds = 0;
  let data;
  while (rounds < 5) {
    rounds++;

    const followUpBody = {
      model,
      messages: updatedMessages,
      stream: false
    };
    if (getToolsEnabled() && ALL_TOOLS.length > 0) {
      followUpBody.tools = ALL_TOOLS;
    }

    const response = await fetch(`${getOllamaApiUrl()}/chat`, {
      method: 'POST',
      headers: getOllamaHeaders(),
      body: JSON.stringify(followUpBody)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[LLM] Ollama tool follow-up error (round ${rounds}): ${response.status} - ${error}`);
      throw new Error(`Ollama tool follow-up failed: ${response.status} - ${error}`);
    }

    data = await response.json();
    const newToolCalls = data.message?.tool_calls || [];

    // No more tool calls — we have the final response
    if (newToolCalls.length === 0) {
      break;
    }

    console.log(`[LLM] Chained tool calls (round ${rounds}): ${newToolCalls.map(tc => tc.function?.name).join(', ')}`);

    // Execute chained tool calls
    const chainedResults = [];
    for (const tc of newToolCalls) {
      const toolName = tc.function?.name;
      if (!toolName) continue;

      onToken({ type: 'tool_use', tool: toolName });

      let args = tc.function.arguments || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch (e) { args = {}; }
      }

      console.log(`[LLM] Executing chained tool: ${toolName}`, args);
      const result = await executeTool(toolName, args, { userId: user.id });
      const formattedResult = formatToolResult(toolName, result);
      chainedResults.push({ role: 'tool', content: formattedResult });
    }

    // Append to messages for next round
    updatedMessages.push({
      role: 'assistant',
      content: '',
      tool_calls: newToolCalls.map(tc => ({
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments || '{}')
            : (tc.function.arguments || {})
        }
      }))
    });
    updatedMessages.push(...chainedResults);
  }

  // Send final text response
  const fullResponse = data?.message?.content || '';
  if (fullResponse) {
    console.log(`[LLM] Tool chain complete (${rounds} rounds): "${fullResponse.substring(0, 100)}..."`);
    onToken(fullResponse); // Send all at once since we used non-streaming for chaining
  } else {
    console.log(`[LLM] Tool chain returned empty content after ${rounds} rounds`);
  }

  await saveMessage(conversation.id, 'assistant', fullResponse);
  onComplete(fullResponse, conversation.id, user.id);
}

/**
 * Extract facts from conversation and save to user memory
 * @param {string} userId - User ID
 * @param {string} userMessage - User's message
 */
async function extractAndSaveFacts(userId, userMessage) {
  const lowerMessage = userMessage.toLowerCase();

  // Extract name
  const namePatterns = [
    /my name is (\w+)/i,
    /i'm (\w+)/i,
    /i am (\w+)/i,
    /call me (\w+)/i
  ];

  for (const pattern of namePatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      await saveUserFact(userId, 'identity', 'name', match[1]);
      break;
    }
  }

  // Extract job/profession
  const jobPatterns = [
    /i work as (?:a |an )?(.+)/i,
    /i'm (?:a |an )?(\w+ (?:developer|engineer|designer|manager|teacher|doctor|nurse|lawyer|accountant|artist|writer))/i,
    /my job is (.+)/i,
    /i do (.+) for work/i
  ];

  for (const pattern of jobPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      await saveUserFact(userId, 'work', 'job', match[1].trim());
      break;
    }
  }

  // Extract location
  const locationPatterns = [
    /i live in (.+)/i,
    /i'm from (.+)/i,
    /i'm in (.+)/i,
    /i'm located in (.+)/i
  ];

  for (const pattern of locationPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      await saveUserFact(userId, 'location', 'lives_in', match[1].trim());
      break;
    }
  }

  // Extract preferences
  if (lowerMessage.includes('i like') || lowerMessage.includes('i love')) {
    const prefMatch = userMessage.match(/i (?:like|love) (.+)/i);
    if (prefMatch) {
      await saveUserFact(userId, 'preference', 'likes', prefMatch[1].trim());
    }
  }

  if (lowerMessage.includes("i don't like") || lowerMessage.includes('i hate')) {
    const prefMatch = userMessage.match(/i (?:don't like|hate) (.+)/i);
    if (prefMatch) {
      await saveUserFact(userId, 'preference', 'dislikes', prefMatch[1].trim());
    }
  }
}

/**
 * Get user's memory/facts
 * @param {string} deviceId - Device identifier
 * @returns {Promise<Array>} - User facts
 */
export async function getUserMemory(deviceId) {
  const user = await getOrCreateUser(deviceId);
  return getUserFacts(user.id);
}

/**
 * Get available models from the current provider
 * @returns {Promise<Array>} - List of available models
 */
export async function getAvailableModels() {
  if (getLlmProvider() === 'gemini') {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
      headers: {
        'Authorization': `Bearer ${getApiKey()}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch Gemini models: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.data || [];
  }

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      'Authorization': `Bearer ${getApiKey()}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch models: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data || [];
}
