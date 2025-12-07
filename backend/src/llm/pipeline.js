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

// Check if tools are enabled
const TOOLS_ENABLED = process.env.ENABLE_TOOLS !== 'false';

/**
 * Get OpenRouter API key from environment
 * @returns {string} - API key
 */
function getApiKey() {
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
  return process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';
}

/**
 * Get system prompt for the AI avatar
 * @param {string} memoryContext - User memory context
 * @returns {string} - System prompt
 */
function getSystemPrompt(memoryContext = '') {
  const basePrompt = process.env.AI_SYSTEM_PROMPT || `You are Iris, a helpful and friendly AI assistant with memory.
You remember past conversations and facts about users.
You engage in natural conversation, providing helpful, accurate, and concise responses.
Keep your responses conversational and appropriate for spoken dialogue.
Avoid using markdown formatting, bullet points, or numbered lists in your responses.
Speak naturally as if having a face-to-face conversation.

When the user tells you something important about themselves (like their name, preferences, job, interests),
acknowledge it naturally and remember it for future conversations.`;

  const toolsPrompt = TOOLS_ENABLED ? `

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
   - Search the web with search_web when you need information you don't know (runs invisibly in background)
4. Control smart LED lights (Govee and Nanoleaf devices):
   - List all available lights with get_smart_lights
   - Turn individual lights on/off with turn_on_light and turn_off_light
   - Turn all lights on/off with turn_on_all_lights and turn_off_all_lights
   - Set brightness levels (0-100%) with set_light_brightness
   - Change light colors (hex codes or color names) with set_light_color
   - Apply preset scenes (relax, energize, party, movie, sleep) with apply_light_scene

When the user asks about container stats, server health, or media services, use the appropriate media dashboard tool.
When the user asks to create, generate, or draw images, artwork, or visual content, use the generate_image tool. Tell them you're generating it in the background and you can keep chatting.
When the user asks to change, switch, or use a different image model, first list models if needed, then use set_image_model.
When the user asks about running programs, to start/stop/restart programs, use the OS control tools.
When the user asks about lights, to control lights, change colors, set brightness, or apply lighting scenes, use the smart lights tools.
When you need up-to-date information or facts you don't know, use search_web to find the answer invisibly.
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

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': process.env.APP_NAME || 'Iris AI Avatar'
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '500'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7')
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const assistantMessage = data.choices?.[0]?.message?.content || '';

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

  // Build request body with optional tools
  const requestBody = {
    model,
    messages,
    max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '500'),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
    stream: true
  };

  // Add tools if enabled
  if (TOOLS_ENABLED && ALL_TOOLS.length > 0) {
    requestBody.tools = ALL_TOOLS;
    // Don't set tool_choice for Gemini models as they handle it automatically
    if (!model.includes('gemini')) {
      requestBody.tool_choice = 'auto';
    }
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': process.env.APP_NAME || 'Iris AI Avatar'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[LLM] OpenRouter error: ${response.status} - ${error}`);
    throw new Error(`OpenRouter streaming failed: ${response.status} - ${error}`);
  }

  console.log('[LLM] Streaming response started...');
  let fullResponse = '';
  let toolCalls = [];

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
      const backgroundTask = executeTool(toolCall.function.name, args)
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
      const result = await executeTool(toolCall.function.name, args);
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

  // Make follow-up request to get final response
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': process.env.APP_NAME || 'Iris AI Avatar'
    },
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
    console.error(`[LLM] OpenRouter error on tool follow-up: ${response.status} - ${error}`);
    throw new Error(`OpenRouter tool follow-up failed: ${response.status} - ${error}`);
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
 * Get available models from OpenRouter
 * @returns {Promise<Array>} - List of available models
 */
export async function getAvailableModels() {
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
