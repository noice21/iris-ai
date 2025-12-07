import WebSocket from 'ws';
import { EventEmitter } from 'events';

// Avatar connection state
let avatarSocket = null;
let reconnectInterval = null;
const eventEmitter = new EventEmitter();

// Viseme mapping for lip sync (ARKit compatible)
const VISEME_MAP = {
  // Vowels
  'a': 'viseme_aa',
  'e': 'viseme_E',
  'i': 'viseme_I',
  'o': 'viseme_O',
  'u': 'viseme_U',
  // Consonants
  'p': 'viseme_PP',
  'b': 'viseme_PP',
  'm': 'viseme_PP',
  'f': 'viseme_FF',
  'v': 'viseme_FF',
  't': 'viseme_TH',
  'd': 'viseme_TH',
  'n': 'viseme_nn',
  'k': 'viseme_kk',
  'g': 'viseme_kk',
  's': 'viseme_SS',
  'z': 'viseme_SS',
  'sh': 'viseme_CH',
  'ch': 'viseme_CH',
  'j': 'viseme_CH',
  'r': 'viseme_RR',
  'l': 'viseme_nn',
  ' ': 'viseme_sil',
  '.': 'viseme_sil',
  ',': 'viseme_sil'
};

/**
 * Initialize connection to UE5 Avatar
 */
export function initializeAvatarConnection() {
  const avatarUrl = process.env.UE5_AVATAR_WS_URL || 'ws://localhost:8080';

  if (avatarSocket?.readyState === WebSocket.OPEN) {
    console.log('Avatar connection already established');
    return;
  }

  console.log(`Connecting to UE5 Avatar at ${avatarUrl}...`);

  avatarSocket = new WebSocket(avatarUrl);

  avatarSocket.on('open', () => {
    console.log('Connected to UE5 Avatar');
    eventEmitter.emit('connected');

    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  });

  avatarSocket.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      eventEmitter.emit('message', message);

      // Handle specific message types
      if (message.type === 'status') {
        eventEmitter.emit('status', message.data);
      }
    } catch (error) {
      console.error('Failed to parse avatar message:', error);
    }
  });

  avatarSocket.on('close', () => {
    console.log('Disconnected from UE5 Avatar');
    eventEmitter.emit('disconnected');
    scheduleReconnect();
  });

  avatarSocket.on('error', (error) => {
    console.error('Avatar WebSocket error:', error.message);
    eventEmitter.emit('error', error);
  });
}

/**
 * Schedule reconnection to avatar
 */
function scheduleReconnect() {
  if (reconnectInterval) return;

  const reconnectDelay = parseInt(process.env.AVATAR_RECONNECT_DELAY || '5000');

  reconnectInterval = setInterval(() => {
    console.log('Attempting to reconnect to UE5 Avatar...');
    initializeAvatarConnection();
  }, reconnectDelay);
}

/**
 * Send data to UE5 Avatar
 * @param {Object} data - Data to send
 */
export function sendToAvatar(data) {
  if (!avatarSocket || avatarSocket.readyState !== WebSocket.OPEN) {
    console.warn('Avatar not connected, queueing message');
    eventEmitter.emit('queued', data);
    return false;
  }

  try {
    avatarSocket.send(JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Failed to send to avatar:', error);
    return false;
  }
}

/**
 * Send phoneme data for lip sync
 * @param {Array} phonemes - Phoneme data with timing
 * @param {string} text - Original text
 */
export function sendPhonemes(phonemes, text) {
  const visemes = phonemes.map(p => ({
    viseme: charToViseme(p.char),
    start: p.start,
    end: p.end,
    char: p.char
  }));

  return sendToAvatar({
    type: 'lip_sync',
    visemes,
    text,
    timestamp: Date.now()
  });
}

/**
 * Convert character to viseme
 * @param {string} char - Character
 * @returns {string} - Viseme name
 */
function charToViseme(char) {
  const lower = char.toLowerCase();
  return VISEME_MAP[lower] || 'viseme_sil';
}

/**
 * Send emotion/expression to avatar
 * @param {string} emotion - Emotion name
 * @param {number} intensity - Intensity 0-1
 */
export function sendEmotion(emotion, intensity = 1.0) {
  return sendToAvatar({
    type: 'emotion',
    emotion,
    intensity,
    timestamp: Date.now()
  });
}

/**
 * Send animation trigger to avatar
 * @param {string} animation - Animation name
 * @param {Object} params - Animation parameters
 */
export function sendAnimation(animation, params = {}) {
  return sendToAvatar({
    type: 'animation',
    animation,
    params,
    timestamp: Date.now()
  });
}

/**
 * Send text for avatar to display (e.g., subtitles)
 * @param {string} text - Text to display
 * @param {number} duration - Display duration in ms
 */
export function sendText(text, duration = 5000) {
  return sendToAvatar({
    type: 'text',
    text,
    duration,
    timestamp: Date.now()
  });
}

/**
 * Send audio data directly to avatar
 * @param {Buffer} audioBuffer - Audio buffer
 */
export function sendAudio(audioBuffer) {
  if (!avatarSocket || avatarSocket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    // Send audio as binary
    avatarSocket.send(audioBuffer);
    return true;
  } catch (error) {
    console.error('Failed to send audio to avatar:', error);
    return false;
  }
}

/**
 * Get avatar connection status
 * @returns {Object} - Connection status
 */
export function getAvatarStatus() {
  return {
    connected: avatarSocket?.readyState === WebSocket.OPEN,
    readyState: avatarSocket?.readyState,
    url: process.env.UE5_AVATAR_WS_URL || 'ws://localhost:8080'
  };
}

/**
 * Close avatar connection
 */
export function closeAvatarConnection() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
  }

  if (avatarSocket) {
    avatarSocket.close();
    avatarSocket = null;
  }
}

/**
 * Subscribe to avatar events
 * @param {string} event - Event name
 * @param {Function} callback - Event callback
 */
export function onAvatarEvent(event, callback) {
  eventEmitter.on(event, callback);
}

/**
 * Unsubscribe from avatar events
 * @param {string} event - Event name
 * @param {Function} callback - Event callback
 */
export function offAvatarEvent(event, callback) {
  eventEmitter.off(event, callback);
}

// Auto-initialize if configured
if (process.env.AVATAR_AUTO_CONNECT === 'true') {
  initializeAvatarConnection();
}

export { eventEmitter as avatarEvents };
