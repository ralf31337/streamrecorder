# SATIP Stream Recorder

A Docker container for recording SATIP streams to MP3 files using ffmpeg. Designed to run on-demand via cron on TrueNAS SCALE.

## Important

**This container is NOT a persistent service.** It requires arguments (duration and prefix) each time it runs. Use it with cron, not as a deployed app.

## Quick Start

Install as custom app via YAML in TrueNAS:

```yaml
version: '3.8'

services:
  satip-recorder:
    image: ghcr.io/ralf31337/streamrecorder:latest
    container_name: satip-recorder
    user: "568:568"
    restart: "no"
    
    environment:
      - STREAM_URL=http://your-satip-server/?src=1&freq=11053&pol=h&ro=0.35&msys=dvbs2&mtype=8psk&plts=off&sr=22000&fec=34&sid=28429&pids=0,18,120,121
      - TIMEZONE=Europe/Vienna
    
    volumes:
      - /mnt/poolname/datasetname/recordings:/recordings
    
    network_mode: bridge
```

**Note:** Replace `your-satip-server` and `/mnt/pool/recordings` with your actual values.

Test recording (1 minute):

```bash
sudo docker run --rm \
  --user 568:568 \
  -e STREAM_URL="http://your-satip-server/?params" \
  -e TIMEZONE="Europe/Vienna" \
  -v /mnt/poolname/datasetname/recordings:/recordings \
  ghcr.io/ralf31337/streamrecorder:latest 1 test
```

## Usage

```bash
docker run --rm \
  --user 568:568 \
  -e STREAM_URL="http://your-satip-server/?params" \
  -e TIMEZONE="Europe/Vienna" \
  -v /mnt/poolname/datasetname/recordings:/recordings \
  ghcr.io/ralf31337/streamrecorder:latest DURATION PREFIX
```

**Arguments:**
- `DURATION` - Recording duration in minutes
- `PREFIX` - Filename prefix (e.g., "morning_show")

**Output Files:**
- `PREFIX_YYYYMMDD_HHMMSS.mp3` - Timestamped recording
- `PREFIX.mp3` - Symlink to the latest recording (useful for SMB access)

## TrueNAS SCALE Setup

### 1. Create Dataset for Recordings

In TrueNAS web interface:

1. Go to **Storage** → **Pools**
2. Click on your pool (e.g., `poolname`)
3. Click **Add Dataset**
4. Configure:
   - **Name:** `recordings` (or your preferred name)
   - **Dataset Preset:** Generic
   - Click **Save**

### 2. Set Permissions with ACLs

**Important:** The apps user (UID 568) must have write access to the recordings directory.

1. Go to **Storage** → **Pools**
2. Navigate to your dataset (e.g., `poolname/recordings`)
3. Click the **three dots (⋮)** → **Edit Permissions**
4. Click **Add Item** under ACL Entries
5. Configure the new ACL entry:
   - **Who:** User
   - **User:** `apps` (or type `568`)
   - **Permissions Type:** Basic
   - **Permissions:** Modify (or Full Control)
6. **Check:** ✓ Apply permissions recursively
7. Click **Save**

**Alternative via SSH (if you prefer):**
```bash
sudo chown -R 568:568 /mnt/pool/recordings
sudo chmod -R 755 /mnt/pool/recordings
```

### 3. Test Recording via Shell

Open shell on TrueNAS and run:

```bash
sudo docker run --rm \
  --user 568:568 \
  -e STREAM_URL="http://your-satip-server/?src=1&freq=11053&pol=h&ro=0.35&msys=dvbs2&mtype=8psk&plts=off&sr=22000&fec=34&sid=28429&pids=0,18,120,121" \
  -e TIMEZONE="Europe/Vienna" \
  -v /mnt/poolname/datasetname/recordings:/recordings \
  ghcr.io/ralf31337/streamrecorder:latest 1 test
```

Check for the test file:
```bash
ls -lh /mnt/pool/recordings/
```

If you see a file like `test_YYYYMMDD_HHMMSS.mp3`, permissions are correct!

### 5. Set Up Cron Jobs

In TrueNAS web interface:

1. Go to **System Settings** → **Advanced** → **Cron Jobs**
2. Click **Add**
3. Configure:
   - **Description:** Record Morning Show
   - **Command:** 
     ```
     /usr/bin/docker run --rm --user 568:568 -e STREAM_URL="http://your-satip-server/?params" -e TIMEZONE="Europe/Vienna" -v /mnt/poolname/datasetname/recordings:/recordings ghcr.io/ralf31337/streamrecorder:latest 60 morning_show
     ```
   - **Schedule:** Custom → `0 8 * * *` (daily at 8:00 AM)
   - **User:** root
   - **Enable:** ✓

**Important:** 
- Cron must run as `root` to access Docker, but the container runs as user 568 (apps) for security
- The image is already cached from your app install (Step 3), so no re-download happens
- To update the image, just update the app in TrueNAS UI - your cron jobs will automatically use the new version

### Example Cron Schedules

| Description | Cron Expression | Example Command |
|-------------|----------------|-----------------|
| Daily at 8 AM | `0 8 * * *` | ...60 morning_show |
| Daily at 8 PM | `0 20 * * *` | ...30 evening_news |
| Weekdays at 6 PM | `0 18 * * 1-5` | ...60 weekday_show |
| Saturdays at 10 AM | `0 10 * * 6` | ...120 weekend_special |

### View Cron Logs

```bash
# SSH into TrueNAS
journalctl -u cron -n 50 --no-pager

# Or search syslog
grep CRON /var/log/syslog | tail -20
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STREAM_URL` | Yes | - | SATIP stream URL |
| `TIMEZONE` | No | Europe/Vienna | IANA timezone for timestamps (with DST support) |

## Accessing Recordings via SMB

After each recording completes, two files are available:

1. **Timestamped file:** `morning_show_20241018_080000.mp3`
2. **Symlink (latest):** `morning_show.mp3` → points to the latest recording

**Use Case:** Access your recordings via SMB share with a static filename.

**Example:**
```
\\truenas\recordings\morning_show.mp3  ← Always the latest recording
\\truenas\recordings\evening_news.mp3  ← Always the latest recording
```

The symlink is automatically updated after each successful recording, so your media player or app can always access the latest recording using the same path.

## Technical Details

- **Audio Format:** MP3, 192 kbps, 48 kHz
- **Codec:** libmp3lame
- **Runs as:** UID 568 (TrueNAS apps user)
- **Container behavior:** Runs once and exits

## Troubleshooting

### Permission Denied

If you see permission errors:

```bash
sudo chown -R 568:568 /mnt/pool/recordings
sudo chmod -R 755 /mnt/pool/recordings
```

### No Output File

- Check permissions on recording directory
- Verify stream URL is accessible
- Check cron logs: `journalctl -u cron -n 50`

### Wrong Timestamp

Verify timezone: `docker run --rm --user 568:568 -e TIMEZONE="Europe/Vienna" ghcr.io/ralf31337/streamrecorder:latest --help`

## Building Locally

```bash
git clone https://github.com/ralf31337/streamrecorder.git
cd streamrecorder
docker build -t satip-recorder .
```

## License

This project is provided as-is for personal use.
