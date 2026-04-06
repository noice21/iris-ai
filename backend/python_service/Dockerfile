FROM python:3.12-slim

# Install system deps for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# Install CPU-only torch first (skip CUDA, saves ~4GB)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install remaining deps (torch already satisfied, won't re-download CUDA version)
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN python download_models.py
CMD ["sh", "-c", "gunicorn --bind [::]:${PORT:-5000} --workers 1 --timeout 120 server:app"]
