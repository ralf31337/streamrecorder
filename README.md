# SATIP Stream Recorder

A Docker container for recording SATIP streams to MP3 files using ffmpeg. Features a **web interface** for interactive recording control and **cron-based scheduling** via the built-in scheduler.

## Features

- 🌐 **Web Interface**: Modern, responsive web UI for starting/stopping recordings on-demand
- 🎙️ **Multiple Simultaneous Recordings**: Record multiple streams concurrently with unique names
- 💾 **State Persistence**: Recordings continue even if browser is closed; state survives server restarts
- 📁 **Automatic Filename Generation**: Files named `streamrecording_<name>_YYYYMMDDHHMMSS.mp3`
- 🔄 **Real-time Status**: Live updates of active recordings with duration tracking
- 🛡️ **Input Validation**: Name field restricted to letters and numbers only (regex: `[a-zA-Z0-9]+`)
- ⏰ **Built-in Cron Scheduler**: Schedule recordings via web interface or cron.json file

## Quick Start

### Web Interface Mode (Recommended)

Start the container as a persistent service with web interface:

```bash
docker compose up -d
```

Access the web interface at: **http://localhost:3000**

The web interface allows you to:
- Enter stream URLs and recording names
- Start/stop recordings on-demand
- View all active recordings with real-time duration
- Stop individual recordings or all at once

### Scheduled Recordings (Cron)

The web interface includes a built-in cron scheduler. You can schedule recordings via:
- **Web Interface**: Use the cron scheduler UI to add/edit/delete scheduled recordings
- **Cron JSON File**: Manually edit `/recordings/cron.json` in the container or mounted volume

Scheduled recordings are stored in `cron.json` and persist across container restarts.

## Architecture & How It Works

### System Components

1. **Node.js Express Server** (`server.js`)
   - RESTful API endpoints for recording control
   - Manages ffmpeg child processes (detached, survive parent death)
   - Uses `ps` command as source of truth for running processes
   - Persists recording metadata to disk
   - Serves static web interface

2. **Web Interface** (`public/index.html`)
   - Single-page application with real-time updates
   - Validates input (name: letters/numbers only)
   - Polls server every 2 seconds for status updates
   - Displays all active recordings with duration

3. **State Persistence** (`.recordings_state.json`)
   - Stored in output directory
   - Contains recording metadata (name, path, start time, stream URL, PID)
   - Synced with actual running processes via `ps` on every status check
   - Automatically cleaned up when processes die
   - Removed when no recordings active

4. **Process Management (ps-based)**
   - Each recording spawns a detached ffmpeg child process
   - Processes run independently and survive Node.js/server restarts
   - Server uses `ps -eo pid,args | grep ffmpeg` to discover running processes
   - State file synced with `ps` output on every API call
   - Orphaned processes (running but not in state) are automatically killed
   - Dead processes (in state but not running) are removed from state
   - Graceful shutdown: SIGTERM → wait 2s → SIGKILL if needed

### Recording Lifecycle

1. **Start Recording**:
   - User submits form with stream URL and name
   - Server validates name (regex: `^[a-zA-Z0-9]+$`)
   - Checks `ps` output for duplicate name (prevents conflicts)
   - Generates filename: `streamrecording_<name>_YYYYMMDDHHMMSS.mp3`
   - Spawns detached ffmpeg process with stream URL
   - Stores metadata (name, path, start time, PID) in `.recordings_state.json`
   - Returns success response

2. **During Recording**:
   - ffmpeg process runs independently (detached, survives parent death)
   - Web UI polls `/api/record/status` every 2 seconds
   - Server syncs state file with `ps` output on each status request
   - Duration calculated from start time in state file
   - Orphaned processes (running but not in state) are automatically killed
   - Dead processes (in state but not running) are removed from state

3. **Stop Recording**:
   - User clicks "Stop" button (individual or all)
   - Server looks up PID from state file (synced with `ps`)
   - Sends SIGTERM to ffmpeg process by PID
   - After 2 seconds, sends SIGKILL if still running
   - Syncs state file with `ps` to remove stopped process
   - Returns success response

4. **Process Exit**:
   - On normal exit or error, process terminates
   - Next status check syncs state with `ps` and removes dead process
   - State file automatically cleaned up if no recordings remain

### Filename Format

Files are named: `streamrecording_<name>_YYYYMMDDHHMMSS.mp3`

- `<name>`: User-provided name (validated: letters/numbers only)
- `YYYYMMDDHHMMSS`: Timestamp when recording started (UTC)
- Example: `streamrecording_morning_show_20241218143025.mp3`

## Usage

### Scheduled Recordings via Cron

The web interface includes a built-in cron scheduler that allows you to schedule recordings. Scheduled recordings are managed through the web interface or by editing the `cron.json` file directly.

### Web Interface API Endpoints

- `POST /api/record/start` - Start a new recording
  - Body: `{ "streamUrl": "...", "name": "..." }`
  - Returns: `{ "success": true, "name": "...", "outputPath": "..." }`

- `POST /api/record/stop` - Stop a specific recording
  - Body: `{ "name": "..." }`
  - Returns: `{ "success": true, "name": "...", "outputPath": "..." }`

- `POST /api/record/stop-all` - Stop all active recordings
  - Returns: `{ "success": true, "stopped": [...] }`

- `GET /api/record/status` - Get recording status
  - Query: `?name=<name>` (optional, for specific recording)
  - Returns: `{ "activeRecordings": [...] }` or `{ "active": true/false }`

- `GET /api/health` - Health check endpoint
  - Returns: `{ "status": "ok" }`

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
sudo chown -R 568:568 /mnt/poolname/datasetname/recordings
sudo chmod -R 755 /mnt/poolname/datasetname/recordings
```

### 3. Test Recording via Web Interface

1. Access the web interface at `http://your-truenas-ip:3000`
2. Enter your stream URL and a test name (e.g., "test")
3. Click "Start Recording"
4. Wait a few seconds, then check the recordings directory

Check for the test file:
```bash
ls -lh /mnt/poolname/datasetname/recordings/
ls -lh /mnt/poolname/datasetname/recordings/links/
```

If you see a file like `streamrecording_test_YYYYMMDDHHMMSS.mp3` and a symlink `links/test.mp3`, permissions are correct!

### 5. Set Up Scheduled Recordings

You can schedule recordings in two ways:

#### Option A: Via Web Interface (Recommended)

1. Access the web interface at `http://your-truenas-ip:3000`
2. Navigate to the Cron Scheduler section
3. Click "Add Cron Job"
4. Configure:
   - **ID:** Unique identifier (e.g., "morning_show")
   - **Cron Expression:** `0 8 * * *` (daily at 8:00 AM)
   - **Stream URL:** Your SATIP stream URL
   - **Name:** Recording name (e.g., "morning_show")
   - **Duration (optional):** Minutes to record (leave empty for unlimited)
5. Click "Save"

#### Option B: Via Cron JSON File

Edit `/mnt/poolname/datasetname/recordings/cron.json`:

```json
{
  "jobs": [
    {
      "id": "morning_show",
      "cron": "0 8 * * *",
      "streamUrl": "http://your-satip-server/?params",
      "name": "morning_show",
      "durationMinutes": 60
    }
  ]
}
```

The container will automatically load and schedule these jobs on startup.

### Example Cron Schedules

| Description | Cron Expression |
|-------------|----------------|
| Daily at 8 AM | `0 8 * * *` |
| Daily at 8 PM | `0 20 * * *` |
| Weekdays at 6 PM | `0 18 * * 1-5` |
| Saturdays at 10 AM | `0 10 * * 6` |

### View Cron Logs

```bash
# View container logs
docker logs streamrecorder

# Follow logs in real-time
docker logs -f streamrecorder
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STREAM_URL` | No | - | Default SATIP stream URL (can be overridden per recording) |
| `TIMEZONE` | No | Europe/Vienna | IANA timezone for timestamps (with DST support) |
| `OUTPUT_DIR` | No | `/recordings` | Directory where recordings are saved |
| `PORT` | No | `3000` | Port for web interface |

## Accessing Recordings via SMB

After each recording completes, files are organized as:

```
/recordings/
├── morning_show_20241018_080000.mp3  (timestamped recording)
├── morning_show_20241019_080000.mp3  (timestamped recording)
└── links/
    └── morning_show.mp3 → ../morning_show_20241019_080000.mp3  (latest)
```

**Use Case:** Access the latest recordings via SMB share with a static filename.

**Example SMB paths:**
```
\\truenas\recordings\links\morning_show.mp3  ← Always the latest recording
\\truenas\recordings\links\evening_news.mp3  ← Always the latest recording
```

The symlink in the `links` folder is automatically updated after each successful recording, so your media player or app can always access the latest recording using the same path.

## Technical Details

### Audio Encoding
- **Format:** MP3
- **Bitrate:** 192 kbps
- **Sample Rate:** 48 kHz
- **Codec:** libmp3lame
- **Video:** Disabled (`-vn` flag)

### Process Management
- **ffmpeg Processes:** Spawned as detached child processes (survive parent death)
- **Process Discovery:** Uses `ps -eo pid,args | grep ffmpeg` as source of truth
- **State Persistence:** JSON file (`.recordings_state.json`) for metadata only
- **State Synchronization:** State file synced with `ps` output on every API call
- **Orphan Cleanup:** Processes running but not in state file are automatically killed
- **Dead Process Cleanup:** State entries for non-running processes are removed
- **Graceful Shutdown:** SIGTERM → 2s wait → SIGKILL

### Security
- **Input Validation:** Name field restricted to `[a-zA-Z0-9]+`
- **Path Sanitization:** Filenames generated server-side (no user input in paths)
- **Process Isolation:** Each recording is separate process

### Performance
- **Concurrent Recordings:** Limited by system resources (CPU, disk I/O, network)
- **Memory Usage:** ~50-100MB per ffmpeg process
- **State Polling:** UI polls every 2 seconds (configurable in frontend)

### Container Behavior
- **Web Mode:** Runs as persistent service (restart: `unless-stopped`)
- **Default User:** UID 568 (TrueNAS apps user) - set via docker-compose or `--user` flag

## Rainy Day Scenarios & Edge Cases

### Multiple Recordings

**Scenario**: Starting multiple recordings simultaneously

**Behavior**:
- ✅ Multiple recordings with **different names** can run concurrently
- ✅ Each recording is tracked independently
- ✅ All active recordings are displayed in the UI
- ❌ Starting a recording with an **existing name** returns error: "Recording with this name is already in progress"
- ✅ Each recording can be stopped individually
- ✅ "Stop All" button stops all recordings at once

**Example**:
```javascript
// Start recording 1
POST /api/record/start { "streamUrl": "http://...", "name": "show1" }
// Start recording 2 (different name - OK)
POST /api/record/start { "streamUrl": "http://...", "name": "show2" }
// Try to start recording 1 again (same name - ERROR)
POST /api/record/start { "streamUrl": "http://...", "name": "show1" }
// Returns: 400 { "error": "Recording with this name is already in progress" }
```

### Browser Closed Without Stopping

**Scenario**: User starts recording, then closes browser tab/window

**Behavior**:
- ✅ **Recording continues running** - ffmpeg process is child of Node.js server, not browser
- ✅ State is persisted to `.recordings_state.json` file
- ✅ When browser is reopened, UI automatically detects and displays active recordings
- ✅ User can stop recording from UI even after browser was closed
- ✅ Duration continues to update in real-time

**State File Location**: `<OUTPUT_DIR>/.recordings_state.json`

**State File Format**:
```json
{
  "recordings": [
    {
      "name": "morning_show",
      "outputPath": "/recordings/streamrecording_morning_show_20241218143025.mp3",
      "startTime": "2024-12-18T14:30:25.123Z",
      "streamUrl": "http://...",
      "pid": 12345
    }
  ],
  "lastUpdated": "2024-12-18T14:35:00.456Z"
}
```

### Server Restart During Recording

**Scenario**: Container/server restarts while recordings are active

**Behavior**:
- ✅ **ffmpeg processes survive** - they're detached and adopted by PID 1 (init)
- ✅ **Recordings continue** - processes keep running independently
- ✅ Server syncs state with `ps` output on startup
- ✅ Processes found in `ps` but not in state file are killed (orphaned cleanup)
- ✅ State entries for processes not found in `ps` are removed (dead cleanup)
- ✅ Surviving processes are tracked and can be managed via web interface

**Recovery**:
- Server automatically detects running processes via `ps` on startup
- State file is synced with actual running processes
- All active recordings are immediately available in web interface
- No manual intervention needed

### Invalid Input Validation

**Scenario**: User enters invalid name or missing fields

**Behavior**:
- ❌ **Empty name or URL**: Returns `400 { "error": "Stream URL and name are required" }`
- ❌ **Invalid name characters** (spaces, special chars): Returns `400 { "error": "Name must contain only letters and numbers" }`
- ✅ **Valid name**: Must match regex `^[a-zA-Z0-9]+$` (letters and numbers only)
- ✅ **Frontend validation**: Real-time validation as user types
- ✅ **Backend validation**: Server validates again (defense in depth)

**Valid Examples**: `morning_show`, `Show123`, `ABC123`
**Invalid Examples**: `morning show` (space), `show-123` (hyphen), `show_123` (underscore)

### Network/Stream Failures

**Scenario**: Stream URL becomes unreachable during recording

**Behavior**:
- ⚠️ ffmpeg process will fail and terminate
- ✅ Next status check syncs state with `ps` and detects process is gone
- ✅ State file is automatically updated (recording removed)
- ⚠️ **Partial file may exist** - check output directory
- ⚠️ **No automatic retry** - user must manually restart recording

**Detection**:
- Check server logs: `docker logs streamrecorder`
- Look for: `Error starting recording "name": <error>` or `Process X (name) is no longer running, removing from state`
- Check state file: processes that died will be removed on next sync

### Disk Space Full

**Scenario**: Output directory runs out of disk space

**Behavior**:
- ⚠️ ffmpeg will fail when trying to write
- ✅ Process exits with error code
- ✅ Next status check syncs state with `ps` and detects process is gone
- ✅ State file automatically cleaned up (recording removed)
- ⚠️ **Partial/corrupted file may exist**
- ⚠️ **No disk space monitoring** - user must monitor manually

**Prevention**:
- Monitor disk usage: `df -h /recordings`
- Set up disk space alerts
- Implement log rotation or cleanup of old recordings

### Process Kill Failures

**Scenario**: SIGTERM doesn't stop ffmpeg process

**Behavior**:
- ✅ Server sends SIGTERM first (graceful shutdown)
- ✅ Waits 2 seconds
- ✅ If process still running, sends SIGKILL (force kill)
- ✅ Process is removed from state file on next sync with `ps`
- ⚠️ **Zombie process possible** if SIGKILL also fails (rare)

### Concurrent Stop Requests

**Scenario**: Multiple users try to stop same recording simultaneously

**Behavior**:
- ✅ First request succeeds and kills the process by PID
- ✅ Subsequent requests return `404 { "error": "No active recording found with this name" }` (process already stopped)
- ✅ State file synced with `ps` on each request, so dead processes are removed
- ✅ No race conditions - process can only be killed once

### State File Corruption

**Scenario**: `.recordings_state.json` becomes corrupted or unreadable

**Behavior**:
- ✅ Server catches JSON parse errors
- ✅ Logs error but continues running
- ✅ Returns empty array from `loadStateFile()`
- ✅ **All running processes are still discovered via `ps`**
- ✅ Orphaned processes (running but not in state) are killed automatically
- ⚠️ **Note**: Since state file is empty, all running ffmpeg processes will be treated as orphaned and killed

**Recovery**:
- Delete corrupted state file: `rm /recordings/.recordings.json`
- Restart container if needed
- State will be regenerated on next recording start
- **Warning**: Any running recordings will be killed on next sync (treated as orphaned)

### Port Already in Use

**Scenario**: Port 3000 is already occupied

**Behavior**:
- ❌ Server fails to start with EADDRINUSE error
- ✅ Check logs: `docker logs streamrecorder`
- ✅ Solution: Change port via `PORT` environment variable

**Fix**:
```bash
docker compose down
# Edit docker-compose.yml: change ports to "3001:3000"
# Or set PORT=3001 in environment
docker compose up -d
```

### ffmpeg Not Found

**Scenario**: ffmpeg binary is missing or not in PATH

**Behavior**:
- ❌ Process spawn fails with 'ENOENT' error
- ✅ Server catches error and returns error response
- ✅ Recording not added to state file
- ⚠️ **Check**: Ensure Dockerfile installs ffmpeg correctly

## Troubleshooting

### Permission Denied

If you see permission errors:

```bash
sudo chown -R 568:568 /mnt/poolname/datasetname/recordings
sudo chmod -R 755 /mnt/poolname/datasetname/recordings
```

### No Output File

- Check permissions on recording directory
- Verify stream URL is accessible
- Check server logs: `docker logs streamrecorder`
- Verify ffmpeg is installed: `docker exec streamrecorder which ffmpeg`

### Recording Doesn't Stop

- Check if process is still running: `docker exec streamrecorder ps aux | grep ffmpeg`
- Check state file: `docker exec streamrecorder cat /recordings/.recordings_state.json`
- Manually kill process if needed: `docker exec streamrecorder killall ffmpeg` or `docker exec streamrecorder kill <PID>`
- Check server logs for errors: `docker logs streamrecorder`
- State should sync automatically on next status check

### Web Interface Not Accessible

- Verify container is running: `docker ps | grep streamrecorder`
- Check port mapping: `docker port streamrecorder`
- Check firewall settings
- Verify port is not blocked: `curl http://localhost:3000/api/health`

### Wrong Timestamp

Verify timezone is set correctly in environment variables or via the web interface.

### State File Issues

- View state file: `cat /recordings/.recordings_state.json`
- Delete state file to reset: `rm /recordings/.recordings_state.json`
- Check file permissions: `ls -la /recordings/.recordings_state.json`
- **Note**: State file is metadata only - actual process tracking uses `ps` command
- If state file is missing, server will still discover running processes via `ps` (but may kill them as orphaned)

## Building Locally

```bash
git clone https://github.com/ralf31337/streamrecorder.git
cd streamrecorder
docker build -t streamrecorder .
docker compose up -d
```

## Docker Compose Configuration

The `docker-compose.yml` file configures the service for web interface mode:

```yaml
services:
  streamrecorder:
    build: .
    ports:
      - "3000:3000"  # Web interface port
    environment:
      - OUTPUT_DIR=/recordings
      - PORT=3000
    volumes:
      - ./recordings:/recordings
    restart: unless-stopped  # Keeps service running
```

**Key Features:**
- `restart: unless-stopped` keeps the service running
- Port mapping for web interface
- Built-in cron scheduler for scheduled recordings

## License

This project is provided as-is for personal use.
