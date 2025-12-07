import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'services/iris_websocket_service.dart';
import 'services/audio_service.dart';
import 'services/vad_service.dart';
import 'screens/chat_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const IrisApp());
}

class IrisApp extends StatelessWidget {
  const IrisApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => IrisWebSocketService()),
        ChangeNotifierProvider(create: (_) => AudioService()),
        ChangeNotifierProvider(create: (_) => VadService()),
      ],
      child: MaterialApp(
        title: 'Iris',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: Brightness.dark,
          primarySwatch: Colors.blue,
          scaffoldBackgroundColor: const Color(0xFF1a1a2e),
        ),
        home: const IrisHomePage(),
      ),
    );
  }
}

class IrisHomePage extends StatefulWidget {
  const IrisHomePage({super.key});

  @override
  State<IrisHomePage> createState() => _IrisHomePageState();
}

class _IrisHomePageState extends State<IrisHomePage> {
  bool _isInitialized = false;

  @override
  void initState() {
    super.initState();
    _initializeApp();
  }

  Future<void> _initializeApp() async {
    final wsService = context.read<IrisWebSocketService>();
    final audioService = context.read<AudioService>();

    // Get or generate device ID for memory persistence
    final deviceId = await _getDeviceId();

    // Request audio permission
    await audioService.requestPermission();

    // Connect to backend
    await wsService.connect(deviceId: deviceId);

    setState(() {
      _isInitialized = true;
    });
  }

  Future<String> _getDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    String? deviceId = prefs.getString('device_id');

    if (deviceId == null) {
      // Generate a unique device ID
      final deviceInfo = DeviceInfoPlugin();
      try {
        final info = await deviceInfo.deviceInfo;
        deviceId =
            info.data['id']?.toString() ??
            DateTime.now().millisecondsSinceEpoch.toString();
      } catch (e) {
        deviceId = DateTime.now().millisecondsSinceEpoch.toString();
      }
      await prefs.setString('device_id', deviceId);
    }

    return deviceId;
  }

  @override
  Widget build(BuildContext context) {
    if (!_isInitialized) {
      return const Scaffold(
        backgroundColor: Color(0xFF1a1a2e),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(color: Colors.blue),
              SizedBox(height: 16),
              Text(
                'Connecting to Iris...',
                style: TextStyle(color: Colors.white70),
              ),
            ],
          ),
        ),
      );
    }

    return const ChatScreen();
  }
}
