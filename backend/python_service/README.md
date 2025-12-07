# Iris AI - Local TTS/STT Service

Local Text-to-Speech and Speech-to-Text service using:
- **Piper TTS** - Fast, CPU-based text-to-speech
- **Faster-Whisper** - GPU-accelerated speech-to-text with DirectML support for AMD GPUs

## Features

- 🎤 **No API costs** - Completely local processing
- 🚀 **Fast performance** - Optimized for real-time voice assistants
- 🎵 **High quality** - Natural sounding voices
- 🔒 **Private** - All processing done locally
- 💻 **AMD GPU support** - Uses DirectML for faster transcription

## Installation

### 1. Install Python Dependencies

```bash
cd I:\Iris-ai\backend\python_service
pip install -r requirements.txt
```

### 2. Download Voice Models

```bash
python download_voices.py
```

This will download 3 high-quality female voices:
- `en_US-lessac-medium` (RECOMMENDED) - Warm, natural voice
- `en_US-amy-medium` - Clear, professional voice
- `en_US-libritts-high` - Very high quality, expressive voice

## Running the Service

### Start the Server

```bash
python server.py
```

The service will start on `http://localhost:5000`

### Environment Variables

```bash
PORT=5000                          # Service port
PIPER_VOICE=en_US-lessac-medium   # Default TTS voice
WHISPER_MODEL=base                 # STT model size (tiny, base, small, medium, large)
DEBUG=false                        # Enable debug mode
```

## API Endpoints

### TTS Endpoints

**Synthesize Speech**
```http
POST /tts/synthesize
Content-Type: application/json

{
  "text": "Hello, I'm Iris!",
  "speed": 1.0
}
```

**List Voices**
```http
GET /tts/voices
```

**Change Voice**
```http
POST /tts/voice
Content-Type: application/json

{
  "voice": "en_US-amy-medium"
}
```

### STT Endpoints

**Transcribe Audio**
```http
POST /stt/transcribe?language=en
Content-Type: multipart/form-data

audio=@audio.wav
```

### Health Check

```http
GET /health
GET /status
```

## Testing

### Test TTS

```bash
python tts_service.py
```

This will generate `test_output.wav` in the service directory.

### Test STT

```bash
python stt_service.py
```

This initializes the Whisper model and confirms it's ready.

## Performance

### TTS (Piper)
- Latency: 200-400ms
- CPU usage: Low-Medium
- Quality: ⭐⭐⭐⭐

### STT (Faster-Whisper)

| Model | Speed | Accuracy | GPU Usage |
|-------|-------|----------|-----------|
| tiny  | ⚡⚡⚡⚡⚡ | ⭐⭐⭐ | Low |
| base  | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | Medium (RECOMMENDED) |
| small | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | High |
| medium| ⚡⚡ | ⭐⭐⭐⭐⭐ | Very High |

## Integration with Iris Backend

The Node.js backend automatically uses this service when configured:

**.env:**
```env
TTS_PROVIDER=local
STT_PROVIDER=local
LOCAL_TTS_URL=http://localhost:5000
```

## Troubleshooting

### Voice models not found
Run `python download_voices.py` to download voices.

### DirectML/GPU issues
Faster-Whisper will fall back to CPU if DirectML isn't available. For best AMD GPU performance, ensure you have the latest drivers.

### Port already in use
Change the port in `.env` or when starting:
```bash
PORT=5001 python server.py
```

## File Structure

```
python_service/
├── server.py              # Main Flask HTTP server
├── tts_service.py         # Piper TTS implementation
├── stt_service.py         # Faster-Whisper STT implementation
├── download_voices.py     # Voice model downloader
├── requirements.txt       # Python dependencies
├── voices/                # Downloaded voice models
├── models/                # Downloaded Whisper models
└── README.md             # This file
```
