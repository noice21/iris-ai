# Iris AI

A full-stack voice assistant with persistent memory, featuring offline voice activity detection and real-time conversation.

## Features

- **Voice Interaction** - Talk naturally with Iris using your microphone
- **Persistent Memory** - Iris remembers your name, preferences, and past conversations
- **Offline VAD** - Voice activity detection runs locally using Silero VAD v5
- **Real-time Streaming** - See responses as they're generated
- **Beautiful UI** - Animated aurora background with sound wave visualizations
- **Cross-platform** - Works on Windows, macOS, Linux, Android, iOS, and Web

## Screenshots

| Chat View | Visualizer View |
|-----------|-----------------|
| Glassmorphism message bubbles with gradient styling | Full-screen sound wave visualization |

## Quick Start

### Prerequisites

- Node.js 18+
- Flutter 3.0+
- MySQL 8.0+
- FFmpeg (for audio processing)
- API Keys: [OpenRouter](https://openrouter.ai/) and [ElevenLabs](https://elevenlabs.io/)

### Backend Setup

```bash
cd backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys and database credentials

# Start the server
npm start
```

### Frontend Setup

```bash
cd frontend
flutter pub get
flutter run -d windows  # or: chrome, android, ios, macos, linux
```

### Database Setup

```sql
CREATE DATABASE iris_db;
```

The tables are created automatically on first run.

## Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│                 │ ◄───────────────► │                 │
│  Flutter App    │                    │  Node.js Server │
│                 │     Audio/Text     │                 │
│  - Silero VAD   │ ◄───────────────► │  - Fastify      │
│  - Audio Player │                    │  - FFmpeg       │
│  - Provider     │                    │  - MySQL        │
└─────────────────┘                    └────────┬────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
                    ▼                           ▼                           ▼
            ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
            │   OpenRouter  │          │  ElevenLabs   │          │    MySQL      │
            │     (LLM)     │          │  (STT/TTS)    │          │  (Memory)     │
            └───────────────┘          └───────────────┘          └───────────────┘
```

## How It Works

1. **Voice Detection**: Silero VAD v5 runs offline to detect when you start/stop speaking
2. **Speech-to-Text**: Audio is sent to ElevenLabs Scribe for transcription
3. **LLM Processing**: OpenRouter processes your message with conversation history
4. **Text-to-Speech**: Response is converted to speech via ElevenLabs
5. **Playback**: Audio is streamed back and played while VAD is paused
6. **Resume**: VAD automatically resumes listening after Iris finishes speaking

## Configuration

### Backend Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `OPENROUTER_API_KEY` | OpenRouter API key | Required |
| `ELEVENLABS_API_KEY` | ElevenLabs API key | Required |
| `ELEVENLABS_VOICE_ID` | Voice ID for TTS | Required |
| `MYSQL_HOST` | MySQL host | `localhost` |
| `MYSQL_USER` | MySQL username | `root` |
| `MYSQL_PASSWORD` | MySQL password | Required |
| `MYSQL_DATABASE` | Database name | `iris_db` |
| `UE5_AVATAR_WS_URL` | UE5 avatar WebSocket | Optional |

## Project Structure

```
Iris-ai/
├── backend/                 # Node.js server
│   ├── src/
│   │   ├── server/          # Fastify + WebSocket
│   │   ├── audio/           # FFmpeg + ElevenLabs
│   │   ├── llm/             # OpenRouter integration
│   │   ├── database/        # MySQL connection + queries
│   │   └── avatar/          # UE5 bridge (optional)
│   └── package.json
│
├── frontend/                # Flutter app
│   ├── lib/
│   │   ├── screens/         # Chat screen with toggle
│   │   ├── services/        # WebSocket, Audio, VAD
│   │   └── widgets/         # Visualizer components
│   └── pubspec.yaml
│
├── CLAUDE.md                # Developer documentation
└── README.md                # This file
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Flutter, Provider, Silero VAD |
| Backend | Node.js, Fastify, WebSocket |
| LLM | OpenRouter (Claude, GPT-4, etc.) |
| Speech | ElevenLabs (STT + TTS) |
| Database | MySQL |
| Audio | FFmpeg, audioplayers |

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
