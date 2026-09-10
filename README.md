# CLI Music App

An interactive terminal music player for MP3 files in the `songs/` folder.

## Features

- Navigate the library with the Up and Down arrow keys.
- Play the selected song with Enter.
- Pause and resume playback with Space.
- Display each track's duration.
- Show a live elapsed-time and percentage progress bar.
- Stop previous playback and timers safely when changing songs or quitting.
- Keep the terminal interface clean by redrawing a single screen.

## Requirements

- Node.js
- macOS — the app uses the built-in `afinfo` command to read MP3 durations.
- [mpv](https://mpv.io/) — used for dependable playback and pause/resume control.

Install `mpv` on macOS with Homebrew:

```bash
brew install mpv
```

## Run the app

From the project folder, run:

```bash
node player.js
```

Place supported `.mp3` files inside the `songs/` directory before starting the player.

## Controls

| Key | Action |
| --- | --- |
| Up Arrow | Select the previous song |
| Down Arrow | Select the next song |
| Enter | Play the selected song |
| Space | Pause or resume the current song |
| Q / Ctrl+C | Stop playback and quit |

## Project structure

```text
musicApp/
├── player.js       # Library, rendering, playback, and cleanup logic
├── handleKey.js    # Raw terminal key handling
├── songs/          # MP3 music files
└── README.md
```

## How it works

`player.js` reads the MP3 files from `songs/`, loads their durations, and renders the terminal UI. `handleKey.js` translates keyboard input into actions. Playback is handled by `mpv` through a local control socket, which allows the player to pause and resume without leaving old audio processes or timers running.
