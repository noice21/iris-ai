"""
Kokoro ONNX TTS Service for Iris AI
High-quality, natural neural text-to-speech
"""
import os
import tempfile
from typing import Any
from pathlib import Path
import torch
from kokoro_onnx import Kokoro  # pyright: ignore[reportMissingTypeStubs]

class TTSService:
    voice_name: str
    kokoro: Any
    custom_voices: dict[str, Any]

    def __init__(self, voice_name: str = "af_bella"):
        """
        Initialize Kokoro TTS

        Args:
            voice_name: Voice to use (default: af_bella - American female)
                       Available voices:
                       - af (American Female)
                       - af_bella (Bella - expressive female)
                       - af_sarah (Sarah - calm female)  
                       - am_adam (Adam - confident male)
                       - am_michael (Michael - professional male)
                       - bf_emma (British Female Emma)
                       - bm_george (British Male George)
        """
        self.voice_name = voice_name

        # Set paths to downloaded model files
        self.models_dir = Path(__file__).parent / "kokoro_models"
        model_path = str(self.models_dir / "kokoro-v0_19.onnx")
        voices_path = str(self.models_dir / "voices.bin")

        print(f"[TTS] Loading Kokoro TTS model...")
        print(f"[TTS] Voice: {voice_name}")
        print(f"[TTS] Model: {model_path}")
        print(f"[TTS] Voices: {voices_path}")

        try:
            # Initialize Kokoro with model and voices paths
            self.kokoro = Kokoro(model_path, voices_path)

            # Cache for custom voice tensors
            self.custom_voices = {}

            print(f"[TTS] Kokoro TTS initialized successfully")

        except Exception as e:
            print(f"[TTS] Failed to load Kokoro: {e}")
            raise

    def _load_custom_voice(self, voice_name: str) -> Any:
        """Load a custom voice file (.pt) if it exists"""
        if voice_name in self.custom_voices:
            return self.custom_voices[voice_name]

        voice_file = self.models_dir / f"{voice_name}.pt"
        if voice_file.exists():
            try:
                voice_tensor = torch.load(str(voice_file), weights_only=True)
                # Convert to numpy array for Kokoro
                import numpy as np
                voice_array = voice_tensor.numpy() if hasattr(voice_tensor, 'numpy') else np.array(voice_tensor)
                self.custom_voices[voice_name] = voice_array
                print(f"[TTS] Loaded custom voice: {voice_name}")
                return voice_array
            except Exception as e:
                print(f"[TTS] Failed to load custom voice {voice_name}: {e}")
                return None
        return None

    def synthesize(self, text: str, speed: float = 1.0) -> bytes:
        """
        Synthesize speech from text

        Args:
            text: Text to convert to speech
            speed: Speech rate multiplier (0.5 = slower, 2.0 = faster)

        Returns:
            WAV audio data as bytes
        """
        print(f"[TTS] Synthesizing: '{text[:50]}...'")

        # Create temporary output file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            temp_path = temp_file.name

        try:
            # Check if it's a custom voice file
            custom_voice = self._load_custom_voice(self.voice_name)
            voice_param = custom_voice if custom_voice is not None else self.voice_name

            # Generate speech and save to file
            samples, sample_rate = self.kokoro.create(text, voice=voice_param, speed=speed)
            
            # Kokoro returns numpy array, need to save as WAV
            import soundfile as sf
            sf.write(temp_path, samples, sample_rate)

            # Read audio data
            with open(temp_path, 'rb') as f:
                audio_data = f.read()

            print(f"[TTS] Generated {len(audio_data)} bytes of audio")
            return audio_data

        finally:
            # Clean up temp file
            try:
                os.unlink(temp_path)
            except:
                pass

    def synthesize_streaming(self, text: str, chunk_callback: Any, speed: float = 1.0) -> None:
        """
        Synthesize speech with streaming output

        Args:
            text: Text to convert to speech
            chunk_callback: Function called with each audio chunk
            speed: Speech rate
        """
        print(f"[TTS] Streaming synthesis: '{text[:50]}...'")

        # Generate full audio then chunk it
        audio_data = self.synthesize(text, speed)

        # Send in chunks
        chunk_size = 4096
        for i in range(0, len(audio_data), chunk_size):
            chunk = audio_data[i:i + chunk_size]
            chunk_callback(chunk)

    def list_available_voices(self) -> list[str]:
        """List all available voice models"""
        # Built-in voices
        voices = [
            "af",
            "af_bella",
            "af_sarah",
            "am_adam",
            "am_michael",
            "bf_emma",
            "bm_george"
        ]

        # Add custom voices from .pt files
        if self.models_dir.exists():
            for voice_file in self.models_dir.glob("*.pt"):
                voice_name = voice_file.stem
                if voice_name not in voices:
                    voices.append(voice_name)

        return voices

    def change_voice(self, voice_name: str) -> bool:
        """Change to a different voice"""
        # For Kokoro, we just need to update the voice_name
        # The actual voice is selected during synthesis
        self.voice_name = voice_name
        print(f"[TTS] Changed voice to: {voice_name}")
        return True

# Test function
def test_tts():
    """Test the TTS service"""
    print("=" * 60)
    print("Kokoro TTS Service Test")
    print("=" * 60)
    print()

    tts = TTSService()

    test_text = "Hey! I'm Iris, your AI assistant. This is my new voice powered by Kokoro ONNX. I sound natural and expressive!"

    print()
    print("Synthesizing test audio...")
    audio = tts.synthesize(test_text)

    # Save test output
    output_path = Path(__file__).parent / "test_output.wav"
    with open(output_path, 'wb') as f:
        f.write(audio)

    print(f"\n[SUCCESS] Test audio saved to: {output_path}")
    print(f"  Size: {len(audio)} bytes")
    print(f"  Voice: {tts.voice_name}")

    # List available voices
    voices = tts.list_available_voices()
    print(f"\nAvailable voices: {', '.join(voices)}")

if __name__ == "__main__":
    test_tts()
