const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Path to persistence files
const STATE_FILE = path.join(process.env.OUTPUT_DIR || '/recordings', '.recordings_state.json');
const CRON_FILE = path.join(process.env.OUTPUT_DIR || '/recordings', 'cron.json');

// Store active cron jobs
const activeCronJobs = new Map();

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
        
        // Verify it's actually an ffmpeg process (not just grep matching)
        if (!args.includes('ffmpeg') || args.includes('grep')) {
          continue;
        }
        
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
  
  // Create a map of PID -> process info for quick lookup
  const runningProcessMap = new Map();
  runningProcesses.forEach(proc => {
    runningProcessMap.set(proc.pid, proc);
  });
  
  // Remove state entries for processes that no longer exist OR don't match
  const cleanedRecordings = stateRecordings.filter(recording => {
    const runningProc = runningProcessMap.get(recording.pid);
    
    if (!runningProc) {
      // PID not found in ps output - process has stopped
      console.log(`✓ Process ${recording.pid} (${recording.name}) is no longer running, removing from state.`);
      return false;
    }
    
    // Verify the process actually matches our recording (by name extracted from command line)
    if (runningProc.name !== recording.name) {
      // PID exists but belongs to a different recording - process has stopped and PID was reused
      console.log(`✓ Process ${recording.pid} (${recording.name}) PID was reused, removing from state.`);
      return false;
    }
    
    // Process is still running and matches
    return true;
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

// Create symbolic link in 'links' subdirectory (before recording starts)
// Creates links/{name}.mp3 -> ../{filename}
function createSymlink(outputDir, filename, name) {
  try {
    const linksDir = path.join(outputDir, 'links');
    
    // Create links directory if it doesn't exist
    if (!fs.existsSync(linksDir)) {
      fs.mkdirSync(linksDir, { recursive: true });
    }
    
    // Symlink path: links/{name}.mp3
    const symlinkPath = path.join(linksDir, `${name}.mp3`);
    
    // Remove existing symlink if it exists
    try {
      if (fs.existsSync(symlinkPath)) {
        const stats = fs.lstatSync(symlinkPath);
        if (stats.isSymbolicLink() || stats.isFile()) {
          fs.unlinkSync(symlinkPath);
        }
      }
    } catch (unlinkError) {
      // Ignore errors when removing old symlink
    }
    
    // Create symlink pointing to ../{filename} (the actual recording in parent directory)
    const targetPath = path.join('..', filename);
    fs.symlinkSync(targetPath, symlinkPath);
    
    console.log(`Symlink created: ${symlinkPath} -> ${targetPath}`);
  } catch (error) {
    // Don't fail the recording if symlink creation fails
    console.warn(`Could not create symlink: ${error.message}`);
  }
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

  // Create symbolic link before recording starts
  createSymlink(outputDir, filename, name);

  // Build ffmpeg command
  // Note: -flush_packets 1 and -fflags +flush_packets force immediate writing to disk
  // Parameters: -re, -i, -vn, -acodec libmp3lame, -ar 48000, -b:a 192k, -f mp3
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

// ==================== CRON SCHEDULER ====================

// Load cron schedule from file
function loadCronSchedule() {
  try {
    if (fs.existsSync(CRON_FILE)) {
      const data = fs.readFileSync(CRON_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading cron schedule:', error);
  }
  return { jobs: [] };
}

// Save cron schedule to file
function saveCronSchedule(schedule) {
  try {
    fs.writeFileSync(CRON_FILE, JSON.stringify(schedule, null, 2));
  } catch (error) {
    console.error('Error saving cron schedule:', error);
  }
}

// Start a recording (used by cron jobs)
async function startRecordingFromCron(streamUrl, name, durationMinutes = null) {
  try {
    // Check if already recording with this name
    const activeRecordings = await getActiveRecordings();
    if (activeRecordings.some(r => r.name === name)) {
      console.log(`Cron: Recording "${name}" already in progress, skipping`);
      return;
    }

    // Generate output filename
    const outputDir = process.env.OUTPUT_DIR || '/recordings';
    const filename = generateFilename(name);
    const outputPath = path.join(outputDir, filename);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create symbolic link before recording starts
    createSymlink(outputDir, filename, name);

    // Build ffmpeg command
    // Parameters: -re, -i, -t (if duration), -vn, -acodec libmp3lame, -ar 48000, -b:a 192k, -f mp3
    const ffmpegCmd = [
      'ffmpeg',
      '-re',
      '-i', streamUrl
    ];

    // Add duration limit if specified (before -vn)
    if (durationMinutes && durationMinutes > 0) {
      const durationSeconds = durationMinutes * 60;
      ffmpegCmd.push('-t', String(durationSeconds));
      console.log(`Cron: Recording "${name}" will stop automatically after ${durationMinutes} minutes`);
    }

    ffmpegCmd.push(
      '-vn',
      '-acodec', 'libmp3lame',
      '-ar', '48000',
      '-b:a', '192k',
      '-f', 'mp3',
      '-fflags', '+flush_packets',
      '-flush_packets', '1',
      outputPath
    );

    // Spawn ffmpeg process
    const ffmpegProcess = spawn(ffmpegCmd[0], ffmpegCmd.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    ffmpegProcess.unref();

    // Store in state file
    const startTime = new Date();
    const stateRecordings = loadStateFile();
    stateRecordings.push({
      name: name,
      outputPath: outputPath,
      startTime: startTime.toISOString(),
      streamUrl: streamUrl,
      pid: ffmpegProcess.pid,
      durationMinutes: durationMinutes || null
    });
    saveStateFile(stateRecordings);

    console.log(`Cron: Started recording "${name}" (PID ${ffmpegProcess.pid})${durationMinutes ? `, duration: ${durationMinutes} minutes` : ', no duration limit'}`);
  } catch (error) {
    console.error(`Cron: Error starting recording "${name}":`, error);
  }
}

// Schedule a cron job
function scheduleCronJob(jobId, cronExpression, streamUrl, name, durationMinutes = null) {
  // Validate cron expression
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }

  // Stop existing job if any
  if (activeCronJobs.has(jobId)) {
    activeCronJobs.get(jobId).stop();
    activeCronJobs.delete(jobId);
  }

  // Create new cron job
  const task = cron.schedule(cronExpression, () => {
    console.log(`Cron job "${jobId}" triggered: starting recording "${name}"${durationMinutes ? ` for ${durationMinutes} minutes` : ''}`);
    startRecordingFromCron(streamUrl, name, durationMinutes);
  }, {
    scheduled: true,
    timezone: process.env.TIMEZONE || 'Europe/Vienna'
  });

  activeCronJobs.set(jobId, task);
  console.log(`Scheduled cron job "${jobId}": ${cronExpression} -> ${name}`);
  console.log(`  Timezone: ${process.env.TIMEZONE || 'Europe/Vienna'}`);
  console.log(`  Next run will be calculated by node-cron`);
  
  // Test if the task is actually scheduled
  if (!task) {
    console.error(`ERROR: Failed to create cron task for job "${jobId}"`);
  } else {
    console.log(`  Cron task created successfully for job "${jobId}"`);
  }
}

// Load and start all cron jobs on startup
function loadAndStartCronJobs() {
  const schedule = loadCronSchedule();
  console.log(`Loading ${schedule.jobs.length} cron job(s) from ${CRON_FILE}`);
  
  if (schedule.jobs.length === 0) {
    console.log('No cron jobs found in schedule');
    return;
  }
  
  schedule.jobs.forEach(job => {
    try {
      const durationMinutes = job.durationMinutes || null;
      console.log(`Attempting to schedule job "${job.id}" with cron "${job.cron}"${durationMinutes ? `, duration: ${durationMinutes} minutes` : ', no duration limit'}`);
      scheduleCronJob(job.id, job.cron, job.streamUrl, job.name, durationMinutes);
    } catch (error) {
      console.error(`Error scheduling cron job "${job.id}":`, error);
      console.error(`  Cron expression: ${job.cron}`);
      console.error(`  Error details:`, error.message);
    }
  });
  
  console.log(`Total active cron jobs: ${activeCronJobs.size}`);
}

// API: Get cron schedule
app.get('/api/cron', (req, res) => {
  const schedule = loadCronSchedule();
  res.json(schedule);
});

// API: Add/Update cron job
app.post('/api/cron', (req, res) => {
  const { id, cron: cronExpression, streamUrl, name, durationMinutes } = req.body;

  if (!id || !cronExpression || !streamUrl || !name) {
    return res.status(400).json({ error: 'id, cron, streamUrl, and name are required' });
  }

  if (!validateName(name)) {
    return res.status(400).json({ error: 'Name must contain only letters and numbers' });
  }

  // Validate duration if provided
  const duration = durationMinutes ? parseInt(durationMinutes) : null;
  if (durationMinutes !== undefined && durationMinutes !== null) {
    if (isNaN(duration) || duration <= 0) {
      return res.status(400).json({ error: 'durationMinutes must be a positive number' });
    }
  }

  try {
    // Validate cron expression
    if (!cron.validate(cronExpression)) {
      return res.status(400).json({ error: `Invalid cron expression: ${cronExpression}` });
    }

    // Load current schedule
    const schedule = loadCronSchedule();
    
    // Update or add job
    const existingIndex = schedule.jobs.findIndex(j => j.id === id);
    const job = { 
      id, 
      cron: cronExpression, 
      streamUrl, 
      name,
      durationMinutes: duration
    };
    
    if (existingIndex >= 0) {
      schedule.jobs[existingIndex] = job;
    } else {
      schedule.jobs.push(job);
    }

    // Save and schedule
    saveCronSchedule(schedule);
    scheduleCronJob(id, cronExpression, streamUrl, name, duration);

    res.json({ success: true, message: 'Cron job saved and scheduled', job });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Delete cron job
app.delete('/api/cron/:id', (req, res) => {
  const { id } = req.params;

  // Stop the cron job
  if (activeCronJobs.has(id)) {
    activeCronJobs.get(id).stop();
    activeCronJobs.delete(id);
  }

  // Remove from schedule
  const schedule = loadCronSchedule();
  schedule.jobs = schedule.jobs.filter(j => j.id !== id);
  saveCronSchedule(schedule);

  res.json({ success: true, message: 'Cron job deleted' });
});

// API: Test/Trigger cron job manually (for debugging)
app.get('/api/cron/:id/test', (req, res) => {
  const { id } = req.params;
  const schedule = loadCronSchedule();
  const job = schedule.jobs.find(j => j.id === id);

  if (!job) {
    return res.status(404).json({ error: 'Cron job not found' });
  }

  console.log(`Manual trigger of cron job "${id}"`);
  const durationMinutes = job.durationMinutes || null;
  startRecordingFromCron(job.streamUrl, job.name, durationMinutes).then(() => {
    res.json({ success: true, message: `Manually triggered recording "${job.name}"${durationMinutes ? ` for ${durationMinutes} minutes` : ''}` });
  }).catch(error => {
    res.status(500).json({ error: error.message });
  });
});

// API: Get cron job status
app.get('/api/cron/status', (req, res) => {
  const schedule = loadCronSchedule();
  const status = {
    totalJobs: schedule.jobs.length,
    activeJobs: activeCronJobs.size,
    jobs: schedule.jobs.map(job => ({
      id: job.id,
      name: job.name,
      cron: job.cron,
      isActive: activeCronJobs.has(job.id)
    }))
  };
  res.json(status);
});

// ==================== END CRON SCHEDULER ====================

// Sync state on startup
syncStateWithPs().then(() => {
  console.log('State synchronized with running processes');
}).catch(err => {
  console.error('Error syncing state on startup:', err);
});

// Load and start cron jobs on startup
loadAndStartCronJobs();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Stream Recorder Web Interface running on port ${PORT}`);
});

