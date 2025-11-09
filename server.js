const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active recording processes
const activeRecordings = new Map();

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
app.post('/api/record/start', (req, res) => {
  const { streamUrl, name } = req.body;

  // Validation
  if (!streamUrl || !name) {
    return res.status(400).json({ error: 'Stream URL and name are required' });
  }

  if (!validateName(name)) {
    return res.status(400).json({ error: 'Name must contain only letters and numbers' });
  }

  // Check if already recording with this name
  if (activeRecordings.has(name)) {
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
  const ffmpegCmd = [
    'ffmpeg',
    '-re',
    '-i', streamUrl,
    '-vn',  // No video
    '-acodec', 'libmp3lame',
    '-ar', '48000',  // Audio sample rate
    '-b:a', '192k',  // Audio bitrate
    '-f', 'mp3',
    outputPath
  ];

  // Spawn ffmpeg process
  const ffmpegProcess = spawn(ffmpegCmd[0], ffmpegCmd.slice(1), {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Store process info
  activeRecordings.set(name, {
    process: ffmpegProcess,
    outputPath: outputPath,
    startTime: new Date(),
    streamUrl: streamUrl
  });

  // Handle process events
  let stderrOutput = '';
  ffmpegProcess.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  ffmpegProcess.on('exit', (code, signal) => {
    activeRecordings.delete(name);
    console.log(`Recording "${name}" finished with code ${code}, signal ${signal}`);
  });

  ffmpegProcess.on('error', (error) => {
    activeRecordings.delete(name);
    console.error(`Error starting recording "${name}":`, error);
  });

  res.json({
    success: true,
    message: 'Recording started',
    name: name,
    outputPath: outputPath
  });
});

// Stop recording endpoint
app.post('/api/record/stop', (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const recording = activeRecordings.get(name);
  if (!recording) {
    return res.status(404).json({ error: 'No active recording found with this name' });
  }

  // Kill the ffmpeg process
  recording.process.kill('SIGTERM');
  
  // Wait a bit, then force kill if still running
  setTimeout(() => {
    if (!recording.process.killed) {
      recording.process.kill('SIGKILL');
    }
  }, 2000);

  activeRecordings.delete(name);

  res.json({
    success: true,
    message: 'Recording stopped',
    name: name,
    outputPath: recording.outputPath
  });
});

// Get recording status
app.get('/api/record/status', (req, res) => {
  const { name } = req.query;

  if (name) {
    const recording = activeRecordings.get(name);
    if (!recording) {
      return res.json({ active: false });
    }
    return res.json({
      active: true,
      name: name,
      outputPath: recording.outputPath,
      startTime: recording.startTime,
      streamUrl: recording.streamUrl
    });
  }

  // Return all active recordings
  const recordings = Array.from(activeRecordings.entries()).map(([name, info]) => ({
    name: name,
    outputPath: info.outputPath,
    startTime: info.startTime,
    streamUrl: info.streamUrl
  }));

  res.json({ activeRecordings: recordings });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Stream Recorder Web Interface running on port ${PORT}`);
});

