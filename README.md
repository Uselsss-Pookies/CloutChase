# CloutChase – Retro Split-Screen Snake vs Pacman

Fast, polished, and playable in the browser. Left half: Slither-style snake with smooth analog turning, boost, growth, and an encircle win condition. Right half: Pacman with classic mouth-chomp motion that can eat the snake on contact. Power-ups, hazards, glow, CRT vibes, and a slick winner overlay included.

## Team
- Navaneeth Nandakumar
- Arfan Thafseer

## Features
- Split-screen cameras (Snake left, Pacman right)
- Smooth movement, boost, analog turning, adaptive zoom
- Growth mechanics: snake gets longer and thicker as it eats
- Encircle detection: snake wins only when long enough and forming a near-closed loop around Pacman
- Pacman wins by touching the snake
- Power-ups: boost, shield, magnet (pulls pellets), x2 score
- Hazards: speed rings (speed up), sand rings (slow + reduced turning)
- HUD: score with combo multiplier, snake length
- Retro presentation: CRT scanlines, neon glow, posters, big end-screen
- Winner overlay: blurred black-and-white background with “SNAKE WINS” / “PACMAN WINS”
- Touch/mouse/keyboard friendly (WASD + Space for snake; Arrow keys for Pacman)

## Run locally
- Option 1: Open `index.html` directly in a modern browser
- Option 2: Serve locally (recommended):

```bash
python3 -m http.server 5173 --bind 127.0.0.1
# then open http://127.0.0.1:5173/
```

## Controls
- Snake (left): WASD to steer, Space to boost
- Pacman (right): Arrow keys to move

## Notes
- Press R after a round to restart
- The intro overlay appears on first load and can be dismissed with a key press, click, or tap

## Roadmap (nice-to-haves)
- Audio SFX and chiptune loop
- Bounty/leader UI tag
- Special events (blackout/meteor wave)
- Online play and spectator mode
