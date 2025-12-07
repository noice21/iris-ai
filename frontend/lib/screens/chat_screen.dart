import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:device_info_plus/device_info_plus.dart';
import '../services/iris_websocket_service.dart';
import '../services/audio_service.dart';
import '../services/vad_service.dart';
import '../widgets/audio_visualizer.dart';
import '../widgets/image_model_selector.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _textController = TextEditingController();
  final List<ChatMessage> _messages = [];
  final ScrollController _scrollController = ScrollController();
  bool _showChatLog = true;
  bool _sttEnabled = true;
  bool _ttsEnabled = true;
  String _selectedVoice = 'af_bella'; // Default Kokoro voice

  // Available Kokoro voices
  final List<Map<String, String>> _availableVoices = [
    {'id': 'af', 'name': 'American Female'},
    {'id': 'af_bella', 'name': 'Bella (Expressive)'},
    {'id': 'af_sarah', 'name': 'Sarah (Calm)'},
    {'id': 'af_nicole', 'name': 'Nicole'},
    {'id': 'af_sky', 'name': 'Sky'},
    {'id': 'af_alloy', 'name': 'Alloy'},
    {'id': 'am_adam', 'name': 'Adam (Confident)'},
    {'id': 'am_michael', 'name': 'Michael (Professional)'},
    {'id': 'bf_emma', 'name': 'Emma (British)'},
    {'id': 'bm_george', 'name': 'George (British Male)'},
  ];

  @override
  void initState() {
    super.initState();
    _loadSettings();
    _requestPermissions();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _setupListeners();
    });
  }

  Future<void> _requestPermissions() async {
    // Request microphone permission for voice recording
    final micStatus = await Permission.microphone.request();
    if (micStatus.isDenied) {
      debugPrint('[ChatScreen] Microphone permission denied');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Microphone permission is required for voice input'),
            duration: Duration(seconds: 3),
          ),
        );
      }
    } else if (micStatus.isPermanentlyDenied) {
      debugPrint('[ChatScreen] Microphone permission permanently denied');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Please enable microphone permission in Settings'),
            action: SnackBarAction(
              label: 'Settings',
              onPressed: () => openAppSettings(),
            ),
            duration: const Duration(seconds: 5),
          ),
        );
      }
    }
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _sttEnabled = prefs.getBool('stt_enabled') ?? true;
      _ttsEnabled = prefs.getBool('tts_enabled') ?? true;
    });
  }

  Future<void> _saveSettings() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('stt_enabled', _sttEnabled);
    await prefs.setBool('tts_enabled', _ttsEnabled);
  }

  void _toggleSTT() {
    setState(() {
      _sttEnabled = !_sttEnabled;
    });
    _saveSettings();

    // Send to backend
    final wsService = context.read<IrisWebSocketService>();
    wsService.setSTTEnabled(_sttEnabled);
    debugPrint('[Chat] STT ${_sttEnabled ? 'enabled' : 'disabled'}');
  }

  void _toggleTTS() {
    setState(() {
      _ttsEnabled = !_ttsEnabled;
    });
    _saveSettings();

    // Send to backend
    final wsService = context.read<IrisWebSocketService>();
    wsService.setTTSEnabled(_ttsEnabled);
    debugPrint('[Chat] TTS ${_ttsEnabled ? 'enabled' : 'disabled'}');
  }

  void _setupListeners() {
    debugPrint('[ChatScreen] 🔧 Setting up listeners...');
    final wsService = context.read<IrisWebSocketService>();
    final audioService = context.read<AudioService>();
    final vadService = context.read<VadService>();

    // Initialize VAD (but don't start listening yet - wait for greeting)
    debugPrint('[ChatScreen] 🔄 Initializing VAD service...');
    vadService.initialize();

    // Set up VAD callbacks
    debugPrint('[ChatScreen] 📞 Setting up VAD callbacks...');
    vadService.onSpeechStart = () {
      debugPrint('[ChatScreen] 🗣️ VAD onSpeechStart callback fired');
    };

    // Check if already connected (connection may have completed before listeners were set up)
    if (wsService.connectionState == IrisConnectionState.connected) {
      debugPrint('[ChatScreen] ✅ Already connected to Iris - requesting greeting');
      Future.delayed(const Duration(milliseconds: 500), () async {
        await vadService.pause();
        wsService.requestGreeting();
      });
    }

    vadService.onSpeechEnd = (audioData) async {
      // Speech ended - send audio to backend for STT via ElevenLabs
      debugPrint('[ChatScreen] 🎤 VAD onSpeechEnd callback fired - received ${audioData.length} bytes');

      // Check if audio data is valid
      if (audioData.isEmpty) {
        debugPrint('[ChatScreen] ⚠️ WARNING: Audio data is EMPTY! VAD captured nothing.');
        return;
      }

      // Log first few bytes to verify audio data (check WAV header)
      if (audioData.length >= 44) {
        final header = String.fromCharCodes(audioData.sublist(0, 4));
        debugPrint('[ChatScreen] 📊 WAV header: $header (should be "RIFF")');
        final preview = audioData.sublist(44, audioData.length > 64 ? 64 : audioData.length).toList();
        debugPrint('[ChatScreen] 📊 Audio samples preview (bytes 44-64): ${preview.take(20)}');
      } else {
        debugPrint('[ChatScreen] ⚠️ Audio data too small: ${audioData.length} bytes (WAV needs at least 44 bytes for header)');
      }

      debugPrint('[ChatScreen] 📤 Sending audio to WebSocket...');
      debugPrint('[ChatScreen] 🔄 Step 1: Calling wsService.startRecording()...');
      wsService.startRecording();
      // Small delay to ensure start_recording is processed before audio
      await Future.delayed(const Duration(milliseconds: 50));
      debugPrint('[ChatScreen] 🔄 Step 2: Calling wsService.sendAudioChunk(${audioData.length} bytes)...');
      wsService.sendAudioChunk(audioData);
      // Small delay to ensure audio chunk is processed before stop_recording
      await Future.delayed(const Duration(milliseconds: 50));
      debugPrint('[ChatScreen] 🔄 Step 3: Calling wsService.stopRecording()...');
      wsService.stopRecording();
      debugPrint('[ChatScreen] ✅ Audio transmission sequence complete');
    };

    debugPrint('[ChatScreen] ✅ VAD callbacks configured - onSpeechEnd is ${vadService.onSpeechEnd != null ? 'SET' : 'NULL'}');

    vadService.onError = (error) {
      debugPrint('VAD Error: $error');
    };

    // Listen for transcripts from backend (ElevenLabs STT)
    wsService.transcriptStream.listen((transcript) {
      setState(() {
        _messages.add(
          ChatMessage(
            text: transcript,
            isUser: true,
            timestamp: DateTime.now(),
          ),
        );
      });
      _scrollToBottom();
    });

    // Listen for generated images
    wsService.imageStream.listen((generatedImage) {
      setState(() {
        _messages.add(
          ChatMessage(
            text: 'Generated: ${generatedImage.prompt}',
            isUser: false,
            timestamp: DateTime.now(),
            imageBase64: generatedImage.base64,
            imageWidth: generatedImage.width,
            imageHeight: generatedImage.height,
          ),
        );
      });
      _scrollToBottom();
      debugPrint('[ChatScreen] Added generated image to chat');
    });

    // Listen for all messages
    wsService.messageStream.listen((message) async {
      if (message.type == 'connected') {
        // Request greeting when connected
        debugPrint('Connected to Iris - requesting greeting');
        // Small delay to ensure VAD is initialized
        Future.delayed(const Duration(milliseconds: 500), () async {
          await vadService.pause(); // Pause VAD before greeting plays
          wsService.requestGreeting();
        });
      } else if (message.type == 'response_complete') {
        setState(() {
          _messages.add(
            ChatMessage(
              text: message.data?['text'] ?? '',
              isUser: false,
              timestamp: DateTime.now(),
            ),
          );
        });
        _scrollToBottom();
      } else if (message.type == 'synthesizing') {
        // Start buffering audio when synthesis begins
        audioService.startBuffering();
        await vadService.pause();
      } else if (message.type == 'synthesis_complete') {
        // Play the complete audio when synthesis is done
        try {
          debugPrint('[ChatScreen] synthesis_complete received, playing audio...');
          await audioService.finishBufferingAndPlay();
          debugPrint('[ChatScreen] Audio playback done, resuming VAD...');
          // Resume VAD listening after audio finishes
          await vadService.resume();
          debugPrint('[ChatScreen] VAD resume called');
        } catch (e) {
          debugPrint('[ChatScreen] Error during synthesis_complete handling: $e');
          // Try to resume VAD even if there was an error
          vadService.resume();
        }
      }
    });

    // Listen for audio chunks and buffer them
    wsService.audioStream.listen((audioData) {
      audioService.bufferAudioChunk(audioData);
    });
  }

  void _scrollToBottom() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _sendTextMessage() {
    final text = _textController.text.trim();
    if (text.isEmpty) return;

    final wsService = context.read<IrisWebSocketService>();
    wsService.sendTextMessage(text);

    setState(() {
      _messages.add(
        ChatMessage(text: text, isUser: true, timestamp: DateTime.now()),
      );
    });

    _textController.clear();
    _scrollToBottom();
  }

  Future<void> _downloadImage(ChatMessage message) async {
    if (!message.hasImage) return;

    try {
      // Decode the base64 image
      final Uint8List imageBytes = base64Decode(message.imageBase64!);

      // Generate filename with timestamp
      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final filename = 'iris_image_$timestamp.png';

      if (Platform.isAndroid || Platform.isIOS) {
        // Mobile: Request appropriate permission based on platform/version
        PermissionStatus status;

        if (Platform.isAndroid) {
          // Check Android version
          final androidInfo = await DeviceInfoPlugin().androidInfo;
          final sdkInt = androidInfo.version.sdkInt;

          debugPrint('[Download] Android SDK: $sdkInt');

          if (sdkInt >= 33) {
            // Android 13+ (API 33+): Use photos/media permissions
            status = await Permission.photos.request();
            debugPrint('[Download] Requested photos permission: $status');
          } else if (sdkInt >= 30) {
            // Android 11-12 (API 30-32): Use manageExternalStorage
            status = await Permission.manageExternalStorage.request();
            debugPrint('[Download] Requested manageExternalStorage permission: $status');
          } else {
            // Android 10 and below: Use legacy storage permission
            status = await Permission.storage.request();
            debugPrint('[Download] Requested storage permission: $status');
          }
        } else {
          // iOS: Use photos permission
          status = await Permission.photos.request();
          debugPrint('[Download] iOS - Requested photos permission: $status');
        }

        if (status.isGranted || status.isLimited) {
          final Directory? directory = Platform.isAndroid
              ? await getExternalStorageDirectory()
              : await getApplicationDocumentsDirectory();

          if (directory != null) {
            // For Android, navigate to public Downloads folder
            String savePath;
            if (Platform.isAndroid) {
              savePath = '/storage/emulated/0/Download/$filename';
            } else {
              savePath = '${directory.path}/$filename';
            }

            final File file = File(savePath);
            await file.writeAsBytes(imageBytes);

            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Image saved to Downloads folder'),
                  duration: const Duration(seconds: 3),
                  backgroundColor: Colors.green,
                  action: SnackBarAction(
                    label: 'OK',
                    textColor: Colors.white,
                    onPressed: () {},
                  ),
                ),
              );
            }
          }
        } else if (status.isDenied) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: const Text('Storage permission denied. Please grant permission in Settings.'),
                backgroundColor: Colors.red,
                duration: const Duration(seconds: 5),
                action: SnackBarAction(
                  label: 'Settings',
                  textColor: Colors.white,
                  onPressed: () => openAppSettings(),
                ),
              ),
            );
          }
        } else if (status.isPermanentlyDenied) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: const Text('Storage permission permanently denied. Please enable it in Settings.'),
                backgroundColor: Colors.red,
                duration: const Duration(seconds: 5),
                action: SnackBarAction(
                  label: 'Open Settings',
                  textColor: Colors.white,
                  onPressed: () => openAppSettings(),
                ),
              ),
            );
          }
        }
      } else {
        // Desktop (Windows/Linux/Mac): Save to Downloads folder
        final String downloadsPath;

        if (Platform.isWindows) {
          // Windows: Use user profile Downloads folder
          final userProfile = Platform.environment['USERPROFILE'];
          downloadsPath = '$userProfile\\Downloads';
        } else if (Platform.isMacOS) {
          // macOS: Use ~/Downloads
          final home = Platform.environment['HOME'];
          downloadsPath = '$home/Downloads';
        } else {
          // Linux: Use ~/Downloads
          final home = Platform.environment['HOME'];
          downloadsPath = '$home/Downloads';
        }

        final File file = File('$downloadsPath${Platform.pathSeparator}$filename');
        await file.writeAsBytes(imageBytes);

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Image downloaded to: ${file.path}'),
              duration: const Duration(seconds: 3),
              backgroundColor: Colors.green,
            ),
          );
        }
      }
    } catch (e) {
      debugPrint('Error downloading image: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to download image: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true, // Allow resizing when keyboard appears
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        backgroundColor: const Color(0xFF16213e),
        title: const Text('Iris', style: TextStyle(color: Colors.white)),
        actions: [
          // STT toggle (works for both local and ElevenLabs)
          IconButton(
            icon: Icon(
              _sttEnabled ? Icons.keyboard_voice : Icons.voice_over_off,
              color: _sttEnabled ? Colors.blue : Colors.grey,
            ),
            onPressed: _toggleSTT,
            tooltip: _sttEnabled ? 'Speech-to-Text: ON' : 'Speech-to-Text: OFF',
          ),
          // TTS toggle (works for both local and ElevenLabs)
          IconButton(
            icon: Icon(
              _ttsEnabled ? Icons.volume_up : Icons.volume_off,
              color: _ttsEnabled ? Colors.purple : Colors.grey,
            ),
            onPressed: _toggleTTS,
            tooltip: _ttsEnabled ? 'Text-to-Speech: ON' : 'Text-to-Speech: OFF',
          ),
          // Image model selector
          const ImageModelSelector(),
          // Toggle chat log visibility
          IconButton(
            icon: Icon(
              _showChatLog ? Icons.chat_bubble : Icons.graphic_eq,
              color: Colors.white70,
            ),
            onPressed: () {
              setState(() {
                _showChatLog = !_showChatLog;
              });
            },
            tooltip: _showChatLog ? 'Show visualizer' : 'Show chat',
          ),
          // VAD status indicator with better touch target
          Consumer<VadService>(
            builder: (context, vad, _) {
              return GestureDetector(
                onTap: () {
                  debugPrint('[Chat] VAD toggle tapped - current: ${vad.isEnabled}');
                  vad.setEnabled(!vad.isEnabled);
                },
                child: Container(
                  padding: const EdgeInsets.all(12),
                  child: Icon(
                    vad.isListening ? Icons.hearing : Icons.hearing_disabled,
                    color: vad.isSpeaking
                        ? Colors.orange
                        : vad.isListening
                        ? Colors.green
                        : Colors.grey,
                    size: 24,
                  ),
                ),
              );
            },
          ),
          // Connection status with Tailscale indicator
          Consumer<IrisWebSocketService>(
            builder: (context, ws, _) {
              final isConnected =
                  ws.connectionState == IrisConnectionState.connected;
              return PopupMenuButton<String>(
                icon: Icon(
                  isConnected ? Icons.cloud_done : Icons.cloud_off,
                  color: isConnected ? Colors.green : Colors.red,
                ),
                tooltip: isConnected
                    ? 'Connected${ws.useTailscale ? ' (Tailscale)' : ' (Local)'}'
                    : 'Disconnected',
                itemBuilder: (context) => [
                  PopupMenuItem(
                    value: 'local',
                    child: Row(
                      children: [
                        Icon(Icons.computer, color: !ws.useTailscale ? Colors.green : Colors.grey),
                        const SizedBox(width: 8),
                        Text('Local${!ws.useTailscale ? ' ✓' : ''}'),
                      ],
                    ),
                  ),
                  PopupMenuItem(
                    value: 'tailscale',
                    child: Row(
                      children: [
                        Icon(Icons.vpn_key, color: ws.useTailscale ? Colors.green : Colors.grey),
                        const SizedBox(width: 8),
                        Text('Tailscale${ws.useTailscale ? ' ✓' : ''}'),
                      ],
                    ),
                  ),
                  const PopupMenuItem(
                    value: 'auto',
                    child: Row(
                      children: [
                        Icon(Icons.autorenew, color: Colors.blue),
                        SizedBox(width: 8),
                        Text('Auto-detect'),
                      ],
                    ),
                  ),
                  if (!isConnected)
                    const PopupMenuItem(
                      value: 'reconnect',
                      child: Row(
                        children: [
                          Icon(Icons.refresh, color: Colors.orange),
                          SizedBox(width: 8),
                          Text('Reconnect'),
                        ],
                      ),
                    ),
                ],
                onSelected: (value) async {
                  switch (value) {
                    case 'local':
                      ws.setUseTailscale(false);
                      if (!isConnected) await ws.connect();
                      break;
                    case 'tailscale':
                      ws.setUseTailscale(true);
                      if (!isConnected) await ws.connect();
                      break;
                    case 'auto':
                      await ws.connectWithAutoDetect();
                      break;
                    case 'reconnect':
                      await ws.connect();
                      break;
                  }
                },
              );
            },
          ),
        ],
      ),
      body: _showChatLog ? _buildChatView() : _buildVisualizerView(),
    );
  }

  Widget _buildChatView() {
    return Consumer2<AudioService, VadService>(
      builder: (context, audio, vad, _) {
        Color accentColor;
        bool isActive;

        if (audio.isRecording) {
          accentColor = const Color(0xFFff6b6b);
          isActive = true;
        } else if (audio.isPlaying) {
          accentColor = const Color(0xFFa855f7);
          isActive = true;
        } else if (vad.state == VadState.speaking || vad.state == VadState.speechStart) {
          accentColor = const Color(0xFFf97316);
          isActive = true;
        } else if (vad.isListening) {
          accentColor = const Color(0xFF22d3ee);
          isActive = false;
        } else {
          accentColor = const Color(0xFF6b7280);
          isActive = false;
        }

        return AnimatedGradientBackground(
          isActive: isActive,
          accentColor: accentColor,
          child: Column(
            children: [
              // Messages list
              Expanded(
                child: ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) {
                    return _buildMessageBubble(_messages[index]);
                  },
                ),
              ),

              // Thinking indicator
              Consumer<IrisWebSocketService>(
                builder: (context, ws, _) {
                  if (!ws.isThinking) return const SizedBox.shrink();
                  return Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: const Color(0xFFa855f7).withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFa855f7), Color(0xFF6366f1)],
                            ),
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFFa855f7).withValues(alpha: 0.4),
                                blurRadius: 8,
                              ),
                            ],
                          ),
                          child: const Center(
                            child: Text(
                              'I',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 16,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        // Animated thinking dots
                        Expanded(
                          child: Row(
                            children: [
                              Text(
                                ws.thinkingMessage,
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.7),
                                  fontStyle: FontStyle.italic,
                                  fontSize: 14,
                                ),
                              ),
                              const SizedBox(width: 8),
                              _buildThinkingDots(),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),

              // Current response (streaming)
              Consumer<IrisWebSocketService>(
                builder: (context, ws, _) {
                  if (ws.currentResponse.isEmpty || ws.isThinking) return const SizedBox.shrink();
                  return Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.1),
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFa855f7), Color(0xFF6366f1)],
                            ),
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFFa855f7).withValues(alpha: 0.4),
                                blurRadius: 8,
                              ),
                            ],
                          ),
                          child: const Center(
                            child: Text(
                              'I',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 16,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            ws.currentResponse,
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.9),
                            ),
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),

              // Compact status indicator with mini visualizer
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // Mini sound wave
                    SizedBox(
                      width: 60,
                      height: 24,
                      child: SoundWaveVisualizer(
                        isActive: isActive,
                        color: accentColor,
                        barCount: 12,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      _getStatusText(audio, vad),
                      style: TextStyle(
                        color: accentColor,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        letterSpacing: 1,
                      ),
                    ),
                  ],
                ),
              ),

              // Input area
              _buildInputArea(),
            ],
          ),
        );
      },
    );
  }

  String _getStatusText(AudioService audio, VadService vad) {
    if (audio.isRecording) return 'RECORDING';
    if (audio.isPlaying) return 'IRIS SPEAKING';
    if (vad.state == VadState.speaking) return 'LISTENING';
    if (vad.state == VadState.speechStart) return 'SPEECH DETECTED';
    if (vad.state == VadState.processing) return 'PROCESSING';
    if (vad.isListening) return 'READY';
    return 'VAD OFF';
  }

  Widget _buildVisualizerView() {
    return Consumer2<AudioService, VadService>(
      builder: (context, audio, vad, _) {
        Color visualizerColor;
        bool isActive;
        String statusText;

        if (audio.isRecording) {
          visualizerColor = const Color(0xFFff6b6b);
          isActive = true;
          statusText = 'Recording...';
        } else if (audio.isPlaying) {
          visualizerColor = const Color(0xFFa855f7);
          isActive = true;
          statusText = 'Iris is speaking...';
        } else if (vad.state == VadState.speaking) {
          visualizerColor = const Color(0xFFf97316);
          isActive = true;
          statusText = 'You are speaking...';
        } else if (vad.state == VadState.speechStart) {
          visualizerColor = const Color(0xFFf97316);
          isActive = true;
          statusText = 'Speech detected...';
        } else if (vad.state == VadState.processing) {
          visualizerColor = const Color(0xFFfbbf24);
          isActive = true;
          statusText = 'Processing...';
        } else if (vad.isListening) {
          visualizerColor = const Color(0xFF22d3ee);
          isActive = false;
          statusText = 'Listening...';
        } else {
          visualizerColor = const Color(0xFF6b7280);
          isActive = false;
          statusText = 'VAD disabled';
        }

        return AnimatedGradientBackground(
          isActive: isActive,
          accentColor: visualizerColor,
          child: SafeArea(
            child: Column(
              children: [
                // Full-screen sound wave visualizer
                Expanded(
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: SoundWaveVisualizer(
                        isActive: isActive,
                        isSpeaking: audio.isPlaying,
                        color: visualizerColor,
                        barCount: 60,
                      ),
                    ),
                  ),
                ),

                // Status text with glow effect
                Padding(
                  padding: const EdgeInsets.only(bottom: 48),
                  child: Column(
                    children: [
                      Text(
                        statusText,
                        style: TextStyle(
                          color: visualizerColor,
                          fontSize: 20,
                          fontWeight: FontWeight.w300,
                          letterSpacing: 2,
                          shadows: [
                            Shadow(
                              color: visualizerColor.withValues(alpha: 0.5),
                              blurRadius: 10,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 8),
                      // Subtle "Iris" branding
                      Text(
                        'IRIS',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.3),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 8,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildMessageBubble(ChatMessage message) {
    final isUser = message.isUser;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
          minWidth: 100, // Minimum width for small messages
        ),
        decoration: BoxDecoration(
          gradient: isUser
              ? const LinearGradient(
                  colors: [Color(0xFF6366f1), Color(0xFF8b5cf6)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                )
              : null,
          color: isUser ? null : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(20),
            topRight: const Radius.circular(20),
            bottomLeft: Radius.circular(isUser ? 20 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 20),
          ),
          border: isUser
              ? null
              : Border.all(color: Colors.white.withValues(alpha: 0.1)),
          boxShadow: isUser
              ? [
                  BoxShadow(
                    color: const Color(0xFF6366f1).withValues(alpha: 0.3),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ]
              : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min, // Use minimum space needed
          children: [
            if (!isUser)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 20,
                      height: 20,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFFa855f7), Color(0xFF6366f1)],
                        ),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Center(
                        child: Text(
                          'I',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 10,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'Iris',
                      style: TextStyle(
                        color: const Color(0xFFa855f7).withValues(alpha: 0.9),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            // Display image if present
            if (message.hasImage) ...[
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: 400, // Limit image height to prevent overflow
                ),
                child: Stack(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.memory(
                        base64Decode(message.imageBase64!),
                        width: double.infinity,
                        fit: BoxFit.contain,
                      ),
                    ),
                    // Download button overlay
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Material(
                        color: Colors.black.withValues(alpha: 0.6),
                        borderRadius: BorderRadius.circular(20),
                        child: InkWell(
                          onTap: () => _downloadImage(message),
                          borderRadius: BorderRadius.circular(20),
                          child: Padding(
                            padding: const EdgeInsets.all(8.0),
                            child: Icon(
                              Icons.download,
                              color: Colors.white,
                              size: 20,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
            Text(
              message.text,
              softWrap: true, // Allow text to wrap to multiple lines
              overflow: TextOverflow.visible, // Show all text, wrapping as needed
              style: TextStyle(
                color: Colors.white.withValues(alpha: isUser ? 1.0 : 0.9),
                fontSize: 15,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputArea() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12), // Reduced vertical padding
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.3),
        border: Border(
          top: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
      ),
      child: SafeArea(
        minimum: const EdgeInsets.only(bottom: 4), // Minimal safe area padding
        child: Row(
          children: [
            // Voice selector
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.1),
                ),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _selectedVoice,
                  icon: const Icon(Icons.record_voice_over, color: Colors.white70, size: 18),
                  dropdownColor: const Color(0xFF1a1a2e),
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                  items: _availableVoices.map((voice) {
                    return DropdownMenuItem<String>(
                      value: voice['id'],
                      child: Text(voice['name']!, style: const TextStyle(fontSize: 12)),
                    );
                  }).toList(),
                  onChanged: (String? newValue) {
                    if (newValue != null) {
                      setState(() {
                        _selectedVoice = newValue;
                      });
                      // Send voice change to backend
                      final wsService = context.read<IrisWebSocketService>();
                      wsService.setVoice(newValue);
                      debugPrint('[Chat] Voice changed to: $newValue');
                    }
                  },
                ),
              ),
            ),
            const SizedBox(width: 8),

            // Text input with glassmorphism
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.1),
                  ),
                ),
                child: TextField(
                  controller: _textController,
                  style: const TextStyle(color: Colors.white),
                  maxLines: 5, // Allow up to 5 lines
                  minLines: 1, // Start with 1 line
                  textInputAction: TextInputAction.send, // Show send button on keyboard
                  decoration: const InputDecoration(
                    hintText: 'Type a message...',
                    hintStyle: TextStyle(color: Colors.white38),
                    filled: false,
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 14,
                    ),
                  ),
                  onSubmitted: (_) => _sendTextMessage(),
                ),
              ),
            ),
            const SizedBox(width: 12),

            // Send button with gradient
            GestureDetector(
              onTap: _sendTextMessage,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF6366f1), Color(0xFF8b5cf6)],
                  ),
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF6366f1).withValues(alpha: 0.4),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: const Icon(Icons.send_rounded, color: Colors.white, size: 22),
              ),
            ),
            const SizedBox(width: 8),

            // Manual mic button (push-to-talk fallback)
            Consumer3<AudioService, IrisWebSocketService, VadService>(
              builder: (context, audio, ws, vad, _) {
                final isRecording = audio.isRecording;
                return GestureDetector(
                  onLongPressStart: (_) async {
                    await vad.pause();
                    await audio.startRecording();
                    ws.startRecording();
                  },
                  onLongPressEnd: (_) async {
                    final audioData = await audio.stopRecording();
                    if (audioData != null) {
                      ws.sendAudioChunk(audioData);
                    }
                    ws.stopRecording();
                    await vad.resume();
                  },
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      gradient: isRecording
                          ? const LinearGradient(
                              colors: [Color(0xFFef4444), Color(0xFFf97316)],
                            )
                          : null,
                      color: isRecording ? null : Colors.white.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(14),
                      border: isRecording
                          ? null
                          : Border.all(color: Colors.white.withValues(alpha: 0.2)),
                      boxShadow: isRecording
                          ? [
                              BoxShadow(
                                color: const Color(0xFFef4444).withValues(alpha: 0.4),
                                blurRadius: 12,
                                offset: const Offset(0, 4),
                              ),
                            ]
                          : null,
                    ),
                    child: Icon(
                      isRecording ? Icons.mic : Icons.mic_none_rounded,
                      color: Colors.white.withValues(alpha: isRecording ? 1.0 : 0.7),
                      size: 22,
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildThinkingDots() {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.0, end: 1.0),
      duration: const Duration(milliseconds: 1500),
      builder: (context, value, child) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (index) {
            final delay = index * 0.2;
            final opacity = ((value + delay) % 1.0) > 0.5 ? 1.0 : 0.3;
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: const Color(0xFFa855f7).withValues(alpha: opacity),
                shape: BoxShape.circle,
              ),
            );
          }),
        );
      },
      onEnd: () {
        // Rebuild to loop animation
        if (mounted) {
          setState(() {});
        }
      },
    );
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }
}

class ChatMessage {
  final String text;
  final bool isUser;
  final DateTime timestamp;
  final String? imageBase64;
  final int? imageWidth;
  final int? imageHeight;

  ChatMessage({
    required this.text,
    required this.isUser,
    required this.timestamp,
    this.imageBase64,
    this.imageWidth,
    this.imageHeight,
  });

  bool get hasImage => imageBase64 != null && imageBase64!.isNotEmpty;
}
