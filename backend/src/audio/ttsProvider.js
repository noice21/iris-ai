/**
 * TTS/STT Provider Wrapper
 * Supports both ElevenLabs (cloud) and Local (Piper + Whisper) providers
 */
import * as elevenlabs from './elevenlabs.js';
import * as local from './localTTS.js';

/**
 * Get configured TTS provider
 */
function getTTSProvider() {
  return (process.env.TTS_PROVIDER || 'local').toLowerCase();
}

/**
 * Get configured STT provider
 */
function getSTTProvider() {
  return (process.env.STT_PROVIDER || 'local').toLowerCase();
}

/**
 * Transcribe audio using configured STT provider
 * @param {Buffer} audioBuffer - Audio buffer to transcribe
 * @returns {Promise<string>} - Transcribed text
 */
export async function transcribeAudio(audioBuffer) {
  const provider = getSTTProvider();

  console.log(`[STT] Using provider: ${provider}`);

  try {
    if (provider === 'local') {
      return await local.transcribeAudioLocal(audioBuffer);
    } else if (provider === 'elevenlabs') {
      return await elevenlabs.transcribeAudio(audioBuffer);
    } else {
      throw new Error(`Unknown STT provider: ${provider}`);
    }
  } catch (error) {
    console.error(`[STT] ${provider} provider failed:`, error.message);

    // Fallback to ElevenLabs if local fails
    if (provider === 'local') {
      console.log('[STT] Falling back to ElevenLabs...');
      return await elevenlabs.transcribeAudio(audioBuffer);
    }

    throw error;
  }
}

/**
 * Remove emojis and problematic Unicode characters from text
 * @param {string} text - Input text
 * @returns {string} - Cleaned text
 */
function cleanTextForTTS(text) {
  if (!text) return '';

  // Remove emojis and other problematic Unicode characters
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation Selectors
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols and Pictographs
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
    .trim();
}

/**
 * Synthesize speech using configured TTS provider
 * @param {string} text - Text to synthesize
 * @param {function} onChunk - Callback for audio chunks
 * @param {string} voice - Voice ID (for local: af_bella, am_adam, etc.)
 * @returns {Promise<void>}
 */
export async function synthesizeSpeechStream(text, onChunk, voice = 'af_bella') {
  const provider = getTTSProvider();

  // Validate text input
  if (!text || text.trim().length === 0) {
    console.warn('[TTS] Empty text provided, skipping synthesis');
    return;
  }

  // Clean text to remove emojis and problematic characters
  const cleanedText = cleanTextForTTS(text);

  if (!cleanedText || cleanedText.length === 0) {
    console.warn('[TTS] Text became empty after cleaning, skipping synthesis');
    return;
  }

  console.log(`[TTS] Using provider: ${provider}, voice: ${voice}`);

  try {
    if (provider === 'local') {
      return await local.synthesizeSpeechStreamLocal(cleanedText, onChunk, { voice });
    } else if (provider === 'elevenlabs') {
      return await elevenlabs.synthesizeSpeechStream(cleanedText, onChunk);
    } else {
      throw new Error(`Unknown TTS provider: ${provider}`);
    }
  } catch (error) {
    console.error(`[TTS] ${provider} provider failed:`, error.message);

    // Check if error is quota-related
    const isQuotaError = error.message.includes('quota_exceeded') ||
                         error.message.includes('401') ||
                         error.message.includes('insufficient_quota');

    // Fallback to local if ElevenLabs fails with quota error
    if (provider === 'elevenlabs' && isQuotaError) {
      console.log('[TTS] ElevenLabs quota exceeded, falling back to local TTS...');
      try {
        return await local.synthesizeSpeechStreamLocal(cleanedText, onChunk, { voice });
      } catch (fallbackError) {
        console.error('[TTS] Local TTS fallback also failed:', fallbackError.message);
        // Don't throw - just log and continue without TTS
        console.warn('[TTS] All TTS providers failed, continuing without audio');
        return;
      }
    }

    // Fallback to ElevenLabs if local fails (if quota available)
    if (provider === 'local') {
      console.log('[TTS] Falling back to ElevenLabs...');
      try {
        return await elevenlabs.synthesizeSpeechStream(cleanedText, onChunk);
      } catch (fallbackError) {
        console.error('[TTS] ElevenLabs fallback failed:', fallbackError.message);
        // Don't throw - just log and continue without TTS
        console.warn('[TTS] All TTS providers failed, continuing without audio');
        return;
      }
    }

    // For other errors, don't throw - just warn and continue
    console.warn('[TTS] TTS synthesis failed, continuing without audio');
  }
}

/**
 * Get provider status
 */
export async function getProviderStatus() {
  const ttsProvider = getTTSProvider();
  const sttProvider = getSTTProvider();

  const status = {
    tts: {
      provider: ttsProvider,
      available: false
    },
    stt: {
      provider: sttProvider,
      available: false
    }
  };

  // Check local service if configured
  if (ttsProvider === 'local' || sttProvider === 'local') {
    try {
      const health = await local.checkLocalServiceHealth();
      if (ttsProvider === 'local') {
        status.tts.available = health.status === 'ok' && health.services?.tts === true;
      }
      if (sttProvider === 'local') {
        status.stt.available = health.status === 'ok' && health.services?.stt === true;
      }
    } catch (error) {
      console.error('[Provider] Failed to check local service:', error.message);
    }
  }

  // ElevenLabs is always available if API key is set
  if (ttsProvider === 'elevenlabs') {
    status.tts.available = !!process.env.ELEVENLABS_API_KEY;
  }
  if (sttProvider === 'elevenlabs') {
    status.stt.available = !!process.env.ELEVENLABS_API_KEY;
  }

  return status;
}

/**
 * List available voices for current TTS provider
 */
export async function listVoices() {
  const provider = getTTSProvider();

  if (provider === 'local') {
    return await local.listLocalVoices();
  } else if (provider === 'elevenlabs') {
    // ElevenLabs voice listing would go here
    return { voices: ['Hope', 'Rachel', 'Domi', 'Bella'], current: process.env.ELEVENLABS_VOICE_NAME };
  }

  return { voices: [], current: null };
}

/**
 * Change voice for current TTS provider
 */
export async function changeVoice(voiceName) {
  const provider = getTTSProvider();

  if (provider === 'local') {
    return await local.changeLocalVoice(voiceName);
  } else if (provider === 'elevenlabs') {
    // Would need to update env variable or implement ElevenLabs voice change
    return { success: true, voice: voiceName };
  }

  throw new Error(`Voice change not supported for provider: ${provider}`);
}
