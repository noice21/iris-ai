import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:vad/vad.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:permission_handler/permission_handler.dart';

enum VadState {
  idle,           // VAD not running
  listening,      // VAD listening, no speech detected
  speechStart,    // Speech just started (potential misfire)
  speaking,       // Confirmed speech in progress
  processing,     // Processing captured audio
}

class VadService extends ChangeNotifier {
  VadHandler? _vadHandler;

  VadState _state = VadState.idle;
  bool _isInitialized = false;
  bool _isEnabled = true;
  bool _isPaused = false;
  bool _isTransitioning = false; // Prevents race conditions during pause/resume

  // Callbacks
  Function()? onSpeechStart;
  Function(Uint8List audioData)? onSpeechEnd;
  Function()? onListeningStarted;
  Function(String)? onError;

  // Getters
  VadState get state => _state;
  bool get isInitialized => _isInitialized;
  bool get isEnabled => _isEnabled;
  bool get isListening => _state == VadState.listening || _state == VadState.speaking;
  bool get isSpeaking => _state == VadState.speaking || _state == VadState.speechStart;

  Future<void> initialize() async {
    if (_isInitialized) return;

    try {
      debugPrint('[VAD] Initializing Silero VAD...');

      // CRITICAL: Request microphone permission before initializing VAD
      debugPrint('[VAD] Checking microphone permission...');
      final micStatus = await Permission.microphone.status;
      if (!micStatus.isGranted) {
        debugPrint('[VAD] ⚠️ Microphone permission NOT granted! Requesting...');
        final requested = await Permission.microphone.request();
        if (!requested.isGranted) {
          debugPrint('[VAD] ❌ Microphone permission DENIED - VAD cannot record audio!');
          onError?.call('Microphone permission is required for voice input');
          _isInitialized = false;
          notifyListeners();
          return;
        }
      }
      debugPrint('[VAD] ✅ Microphone permission granted');

      debugPrint('[VAD] Will download model from CDN on first use (cached afterward)');

      // Create VAD handler with debug mode
      _vadHandler = VadHandler.create(isDebug: true);

      // Setup event listeners
      _setupEventListeners();

      // Load saved settings
      await _loadSettings();

      _isInitialized = true;
      debugPrint('[VAD] Silero VAD initialized successfully');

      // Auto-start if enabled
      if (_isEnabled) {
        await startListening();
      }

      notifyListeners();
    } catch (e) {
      debugPrint('[VAD] Failed to initialize: $e');
      onError?.call('Failed to initialize VAD: $e');
      _isInitialized = false;
      notifyListeners();
    }
  }

  void _setupEventListeners() {
    if (_vadHandler == null) {
      debugPrint('[VAD] ⚠️ Cannot setup listeners - vadHandler is null');
      return;
    }

    debugPrint('[VAD] �� Setting up event listeners...');

    // Speech start detected (may be a misfire)
    _vadHandler!.onSpeechStart.listen((_) {
      debugPrint('[VAD] 🎙️ onSpeechStart fired - paused: $_isPaused, enabled: $_isEnabled');
      if (_isPaused) {
        debugPrint('[VAD] ⏸️ Ignoring speech start - VAD is paused');
        return;
      }
      debugPrint('[VAD] ✅ Speech start detected - transitioning to speechStart state');
      _state = VadState.speechStart;
      notifyListeners();
    });

    // Real speech confirmed (not a misfire)
    _vadHandler!.onRealSpeechStart.listen((_) {
      debugPrint('[VAD] 🗣️ onRealSpeechStart fired - paused: $_isPaused, enabled: $_isEnabled');
      if (_isPaused) {
        debugPrint('[VAD] ⏸️ Ignoring real speech start - VAD is paused');
        return;
      }
      debugPrint('[VAD] ✅ Real speech confirmed - transitioning to speaking state');
      _state = VadState.speaking;
      if (onSpeechStart != null) {
        debugPrint('[VAD] 📞 Calling onSpeechStart callback');
        onSpeechStart?.call();
      } else {
        debugPrint('[VAD] ⚠️ onSpeechStart callback is null!');
      }
      notifyListeners();
    });

    // VAD misfire (short noise, not speech)
    _vadHandler!.onVADMisfire.listen((_) {
      debugPrint('[VAD] 🚫 onVADMisfire fired - paused: $_isPaused');
      if (_isPaused) return;
      debugPrint('[VAD] ⚠️ Misfire detected, returning to listening');
      _state = VadState.listening;
      notifyListeners();
    });

    // Speech ended - this contains the captured audio samples
    _vadHandler!.onSpeechEnd.listen((List<double> samples) {
      debugPrint('[VAD] 🎤 onSpeechEnd fired - samples: ${samples.length}, paused: $_isPaused, enabled: $_isEnabled');
      if (_isPaused) {
        debugPrint('[VAD] ⏸️ Ignoring speech end - VAD is paused');
        return;
      }
      debugPrint('[VAD] ✅ Speech ended, captured ${samples.length} samples');

      _state = VadState.processing;
      notifyListeners();

      // Convert samples to WAV format for backend
      debugPrint('[VAD] 🔄 Converting ${samples.length} samples to WAV format...');
      final audioData = _samplesToWav(samples);
      debugPrint('[VAD] ✅ WAV conversion complete - ${audioData.length} bytes');

      if (onSpeechEnd != null) {
        debugPrint('[VAD] 📞 Calling onSpeechEnd callback with ${audioData.length} bytes');
        onSpeechEnd?.call(audioData);
      } else {
        debugPrint('[VAD] ⚠️⚠️⚠️ onSpeechEnd callback is NULL! Audio will be lost!');
      }

      // Return to listening state
      Future.delayed(const Duration(milliseconds: 500), () {
        if (_state == VadState.processing && _isEnabled && !_isPaused) {
          debugPrint('[VAD] 🔄 Returning to listening state');
          _state = VadState.listening;
          notifyListeners();
        }
      });
    });

    // Frame processed (for debugging/visualization)
    _vadHandler!.onFrameProcessed.listen((frameData) {
      // Can be used for real-time visualization
      // frameData has: isSpeech (double), notSpeech (double), frame (List<double>)
      // debugPrint('[VAD] Frame - Speech prob: ${frameData.isSpeech.toStringAsFixed(3)}, Not-speech: ${frameData.notSpeech.toStringAsFixed(3)}');
    });

    // Error handling
    _vadHandler!.onError.listen((String message) {
      debugPrint('[VAD] Error: $message');
      onError?.call(message);
    });
  }

  Future<void> _loadSettings() async {
    // Always enable VAD on startup - the toggle is for manual control during session
    // The saved setting is only used for debugging, not to persist disabled state
    _isEnabled = true;
    debugPrint('[VAD] Loaded settings - enabled: $_isEnabled (always enabled on startup)');
  }

  Future<void> saveSettings() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('vad_enabled', _isEnabled);
  }

  Future<void> startListening() async {
    if (!_isInitialized || _vadHandler == null) {
      debugPrint('[VAD] Cannot start - not initialized');
      return;
    }

    // Don't start if paused (e.g., during TTS playback)
    if (_isPaused) {
      debugPrint('[VAD] Cannot start - currently paused (paused: $_isPaused)');
      return;
    }

    // Don't check state here - allow restart even if state shows listening
    // This is needed for resume after pause which stops the handler
    debugPrint('[VAD] Starting VAD listening (current state: $_state, paused: $_isPaused)...');

    try {
      // Prepare parameters for VAD
      final vadParams = {
        // Silero VAD v5 model for better accuracy
        'model': 'v5',
        // 512 samples per frame for v5 model (32ms at 16kHz)
        'frameSamples': 512,
        // Speech detection thresholds (very sensitive for testing)
        'positiveSpeechThreshold': 0.2,
        'negativeSpeechThreshold': 0.15,
        // Minimum speech duration to avoid misfires (in frames)
        'minSpeechFrames': 2,
        // Pre-speech padding (in frames) to capture start of speech
        'preSpeechPadFrames': 5,
        // Redemption frames before considering speech ended
        'redemptionFrames': 8,
      };

      // Start listening - use CDN for model download
      // Note: The VAD library automatically caches the model after first download
      await _vadHandler!.startListening(
        model: vadParams['model'] as String,
        frameSamples: vadParams['frameSamples'] as int,
        positiveSpeechThreshold: vadParams['positiveSpeechThreshold'] as double,
        negativeSpeechThreshold: vadParams['negativeSpeechThreshold'] as double,
        minSpeechFrames: vadParams['minSpeechFrames'] as int,
        preSpeechPadFrames: vadParams['preSpeechPadFrames'] as int,
        redemptionFrames: vadParams['redemptionFrames'] as int,
      );

      // Check again if paused - initialization might have taken time
      if (_isPaused) {
        debugPrint('[VAD] Paused during initialization, stopping immediately');
        await _vadHandler!.stopListening();
        return;
      }

      _state = VadState.listening;
      onListeningStarted?.call();
      debugPrint('[VAD] VAD listening started');
      notifyListeners();
    } catch (e) {
      debugPrint('[VAD] Failed to start listening: $e');
      onError?.call('Failed to start VAD: $e');
    }
  }

  Future<void> stopListening() async {
    if (_vadHandler == null) return;
    if (_state == VadState.idle) {
      debugPrint('[VAD] Stop skipped - already idle');
      return;
    }
    if (_isTransitioning) {
      debugPrint('[VAD] Stop skipped - currently transitioning');
      return;
    }

    _isTransitioning = true;
    try {
      debugPrint('[VAD] Stopping VAD listening (current state: $_state)...');
      // Add delay to let in-flight frames complete
      await Future.delayed(const Duration(milliseconds: 100));
      await _vadHandler!.stopListening();
      _state = VadState.idle;
      _isPaused = false;
      debugPrint('[VAD] VAD listening stopped');
      notifyListeners();
    } catch (e) {
      debugPrint('[VAD] Failed to stop listening: $e');
      // Update state anyway to prevent stuck states
      _state = VadState.idle;
      _isPaused = false;
      notifyListeners();
    } finally {
      _isTransitioning = false;
    }
  }

  // Pause VAD temporarily (e.g., during TTS playback)
  Future<void> pause() async {
    if (!_isInitialized || _vadHandler == null) return;
    if (_isPaused) {
      debugPrint('[VAD] Pause skipped - already paused');
      return;
    }
    if (_isTransitioning) {
      debugPrint('[VAD] Pause skipped - already transitioning');
      return;
    }

    _isTransitioning = true;
    debugPrint('[VAD] Pausing VAD (current state: $_state)');
    _isPaused = true;

    // Always stop the VAD handler regardless of state
    // State might be out of sync with actual handler status
    try {
      // Add a small delay to let any in-flight audio frames complete
      await Future.delayed(const Duration(milliseconds: 100));
      await _vadHandler!.stopListening();
      debugPrint('[VAD] VAD handler stopped for pause');
    } catch (e) {
      debugPrint('[VAD] Error stopping VAD during pause: $e');
      // Don't rethrow - continue with state update
    }

    _state = VadState.idle;
    _isTransitioning = false;
    notifyListeners();
  }

  // Resume VAD after pause
  Future<void> resume() async {
    debugPrint('[VAD] resume() called - enabled: $_isEnabled, initialized: $_isInitialized, transitioning: $_isTransitioning, paused: $_isPaused, state: $_state');
    if (!_isEnabled || !_isInitialized || _vadHandler == null) {
      debugPrint('[VAD] Resume skipped - enabled: $_isEnabled, initialized: $_isInitialized, handler: ${_vadHandler != null}');
      return;
    }

    if (!_isPaused) {
      debugPrint('[VAD] Resume skipped - not paused (state: $_state)');
      return;
    }
    if (_isTransitioning) {
      debugPrint('[VAD] Resume skipped - already transitioning');
      return;
    }

    _isTransitioning = true;
    debugPrint('[VAD] Resuming VAD from pause');
    _isPaused = false;

    // Longer delay to ensure audio playback has fully released the mic
    // and the previous stop operation is complete
    await Future.delayed(const Duration(milliseconds: 800));

    // Start listening again - this will work even if state shows listening
    // because we actually stopped the handler during pause
    try {
      await startListening();
      debugPrint('[VAD] VAD resumed successfully');
    } catch (e) {
      debugPrint('[VAD] Error starting VAD during resume: $e');
      // Reset states on error
      _isPaused = false;
      _isTransitioning = false;
      _state = VadState.idle;
      notifyListeners();
      return;
    }

    _isTransitioning = false;
  }

  void setEnabled(bool enabled) {
    debugPrint('[VAD] setEnabled called with: $enabled (was: $_isEnabled)');
    _isEnabled = enabled;
    saveSettings();

    if (enabled && _isInitialized) {
      // Clear paused flag when manually enabling VAD
      _isPaused = false;
      startListening();
    } else if (!enabled) {
      stopListening();
    }

    notifyListeners();
  }

  // Convert float samples to WAV format (16-bit PCM)
  // VAD provides samples at 16kHz sample rate
  Uint8List _samplesToWav(List<double> samples) {
    final sampleRate = 16000;
    final numChannels = 1;
    final bitsPerSample = 16;
    final byteRate = sampleRate * numChannels * bitsPerSample ~/ 8;
    final blockAlign = numChannels * bitsPerSample ~/ 8;
    final dataSize = samples.length * 2; // 16-bit = 2 bytes per sample
    final fileSize = 36 + dataSize;

    final buffer = ByteData(44 + dataSize);
    var offset = 0;

    // RIFF header
    buffer.setUint8(offset++, 0x52); // 'R'
    buffer.setUint8(offset++, 0x49); // 'I'
    buffer.setUint8(offset++, 0x46); // 'F'
    buffer.setUint8(offset++, 0x46); // 'F'
    buffer.setUint32(offset, fileSize, Endian.little);
    offset += 4;
    buffer.setUint8(offset++, 0x57); // 'W'
    buffer.setUint8(offset++, 0x41); // 'A'
    buffer.setUint8(offset++, 0x56); // 'V'
    buffer.setUint8(offset++, 0x45); // 'E'

    // fmt chunk
    buffer.setUint8(offset++, 0x66); // 'f'
    buffer.setUint8(offset++, 0x6D); // 'm'
    buffer.setUint8(offset++, 0x74); // 't'
    buffer.setUint8(offset++, 0x20); // ' '
    buffer.setUint32(offset, 16, Endian.little); // Subchunk1Size
    offset += 4;
    buffer.setUint16(offset, 1, Endian.little); // AudioFormat (PCM)
    offset += 2;
    buffer.setUint16(offset, numChannels, Endian.little);
    offset += 2;
    buffer.setUint32(offset, sampleRate, Endian.little);
    offset += 4;
    buffer.setUint32(offset, byteRate, Endian.little);
    offset += 4;
    buffer.setUint16(offset, blockAlign, Endian.little);
    offset += 2;
    buffer.setUint16(offset, bitsPerSample, Endian.little);
    offset += 2;

    // data chunk
    buffer.setUint8(offset++, 0x64); // 'd'
    buffer.setUint8(offset++, 0x61); // 'a'
    buffer.setUint8(offset++, 0x74); // 't'
    buffer.setUint8(offset++, 0x61); // 'a'
    buffer.setUint32(offset, dataSize, Endian.little);
    offset += 4;

    // Audio samples (convert float -1.0 to 1.0 to 16-bit PCM)
    for (final sample in samples) {
      // Clamp to -1.0 to 1.0 range
      final clamped = sample.clamp(-1.0, 1.0);
      // Convert to 16-bit signed integer
      final intSample = (clamped * 32767).round().clamp(-32768, 32767);
      buffer.setInt16(offset, intSample, Endian.little);
      offset += 2;
    }

    return buffer.buffer.asUint8List();
  }

  @override
  void dispose() {
    _vadHandler?.dispose();
    super.dispose();
  }
}
