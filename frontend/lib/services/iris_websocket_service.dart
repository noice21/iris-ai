import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:flutter/foundation.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

enum IrisConnectionState { disconnected, connecting, connected, error }

class IrisMessage {
  final String type;
  final Map<String, dynamic>? data;
  final Uint8List? binaryData;

  IrisMessage({required this.type, this.data, this.binaryData});

  factory IrisMessage.fromJson(Map<String, dynamic> json) {
    return IrisMessage(type: json['type'] ?? '', data: json);
  }
}

class IrisWebSocketService extends ChangeNotifier {
  WebSocketChannel? _channel;
  IrisConnectionState _connectionState = IrisConnectionState.disconnected;
  String? _sessionId;
  String? _userId;
  String? _conversationId;

  // Server URL configuration
  static const String _localUrl = 'ws://192.168.68.62:3001/ws';
  static const String _tailscaleUrl =
      'ws://100.71.195.127:3001/ws'; // Tailscale IP from iris-tailscale-proxy
  bool _useTailscale = false;
  String get _serverUrl => _useTailscale ? _tailscaleUrl : _localUrl;

  // Reconnection state
  bool _shouldReconnect = true;
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 5;
  static const Duration _initialReconnectDelay = Duration(seconds: 2);

  // Heartbeat/keepalive
  Timer? _heartbeatTimer;
  static const Duration _heartbeatInterval = Duration(seconds: 30);

  // Stream controllers
  final _messageController = StreamController<IrisMessage>.broadcast();
  final _audioController = StreamController<Uint8List>.broadcast();
  final _transcriptController = StreamController<String>.broadcast();
  final _responseController = StreamController<String>.broadcast();
  final _imageController = StreamController<GeneratedImage>.broadcast();

  // Getters
  IrisConnectionState get connectionState => _connectionState;
  String? get sessionId => _sessionId;
  String? get userId => _userId;
  String? get conversationId => _conversationId;
  Stream<IrisMessage> get messageStream => _messageController.stream;
  Stream<Uint8List> get audioStream => _audioController.stream;
  Stream<String> get transcriptStream => _transcriptController.stream;
  Stream<String> get responseStream => _responseController.stream;
  Stream<GeneratedImage> get imageStream => _imageController.stream;
  bool get useTailscale => _useTailscale;
  String get currentServerUrl => _serverUrl;

  // Response building
  final StringBuffer _currentResponse = StringBuffer();
  String get currentResponse => _currentResponse.toString();

  // Thinking/processing state
  bool _isThinking = false;
  String _thinkingMessage = '';
  bool get isThinking => _isThinking;
  String get thinkingMessage => _thinkingMessage;

  // Set whether to use Tailscale or local connection
  void setUseTailscale(bool enabled) {
    _useTailscale = enabled;
    notifyListeners();
  }

  // Auto-detect best connection (try local first, fallback to Tailscale)
  Future<void> connectWithAutoDetect({String? deviceId}) async {
    try {
      // Try local first
      _useTailscale = false;
      debugPrint('Attempting local connection...');
      await connect(deviceId: deviceId);
    } catch (e) {
      debugPrint('Local connection failed, trying Tailscale...');
      try {
        _useTailscale = true;
        await connect(deviceId: deviceId);
      } catch (e2) {
        debugPrint('Both local and Tailscale connections failed');
        rethrow;
      }
    }
  }

  Future<void> connect({String? deviceId}) async {
    if (_connectionState == IrisConnectionState.connecting ||
        _connectionState == IrisConnectionState.connected) {
      return;
    }

    _connectionState = IrisConnectionState.connecting;
    notifyListeners();

    try {
      final uri = deviceId != null
          ? Uri.parse('$_serverUrl?deviceId=$deviceId')
          : Uri.parse(_serverUrl);

      _channel = WebSocketChannel.connect(uri);

      await _channel!.ready;

      _connectionState = IrisConnectionState.connected;
      _reconnectAttempts =
          0; // Reset reconnect attempts on successful connection
      notifyListeners();

      // Enable wake lock to keep connection alive during sleep
      try {
        await WakelockPlus.enable();
        debugPrint('[WS] Wake lock enabled');
      } catch (e) {
        debugPrint('[WS] Failed to enable wake lock: $e');
      }

      // Start heartbeat to keep connection alive
      _startHeartbeat();

      _channel!.stream.listen(
        _handleMessage,
        onError: _handleError,
        onDone: _handleDone,
      );
    } catch (e) {
      _connectionState = IrisConnectionState.error;
      notifyListeners();
      debugPrint('WebSocket connection error: $e');
      _attemptReconnect();
    }
  }

  void _handleMessage(dynamic message) {
    if (message is String) {
      debugPrint('WS Received: $message');
      try {
        final json = jsonDecode(message);
        final irisMessage = IrisMessage.fromJson(json);
        _processMessage(irisMessage);
      } catch (e) {
        debugPrint('Failed to parse message: $e');
      }
    } else if (message is List<int>) {
      // Binary audio data
      debugPrint('WS Received audio: ${message.length} bytes');
      final audioData = Uint8List.fromList(message);
      _audioController.add(audioData);
    }
  }

  void _processMessage(IrisMessage message) {
    _messageController.add(message);

    switch (message.type) {
      case 'connected':
        _sessionId = message.data?['sessionId'];
        _userId = message.data?['userId'];
        _conversationId = message.data?['conversationId'];
        notifyListeners();
        break;

      case 'transcript':
        final text = message.data?['text'] ?? '';
        debugPrint('[WS] ✅ Received transcript: "$text" (length: ${text.length})');
        if (text.isEmpty) {
          debugPrint('[WS] ⚠️ WARNING: Backend returned EMPTY transcript! STT failed.');
        }
        _transcriptController.add(text);
        // Start thinking after we get the transcript
        _isThinking = true;
        _thinkingMessage = 'Thinking...';
        notifyListeners();
        break;

      case 'generating_response':
        _isThinking = true;
        _thinkingMessage = 'Generating response...';
        notifyListeners();
        break;

      case 'tool_use':
        final toolName = message.data?['tool'] ?? 'tool';
        _isThinking = true;
        _thinkingMessage = _getToolThinkingMessage(toolName);
        notifyListeners();
        break;

      case 'image_generated':
        final imageData = message.data?['image'];
        if (imageData != null) {
          final generatedImage = GeneratedImage(
            base64: imageData['base64'] ?? '',
            prompt: imageData['prompt'] ?? '',
            filename: imageData['filename'] ?? '',
            width: imageData['size']?['width'] ?? 832,
            height: imageData['size']?['height'] ?? 832,
            seed: imageData['seed'] ?? 0,
          );
          _imageController.add(generatedImage);
          debugPrint('[WS] Received generated image: ${generatedImage.filename}');
        }
        break;

      case 'response_token':
        final token = message.data?['token'] ?? '';
        _currentResponse.write(token);
        _responseController.add(_currentResponse.toString());
        // Stop thinking when we start getting response tokens
        _isThinking = false;
        _thinkingMessage = '';
        notifyListeners();
        break;

      case 'response_complete':
        _currentResponse.clear();
        _currentResponse.write(message.data?['text'] ?? '');
        _conversationId = message.data?['conversationId'];
        _isThinking = false;
        _thinkingMessage = '';
        notifyListeners();
        break;

      case 'user_identified':
        _userId = message.data?['userId'];
        _conversationId = message.data?['conversationId'];
        notifyListeners();
        break;

      case 'processing_started':
        debugPrint('[WS] ✅ Backend started processing audio');
        break;

      case 'transcribing':
        debugPrint('[WS] 🎙️ Backend transcribing audio (STT)...');
        break;

      case 'error':
        final errorMsg = message.data?['error'] ?? 'Unknown error';
        debugPrint('[WS] ❌ Server error: $errorMsg');
        // Show error to user
        _isThinking = false;
        _thinkingMessage = '';
        notifyListeners();
        break;
    }
  }

  void _handleError(Object error) {
    debugPrint('WebSocket error: $error');
    _connectionState = IrisConnectionState.error;
    notifyListeners();
    _attemptReconnect();
  }

  void _handleDone() {
    debugPrint('WebSocket connection closed');
    _connectionState = IrisConnectionState.disconnected;
    _sessionId = null;
    notifyListeners();
    _attemptReconnect();
  }

  void _attemptReconnect() async {
    if (!_shouldReconnect || _reconnectAttempts >= _maxReconnectAttempts) {
      debugPrint(
        'Not reconnecting (attempts: $_reconnectAttempts, shouldReconnect: $_shouldReconnect)',
      );
      return;
    }

    _reconnectAttempts++;
    final delay = _initialReconnectDelay * _reconnectAttempts;
    debugPrint(
      'Attempting reconnect in ${delay.inSeconds}s (attempt $_reconnectAttempts/$_maxReconnectAttempts)',
    );

    await Future.delayed(delay);

    if (_shouldReconnect && _connectionState != IrisConnectionState.connected) {
      debugPrint('Reconnecting...');
      try {
        await connect();
        _reconnectAttempts = 0; // Reset on successful connection
      } catch (e) {
        debugPrint('Reconnection failed: $e');
      }
    }
  }

  // Send text message
  void sendTextMessage(String text) {
    _currentResponse.clear();
    _sendJson({'type': 'text_input', 'text': text});
  }

  // Start audio recording
  void startRecording() {
    debugPrint('[WS] 📤 startRecording() - sending start_recording message');
    debugPrint(
      '[WS] Connection state: $_connectionState, channel: ${_channel != null ? 'OPEN' : 'NULL'}',
    );
    _currentResponse.clear();
    _sendJson({'type': 'start_recording'});
    debugPrint('[WS] ✅ start_recording message sent');
  }

  // Stop audio recording
  void stopRecording() {
    debugPrint('[WS] 📤 stopRecording() - sending stop_recording message');
    _sendJson({'type': 'stop_recording'});
    debugPrint('[WS] ✅ stop_recording message sent');
  }

  // Send audio chunk
  void sendAudioChunk(Uint8List audioData) {
    debugPrint(
      '[WS] 📤 sendAudioChunk() - sending ${audioData.length} bytes of binary audio data',
    );
    debugPrint(
      '[WS] Connection state: $_connectionState, channel: ${_channel != null ? 'OPEN' : 'NULL'}',
    );
    if (_channel == null) {
      debugPrint('[WS] ⚠️⚠️⚠️ Cannot send audio - WebSocket channel is NULL!');
      return;
    }
    _channel?.sink.add(audioData);
    debugPrint('[WS] ✅ Binary audio data sent to WebSocket');
  }

  // Set device ID for memory persistence
  void setDeviceId(String deviceId) {
    _sendJson({'type': 'set_device_id', 'deviceId': deviceId});
  }

  // Request startup greeting from Iris
  void requestGreeting() {
    _sendJson({'type': 'request_greeting'});
  }

  // Start new conversation
  void startNewConversation() {
    _currentResponse.clear();
    _sendJson({'type': 'new_conversation'});
  }

  // Send ping
  void ping() {
    _sendJson({'type': 'ping'});
  }

  // Start heartbeat to keep connection alive
  void _startHeartbeat() {
    _stopHeartbeat(); // Stop any existing timer
    _heartbeatTimer = Timer.periodic(_heartbeatInterval, (timer) {
      if (_connectionState == IrisConnectionState.connected) {
        debugPrint('[WS] Sending heartbeat ping');
        ping();
      }
    });
    debugPrint('[WS] Heartbeat started (interval: ${_heartbeatInterval.inSeconds}s)');
  }

  // Stop heartbeat
  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  // Set STT enabled/disabled
  void setSTTEnabled(bool enabled) {
    _sendJson({'type': 'set_stt_enabled', 'enabled': enabled});
  }

  // Set TTS enabled/disabled
  void setTTSEnabled(bool enabled) {
    _sendJson({'type': 'set_tts_enabled', 'enabled': enabled});
  }

  // Set TTS voice
  void setVoice(String voiceId) {
    _sendJson({'type': 'set_voice', 'voice': voiceId});
  }

  void _sendJson(Map<String, dynamic> data) {
    if (_connectionState == IrisConnectionState.connected) {
      final json = jsonEncode(data);
      debugPrint('WS Sending: $json');
      _channel?.sink.add(json);
    } else {
      debugPrint('WS Not connected, cannot send: ${data['type']}');
    }
  }

  Future<void> disconnect() async {
    _shouldReconnect = false; // Disable auto-reconnect on manual disconnect
    _stopHeartbeat(); // Stop heartbeat timer

    // Disable wake lock when disconnecting
    try {
      await WakelockPlus.disable();
      debugPrint('[WS] Wake lock disabled');
    } catch (e) {
      debugPrint('[WS] Failed to disable wake lock: $e');
    }

    await _channel?.sink.close();
    _channel = null;
    _connectionState = IrisConnectionState.disconnected;
    _sessionId = null;
    notifyListeners();
  }

  String _getToolThinkingMessage(String toolName) {
    switch (toolName) {
      case 'search_web':
        return 'Searching the web...';
      case 'generate_image':
        return 'Generating image...';
      case 'get_media_containers':
      case 'get_container_stats':
      case 'get_all_container_stats':
        return 'Checking media server...';
      case 'restart_container':
        return 'Restarting container...';
      case 'list_running_processes':
        return 'Checking processes...';
      case 'kill_process':
      case 'start_program':
      case 'restart_program':
        return 'Managing program...';
      default:
        return 'Processing...';
    }
  }

  @override
  void dispose() {
    _stopHeartbeat(); // Stop heartbeat timer
    _messageController.close();
    _audioController.close();
    _transcriptController.close();
    _responseController.close();
    _imageController.close();
    disconnect();
    super.dispose();
  }
}

// Data class for generated images
class GeneratedImage {
  final String base64;
  final String prompt;
  final String filename;
  final int width;
  final int height;
  final int seed;

  GeneratedImage({
    required this.base64,
    required this.prompt,
    required this.filename,
    required this.width,
    required this.height,
    required this.seed,
  });
}
