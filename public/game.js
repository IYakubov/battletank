// ═══════════════════════════════════════════════════════
//  STEEL FRONT — client
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const socket = io({ transports: ['websocket', 'polling'] });
const $ = id => document.getElementById(id);

// ── constants (keep in sync with server) ──
const MAP_HALF = 180;
const MAX_HP = 100;
const SHELL_SPEED = 230;
const GRAVITY = 18;
const RELOAD = 3.0;
const MAX_FWD = 13, MAX_REV = 5.5, ACCEL = 8, BRAKE = 18, TURN = 1.15;
const TURRET_SPEED = 1.5, GUN_SPEED = 0.9;
const GUN_MIN = -0.14, GUN_MAX = 0.36;
const BASE_DMG = 24;
const DISP_MIN = 0.0035;
const TEAM_COL = [0x6f7d40, 0x3f6283];
const FFA_COLS = [0x6f7d40, 0x3f6283, 0x8a4b3a, 0x7a6a45, 0x5b5f66, 0x4a6e5c, 0x7b5a7a, 0x8a7a2e, 0x355058, 0x6b4f35];
const TAU = Math.PI * 2;

// ── state ──
let myId = null, room = null, inGame = false, worldSeed = null;
let roundStartAt = 0, spectating = false, specId = null;
const tanks = new Map();      // id -> tank
const shells = [];
let world = null;

// ═══════════ MENU / LOBBY UI ═══════════
const nameIn = $('name');
try { nameIn.value = localStorage.getItem('sf_name') || ''; } catch (e) {}
const digitEls = [...document.querySelectorAll('#digits input')];
digitEls.forEach((el, i) => {
  el.addEventListener('input', () => {
    el.value = el.value.replace(/\D/g, '').slice(-1);
    if (el.value && i < 5) digitEls[i + 1].focus();
    if (digitCode().length === 6) $('joinBtn').focus();
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !el.value && i > 0) digitEls[i - 1].focus();
    if (e.key === 'Enter') doJoin();
  });
  el.addEventListener('paste', e => {
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (t.length) { e.preventDefault(); t.split('').forEach((c, k) => digitEls[k] && (digitEls[k].value = c)); digitEls[Math.min(5, t.length)].focus(); }
  });
});
const digitCode = () => digitEls.map(e => e.value).join('');
const urlCode = (new URLSearchParams(location.search).get('code') || '').replace(/\D/g, '').slice(0, 6);
if (urlCode.length === 6) urlCode.split('').forEach((c, i) => digitEls[i].value = c);

function saveName() { try { localStorage.setItem('sf_name', nameIn.value.trim()); } catch (e) {} }
function showScreen(id) {
  for (const s of ['menu', 'lobby', 'pause', 'result']) $(s).classList.toggle('on', s === id);
}
$('createBtn').onclick = () => {
  audio.unlock(); saveName();
  socket.emit('create', { name: nameIn.value }, r => {
    if (!r.ok) return $('err').textContent = r.err;
    myId = r.id; history.replaceState(null, '', '?code=' + r.code); showScreen('lobby');
  });
};
function doJoin() {
  audio.unlock(); saveName();
  const code = digitCode();
  if (code.length !== 6) return $('err').textContent = 'Enter the 6-digit code';
  socket.emit('join', { code, name: nameIn.value }, r => {
    if (!r.ok) return $('err').textContent = r.err;
    myId = r.id; history.replaceState(null, '', '?code=' + r.code); showScreen('lobby');
  });
}
$('joinBtn').onclick = doJoin;
$('copyBtn').onclick = () => {
  const link = location.origin + location.pathname + '?code=' + room.code;
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
    () => { $('copyBtn').textContent = 'Link copied'; setTimeout(() => $('copyBtn').textContent = 'Copy invite link', 1500); },
    () => prompt('Invite link', link));
};
$('mTeam').onclick = () => socket.emit('setMode', 'team');
$('mFfa').onclick = () => socket.emit('setMode', 'ffa');
$('startBtn').onclick = () => { audio.unlock(); socket.emit('start'); };
$('leaveBtn').onclick = $('pLeaveBtn').onclick = $('resLeave').onclick = () => { location.href = location.pathname; };
$('resumeBtn').onclick = () => { showScreen(null); lockPointer(); };
$('pLobbyBtn').onclick = () => socket.emit('toLobby');
$('resLobby').onclick = () => socket.emit('toLobby');
$('resAgain').onclick = () => socket.emit('start');

function isHost() { return room && room.hostId === myId; }
function me() { return room && room.players.find(p => p.id === myId); }

function renderLobby() {
  if (!room) return;
  $('codebig').innerHTML = room.code.split('').map(c => `<b>${c}</b>`).join('');
  $('pcode').textContent = room.code;
  $('mTeam').classList.toggle('on', room.mode === 'team');
  $('mFfa').classList.toggle('on', room.mode === 'ffa');
  $('mTeam').disabled = $('mFfa').disabled = !isHost();
  const chip = p => `<div class="chip ${p.id === myId ? 'me' : ''}"><span>${esc(p.name)}</span>${p.id === room.hostId ? '<i>HOST</i>' : ''}</div>`;
  if (room.mode === 'team') {
    const col = (t, nm, c) => `<div class="team"><h4 style="color:${c}">${nm}<button data-t="${t}">${me() && me().team === t ? 'YOUR TEAM' : 'JOIN'}</button></h4>${room.players.filter(p => p.team === t).map(chip).join('')}</div>`;
    $('teams').innerHTML = col(0, 'ALPHA', 'var(--a)') + col(1, 'BRAVO', 'var(--b)');
    $('teams').querySelectorAll('button').forEach(b => b.onclick = () => socket.emit('setTeam', +b.dataset.t));
  } else {
    $('teams').innerHTML = `<div class="team"><h4>ALL VS ALL · ${room.players.length}/10</h4>${room.players.map(chip).join('')}</div>`;
  }
  $('startBtn').disabled = !isHost();
  $('startBtn').textContent = isHost() ? (room.players.length < 2 ? 'Start (practice)' : 'Start battle') : 'Waiting for host…';
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ═══════════ AUDIO ═══════════
const audio = (() => {
  let ctx = null, master = null, muted = false, unlocked = false;
  const buffers = {};
  const music = new Audio('audio/tank_epic.mp3');
  music.loop = true; music.volume = 0.35;
  let engOsc, engOsc2, engGain, engFilter;
  async function load(name) {
    try {
      const r = await fetch('audio/' + name + '.mp3');
      buffers[name] = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch (e) {}
  }
  function unlock() {
    if (unlocked) return; unlocked = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.connect(ctx.destination);
    ['shoot', 'hit', 'ricochet', 'energy', 'victory'].forEach(load);
    // engine rumble
    engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 38;
    engOsc2 = ctx.createOscillator(); engOsc2.type = 'square'; engOsc2.frequency.value = 19;
    engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 180;
    engGain = ctx.createGain(); engGain.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    engOsc.connect(engFilter); engOsc2.connect(g2); g2.connect(engFilter);
    engFilter.connect(engGain); engGain.connect(master);
    engOsc.start(); engOsc2.start();
    if (!muted) music.play().catch(() => {});
  }
  function play(name, vol = 1, pan = 0, rate = 1) {
    if (!ctx || muted || !buffers[name] || vol <= 0.01) return;
    const s = ctx.createBufferSource(); s.buffer = buffers[name]; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = vol;
    let node = s;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); s.connect(p); node = p; }
    node.connect(g); g.connect(master); s.start();
  }
  // positional: attenuate by distance from camera, pan by side
  function at(name, pos, vol = 1, rate = 1) {
    if (!camera) return play(name, vol);
    const dx = pos.x - camera.position.x, dz = pos.z - camera.position.z, dy = pos.y - camera.position.y;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const att = Math.max(0, 1 - d / 320) ** 1.6;
    camera.getWorldDirection(_v1);
    const right = _v2.set(-_v1.z, 0, _v1.x).normalize();
    const pan = d > 0.1 ? (dx * right.x + dz * right.z) / d : 0;
    play(name, vol * att, pan * 0.8, rate);
  }
  function engine(throttle, speed) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const on = muted ? 0 : 1;
    engGain.gain.setTargetAtTime(on * (0.018 + throttle * 0.026 + speed * 0.016), t, 0.15);
    engOsc.frequency.setTargetAtTime(36 + speed * 30 + throttle * 10, t, 0.2);
    engOsc2.frequency.setTargetAtTime(18 + speed * 15 + throttle * 5, t, 0.2);
    engFilter.frequency.setTargetAtTime(160 + speed * 260 + throttle * 120, t, 0.2);
  }
  function engineOff() { if (ctx) engGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2); }
  function setMusicVol(v) { music.volume = v; }
  function toggle() {
    muted = !muted;
    $('mute').textContent = muted ? '✕' : '♪';
    if (muted) { music.pause(); engineOff(); } else if (unlocked) music.play().catch(() => {});
  }
  return { unlock, play, at, engine, engineOff, setMusicVol, toggle };
})();
$('mute').onclick = () => { audio.unlock(); audio.toggle(); };

// ═══════════ THREE SETUP ═══════════
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const SKY = new THREE.Color(0xb9c0bd);
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 140, 460);
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1400);
camera.position.set(0, 80, 160); camera.lookAt(0, 0, 0);

const hemi = new THREE.HemisphereLight(0xdfe6e8, 0x4a4636, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c4, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SC = 70;
Object.assign(sun.shadow.camera, { left: -SC, right: SC, top: SC, bottom: -SC, near: 1, far: 400 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

// sky dome with soft gradient
{
  const g = new THREE.SphereGeometry(1000, 24, 12);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x7f98a8) }, bot: { value: SKY } },
    vertexShader: 'varying vec3 vp; void main(){ vp=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vp; void main(){ float h=clamp(normalize(vp).y*2.2,0.,1.); gl_FragColor=vec4(mix(bot,top,h),1.); }'
  });
  const sky = new THREE.Mesh(g, m); sky.renderOrder = -1; scene.add(sky);
  sky.onBeforeRender = () => sky.position.copy(camera.position);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const dpr = Math.min(devicePixelRatio, 2);
  hud.width = w * dpr; hud.height = h * dpr; hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const hud = $('hud'), hctx = hud.getContext('2d');
addEventListener('resize', resize);
resize();

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _q1 = new THREE.Quaternion();

// ═══════════ WORLD GENERATION ═══════════
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeNoise(rand) {
  const p = new Uint8Array(512), v = new Float32Array(256);
  for (let i = 0; i < 256; i++) { p[i] = i; v[i] = rand(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = v[p[p[X] + Y]], b = v[p[p[X + 1] + Y]], c = v[p[p[X] + Y + 1]], d = v[p[p[X + 1] + Y + 1]];
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

let H = () => 0; // terrain height function, set per world

// dissolve geometry that sits between the camera and the tank (screen-door dither)
function camFade(mat, near, far) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCfWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 cfw = vec4(transformed,1.0);\n#ifdef USE_INSTANCING\ncfw = instanceMatrix * cfw;\n#endif\nvCfWorld = (modelMatrix * cfw).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCfWorld;')
      .replace('void main() {', `void main() {
  float cfd = distance(vCfWorld, cameraPosition);
  if (cfd < ${far.toFixed(1)}) {
    float cfa = smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, cfd);
    vec2 cfp = floor(mod(gl_FragCoord.xy, 4.0));
    float cft = (mod(cfp.x * 2.0 + cfp.y * 3.0 + cfp.x * cfp.y, 4.0) + 0.5) / 4.0;
    if (cfa < 0.98 && cft > cfa) discard;
  }`);
  };
  mat.customProgramCacheKey = () => 'cf' + near + '_' + far;
  return mat;
}


function buildWorld(seed) {
  if (world) { scene.remove(world.group); world.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const rand = mulberry32(seed);
  const n1 = makeNoise(rand), n2 = makeNoise(rand);
  const fbm = (x, z) => { let s = 0, a = 1, f = 1; for (let i = 0; i < 4; i++) { s += (n1(x * f, z * f) - .5) * a; a *= .5; f *= 2.03; } return s; };
  const villageH = fbm(0.0065 * 0 + 11, -7) * 18;
  H = (x, z) => {
    let h = fbm(x * 0.0065 + 11, z * 0.0065 - 7) * 18;
    h += (n2(x * 0.045, z * 0.045) - .5) * 1.4;
    h = lerp(h, h * 0.35 + 0.5, smooth(118, 142, Math.abs(z)));         // spawn plains
    h = lerp(h, villageH, 1 - smooth(28, 58, Math.hypot(x, z)));         // village plateau
    const e = Math.max(Math.abs(x), Math.abs(z)) - (MAP_HALF - 10);
    if (e > 0) { const ee = Math.min(e, 45); h += ee * ee * 0.018 + ee * 0.55 + (n2(x * 0.03, z * 0.03) - .5) * ee * 0.9; }   // mountains rim
    return h;
  };

  const group = new THREE.Group();
  const circles = [];   // {x,z,r,y0,y1,sphere?}
  const boxes = [];     // {x,z,hx,hz,y0,y1}
  const trunks = [];

  // ── terrain ──
  const SIZE = MAP_HALF * 2 + 260, SEG = 170;
  let geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, H(pos.getX(i), pos.getZ(i)));
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const p2 = geo.attributes.position, nrm = geo.attributes.normal;
  const cols = new Float32Array(p2.count * 3);
  const cGrass = new THREE.Color(0x6e7a45), cGrass2 = new THREE.Color(0x87884f), cDirt = new THREE.Color(0x8a7a5c),
        cRock = new THREE.Color(0x7c7a74), cSnow = new THREE.Color(0xd8d8d2), c = new THREE.Color();
  for (let i = 0; i < p2.count; i += 3) {
    // one colour per triangle → faceted low-poly look
    const x = (p2.getX(i) + p2.getX(i + 1) + p2.getX(i + 2)) / 3, y = (p2.getY(i) + p2.getY(i + 1) + p2.getY(i + 2)) / 3, z = (p2.getZ(i) + p2.getZ(i + 1) + p2.getZ(i + 2)) / 3;
    const slope = 1 - nrm.getY(i);
    c.copy(cGrass).lerp(cGrass2, n2(x * 0.03 + 50, z * 0.03) * 1.2 - 0.1);
    const road = Math.abs(x - Math.sin(z * 0.02) * 22) < 5 && Math.abs(z) < 150 ? 1 : 0;
    if (road) c.lerp(cDirt, 0.75);
    if (slope > 0.12) c.lerp(cDirt, Math.min(1, (slope - 0.12) * 5));
    if (slope > 0.3) c.lerp(cRock, Math.min(1, (slope - 0.3) * 3));
    if (y > 48) c.lerp(cSnow, Math.min(1, (y - 48) / 14));
    const j = 0.94 + rand() * 0.1; c.multiplyScalar(j);
    for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = c.r; cols[(i + k) * 3 + 1] = c.g; cols[(i + k) * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const groundTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c2 = cv.getContext('2d'); const img = c2.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = 205 + rand() * 50; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v * 0.97; img.data[i + 3] = 255; }
    c2.putImageData(img, 0, 0);
    for (let k = 0; k < 260; k++) { c2.fillStyle = `rgba(${rand() < .5 ? '60,55,40' : '255,255,240'},${0.06 + rand() * 0.1})`; c2.beginPath(); c2.arc(rand() * 256, rand() * 256, 1 + rand() * 5, 0, TAU); c2.fill(); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(SIZE / 9, SIZE / 9); t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4; return t;
  })();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex, roughness: 1, metalness: 0, flatShading: true }));
  terrain.receiveShadow = true;
  group.add(terrain);

  const free = (x, z, r) => {
    for (const b of boxes) if (Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r) return false;
    for (const q of circles) if (Math.hypot(x - q.x, z - q.z) < q.r + r) return false;
    return true;
  };

  // ── village houses (merged into a few meshes; ~1 in 4 is a shelled ruin) ──
  const wallMat = camFade(new THREE.MeshStandardMaterial({ color: 0xbdb4a2, roughness: .95, flatShading: true }), 3, 10);
  const wallMat2 = camFade(new THREE.MeshStandardMaterial({ color: 0x9c9384, roughness: .95, flatShading: true }), 3, 10);
  const roofMat = camFade(new THREE.MeshStandardMaterial({ color: 0x7a4436, roughness: .9, flatShading: true }), 3, 10);
  const roofMat2 = camFade(new THREE.MeshStandardMaterial({ color: 0x5a5a58, roughness: .9, flatShading: true }), 3, 10);
  const winMat = new THREE.MeshStandardMaterial({ color: 0x2d3133, roughness: .5 });
  const frameMat = camFade(new THREE.MeshStandardMaterial({ color: 0xe6e0d2, roughness: .9, flatShading: true }), 3, 10);
  const woodMat = camFade(new THREE.MeshStandardMaterial({ color: 0x6b4c32, roughness: 1, flatShading: true }), 3, 10);
  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x9a9284, roughness: 1, flatShading: true });
  const W = partBuilder();
  const houseSpots = [];
  for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) {
    if (rand() < 0.38 || (gx === 0 && gz === 0)) continue;
    houseSpots.push([gx * 19 + (rand() - .5) * 5, gz * 19 + (rand() - .5) * 5]);
  }
  for (let i = 0; i < 7; i++) {
    const a = rand() * TAU, r = 70 + rand() * 50;
    houseSpots.push([Math.cos(a) * r, Math.sin(a) * r * 0.75]);
  }
  for (const [hx0, hz0] of houseSpots) {
    let w = 7 + rand() * 5, d = 6 + rand() * 4;
    if (rand() < .5) [w, d] = [d, w];
    if (!free(hx0, hz0, Math.max(w, d) * 0.5 + 3)) continue;
    const ruin = rand() < 0.27;
    const ht = 4.5 + rand() * 2.5;
    let base = Infinity;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) base = Math.min(base, H(hx0 + sx * w / 2, hz0 + sz * d / 2));
    base -= 1.2;
    const wm = rand() < .5 ? wallMat : wallMat2;
    const y0 = base + 1.2;          // ground level at the house
    if (!ruin) {
      W.add(group, BOX(w, ht + 1.2, d), wm, hx0, base + (ht + 1.2) / 2, hz0);
      W.add(group, BOX(w + 0.2, 0.5, d + 0.2), wallMat2, hx0, y0 + 0.25, hz0);       // plinth
      const long = w > d, L = long ? w : d, S = long ? d : w;
      const shape = new THREE.Shape(); shape.moveTo(-S / 2 - .5, 0); shape.lineTo(S / 2 + .5, 0); shape.lineTo(0, S * 0.42); shape.closePath();
      const rg = new THREE.ExtrudeGeometry(shape, { depth: L + .8, bevelEnabled: false }); rg.translate(0, 0, -(L + .8) / 2);
      W.add(group, rg, rand() < .6 ? roofMat : roofMat2, hx0, base + ht + 1.2, hz0, 0, long ? Math.PI / 2 : 0);
      // chimney
      W.add(group, BOX(0.7, 2.2, 0.7), wm, hx0 + (long ? L * 0.25 : 0), base + ht + 1.2 + S * 0.3, hz0 + (long ? 0 : L * 0.25));
      // door + framed windows on both long faces
      W.add(group, BOX(1.1, 2.1, 0.12), woodMat, hx0, y0 + 1.05, hz0 + d / 2 + 0.03);
      W.add(group, BOX(1.4, 2.35, 0.08), frameMat, hx0, y0 + 1.15, hz0 + d / 2 + 0.01);
      for (const side of [1, -1]) for (let k = 0; k < 3; k++) {
        const wx = hx0 + (k - 1) * w * 0.3; if (side > 0 && k === 1) continue;
        const wy = base + ht * 0.62 + 1.2;
        W.add(group, BOX(1.35, 1.55, 0.08), frameMat, wx, wy, hz0 + side * (d / 2 + 0.01));
        W.add(group, BOX(1.1, 1.3, 0.1), winMat, wx, wy, hz0 + side * (d / 2 + 0.03));
        W.add(group, BOX(0.06, 1.3, 0.12), frameMat, wx, wy, hz0 + side * (d / 2 + 0.05));
        W.add(group, BOX(1.5, 0.1, 0.25), frameMat, wx, wy - 0.78, hz0 + side * (d / 2 + 0.1));
      }
      boxes.push({ x: hx0, z: hz0, hx: w / 2, hz: d / 2, y0: base, y1: base + ht + 1.2 + S * 0.3 });
    } else {
      // shelled ruin: broken wall stubs of different heights, rubble heaps, a charred beam
      const wh = ht * 0.55;
      const segs = [[0, d / 2, w, 0.4], [0, -d / 2, w, 0.4], [w / 2, 0, 0.4, d], [-w / 2, 0, 0.4, d]];
      for (const [ox, oz, sw, sd] of segs) {
        const n = 3;
        for (let k = 0; k < n; k++) {
          const along = sw > sd ? sw / n : sd / n, hh = wh * (0.35 + rand() * 0.75);
          const cx = hx0 + ox + (sw > sd ? (k - (n - 1) / 2) * along : 0), cz = hz0 + oz + (sw > sd ? 0 : (k - (n - 1) / 2) * along);
          W.add(group, BOX(sw > sd ? along * 0.96 : sw, hh + 1.2, sw > sd ? sd : along * 0.96), wm, cx, base + (hh + 1.2) / 2, cz);
        }
      }
      for (let k = 0; k < 5; k++) W.add(group, new THREE.IcosahedronGeometry(1, 0), rubbleMat, hx0 + (rand() - .5) * w * 0.7, y0 + 0.2, hz0 + (rand() - .5) * d * 0.7, rand(), rand(), 0, 1.2 + rand(), 0.5 + rand() * 0.4, 1 + rand());
      W.add(group, BOX(0.3, 0.3, Math.max(w, d) * 0.8), TMAT.dark, hx0, y0 + 1.2, hz0, 0.5, rand() * 3, 0);
      boxes.push({ x: hx0, z: hz0, hx: w / 2, hz: d / 2, y0: base, y1: base + wh + 1.2 });
    }
  }

  // ── rocks ──
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = camFade(new THREE.MeshStandardMaterial({ color: 0x8b8983, roughness: 1, flatShading: true }), 3, 8);
  const rockList = [];
  for (let i = 0; i < 260 && rockList.length < 55; i++) {
    const x = (rand() * 2 - 1) * (MAP_HALF - 12), z = (rand() * 2 - 1) * (MAP_HALF - 12);
    const r = 1.6 + rand() ** 2 * 5;
    if (Math.abs(z) > 136 && Math.abs(x) < 80) continue;
    if (!free(x, z, r + 2)) continue;
    const y = H(x, z);
    rockList.push({ x, y, z, r, rx: rand() * 3, ry: rand() * 3, sy: 0.6 + rand() * 0.5 });
    circles.push({ x, z, r: r * 0.92, y0: y - r, y1: y + r * 0.8, sphere: true, cy: y - r * 0.15, sr: r * 0.95 });
  }
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockList.length);
  const dummy = new THREE.Object3D();
  rockList.forEach((k, i) => {
    dummy.position.set(k.x, k.y - k.r * 0.15, k.z); dummy.rotation.set(k.rx, k.ry, 0);
    dummy.scale.set(k.r * 1.05, k.r * k.sy * 1.2, k.r); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
  });
  rocks.castShadow = rocks.receiveShadow = true; group.add(rocks);

  // ── trees (foliage hides you, trunks stop shells) ──
  const trunkGeo = new THREE.CylinderGeometry(.25, .35, 3, 5); trunkGeo.translate(0, 1.5, 0);
  const crownGeo = new THREE.ConeGeometry(2.2, 6.5, 6); crownGeo.translate(0, 5.6, 0);
  const crownGeo2 = new THREE.IcosahedronGeometry(2.6, 0); crownGeo2.translate(0, 5, 0);
  const trunkMat = camFade(new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1, flatShading: true }), 3, 9);
  const pineMat = camFade(new THREE.MeshStandardMaterial({ color: 0x4b5e34, roughness: 1, flatShading: true }), 5, 15);
  const leafMat = camFade(new THREE.MeshStandardMaterial({ color: 0x6c7a3a, roughness: 1, flatShading: true }), 5, 15);
  const treeList = [];
  const clusterN = 9, clusters = [];
  for (let i = 0; i < clusterN; i++) clusters.push([(rand() * 2 - 1) * 150, (rand() * 2 - 1) * 110]);
  for (let i = 0; i < 900 && treeList.length < 190; i++) {
    let x, z;
    if (rand() < 0.75) { const c0 = clusters[Math.floor(rand() * clusterN)]; x = c0[0] + (rand() - .5) * 46; z = c0[1] + (rand() - .5) * 46; }
    else { x = (rand() * 2 - 1) * (MAP_HALF - 8); z = (rand() * 2 - 1) * (MAP_HALF - 8); }
    if (Math.abs(x) > MAP_HALF - 6 || Math.abs(z) > MAP_HALF - 6) continue;
    if (Math.abs(z) > 132 && Math.abs(x) < 85) continue;
    if (Math.hypot(x, z) < 50 && rand() < .8) continue;
    if (!free(x, z, 2.2)) continue;
    const y = H(x, z), s = 0.8 + rand() * 0.6;
    treeList.push({ x, y, z, s, pine: rand() < .6, ry: rand() * TAU });
    circles.push({ x, z, r: 0.7, y0: y, y1: y + 3 * s, trunk: true });
  }
  const pines = treeList.filter(t => t.pine), leafs = treeList.filter(t => !t.pine);
  const tr = new THREE.InstancedMesh(trunkGeo, trunkMat, treeList.length);
  const cp = new THREE.InstancedMesh(crownGeo, pineMat, pines.length);
  const cl = new THREE.InstancedMesh(crownGeo2, leafMat, leafs.length);
  treeList.forEach((t, i) => { dummy.position.set(t.x, t.y - .2, t.z); dummy.rotation.set(0, t.ry, 0); dummy.scale.setScalar(t.s); dummy.updateMatrix(); tr.setMatrixAt(i, dummy.matrix); });
  pines.forEach((t, i) => { dummy.position.set(t.x, t.y - .2, t.z); dummy.rotation.set(0, t.ry, 0); dummy.scale.setScalar(t.s); dummy.updateMatrix(); cp.setMatrixAt(i, dummy.matrix); });
  leafs.forEach((t, i) => { dummy.position.set(t.x, t.y - .2, t.z); dummy.rotation.set(t.ry, t.ry, 0); dummy.scale.set(t.s, t.s * 0.9, t.s); dummy.updateMatrix(); cl.setMatrixAt(i, dummy.matrix); });
  for (const m of [tr, cp, cl]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }

  // ── battlefield props: fences and poles along the road, hedgehogs, sandbags, hay bales ──
  const roadX = z => Math.sin(z * 0.02) * 22;
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x7a5d40, roughness: 1, flatShading: true });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, flatShading: true });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x4a4b4c, roughness: .7, metalness: .4, flatShading: true });
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xa8976c, roughness: 1, flatShading: true });
  const hayMat = new THREE.MeshStandardMaterial({ color: 0xc7a85a, roughness: 1, flatShading: true });
  for (let z = -128; z < 128; z += 5) {
    // wooden fence on the east side of the road, broken in places
    if (rand() < 0.22 || Math.hypot(roadX(z) + 7, z) < 50) continue;
    const x = roadX(z) + 7, x2 = roadX(z + 5) + 7, y = H(x, z), y2 = H(x2, z + 5);
    W.add(group, BOX(0.18, 1.4, 0.18), fenceMat, x, y + 0.5, z);
    const len = Math.hypot(x2 - x, 5, y2 - y), ang = Math.atan2(x2 - x, 5), tilt = Math.atan2(y2 - y, 5);
    for (const hy of [0.55, 1.0]) W.add(group, BOX(0.06, 0.12, len), fenceMat, (x + x2) / 2, (y + y2) / 2 + hy, z + 2.5, -tilt, ang, 0);
  }
  for (let z = -140; z < 140; z += 22) {
    // telegraph poles on the west side
    const x = roadX(z) - 8, y = H(x, z);
    W.add(group, CYL(0.14, 0.18, 8, 6), poleMat, x, y + 3.6, z);
    W.add(group, BOX(1.6, 0.12, 0.12), poleMat, x, y + 7.2, z);
    for (const sx of [-0.65, 0, 0.65]) W.add(group, CYL(0.05, 0.05, 0.14, 5), frameMat, x + sx, y + 7.33, z);
  }
  // czech hedgehogs at the village edges (solid: they stop tanks and shells)
  const hedgehogGeo = BOX(0.18, 0.18, 2.4);
  for (let i = 0; i < 26; i++) {
    const a = rand() * TAU, r = 58 + rand() * 12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 2.5)) continue;
    const y = H(x, z) + 0.6, ry = rand() * 3;
    W.add(group, hedgehogGeo, steelMat, x, y, z, 0.62, ry, 0);
    W.add(group, hedgehogGeo, steelMat, x, y, z, -0.62, ry, 0);
    W.add(group, hedgehogGeo, steelMat, x, y, z, Math.PI / 2, ry, 0.9);
    circles.push({ x, z, r: 1.1, y0: y - 0.6, y1: y + 0.9, sphere: true, cy: y, sr: 1.0 });
  }
  // sandbag emplacements (low cover; hull-down spots)
  for (let i = 0; i < 14; i++) {
    const x = (rand() * 2 - 1) * 130, z = (rand() * 2 - 1) * 110;
    if (!free(x, z, 5) || Math.abs(x - roadX(z)) < 8) continue;
    const ry = rand() * TAU, y = H(x, z);
    const len = 5 + rand() * 3;
    for (let row = 0; row < 3; row++) for (let k = 0; k < Math.floor(len / 0.8); k++) {
      const off = -len / 2 + k * 0.8 + (row % 2) * 0.4;
      W.add(group, new THREE.CapsuleGeometry(0.22, 0.45, 2, 6), sandMat, x + Math.cos(ry) * off, y + 0.2 + row * 0.36, z - Math.sin(ry) * off, 0, ry, Math.PI / 2);
    }
    const hx = Math.abs(Math.cos(ry)) * len / 2 + 0.4, hz = Math.abs(Math.sin(ry)) * len / 2 + 0.4;
    boxes.push({ x, z, hx, hz, y0: y - 0.5, y1: y + 1.1 });
  }
  // hay bales in the fields (soft: no collision)
  for (let i = 0; i < 40; i++) {
    const x = (rand() * 2 - 1) * 150, z = (rand() * 2 - 1) * 120;
    if (!free(x, z, 2) || Math.abs(x - roadX(z)) < 7 || Math.hypot(x, z) < 60) continue;
    W.add(group, CYL(0.75, 0.75, 1.3, 12), hayMat, x, H(x, z) + 0.7, z, 0, rand() * 3, Math.PI / 2);
  }
  W.finish();

  // ── grass tufts ──
  {
    const blade = new THREE.ConeGeometry(0.06, 0.7, 3); blade.translate(0, 0.35, 0);
    const parts = [];
    for (let k = 0; k < 5; k++) { const b = blade.clone(); b.rotateZ((k - 2) * 0.22); b.rotateY(k * 1.3); b.translate((k - 2) * 0.07, 0, (k % 2) * 0.08); parts.push(b.toNonIndexed()); }
    const tuft = mergeGeometries(parts);
    const gm = new THREE.MeshStandardMaterial({ color: 0x7f8f49, roughness: 1, flatShading: true });
    const N = 7000, tufts = new THREE.InstancedMesh(tuft, gm, N);
    const dm = new THREE.Object3D(), tc = new THREE.Color();
    let n = 0;
    for (let i = 0; i < N * 3 && n < N; i++) {
      const x = (rand() * 2 - 1) * (MAP_HALF - 8), z = (rand() * 2 - 1) * (MAP_HALF - 8);
      if (Math.abs(x - roadX(z)) < 5.5 && Math.abs(z) < 150) continue;
      const y = H(x, z), sl = Math.abs(H(x + 1, z) - y) + Math.abs(H(x, z + 1) - y);
      if (sl > 0.5 || y > 40 || !free(x, z, 0.5)) continue;
      dm.position.set(x, y - 0.05, z); dm.rotation.set(0, rand() * TAU, 0); dm.scale.setScalar(0.7 + rand() * 0.9); dm.updateMatrix();
      tufts.setMatrixAt(n, dm.matrix);
      tufts.setColorAt(n, tc.setHSL(0.2 + rand() * 0.05, 0.3 + rand() * 0.15, 0.32 + rand() * 0.12));
      n++;
    }
    tufts.count = n; tufts.receiveShadow = true;
    group.add(tufts);
  }

  // ── repair crates ──
  const crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const cx = cv.getContext('2d'); cx.fillStyle = '#6b6f3e'; cx.fillRect(0, 0, 64, 64); cx.strokeStyle = '#4b4e2a'; cx.lineWidth = 6; cx.strokeRect(3, 3, 58, 58);
  cx.fillStyle = '#e8ece0'; cx.fillRect(26, 14, 12, 36); cx.fillRect(14, 26, 36, 12);
  const crateMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: .8, emissive: 0x1d2a10 });
  crateMat.map.colorSpace = THREE.SRGBColorSpace;
  const crates = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + 0.4 + rand() * 0.3, r = 55 + rand() * 45;
    let x = Math.cos(a) * r, z = Math.sin(a) * r * 0.85;
    for (let k = 0; k < 20 && !free(x, z, 3); k++) { x += (rand() - .5) * 12; z += (rand() - .5) * 12; }
    const m = new THREE.Mesh(crateGeo, crateMat); m.castShadow = true;
    const y = H(x, z) + 1.6;
    m.position.set(x, y, z); group.add(m);
    crates.push({ x, z, y, mesh: m, avail: true });
  }

  scene.add(group);
  marks.clear(); craters.clear();
  world = { group, circles, boxes, crates, houseCount: boxes.length, seed, trees: treeList, rocks: rockList };
  buildMinimapBase();
}

// ═══════════ TRACK MARKS & CRATERS (ring buffers, one draw call each) ═══════════
function decalPool(geo, color, opacity, N, lift) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const im = new THREE.InstancedMesh(geo, mat, N); im.count = 0; im.frustumCulled = false; scene.add(im);
  let i = 0, total = 0; const dm = new THREE.Object3D();
  return {
    add(x, z, yaw = 0, s = 1) {
      dm.position.set(x, H(x, z) + lift, z); dm.rotation.set(0, yaw, 0); dm.scale.setScalar(s); dm.updateMatrix();
      im.setMatrixAt(i, dm.matrix); i = (i + 1) % N; total++; im.count = Math.min(N, total); im.instanceMatrix.needsUpdate = true;
    },
    clear() { im.count = 0; i = 0; total = 0; }
  };
}
const marks = decalPool(new THREE.PlaneGeometry(0.62, 0.85).rotateX(-Math.PI / 2), 0x2f2a20, 0.38, 2600, 0.09);
const craters = decalPool(new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2), 0x2a241c, 0.55, 160, 0.12);

// ═══════════ TANK MODEL ═══════════
// shared textures: grey camo (tinted per team via material colour), track tread, turret numbers
const camoTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#c8c8c8'; c.fillRect(0, 0, 256, 256);
  let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (const [shade, n] of [['#9a9a9a', 16], ['#e6e6e6', 12], ['#7c7c7c', 8]]) {
    c.fillStyle = shade;
    for (let i = 0; i < n; i++) {
      c.beginPath(); const x = r() * 256, y = r() * 256, rad = 14 + r() * 26;
      for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, rr = rad * (0.6 + r() * 0.6); c.lineTo(x + Math.cos(a) * rr * 1.5, y + Math.sin(a) * rr); }
      c.closePath(); c.fill();
    }
  }
  const img = c.getImageData(0, 0, 256, 256);   // fine grain so plates don't look like plastic
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - .5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const treadCanvas = (() => {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#3a3a37'; c.fillRect(0, 0, 32, 64);
  for (let y = 0; y < 64; y += 16) { c.fillStyle = '#1e1e1c'; c.fillRect(0, y, 32, 5); c.fillStyle = '#56544e'; c.fillRect(3, y + 7, 26, 3); }
  return cv;
})();
function numberTex(num) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = '900 46px Unbounded, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = 'rgba(240,236,224,.85)'; c.fillText(num, 64, 34);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TMAT = {
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2c2b, roughness: .9, flatShading: true }),
  metal: new THREE.MeshStandardMaterial({ color: 0x55585b, roughness: .55, metalness: .5, flatShading: true }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x232322, roughness: 1, flatShading: true }),
  lens: new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0x6b5a2a, roughness: .2 }),
  canvas: new THREE.MeshStandardMaterial({ color: 0x6f6a4f, roughness: 1, flatShading: true }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1, flatShading: true })
};
// road wheel: rubber tyre + metal hub, built once and shared
const WHEEL_R = 0.37;
const wheelGeo = (() => {
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 14); tyre.rotateZ(Math.PI / 2);
  return tyre;
})();
const hubGeo = (() => { const h = new THREE.CylinderGeometry(0.17, 0.2, 0.3, 8); h.rotateZ(Math.PI / 2); return h; })();
const sprocketGeo = (() => {
  const parts = [];
  const core = new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12); core.rotateZ(Math.PI / 2); parts.push(core.toNonIndexed());
  for (let k = 0; k < 12; k++) {
    const tooth = new THREE.BoxGeometry(0.2, 0.12, 0.1); tooth.translate(0, 0.44, 0); tooth.rotateX(k / 12 * Math.PI * 2); parts.push(tooth.toNonIndexed());
  }
  return mergeGeometries(parts);
})();

// collects transformed part geometries per (group, material) and merges them into one mesh each
function partBuilder() {
  const buckets = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function add(group, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(_m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const key = group.uuid + mat.uuid;
    if (!buckets.has(key)) buckets.set(key, { group, mat, list: [] });
    buckets.get(key).list.push(g);
  }
  function finish() {
    for (const { group, mat, list } of buckets.values()) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = true; m.receiveShadow = true; group.add(m);
    }
  }
  return { add, finish };
}
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CYL = (r1, r2, h, s = 10) => new THREE.CylinderGeometry(r1, r2, h, s);

function buildTank(color, num = '000') {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color, map: camoTex, roughness: .82, metalness: .12, flatShading: true });
  const detMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.72), roughness: .85, metalness: .15, flatShading: true });
  const trackTexL = new THREE.CanvasTexture(treadCanvas), trackTexR = new THREE.CanvasTexture(treadCanvas);
  for (const t of [trackTexL, trackTexR]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 9); }
  const trackL = new THREE.MeshStandardMaterial({ map: trackTexL, roughness: 1, flatShading: true });
  const trackR = new THREE.MeshStandardMaterial({ map: trackTexR, roughness: 1, flatShading: true });
  const mats = [hullMat, detMat];
  const P = partBuilder(), A = P.add;

  // ── hull: side profile extruded across the width, with chamfered edges ──
  {
    const prof = [[3.15, 0.62], [3.32, 0.95], [2.2, 1.42], [-2.6, 1.48], [-3.05, 1.25], [-3.1, 0.62], [-2.6, 0.38], [2.7, 0.38]];
    const sh = new THREE.Shape(); sh.moveTo(prof[0][0], prof[0][1]); for (const [z, y] of prof.slice(1)) sh.lineTo(z, y); sh.closePath();
    const hg = new THREE.ExtrudeGeometry(sh, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 });
    hg.rotateY(-Math.PI / 2); hg.translate(1.2, 0, 0);
    A(g, hg, hullMat);
  }
  for (const sx of [-1, 1]) {
    // fenders, front mudguards, side skirts
    A(g, BOX(0.8, 0.07, 6.3), detMat, sx * 1.62, 1.2, -0.05);
    A(g, BOX(0.8, 0.06, 0.62), detMat, sx * 1.62, 1.08, 3.32, 0.55);
    for (let i = 0; i < 5; i++) A(g, BOX(0.06, 0.6, 1.22), hullMat, sx * 2.0, 0.86, -2.6 + i * 1.3, 0, 0, sx * 0.04);
    // track runs (tread texture scrolls with speed)
    const tm = sx < 0 ? trackL : trackR;
    A(g, BOX(0.7, 0.12, 5.5), tm, sx * 1.62, 1.05, -0.1);
    A(g, BOX(0.7, 0.12, 5.3), tm, sx * 1.62, 0.07, 0);
    A(g, CYL(0.47, 0.47, 0.7, 12), tm, sx * 1.62, 0.55, 2.85, 0, 0, Math.PI / 2);
    A(g, CYL(0.47, 0.47, 0.7, 12), tm, sx * 1.62, 0.58, -2.95, 0, 0, Math.PI / 2);
    // stowage on the fenders, jerrycans at the back
    A(g, BOX(0.6, 0.36, 1.25), detMat, sx * 1.62, 1.41, 0.7);
    A(g, BOX(0.62, 0.04, 1.27), TMAT.dark, sx * 1.62, 1.6, 0.7);
    for (const jz of [-2.35, -2.75]) A(g, BOX(0.22, 0.42, 0.36), TMAT.canvas, sx * 1.62, 1.44, jz);
    // headlights, tow hooks
    A(g, CYL(0.09, 0.11, 0.14, 8), TMAT.dark, sx * 0.85, 1.22, 2.95, Math.PI / 2);
    A(g, CYL(0.075, 0.075, 0.02, 8), TMAT.lens, sx * 0.85, 1.22, 3.03, Math.PI / 2);
    A(g, BOX(0.12, 0.16, 0.22), TMAT.metal, sx * 0.8, 0.72, 3.25);
    // exhausts with mufflers
    A(g, CYL(0.11, 0.11, 0.55, 8), TMAT.metal, sx * 0.7, 1.12, -3.2, Math.PI / 2);
    A(g, BOX(0.36, 0.3, 0.2), TMAT.dark, sx * 0.7, 1.12, -3.0);
  }
  // spare track links on the glacis, hull machine gun, engine deck grilles, shovel
  for (let i = 0; i < 4; i++) A(g, BOX(0.5, 0.06, 0.24), TMAT.dark, -0.85 + i * 0.57, 1.2, 2.72, 0.404);
  A(g, new THREE.SphereGeometry(0.13, 8, 6), detMat, 0.62, 1.2, 2.55);
  A(g, CYL(0.03, 0.03, 0.45, 6), TMAT.dark, 0.62, 1.2, 2.8, Math.PI / 2);
  for (let i = 0; i < 6; i++) A(g, BOX(1.8, 0.05, 0.08), TMAT.dark, 0, 1.52, -1.6 - i * 0.2);
  A(g, BOX(1.9, 0.04, 1.3), detMat, 0, 1.5, -2.15);
  A(g, BOX(0.08, 0.04, 1.1), TMAT.wood, -1.1, 1.52, 1.4); A(g, BOX(0.22, 0.03, 0.28), TMAT.metal, -1.1, 1.52, 2.05);
  A(g, CYL(0.06, 0.06, 1.5, 6), TMAT.dark, 0.95, 1.55, -0.6, Math.PI / 2);   // tow cable drum

  // ── road wheels, sprocket and idler: separate meshes so they can spin ──
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const w = new THREE.Group(); w.position.set(sx * 1.62, 0.42, -2.1 + i * 0.84); g.add(w);
      const tyre = new THREE.Mesh(wheelGeo, TMAT.rubber), hub = new THREE.Mesh(hubGeo, TMAT.metal);
      tyre.castShadow = true; w.add(tyre, hub); w.userData.r = WHEEL_R; wheels.push(w);
    }
    for (const [z, y, geo, r] of [[-2.95, 0.6, sprocketGeo, 0.44], [2.85, 0.56, wheelGeo, WHEEL_R]]) {
      const w = new THREE.Group(); w.position.set(sx * 1.62, y, z); g.add(w);
      const m = new THREE.Mesh(geo, TMAT.metal); m.castShadow = true; w.add(m); w.userData.r = r; wheels.push(w);
    }
  }

  // ── turret ──
  const turret = new THREE.Group(); turret.position.set(0, 1.62, 0.2); g.add(turret);
  {
    const pts = [[0.55, 1.35], [1.25, 0.6], [1.32, -0.8], [0.92, -1.9], [-0.92, -1.9], [-1.32, -0.8], [-1.25, 0.6], [-0.55, 1.35]];
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], -pts[0][1]); for (const [x, z] of pts.slice(1)) sh.lineTo(x, -z); sh.closePath();
    const tg = new THREE.ExtrudeGeometry(sh, { depth: 0.72, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1 });
    tg.rotateX(-Math.PI / 2); tg.translate(0, 0.08, 0);
    A(turret, tg, hullMat);
  }
  A(turret, CYL(1.18, 1.25, 0.2, 18), detMat, 0, 0.04, -0.1);
  // commander cupola with periscopes and an open hatch, loader hatch, roof MG
  A(turret, CYL(0.34, 0.38, 0.3, 12), detMat, -0.55, 1.02, -0.45);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; A(turret, BOX(0.1, 0.09, 0.07), TMAT.lens, -0.55 + Math.sin(a) * 0.33, 1.04, -0.45 + Math.cos(a) * 0.33, 0, a); }
  A(turret, CYL(0.3, 0.3, 0.05, 12), detMat, -0.55, 1.32, -0.82, -1.1);
  A(turret, CYL(0.27, 0.27, 0.05, 12), detMat, 0.55, 0.9, -0.35);
  A(turret, BOX(0.12, 0.22, 0.12), TMAT.dark, 0.55, 1.05, -0.05);
  A(turret, CYL(0.035, 0.035, 0.9, 6), TMAT.dark, 0.55, 1.12, 0.32, Math.PI / 2);
  A(turret, BOX(0.1, 0.16, 0.3), TMAT.dark, 0.55, 1.12, -0.05);
  // smoke dischargers, storage basket, antennas, side bins
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) A(turret, CYL(0.06, 0.06, 0.3, 8), TMAT.dark, sx * (1.12 + k * 0.03), 0.55 + k * 0.12, 0.62, -0.7, 0, -sx * 0.5);
    A(turret, BOX(0.28, 0.42, 0.9), detMat, sx * 1.38, 0.4, -0.75);
  }
  A(turret, BOX(1.9, 0.05, 0.55), TMAT.dark, 0, 0.42, -2.18);
  for (const sx of [-0.95, 0, 0.95]) A(turret, BOX(0.04, 0.35, 0.04), TMAT.dark, sx, 0.6, -2.44);
  A(turret, BOX(1.9, 0.04, 0.04), TMAT.dark, 0, 0.78, -2.44);
  A(turret, CYL(0.17, 0.17, 1.6, 10), TMAT.canvas, 0, 0.62, -2.15, 0, 0, Math.PI / 2);
  for (const sx of [-0.8, 0.8]) { A(turret, CYL(0.025, 0.012, 2.4, 4), TMAT.dark, sx, 1.95, -1.55); A(turret, CYL(0.06, 0.08, 0.12, 6), TMAT.dark, sx, 0.84, -1.55); }

  // ── gun: mantlet, barrel with fume extractor, muzzle brake ──
  const gun = new THREE.Group(); gun.position.set(0, 0.45, 1.35); turret.add(gun);
  A(gun, BOX(1.0, 0.62, 0.42), detMat, 0, 0, 0.12);
  A(gun, CYL(0.31, 0.31, 0.98, 14), hullMat, 0, 0, 0.32, 0, 0, Math.PI / 2);
  A(gun, CYL(0.1, 0.14, 4.3, 12), hullMat, 0, 0, 2.35, Math.PI / 2);
  A(gun, CYL(0.17, 0.17, 0.75, 12), detMat, 0, 0, 2.55, Math.PI / 2);
  A(gun, BOX(0.4, 0.24, 0.52), TMAT.dark, 0, 0, 4.48);
  for (const sx of [-1, 1]) A(gun, BOX(0.03, 0.18, 0.08), TMAT.metal, sx * 0.205, 0, 4.42);
  A(gun, CYL(0.04, 0.04, 0.7, 6), TMAT.dark, 0.45, 0.18, 0.6, Math.PI / 2);   // coaxial MG
  const tip = new THREE.Object3D(); tip.position.set(0, 0, 4.75); gun.add(tip);
  const barrel = new THREE.Object3D(); gun.add(barrel);

  P.finish();
  // turret numbers on both sides
  const nt = numberTex(num);
  for (const sx of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.37), new THREE.MeshStandardMaterial({ map: nt, transparent: true, roughness: .9, polygonOffset: true, polygonOffsetFactor: -2 }));
    n.position.set(sx * 1.335, 0.46, -0.35); n.rotation.y = sx * Math.PI / 2 + (sx > 0 ? 0 : 0); n.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    turret.add(n);
  }
  return { g, turret, gun, barrel, tip, mats, color: new THREE.Color(color), wheels, tracks: [trackTexL, trackTexR] };
}

// ═══════════ TANK ENTITIES ═══════════
function colorFor(p) {
  if (!room) return TEAM_COL[0];
  if (room.mode === 'team') return TEAM_COL[p.team] ?? TEAM_COL[0];
  const idx = room.players.findIndex(q => q.id === p.id);
  return FFA_COLS[(idx < 0 ? 0 : idx) % FFA_COLS.length];
}
function makeTankEntity(p) {
  let hsh = 0; for (const ch of p.id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const vis = buildTank(colorFor(p), String(100 + hsh % 900));
  scene.add(vis.g);
  vis.g.visible = false;
  const t = {
    id: p.id, isMe: p.id === myId, vis, alive: false, hp: MAX_HP,
    x: 0, z: 0, yaw: 0, tYaw: 0, gun: 0, speed: 0, turnRate: 0,
    tx: 0, tz: 0, tyaw: 0, ttYaw: 0, tgun: 0, tspeed: 0,
    quat: new THREE.Quaternion(), recoil: 0, dustT: 0, smokeT: 0, marker: null, losVisible: false, popVel: 0, pop: 0,
    inv: new THREE.Matrix4()
  };
  const mk = document.createElement('div');
  mk.className = 'mk'; mk.innerHTML = '<span></span><div class="bar"><i></i></div>';
  $('markers').appendChild(mk); t.marker = mk;
  tanks.set(p.id, t);
  return t;
}
function removeTank(id) {
  const t = tanks.get(id); if (!t) return;
  scene.remove(t.vis.g); t.marker.remove(); tanks.delete(id);
}
function syncTanks() {
  if (!room) return;
  const ids = new Set(room.players.map(p => p.id));
  for (const id of [...tanks.keys()]) if (!ids.has(id)) removeTank(id);
  for (const p of room.players) {
    let t = tanks.get(p.id);
    if (!t) t = makeTankEntity(p);
    // recolour if team changed
    const col = colorFor(p);
    if (t.vis.color.getHex() !== new THREE.Color(col).getHex() && t.alive) setTankColor(t, col);
    t.isMe = p.id === myId;
  }
}
function setTankColor(t, col) {
  t.vis.color.set(col);
  t.vis.mats[0].color.set(col);
  t.vis.mats[1].color.set(col).multiplyScalar(0.72);
}
function placeTank(t, s) {
  t.x = t.tx = s.x; t.z = t.tz = s.z; t.yaw = t.tyaw = s.yaw; t.tYaw = t.ttYaw = 0; t.gun = t.tgun = 0; t.speed = 0;
  t.alive = true; t.hp = MAX_HP; t.pop = 0; t.popVel = 0;
  t.vis.turret.position.y = 1.62; t.vis.turret.rotation.set(0, 0, 0);
  const p = room.players.find(q => q.id === t.id);
  setTankColor(t, colorFor(p || { id: t.id, team: 0 }));
  t.vis.g.visible = true;
  orientTank(t, 1);
}
function wreckTank(t) {
  t.alive = false; t.speed = 0;
  for (const m of t.vis.mats) m.color.multiplyScalar(0.28);
  t.popVel = 7; // turret pops
}

// orient hull to the terrain under its tracks
function orientTank(t, k) {
  // running gear: spin wheels and scroll treads by how far each side travelled
  if (t.vis.wheels) {
    const dx = t.x - (t.lx ?? t.x), dz = t.z - (t.lz ?? t.z), dyw = wrap(t.yaw - (t.lyaw ?? t.yaw));
    t.lx = t.x; t.lz = t.z; t.lyaw = t.yaw;
    const ds = dx * Math.sin(t.yaw) + dz * Math.cos(t.yaw);
    if (Math.abs(ds) < 4 && (Math.abs(ds) > 1e-5 || Math.abs(dyw) > 1e-5)) {
      const sR = ds + dyw * 1.62, sL = ds - dyw * 1.62;   // sR: local -x side, sL: local +x side
      for (const w of t.vis.wheels) w.rotation.x += (w.position.x < 0 ? sR : sL) / w.userData.r;
      t.vis.tracks[0].offset.y -= sR * 1.64; t.vis.tracks[1].offset.y -= sL * 1.64;
      if (t.alive) {
        t.markD = (t.markD || 0) + Math.abs(ds) + Math.abs(dyw) * 1.6;
        if (t.markD > 0.8) {
          t.markD = 0;
          const cy = Math.cos(t.yaw), sy = Math.sin(t.yaw);
          for (const sx of [-1.62, 1.62]) marks.add(t.x + cy * sx, t.z - sy * sx, t.yaw);
        }
      }
    }
  }
  const sy = Math.sin(t.yaw), cy = Math.cos(t.yaw);
  const hF = H(t.x + sy * 2.6, t.z + cy * 2.6), hB = H(t.x - sy * 2.6, t.z - cy * 2.6);
  const rx = -cy, rz = sy;
  const hR = H(t.x + rx * 1.6, t.z + rz * 1.6), hL = H(t.x - rx * 1.6, t.z - rz * 1.6);
  const f = _v1.set(sy, (hF - hB) / 5.2, cy).normalize();
  const r = _v2.set(rx, (hR - hL) / 3.2, rz).normalize();
  const up = _v3.crossVectors(r, f).normalize();
  const xa = _v4.crossVectors(up, f).normalize();
  const f2 = r.crossVectors(xa, up);
  _m1.makeBasis(xa, up, f2);
  _q1.setFromRotationMatrix(_m1);
  t.quat.slerp(_q1, k);
  const g = t.vis.g;
  g.quaternion.copy(t.quat);
  g.position.set(t.x, Math.max(hF, hB, hR, hL, H(t.x, t.z)) - 0.05, t.z);
  t.vis.turret.rotation.y = t.tYaw;
  t.vis.gun.rotation.x = -t.gun;
  t.vis.gun.position.z = 1.35 - t.recoil * 0.55;
  if (!t.alive && t.popVel !== 0) {
    t.pop += t.popVel * (1 / 60); t.popVel -= 20 / 60;
    if (t.pop <= 0) { t.pop = 0; t.popVel = 0; }
    t.vis.turret.position.y = 1.62 + t.pop;
    t.vis.turret.rotation.z = t.pop * 0.12; t.vis.turret.rotation.x = t.pop * 0.05;
  }
  g.updateMatrixWorld(true);
  t.inv.copy(g.matrixWorld).invert();
}

// ═══════════ COLLISION & RAYS ═══════════
const TANK_R = 2.3;
function collideTank(t) {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    // two circles along the hull approximate the long body
    for (const off of [1.6, -1.6]) {
      const cx = t.x + Math.sin(t.yaw) * off, cz = t.z + Math.cos(t.yaw) * off, r = 1.9;
      for (const c of world.circles) {
        const dx = cx - c.x, dz = cz - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 0.0001) { t.x += dx / d * (m - d); t.z += dz / d * (m - d); hit = true; }
      }
      for (const b of world.boxes) {
        const qx = Math.max(b.x - b.hx, Math.min(cx, b.x + b.hx)), qz = Math.max(b.z - b.hz, Math.min(cz, b.z + b.hz));
        const dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 0.0001) { t.x += dx / d * (r - d); t.z += dz / d * (r - d); }
          else { // centre inside box: push out on the shortest axis
            const ox = b.hx - Math.abs(cx - b.x), oz = b.hz - Math.abs(cz - b.z);
            if (ox < oz) t.x += Math.sign(cx - b.x || 1) * (ox + r); else t.z += Math.sign(cz - b.z || 1) * (oz + r);
          }
          hit = true;
        }
      }
    }
    for (const o of tanks.values()) {
      if (o === t || !o.vis.g.visible) continue;
      const dx = t.x - o.x, dz = t.z - o.z, d = Math.hypot(dx, dz), m = TANK_R * 2 * 0.95;
      if (d < m && d > 0.0001) { t.x += dx / d * (m - d); t.z += dz / d * (m - d); hit = true; }
    }
  }
  const lim = MAP_HALF - 6;
  if (Math.abs(t.x) > lim) { t.x = Math.sign(t.x) * lim; hit = true; }
  if (Math.abs(t.z) > lim) { t.z = Math.sign(t.z) * lim; hit = true; }
  return hit;
}

function rayAABB(o, d, mn, mx, maxT) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sgn = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) return null; continue; }
    let t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a], s = -1;
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0 || tmin > maxT) return null;
  return { t: Math.max(0, tmin), axis, sgn };
}
function raySphere(o, d, c, r, maxT) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxT ? t : (cc < 0 ? 0 : null);
}
function rayTerrain(o, d, maxT, step = 2) {
  let prev = 0;
  if (o[1] < H(o[0], o[2])) return 0;
  for (let t = step; t <= maxT + step; t += step) {
    const tt = Math.min(t, maxT);
    if (o[1] + d[1] * tt < H(o[0] + d[0] * tt, o[2] + d[2] * tt)) {
      let a = prev, b = tt;
      for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (o[1] + d[1] * m < H(o[0] + d[0] * m, o[2] + d[2] * m)) b = m; else a = m; }
      return b;
    }
    prev = tt;
    if (tt >= maxT) break;
  }
  return null;
}
const _lo = [0, 0, 0], _ld = [0, 0, 0];
const HB_MIN = [-1.95, 0.2, -3.4], HB_MAX = [1.95, 2.55, 3.5];
// returns { t, kind, tank, axis, sgn, ldir }
function castRay(o, d, maxT, ignoreId, opts = {}) {
  let best = null, bt = maxT;
  const tt = rayTerrain(o, d, maxT, opts.step || 2);
  if (tt !== null) { bt = tt; best = { t: tt, kind: 'terrain' }; }
  for (const c of world.circles) {
    // cheap reject: distance from ray to circle centre in xz
    const px = c.x - o[0], pz = c.z - o[2];
    const proj = px * d[0] + pz * d[2];
    const hlen = Math.hypot(d[0], d[2]) || 1e-6;
    if (proj < -c.r * 2 || proj / (hlen * hlen) > bt + c.r * 2) continue;
    const perp = Math.abs(px * d[2] - pz * d[0]) / hlen;
    if (perp > (c.sr || c.r) + 0.5) continue;
    let t;
    if (c.sphere) t = raySphere(o, d, [c.x, c.cy, c.z], c.sr, bt);
    else { const r = rayAABB(o, d, [c.x - .45, c.y0, c.z - .45], [c.x + .45, c.y1, c.z + .45], bt); t = r ? r.t : null; }
    if (t !== null && t < bt) { bt = t; best = { t, kind: 'obj' }; }
  }
  for (const b of world.boxes) {
    const r = rayAABB(o, d, [b.x - b.hx, b.y0, b.z - b.hz], [b.x + b.hx, b.y1, b.z + b.hz], bt);
    if (r && r.t < bt) { bt = r.t; best = { t: r.t, kind: 'obj' }; }
  }
  if (!opts.noTanks) for (const tk of tanks.values()) {
    if (tk.id === ignoreId || !tk.vis.g.visible) continue;
    const dx = tk.x - o[0], dz = tk.z - o[2];
    if (dx * dx + dz * dz > (bt + 6) * (bt + 6)) continue;
    _v1.set(o[0], o[1], o[2]).applyMatrix4(tk.inv); _lo[0] = _v1.x; _lo[1] = _v1.y; _lo[2] = _v1.z;
    _v2.set(d[0], d[1], d[2]).transformDirection(tk.inv); _ld[0] = _v2.x; _ld[1] = _v2.y; _ld[2] = _v2.z;
    const r = rayAABB(_lo, _ld, HB_MIN, HB_MAX, bt);
    if (r && r.t < bt) { bt = r.t; best = { t: r.t, kind: 'tank', tank: tk, axis: r.axis, sgn: r.sgn, ldir: [_ld[0], _ld[1], _ld[2]] }; }
  }
  return best;
}

// ═══════════ PARTICLES ═══════════
const particles = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d'); const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const N = 320, pool = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
    pool.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, a0: 1, drag: 0, grav: 0 });
  }
  let idx = 0;
  function spawn(x, y, z, o) {
    const p = pool[idx]; idx = (idx + 1) % N;
    p.s.position.set(x, y, z); p.s.visible = true;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = p.max = o.life || 1; p.s0 = o.s0 || 1; p.s1 = o.s1 ?? p.s0; p.a0 = o.a ?? 1; p.drag = o.drag || 0; p.grav = o.grav || 0;
    p.s.material.color.set(o.color ?? 0xffffff);
    p.s.material.blending = o.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.s.material.opacity = p.a0; p.s.scale.setScalar(p.s0);
  }
  function update(dt) {
    for (const p of pool) {
      if (!p.s.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const k = 1 - p.life / p.max;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy = p.vy * dr - p.grav * dt; p.vz *= dr;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(lerp(p.s0, p.s1, k));
      p.s.material.opacity = p.a0 * (1 - k) * (k < 0.1 ? k * 10 : 1);
    }
  }
  const R = () => Math.random() - 0.5;
  return {
    update,
    muzzle(pos, dir) {
      spawn(pos.x, pos.y, pos.z, { life: .09, s0: 3.2, s1: 1.5, color: 0xffd38a, add: true });
      for (let i = 0; i < 3; i++) spawn(pos.x + dir.x * i * .7, pos.y + dir.y * i * .7, pos.z + dir.z * i * .7, { life: .12, s0: 2 - i * .4, s1: .6, color: 0xffa04a, add: true });
      for (let i = 0; i < 8; i++) spawn(pos.x, pos.y, pos.z, { vx: dir.x * 8 + R() * 4, vy: dir.y * 8 + R() * 3 + 1, vz: dir.z * 8 + R() * 4, life: 1.3 + Math.random(), s0: 1.2, s1: 4.5, color: 0xcfcac0, a: .5, drag: 2.5 });
    },
    impact(pos, big) {
      const n = big ? 14 : 8;
      spawn(pos.x, pos.y, pos.z, { life: .15, s0: big ? 5 : 3, s1: 1, color: 0xffc070, add: true });
      for (let i = 0; i < n; i++) spawn(pos.x, pos.y, pos.z, { vx: R() * 14, vy: Math.random() * 10 + 2, vz: R() * 14, life: .5 + Math.random() * .4, s0: .35, s1: .1, color: 0xffd080, add: true, grav: 22, drag: 1 });
      for (let i = 0; i < n; i++) spawn(pos.x + R(), pos.y + R(), pos.z + R(), { vx: R() * 4, vy: Math.random() * 3 + 1, vz: R() * 4, life: 1.2 + Math.random(), s0: 1.2, s1: 4, color: 0x8f877a, a: .55, drag: 1.5 });
    },
    dirt(pos) {
      for (let i = 0; i < 10; i++) spawn(pos.x, pos.y, pos.z, { vx: R() * 6, vy: Math.random() * 9 + 3, vz: R() * 6, life: 1 + Math.random() * .6, s0: .9, s1: 3, color: 0x6e604a, a: .7, grav: 9, drag: 1.2 });
      spawn(pos.x, pos.y, pos.z, { life: .12, s0: 2.5, s1: 1, color: 0xffc070, add: true });
    },
    explosion(pos) {
      spawn(pos.x, pos.y + 1, pos.z, { life: .35, s0: 9, s1: 4, color: 0xffb050, add: true });
      for (let i = 0; i < 18; i++) spawn(pos.x, pos.y + 1, pos.z, { vx: R() * 16, vy: Math.random() * 12 + 4, vz: R() * 16, life: .6 + Math.random() * .6, s0: 1.4, s1: .3, color: i % 2 ? 0xff8a3a : 0xffd27a, add: true, grav: 14, drag: 1.2 });
      for (let i = 0; i < 16; i++) spawn(pos.x + R() * 2, pos.y + 1, pos.z + R() * 2, { vx: R() * 5, vy: Math.random() * 5 + 2, vz: R() * 5, life: 2 + Math.random() * 1.5, s0: 2, s1: 7, color: 0x3a3632, a: .7, drag: 1.2 });
    },
    smoke(pos) { spawn(pos.x + R(), pos.y, pos.z + R(), { vx: R() * .8 + 1, vy: 2.5 + Math.random(), vz: R() * .8, life: 3 + Math.random(), s0: 1.5, s1: 6, color: 0x2e2c2a, a: .45, drag: .3 }); },
    fire(pos) { spawn(pos.x + R() * .8, pos.y, pos.z + R() * .8, { vy: 2 + Math.random() * 2, life: .5, s0: 1.4, s1: .4, color: 0xff7a2a, add: true }); },
    dust(pos) { spawn(pos.x, pos.y + .3, pos.z, { vx: R() * 1.5, vy: .6, vz: R() * 1.5, life: 1.2, s0: 1, s1: 3.2, color: 0xa29780, a: .35, drag: 1.5 }); },
    heal(pos) { for (let i = 0; i < 12; i++) spawn(pos.x + R() * 3, pos.y + Math.random() * 2, pos.z + R() * 3, { vy: 3 + Math.random() * 2, life: .9, s0: .6, s1: .2, color: 0x9bff7a, add: true }); }
  };
})();

// muzzle light (one shared, cheap)
const flashLight = new THREE.PointLight(0xffb060, 0, 30, 2);
scene.add(flashLight);
let flashT = 0;

// ═══════════ SHELLS ═══════════
const shellGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.6, 5); shellGeo.rotateX(Math.PI / 2);
const shellMat = new THREE.MeshBasicMaterial({ color: 0xffdc8a, fog: false });
function spawnShell(o, v, ownerId, mine) {
  const m = new THREE.Mesh(shellGeo, shellMat);
  m.position.copy(o); scene.add(m);
  shells.push({ m, p: o.clone(), v: v.clone(), owner: ownerId, mine, life: 3.5 });
}
const _o = [0, 0, 0], _d = [0, 0, 0];
function updateShells(dt) {
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.life -= dt;
    const nv = _v3.copy(s.v); nv.y -= GRAVITY * dt;
    const step = _v4.copy(s.v).add(nv).multiplyScalar(0.5 * dt);
    const len = step.length();
    _o[0] = s.p.x; _o[1] = s.p.y; _o[2] = s.p.z;
    _d[0] = step.x / len; _d[1] = step.y / len; _d[2] = step.z / len;
    const hit = castRay(_o, _d, len, s.owner, { step: 1.2 });
    s.v.copy(nv);
    if (hit) {
      const pt = new THREE.Vector3(_o[0] + _d[0] * hit.t, _o[1] + _d[1] * hit.t, _o[2] + _d[2] * hit.t);
      onShellHit(s, hit, pt);
      scene.remove(s.m); shells.splice(i, 1); continue;
    }
    s.p.add(step);
    s.m.position.copy(s.p);
    s.m.lookAt(_v1.copy(s.p).add(s.v));
    if (s.life <= 0 || Math.abs(s.p.x) > MAP_HALF + 200 || Math.abs(s.p.z) > MAP_HALF + 200) { scene.remove(s.m); shells.splice(i, 1); }
  }
}
function onShellHit(s, hit, pt) {
  if (hit.kind === 'tank') {
    if (!s.mine) return; // the server's echo shows the effect
    const tk = hit.tank;
    if (!tk.alive || !isEnemy(tk.id)) { particles.impact(pt, false); audio.at('ricochet', pt, .5); return; }
    // angle of incidence vs the face normal (local box)
    const cos = Math.abs(hit.ldir[hit.axis]);
    const zone = hit.axis === 2 ? (hit.sgn > 0 ? 'front' : 'rear') : hit.axis === 1 ? 'top' : 'side';
    const ricLimit = zone === 'front' ? 0.36 : 0.30;  // ~69° / ~72°
    const p = [+pt.x.toFixed(2), +pt.y.toFixed(2), +pt.z.toFixed(2)];
    if (cos < ricLimit) { socket.emit('hit', { target: tk.id, ric: true, pt: p }); return; }
    const mult = { front: 0.8, side: 1.0, rear: 1.35, top: 1.2 }[zone];
    const dmg = BASE_DMG * mult * (0.75 + Math.random() * 0.5);
    socket.emit('hit', { target: tk.id, dmg, pt: p, zone });
  } else if (hit.kind === 'obj') {
    particles.impact(pt, false); audio.at('ricochet', pt, .55, 0.9 + Math.random() * .2);
  } else {
    particles.dirt(pt); craters.add(pt.x, pt.z, Math.random() * 3, 0.8 + Math.random() * 0.5); audio.at('ricochet', pt, .25, 0.6);
  }
}

// ═══════════ INPUT ═══════════
const keys = {};
let camYaw = 0, camPitch = -0.12, camDist = 13, sniper = false, mouseFire = false, locked = false;
let chatOpen = false;
addEventListener('keydown', e => {
  if (chatOpen) {
    if (e.key === 'Enter') { const t = $('chatin').value.trim(); if (t) socket.emit('chat', t); closeChat(); }
    if (e.key === 'Escape') closeChat();
    return;
  }
  if (!inGame) return;
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); $('board').classList.add('on'); renderBoard(); }
  if (e.code === 'KeyM') audio.toggle();
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') sniper = !sniper;
  if (e.code === 'Enter') { e.preventDefault(); openChat(); }
  if (e.code === 'Space' && (!myTank() || !myTank().alive)) cycleSpectate();
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('board').classList.remove('on');
});
function openChat() { chatOpen = true; const c = $('chatin'); c.style.display = 'block'; c.value = ''; document.exitPointerLock && document.exitPointerLock(); setTimeout(() => c.focus(), 0); }
function closeChat() { chatOpen = false; const c = $('chatin'); c.style.display = 'none'; c.blur(); lockPointer(); }
function lockPointer() { if (inGame && !isTouch && canvas.requestPointerLock) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} } }
canvas.addEventListener('mousedown', e => {
  if (!inGame) return;
  audio.unlock();
  if (!locked) { lockPointer(); return; }
  if (e.button === 0) mouseFire = true;
  if (e.button === 2) sniper = !sniper;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseFire = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && inGame && !chatOpen && !$('result').classList.contains('on')) { $('pLobbyBtn').style.display = isHost() ? '' : 'none'; showScreen('pause'); }
  if (locked) showScreen(null);
});
addEventListener('mousemove', e => {
  if (!locked) return;
  const s = sniper ? 0.0007 : 0.0022;
  camYaw -= e.movementX * s;
  camPitch = Math.max(sniper ? -0.45 : -0.95, Math.min(sniper ? 0.3 : 0.35, camPitch - e.movementY * s));
});
addEventListener('wheel', e => {
  if (!inGame) return;
  if (sniper) { if (e.deltaY > 0) sniper = false; return; }
  camDist = Math.max(6, Math.min(24, camDist + Math.sign(e.deltaY) * 1.5));
  if (e.deltaY < 0 && camDist <= 6) sniper = true;
}, { passive: true });

// touch controls
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window && innerWidth < 1100;
const touch = { jx: 0, jy: 0, joyId: null, lookId: null, lx: 0, ly: 0, fire: false };
if (isTouch) {
  const joy = $('joy'), knob = $('joyk');
  const jr = () => joy.getBoundingClientRect();
  addEventListener('touchstart', e => {
    if (!inGame) return;
    audio.unlock();
    for (const t of e.changedTouches) {
      if (t.target.id === 'tfire') { touch.fire = true; continue; }
      if (t.target.id === 'tzoom') { sniper = !sniper; continue; }
      if (t.clientX < innerWidth * 0.4 && touch.joyId === null) { touch.joyId = t.identifier; moveJoy(t); }
      else if (touch.lookId === null) { touch.lookId = t.identifier; touch.lx = t.clientX; touch.ly = t.clientY; }
    }
  }, { passive: true });
  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.joyId) moveJoy(t);
      if (t.identifier === touch.lookId) {
        const s = sniper ? 0.002 : 0.005;
        camYaw -= (t.clientX - touch.lx) * s;
        camPitch = Math.max(-0.95, Math.min(0.35, camPitch - (t.clientY - touch.ly) * s));
        touch.lx = t.clientX; touch.ly = t.clientY;
      }
    }
  }, { passive: true });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.target.id === 'tfire') touch.fire = false;
      if (t.identifier === touch.joyId) { touch.joyId = null; touch.jx = touch.jy = 0; knob.style.transform = ''; }
      if (t.identifier === touch.lookId) touch.lookId = null;
    }
  };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  function moveJoy(t) {
    const r = jr(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (t.clientX - cx) / (r.width / 2), dy = (t.clientY - cy) / (r.height / 2);
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    touch.jx = dx; touch.jy = dy;
    knob.style.transform = `translate(${dx * 45}px,${dy * 45}px)`;
  }
}

// ═══════════ LOCAL PLAYER ═══════════
const myTank = () => tanks.get(myId);
let reloadLeft = 0, disp = 0.03, prevTYawWorld = 0, sendT = 0, shake = 0, aimPoint = new THREE.Vector3(), gunMarker = null, markerOnEnemy = false;
let pickupCooldown = 0;

function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

function updateMe(dt, now) {
  const t = myTank();
  if (!t || !t.alive) { audio.engineOff(); return; }
  const canAct = now >= roundStartAt && !chatOpen;
  let fwd = 0, turn = 0;
  if (canAct) {
    fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    turn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
    if (isTouch && touch.joyId !== null) { fwd = -touch.jy; turn = -touch.jx; if (Math.abs(fwd) < .15) fwd = 0; if (Math.abs(turn) < .15) turn = 0; }
  }
  // slope resistance
  const sy = Math.sin(t.yaw), cy = Math.cos(t.yaw);
  const slope = (H(t.x + sy * 2, t.z + cy * 2) - H(t.x - sy * 2, t.z - cy * 2)) / 4;
  const slopeK = Math.max(0.35, 1 - Math.max(0, slope * Math.sign(t.speed || fwd)) * 1.6);
  const target = fwd > 0 ? fwd * MAX_FWD * slopeK : fwd * MAX_REV * slopeK;
  const rate = (Math.sign(target) !== Math.sign(t.speed) && t.speed !== 0) || target === 0 ? BRAKE : ACCEL;
  if (t.speed < target) t.speed = Math.min(target, t.speed + rate * dt);
  else t.speed = Math.max(target, t.speed - rate * dt);
  if (keys.Space) t.speed *= Math.exp(-6 * dt);
  const turnK = 1 - Math.min(0.45, Math.abs(t.speed) / MAX_FWD * 0.45);
  t.turnRate = turn * TURN * turnK;
  t.yaw = wrap(t.yaw + t.turnRate * dt);
  t.x += Math.sin(t.yaw) * t.speed * dt;
  t.z += Math.cos(t.yaw) * t.speed * dt;
  if (collideTank(t)) t.speed *= Math.exp(-5 * dt);

  // turret follows the aim point
  const tp = t.vis.turret.getWorldPosition(_v1);
  const desiredYawW = Math.atan2(aimPoint.x - tp.x, aimPoint.z - tp.z);
  const curYawW = wrap(t.yaw + t.tYaw);
  const dYaw = wrap(desiredYawW - curYawW);
  const maxStep = TURRET_SPEED * dt;
  const stepYaw = Math.max(-maxStep, Math.min(maxStep, dYaw));
  t.tYaw = wrap(t.tYaw + stepYaw); // relative to hull
  // gun elevation with ballistic drop compensation
  const gp = t.vis.gun.getWorldPosition(_v2);
  const dx = Math.hypot(aimPoint.x - gp.x, aimPoint.z - gp.z), dy = aimPoint.y - gp.y;
  const v2 = SHELL_SPEED * SHELL_SPEED, disc = v2 * v2 - GRAVITY * (GRAVITY * dx * dx + 2 * dy * v2);
  let wantPitch = disc >= 0 && dx > 0.5 ? Math.atan((v2 - Math.sqrt(disc)) / (GRAVITY * dx)) : Math.atan2(dy, dx);
  // remove hull tilt along the turret direction
  _v3.set(0, 0, 1).transformDirection(t.vis.turret.matrixWorld);
  const tilt = Math.asin(Math.max(-1, Math.min(1, _v3.y)));
  const wantLocal = Math.max(GUN_MIN, Math.min(GUN_MAX, wantPitch - tilt));
  const dP = wantLocal - t.gun;
  t.gun += Math.max(-GUN_SPEED * dt, Math.min(GUN_SPEED * dt, dP));

  // aim dispersion: grows with movement, settles when still
  const turretRate = Math.abs(stepYaw / dt) + Math.abs(t.turnRate);
  const want = DISP_MIN + Math.abs(t.speed) / MAX_FWD * 0.035 + turretRate * 0.012;
  disp = want > disp ? lerp(disp, want, 1 - Math.exp(-8 * dt)) : disp * Math.exp(-1.25 * dt) + want * (1 - Math.exp(-1.25 * dt));

  // fire
  reloadLeft = Math.max(0, reloadLeft - dt);
  if ((mouseFire || touch.fire) && reloadLeft <= 0 && canAct) fire(t);
  t.recoil = Math.max(0, t.recoil - dt * 2.2);

  // track dust
  t.dustT -= dt;
  if (Math.abs(t.speed) > 3 && t.dustT <= 0) { t.dustT = 0.09; const b = t.vis.g.position; particles.dust(_v1.set(b.x - sy * 3 * Math.sign(t.speed), b.y, b.z - cy * 3 * Math.sign(t.speed))); }

  audio.engine(Math.abs(fwd) + Math.abs(turn) * 0.5, Math.abs(t.speed) / MAX_FWD);

  // crates
  pickupCooldown -= dt;
  const meP = me();
  if (world && pickupCooldown <= 0 && meP && meP.hp < MAX_HP) {
    world.crates.forEach((c, i) => {
      if (c.avail && Math.hypot(c.x - t.x, c.z - t.z) < 4) { socket.emit('pickup', i); pickupCooldown = 0.5; }
    });
  }

  // network
  sendT -= dt;
  if (sendT <= 0) {
    sendT = 0.05;
    socket.emit('st', [+t.x.toFixed(2), +t.z.toFixed(2), +t.yaw.toFixed(3), +t.tYaw.toFixed(3), +t.gun.toFixed(3), +t.speed.toFixed(2)]);
  }
}

function fire(t) {
  reloadLeft = RELOAD;
  const tip = t.vis.tip.getWorldPosition(new THREE.Vector3());
  const dir = t.vis.tip.getWorldDirection(new THREE.Vector3());
  // random deviation inside the aim circle
  const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * disp;
  const up = Math.abs(dir.y) > .95 ? _v1.set(1, 0, 0) : _v1.set(0, 1, 0);
  const side = _v2.crossVectors(dir, up).normalize(), up2 = _v3.crossVectors(side, dir).normalize();
  dir.addScaledVector(side, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize();
  const vel = dir.clone().multiplyScalar(SHELL_SPEED);
  spawnShell(tip, vel, myId, true);
  socket.emit('fire', { o: [+tip.x.toFixed(2), +tip.y.toFixed(2), +tip.z.toFixed(2)], v: [+vel.x.toFixed(2), +vel.y.toFixed(2), +vel.z.toFixed(2)] });
  muzzleFx(t, tip, dir);
  audio.play('shoot', 1.3);
  disp += 0.035; shake = Math.max(shake, 0.35);
}
function muzzleFx(t, tip, dir) {
  t.recoil = 1;
  particles.muzzle(tip, dir);
  flashLight.position.copy(tip); flashLight.intensity = 60; flashT = 0.08;
  // ground blast
  const b = t.vis.g.position;
  for (let i = 0; i < 4; i++) particles.dust(_v1.set(b.x + (Math.random() - .5) * 4, b.y, b.z + (Math.random() - .5) * 4));
}

// ═══════════ REMOTE TANKS ═══════════
socket.on('st', (id, s) => {
  const t = tanks.get(id); if (!t || t.isMe) return;
  t.tx = s[0]; t.tz = s[1]; t.tyaw = s[2]; t.ttYaw = s[3]; t.tgun = s[4]; t.tspeed = s[5];
  t.lastSt = performance.now();
});
function updateRemote(t, dt) {
  const k = 1 - Math.exp(-dt * 12);
  // light extrapolation along heading reduces lag
  t.x = lerp(t.x, t.tx, k); t.z = lerp(t.z, t.tz, k);
  t.yaw = wrap(t.yaw + wrap(t.tyaw - t.yaw) * k);
  t.tYaw = wrap(t.tYaw + wrap(t.ttYaw - t.tYaw) * k);
  t.gun = lerp(t.gun, t.tgun, k);
  t.speed = t.tspeed;
  t.recoil = Math.max(0, t.recoil - dt * 2.2);
  if (t.alive && Math.abs(t.speed) > 3) {
    t.dustT -= dt;
    if (t.dustT <= 0) { t.dustT = 0.12; const b = t.vis.g.position, sy = Math.sin(t.yaw), cy = Math.cos(t.yaw), sg = Math.sign(t.speed); particles.dust(_v1.set(b.x - sy * 3 * sg, b.y, b.z - cy * 3 * sg)); }
  }
}
socket.on('fire', (id, f) => {
  const t = tanks.get(id); if (!t || !world) return;
  const o = new THREE.Vector3(...f.o), v = new THREE.Vector3(...f.v);
  spawnShell(o, v, id, false);
  muzzleFx(t, o, v.clone().normalize());
  audio.at('shoot', o, 1.4);
});

// ═══════════ CAMERA & AIM ═══════════
function updateCamera(dt) {
  const t = myTank();
  let focus = t && t.alive ? t : null;
  if (!focus) {
    spectating = true;
    let st = tanks.get(specId);
    if (!st || !st.alive) { specId = pickSpectate(); st = tanks.get(specId); }
    focus = st || t;
  } else spectating = false;
  $('spec').style.display = spectating && inGame ? 'block' : 'none';
  if (spectating) {
    const p = focus && room.players.find(q => q.id === focus.id);
    $('spec').textContent = focus && focus.alive && focus !== t ? `SPECTATING ${p ? p.name.toUpperCase() : ''} · SPACE TO SWITCH` : 'DESTROYED · WAITING';
  }
  if (!focus) return;
  const useSniper = sniper && !spectating;
  const d = _v1.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const base = focus.vis.g.position;
  let cp;
  if (useSniper) {
    const gp = focus.vis.gun.getWorldPosition(_v2);
    cp = _v3.copy(gp).addScaledVector(d, 1.2); cp.y += 0.6;
    camera.fov = lerp(camera.fov, 16, 1 - Math.exp(-14 * dt));
  } else {
    const target = _v2.set(base.x, base.y + 3.2, base.z);
    cp = _v3.copy(target).addScaledVector(d, -camDist);
    cp.y += camDist * 0.12;
    const gh = H(cp.x, cp.z) + 1.4;
    if (cp.y < gh) cp.y = gh;
    camera.fov = lerp(camera.fov, 60, 1 - Math.exp(-14 * dt));
  }
  camera.updateProjectionMatrix();
  shake = Math.max(0, shake - dt * 1.4);
  const sk = shake * shake * 0.6;
  camera.position.set(cp.x + (Math.random() - .5) * sk, cp.y + (Math.random() - .5) * sk, cp.z + (Math.random() - .5) * sk);
  camera.lookAt(_v4.copy(camera.position).add(d));
  // aim ray from camera centre, starting past our own tank
  const start = useSniper ? 2 : Math.max(0, camDist - 2);
  _o[0] = cp.x + d.x * start; _o[1] = cp.y + d.y * start; _o[2] = cp.z + d.z * start;
  _d[0] = d.x; _d[1] = d.y; _d[2] = d.z;
  const hit = world ? castRay(_o, _d, 650, myId) : null;
  const dist = hit ? hit.t : 650;
  aimPoint.set(_o[0] + _d[0] * dist, _o[1] + _d[1] * dist, _o[2] + _d[2] * dist);
  // shadow camera follows the view
  sun.position.set(base.x + SUN_DIR.x * 160, base.y + SUN_DIR.y * 160, base.z + SUN_DIR.z * 160);
  sun.target.position.set(base.x, base.y, base.z);
}
function pickSpectate() {
  const meP = me();
  const alive = [...tanks.values()].filter(t => t.alive && t.id !== myId);
  const pref = room && room.mode === 'team' && meP ? alive.filter(t => (room.players.find(p => p.id === t.id) || {}).team === meP.team) : [];
  return (pref[0] || alive[0] || {}).id || null;
}
function cycleSpectate() {
  const alive = [...tanks.values()].filter(t => t.alive && t.id !== myId);
  if (!alive.length) return;
  const i = alive.findIndex(t => t.id === specId);
  specId = alive[(i + 1) % alive.length].id;
}
// where would the gun actually hit right now?
function computeGunMarker() {
  const t = myTank();
  if (!t || !t.alive || !world) { gunMarker = null; return; }
  const p = t.vis.tip.getWorldPosition(_v1).clone();
  const v = t.vis.tip.getWorldDirection(new THREE.Vector3()).multiplyScalar(SHELL_SPEED);
  const dt = 1 / 30;
  markerOnEnemy = false;
  for (let i = 0; i < 90; i++) {
    const nv = _v3.copy(v); nv.y -= GRAVITY * dt;
    const step = _v4.copy(v).add(nv).multiplyScalar(dt / 2);
    const len = step.length();
    _o[0] = p.x; _o[1] = p.y; _o[2] = p.z; _d[0] = step.x / len; _d[1] = step.y / len; _d[2] = step.z / len;
    const h = castRay(_o, _d, len, myId, { step: 3 });
    if (h) {
      p.set(_o[0] + _d[0] * h.t, _o[1] + _d[1] * h.t, _o[2] + _d[2] * h.t);
      if (h.kind === 'tank' && h.tank.alive && isEnemy(h.tank.id)) markerOnEnemy = true;
      break;
    }
    p.add(step); v.copy(nv);
  }
  gunMarker = p;
}
function isEnemy(id) {
  if (!room) return true;
  if (room.mode === 'ffa') return id !== myId;
  const a = room.players.find(p => p.id === id), b = me();
  return a && b ? a.team !== b.team : true;
}

// ═══════════ HUD ═══════════
function drawHud(now) {
  const w = innerWidth, h = innerHeight;
  hctx.clearRect(0, 0, w, h);
  if (!inGame) return;
  const t = myTank();
  if (sniper && t && t.alive) {
    // scope vignette
    const r = Math.min(w, h) * 0.46;
    hctx.fillStyle = 'rgba(0,0,0,.82)';
    hctx.beginPath(); hctx.rect(0, 0, w, h); hctx.arc(w / 2, h / 2, r, 0, TAU, true); hctx.fill();
    hctx.strokeStyle = 'rgba(0,0,0,.7)'; hctx.lineWidth = 1.2;
    hctx.beginPath(); hctx.moveTo(w / 2 - r, h / 2); hctx.lineTo(w / 2 - 30, h / 2); hctx.moveTo(w / 2 + 30, h / 2); hctx.lineTo(w / 2 + r, h / 2);
    hctx.moveTo(w / 2, h / 2 + 30); hctx.lineTo(w / 2, h / 2 + r); hctx.stroke();
    for (let i = 1; i < 6; i++) { hctx.beginPath(); hctx.moveTo(w / 2 - 6, h / 2 + 30 + i * 22); hctx.lineTo(w / 2 + 6, h / 2 + 30 + i * 22); hctx.stroke(); }
  }
  if (t && t.alive) {
    // camera crosshair
    hctx.fillStyle = 'rgba(255,255,255,.6)';
    hctx.fillRect(w / 2 - 1, h / 2 - 1, 2, 2);
    if (gunMarker) {
      _v1.copy(gunMarker).project(camera);
      if (_v1.z < 1) {
        const sx = (_v1.x * .5 + .5) * w, sy = (-_v1.y * .5 + .5) * h;
        const fovR = camera.fov * Math.PI / 180;
        const rad = Math.max(9, disp / fovR * h);
        const loaded = reloadLeft <= 0;
        const col = markerOnEnemy ? '#ff5a46' : loaded ? '#f3f1e8' : '#e3a53c';
        for (const [lw, sc] of [[4, 'rgba(0,0,0,.45)'], [2, col]]) {
          hctx.lineWidth = lw; hctx.strokeStyle = sc;
          for (let i = 0; i < 4; i++) { const a0 = i * TAU / 4 + 0.25; hctx.beginPath(); hctx.arc(sx, sy, rad, a0, a0 + TAU / 4 - 0.5); hctx.stroke(); }
        }
        hctx.strokeStyle = col;
        if (!loaded) {
          hctx.lineWidth = 3;
          hctx.beginPath(); hctx.arc(sx, sy, rad + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - reloadLeft / RELOAD)); hctx.stroke();
          hctx.font = '700 11px Unbounded'; hctx.fillStyle = col; hctx.textAlign = 'center';
          hctx.fillText(reloadLeft.toFixed(1), sx, sy + rad + 22);
        }
        hctx.fillStyle = col; hctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }
  }
  if (!locked && !isTouch && t && t.alive) {
    hctx.font = '700 12px Unbounded'; hctx.textAlign = 'center'; hctx.fillStyle = 'rgba(0,0,0,.55)';
    hctx.fillRect(w / 2 - 150, h * 0.62 - 20, 300, 32); hctx.fillStyle = '#e3a53c';
    hctx.fillText('CLICK TO TAKE CONTROL', w / 2, h * 0.62);
  }
  // countdown
  if (now < roundStartAt) {
    const s = Math.ceil((roundStartAt - now) / 1000);
    centerMsg(String(s), room && room.mode === 'team' ? 'ROUND ' + room.round : 'GET READY', 400);
  }
}

let centerTimer = 0;
function centerMsg(big, small = '', ms = 1800, color = '') {
  const c = $('center');
  c.innerHTML = `<span style="color:${color}">${esc(big)}</span>${small ? `<small>${esc(small)}</small>` : ''}`;
  c.style.opacity = 1;
  clearTimeout(centerTimer); centerTimer = setTimeout(() => c.style.opacity = 0, ms);
}
function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html; $('feed').prepend(d);
  setTimeout(() => d.remove(), 6000);
  while ($('feed').children.length > 6) $('feed').lastChild.remove();
}
function logMsg(html) {
  const d = document.createElement('div'); d.innerHTML = html; $('log').prepend(d);
  setTimeout(() => d.remove(), 5000);
  while ($('log').children.length > 5) $('log').lastChild.remove();
}
function nameOf(id) { const p = room && room.players.find(q => q.id === id); return p ? esc(p.name) : '???'; }
function nameCol(id) {
  if (!room) return '#fff';
  if (id === myId) return 'var(--acc)';
  return isEnemy(id) ? '#ff7a68' : '#a4e07a';
}
function floatText(pos, text, cls = '') {
  _v1.copy(pos).project(camera); if (_v1.z > 1) return;
  const d = document.createElement('div'); d.className = 'dmgnum ' + cls; d.textContent = text;
  d.style.left = (_v1.x * .5 + .5) * innerWidth + 'px'; d.style.top = (-_v1.y * .5 + .5) * innerHeight + 'px';
  $('markers').appendChild(d); setTimeout(() => d.remove(), 1100);
}

function updateTopBar(now) {
  if (!room) return;
  if (room.mode === 'team') {
    $('top').innerHTML = `<span class="sc tA">${room.scores[0]}</span><div class="mid">ALPHA · ROUND ${room.round} · BRAVO<br><span style="color:var(--txt)">${aliveCount(0)} vs ${aliveCount(1)}</span></div><span class="sc tB">${room.scores[1]}</span>`;
  } else {
    const left = room.timeLeft != null ? Math.max(0, Math.round((room.timeLeft - (performance.now() - roomRecv)) / 1000)) : 0;
    const lead = [...room.players].sort((a, b) => b.kills - a.kills)[0];
    const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
    $('top').innerHTML = `<div class="mid">TIME<br><span style="color:var(--txt);font-size:16px">${mm}:${ss}</span></div><div class="mid">LEADER<br><span style="color:var(--acc);font-size:12px">${lead ? esc(lead.name) + ' · ' + lead.kills : '-'}</span></div><div class="mid">YOU<br><span style="color:var(--txt);font-size:16px">${me() ? me().kills : 0}</span></div>`;
  }
}
let roomRecv = 0;
function aliveCount(team) { return room.players.filter(p => p.team === team && (tanks.get(p.id) || {}).alive).length; }

function updateBottom() {
  const p = me(); const t = myTank();
  const hp = t && t.alive ? (p ? p.hp : MAX_HP) : 0;
  $('hptxt').textContent = Math.max(0, hp);
  $('hpfill').style.width = Math.max(0, hp) + '%';
  $('hpfill').style.background = hp > 50 ? 'linear-gradient(90deg,#8fbf55,#b6d35f)' : hp > 25 ? 'linear-gradient(90deg,#d29a35,#e3b54a)' : 'linear-gradient(90deg,#c9432f,#e0503f)';
  $('reloadfill').style.width = (100 * (1 - reloadLeft / RELOAD)) + '%';
  $('myname').textContent = p ? p.name.toUpperCase() : '';
}

function renderBoard() {
  if (!room) return;
  const rows = ps => ps.sort((a, b) => b.kills - a.kills || b.dmg - a.dmg).map(p =>
    `<tr class="${p.id === myId ? 'me' : ''} ${(tanks.get(p.id) || {}).alive ? '' : 'dead'}"><td>${esc(p.name)}</td><td class="n">${p.kills}</td><td class="n">${p.dmg}</td><td class="n">${p.deaths}</td></tr>`).join('');
  const head = '<tr><th>TANK</th><th class="n">KILLS</th><th class="n">DAMAGE</th><th class="n">DEATHS</th></tr>';
  if (room.mode === 'team') {
    $('board').innerHTML = [0, 1].map(tm => `<div style="font-size:10px;letter-spacing:.25em;color:${tm ? 'var(--b)' : 'var(--a)'};margin:${tm ? 14 : 0}px 0 4px">${tm ? 'BRAVO' : 'ALPHA'} · ${room.scores[tm]}</div><table>${head}${rows(room.players.filter(p => p.team === tm))}</table>`).join('');
  } else $('board').innerHTML = `<table>${head}${rows([...room.players])}</table>`;
}

// markers above tanks (enemies only when in line of sight)
let losT = 0; const _mkTop = new THREE.Vector3();
function updateMarkers(dt) {
  losT -= dt;
  const doLos = losT <= 0; if (doLos) losT = 0.2;
  const w = innerWidth, h = innerHeight;
  for (const t of tanks.values()) {
    const mk = t.marker;
    if (!inGame || t.id === myId || !t.alive || !t.vis.g.visible) { mk.style.display = 'none'; continue; }
    const enemy = isEnemy(t.id);
    const top = _mkTop.copy(t.vis.g.position); top.y += 4.2;
    if (doLos) {
      if (!enemy) t.losVisible = true;
      else {
        const dx = top.x - camera.position.x, dy = top.y - 1.5 - camera.position.y, dz = top.z - camera.position.z, d = Math.hypot(dx, dy, dz);
        _o[0] = camera.position.x; _o[1] = camera.position.y; _o[2] = camera.position.z; _d[0] = dx / d; _d[1] = dy / d; _d[2] = dz / d;
        const hit = d < 420 ? castRay(_o, _d, d - 2, myId, { noTanks: true, step: 4 }) : true;
        t.losVisible = !hit;
      }
    }
    _v2.copy(top).project(camera);
    if (_v2.z > 1 || !t.losVisible) { mk.style.display = 'none'; continue; }
    const p = room.players.find(q => q.id === t.id);
    mk.style.display = 'block';
    mk.className = 'mk ' + (enemy ? 'en' : 'al');
    mk.style.left = (_v2.x * .5 + .5) * w + 'px'; mk.style.top = (-_v2.y * .5 + .5) * h + 'px';
    mk.firstChild.textContent = p ? p.name : '';
    mk.querySelector('i').style.width = (p ? p.hp : 0) + '%';
  }
}

// ── minimap ──
const mm = $('minimap'), mctx = mm.getContext('2d');
let mmBase = null;
function buildMinimapBase() {
  const S = 380; mmBase = document.createElement('canvas'); mmBase.width = mmBase.height = S;
  const c = mmBase.getContext('2d');
  const k = S / (MAP_HALF * 2);
  const img = c.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = (x / S * 2 - 1) * MAP_HALF, wz = (y / S * 2 - 1) * MAP_HALF;
    const hh = H(wx, wz), i = (y * S + x) * 4;
    const sh = (H(wx + 2, wz + 2) - hh) * 10;
    const base = 70 + hh * 2.2 - sh;
    img.data[i] = base * 0.92; img.data[i + 1] = base * 1.0; img.data[i + 2] = base * 0.78; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // grid
  c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 1;
  for (let i = 1; i < 10; i++) { c.beginPath(); c.moveTo(i * S / 10, 0); c.lineTo(i * S / 10, S); c.moveTo(0, i * S / 10); c.lineTo(S, i * S / 10); c.stroke(); }
  c.fillStyle = 'rgba(40,60,30,.55)';
  for (const t of world.trees) { c.beginPath(); c.arc((t.x + MAP_HALF) * k, (t.z + MAP_HALF) * k, 3, 0, TAU); c.fill(); }
  c.fillStyle = 'rgba(150,148,140,.9)';
  for (const r of world.rocks) { c.beginPath(); c.arc((r.x + MAP_HALF) * k, (r.z + MAP_HALF) * k, Math.max(1.5, r.r * k), 0, TAU); c.fill(); }
  c.fillStyle = '#c9c0ae';
  for (const b of world.boxes) c.fillRect((b.x - b.hx + MAP_HALF) * k, (b.z - b.hz + MAP_HALF) * k, b.hx * 2 * k, b.hz * 2 * k);
}
function drawMinimap() {
  if (!mmBase || !inGame) return;
  const S = 380, k = S / (MAP_HALF * 2);
  // north (−z) up, +x right — matches the view when facing north
  mctx.save();
  mctx.clearRect(0, 0, S, S);
  mctx.drawImage(mmBase, 0, 0);
  const P = (x, z) => [(x + MAP_HALF) * k, (z + MAP_HALF) * k];
  if (world) for (const c of world.crates) if (c.avail) { const [x, y] = P(c.x, c.z); mctx.fillStyle = '#9bff7a'; mctx.fillRect(x - 5, y - 5, 10, 10); }
  for (const t of tanks.values()) {
    if (!t.vis.g.visible) continue;
    const enemy = isEnemy(t.id), isMe = t.id === myId;
    if (enemy && !t.losVisible && t.alive) continue;
    const [x, y] = P(t.x, t.z);
    mctx.save(); mctx.translate(x, y); mctx.rotate(-t.yaw + Math.PI);
    mctx.fillStyle = !t.alive ? '#555' : isMe ? '#fff' : enemy ? '#ff5a46' : '#8fe060';
    mctx.beginPath(); mctx.moveTo(0, -11); mctx.lineTo(7, 8); mctx.lineTo(-7, 8); mctx.closePath(); mctx.fill();
    if (isMe) { mctx.strokeStyle = '#111'; mctx.lineWidth = 2; mctx.stroke(); }
    mctx.restore();
  }
  // view cone
  const t = myTank();
  if (t) {
    const [x, y] = P(t.x, t.z);
    mctx.strokeStyle = 'rgba(255,255,255,.5)'; mctx.lineWidth = 2;
    for (const off of [-0.45, 0.45]) { const a = camYaw + off; mctx.beginPath(); mctx.moveTo(x, y); mctx.lineTo(x + Math.sin(a) * 60, y + Math.cos(a) * 60); mctx.stroke(); }
  }
  mctx.restore();
}

// ═══════════ NETWORK EVENTS ═══════════
socket.on('room', r => {
  const prevState = room && room.state;
  room = r;
  roomRecv = performance.now();
  if (world && r.crates) r.crates.forEach((a, i) => { if (world.crates[i]) world.crates[i].avail = a; });
  if (r.state === 'lobby' && (!inGame && !$('result').classList.contains('on'))) { showScreen(myId ? 'lobby' : 'menu'); }
  if (!myId) return;
  renderLobby();
  if (inGame) { syncTanks(); for (const p of r.players) { const t = tanks.get(p.id); if (t) t.hp = p.hp; } }
  if ($('board').classList.contains('on')) renderBoard();
});

socket.on('roundStart', d => {
  if (!room) return;
  if (worldSeed !== room.seed) { buildWorld(room.seed); worldSeed = room.seed; }
  enterGame(); showScreen(null);
  syncTanks();
  for (const s of shells) scene.remove(s.m); shells.length = 0;
  for (const t of tanks.values()) { t.vis.g.visible = false; t.alive = false; }
  for (const [id, sp] of Object.entries(d.spawns)) { const t = tanks.get(id); if (t) placeTank(t, sp); }
  const t = myTank();
  if (t && t.alive) { camYaw = t.yaw; camPitch = -0.12; }
  reloadLeft = 0; disp = 0.03; sniper = false;
  roundStartAt = performance.now() + d.startAt;
  world.crates.forEach(c => c.avail = true);
});
socket.on('respawn', d => {
  const t = tanks.get(d.id); if (!t) return;
  placeTank(t, d.spawn);
  const rp = room.players.find(q => q.id === d.id); if (rp) { rp.hp = d.hp; rp.alive = true; }
  if (d.id === myId) { camYaw = t.yaw; camPitch = -0.12; reloadLeft = 0; disp = 0.03; centerMsg('BACK IN ACTION', '', 1200); }
});
socket.on('lateJoin', () => {
  if (worldSeed !== room.seed) { buildWorld(room.seed); worldSeed = room.seed; }
  enterGame(); syncTanks();
  centerMsg('JOINED MID-BATTLE', room.mode === 'team' ? 'You play from the next round' : 'Deploying…', 2500);
});
socket.on('dmg', d => {
  const tk = tanks.get(d.target);
  const pt = new THREE.Vector3(...d.pt);
  particles.impact(pt, true);
  if (tk) tk.hp = d.hp;
  const p = room && room.players.find(q => q.id === d.target); if (p) p.hp = d.hp;
  if (d.target === myId) {
    audio.play('hit', 0.9);
    shake = Math.max(shake, 0.6);
    $('flash').style.transition = 'none'; $('flash').style.boxShadow = 'inset 0 0 160px rgba(220,40,30,.75)';
    requestAnimationFrame(() => { $('flash').style.transition = 'box-shadow .6s'; $('flash').style.boxShadow = 'inset 0 0 160px rgba(220,40,30,0)'; });
    logMsg(`<span style="color:#ff7a68">−${d.dmg}</span> from <b style="color:${nameCol(d.by)}">${nameOf(d.by)}</b>${d.zone && d.zone !== 'front' ? ' · ' + d.zone : ''}`);
  } else {
    audio.at('hit', pt, 0.8);
  }
  if (d.by === myId) {
    floatText(pt, '−' + d.dmg + (d.zone === 'rear' ? ' REAR!' : ''));
    logMsg(`Hit <b style="color:${nameCol(d.target)}">${nameOf(d.target)}</b> <span style="color:#ffcf6a">−${d.dmg}</span>${d.zone ? ' · ' + d.zone : ''}`);
  }
});
socket.on('ric', d => {
  const pt = new THREE.Vector3(...d.pt);
  particles.impact(pt, false);
  audio.at('ricochet', pt, 0.9);
  if (d.by === myId) { floatText(pt, 'RICOCHET', 'ric'); }
  if (d.target === myId) { logMsg('Shell ricocheted off your armor'); shake = Math.max(shake, .25); }
});
socket.on('kill', d => {
  const tk = tanks.get(d.target);
  if (tk) {
    wreckTank(tk);
    const pos = tk.vis.g.position.clone();
    particles.explosion(pos);
    audio.at('hit', pos, 1, 0.7);
    setTimeout(() => audio.at('hit', pos, 0.6, 0.55), 160);
    if (d.target === myId) { shake = 1; audio.engineOff(); sniper = false; specId = d.by !== myId ? d.by : null; }
  }
  feed(`<b style="color:${nameCol(d.by)}">${nameOf(d.by)}</b><span class="x">✕</span><b style="color:${nameCol(d.target)}">${nameOf(d.target)}</b>`);
  if (d.by === myId && d.target !== myId) centerMsg('DESTROYED', nameOf(d.target).toUpperCase(), 1500, '#ff7a68');
  if (d.target === myId) centerMsg('YOU WERE DESTROYED', 'by ' + nameOf(d.by), 2500, '#ff7a68');
});
socket.on('roundEnd', d => {
  const meP = me();
  if (d.winner === -1) centerMsg('DRAW', `${d.scores[0]} : ${d.scores[1]}`, 4000);
  else {
    const won = meP && meP.team === d.winner;
    centerMsg(won ? 'ROUND WON' : 'ROUND LOST', `ALPHA ${d.scores[0]} : ${d.scores[1]} BRAVO`, 4000, won ? '#b6d35f' : '#ff7a68');
    if (won && !d.matchOver) audio.play('energy', 0.6);
  }
});
socket.on('matchEnd', d => {
  const meP = me();
  let won, title, sub;
  if (d.mode === 'team') {
    won = meP && meP.team === d.winner;
    title = won ? 'VICTORY' : 'DEFEAT';
    sub = (d.winner === 0 ? 'ALPHA' : 'BRAVO') + ' wins · ' + room.scores[0] + ' : ' + room.scores[1];
  } else {
    won = d.winner === myId;
    title = won ? 'VICTORY' : 'DEFEAT';
    sub = nameOf(d.winner) + ' is top tanker';
  }
  if (won) audio.play('victory', 0.9);
  setTimeout(() => showResult(title, sub, won), 1200);
});
function showResult(title, sub, won) {
  document.exitPointerLock && document.exitPointerLock();
  $('resTitle').textContent = title; $('resTitle').style.color = won ? 'var(--acc)' : '#e0503f';
  $('resSub').textContent = sub;
  const head = '<tr><th>TANK</th><th class="n">KILLS</th><th class="n">DAMAGE</th><th class="n">DEATHS</th></tr>';
  const rows = [...room.players].sort((a, b) => b.kills - a.kills || b.dmg - a.dmg).map(p => `<tr class="${p.id === myId ? 'me' : ''}"><td style="text-align:left">${esc(p.name)}${room.mode === 'team' ? ` <span style="color:${p.team ? 'var(--b)' : 'var(--a)'};font-size:9px">${p.team ? 'BRAVO' : 'ALPHA'}</span>` : ''}</td><td class="n">${p.kills}</td><td class="n">${p.dmg}</td><td class="n">${p.deaths}</td></tr>`).join('');
  $('resTable').innerHTML = `<table>${head}${rows}</table>`;
  $('resAgain').style.display = $('resLobby').style.display = isHost() ? '' : 'none';
  $('resWait').textContent = isHost() ? '' : 'Waiting for the host…';
  showScreen('result');
}
socket.on('lobby', () => { leaveGame(); showScreen('lobby'); renderLobby(); });
socket.on('crate', d => {
  if (!world) return;
  const c = world.crates[d.i]; if (!c) return;
  c.avail = d.avail;
  if (!d.avail) {
    const p = room.players.find(q => q.id === d.by); if (p) p.hp = d.hp;
    const t = tanks.get(d.by); if (t) { t.hp = d.hp; particles.heal(t.vis.g.position); }
    if (d.by === myId) { audio.play('energy', 0.7); centerMsg('+40 REPAIR', '', 900, '#9bff7a'); }
    else audio.at('energy', new THREE.Vector3(c.x, c.y, c.z), 0.5);
  }
});
socket.on('left', d => { if (inGame) feed(`<span style="color:var(--dim)">${esc(d.name)} left</span>`); });
socket.on('chat', d => {
  const el = document.createElement('div');
  el.innerHTML = `<b style="color:${room && room.mode === 'team' ? (d.team ? '#7fa6c9' : '#a9b86a') : 'var(--acc)'}">${esc(d.name)}:</b> ${esc(d.text)}`;
  $('chatlog').appendChild(el);
  while ($('chatlog').children.length > 6) $('chatlog').firstChild.remove();
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 1000); }, 9000);
});
socket.on('disconnect', () => { if (myId) { centerMsg('CONNECTION LOST', 'Reload the page to rejoin', 99999, '#ff7a68'); } });

function enterGame() {
  if (inGame) return;
  inGame = true;
  showScreen(null);
  $('ui').classList.add('on');
  if (isTouch) $('touch').classList.add('on');
  audio.setMusicVol(0.12);
  lockPointer();
}
function leaveGame() {
  inGame = false;
  $('ui').classList.remove('on'); $('touch').classList.remove('on');
  for (const id of [...tanks.keys()]) removeTank(id);
  for (const s of shells) scene.remove(s.m); shells.length = 0;
  audio.engineOff(); audio.setMusicVol(0.35);
  document.exitPointerLock && document.exitPointerLock();
}

// ═══════════ MAIN LOOP ═══════════
let last = performance.now(), menuAngle = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (inGame && world) {
    for (const t of tanks.values()) if (!t.isMe) updateRemote(t, dt);
    updateMe(dt, now);
    for (const t of tanks.values()) {
      if (!t.vis.g.visible) continue;
      orientTank(t, t.isMe ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * 10));
      if (!t.alive) {
        t.smokeT -= dt;
        if (t.smokeT <= 0) { t.smokeT = 0.18; const p = t.vis.g.position; particles.smoke(_v1.set(p.x, p.y + 2.5, p.z)); if (Math.random() < .6) particles.fire(_v1.set(p.x, p.y + 2, p.z)); }
      }
    }
    updateCamera(dt);
    computeGunMarker();
    updateShells(dt);
    for (const c of world.crates) { c.mesh.visible = c.avail; c.mesh.rotation.y += dt; c.mesh.position.y = c.y + Math.sin(now / 400 + c.x) * 0.25; }
    updateMarkers(dt);
    updateTopBar(now); updateBottom(); drawMinimap();
  } else {
    // idle menu flyover
    menuAngle += dt * 0.05;
    if (!world) { buildWorld(12345); worldSeed = null; }
    camera.position.set(Math.sin(menuAngle) * 150, 60, Math.cos(menuAngle) * 150);
    camera.lookAt(0, 0, 0);
    sun.position.set(SUN_DIR.x * 160, SUN_DIR.y * 160, SUN_DIR.z * 160); sun.target.position.set(0, 0, 0);
  }
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) flashLight.intensity = 0; }
  particles.update(dt);
  drawHud(now);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

