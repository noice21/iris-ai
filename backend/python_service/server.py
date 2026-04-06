"""
Iris AI - Local TTS/STT Service
Flask HTTP server for Kokoro TTS and Faster-Whisper STT
"""
import os
import io
from flask import Flask, request, send_file, jsonify # pyright: ignore[reportUnknownVariableType]
from flask_cors import CORS
from tts_service import TTSService
from stt_service import STTService

app = Flask(__name__) # type: ignore
CORS(app)  # Enable CORS for Node.js backend

# Initialize services
print("=" * 60)
print("Iris AI - Local TTS/STT Service")
print("=" * 60)
print()

try:
    print("Initializing TTS service...")
    tts_service = TTSService()  # Uses default Windows voice
    print("[OK] TTS service ready")
except Exception as e:
    print(f"[ERROR] TTS initialization failed: {e}")
    tts_service = None

try:
    print("Initializing STT service...")
    whisper_model = os.getenv("WHISPER_MODEL", "base")
    stt_service = STTService(model_size=whisper_model)
    print("[OK] STT service ready")
except Exception as e:
    print(f"[ERROR] STT initialization failed: {e}")
    stt_service = None

print()
print("=" * 60)
print()

# ============================================================================
# TTS Endpoints
# ============================================================================

@app.route('/tts/synthesize', methods=['POST'])
def synthesize():
    """
    Synthesize speech from text

    Request JSON:
    {
        "text": "Text to synthesize",
        "speed": 1.0 (optional),
        "voice": "af_bella" (optional)
    }

    Returns: WAV audio file
    """
    if not tts_service:
        return jsonify({"error": "TTS service not available"}), 503

    tts = tts_service
    try:
        data = request.get_json()
        text = data.get('text', '')
        speed = float(data.get('speed', 1.0))
        voice = data.get('voice', tts.voice_name)

        if not text:
            return jsonify({"error": "No text provided"}), 400

        # Change voice if different from current
        if voice != tts.voice_name:
            tts.change_voice(voice)

        # Synthesize
        audio_data = tts.synthesize(text, speed=speed)

        # Return as WAV file
        return send_file(
            io.BytesIO(audio_data),
            mimetype='audio/wav',
            as_attachment=False,
            download_name='speech.wav'
        )

    except Exception as e:
        print(f"[TTS Error] {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/tts/voices', methods=['GET'])
def list_voices():
    """List all available TTS voices"""
    if not tts_service:
        return jsonify({"error": "TTS service not available"}), 503

    tts = tts_service
    voices = tts.list_available_voices()
    return jsonify({
        "voices": voices,
        "current": tts.voice_name
    })

@app.route('/tts/voice', methods=['POST'])
def change_voice():
    """
    Change TTS voice

    Request JSON:
    {
        "voice": "en_US-amy-medium"
    }
    """
    if not tts_service:
        return jsonify({"error": "TTS service not available"}), 503

    tts = tts_service
    try:
        data = request.get_json()
        voice_name = data.get('voice', '')

        if not voice_name:
            return jsonify({"error": "No voice specified"}), 400

        tts.change_voice(voice_name)

        return jsonify({
            "success": True,
            "voice": voice_name
        })

    except Exception as e:
        print(f"[TTS Error] {e}")
        return jsonify({"error": str(e)}), 500

# ============================================================================
# STT Endpoints
# ============================================================================

@app.route('/stt/transcribe', methods=['POST'])
def transcribe():
    """
    Transcribe audio to text

    Request: WAV audio file (multipart/form-data)
    Optional query param: language (default: "en")

    Returns JSON:
    {
        "text": "Transcribed text"
    }
    """
    if not stt_service:
        return jsonify({"error": "STT service not available"}), 503

    stt = stt_service
    try:
        # Get audio file
        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided"}), 400

        audio_file = request.files['audio']
        language = request.args.get('language', 'en')

        # Read audio data
        audio_bytes = audio_file.read()

        # Transcribe
        text = stt.transcribe_bytes(audio_bytes, language=language)

        return jsonify({
            "text": text,
            "language": language
        })

    except Exception as e:
        print(f"[STT Error] {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/stt/model', methods=['POST'])
def change_model():
    """
    Change STT model size

    Request JSON:
    {
        "model": "base"  # tiny, base, small, medium, large
    }
    """
    if not stt_service:
        return jsonify({"error": "STT service not available"}), 503

    stt = stt_service
    try:
        data = request.get_json()
        model_size = data.get('model', 'base')

        valid_models = ['tiny', 'base', 'small', 'medium', 'large']
        if model_size not in valid_models:
            return jsonify({"error": f"Invalid model. Choose from: {valid_models}"}), 400

        stt.change_model(model_size)

        return jsonify({
            "success": True,
            "model": model_size
        })

    except Exception as e:
        print(f"[STT Error] {e}")
        return jsonify({"error": str(e)}), 500

# ============================================================================
# Health & Status
# ============================================================================

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "services": {
            "tts": tts_service is not None,
            "stt": stt_service is not None
        }
    })

@app.route('/status', methods=['GET'])
def status():
    """Get service status and configuration"""
    return jsonify({
        "tts": {
            "available": tts_service is not None,
            "voice": tts_service.voice_name if tts_service else None,
            "voices": tts_service.list_available_voices() if tts_service else []
        },
        "stt": {
            "available": stt_service is not None,
            "model": stt_service.model_size if stt_service else None
        }
    })

# ============================================================================
# Main
# ============================================================================

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))

    print(f"Starting server on http://localhost:{port}")
    print()
    print("Endpoints:")
    print(f"  POST http://localhost:{port}/tts/synthesize - Synthesize speech")
    print(f"  GET  http://localhost:{port}/tts/voices - List voices")
    print(f"  POST http://localhost:{port}/tts/voice - Change voice")
    print(f"  POST http://localhost:{port}/stt/transcribe - Transcribe audio")
    print(f"  GET  http://localhost:{port}/health - Health check")
    print(f"  GET  http://localhost:{port}/status - Service status")
    print()

    app.run(
        host='::',
        port=port,
        debug=os.getenv('DEBUG', 'false').lower() == 'true'
    )
