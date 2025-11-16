# SATIP Stream Recorder Dockerfile
FROM node:20-slim

# Install ffmpeg and procps (for ps command)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    procps \
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
COPY public /app/public

# Expose web interface port
EXPOSE 3000

# Default output directory
VOLUME ["/recordings"]

# Start the web server
CMD ["node", "server.js"]

