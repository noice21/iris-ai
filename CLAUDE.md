# Iris AI - Voice Assistant

## Project Overview
Iris AI is a full-stack voice assistant with persistent memory. It features a Flutter frontend with offline voice activity detection (VAD) and a Node.js backend with LLM support (Ollama local/cloud, Google Gemini, or OpenRouter), local Kokoro TTS / Whisper STT (via Python service), and MySQL for conversation memory.

The app supports two deployment modes:
- **Local mode** — backend runs on your machine, no auth required
- **Cloud mode** — backend on Railway, Supabase auth, optional Make.com webhook integration for serverless processing

## Project Structure
```
Iris-ai/
├── backend/                    # Node.js backend server
│   ├── src/
│   │   ├── server/             # HTTP + WebSocket servers (Fastify)
│   │   │   ├── index.js        # Main entry point
│   │   │   ├── routes.js       # HTTP API routes
│   │   │   ├── websocket.js    # WebSocket handlers
│   │   │   └── auth.js         # Supabase JWT auth hook (cloud mode)
│   │   ├── audio/              # Audio processing
│   │   │   ├── processor.js    # FFmpeg audio conversion
│   │   │   ├── ttsProvider.js  # TTS/STT provider routing (local or ElevenLabs)
│   │   │   └── elevenlabs.js   # ElevenLabs STT/TTS (optional)
│   │   ├── llm/                # LLM pipeline
│   │   │   └── pipeline.js     # Ollama/Gemini/OpenRouter integration + memory + tools
│   │   ├── tools/              # Function calling tools
│   │   │   ├── index.js        # Tool registry and executor
│   │   │   ├── mediaDashboard.js # Media dashboard API integration
│   │   │   ├── imageGeneration.js # ComfyUI/Stable Diffusion image gen
│   │   │   ├── osControl.js    # Windows process control + web search
│   │   │   ├── lights.js       # Smart lights control
│   │   │   └── csvDatabase.js  # Multi-database read-only query tools
│   │   ├── database/           # MySQL database
│   │   │   ├── connection.js   # Connection pool
│   │   │   └── memory.js       # Conversation memory & user facts
│   │   ├── avatar/             # UE5 Avatar bridge (optional)
│   │   │   └── bridge.js       # WebSocket to UE5 for lip sync
│   │   └── utils/              # Helper functions
│   │       └── helpers.js
│   ├── python_service/         # Local TTS/STT Python service
│   │   ├── server.py           # Flask server (port 5000)
│   │   ├── tts_service.py      # Kokoro ONNX TTS engine
│   │   ├── stt_service.py      # Faster-Whisper STT engine
│   │   ├── download_models.py  # Downloads Kokoro models for Docker build
│   │   ├── Dockerfile          # Python service container
│   │   └── requirements.txt    # Python dependencies
│   ├── Dockerfile              # Node.js backend container
│   ├── .dockerignore
│   ├── service-install.js      # Windows service installer
│   ├── service-uninstall.js
│   ├── .env                    # Configuration
│   ├── .env.example            # Template with all env vars
│   └── package.json
│
├── frontend/                   # Flutter mobile/desktop app
│   ├── lib/
│   │   ├── main.dart           # App entry point
│   │   ├── config/
│   │   │   └── app_config.dart         # Local vs cloud mode config
│   │   ├── screens/
│   │   │   └── chat_screen.dart        # Main chat UI with visualizer toggle
│   │   ├── services/
│   │   │   ├── iris_websocket_service.dart  # WebSocket connection to backend
│   │   │   ├── audio_service.dart           # Audio recording/playback
│   │   │   ├── vad_service.dart             # Silero VAD v5 integration
│   │   │   └── cloud_service.dart           # Make.com webhook integration (cloud mode)
│   │   └── widgets/
│   │       └── audio_visualizer.dart        # Animated background & sound waves
│   ├── pubspec.yaml
│   └── README.md
│
└── CLAUDE.md                   # This file
```

## Running the Project

### Backend (Local)
```bash
cd backend
npm install
npm start              # Development mode
npm run install-service  # Install as Windows service (run as Admin)
```
- **Port:** 3001
- **Health check:** http://localhost:3001/health
- **WebSocket:** ws://localhost:3001/ws

### Backend (Docker / Cloud)
```bash
# Node.js backend
cd backend
docker build -t iris-backend .

# Python TTS/STT service (downloads Kokoro models during build)
cd backend/python_service
docker build -t iris-python-service .
```
In cloud mode (`CLOUD_MODE=true`), the Node.js backend does NOT auto-start the Python service — they run as separate containers.

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
3. Backend: STT (Whisper local or ElevenLabs) → LLM (Ollama/Gemini/OpenRouter) → TTS (Kokoro local or ElevenLabs)
4. Audio streamed back, buffered, then played
5. VAD automatically resumes after playback

## Database Tables (MySQL)
- `users` - User profiles by device_id (or supabase_id in cloud mode)
- `conversations` - Chat sessions
- `messages` - All messages with timestamps
- `user_facts` - Long-term memory (name, preferences, etc.)
- `subscriptions` - Polar subscription status (cloud mode only): status, polar_customer_id, current_period_end

## Key Features
1. **Persistent Memory** - Remembers users across sessions via deviceId
2. **Fact Extraction** - Auto-extracts name, job, location, preferences
3. **Streaming Responses** - Real-time token streaming from LLM
4. **Offline VAD** - No cloud dependency for voice detection
5. **Audio Buffering** - Complete audio playback without stuttering
6. **Avatar Support** - Optional UE5 integration with phoneme/viseme data
7. **Function Calling** - LLM can query external APIs (media dashboard, databases, ComfyUI, OS, lights, web search, knowledge graph, filesystem, Docker) with chained tool call support
8. **Cloud Mode** - Deploy to Railway with Supabase auth, or use Make.com webhooks for serverless processing
9. **Docker Support** - Separate Dockerfiles for Node.js backend and Python TTS/STT service

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
Control the computer's operating system - manage processes.

**Available Tools:**
- `list_running_processes` - List all currently running programs/processes
- `check_process_running` - Check if a specific program is running
- `kill_process` - Stop/kill a running process by name or PID
- `start_program` - Start a program/application
- `restart_program` - Restart a program (stop and start)

**Example Queries:**
- "What programs are running?"
- "Is Chrome running?"
- "Stop notepad"
- "Start notepad"
- "Restart Chrome"

**Requirements:**
- Windows OS (uses tasklist/taskkill commands)

### Database Query Tools (Read-Only, Multi-Database)
Query data from multiple MySQL databases. Iris can discover databases, list tables, inspect structure, and query/search data but cannot modify it.

**Available Tools:**
- `list_csv_databases` - List all available databases (excludes system DBs)
- `list_csv_tables` - List all data tables in a specific database (names, columns, row counts)
- `describe_csv_table` - Get table structure, column types, and sample rows
- `query_csv_table` - Query rows with column selection, filtering, sorting, pagination (max 100 rows)
- `search_csv_table` - Search for text across all columns of a table

**Example Queries:**
- "What databases do you have?"
- "What tables are in the Lucian_rise database?"
- "Show me the structure of the weapons table in Lucian_rise"
- "What are all the warrior class items?"
- "Search for 'fire' in the spells table"

**Requirements:**
- MySQL server accessible with MYSQL_HOST/PORT/USER/PASSWORD credentials
- Databases auto-discovered (system DBs and iris_ai filtered out)

### Web Search Tools
Search the web and read webpage content. Supports two providers: Brave Search API (fast, reliable) or Puppeteer/DuckDuckGo (free, no API key needed).

**Available Tools:**
- `search_web` - Search the web via Brave API or DuckDuckGo (configurable via `SEARCH_PROVIDER`)
- `visit_webpage` - Navigate to a URL and extract its main text content (always uses Puppeteer)

**Example Queries:**
- "Search the web for the latest AI news"
- "What's the weather in New York?"
- "Read the content of https://example.com/article"

**Configuration:**
- `SEARCH_PROVIDER=brave` or `SEARCH_PROVIDER=puppeteer` (default: puppeteer)
- `BRAVE_SEARCH_API_KEY` required when using Brave provider

### Knowledge Graph Tools
Structured long-term memory using entities, relationships, and observations. Stored in MySQL, scoped per user.

**Available Tools:**
- `create_entity` - Create a new entity (person, place, concept, project, organization)
- `create_relation` - Link two entities with a relationship (e.g., works_at, lives_in, knows)
- `add_observation` - Add a note or observation to an existing entity
- `search_knowledge` - Search entities by name or description
- `get_entity` - Get full entity details with all relations and observations
- `delete_entity` - Remove an entity and cascade-delete its relations/observations

**Example Queries:**
- "Remember that John works at Acme Corp"
- "What do you know about John?"
- "John just got promoted to Senior Engineer"

**Database Tables:**
- `knowledge_entities` - Entities with name, type, description
- `knowledge_relations` - Relationships between entities
- `knowledge_observations` - Notes/observations attached to entities

### Filesystem Tools (Local Mode Only)
Read, write, and manage files on the local computer. Sandboxed to a configurable base directory.

**Available Tools:**
- `list_directory` - List files and folders in a directory
- `read_file` - Read text file contents (max 1MB, configurable line limit)
- `write_file` - Write or append to a file
- `search_files` - Search for files by name pattern (recursive, max depth 5)
- `get_file_info` - Get file metadata (size, dates, type)
- `move_file` - Move or rename a file

**Example Queries:**
- "List files in my Documents folder"
- "Read the config.txt file"
- "Search for PDF files in Downloads"

**Configuration:**
- `FILESYSTEM_BASE_DIR` - Base directory for file operations (default: user home)
- Only available when `CLOUD_MODE` is not `true`

### Docker Tools (Local Mode Only)
Manage Docker containers and images directly via Docker CLI.

**Available Tools:**
- `docker_list_containers` - List all containers (running and stopped)
- `docker_container_stats` - Get real-time CPU, memory, network stats
- `docker_start_container` - Start a stopped container
- `docker_stop_container` - Stop a running container
- `docker_restart_container` - Restart a container
- `docker_container_logs` - Get recent log output from a container
- `docker_list_images` - List Docker images
- `docker_compose_status` - Get status of docker compose services

**Example Queries:**
- "What Docker containers are running?"
- "Show me the stats for the postgres container"
- "Restart the nginx container"
- "Show me the last 100 lines of logs from the api container"

**Requirements:**
- Docker installed and accessible in PATH
- Only available when `CLOUD_MODE` is not `true`

## Environment Variables (backend/.env)
See `backend/.env.example` for a full template. Key variables:
```
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=*

# Cloud Mode (set to 'true' when deploying to Railway/cloud)
# Skips auto-starting Python TTS/STT subprocess (runs as separate container)
# CLOUD_MODE=true

# LLM Provider: 'ollama', 'gemini', or 'openrouter'
LLM_PROVIDER=gemini

# Ollama Configuration (when LLM_PROVIDER=ollama)
# Local: OLLAMA_URL=http://localhost:11434 (no key needed)
# Cloud: OLLAMA_URL=https://ollama.com/api (requires OLLAMA_API_KEY)
OLLAMA_URL=http://localhost:11434
OLLAMA_API_KEY=your_ollama_api_key       # Only needed for Ollama cloud
OLLAMA_MODEL=qwen3                       # Cloud requires full tag (model:size)

# Google Gemini Configuration (when LLM_PROVIDER=gemini)
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash

# OpenRouter Configuration (when LLM_PROVIDER=openrouter)
OPENROUTER_API_KEY=your_key
OPENROUTER_MODEL=x-ai/grok-4.1-fast

# LLM Settings
LLM_MAX_TOKENS=500
LLM_TEMPERATURE=0.7
MAX_CONVERSATION_HISTORY=20

# TTS/STT Provider: 'local' or 'elevenlabs'
TTS_PROVIDER=local                       # 'local' uses Kokoro TTS via Python service
STT_PROVIDER=local                       # 'local' uses Whisper via Python service
LOCAL_TTS_URL=http://localhost:5000       # Python service URL (auto-started in local mode)

ELEVENLABS_API_KEY=your_key              # Only needed if using elevenlabs provider
ELEVENLABS_VOICE_ID=voice_id

# MySQL Database
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=iris_ai

# Supabase Auth (required when CLOUD_MODE=true)
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here

UE5_AVATAR_WS_URL=ws://localhost:8080    # Optional

# Tool/Function Calling
ENABLE_TOOLS=true                        # Enable/disable function calling
MEDIA_DASHBOARD_URL=http://localhost:3000 # Media dashboard backend URL
MEDIA_DASHBOARD_API_KEY=your_api_key     # API key for media dashboard
# Database query tools use MYSQL_HOST/PORT/USER/PASSWORD (multi-database, auto-discovered)

# ComfyUI/Stable Diffusion
COMFYUI_URL=http://127.0.0.1:8188               # ComfyUI server URL
IMAGE_OUTPUT_DIR=./output/images                # Where to save generated images

# Web Search
SEARCH_PROVIDER=puppeteer                       # 'puppeteer' (free) or 'brave' (API)
BRAVE_SEARCH_API_KEY=your_key                   # Only needed if SEARCH_PROVIDER=brave

# Filesystem (local mode only)
# FILESYSTEM_BASE_DIR=C:\Users\YourName         # Default: user home directory
```

## Important Implementation Notes

### ES Module Environment Variable Loading
`dotenv.config()` is called in `index.js` but ES module imports are hoisted and execute before any runtime code. Therefore, `pipeline.js` reads all env vars lazily via getter functions (`getLlmProvider()`, `getOllamaApiUrl()`, `getToolsEnabled()`) instead of top-level constants. This ensures env vars are available when actually used.

### Ollama API Format
Ollama (local and cloud) uses the native `/api/chat` endpoint — NOT the OpenAI-compatible `/v1/chat/completions`. Streaming uses JSON lines format (one JSON object per line), not SSE (`data: ...` prefix). The `qwen3.5` model includes a `thinking` field in responses that is ignored (only `content` is used).

### Tool Call Chaining
When the LLM needs multiple tool calls to answer a query (e.g., list databases → list tables → query data), the streaming path (`processOllamaToolCalls`) uses non-streaming follow-up requests for the chained calls (up to 5 rounds). The initial tool call is detected during streaming, but subsequent rounds use `stream: false` for reliability. The final text response is sent to the client all at once after the chain completes.

### Python TTS/STT Service
The backend auto-starts a Python Flask service on port 5000 for local TTS (Kokoro ONNX) and STT (Faster-Whisper). Uses `py` launcher on Windows. Requires `pip install -r python_service/requirements.txt` before first run. In cloud mode (`CLOUD_MODE=true`), the Python service runs as a separate Docker container and is NOT auto-started by the backend.

### Cloud Mode & Auth
When `CLOUD_MODE=true`:
- `auth.js` hooks into Fastify routes to verify Supabase JWT tokens from the `Authorization: Bearer <token>` header
- WebSocket connections use Supabase user ID (from `set_device_id`) instead of hardware device ID
- The Python TTS/STT service is NOT auto-started — it runs as a separate container
- `HOST=0.0.0.0` is required for Docker/Railway to bind correctly

### Frontend Cloud Service
`cloud_service.dart` provides an alternative to the WebSocket backend using Make.com webhooks. Audio/text is sent via HTTP POST to a Make.com webhook URL, which routes through Gemini for STT → LLM → TTS processing. This is a serverless alternative that doesn't require running the Node.js backend.

## Tech Stack
- **Backend:** Node.js, Fastify, WebSocket, FFmpeg
- **Frontend:** Flutter, Provider, Silero VAD, audioplayers
- **LLM:** Google Gemini (default), Ollama cloud/local, or OpenRouter
- **TTS:** Kokoro ONNX via Python service (default) or ElevenLabs
- **STT:** Faster-Whisper via Python service (default) or ElevenLabs
- **Database:** MySQL
- **Auth:** Supabase (cloud mode only)
- **Deployment:** Docker, Railway (cloud mode)
- **Optional:** Unreal Engine 5 (avatar with lip sync), Make.com webhooks (serverless mode)
