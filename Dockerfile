# SATIP Stream Recorder Dockerfile
FROM node:20-slim

# Install Python and ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create recordings directory
RUN mkdir -p /recordings

# Set working directory
WORKDIR /app

# Copy package files and install Node.js dependencies
COPY package.json /app/
RUN npm install

# Copy application files
COPY server.js /app/
COPY recorder.py /app/
COPY public /app/public

# Make scripts executable
RUN chmod +x /app/recorder.py

# Expose web interface port
EXPOSE 3000

# Default output directory
VOLUME ["/recordings"]

# Start the web server
CMD ["node", "server.js"]

