const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Path to persistence file
const STATE_FILE = path.join(process.env.OUTPUT_DIR || '/recordings', '.recordings_state.json');

// Load persisted state from file
function loadStateFile() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      const state = JSON.parse(data);
      return state.recordings || [];
    }
  } catch (error) {
    console.error('Error loading state file:', error);
  }
  return [];
}

// Save state to file
function saveStateFile(recordings) {
  try {
    const state = {
      recordings: recordings,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Error saving state file:', error);
  }
}

// Get running ffmpeg processes from ps
async function getRunningFfmpegProcesses() {
  try {
    // Get all ffmpeg processes with PID and command line
    // Format: PID COMMAND (we'll parse the output path from command)
    const { stdout } = await execAsync('ps -eo pid,args | grep "[f]fmpeg"');
    const lines = stdout.trim().split('\n').filter(line => line.trim());
    
    const processes = [];
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (match) {
        const pid = parseInt(match[1]);
        const args = match[2];
        // Extract output file path from ffmpeg command
        const outputMatch = args.match(/streamrecording_([^_\s]+)_\d+\.mp3/);
        if (outputMatch) {
          processes.push({
            pid: pid,
            name: outputMatch[1], // Extract name from filename
            args: args
          });
        }
      }
    }
    return processes;
  } catch (error) {
    // grep returns non-zero if no matches found, which is fine
    if (error.code === 1) {
      return []; // No ffmpeg processes running
    }
    // Check if ps command is missing
    if (error.message && error.message.includes('ps: not found')) {
      console.error('ERROR: ps command not found. Please install procps package in the container.');
      console.error('This is required for process management. Recordings may be running but cannot be tracked.');
    }
    console.error('Error getting ffmpeg processes:', error.message || error);
    return [];
  }
}

// Sync state file with actual running processes
async function syncStateWithPs() {
  const runningProcesses = await getRunningFfmpegProcesses();
  const stateRecordings = loadStateFile();
  
  const runningPids = new Set(runningProcesses.map(p => p.pid));
  const statePids = new Set(stateRecordings.map(r => r.pid));
  
  // Kill processes that are running but not in state file (orphaned)
  for (const proc of runningProcesses) {
    if (!statePids.has(proc.pid)) {
      console.log(`⚠️  Found orphaned ffmpeg process (PID ${proc.pid}), killing it...`);
      try {
        process.kill(proc.pid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(proc.pid, 'SIGKILL');
          } catch (e) {
            // Process already dead
          }
        }, 2000);
      } catch (error) {
        console.error(`Error killing orphaned process ${proc.pid}:`, error);
      }
    }
  }
  
  // Remove state entries for processes that no longer exist
  const cleanedRecordings = stateRecordings.filter(recording => {
    const stillRunning = runningPids.has(recording.pid);
    if (!stillRunning) {
      console.log(`✓ Process ${recording.pid} (${recording.name}) is no longer running, removing from state.`);
    }
    return stillRunning;
  });
  
  // Update state file if it changed
  if (cleanedRecordings.length !== stateRecordings.length) {
    if (cleanedRecordings.length === 0) {
      // Remove state file if no recordings
      try {
        if (fs.existsSync(STATE_FILE)) {
          fs.unlinkSync(STATE_FILE);
        }
      } catch (error) {
        console.error('Error removing empty state file:', error);
      }
    } else {
      saveStateFile(cleanedRecordings);
    }
  }
  
  return cleanedRecordings;
}

// Get current active recordings (synced with ps)
async function getActiveRecordings() {
  await syncStateWithPs();
  return loadStateFile();
}

// Validate name (letters and numbers only)
function validateName(name) {
  return /^[a-zA-Z0-9]+$/.test(name);
}

// Generate filename with timestamp
function generateFilename(name) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `streamrecording_${name}_${year}${month}${day}${hours}${minutes}${seconds}.mp3`;
}

// Start recording endpoint
app.post('/api/record/start', async (req, res) => {
  const { streamUrl, name } = req.body;

  // Validation
  if (!streamUrl || !name) {
    return res.status(400).json({ error: 'Stream URL and name are required' });
  }

  if (!validateName(name)) {
    return res.status(400).json({ error: 'Name must contain only letters and numbers' });
  }

  // Check if already recording with this name
  const activeRecordings = await getActiveRecordings();
  if (activeRecordings.some(r => r.name === name)) {
    return res.status(400).json({ error: 'Recording with this name is already in progress' });
  }

  // Generate output filename
  const outputDir = process.env.OUTPUT_DIR || '/recordings';
  const filename = generateFilename(name);
  const outputPath = path.join(outputDir, filename);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Build ffmpeg command
  // Note: -flush_packets 1 and -fflags +flush_packets force immediate writing to disk
  const ffmpegCmd = [
    'ffmpeg',
    '-re',
    '-i', streamUrl,
    '-vn',  // No video
    '-acodec', 'libmp3lame',
    '-ar', '48000',  // Audio sample rate
    '-b:a', '192k',  // Audio bitrate
    '-f', 'mp3',
    '-fflags', '+flush_packets',  // Flush output packets immediately
    '-flush_packets', '1',  // Flush packets immediately (write to disk in real-time)
    outputPath
  ];

  // Spawn ffmpeg process with detached option to survive parent death
  const ffmpegProcess = spawn(ffmpegCmd[0], ffmpegCmd.slice(1), {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true  // Process becomes independent, survives parent death
  });
  
  // Unref the process so Node.js can exit independently
  ffmpegProcess.unref();

  // Store process info in state file
  const startTime = new Date();
  const stateRecordings = loadStateFile();
  stateRecordings.push({
    name: name,
    outputPath: outputPath,
    startTime: startTime.toISOString(),
    streamUrl: streamUrl,
    pid: ffmpegProcess.pid
  });
  saveStateFile(stateRecordings);

  // Handle process events (for immediate feedback, but process will survive if Node.js dies)
  let stderrOutput = '';
  ffmpegProcess.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  ffmpegProcess.on('exit', (code, signal) => {
    console.log(`Recording "${name}" finished with code ${code}, signal ${signal}`);
    // Clean up state file
    syncStateWithPs();
  });

  ffmpegProcess.on('error', (error) => {
    console.error(`Error starting recording "${name}":`, error);
    // Clean up state file
    syncStateWithPs();
  });

  res.json({
    success: true,
    message: 'Recording started',
    name: name,
    outputPath: outputPath
  });
});

// Stop recording endpoint
app.post('/api/record/stop', async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const recordings = await getActiveRecordings();
  const recording = recordings.find(r => r.name === name);
  
  if (!recording) {
    return res.status(404).json({ error: 'No active recording found with this name' });
  }

  // Kill process by PID
  try {
    process.kill(recording.pid, 'SIGTERM');
    setTimeout(() => {
      try {
        process.kill(recording.pid, 'SIGKILL');
      } catch (e) {
        // Process already dead
      }
    }, 2000);
  } catch (error) {
    console.error(`Error killing process ${recording.pid}:`, error);
  }

  // Sync state to remove the stopped recording
  await syncStateWithPs();

  res.json({
    success: true,
    message: 'Recording stopped',
    name: name,
    outputPath: recording.outputPath
  });
});

// Stop all recordings endpoint
app.post('/api/record/stop-all', async (req, res) => {
  const recordings = await getActiveRecordings();
  const stopped = [];
  
  for (const recording of recordings) {
    try {
      process.kill(recording.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(recording.pid, 'SIGKILL');
        } catch (e) {
          // Process already dead
        }
      }, 2000);
      stopped.push({ name: recording.name, outputPath: recording.outputPath });
    } catch (error) {
      console.error(`Error stopping recording "${recording.name}":`, error);
    }
  }
  
  // Sync state to remove all stopped recordings
  await syncStateWithPs();

  res.json({
    success: true,
    message: `Stopped ${stopped.length} recording(s)`,
    stopped: stopped
  });
});

// Get recording status
app.get('/api/record/status', async (req, res) => {
  const { name } = req.query;

  const recordings = await getActiveRecordings();

  if (name) {
    const recording = recordings.find(r => r.name === name);
    if (!recording) {
      return res.json({ active: false });
    }
    return res.json({
      active: true,
      name: recording.name,
      outputPath: recording.outputPath,
      startTime: recording.startTime,
      streamUrl: recording.streamUrl
    });
  }

  // Return all active recordings
  res.json({ activeRecordings: recordings });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Sync state on startup
syncStateWithPs().then(() => {
  console.log('State synchronized with running processes');
}).catch(err => {
  console.error('Error syncing state on startup:', err);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Stream Recorder Web Interface running on port ${PORT}`);
});

