const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { bindKeys } = require('./handleKey');

const songsDirectory = path.join(__dirname, 'songs');
const songs = fs.readdirSync(songsDirectory)
  .filter((file) => path.extname(file).toLowerCase() === '.mp3')
  .sort((a, b) => a.localeCompare(b))
  .map((file) => ({ file, title: path.basename(file, path.extname(file)), duration: null }));

let selected = 0;
let current = null;
let childProcess = null;
let isPaused = false;
let startedAt = 0;
let elapsedBeforePause = 0;
let renderTimer = null;
let quitting = false;
let ipcSocketPath = null;

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const rounded = Math.max(0, Math.floor(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function elapsed() {
  if (current === null) return 0;
  return isPaused ? elapsedBeforePause : elapsedBeforePause + (Date.now() - startedAt) / 1000;
}

function progressBar(value, width = 32) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function progressLine(track) {
  const position = elapsed();
  const duration = track?.duration;
  const percent = duration ? Math.min(100, Math.floor((position / duration) * 100)) : 0;
  return `[${progressBar(duration ? position / duration : 0)}] ${String(percent).padStart(3, ' ')}%  ${formatTime(position)} / ${formatTime(duration)}`;
}

function songLine(song, index) {
  return `${index === selected ? '❯' : ' '} ${String(index + 1).padStart(2, ' ')}. ${song.title}  ${formatTime(song.duration)}`;
}

function render() {
  const track = current === null ? null : songs[current];
  const state = !track ? 'Stopped' : isPaused ? 'Paused' : 'Playing';
  const lines = [
    '🎶 Songs App',
    '↑/↓ navigate  •  Enter play  •  Space pause/resume  •  Q quit',
    '',
    ...songs.map(songLine),
    '',
    track ? `${state}: ${track.title}` : 'Select a song and press Enter.',
    track ? progressLine(track) : '',
  ];

  process.stdout.write('\x1b[?25l\x1b[H\x1b[2J');
  process.stdout.write(lines.join('\n'));
}

function startProgressUpdates() {
  if (!renderTimer) renderTimer = setInterval(render, 250);
}

function stopProgressUpdates() {
  if (renderTimer) clearInterval(renderTimer);
  renderTimer = null;
}

function removeIpcSocket() {
  if (ipcSocketPath && fs.existsSync(ipcSocketPath)) fs.unlinkSync(ipcSocketPath);
  ipcSocketPath = null;
}

function sendMpvCommand(command) {
  const socketPath = ipcSocketPath;
  const connect = (attemptsRemaining) => {
    if (!socketPath) return;
    const connection = net.createConnection(socketPath);
    connection.once('connect', () => connection.end(`${JSON.stringify({ command })}\n`));
    connection.once('error', () => {
      connection.destroy();
      if (attemptsRemaining > 0) setTimeout(() => connect(attemptsRemaining - 1), 50);
    });
  };
  connect(10);
}

function stopPlayback() {
  if (childProcess) {
    childProcess.removeAllListeners('close');
    childProcess.kill('SIGTERM');
    childProcess = null;
  }
  removeIpcSocket();
  current = null;
  isPaused = false;
  elapsedBeforePause = 0;
}

function playSelected() {
  stopPlayback();
  current = selected;
  startedAt = Date.now();
  startProgressUpdates();
  ipcSocketPath = path.join(os.tmpdir(), `music-player-${process.pid}-${Date.now()}.sock`);
  const playerProcess = spawn('mpv', [
    '--no-video',
    '--really-quiet',
    `--input-ipc-server=${ipcSocketPath}`,
    path.join(songsDirectory, songs[current].file),
  ], { stdio: 'ignore' });
  childProcess = playerProcess;

  playerProcess.on('error', (error) => {
    if (childProcess !== playerProcess) return;
    stopPlayback();
    stopProgressUpdates();
    process.stdout.write(`\nUnable to start mpv: ${error.message}\n`);
    render();
  });
  playerProcess.on('close', () => {
    if (childProcess !== playerProcess) return;
    childProcess = null;
    removeIpcSocket();
    if (quitting) return;
    current = null;
    isPaused = false;
    elapsedBeforePause = 0;
    stopProgressUpdates();
    render();
  });
  render();
}

function togglePause() {
  if (!childProcess) return;
  if (!isPaused) {
    elapsedBeforePause = elapsed();
    isPaused = true;
  } else {
    startedAt = Date.now();
    isPaused = false;
  }
  sendMpvCommand(['set_property', 'pause', isPaused]);
  render();
}

function quit() {
  quitting = true;
  stopProgressUpdates();
  stopPlayback();
  process.stdout.write('\x1b[?25h\x1b[2J\x1b[HThanks for listening!\n');
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

function readDuration(song) {
  return new Promise((resolve) => {
    const info = spawn('afinfo', [path.join(songsDirectory, song.file)]);
    let output = '';
    info.stdout.on('data', (data) => { output += data; });
    info.stderr.on('data', (data) => { output += data; });
    info.on('close', () => {
      const match = output.match(/estimated duration:\s*([\d.]+)/i);
      song.duration = match ? Number(match[1]) : null;
      resolve();
    });
    info.on('error', () => resolve());
  });
}

async function start() {
  if (!songs.length) return console.log('No MP3 files found in the songs folder.');
  if (!process.stdin.isTTY) return console.error('This player needs to be run in an interactive terminal.');

  // Load metadata first so the interface is drawn once with complete durations.
  await Promise.all(songs.map(readDuration));

  process.stdin.setRawMode(true);
  process.stdin.resume();
  bindKeys(process.stdin, {
    up: () => {
      selected = (selected - 1 + songs.length) % songs.length;
      render();
    },
    down: () => {
      selected = (selected + 1) % songs.length;
      render();
    },
    enter: playSelected,
    space: togglePause,
    quit,
  });
  process.on('SIGINT', quit);
  process.on('exit', () => process.stdout.write('\x1b[?25h'));

  render();
}
start();
