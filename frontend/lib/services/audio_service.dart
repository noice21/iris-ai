import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:permission_handler/permission_handler.dart';

enum RecordingState { idle, recording, processing }

enum PlaybackState { idle, loading, playing, paused }

class AudioService extends ChangeNotifier {
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();

  RecordingState _recordingState = RecordingState.idle;
  PlaybackState _playbackState = PlaybackState.idle;
  bool _hasPermission = false;

  // Audio data
  final List<Uint8List> _audioQueue = [];
  Uint8List? _currentRecording;

  // Audio buffer for streaming TTS
  final List<int> _audioBuffer = [];
  bool _isBuffering = false;

  // Completer to wait for playback completion
  Completer<void>? _playbackCompleter;

  // Amplitude for visualizer
  double _currentAmplitude = 0.0;
  Timer? _amplitudeTimer;

  // Getters
  RecordingState get recordingState => _recordingState;
  PlaybackState get playbackState => _playbackState;
  bool get hasPermission => _hasPermission;
  bool get isRecording => _recordingState == RecordingState.recording;
  bool get isPlaying => _playbackState == PlaybackState.playing;
  double get currentAmplitude => _currentAmplitude;
  Uint8List? get currentRecording => _currentRecording;

  AudioService() {
    _initPlayer();
  }

  void _initPlayer() {
    // Use onPlayerComplete for more reliable completion detection
    _player.onPlayerComplete.listen((_) {
      debugPrint('Audio playback completed (onPlayerComplete)');
      _playbackState = PlaybackState.idle;
      // Complete the playback completer if waiting
      if (_playbackCompleter != null && !_playbackCompleter!.isCompleted) {
        _playbackCompleter!.complete();
      }
      _playNextInQueue();
      notifyListeners();
    });

    _player.onPlayerStateChanged.listen((state) {
      debugPrint('Player state changed: $state');
      if (state == PlayerState.playing) {
        _playbackState = PlaybackState.playing;
        notifyListeners();
      } else if (state == PlayerState.stopped) {
        _playbackState = PlaybackState.idle;
        // Complete the playback completer if waiting
        if (_playbackCompleter != null && !_playbackCompleter!.isCompleted) {
          _playbackCompleter!.complete();
        }
        notifyListeners();
      }
    });
  }

  Future<bool> requestPermission() async {
    final status = await Permission.microphone.request();
    _hasPermission = status.isGranted;
    notifyListeners();
    return _hasPermission;
  }

  Future<bool> checkPermission() async {
    _hasPermission = await Permission.microphone.isGranted;
    notifyListeners();
    return _hasPermission;
  }

  Future<void> startRecording() async {
    if (!_hasPermission) {
      final granted = await requestPermission();
      if (!granted) return;
    }

    if (_recordingState == RecordingState.recording) return;

    try {
      final dir = await getTemporaryDirectory();
      final filePath = p.join(dir.path, 'iris_recording.webm');

      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.opus,
          bitRate: 64000,
          sampleRate: 16000,
          numChannels: 1,
        ),
        path: filePath,
      );

      _recordingState = RecordingState.recording;
      _startAmplitudeMonitor();
      notifyListeners();
    } catch (e) {
      debugPrint('Failed to start recording: $e');
    }
  }

  void _startAmplitudeMonitor() {
    _amplitudeTimer?.cancel();
    _amplitudeTimer = Timer.periodic(const Duration(milliseconds: 100), (_) async {
      try {
        final amplitude = await _recorder.getAmplitude();
        // Normalize amplitude to 0-1 range
        _currentAmplitude = ((amplitude.current + 50) / 50).clamp(0.0, 1.0);
        notifyListeners();
      } catch (e) {
        // Ignore amplitude errors
      }
    });
  }

  Future<Uint8List?> stopRecording() async {
    if (_recordingState != RecordingState.recording) return null;

    _amplitudeTimer?.cancel();
    _currentAmplitude = 0.0;
    _recordingState = RecordingState.processing;
    notifyListeners();

    try {
      final path = await _recorder.stop();
      if (path != null) {
        final file = File(path);
        _currentRecording = await file.readAsBytes();
        await file.delete();
      }

      _recordingState = RecordingState.idle;
      notifyListeners();
      return _currentRecording;
    } catch (e) {
      debugPrint('Failed to stop recording: $e');
      _recordingState = RecordingState.idle;
      notifyListeners();
      return null;
    }
  }

  Future<void> cancelRecording() async {
    if (_recordingState != RecordingState.recording) return;

    _amplitudeTimer?.cancel();
    _currentAmplitude = 0.0;

    try {
      final path = await _recorder.stop();
      if (path != null) {
        final file = File(path);
        await file.delete();
      }
    } catch (e) {
      debugPrint('Failed to cancel recording: $e');
    }

    _recordingState = RecordingState.idle;
    notifyListeners();
  }

  // Start buffering audio chunks (call when synthesis starts)
  void startBuffering() {
    _audioBuffer.clear();
    _isBuffering = true;
    debugPrint('Started audio buffering');
  }

  // Add audio chunk to buffer
  void bufferAudioChunk(Uint8List audioData) {
    if (_isBuffering) {
      _audioBuffer.addAll(audioData);
      debugPrint('Buffered ${audioData.length} bytes, total: ${_audioBuffer.length}');
    }
  }

  // Finish buffering and play the complete audio
  // Returns a Future that completes when playback finishes
  Future<void> finishBufferingAndPlay() async {
    if (!_isBuffering || _audioBuffer.isEmpty) {
      debugPrint('No audio to play (buffering: $_isBuffering, size: ${_audioBuffer.length})');
      _isBuffering = false;
      return;
    }

    _isBuffering = false;
    final completeAudio = Uint8List.fromList(_audioBuffer);
    _audioBuffer.clear();

    debugPrint('Playing complete audio: ${completeAudio.length} bytes');

    // Create a completer to wait for playback to finish
    _playbackCompleter = Completer<void>();

    await playAudio(completeAudio);

    // Estimate max duration based on MP3 bitrate (128kbps = 16000 bytes/sec)
    // Use 3x estimate as timeout ceiling so we don't cut off early
    final estimatedDurationMs = (completeAudio.length / 16000 * 1000).round();
    final timeoutMs = estimatedDurationMs * 3 + 2000;
    debugPrint('Estimated audio duration: ${estimatedDurationMs}ms, timeout: ${timeoutMs}ms');

    // Wait for playback to complete via onPlayerComplete callback
    // Timeout is a generous safety net — we prefer the callback to fire naturally
    try {
      await _playbackCompleter!.future.timeout(
        Duration(milliseconds: timeoutMs),
        onTimeout: () {
          debugPrint('Playback wait timed out after ${timeoutMs}ms - assuming complete');
        },
      );
    } catch (e) {
      debugPrint('Error waiting for playback: $e');
    }

    // Extra delay to ensure audio device is fully released before VAD grabs the mic
    await Future.delayed(const Duration(milliseconds: 500));
    debugPrint('Audio playback finished');
  }

  // Queue audio for playback (legacy method for non-streaming)
  void queueAudio(Uint8List audioData) {
    _audioQueue.add(audioData);
    if (_playbackState == PlaybackState.idle) {
      _playNextInQueue();
    }
  }

  Future<void> _playNextInQueue() async {
    if (_audioQueue.isEmpty) {
      _playbackState = PlaybackState.idle;
      notifyListeners();
      return;
    }

    final audioData = _audioQueue.removeAt(0);
    await playAudio(audioData);
  }

  Future<void> playAudio(Uint8List audioData) async {
    try {
      _playbackState = PlaybackState.loading;
      notifyListeners();

      // Save to temp file and play
      final dir = await getTemporaryDirectory();
      final filePath = p.join(dir.path, 'iris_playback_${DateTime.now().millisecondsSinceEpoch}.mp3');
      final file = File(filePath);
      await file.writeAsBytes(audioData);

      debugPrint('Playing audio file: $filePath');
      await _player.play(DeviceFileSource(filePath));

      // Clean up file after playing
      Future.delayed(const Duration(seconds: 30), () {
        file.delete().ignore();
      });
    } catch (e) {
      debugPrint('Failed to play audio: $e');
      _playbackState = PlaybackState.idle;
      notifyListeners();
    }
  }

  Future<void> stopPlayback() async {
    await _player.stop();
    _audioQueue.clear();
    _playbackState = PlaybackState.idle;
    notifyListeners();
  }

  Future<void> pausePlayback() async {
    await _player.pause();
    _playbackState = PlaybackState.paused;
    notifyListeners();
  }

  Future<void> resumePlayback() async {
    await _player.resume();
    _playbackState = PlaybackState.playing;
    notifyListeners();
  }

  @override
  void dispose() {
    _amplitudeTimer?.cancel();
    _recorder.dispose();
    _player.dispose();
    super.dispose();
  }
}
