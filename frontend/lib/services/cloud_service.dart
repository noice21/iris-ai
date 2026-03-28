import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Cloud service for Make.com + Gemini integration
/// Replaces local backend with cloud-based processing
class CloudService extends ChangeNotifier {
  // Make.com webhook URL - set this to your webhook URL
  String _webhookUrl = '';

  // Connection state
  bool _isProcessing = false;
  bool _isConnected = false;
  String? _userId;
  String? _conversationId;

  // Stream controllers (same interface as WebSocket service)
  final _transcriptController = StreamController<String>.broadcast();
  final _responseController = StreamController<String>.broadcast();
  final _audioController = StreamController<Uint8List>.broadcast();
  final _imageController = StreamController<GeneratedImage>.broadcast();

  // Getters
  bool get isProcessing => _isProcessing;
  bool get isConnected => _isConnected;
  String? get userId => _userId;
  String? get conversationId => _conversationId;
  String get webhookUrl => _webhookUrl;

  Stream<String> get transcriptStream => _transcriptController.stream;
  Stream<String> get responseStream => _responseController.stream;
  Stream<Uint8List> get audioStream => _audioController.stream;
  Stream<GeneratedImage> get imageStream => _imageController.stream;

  // Response building
  final StringBuffer _currentResponse = StringBuffer();
  String get currentResponse => _currentResponse.toString();

  // Thinking state
  bool _isThinking = false;
  String _thinkingMessage = '';
  bool get isThinking => _isThinking;
  String get thinkingMessage => _thinkingMessage;

  /// Set the Make.com webhook URL
  void setWebhookUrl(String url) {
    _webhookUrl = url;
    _isConnected = url.isNotEmpty;
    notifyListeners();
  }

  /// Set user ID for conversation tracking
  void setUserId(String id) {
    _userId = id;
    notifyListeners();
  }

  /// Initialize the service (simulates connection)
  Future<void> connect({String? deviceId}) async {
    if (deviceId != null) {
      _userId = deviceId;
    }
    _isConnected = _webhookUrl.isNotEmpty;
    notifyListeners();
    debugPrint('[Cloud] Service initialized, webhook: $_webhookUrl');
  }

  /// Send audio to Make.com for processing
  /// Flow: Audio -> Make.com -> Gemini STT -> Gemini LLM -> Gemini TTS -> Response
  Future<void> processAudio(Uint8List audioData) async {
    if (_webhookUrl.isEmpty) {
      debugPrint('[Cloud] Error: Webhook URL not set');
      return;
    }

    _isProcessing = true;
    _isThinking = true;
    _thinkingMessage = 'Processing audio...';
    _currentResponse.clear();
    notifyListeners();

    try {
      // Convert audio to base64
      final audioBase64 = base64Encode(audioData);
      debugPrint('[Cloud] Sending ${audioData.length} bytes of audio to Make.com');

      // Send to Make.com webhook
      final response = await http.post(
        Uri.parse(_webhookUrl),
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'type': 'audio',
          'audio': audioBase64,
          'userId': _userId,
          'conversationId': _conversationId,
        }),
      );

      if (response.statusCode == 200) {
        await _handleResponse(response.body);
      } else {
        debugPrint('[Cloud] Error: ${response.statusCode} - ${response.body}');
        _isThinking = false;
        _thinkingMessage = '';
      }
    } catch (e) {
      debugPrint('[Cloud] Error processing audio: $e');
      _isThinking = false;
      _thinkingMessage = '';
    } finally {
      _isProcessing = false;
      notifyListeners();
    }
  }

  /// Send text message to Make.com
  Future<void> sendTextMessage(String text) async {
    if (_webhookUrl.isEmpty) {
      debugPrint('[Cloud] Error: Webhook URL not set');
      return;
    }

    _isProcessing = true;
    _isThinking = true;
    _thinkingMessage = 'Thinking...';
    _currentResponse.clear();
    notifyListeners();

    try {
      debugPrint('[Cloud] Sending text message: $text');

      final response = await http.post(
        Uri.parse(_webhookUrl),
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'type': 'text',
          'text': text,
          'userId': _userId,
          'conversationId': _conversationId,
        }),
      );

      if (response.statusCode == 200) {
        await _handleResponse(response.body);
      } else {
        debugPrint('[Cloud] Error: ${response.statusCode} - ${response.body}');
        _isThinking = false;
        _thinkingMessage = '';
      }
    } catch (e) {
      debugPrint('[Cloud] Error sending text: $e');
      _isThinking = false;
      _thinkingMessage = '';
    } finally {
      _isProcessing = false;
      notifyListeners();
    }
  }

  /// Handle response from Make.com
  Future<void> _handleResponse(String responseBody) async {
    try {
      final data = jsonDecode(responseBody);

      // Handle transcript (what user said)
      if (data['transcript'] != null) {
        final transcript = data['transcript'] as String;
        debugPrint('[Cloud] Transcript: $transcript');
        _transcriptController.add(transcript);
      }

      // Handle text response from LLM
      if (data['response'] != null) {
        final response = data['response'] as String;
        debugPrint('[Cloud] Response: $response');
        _currentResponse.clear();
        _currentResponse.write(response);
        _responseController.add(response);
        _isThinking = false;
        _thinkingMessage = '';
      }

      // Handle audio response (TTS)
      if (data['audio'] != null) {
        final audioBase64 = data['audio'] as String;
        final audioBytes = base64Decode(audioBase64);
        debugPrint('[Cloud] Received ${audioBytes.length} bytes of audio');
        _audioController.add(audioBytes);
      }

      // Handle conversation ID for memory
      if (data['conversationId'] != null) {
        _conversationId = data['conversationId'] as String;
      }

      // Handle generated images
      if (data['image'] != null) {
        final imageData = data['image'];
        final generatedImage = GeneratedImage(
          base64: imageData['base64'] ?? '',
          prompt: imageData['prompt'] ?? '',
          filename: imageData['filename'] ?? 'generated.png',
          width: imageData['width'] ?? 1024,
          height: imageData['height'] ?? 1024,
          seed: imageData['seed'] ?? 0,
        );
        _imageController.add(generatedImage);
        debugPrint('[Cloud] Received generated image');
      }

      notifyListeners();
    } catch (e) {
      debugPrint('[Cloud] Error parsing response: $e');
      _isThinking = false;
      _thinkingMessage = '';
      notifyListeners();
    }
  }

  /// Request a greeting (for app startup)
  Future<void> requestGreeting() async {
    await sendTextMessage('Hello! Please greet me.');
  }

  /// Disconnect (cleanup)
  void disconnect() {
    _isConnected = false;
    _userId = null;
    _conversationId = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _transcriptController.close();
    _responseController.close();
    _audioController.close();
    _imageController.close();
    super.dispose();
  }
}

/// Data class for generated images (same as WebSocket service)
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
