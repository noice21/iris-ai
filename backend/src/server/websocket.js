import jwt from 'jsonwebtoken';
import { processAudioChunk, finalizeAudioStream } from '../audio/processor.js';
import { generateStreamingResponse } from '../llm/pipeline.js';
import { synthesizeSpeechStream, transcribeAudio } from '../audio/ttsProvider.js';
import { sendToAvatar } from '../avatar/bridge.js';
import { generateId, stripMarkdown } from '../utils/helpers.js';
import { getOrCreateUser, getActiveConversation } from '../database/memory.js';

const sessions = new Map();

export function setupWebSocket(fastify) {
  fastify.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, async (socket, req) => {
      const sessionId = generateId();
      const cloudMode = process.env.CLOUD_MODE === 'true';
      const url = new URL(req.url, 'http://localhost');

      let deviceId;

      if (cloudMode) {
        const token = url.searchParams.get('token');
        if (!token) {
          socket.send(JSON.stringify({ type: 'error', error: 'Missing auth token' }));
          socket.close();
          return;
        }
        try {
          const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, { algorithms: ['HS256'] });
          deviceId = payload.sub;
        } catch (err) {
          socket.send(JSON.stringify({ type: 'error', error: 'Invalid auth token' }));
          socket.close();
          return;
        }
      } else {
        deviceId = url.searchParams.get('deviceId') || sessionId;
      }

      // Get or create user and conversation from database
      const user = await getOrCreateUser(deviceId);
      const conversation = await getActiveConversation(user.id);

      sessions.set(sessionId, {
        socket,
        audioChunks: [],
        deviceId,
        userId: user.id,
        conversationId: conversation.id,
        isProcessing: false,
        sttEnabled: process.env.ENABLE_STT !== 'false',
        ttsEnabled: process.env.ENABLE_TTS !== 'false',
        selectedVoice: 'af_bella' // Default Kokoro voice
      });

      console.log(`WebSocket client connected: ${sessionId} (user: ${user.id})`);

      socket.send(JSON.stringify({
        type: 'connected',
        sessionId,
        userId: user.id,
        conversationId: conversation.id
      }));

      socket.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          await handleMessage(sessionId, data);
        } catch (error) {
          // Binary audio data
          if (Buffer.isBuffer(message)) {
            await handleAudioChunk(sessionId, message);
          } else {
            console.error('Failed to parse message:', error);
            socket.send(JSON.stringify({
              type: 'error',
              error: 'Invalid message format'
            }));
          }
        }
      });

      socket.on('close', () => {
        console.log(`WebSocket client disconnected: ${sessionId}`);
        sessions.delete(sessionId);
      });

      socket.on('error', (error) => {
        console.error(`WebSocket error for ${sessionId}:`, error);
        sessions.delete(sessionId);
      });
    });
  });
}

async function handleMessage(sessionId, data) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const { socket } = session;

  switch (data.type) {
    case 'start_recording':
      session.audioChunks = [];
      session.isProcessing = false;
      socket.send(JSON.stringify({ type: 'recording_started' }));
      break;

    case 'stop_recording':
      await processRecording(sessionId);
      break;

    case 'text_input':
      await processTextInput(sessionId, data.text);
      break;

    case 'new_conversation':
      // Start a new conversation
      const newConversation = await getActiveConversation(session.userId);
      session.conversationId = newConversation.id;
      socket.send(JSON.stringify({
        type: 'conversation_started',
        conversationId: newConversation.id
      }));
      break;

    case 'set_device_id':
      // Update device ID for returning users
      if (data.deviceId) {
        const user = await getOrCreateUser(data.deviceId);
        const conversation = await getActiveConversation(user.id);
        session.deviceId = data.deviceId;
        session.userId = user.id;
        session.conversationId = conversation.id;
        socket.send(JSON.stringify({
          type: 'user_identified',
          userId: user.id,
          conversationId: conversation.id
        }));
      }
      break;

    case 'ping':
      socket.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'request_greeting':
      // Send a greeting message to start the conversation
      await processGreeting(sessionId);
      break;

    case 'set_stt_enabled':
      // Update STT enabled state for this session
      session.sttEnabled = data.enabled !== false;
      console.log(`[WebSocket] STT ${session.sttEnabled ? 'enabled' : 'disabled'} for session ${sessionId}`);
      socket.send(JSON.stringify({
        type: 'stt_state_updated',
        enabled: session.sttEnabled
      }));
      break;

    case 'set_tts_enabled':
      // Update TTS enabled state for this session
      session.ttsEnabled = data.enabled !== false;
      console.log(`[WebSocket] TTS ${session.ttsEnabled ? 'enabled' : 'disabled'} for session ${sessionId}`);
      socket.send(JSON.stringify({
        type: 'tts_state_updated',
        enabled: session.ttsEnabled
      }));
      break;

    case 'set_voice':
      // Update selected voice for TTS
      session.selectedVoice = data.voice || 'af_bella';
      console.log(`[WebSocket] Voice changed to ${session.selectedVoice} for session ${sessionId}`);
      socket.send(JSON.stringify({
        type: 'voice_updated',
        voice: session.selectedVoice
      }));
      break;

    default:
      socket.send(JSON.stringify({
        type: 'error',
        error: `Unknown message type: ${data.type}`
      }));
  }
}

async function handleAudioChunk(sessionId, audioData) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const processedChunk = await processAudioChunk(audioData);
  session.audioChunks.push(processedChunk);
}

async function processRecording(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.isProcessing) return;

  session.isProcessing = true;
  const { socket } = session;

  try {
    socket.send(JSON.stringify({ type: 'processing_started' }));
    console.log(`[WebSocket] Processing recording for session ${sessionId} - ${session.audioChunks.length} chunks`);

    // Check if STT is enabled (session setting overrides env)
    if (!session.sttEnabled) {
      console.log('[WebSocket] STT is disabled for this session');
      socket.send(JSON.stringify({
        type: 'error',
        error: 'STT is disabled. Please use text input instead.'
      }));
      session.isProcessing = false;
      session.audioChunks = [];
      return;
    }

    // Finalize audio stream
    console.log('[WebSocket] Finalizing audio stream...');
    const audioBuffer = await finalizeAudioStream(session.audioChunks);
    console.log(`[WebSocket] Audio finalized - ${audioBuffer.length} bytes`);

    // Transcribe audio
    socket.send(JSON.stringify({ type: 'transcribing' }));
    console.log('[WebSocket] Starting transcription...');
    const transcript = await transcribeAudio(audioBuffer);
    console.log(`[WebSocket] Transcription complete: "${transcript}"`);

    socket.send(JSON.stringify({
      type: 'transcript',
      text: transcript
    }));

    // Process with LLM and stream response
    await processTextInput(sessionId, transcript);

  } catch (error) {
    console.error('[WebSocket] Error processing recording:', error.message);
    console.error('[WebSocket] Error stack:', error.stack);
    socket.send(JSON.stringify({
      type: 'error',
      error: `Failed to process recording: ${error.message}`
    }));
  } finally {
    session.isProcessing = false;
    session.audioChunks = [];
  }
}

async function processTextInput(sessionId, text) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const { socket, deviceId, conversationId } = session;

  try {
    socket.send(JSON.stringify({ type: 'generating_response' }));

    // Stream LLM response with database memory
    await generateStreamingResponse(
      text,
      deviceId,
      conversationId,
      // On token callback - can be string token or object message
      (token) => {
        if (typeof token === 'string') {
          socket.send(JSON.stringify({
            type: 'response_token',
            token
          }));
        } else {
          // Send custom message (e.g., tool_use)
          socket.send(JSON.stringify(token));
        }
      },
      // On complete callback
      async (completeText, convId, userId) => {
        // Update session with latest IDs
        session.conversationId = convId;
        session.userId = userId;

        socket.send(JSON.stringify({
          type: 'response_complete',
          text: completeText,
          conversationId: convId
        }));

        // Check if TTS is enabled (session setting overrides env)
        if (session.ttsEnabled) {
          try {
            // Synthesize speech and send to avatar
            console.log('[TTS] Starting speech synthesis for:', completeText.substring(0, 50) + '...');
            socket.send(JSON.stringify({ type: 'synthesizing' }));

            const ttsText = stripMarkdown(completeText);
            await synthesizeSpeechStream(
              ttsText,
              // Audio chunk callback
              (audioChunk, phonemes) => {
                // Send audio to client
                console.log('[TTS] Sending audio chunk:', audioChunk.length, 'bytes');
                socket.send(audioChunk);

                // Send phonemes to avatar
                if (phonemes) {
                  sendToAvatar({
                    type: 'phonemes',
                    data: phonemes,
                    text: completeText
                  });

                  socket.send(JSON.stringify({
                    type: 'phonemes',
                    data: phonemes
                  }));
                }
              },
              session.selectedVoice // Pass selected voice
            );

            console.log('[TTS] Speech synthesis complete');
            socket.send(JSON.stringify({ type: 'synthesis_complete' }));
          } catch (ttsError) {
            console.error('[TTS] Speech synthesis failed:', ttsError.message);
            // Don't crash - just notify client that TTS failed
            socket.send(JSON.stringify({
              type: 'synthesis_failed',
              error: 'TTS temporarily unavailable',
              message: 'Voice synthesis failed, but text response is available'
            }));
          }
        } else {
          console.log('[TTS] TTS disabled, skipping speech synthesis');
        }
      }
    ).catch(err => {
      console.error('[LLM] Response generation error:', err);
    });

  } catch (error) {
    console.error('Error processing text input:', error);
    socket.send(JSON.stringify({
      type: 'error',
      error: 'Failed to process input'
    }));
  }
}

async function processGreeting(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const { socket } = session;

  try {
    // Simple greeting - just synthesize and play without going through LLM
    const greetingText = "Hey! I'm Iris, your AI assistant. What can I help you with today?";

    console.log('[Greeting] Sending startup greeting');

    socket.send(JSON.stringify({
      type: 'response_complete',
      text: greetingText,
      conversationId: session.conversationId
    }));

    // Check if TTS is enabled
    if (session.ttsEnabled) {
      try {
        socket.send(JSON.stringify({ type: 'synthesizing' }));

        await synthesizeSpeechStream(
          stripMarkdown(greetingText),
          (audioChunk, phonemes) => {
            socket.send(audioChunk);
            if (phonemes) {
              sendToAvatar({
                type: 'phonemes',
                data: phonemes,
                text: greetingText
              });
              socket.send(JSON.stringify({
                type: 'phonemes',
                data: phonemes
              }));
            }
          },
          session.selectedVoice // Pass selected voice
        );

        console.log('[Greeting] Greeting synthesis complete');
        socket.send(JSON.stringify({ type: 'synthesis_complete' }));
      } catch (ttsError) {
        console.error('[Greeting] TTS synthesis failed:', ttsError.message);
        socket.send(JSON.stringify({
          type: 'synthesis_failed',
          error: 'TTS temporarily unavailable',
          message: 'Voice synthesis failed for greeting'
        }));
      }
    } else {
      console.log('[Greeting] TTS disabled, skipping speech synthesis');
    }

  } catch (error) {
    console.error('Error processing greeting:', error);
  }
}

export { sessions };
