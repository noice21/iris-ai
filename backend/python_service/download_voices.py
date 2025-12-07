"""
Download Piper TTS voice models
This script downloads high-quality English voices for Iris
"""
import os
import requests
from pathlib import Path

# Voice models to download (high quality female voices for Iris)
VOICES = {
    # High quality female voices
    "amy": {
        "name": "en_US-amy-medium",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json",
        "description": "Clear, professional female voice"
    },
    "lessac": {
        "name": "en_US-lessac-medium",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
        "description": "Natural, warm female voice (RECOMMENDED)"
    },
    "libritts": {
        "name": "en_US-libritts-high",
        "url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/libritts/high/en_US-libritts-high.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/libritts/high/en_US-libritts-high.onnx.json",
        "description": "Very high quality, expressive voice"
    }
}

def download_file(url, destination):
    """Download a file with progress indication"""
    print(f"Downloading {destination.name}...")
    response = requests.get(url, stream=True)
    response.raise_for_status()

    total_size = int(response.headers.get('content-length', 0))
    downloaded = 0

    with open(destination, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    percent = (downloaded / total_size) * 100
                    print(f"\r  Progress: {percent:.1f}%", end='', flush=True)

    print("\n  ✓ Downloaded successfully")

def main():
    # Create voices directory
    voices_dir = Path(__file__).parent / "voices"
    voices_dir.mkdir(exist_ok=True)

    print("=" * 60)
    print("Piper TTS Voice Downloader for Iris AI")
    print("=" * 60)
    print()

    # Download each voice
    for voice_id, voice_info in VOICES.items():
        print(f"\n📥 {voice_info['name']}")
        print(f"   {voice_info['description']}")
        print()

        # Download model file
        model_path = voices_dir / f"{voice_info['name']}.onnx"
        if model_path.exists():
            print(f"  ⏭️  Model already exists, skipping...")
        else:
            download_file(voice_info['url'], model_path)

        # Download config file
        config_path = voices_dir / f"{voice_info['name']}.onnx.json"
        if config_path.exists():
            print(f"  ⏭️  Config already exists, skipping...")
        else:
            download_file(voice_info['config_url'], config_path)

    print()
    print("=" * 60)
    print("✅ All voices downloaded successfully!")
    print("=" * 60)
    print()
    print("Default voice: en_US-lessac-medium (warm, natural)")
    print(f"Voice directory: {voices_dir.absolute()}")
    print()

if __name__ == "__main__":
    main()
