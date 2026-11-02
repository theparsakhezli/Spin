# Spin

A minimal music player for the music folder you already have. Open a folder, press play, and spin the record with your mouse to move through the song.

No accounts, no cloud, no library to organise. Everything Spin learns stays on your computer.

[![Spin in 16 seconds. Select to watch with sound.](docs/spin-promo.gif)](docs/spin-promo.mp4)

![The Spin widget](docs/widget.png)

![The style panel, with the record gallery](docs/style-panel.png)

## Download

Get the latest build from the [Releases](../../releases) page.

| System | File | Notes |
|---|---|---|
| Windows | `Spin-x.y.z-win-x64.exe` | The installer isn't code-signed, so SmartScreen may warn you. Choose **More info**, then **Run anyway**. |
| macOS (Apple silicon) | `Spin-x.y.z-mac-arm64.dmg` | See [Opening on macOS](#opening-on-macos). |
| macOS (Intel) | `Spin-x.y.z-mac-x64.dmg` | See [Opening on macOS](#opening-on-macos). |
| Debian, Ubuntu | `Spin-x.y.z-linux-amd64.deb` | `sudo apt install ./Spin-*.deb` |
| Other Linux | `Spin-x.y.z-linux-x86_64.AppImage` | `chmod +x Spin-*.AppImage`, then run it. Also available as `.tar.gz`. |

### Opening on macOS

Builds aren't notarized, because that requires a paid Apple Developer account. macOS will refuse to open the app at first. To allow it, drag Spin to Applications and run:

```sh
xattr -cr /Applications/Spin.app
```

## What it does

- **Spin to seek.** Drag the record to scrub, flick it to coast, and click it to pause. Letting go spins the audio back up like a real turntable.
- **A small widget or a big screen.** It opens as a small always-on-top window. Press `e` for the full view.
- **Learns from you.** Shuffle favours songs you finish, plays fewer of the ones you skip, and leans towards what you usually play at this hour. Each song remembers its own volume.
- **37 record styles.** Vinyl, CD, cassette, neon, a dozen animated ones that react to the music, any emoji or text, or your own image.
- **Your GIFs and videos.** Animated GIF, WebP and PNG, plus MP4 and WebM loops, on the record or as the background.
- **Restyle everything.** Colours, fonts (installed or your own files), ring shape, glow and presets. Save, export and share your styles.
- **Skin import.** Drop a zip-based skin you own (`.wsz`, `.wal`, `.vlt`, `.zip`) to extract its images and, for Winamp-style skins, its colours.
- **Marks and stickers.** Mark moments in a song and the record snaps to them. Put a sticker on the label. Played-to-death songs look worn.
- **Game mode.** Shrinks to just the record while a game has focus, with its own volume level.
- **Global hotkeys, crates and a year in review.** Switch between named folders, and see your own listening stats.

## Keys

Every main control has a button, and these shortcuts do the same things.

| Key | Action | Key | Action |
|---|---|---|---|
| `space` | play / pause | `t` | style panel |
| `n` / `p` | next / previous | `e` | widget / full view |
| `←` `→` | seek 5 seconds | `q` | queue |
| `↑` `↓` | volume | `/` | filter tracks |
| `s` | shuffle | `c` | crates |
| `r` | repeat | `y` | your year |
| `m` | mute | `g` | game mode |
| `b` | mark this moment | `[` `]` | jump between marks |
| `o` | open a folder | `?` | all keys |

Press `,` to open `settings.json`, where you can change your name, global hotkeys and game list. Changes apply when you save.

Default global hotkeys use `Ctrl+Alt` on Windows and macOS, and `Ctrl+Alt+Shift` on Linux, where desktops often use `Ctrl+Alt+arrows` for workspaces.

## Platform differences

| Feature | Windows | macOS | Linux (X11) | Linux (Wayland) |
|---|---|---|---|---|
| Game mode from your games list | Yes | Yes | Yes | Press `g` |
| Game mode for any fullscreen app | Yes | Press `g` | Yes | Press `g` |
| Always on top | Yes | Yes | Depends on the window manager | Often ignored by the compositor |
| Global hotkeys | Yes | Yes | Yes | Depends on the desktop |

Linux game detection needs `xprop`, which most X11 desktops include.

If the AppImage won't start on a recent Ubuntu, the system is blocking Chromium's sandbox. Use the `.deb` instead.

## Formats

Plays what Chromium plays: MP3, FLAC, AAC/M4A, Ogg Vorbis, Opus, WAV and WebM. Apple Lossless (ALAC) `.m4a` files aren't supported and get skipped. Titles and cover art come from ID3, FLAC, Vorbis and M4A tags, and WAV files can provide titles. Files with no tags use the filename (`Artist - Title.mp3`). Tracks stream from disk, so long mixes are fine.

## Run from source

Requires [Node.js](https://nodejs.org) 20 or newer.

```sh
npm ci
npm start
```

`index.html` also runs on its own in Chrome or Edge, without the desktop-only features.

If you see `bad option` errors from a VS Code terminal, run `unset ELECTRON_RUN_AS_NODE` first (PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`).

```sh
npm test            # end-to-end test against generated audio (Linux without a display: xvfb-run -a npm test)
npm run dist        # build installers for the current system
```

The whole player is three files: `index.html` (interface, audio and drawing), `main.js` (window, files and system integration) and `preload.js` (the narrow bridge between them). There are no runtime dependencies.

## Contributing

Issues and pull requests are welcome. Please run `npm test` first, and keep the main window uncluttered: new features should stay invisible until someone wants them.

Testing on real macOS and Linux desktops is especially useful, including Wayland and tiling window managers. Reports from real games are welcome on every system.

## Privacy

Spin makes no network requests of its own. Listening history, marks and styles are stored in your user data folder (`memory.json`, `settings.json` and the app's browser storage).

## Credits and license

[MIT](LICENSE). Built with [Electron](https://www.electronjs.org).

Spin isn't affiliated with Winamp, VLC or any other player. It includes none of their artwork, and skins you import stay on your computer. Only import skins you have the right to use.
