# SATIP Stream Recorder

A lightweight Docker container for recording SATIP streams to MP3 files using ffmpeg. Designed to run on-demand via cron rather than as a persistent service.

## Features

- Records SATIP streams to MP3 format (192 kbps)
- Configurable recording duration via command-line arguments
- Timezone-aware timestamps in filenames
- Customizable filename prefix per recording
- Lightweight container that exits after recording completes
- Ideal for scheduled recordings via cron on TrueNAS or other systems

## Quick Start

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

### Step 1: Deploy Container

1. In TrueNAS web interface, go to **Apps** or **Containers**
2. Click **Launch Docker Image** or **Add Custom App**
3. Configure:
   - **Image Repository**: `satip-recorder:latest` (after building)
   - **Restart Policy**: Never (important!)
   - **Environment Variables**:
     - `STREAM_URL`: Your SATIP stream URL
     - `TIMEZONE`: Your timezone (e.g., `Europe/Vienna`)
   - **Storage**:
     - Mount Type: Host Path
     - Host Path: `/mnt/pool/recordings` (or your desired path)
     - Container Path: `/recordings`

### Step 2: Build the Image on TrueNAS

SSH into TrueNAS and build:

```bash
# Copy files to TrueNAS
cd /mnt/pool/docker/satip-recorder

# Build image
docker build -t satip-recorder:latest .
```

### Step 3: Set Up Cron Jobs

#### Method A: TrueNAS Web Interface

1. Go to **System Settings** → **Advanced** → **Cron Jobs**
2. Click **Add**
3. Configure:
   - **Description**: Record Morning Show
   - **Command**: 
     ```bash
     docker run --rm --env-file /mnt/pool/docker/satip-recorder/.env -v /mnt/pool/recordings:/recordings satip-recorder:latest 60 morning_show
     ```
   - **Schedule**: 
     - Minute: `0`
     - Hour: `8`
     - Day of Month: `*`
     - Month: `*`
     - Day of Week: `*`
   - **User**: root
   - **Enable**: ✓

#### Method B: Shell (crontab)

SSH into TrueNAS:

```bash
crontab -e
```

Add cron entries:

```bash
# Record morning show daily at 8:00 AM for 60 minutes
0 8 * * * docker run --rm --env-file /mnt/pool/docker/satip-recorder/.env -v /mnt/pool/recordings:/recordings satip-recorder:latest 60 morning_show

# Record evening news daily at 8:00 PM for 30 minutes
0 20 * * * docker run --rm --env-file /mnt/pool/docker/satip-recorder/.env -v /mnt/pool/recordings:/recordings satip-recorder:latest 30 evening_news

# Record weekend special on Saturdays at 10:00 AM for 120 minutes
0 10 * * 6 docker run --rm --env-file /mnt/pool/docker/satip-recorder/.env -v /mnt/pool/recordings:/recordings satip-recorder:latest 120 weekend_special
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
0 8 * * * docker run --rm --env-file /path/to/.env.stream1 -v /recordings:/recordings satip-recorder 60 stream1
0 9 * * * docker run --rm --env-file /path/to/.env.stream2 -v /recordings:/recordings satip-recorder 60 stream2
```

## License

This project is provided as-is for personal use.

## Support

For issues, please check:
1. Container logs: `docker logs satip-recorder`
2. ffmpeg documentation: https://ffmpeg.org/documentation.html
3. SATIP specification: https://www.satip.info/

