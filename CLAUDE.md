# Iris AI - Voice Assistant

## Project Overview
Iris AI is a full-stack voice assistant with persistent memory. It features a Flutter frontend with offline voice activity detection (VAD) and a Node.js backend with OpenRouter LLM, ElevenLabs STT/TTS, and MySQL for conversation memory.

## Project Structure
```
Iris-ai/
├── backend/                    # Node.js backend server
│   ├── src/
│   │   ├── server/             # HTTP + WebSocket servers (Fastify)
│   │   │   ├── index.js        # Main entry point
│   │   │   ├── routes.js       # HTTP API routes
│   │   │   └── websocket.js    # WebSocket handlers
│   │   ├── audio/              # Audio processing
│   │   │   ├── processor.js    # FFmpeg audio conversion
│   │   │   └── elevenlabs.js   # ElevenLabs STT/TTS
│   │   ├── llm/                # LLM pipeline
│   │   │   └── pipeline.js     # OpenRouter integration + memory + tools
│   │   ├── tools/              # Function calling tools
│   │   │   ├── index.js        # Tool registry and executor
│   │   │   └── mediaDashboard.js # Media dashboard API integration
│   │   ├── database/           # MySQL database
│   │   │   ├── connection.js   # Connection pool
│   │   │   └── memory.js       # Conversation memory & user facts
│   │   ├── avatar/             # UE5 Avatar bridge (optional)
│   │   │   └── bridge.js       # WebSocket to UE5 for lip sync
│   │   └── utils/              # Helper functions
│   │       └── helpers.js
│   ├── service-install.js      # Windows service installer
│   ├── service-uninstall.js
│   ├── .env                    # Configuration
│   └── package.json
│
├── frontend/                   # Flutter mobile/desktop app
│   ├── lib/
│   │   ├── main.dart           # App entry point
│   │   ├── screens/
│   │   │   └── chat_screen.dart    # Main chat UI with visualizer toggle
│   │   ├── services/
│   │   │   ├── iris_websocket_service.dart  # WebSocket connection to backend
│   │   │   ├── audio_service.dart           # Audio recording/playback
│   │   │   └── vad_service.dart             # Silero VAD v5 integration
│   │   └── widgets/
│   │       └── audio_visualizer.dart        # Animated background & sound waves
│   ├── pubspec.yaml
│   └── README.md
│
└── CLAUDE.md                   # This file
```

## Running the Project

### Backend
```bash
cd backend
npm install
npm start              # Development mode
npm run install-service  # Install as Windows service (run as Admin)
```
- **Port:** 3001
- **Health check:** http://localhost:3001/health
- **WebSocket:** ws://localhost:3001/ws

### Frontend
```bash
cd frontend
flutter pub get
flutter run -d windows   # Or: -d chrome, -d android, -d ios
```

## Backend API

### HTTP Endpoints
- `GET /health` - Health check
- `POST /api/chat` - Text chat with memory
- `POST /api/transcribe` - Audio to text (STT)
- `POST /api/synthesize` - Text to audio (TTS)
- `POST /api/process` - Full pipeline: audio → STT → LLM → TTS → audio

### WebSocket Messages
**Client → Server:**
- `{ type: "start_recording" }` - Begin audio capture
- `{ type: "stop_recording" }` - End audio, process it
- `{ type: "text_input", text: "..." }` - Send text directly
- `{ type: "request_greeting" }` - Request initial greeting
- `{ type: "set_device_id", deviceId: "..." }` - Identify user for memory
- Binary data - Audio chunks (WAV format)

**Server → Client:**
- `{ type: "connected", sessionId, userId, conversationId }`
- `{ type: "transcript", text }` - STT result
- `{ type: "response_token", token }` - Streaming LLM response
- `{ type: "response_complete", text }` - Full response
- `{ type: "synthesizing" }` - TTS synthesis started
- `{ type: "synthesis_complete" }` - TTS synthesis finished
- Binary data - TTS audio chunks (MP3)
- `{ type: "phonemes", data }` - Lip sync data (for avatar)

## Frontend Features

### Voice Activity Detection (VAD)
- Uses Silero VAD v5 model for offline speech detection
- Automatically pauses during TTS playback to prevent feedback
- Resumes listening after Iris finishes speaking
- Manual toggle available in app bar

### UI Features
- **Chat View:** Message bubbles with glassmorphism styling
- **Visualizer View:** Full-screen sound wave visualization
- **Animated Background:** Aurora-style gradient with floating blobs
- **Toggle:** Switch between chat log and visualizer modes
- **Push-to-Talk:** Long-press mic button as fallback

### Audio Flow
1. VAD detects speech → captures audio
2. Audio sent to backend via WebSocket
3. Backend: STT (ElevenLabs) → LLM (OpenRouter) → TTS (ElevenLabs)
4. Audio streamed back, buffered, then played
5. VAD automatically resumes after playback

## Database Tables (MySQL)
- `users` - User profiles by device_id
- `conversations` - Chat sessions
- `messages` - All messages with timestamps
- `user_facts` - Long-term memory (name, preferences, etc.)

## Key Features
1. **Persistent Memory** - Remembers users across sessions via deviceId
2. **Fact Extraction** - Auto-extracts name, job, location, preferences
3. **Streaming Responses** - Real-time token streaming from LLM
4. **Offline VAD** - No cloud dependency for voice detection
5. **Audio Buffering** - Complete audio playback without stuttering
6. **Avatar Support** - Optional UE5 integration with phoneme/viseme data
7. **Function Calling** - LLM can query external APIs (media dashboard) for real data

## Tool/Function Calling System
Iris can use tools to query real data from external services. Currently supported:

### Media Dashboard Tools
Connects to the media dashboard backend to query Docker container stats.

**Available Tools:**
- `get_media_containers` - List all Docker containers
- `get_container_stats` - Get CPU, RAM, network stats for a container
- `get_all_container_stats` - Get stats for all running containers
- `restart_container` - Restart a container
- `get_container_logs` - Get recent container logs
- `check_media_server_health` - Check if media server is online

**Example Queries:**
- "How is my Plex server doing?"
- "What's the CPU usage on Sonarr?"
- "Can you check my media server stats?"
- "Restart the Radarr container"

### Image Generation Tools (Stable Diffusion via ComfyUI)
Generates images using Stable Diffusion through a local ComfyUI server. Optimized for AMD GPUs with DirectML.

**Available Tools:**
- `generate_image` - Generate an image from a text description
- `check_image_generator_status` - Check if ComfyUI is running
- `list_image_models` - List available SD models/checkpoints and show current default
- `set_image_model` - Change the default model for image generation

**Example Queries:**
- "Generate an anime girl with blue hair"
- "Create concept art for a futuristic city"
- "Draw me a cute robot character"
- "What image models do you have?"
- "Change the image model to [model name]"
- "Use the [model name] model for images"

**Requirements:**
- ComfyUI running locally (default: http://127.0.0.1:8188)
- SDXL model or compatible checkpoint
- For AMD GPUs: ROCm drivers installed

### OS Control Tools (Windows)
Control the computer's operating system - manage processes and search the web invisibly.

**Available Tools:**
- `list_running_processes` - List all currently running programs/processes
- `check_process_running` - Check if a specific program is running
- `kill_process` - Stop/kill a running process by name or PID
- `start_program` - Start a program/application
- `restart_program` - Restart a program (stop and start)
- `search_web` - Search the web using headless Chrome (invisible, no browser window opens)

**Example Queries:**
- "What programs are running?"
- "Is Chrome running?"
- "Stop notepad"
- "Start notepad"
- "Restart Chrome"
- "Search the web for the latest AI news"
- "What's the weather in New York?" (uses web search)
- "Look up information about quantum computing"

**Requirements:**
- Windows OS (uses tasklist/taskkill commands)
- Puppeteer for headless web browsing (auto-installed)

## Environment Variables (backend/.env)
```
PORT=3001
OPENROUTER_API_KEY=your_key
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=voice_id
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=iris_db
UE5_AVATAR_WS_URL=ws://localhost:8080  # Optional

# Tool/Function Calling
ENABLE_TOOLS=true                        # Enable/disable function calling
MEDIA_DASHBOARD_URL=http://localhost:3000  # Media dashboard backend URL
MEDIA_DASHBOARD_API_KEY=your_api_key     # API key for media dashboard

# ComfyUI/Stable Diffusion
COMFYUI_URL=http://127.0.0.1:8188               # ComfyUI server URL
IMAGE_OUTPUT_DIR=./output/images                # Where to save generated images
COMFYUI_DEFAULT_MODEL=animagineXLV31_v31.safetensors  # Default model (optional, can change via voice)
```

## Tech Stack
- **Backend:** Node.js, Fastify, WebSocket, FFmpeg
- **Frontend:** Flutter, Provider, Silero VAD, audioplayers
- **AI Services:** OpenRouter (LLM), ElevenLabs (STT/TTS)
- **Database:** MySQL
- **Optional:** Unreal Engine 5 (avatar with lip sync)
