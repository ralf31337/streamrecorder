# SATIP Stream Recorder Dockerfile
FROM python:3.11-slim

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create recordings directory
RUN mkdir -p /recordings

# Set working directory
WORKDIR /app

# Copy recorder script
COPY recorder.py /app/recorder.py

# Make script executable
RUN chmod +x /app/recorder.py

# Set entrypoint to Python script
ENTRYPOINT ["python3", "/app/recorder.py"]

# Default output directory
VOLUME ["/recordings"]

