import fetch from 'node-fetch';
import FormData from 'form-data';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

/**
 * Get ElevenLabs API key from environment
 * @returns {string} - API key
 */
function getApiKey() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY environment variable is required');
  }
  return apiKey;
}

/**
 * Get default voice ID from environment or use a default
 * @returns {string} - Voice ID
 */
function getDefaultVoiceId() {
  return process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah voice
}

/**
 * Transcribe audio using ElevenLabs Speech-to-Text
 * @param {Buffer} audioBuffer - Audio buffer to transcribe
 * @returns {Promise<string>} - Transcribed text
 */
export async function transcribeAudio(audioBuffer) {
  const apiKey = getApiKey();

  console.log('[ElevenLabs] STT: Transcribing audio buffer of', audioBuffer.length, 'bytes');

  const formData = new FormData();
  formData.append('file', audioBuffer, {
    filename: 'audio.mp3',
    contentType: 'audio/mpeg'
  });
  formData.append('model_id', 'scribe_v1');

  const response = await fetch(`${ELEVENLABS_API_URL}/speech-to-text`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      ...formData.getHeaders()
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[ElevenLabs] STT error:', response.status, error);
    throw new Error(`ElevenLabs STT failed: ${response.status} - ${error}`);
  }

  const result = await response.json();
  console.log('[ElevenLabs] STT result:', result.text);
  return result.text || '';
}

/**
 * Synthesize speech from text using ElevenLabs TTS
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice ID to use (optional)
 * @returns {Promise<Buffer>} - Audio buffer
 */
export async function synthesizeSpeech(text, voiceId = null) {
  const apiKey = getApiKey();
  const voice = voiceId || getDefaultVoiceId();

  const response = await fetch(
    `${ELEVENLABS_API_URL}/text-to-speech/${voice}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_monolingual_v1',
        voice_settings: {
          stability: parseFloat(process.env.ELEVENLABS_STABILITY || '0.5'),
          similarity_boost: parseFloat(process.env.ELEVENLABS_SIMILARITY || '0.75'),
          style: parseFloat(process.env.ELEVENLABS_STYLE || '0'),
          use_speaker_boost: true
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs TTS failed: ${response.status} - ${error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Synthesize speech with streaming (raw MP3)
 * @param {string} text - Text to synthesize
 * @param {Function} onChunk - Callback for each audio chunk (chunk, phonemes)
 * @param {string} voiceId - Voice ID to use (optional)
 */
export async function synthesizeSpeechStream(text, onChunk, voiceId = null) {
  const apiKey = getApiKey();
  const voice = voiceId || getDefaultVoiceId();

  console.log('[ElevenLabs] Starting TTS stream for voice:', voice);
  console.log('[ElevenLabs] Text:', text.substring(0, 100) + '...');

  // Use simple streaming endpoint that returns raw MP3 bytes
  const response = await fetch(
    `${ELEVENLABS_API_URL}/text-to-speech/${voice}/stream?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_monolingual_v1',
        voice_settings: {
          stability: parseFloat(process.env.ELEVENLABS_STABILITY || '0.5'),
          similarity_boost: parseFloat(process.env.ELEVENLABS_SIMILARITY || '0.75'),
          style: parseFloat(process.env.ELEVENLABS_STYLE || '0'),
          use_speaker_boost: true
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[ElevenLabs] TTS API error:', response.status, error);
    throw new Error(`ElevenLabs TTS streaming failed: ${response.status} - ${error}`);
  }

  console.log('[ElevenLabs] TTS API response OK, streaming raw MP3 audio...');
  const reader = response.body;

  // Stream raw MP3 chunks directly
  for await (const chunk of reader) {
    console.log('[ElevenLabs] Audio chunk:', chunk.length, 'bytes');
    onChunk(chunk, null);
  }

  console.log('[ElevenLabs] Stream complete');
}

/**
 * Extract phoneme data from ElevenLabs alignment
 * @param {Object} alignment - Alignment data from ElevenLabs
 * @returns {Array} - Phoneme data for avatar
 */
function extractPhonemes(alignment) {
  if (!alignment || !alignment.characters) {
    return null;
  }

  // Map character timings to visemes/phonemes for avatar
  return alignment.characters.map((char, index) => ({
    char: char,
    start: alignment.character_start_times_seconds?.[index] || 0,
    end: alignment.character_end_times_seconds?.[index] || 0
  }));
}

/**
 * Get available voices from ElevenLabs
 * @returns {Promise<Array>} - List of available voices
 */
export async function getAvailableVoices() {
  const apiKey = getApiKey();

  const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    headers: {
      'xi-api-key': apiKey
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch voices: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.voices || [];
}

/**
 * Get user subscription info from ElevenLabs
 * @returns {Promise<Object>} - Subscription info
 */
export async function getSubscriptionInfo() {
  const apiKey = getApiKey();

  const response = await fetch(`${ELEVENLABS_API_URL}/user/subscription`, {
    headers: {
      'xi-api-key': apiKey
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch subscription: ${response.status} - ${error}`);
  }

  return response.json();
}
