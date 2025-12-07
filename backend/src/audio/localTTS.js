import fetch from 'node-fetch';
import FormData from 'form-data';

const LOCAL_TTS_URL = process.env.LOCAL_TTS_URL || 'http://localhost:5000';

/**
 * Check if local TTS/STT service is available
 */
export async function checkLocalServiceHealth() {
  try {
    const response = await fetch(`${LOCAL_TTS_URL}/health`);
    if (response.ok) {
      return await response.json();
    }
    return { status: 'offline' };
  } catch (error) {
    return { status: 'offline', error: error.message };
  }
}

/**
 * Synthesize speech using local Kokoro TTS
 * @param {string} text - Text to synthesize
 * @param {object} options - Synthesis options (speed, voice)
 * @returns {Promise<Buffer>} - WAV audio data
 */
export async function synthesizeSpeechLocal(text, options = {}) {
  const { speed = 1.0, voice = 'af_bella' } = options;

  console.log(`[Local TTS] Synthesizing with voice "${voice}": "${text.substring(0, 50)}..."`);

  try {
    const response = await fetch(`${LOCAL_TTS_URL}/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speed, voice })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'TTS synthesis failed');
    }

    const audioBuffer = await response.buffer();
    console.log(`[Local TTS] Generated ${audioBuffer.length} bytes`);

    return audioBuffer;

  } catch (error) {
    console.error(`[Local TTS] Error: ${error.message}`);
    throw error;
  }
}

/**
 * Synthesize speech with streaming (chunks the output)
 * @param {string} text - Text to synthesize
 * @param {function} onChunk - Callback for each audio chunk
 * @param {object} options - Synthesis options
 */
export async function synthesizeSpeechStreamLocal(text, onChunk, options = {}) {
  try {
    // Generate full audio
    const audioBuffer = await synthesizeSpeechLocal(text, options);

    // Stream in chunks
    const chunkSize = 4096;
    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.slice(i, i + chunkSize);
      onChunk(chunk, null); // No phonemes from Piper
    }

  } catch (error) {
    console.error(`[Local TTS] Streaming error: ${error.message}`);
    throw error;
  }
}

/**
 * List available TTS voices
 */
export async function listLocalVoices() {
  try {
    const response = await fetch(`${LOCAL_TTS_URL}/tts/voices`);
    if (response.ok) {
      return await response.json();
    }
    throw new Error('Failed to fetch voices');
  } catch (error) {
    console.error(`[Local TTS] Error listing voices: ${error.message}`);
    throw error;
  }
}

/**
 * Change TTS voice
 */
export async function changeLocalVoice(voiceName) {
  try {
    const response = await fetch(`${LOCAL_TTS_URL}/tts/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: voiceName })
    });

    if (response.ok) {
      return await response.json();
    }
    throw new Error('Failed to change voice');
  } catch (error) {
    console.error(`[Local TTS] Error changing voice: ${error.message}`);
    throw error;
  }
}

/**
 * Transcribe audio using local Faster-Whisper STT
 * @param {Buffer} audioBuffer - WAV audio data
 * @param {object} options - Transcription options
 * @returns {Promise<string>} - Transcribed text
 */
export async function transcribeAudioLocal(audioBuffer, options = {}) {
  const { language = 'en' } = options;

  console.log(`[Local STT] Transcribing ${audioBuffer.length} bytes`);

  try {
    const formData = new FormData();
    formData.append('audio', audioBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav'
    });

    const response = await fetch(`${LOCAL_TTS_URL}/stt/transcribe?language=${language}`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'STT transcription failed');
    }

    const result = await response.json();
    console.log(`[Local STT] Transcription: "${result.text}"`);

    return result.text;

  } catch (error) {
    console.error(`[Local STT] Error: ${error.message}`);
    throw error;
  }
}

/**
 * Get service status
 */
export async function getLocalServiceStatus() {
  try {
    const response = await fetch(`${LOCAL_TTS_URL}/status`);
    if (response.ok) {
      return await response.json();
    }
    throw new Error('Failed to get status');
  } catch (error) {
    console.error(`[Local Service] Error getting status: ${error.message}`);
    throw error;
  }
}
