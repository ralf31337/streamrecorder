# SATIP Stream Recorder

A lightweight Docker container for recording SATIP streams to MP3 files using ffmpeg. Designed to run on-demand via cron rather than as a persistent service.

## Features

- Records SATIP streams to MP3 format (192 kbps)
- Configurable recording duration via command-line arguments
- Timezone-aware timestamps in filenames
- Customizable filename prefix per recording
- Lightweight container that exits after recording completes
- Ideal for scheduled recordings via cron on TrueNAS or other systems

## Pre-built Image (Recommended for TrueNAS)

A pre-built Docker image is automatically published to GitHub Container Registry on every commit.

**Image URL:** `ghcr.io/ralf31337/streamrecorder:latest`

You can use this image directly without building it yourself:

```bash
docker pull ghcr.io/ralf31337/streamrecorder:latest

# Run directly
docker run --rm \
  --env-file .env \
  -v /mnt/recordings:/recordings \
  ghcr.io/ralf31337/streamrecorder:latest 60 morning_show
```

## Quick Start (Building Locally)

### 1. Build the Docker Image

```bash
docker build -t satip-recorder .
```

### 2. Create Recordings Directory

```bash
mkdir -p ./recordings
```

### 3. Set Up Environment Variables

```bash
cp .env.example .env
# Edit .env with your stream URL
```

### 4. Run a Test Recording

```bash
# Record for 5 minutes with prefix "test"
docker run --rm \
  --env-file .env \
  -v $(pwd)/recordings:/recordings \
  satip-recorder 5 test
```

## Usage

### Command-Line Syntax

```bash
docker run [docker-options] satip-recorder DURATION PREFIX [options]
```

**Required Arguments:**
- `DURATION`: Recording duration in minutes (integer)
- `PREFIX`: Filename prefix for the recording (string, no slashes)

**Optional Arguments:**
- `--stream-url URL`: Override stream URL from environment variable
- `--timezone TZ`: Override timezone (e.g., "Europe/Vienna")
- `--output-dir DIR`: Override output directory (default: /recordings)

### Examples

**Basic recording:**
```bash
docker run --rm \
  --env-file .env \
  -v /mnt/recordings:/recordings \
  satip-recorder 60 morning_show
```

**With custom stream URL:**
```bash
docker run --rm \
  -v /mnt/recordings:/recordings \
  satip-recorder 120 special_event \
  --stream-url "http://example.com/stream"
```

**Different timezone:**
```bash
docker run --rm \
  --env-file .env \
  -v /mnt/recordings:/recordings \
  satip-recorder 30 test \
  --timezone "America/New_York"
```

### Output Files

Files are saved with the following naming convention:
```
{PREFIX}_{YYYYMMDD_HHMMSS}.mp3
```

Example: `morning_show_20251018_080000.mp3`

## Docker Compose

### Using docker-compose.yml

```bash
# Build the image
docker compose build

# Run a recording
docker compose run --rm satip-recorder 60 morning_show
```

## TrueNAS Setup

### Prerequisites: Volume Mount Setup

Before deploying the container, ensure your recordings directory exists and has proper permissions.

#### Using TrueNAS Dataset (Recommended)

If storing recordings in a dataset (e.g., `/mnt/pool/recordings`):

1. **Create/Verify Dataset:**
   - Go to **Storage** → **Pools**
   - Navigate to your pool (e.g., `A-primary`)
   - If needed, create a dataset: `A-music/radio`

2. **Set Permissions via Shell (SSH):**
   ```bash
   # SSH into TrueNAS
   ssh root@truenas-ip
   
   # Create directory if it doesn't exist
   mkdir -p /mnt/pool/recordings
   
   # Set permissions (allow Docker access)
   chmod 755 /mnt/pool/recordings
   
   # Optional: Set ownership to your user
   chown -R 1000:1000 /mnt/pool/recordings
   ```

3. **Verify Path:**
   ```bash
   ls -la /mnt/pool/recordings
   ```

### Method 1: Using Docker Compose (Recommended for TrueNAS SCALE)

1. **Copy docker-compose file to TrueNAS:**
   ```bash
   # SSH into TrueNAS
   mkdir -p /mnt/pool/docker-configs
   cd /mnt/pool/docker-configs
   
   # Create docker-compose.yml with nano or vi
   nano docker-compose.yml
   ```

2. **Use this configuration:**
   ```yaml
   version: '3.8'
   
   services:
     satip-recorder:
       image: ghcr.io/ralf31337/streamrecorder:latest
       container_name: satip-recorder
       
       environment:
         - >-
           STREAM_URL=http://your-satip-server/?src=1&freq=11053&pol=h&ro=0.35&msys=dvbs2&mtype=8psk&plts=off&sr=22000&fec=34&sid=28429&pids=0,18,120,121
         - TIMEZONE=Europe/Vienna
       
       volumes:
         - /mnt/pool/recordings:/recordings
       
       restart: "no"
       network_mode: bridge
   ```

3. **Test the setup:**
   ```bash
   cd /mnt/pool/docker-configs
   docker compose pull
   docker compose run --rm satip-recorder 1 test
   ```

4. **Check for test recording:**
   ```bash
   ls -lh /mnt/pool/recordings/
   ```

### Method 2: Using TrueNAS Web Interface

1. In TrueNAS web interface, go to **Apps** or **Containers**
2. Click **Launch Docker Image** or **Add Custom App**
3. Configure:
   - **Image Repository**: `ghcr.io/ralf31337/streamrecorder:latest`
   - **Restart Policy**: Never (important!)
   - **Environment Variables**:
     - `STREAM_URL`: `http://your-satip-server/?src=1&freq=11053&pol=h&ro=0.35&msys=dvbs2&mtype=8psk&plts=off&sr=22000&fec=34&sid=28429&pids=0,18,120,121`
     - `TIMEZONE`: `Europe/Vienna`
   - **Storage**:
     - Mount Type: Host Path
     - Host Path: `/mnt/pool/recordings`
     - Container Path: `/recordings`

### Set Up Cron Jobs

#### Method A: TrueNAS Web Interface

1. Go to **System Settings** → **Advanced** → **Cron Jobs**
2. Click **Add**
3. Configure:
   - **Description**: Record Morning Show
   - **Command**: 
     ```bash
     docker compose -f /mnt/pool/docker-configs/docker-compose.yml run --rm satip-recorder 60 morning_show
     ```
   - **Schedule**: 
     - Minute: `0`
     - Hour: `8`
     - Day of Month: `*`
     - Month: `*`
     - Day of Week: `*`
   - **User**: root
   - **Enable**: ✓

**Alternative (direct docker run):**
```bash
docker run --rm -e STREAM_URL="http://your-satip-server/?params" -e TIMEZONE="Europe/Vienna" -v /mnt/pool/recordings:/recordings ghcr.io/ralf31337/streamrecorder:latest 60 morning_show
```

#### Method B: Shell (crontab)

SSH into TrueNAS:

```bash
crontab -e
```

Add cron entries (using docker compose):

```bash
# Record morning show daily at 8:00 AM for 60 minutes
0 8 * * * docker compose -f /mnt/pool/docker-configs/docker-compose.yml run --rm satip-recorder 60 morning_show

# Record evening news daily at 8:00 PM for 30 minutes
0 20 * * * docker compose -f /mnt/pool/docker-configs/docker-compose.yml run --rm satip-recorder 30 evening_news

# Record weekend special on Saturdays at 10:00 AM for 120 minutes
0 10 * * 6 docker compose -f /mnt/pool/docker-configs/docker-compose.yml run --rm satip-recorder 120 weekend_special
```

**Alternative (direct docker run):**

```bash
# Record morning show daily at 8:00 AM for 60 minutes
0 8 * * * docker run --rm -e STREAM_URL="http://your-satip-server/?params" -e TIMEZONE="Europe/Vienna" -v /mnt/pool/recordings:/recordings ghcr.io/ralf31337/streamrecorder:latest 60 morning_show

# Record evening news daily at 8:00 PM for 30 minutes
0 20 * * * docker run --rm -e STREAM_URL="http://your-satip-server/?params" -e TIMEZONE="Europe/Vienna" -v /mnt/pool/recordings:/recordings ghcr.io/ralf31337/streamrecorder:latest 30 evening_news
```

### Cron Schedule Examples

| Schedule | Cron Expression | Description |
|----------|----------------|-------------|
| Daily at 8:00 AM | `0 8 * * *` | Every day at 8:00 |
| Monday-Friday at 6:00 PM | `0 18 * * 1-5` | Weekdays at 18:00 |
| Every 6 hours | `0 */6 * * *` | At 00:00, 06:00, 12:00, 18:00 |
| Twice daily | `0 8,20 * * *` | At 8:00 and 20:00 |

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STREAM_URL` | Yes* | - | SATIP stream URL (* can be passed via --stream-url) |
| `TIMEZONE` | No | `Europe/Vienna` | IANA timezone for filename timestamps |

**Note**: `DURATION` and `PREFIX` are command-line arguments, not environment variables.

## Technical Details

### Audio Settings

- **Codec**: MP3 (libmp3lame)
- **Bitrate**: 192 kbps
- **Sample Rate**: 48 kHz
- **Format**: MP3

### Container Behavior

- **Runtime**: Exits automatically after recording completes
- **Restart Policy**: Never (designed for cron scheduling)
- **Resource Usage**: Only active during recording period
- **Logging**: stdout/stderr with timestamps

## Troubleshooting

### Container exits immediately

Check logs:
```bash
docker logs satip-recorder
```

Common issues:
- Missing `STREAM_URL` environment variable
- Invalid duration (must be > 0)
- Invalid prefix (cannot contain '/')

### No output file created

- Verify volume mount is correct
- Check permissions on host directory
- Ensure stream URL is accessible from container

### Stream URL not accessible

Test connectivity:
```bash
docker run --rm satip-recorder:latest 1 test \
  --stream-url "YOUR_STREAM_URL"
```

### Wrong timestamp in filename

- Verify `TIMEZONE` environment variable
- Check available timezones in Python:
  ```python
  python3 -c "import zoneinfo; print(zoneinfo.available_timezones())"
  ```

## Advanced Configuration

### Resource Limits

Add to `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'
      memory: 512M
```

Or in Docker run command:

```bash
docker run --rm \
  --cpus=1.0 \
  --memory=512m \
  --env-file .env \
  -v /mnt/recordings:/recordings \
  satip-recorder 60 show
```

### Multiple Stream URLs

Create separate `.env` files:

```bash
# .env.stream1
STREAM_URL=http://stream1.example.com/...
TIMEZONE=Europe/Vienna

# .env.stream2
STREAM_URL=http://stream2.example.com/...
TIMEZONE=Europe/Berlin
```

Use in cron:

```bash
0 8 * * * docker run --rm --env-file /path/to/.env.stream1 -v /recordings:/recordings ghcr.io/ralf31337/streamrecorder:latest 60 stream1
0 9 * * * docker run --rm --env-file /path/to/.env.stream2 -v /recordings:/recordings ghcr.io/ralf31337/streamrecorder:latest 60 stream2
```

## License

This project is provided as-is for personal use.

## Support

For issues, please check:
1. Container logs: `docker logs satip-recorder`
2. ffmpeg documentation: https://ffmpeg.org/documentation.html
3. SATIP specification: https://www.satip.info/

