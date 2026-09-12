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

const style = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
};

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
  return `${style.cyan}${'█'.repeat(filled)}${style.gray}${'░'.repeat(width - filled)}${style.reset}`;
}

function progressLine(track) {
  const position = elapsed();
  const duration = track?.duration;
  const percent = duration ? Math.min(100, Math.floor((position / duration) * 100)) : 0;
  return `${style.gray}Progress ${style.reset}[${progressBar(duration ? position / duration : 0)}] ${style.bold}${String(percent).padStart(3, ' ')}%${style.reset}  ${style.gray}${formatTime(position)} / ${formatTime(duration)}${style.reset}`;
}

function songLine(song, index) {
  const number = String(index + 1).padStart(2, '0');
  const duration = formatTime(song.duration);
  if (index === selected) {
    return `${style.cyan}${style.bold}❯ ${number}  ${song.title}${style.reset}  ${style.gray}${duration}${style.reset}`;
  }
  return `${style.gray}  ${number}${style.reset}  ${song.title}  ${style.gray}${duration}${style.reset}`;
}

function render() {
  const lines = [
    `${style.cyan}${style.bold}♫  MUSIC LIBRARY${style.reset}`,
    `${style.dim}↑/↓ Browse   ↵ Play   Space Pause/Resume   Q Quit${style.reset}`,
    `${style.gray}${'─'.repeat(52)}${style.reset}`,
    ...songs.map(songLine),
    '',
    `${style.dim}Select a song and press Enter.${style.reset}`,
    '',
  ];

  process.stdout.write('\x1b[?25l\x1b[H\x1b[2J');
  process.stdout.write(lines.join('\n'));
}

function writeRow(row, text) {
  process.stdout.write(`\x1b[${row};1H\x1b[2K${text}`);
}

function renderSelection(previousSelected) {
  for (const index of new Set([previousSelected, selected])) {
    writeRow(index + 4, songLine(songs[index], index));
  }
}

function renderPlayback() {
  const statusRow = songs.length + 5;
  const progressRow = songs.length + 6;
  const track = current === null ? null : songs[current];
  const status = !track
    ? `${style.dim}Select a song and press Enter.${style.reset}`
    : isPaused
      ? `${style.yellow}${style.bold}Ⅱ  PAUSED${style.reset}  ${track.title}`
      : `${style.green}${style.bold}▶  NOW PLAYING${style.reset}  ${track.title}`;

  writeRow(statusRow, status);
  writeRow(progressRow, track ? progressLine(track) : '');
}

function renderProgress() {
  if (current !== null) writeRow(songs.length + 6, progressLine(songs[current]));
}

function startProgressUpdates() {
  if (!renderTimer) renderTimer = setInterval(renderProgress, 250);
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
    renderPlayback();
    process.stderr.write(`Unable to start mpv: ${error.message}\n`);
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
    renderPlayback();
  });
  renderPlayback();
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
  renderPlayback();
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
      const previousSelected = selected;
      selected = (selected - 1 + songs.length) % songs.length;
      renderSelection(previousSelected);
    },
    down: () => {
      const previousSelected = selected;
      selected = (selected + 1) % songs.length;
      renderSelection(previousSelected);
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
