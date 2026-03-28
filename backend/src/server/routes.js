import { processAudioInput } from '../audio/processor.js';
import { generateResponse } from '../llm/pipeline.js';
import { transcribeAudio } from '../audio/ttsProvider.js';
import { getAvailableModels, setDefaultModel } from '../tools/imageGeneration.js';
import { synthesizeSpeechLocal } from '../audio/localTTS.js';
import { synthesizeSpeech as synthesizeSpeechElevenlabs } from '../audio/elevenlabs.js';
import { stripMarkdown } from '../utils/helpers.js';
import { cleanTextForTTS } from '../audio/ttsProvider.js';
import { buildAuthHook } from './auth.js';

/**
 * Get TTS provider based on environment
 */
function getTTSProvider() {
  return (process.env.TTS_PROVIDER || 'local').toLowerCase();
}

/**
 * Synthesize speech using configured provider
 * Returns audio buffer with appropriate content type
 */
async function synthesizeSpeech(text, voiceId = null) {
  const provider = getTTSProvider();

  // Strip emojis and problematic Unicode before sending to TTS engine
  const cleanedText = cleanTextForTTS(text);
  if (!cleanedText || cleanedText.trim().length === 0) {
    throw new Error('Text is empty after removing unsupported characters');
  }

  console.log(`[TTS] REST endpoint using provider: ${provider}`);

  if (provider === 'local') {
    // Local TTS returns WAV format
    const audioBuffer = await synthesizeSpeechLocal(cleanedText);
    return { buffer: audioBuffer, contentType: 'audio/wav' };
  } else {
    // ElevenLabs returns MP3 format
    const audioBuffer = await synthesizeSpeechElevenlabs(cleanedText, voiceId);
    return { buffer: audioBuffer, contentType: 'audio/mpeg' };
  }
}

export function setupRoutes(fastify) {
  const authHook = buildAuthHook();
  const protectedOpts = { preHandler: [authHook] };

  // Process audio and get AI response
  fastify.post('/api/chat', protectedOpts, async (request, reply) => {
    try {
      const { message, conversationId } = request.body;

      const response = await generateResponse(message, conversationId);

      return {
        success: true,
        response: response.text,
        conversationId: response.conversationId
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to generate response'
      });
    }
  });

  // Upload audio for transcription
  fastify.post('/api/transcribe', protectedOpts, async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({
          success: false,
          error: 'No audio file provided'
        });
      }

      const audioBuffer = await data.toBuffer();
      const processedAudio = await processAudioInput(audioBuffer, data.mimetype);
      const transcript = await transcribeAudio(processedAudio);

      return {
        success: true,
        transcript
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to transcribe audio'
      });
    }
  });

  // Text to speech endpoint
  fastify.post('/api/synthesize', protectedOpts, async (request, reply) => {
    try {
      const { text, voiceId } = request.body;

      if (!text) {
        return reply.status(400).send({
          success: false,
          error: 'No text provided'
        });
      }

      const { buffer, contentType } = await synthesizeSpeech(text, voiceId);

      reply.header('Content-Type', contentType);
      return reply.send(buffer);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to synthesize speech'
      });
    }
  });

  // Full pipeline: audio in -> transcribe -> LLM -> TTS -> audio out
  fastify.post('/api/process', protectedOpts, async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({
          success: false,
          error: 'No audio file provided'
        });
      }

      const audioBuffer = await data.toBuffer();
      const processedAudio = await processAudioInput(audioBuffer, data.mimetype);

      // Transcribe
      const transcript = await transcribeAudio(processedAudio);

      // Generate LLM response
      const llmResponse = await generateResponse(transcript);

      // Synthesize speech
      const { buffer, contentType } = await synthesizeSpeech(stripMarkdown(llmResponse.text));

      reply.header('Content-Type', contentType);
      reply.header('X-Transcript', encodeURIComponent(transcript));
      reply.header('X-Response', encodeURIComponent(llmResponse.text));

      return reply.send(buffer);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to process audio'
      });
    }
  });

  // Get available image generation models
  fastify.get('/api/image-models', async (_request, reply) => {
    try {
      const result = await getAvailableModels();
      return result;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch image models'
      });
    }
  });

  // Set default image generation model
  fastify.post('/api/image-models/set', async (request, reply) => {
    try {
      const { modelName } = request.body;

      if (!modelName) {
        return reply.status(400).send({
          success: false,
          error: 'No model name provided'
        });
      }

      const result = setDefaultModel(modelName);
      return result;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to set image model'
      });
    }
  });
}
