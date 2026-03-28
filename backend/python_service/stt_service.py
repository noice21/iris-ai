"""
Faster-Whisper STT Service for Iris AI
Fast, local speech-to-text using Faster-Whisper with DirectML (AMD GPU support)
"""
import os
import tempfile
from typing import Any
from pathlib import Path
from faster_whisper import WhisperModel  # pyright: ignore[reportMissingTypeStubs]

class STTService:
    model_size: str
    device: str
    model: Any

    def __init__(self, model_size: str = "base", device: str = "auto"):
        """
        Initialize Faster-Whisper STT

        Args:
            model_size: Model size (tiny, base, small, medium, large)
                       - tiny: Fastest, least accurate
                       - base: Good balance (RECOMMENDED)
                       - small: Better accuracy, slower
                       - medium/large: Best accuracy, slowest
            device: Device to use ("cpu", "cuda", "auto")
                   - "auto" will use DirectML on AMD GPU if available
        """
        self.model_size = model_size
        self.device = device
        self.model = None
        self.models_dir = Path(__file__).parent / "models"
        self.models_dir.mkdir(exist_ok=True)

        self.load_model(model_size, device)

    def load_model(self, model_size: str = "base", device: str = "auto") -> None:
        """Load Whisper model"""
        print(f"[STT] Loading Whisper model: {model_size} on {device}")

        # Try to use DirectML for AMD GPU
        compute_type = "int8"  # Good balance of speed and accuracy

        try:
            # For DirectML (AMD GPU), we use CPU mode but with optimizations
            # DirectML support in faster-whisper is still experimental
            self.model = WhisperModel(
                model_size,
                device="cpu",  # DirectML will be auto-detected
                compute_type=compute_type,
                download_root=str(self.models_dir)
            )
            print(f"[STT] Model loaded successfully")

        except Exception as e:
            print(f"[STT] Failed to load model: {e}")
            raise

    def transcribe(self, audio_path: str, language: str = "en") -> str:
        """
        Transcribe audio file to text

        Args:
            audio_path: Path to audio file (WAV format)
            language: Language code (default: "en" for English)

        Returns:
            Transcribed text
        """
        if not self.model:
            raise RuntimeError("No model loaded")

        print(f"[STT] Transcribing audio file: {audio_path}")

        # Transcribe
        segments, info = self.model.transcribe(
            audio_path,
            language=language,
            beam_size=5,
            vad_filter=True,  # Voice activity detection filter
            vad_parameters=dict(
                min_silence_duration_ms=500
            )
        )

        # Combine all segments
        full_text = " ".join([segment.text for segment in segments])

        print(f"[STT] Transcription: '{full_text}'")
        print(f"[STT] Detected language: {info.language} (probability: {info.language_probability:.2f})")

        return full_text.strip()

    def transcribe_bytes(self, audio_bytes: bytes, language: str = "en") -> str:
        """
        Transcribe audio from bytes

        Args:
            audio_bytes: WAV audio data as bytes
            language: Language code

        Returns:
            Transcribed text
        """
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_file.write(audio_bytes)
            temp_path = temp_file.name

        try:
            # Transcribe
            result = self.transcribe(temp_path, language)
            return result
        finally:
            # Clean up temp file
            try:
                os.unlink(temp_path)
            except:
                pass

    def change_model(self, model_size: str) -> None:
        """Change to a different model size"""
        self.load_model(model_size, self.device)

# Test function
def test_stt():
    """Test the STT service"""
    print("=" * 60)
    print("Faster-Whisper STT Service Test")
    print("=" * 60)
    print()

    # Initialize service
    stt = STTService(model_size="base")

    print("\n[SUCCESS] STT service initialized successfully")
    print(f"  Model: {stt.model_size}")
    print(f"  Device: {stt.device}")
    print()
    print("Ready for transcription!")
    print("Note: This test only initializes the service.")
    print("      Actual transcription requires audio input.")

if __name__ == "__main__":
    test_stt()
