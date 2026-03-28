// App configuration for Iris AI
// Allows switching between local backend and cloud (Make.com) modes

enum IrisMode {
  /// Local mode - connects to your own backend server
  /// Requires: Node.js backend running locally
  local,

  /// Cloud mode - connects to Make.com webhook
  /// Requires: Make.com account with Gemini integration
  cloud,
}

class AppConfig {
  // Singleton instance
  static final AppConfig _instance = AppConfig._internal();
  factory AppConfig() => _instance;
  AppConfig._internal();

  /// Current app mode (local or cloud)
  IrisMode _mode = IrisMode.cloud; // Default to cloud for SaaS

  /// Make.com webhook URL (for cloud mode)
  String _makeWebhookUrl = '';

  /// Local backend URLs (for local mode)
  String _localWsUrl = 'ws://192.168.68.62:3001/ws';
  String _tailscaleWsUrl = 'ws://100.71.195.127:3001/ws';

  // Getters
  IrisMode get mode => _mode;
  bool get isCloudMode => _mode == IrisMode.cloud;
  bool get isLocalMode => _mode == IrisMode.local;
  String get makeWebhookUrl => _makeWebhookUrl;
  String get localWsUrl => _localWsUrl;
  String get tailscaleWsUrl => _tailscaleWsUrl;

  /// Set the app mode
  void setMode(IrisMode mode) {
    _mode = mode;
  }

  /// Set Make.com webhook URL
  void setMakeWebhookUrl(String url) {
    _makeWebhookUrl = url;
  }

  /// Set local backend URL
  void setLocalWsUrl(String url) {
    _localWsUrl = url;
  }

  /// Set Tailscale backend URL
  void setTailscaleWsUrl(String url) {
    _tailscaleWsUrl = url;
  }

  /// Load configuration (can be extended to load from storage)
  Future<void> load() async {
    // TODO: Load from SharedPreferences or secure storage
    // For now, use defaults
  }

  /// Save configuration
  Future<void> save() async {
    // TODO: Save to SharedPreferences or secure storage
  }
}
