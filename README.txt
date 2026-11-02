STEEL FRONT — 3D browser tank battle
====================================

World-of-Tanks-style battles in the browser, low-poly and quick to load.
Every player plays on their own computer (or phone); friends join with a
6-digit code.

RUN
  npm install
  npm start
  -> open http://localhost:3000

  Others on the same Wi-Fi open http://<this-computer-ip>:3000.
  To play over the internet, deploy it (Railway: new service from this
  folder / GitHub repo, start command "npm start", it reads PORT itself).

PLAY
  1. Enter a callsign, press CREATE GAME. A 6-digit code appears.
  2. Friends type the code (or open the invite link) and press JOIN.
  3. Host picks a mode and presses START.
       Team battle  — Alpha vs Bravo, no respawn, first to 3 rounds.
       Free-for-all — respawn after 5 s, first to 10 kills or 8 minutes.
  Up to 10 players per room. 1 player can start a practice drive.

CONTROLS
  W/S drive · A/D turn hull · mouse aims turret · click fires
  right-click or Shift: sniper view · wheel: camera zoom (zoom all the way in = sniper)
  Tab scores · Enter chat · M mute · Esc pause menu (host: back to lobby)
  Phones/tablets: left stick drives, drag right side to aim, FIRE / ZOOM buttons.

TANK RULES
  100 HP, 3 s reload, ~24 damage per shell.
  Front armour takes less damage, sides normal, rear +35%, top +20%.
  Shells hitting at a steep angle ricochet (no damage).
  The aim circle tightens when you stand still and grows when you move.
  Green crates repair 40 HP (respawn after 25 s).
  Bushes/tree crowns hide you; enemies show on the map only in line of sight.

SOUNDS
  Shot, hit/explosion, ricochet, repair (energy) and victory sounds plus
  tank_epic.mp3 music come from the Tank War / Shared Couch game.

FILES
  server.js         rooms, codes, rounds, damage authority (Express + Socket.io)
  public/index.html menus, lobby, HUD
  public/game.js    3D game (Three.js, served from node_modules — no CDN)
  public/audio      sound effects + music
