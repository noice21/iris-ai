# Iris AI - Backend

Node.js backend for Iris AI voice assistant with persistent memory.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env and add your API keys:
   # - OPENROUTER_API_KEY: Get from https://openrouter.ai/
   # - MYSQL_PASSWORD: Your MySQL database password
   # - MEDIA_DASHBOARD_API_KEY: (Optional) Your media dashboard API key
   # - ELEVENLABS_API_KEY: (Optional) Only if using ElevenLabs TTS/STT
   ```

3. **Setup MySQL database:**
   ```bash
   # Create database and user
   mysql -u root -p
   CREATE DATABASE iris_ai;
   CREATE USER 'iris_user'@'localhost' IDENTIFIED BY 'your_password';
   GRANT ALL PRIVILEGES ON iris_ai.* TO 'iris_user'@'localhost';
   FLUSH PRIVILEGES;
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

The server will run on `http://localhost:3001`

## Features

- **LLM Integration**: Uses OpenRouter for conversational AI
- **Voice Processing**: STT/TTS via local services or ElevenLabs
- **Persistent Memory**: MySQL database for conversation history and user facts
- **Function Calling**: Tools for media dashboard control, image generation, and web search
- **Image Generation**: ComfyUI/Stable Diffusion integration

## API Endpoints

- `GET /health` - Health check
- WebSocket at `/ws` - Real-time voice/text chat

## ML Models Setup

The STT/TTS models are not included in this repository due to GitHub file size limits. You need to download them separately:

### Local TTS (Piper)
Download the voice model you want to use from [Piper Voices](https://github.com/rhasspy/piper/releases):
- Extract to: `backend/python_service/voices/`
- Recommended: `en_US-amy-medium.onnx` and `en_US-amy-medium.onnx.json`

### Local STT (Faster Whisper)
The Whisper models will auto-download on first run when you start the Python service:
```bash
cd backend/python_service
pip install -r requirements.txt
python app.py
```
Models are cached in: `backend/python_service/models/`

## Optional Services

- **Local TTS/STT**: Configure LOCAL_TTS_URL to use self-hosted services
- **ComfyUI**: For image generation (set COMFYUI_URL)
- **Media Dashboard**: For Docker container management
