"""
Download Kokoro TTS models for Docker build.
Whisper STT models are downloaded automatically by faster-whisper on first use.
"""
import os
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).parent / "kokoro_models"

MODELS = {
    "kokoro-v0_19.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v0_19.onnx",
    "voices.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices.bin",
}

def download_models():
    MODELS_DIR.mkdir(exist_ok=True)

    for filename, url in MODELS.items():
        filepath = MODELS_DIR / filename
        if filepath.exists():
            print(f"[OK] {filename} already exists, skipping")
            continue

        print(f"[DOWNLOAD] {filename} from {url}")
        urllib.request.urlretrieve(url, filepath)
        size_mb = filepath.stat().st_size / (1024 * 1024)
        print(f"[OK] {filename} ({size_mb:.1f} MB)")

    print("\nAll models ready.")

if __name__ == "__main__":
    download_models()
