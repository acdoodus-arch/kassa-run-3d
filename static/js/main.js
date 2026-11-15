// UI flow: loading, identity, menus, lobby, results, sharing, touch controls.
const THREE = window.THREE;
import { Net } from './net.js';
import { Game, EMOTE_LIST } from './game.js';
import { Audio } from './audio.js';
import { World } from './world.js';
import { makeChar, FONT } from './chars.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AVATARS = ['🏃', '🕶️', '🧢', '🥥', '🛺', '🍛', '🦜', '🐒', '🌴', '🚌'];
const avatarOf = (id) => AVATARS[parseInt((id || '0').slice(0, 4), 16) % AVATARS.length];
const TIPS = ['කොළඹ හදනවා…', 'බස් එකට පරිස්සම්!', 'රජා කොහෙද?', 'කෙසෙල් ලෙල්ලක් රැගෙන යන්න 🍌', 'පටු පාරවල් කස්සාට විතරයි!', 'හෝටලේ තව ටිකයි!'];
let maps = {}, renderer, menuScene, menuCam, menuWorld, menuChars = [], menuOn = true, game, net, cfg, map;
let me = { token: null, profile: null };
let room = null, lastResult = null, soloRun = null, lastSolo = null, joinedFromLink = false, inRound = false;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

const BASE = (window.KASSA_BACKEND || '').replace(/\/$/, '');
function api(path, body) {
  return fetch(BASE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(r => r.json().then(j => ({ ok: r.ok, status: r.status, ...j })));
}
// Free hosting sleeps when idle: show a wake-up/restart bar instead of a silent hang, then continue booting.
async function waitForServer() {
  const ping = () => {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 4000);
    return fetch(BASE + '/api/daily', { cache: 'no-store', signal: c.signal }).then(r => { clearTimeout(t); return r.ok; }).catch(() => { clearTimeout(t); return false; });
  };
  if (await ping()) return;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;width:min(440px,88vw);background:rgba(20,8,40,.95);border:2px solid #ffd23f;border-radius:16px;padding:18px 20px;color:#fff;text-align:center;box-shadow:0 10px 40px #000a';
  box.innerHTML = '<div style="font-size:20px;font-weight:800;margin-bottom:6px">🔄 සර්වරය නැවත ආරම්භ වෙමින්…</div>' +
    '<div class="wmsg" style="font-size:14px;opacity:.9;margin-bottom:12px">සර්වරය නින්දෙන් අවදි කරමින්. තත්පර 30–60ක් ගත විය හැක.</div>' +
    '<div style="height:14px;background:#2a1a4a;border-radius:8px;overflow:hidden"><div class="wbar" style="height:100%;width:0%;background:linear-gradient(90deg,#ffd23f,#ff8fa3);transition:width .5s"></div></div>' +
    '<div class="wsec" style="font-size:12px;opacity:.7;margin-top:8px">0s</div>';
  document.body.appendChild(box);
  const msg = box.querySelector('.wmsg'), bar = box.querySelector('.wbar'), sec = box.querySelector('.wsec');
  const t0 = Date.now();
  for (;;) {
    const el = Date.now() - t0;
    bar.style.width = (95 * (1 - Math.exp(-el / 25000))).toFixed(1) + '%';
    sec.textContent = Math.round(el / 1000) + 's';
    if (el > 20000) msg.textContent = 'තවම අවදි වෙමින්… කරුණාකර රැඳී සිටින්න (නොමිලේ සර්වර් එක නිසා).';
    if (await ping()) {
      bar.style.width = '100%'; msg.textContent = 'සර්වරය සූදානම්! ✅'; await new Promise(r => setTimeout(r, 800));
      box.remove(); return;
    }
    if (el > 150000) { msg.textContent = 'සර්වරය තවම පිළිතුරු දෙන්නේ නැහැ. පිටුව නැවත පූරණය කරන්න (Reload).'; return; }
    await new Promise(r => setTimeout(r, 1500));
  }
}
function reportError(msg, ctx) { try { fetch(BASE + '/api/error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: me.token, msg: String(msg), ctx: String(ctx || '') }) }); } catch (e) {} }
addEventListener('error', (e) => reportError(e.message, (e.filename || '') + ':' + e.lineno));
addEventListener('unhandledrejection', (e) => reportError('promise: ' + (e.reason && e.reason.message || e.reason), ''));

// ---------------------------------------------------------------- screens
const PANELS = ['pName', 'pOnline', 'pLobby', 'pLb', 'pProfile', 'pDaily', 'pHow', 'pSet', 'pResult'];
function showPanel(id) {
  PANELS.forEach(p => $(p).classList.toggle('on', p === id));
  $('menu').classList.toggle('on', !id && !inRound && !$('loading').classList.contains('on'));
}
function showMenu() {
  inRound = false; document.body.classList.remove('ingame');
  if (game && game.running) game.stop();
  $('hud').classList.remove('on'); PANELS.forEach(p => $(p).classList.remove('on')); $('pause').classList.remove('on');
  $('menu').classList.add('on'); menuOn = true; menuLoop(); Audio.music(true); Audio.setIntensity(0.1);
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { Audio.sfx('click'); showPanel(null); }));
function toast(t) { game && game.toast ? game.toast(t) : alert(t); }

// ---------------------------------------------------------------- boot
async function boot() {
  const tip = $('loadTip'); let ti = 0; const tipT = setInterval(() => { tip.textContent = TIPS[++ti % TIPS.length]; }, 1300);
  const fill = (p) => { $('loadFill').style.width = p + '%'; };
  try {
    fill(10);
    cfg = await fetch('content/config.json').then(r => r.json());
    maps = {}; await Promise.all(cfg.maps.map(async (mm) => { maps[mm.id] = await fetch('content/maps/' + mm.id + '.json').then(r => r.json()); }));
    map = maps[cfg.defaultMap];
    fill(30);
    try { await Promise.race([document.fonts.load('800 30px "Noto Sans Sinhala"'), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
    fill(45);
    const canvas = $('gl');
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' }); }
    catch (e) { $('loadTip').textContent = '⚠️ ඔබේ බ්‍රව්සරය WebGL සඳහා සහාය නොදක්වයි.'; clearInterval(tipT); return; }
    renderer.setClearColor(0x8fd3ff);
    let q = 1; try { q = parseFloat(localStorage.getItem('kr_q') || (isTouch ? '0.6' : '1')); } catch (e) {}
    renderer.shadowMap.enabled = q >= 1.5; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    net = new Net();
    game = new Game(renderer, canvas, net, cfg, map); game.q = q; game.resize(); window.game = game;   // handy for debugging in the console
    game.maps = maps; game.onEnd = onGameEnd;
    try { Object.assign(game.opts, JSON.parse(localStorage.getItem('kr_opts') || '{}')); } catch (e) {}
    fill(60);
    await new Promise(r => setTimeout(r, 30));
    buildMenuWorld();
    fill(80);
    wireUi();
    await waitForServer();
    await identify();
    fill(100);
  } catch (e) { console.error(e); reportError('boot ' + e.message, e.stack); $('loadTip').textContent = '⚠️ දෝෂයක්: ' + e.message; clearInterval(tipT); return; }
  clearInterval(tipT);
  $('loading').classList.remove('on');
  showMenu();
  heartbeat();
  loadDailyTeaser();
  const params = new URLSearchParams(location.search);
  if (params.get('room')) { pendingJoin = params.get('room').toUpperCase().slice(0, 5); history.replaceState({}, '', location.pathname); }
  if (pendingJoin && net.open) doPendingJoin();
}
let pendingJoin = null;
function doPendingJoin() { if (pendingJoin) { net.send('join', { code: pendingJoin }); pendingJoin = null; } }

function buildMenuWorld() {
  menuScene = new THREE.Scene();
  menuWorld = new World(menuScene, map, cfg, 4242, [], null, 1);
  menuWorld.setClosetActive(0);
  menuCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 700);
  const k = makeChar('kassa'), r = makeChar('raja'); menuScene.add(k.root); menuScene.add(r.root);
  k.play('sprint'); r.play('chase'); k.anim = 'sprint'; r.anim = 'chase';
  menuChars = [k, r];
  menuLoop._t = 0;
}
let lastMenu = 0;
function menuLoop(now) {
  if (!menuOn) return;
  requestAnimationFrame(menuLoop);
  now = now || performance.now(); const dt = Math.min(0.05, (now - (lastMenu || now)) / 1000); lastMenu = now;
  const t = (menuLoop._t = (menuLoop._t || 0) + dt);
  menuWorld.update(t, dt);
  const [k, r] = menuChars, s = 40 - ((t * 7) % 84);
  k.root.position.set(2.5, 0, s); k.root.rotation.y = Math.PI; k.speed = 8; k.update(dt);
  r.root.position.set(2.5, 0, s + 8); r.root.rotation.y = Math.PI; r.update(dt);
  menuCam.position.set(-2 + Math.sin(t * 0.4) * 2, 3.6 + Math.sin(t * 0.3) * 0.6, s + 11);
  menuCam.lookAt(1, 3.2, s - 12);
  menuCam.aspect = innerWidth / innerHeight; menuCam.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, game.q < 1 ? 1 : 1.5)); renderer.setSize(innerWidth, innerHeight, false);
  renderer.render(menuScene, menuCam);
}

// ---------------------------------------------------------------- identity
async function identify() {
  try { me.token = localStorage.getItem('kr_token'); } catch (e) {}
  if (me.token) {
    const r = await api('/api/identify', { token: me.token });
    if (r.profile) { me.profile = r.profile; return finishIdentity(); }
    me.token = null;
  }
  await askName();
}
function finishIdentity() {
  try { localStorage.setItem('kr_token', me.token); } catch (e) {}
  $('idName').textContent = me.profile.name; $('idAvatar').textContent = avatarOf(me.profile.id);
  game.myName = me.profile.name; game.myId = me.profile.id;
  net.connect(me.token);
}
function askName(force) {
  return new Promise((resolve) => {
    const inp = $('nameIn'); inp.value = force ? me.profile.name : 'Kassa' + Math.floor(Math.random() * 900 + 100); $('nameErr').textContent = '';
    $('loading').classList.remove('on'); showPanel('pName'); $('menu').classList.remove('on');
    const ok = async () => {
      const name = inp.value.trim();
      const r = await api('/api/identify', { token: force ? me.token : (me.token || undefined), name });
      if (r.error) { $('nameErr').textContent = r.error === 'name_taken' ? 'මෙම නම දැනටමත් භාවිතා වෙනවා 😅' : 'නම වලංගු නැහැ (2–16 අකුරු)'; return; }
      me.token = r.token; me.profile = r.profile; cleanup(); finishIdentity(); showPanel(null); if (!inRound) showMenu(); resolve();
    };
    const cancel = () => { cleanup(); showPanel(null); if (me.profile) { showMenu(); resolve(); } };
    const cleanup = () => { $('ceyOk').onclick = null; $('nameOk').onclick = null; $('nameCancel').onclick = null; };
    $('nameOk').onclick = ok; $('nameCancel').onclick = cancel; inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    $('nameCancel').style.display = force ? '' : 'none';
    $('ceyOk').onclick = async () => {
      const u = $('ceyUser').value.trim().toLowerCase(), pw = $('ceyPass').value, err = $('ceyErr'); err.textContent = '';
      if (!/^[a-z0-9_]{3,18}$/.test(u) || !pw) { err.textContent = 'username / password පුරවන්න'; return; }
      try {
        const k = (window.CEYLON_FB || {}).apiKey;
        const fr = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + k, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u + '@drivers.ceylonbus.app', password: pw, returnSecureToken: true }) });
        const fj = await fr.json();
        if (!fj.idToken) { err.textContent = 'username හෝ password වැරදියි'; return; }
        const r = await api('/api/identify', { token: me.token || undefined, ceylon_token: fj.idToken });
        if (r.error || !r.profile) { err.textContent = 'පිවිසීම අසාර්ථකයි (' + (r.error || '?') + ')'; return; }
        me.token = r.token; me.profile = r.profile; $('ceyPass').value = ''; cleanup(); finishIdentity(); showPanel(null); if (!inRound) showMenu(); resolve();
      } catch (e) { err.textContent = 'සම්බන්ධ විය නොහැක'; }
    };
    setTimeout(() => inp.focus(), 50);
  });
}

// ---------------------------------------------------------------- network wiring
function wireNet() {
  net.on('open', () => { $('conn').classList.remove('on'); });
  net.on('close', () => { if (me.token) $('conn').classList.add('on'); });
  net.on('welcome', (m) => { me.profile = m.profile; if (pendingJoin) doPendingJoin(); });
  net.on('err', (m) => {
    const t = { notfound: 'කාමරය හමු නොවීය', full: 'කාමරය පිරී ඇත', started: 'ක්‍රීඩාව දැනටමත් පටන් අරන්', notready: 'සියල්ලන්ම සූදානම් නැහැ', auth: 'හඳුනාගැනීමේ දෝෂයකි' }[m.m] || m.m;
    $('onlineErr').textContent = t; if (game.running) game.toast(t, '#f99'); else if (!$('pLobby').classList.contains('on')) showPanel('pOnline');
  });
  net.on('list', (m) => renderPubList(m.rooms));
  net.on('room', (m) => {
    room = m;
    if (m.state === 'lobby') {
      if (!game.running || !inRound) { showPanel('pLobby'); $('menu').classList.remove('on'); menuOn = true; }
      renderLobby();
    } else if (m.state === 'playing' && !inRound) { /* start message follows */ }
    else if (m.state === 'playing' && inRound) { /* roster update */ }
    if (m.state === 'between' || m.state === 'over') updateResultButtons();
  });
  net.on('left', () => { room = null; showMenu(); });
  net.on('start', startMp);
  net.on('snap', (m) => game.onSnap(m));
  net.on('ev', (m) => game.onEv(m));
  net.on('fx', (m) => game.onFx(m));
  net.on('emote', (m) => game.onEmote(m));
  net.on('corr', (m) => game.onCorr(m));
  net.on('result', (m) => {
    lastResult = m;
    if (game.running && inRound) game.onServerResult(m); else showMpResult(m);
  });
}

function startMp(m) {
  const my = me.profile.id, info = m.roles[my];
  if (!info) return;
  if (m.resume && game.running && game.mode === 'mp' && inRound && game.o.round === m.round && !m.resumeForce) { game.o.startAt = m.startAt; return; }
  inRound = true; menuOn = false; document.body.classList.add('ingame');
  PANELS.forEach(p => $(p).classList.remove('on')); $('menu').classList.remove('on'); $('hud').classList.add('on');
  Audio.unlock();
  game.start({ map: m.map, race: !!m.race, mods: m.mods || [], mode: 'mp', role: info.role, kind: info.kind, seed: m.seed, startAt: m.startAt, head: m.head, roundTime: m.roundTime, closet: m.closet, rspawn: m.rspawn, round: m.round, rounds: m.rounds, roles: m.roles, myId: my, name: me.profile.name, skin: me.profile.skin, resume: m.resume, pos: m.pos });
  $('hud').classList.add('on');
}

// ---------------------------------------------------------------- lobby
function renderLobby() {
  if (!room) return;
  $('lbCode').textContent = room.code;
  const iAmHost = room.host === me.profile.id;
  const list = $('lbPlayers'); list.innerHTML = '';
  for (const p of room.players) {
    const d = document.createElement('div'); d.className = 'pl' + (p.id === me.profile.id ? ' me' : '');
    const pref = { any: '🎲', kassa: '🏃', raja: '🔨' }[p.pref];
    d.innerHTML = `<span class="av">${avatarOf(p.id)}</span><span class="nm">${esc(p.name)} ${p.id === room.host ? '<span class="host">👑</span>' : ''}</span><span class="st">${pref}</span><span class="st ${!p.connected ? 'off' : (p.ready || p.id === room.host) ? 'ok' : ''}">${!p.connected ? 'විසන්ධි' : (p.ready || p.id === room.host) ? 'සූදානම්' : 'බලා සිටී'}</span>`;
    list.appendChild(d);
  }
  const conn = room.players.filter(p => p.connected), allReady = conn.every(p => p.ready || p.id === room.host);
  const mine = room.players.find(p => p.id === me.profile.id);
  $('bReady').style.display = iAmHost ? 'none' : ''; $('bReady').textContent = mine && mine.ready ? '⏳ සූදානම් (අවලංගු)' : '✅ සූදානම්!';
  $('bStart').style.display = iAmHost ? '' : 'none'; $('bStart').disabled = !(conn.length >= 2 && allReady);
  $('lbInfo').textContent = conn.length < 2 ? 'මිතුරන් එනතුරු බලා සිටින්න… (අවම 2 දෙනෙක්)' : !allReady ? 'සියල්ලන්ගේ සූදානම බලා සිටී…' : iAmHost ? 'සූදානම්! ක්‍රීඩාව පටන් ගන්න 👑' : 'Host ක්‍රීඩාව පටන් ගන්නතුරු…';
  document.querySelectorAll('#prefSeg button').forEach(b => b.classList.toggle('on', mine && b.dataset.v === mine.pref));
  document.querySelectorAll('#roundSeg button').forEach(b => { b.classList.toggle('on', +b.dataset.v === room.rounds); b.disabled = !iAmHost; });
  $('lbPub').checked = !!room.pub; $('lbPub').disabled = !iAmHost;
  for (const [id, key] of [['mapSegL', room.map], ['modeSeg', room.mode], ['envTime', room.env && room.env.time], ['envWx', room.env && room.env.weather]]) document.querySelectorAll('#' + id + ' button').forEach(b => { b.classList.toggle('on', b.dataset.v === key); b.disabled = !iAmHost; });
}
function inviteUrl() { return location.origin + '/?room=' + (room ? room.code : ''); }
function renderPubList(rooms) {
  const el = $('pubList'); el.innerHTML = '';
  if (!rooms.length) { el.innerHTML = '<div class="muted">දැනට විවෘත කාමර නෑ — එකක් හදන්න!</div>'; return; }
  for (const r of rooms) { const d = document.createElement('div'); d.className = 'item'; d.innerHTML = `<span>👑 ${esc(r.host)} · ${r.count}/${r.max}</span><button class="mini" data-code="${r.code}">${r.code} ▶</button>`; d.querySelector('button').onclick = () => net.send('join', { code: r.code }); el.appendChild(d); }
}

// ---------------------------------------------------------------- results
function fmtT(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function stat(label, val) { return `<div class="stat"><b>${val}</b><span>${label}</span></div>`; }
function achHtml(list) { return (list || []).map(k => { const a = me.profile.achievements && me.profile.achievements[k]; return a ? `<span>${a.icon} ${esc(a.name)}</span>` : ''; }).join(''); }

function onGameEnd(r) {
  if (r.mp) return showMpResult(r.msg);
  // solo / daily
  const mode = game.mode;
  inRound = false; menuOn = false; $('hud').classList.remove('on'); document.body.classList.remove('ingame');
  const won = r.won, t = r.time;
  lastSolo = { won, t, mode };
  const T = cfg.resultTitles;
  const isRace = r.reason === 'race';
  const tWin = isRace ? '🏁 රජාට කලින් හෝටලයට ආපු වේගවත්ම කස්සා!' : T.kassaWin, tLose = isRace ? '🏁 රජා මුලින්ම හෝටලයට ආවා!' : cfg.dialogue.caught[0];
  $('resEmoji').textContent = won ? '🏆' : (isRace ? '🏃' : '😵');
  $('resTitle').textContent = won ? tWin : tLose;
  $('resSub').textContent = `${me.profile.name} · ${isRace ? (won ? 'රෙස් එක දිනුවා!' : 'රෙස් එක පරාදයි') : (won ? 'හෝටලයට පැනගත්තා!' : 'රජා අල්ලා ගත්තා')}`;
  $('resStats').innerHTML = stat('කාලය', fmtT(t)) + stat('හැංගුම්', r.hides) + stat('ප්‍රති​ඵලය', won ? '✅' : '❌');
  $('resAch').innerHTML = ''; $('resScores').innerHTML = '';
  $('bNext').style.display = 'none'; $('bAgain').style.display = ''; $('bAgain').textContent = '🔄 නැවත උත්සාහ කරන්න';
  $('resWait').textContent = '';
  drawShare({ emoji: won ? '🏆' : '😵', title: won ? tWin : tLose, name: me.profile.name, lines: [`කාලය ${fmtT(t)}`, isRace ? '🏁 හෝටල් රෙස්' : mode === 'daily' ? '📅 දෛනික අභියෝගය' : 'Solo Escape'] });
  showPanel('pResult');
  if (soloRun) {
    api('/api/solo/finish', { token: me.token, run: soloRun, won, time: t, hides: r.hides, hp: r.hp, hits: r.hits, tricks: r.tricks, frags: r.frags, coins: r.coins, diff: r.diff }).then(res => {
      if (res.ok) { me.profile = res.profile; $('resStats').innerHTML += stat('ලකුණු', '+' + res.score); $('resAch').innerHTML = achHtml(res.ach); if (res.breakdown) $('resScores').innerHTML = res.breakdown.map(b => `<div class="pl"><span class="nm">${esc(b[0])}</span><span class="st ok">${b[1] >= 0 ? '+' : ''}${b[1]}</span></div>`).join('') + `<div class="pl me"><span class="nm">⭐ මුළු ලකුණු</span><span class="st ok">${res.score}</span></div>`; }
      else if (won) $('resWait').textContent = 'ලකුණු සටහන් කළ නොහැකි විය (' + (res.error || '') + ')';
    }).catch(() => {});
    soloRun = null;
  }
}

function showMpResult(m) {
  inRound = false; document.body.classList.remove('ingame'); $('hud').classList.remove('on'); menuOn = true;
  if (game.running) game.stop();
  lastResult = m;
  const my = me.profile.id, iWon = (m.winner === 'kassa') === (m.kassa === my);
  const T = cfg.resultTitles, g = (m.gains && m.gains[my]) || {};
  const kName = (m.scores.find(s => s.id === m.kassa) || {}).name || 'කස්සා';
  const cName = (m.scores.find(s => s.id === m.catcher) || {}).name;
  let title, emoji;
  if (m.winner === 'kassa') { title = m.kassa === my ? T.kassaWin : T.rajaLose; emoji = m.kassa === my ? '🏆' : '😮'; }
  else { title = m.kassa === my ? cfg.dialogue.caught[0] : T.rajaWin; emoji = m.kassa === my ? '😵' : '🔨'; }
  if (m.forfeit) { title = 'ක්‍රීඩකයෙක් විසන්ධි වුණා — වටය අවලංගුයි'; emoji = '🔌'; }
  const wName = (m.scores.find(s => s.id === m.winnerId) || {}).name;
  if (m.race && !m.forfeit) { title = iWon ? '🏁 ඔබ මුලින්ම හෝටලයට ආවා!' : '🏁 ' + (wName || '?') + ' මුලින්ම හෝටලයට ආවා!'; emoji = iWon ? '🏆' : '🏃'; }
  else if (m.reason === 'timeout') { title = m.kassa === my ? 'වේලාව ඉවරයි! කස්සා බේරුණා… නැහැ, රජා දිනුවා!' : 'වේලාව ඉවර — රජා දිනුවා!'; emoji = '⏰'; }
  $('resEmoji').textContent = emoji; $('resTitle').textContent = title;
  $('resSub').textContent = `වටය ${m.round}/${m.rounds} · ` + (m.reason === 'race' ? `🏁 ${esc(wName || '?')} හෝටලයේ දොරට මුලින්ම ළඟා වුණා` : m.race && m.reason === 'timeout' ? 'වේලාව ඉවරයි — හෝටලයට ළඟම හිටපු කෙනා දිනුවා' : m.reason === 'caught' ? `${esc(cName || 'රජා')} විසින් කස්සා අල්ලා ගත්තා` : m.reason === 'escaped' ? `${esc(kName)} හෝටලේට පැනගත්තා!` : m.reason === 'disconnect' ? 'විසන්ධි වීම' : 'කාලය අවසන්');
  $('resStats').innerHTML = stat('කාලය', fmtT(m.time)) + stat('ලකුණු', (g.score >= 0 ? '+' : '') + (g.score || 0)) + stat(iWon ? 'ජය' : 'පරාජය', iWon ? '✅' : '❌');
  $('resAch').innerHTML = achHtml(g.ach);
  if (g.ach && g.ach.length) api('/api/identify', { token: me.token }).then(r => { if (r.profile) me.profile = r.profile; });
  $('resScores').innerHTML = m.scores.map((s, i) => `<div class="pl ${s.id === my ? 'me' : ''}"><span class="av">${i + 1}.</span><span class="nm">${esc(s.name)}</span><span class="st">🏃 ${s.escapes} · 🔨 ${s.catches}</span><span class="st ok">${s.score}</span></div>`).join('');
  if (m.over) { const ch = m.scores.find(s => s.id === m.champion); $('resTitle').textContent = '🏆 ' + (ch ? ch.name : '') + ' — ශූරයා!'; $('resEmoji').textContent = '👑'; $('resSub').textContent = 'තරගය අවසන්! ' + (ch && ch.id === my ? 'ඔබ දිනුවා! 🎉' : ''); }
  const shareTitle = $('resTitle').textContent;
  drawShare({ emoji: $('resEmoji').textContent, title: shareTitle, name: me.profile.name, lines: [`කාලය ${fmtT(m.time)}`, `ලකුණු ${(m.scores.find(s => s.id === my) || {}).score || 0}`, 'Online Chase'] });
  $('bAgain').style.display = 'none';
  showPanel('pResult'); updateResultButtons();
  if (m.over) { Audio.sfx('win'); }
}
function updateResultButtons() {
  if (!room || !lastResult || !$('pResult').classList.contains('on') || !lastResult.round) return;
  const host = room.host === me.profile.id;
  const over = lastResult.over;
  $('bNext').style.display = host ? '' : 'none';
  $('bNext').textContent = over ? '🔄 නැවත ක්‍රීඩා කරන්න (Rematch)' : '▶ ඊළඟ වටය (භූමිකා මාරු)';
  $('resWait').textContent = host ? '' : (over ? 'Host නැවත ආරම්භ කරනතුරු…' : 'Host ඊළඟ වටය ආරම්භ කරනතුරු…');
}

// ---------------------------------------------------------------- share image
function wrapText(ctx, text, maxW) {
  const words = text.split(' '), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function drawShare(d) {
  const c = $('resCanvas'); c.width = 1080; c.height = 1350; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, '#3a1273'); g.addColorStop(0.6, '#ff4d8d'); g.addColorStop(1, '#ff9a1a'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  x.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 14; i++) { x.beginPath(); x.arc((i * 211) % 1080, (i * 347) % 1350, 60 + (i % 4) * 30, 0, 7); x.fill(); }
  x.textAlign = 'center'; x.lineJoin = 'round';
  x.font = `800 96px ${FONT}`; x.lineWidth = 14; x.strokeStyle = '#2a0f4d'; x.fillStyle = '#ffd23f'; x.strokeText('කස්සා RUN 3D', 540, 150); x.fillText('කස්සා RUN 3D', 540, 150);
  x.font = '260px serif'; x.fillText(d.emoji, 540, 470);
  x.font = `800 74px ${FONT}`; x.fillStyle = '#fff'; x.strokeStyle = '#2a0f4d'; x.lineWidth = 12;
  const lines = wrapText(x, d.title, 940); lines.forEach((l, i) => { x.strokeText(l, 540, 620 + i * 100); x.fillText(l, 540, 620 + i * 100); });
  const y0 = 640 + lines.length * 100;
  x.fillStyle = '#ffd23f'; x.font = `800 84px ${FONT}`; x.strokeText(d.name, 540, y0 + 40); x.fillText(d.name, 540, y0 + 40);
  x.fillStyle = '#fff'; x.font = `700 56px ${FONT}`; d.lines.forEach((l, i) => { x.strokeText(l, 540, y0 + 140 + i * 78); x.fillText(l, 540, y0 + 140 + i * 78); });
  x.font = `800 52px ${FONT}`; x.fillStyle = '#ffd23f'; x.fillText('🏨 Ceylon Games · ' + location.host, 540, 1290);
  shareData = d;
}
let shareData = null;
function shareText() { const d = shareData || {}; return `${d.name || ''} — ${d.title || 'කස්සා Run 3D'} 🏨 ${(d.lines || []).join(' · ')}\nCeylon Games: කස්සා Run 3D`; }
function shareWa() { window.open('https://wa.me/?text=' + encodeURIComponent(shareText() + '\n' + location.origin), '_blank'); }
function shareFb() { window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(location.origin) + '&quote=' + encodeURIComponent(shareText()), '_blank'); }
async function shareImg() {
  const c = $('resCanvas');
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'kassa-run.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text: shareText(), url: location.origin }); return; } catch (e) {} }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kassa-run.png'; a.click();
}

// ---------------------------------------------------------------- solo
async function startSolo(daily, race) {
  Audio.unlock(); Audio.sfx('click');
  let r;
  try { r = await api('/api/solo/start', { token: me.token, daily, race: !!race }); } catch (e) { r = null; }
  soloRun = r && r.run;
  const seed = r ? r.seed : Math.floor(Math.random() * 2 ** 31);
  let mods = r ? r.mods.slice() : [];
  if (!daily) { if (game.opts.time !== 'day') mods.push(game.opts.time); if (game.opts.weather !== 'clear' && !mods.includes(game.opts.weather)) mods.push(game.opts.weather); }
  const cur = await currentSeason();
  inRound = true; menuOn = false; document.body.classList.add('ingame');
  PANELS.forEach(p => $(p).classList.remove('on')); $('menu').classList.remove('on');
  game.start({ map: daily ? cfg.defaultMap : undefined, mode: race ? 'race' : daily ? 'daily' : 'solo', race: !!race, role: 'kassa', seed, mods, season: cur, name: me.profile.name, skin: me.profile.skin });
  lastSoloDaily = daily; lastSoloRace = !!race;
}
let lastSoloDaily = false, lastSoloRace = false, seasonCache = null;
async function currentSeason() { if (seasonCache === null) { try { const d = await api('/api/daily'); seasonCache = d.season || false; dailyCache = d; } catch (e) { seasonCache = false; } } return seasonCache || null; }
let dailyCache = null;
async function loadDailyTeaser() {
  try { const d = await api('/api/daily'); dailyCache = d; seasonCache = d.season || false; $('dailySub').textContent = d.mods.map(m => (cfg.modifiers[m] || {}).title || m).join(' · ') || 'අද වෙනස් නීති!'; } catch (e) {}
}

// ---------------------------------------------------------------- panels
async function openLb(kind) {
  showPanel('pLb'); document.querySelectorAll('#lbTabs button').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
  $('lbList').innerHTML = '<div class="muted">…</div>';
  const r = await api('/api/leaderboard?type=' + kind);
  const rows = r.rows || [];
  const timeBoard = kind === 'fastest' || kind === 'daily' || kind === 'race';
  $('lbList').innerHTML = rows.length ? rows.map((x, i) => `<div class="item ${x.id === me.profile.id ? 'me' : ''}"><span class="rk">${['🥇', '🥈', '🥉'][i] || i + 1}</span><span class="nm">${avatarOf(x.id)} ${esc(x.name)}</span><span class="val">${timeBoard ? fmtT(x.val) : Math.round(x.val)}${kind === 'kassa_today' || kind === 'raja_today' || kind === 'mpwins' ? ' ×' : ''}</span></div>`).join('') : '<div class="muted">තවම කිසිවෙක් නෑ — ඔබ පළමුවැන්නා වන්න! 🏃</div>';
}
async function openProfile() {
  showPanel('pProfile');
  const r = await api('/api/profile?id=' + me.profile.id); const p = r.profile; me.profile = p;
  const ach = Object.entries(p.achievements).map(([k, a]) => `<div class="badge ${p.ach.includes(k) ? '' : 'lock'}">${a.icon} ${esc(a.name)}<br><small>${esc(a.desc)}</small></div>`).join('');
  $('profBody').innerHTML = `<div class="idchip" style="background:#fff;color:#2a0f4d;border-color:#2a0f4d"><span style="font-size:36px">${avatarOf(p.id)}</span><b style="font-size:22px">${esc(p.name)}</b></div>
  <div class="stats">${stat('ක්‍රීඩා', p.games)}${stat('ජය', p.wins)}${stat('පැනීම් (කස්සා)', p.escapes)}${stat('අල්ලීම් (රජා)', p.catches)}${stat('හොඳම කාලය', p.best_time ? fmtT(p.best_time) : '—')}${stat('Multiplayer ජය', p.mp_wins)}${stat('ලකුණු', p.score)}</div>
  <h3>🏅 ජයග්‍රහණ</h3><div class="badges">${ach}</div>
  <p class="fine">Ceylon Games ගිණුම් (Ceylon My Bus) සම්බන්ධ කිරීම සඳහා docs/INTEGRATION.md බලන්න. දැනට මෙම ගිණුම මෙම උපාංගයේ ටෝකනයකින් ආරක්ෂා වේ.</p>`;
}
async function openDaily() {
  showPanel('pDaily');
  const d = await api('/api/daily'); dailyCache = d;
  const mods = d.mods.map(m => `<div class="item"><span>${esc((cfg.modifiers[m] || {}).title || m)}</span><small>${esc((cfg.modifiers[m] || {}).desc || '')}</small></div>`).join('');
  const board = (d.board || []).map((x, i) => `<div class="item"><span>${['🥇', '🥈', '🥉'][i] || i + 1} ${esc(x.name)}</span><b>${fmtT(x.val)}</b></div>`).join('') || '<div class="muted">අද තවම කිසිවෙක් නෑ!</div>';
  $('dailyBody').innerHTML = `<p class="muted">${d.day}${d.season ? ' · ' + esc(d.season.name) : ''} — සැමට එකම සිතියම. වේගවත්ම පැනීම දිනුම!</p><div class="list">${mods}</div><h3>අද ඉහළම</h3><div class="list">${board}</div>`;
}
function openSettings() {
  showPanel('pSet');
  const sync = () => { $('sMusic').classList.toggle('on', Audio.musicOn); $('sMusic').textContent = Audio.musicOn ? 'ON' : 'OFF'; $('sSfx').classList.toggle('on', Audio.sfxOn); $('sSfx').textContent = Audio.sfxOn ? 'ON' : 'OFF'; $('sVoice').classList.toggle('on', Audio.voiceOn); $('sVoice').textContent = Audio.voiceOn ? 'ON' : 'OFF'; };
  sync();
  $('sMusic').onclick = () => { Audio.unlock(); Audio.toggleMusic(); sync(); };
  $('sSfx').onclick = () => { Audio.unlock(); Audio.toggleSfx(); sync(); Audio.sfx('pickup'); };
  $('sVoice').onclick = () => { Audio.unlock(); Audio.toggleVoice(); sync(); if (Audio.voiceOn && !Audio.hasSinhalaVoice()) alert('ඔබේ උපාංගයේ සිංහල හඬක් නෑ — පෙළ පමණක් පෙන්වයි.'); };
  const saveOpts = () => { try { localStorage.setItem('kr_opts', JSON.stringify(game.opts)); } catch (e) {} };
  const seg = (id, key, cast) => document.querySelectorAll('#' + id + ' button').forEach(bt => { bt.classList.toggle('on', String(game.opts[key]) === bt.dataset.v); bt.onclick = () => { game.opts[key] = cast ? cast(bt.dataset.v) : bt.dataset.v; saveOpts(); openSettings(); }; });
  $('mapSeg').innerHTML = cfg.maps.map(mm => `<button data-v="${mm.id}">${esc(mm.name)}</button>`).join(''); seg('mapSeg', 'map');
  seg('diffSeg', 'difficulty'); seg('timeSeg', 'time'); seg('wxSeg', 'weather');
  document.querySelectorAll('#qSeg button').forEach(bt => { bt.classList.toggle('on', parseFloat(bt.dataset.v) === game.q); bt.onclick = () => { const nq = parseFloat(bt.dataset.v), reload = (nq >= 1.5) !== (game.q >= 1.5); game.q = nq; try { localStorage.setItem('kr_q', bt.dataset.v); } catch (e) {} game.resize(); if (reload) { if (confirm('අල්ට්‍රා සෙවනැලි සඳහා පිටුව නැවත පූරණය කරන්නද?')) location.reload(); } openSettings(); }; });
  const rng = (id, vid, key, fmt) => { const el = $(id); el.value = game.opts[key]; $(vid).textContent = fmt(game.opts[key]); el.oninput = () => { game.opts[key] = parseFloat(el.value); $(vid).textContent = fmt(game.opts[key]); saveOpts(); }; };
  rng('fovR', 'fovV', 'fov', v => v + '°'); rng('sensR', 'sensV', 'sens', v => v.toFixed(1) + '×'); rng('camR', 'camV', 'camDist', v => v + 'm');
  const tg = (id, key) => { const el = $(id); el.classList.toggle('on', !!game.opts[key]); el.textContent = game.opts[key] ? 'ON' : 'OFF'; el.onclick = () => { game.opts[key] = !game.opts[key]; saveOpts(); tg(id, key); }; };
  tg('sLines', 'lines'); tg('sShake', 'shake');
  const unl = me.profile.unlockedSkins || ['classic'];
  $('skinSeg').innerHTML = cfg.skins.map(s => `<button data-id="${s.id}" class="${me.profile.skin === s.id ? 'on' : ''}" ${unl.includes(s.id) ? '' : 'disabled title="ජයග්‍රහණයකින් අගුළු ඇරෙනවා"'}>${unl.includes(s.id) ? '' : '🔒 '}${esc(s.name)}</button>`).join('');
  $('skinSeg').querySelectorAll('button').forEach(b => b.onclick = async () => { const r = await api('/api/identify', { token: me.token, skin: b.dataset.id }); if (r.profile) { me.profile = r.profile; openSettings(); } });
}

// ---------------------------------------------------------------- UI wiring
function wireUi() {
  wireNet();
  const clk = (id, fn) => $(id).addEventListener('click', () => { Audio.unlock(); Audio.sfx('click'); fn(); });
  clk('bSolo', () => startSolo(false, false));
  clk('bDaily', openDaily); clk('bDailyPlay', () => startSolo(true));
  clk('bOnline', () => { showPanel('pOnline'); $('onlineErr').textContent = ''; net.send('list'); });
  clk('bLb', () => openLb('kassa_today')); clk('bProfile', openProfile); clk('bHow', () => showPanel('pHow')); clk('bSet', openSettings);
  clk('idEdit', () => askName(true));
  document.querySelectorAll('#lbTabs button').forEach(b => b.addEventListener('click', () => openLb(b.dataset.k)));
  clk('bCreate', () => net.send('create', { pub: $('pubChk').checked }));
  clk('bJoin', () => { const c = $('roomCode').value.trim().toUpperCase(); if (c) net.send('join', { code: c }); });
  $('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bJoin').click(); });
  clk('bQuick', () => net.send('quick'));
  clk('bRefresh', () => net.send('list'));
  clk('bCopy', () => { const u = inviteUrl(); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => { $('lbInfo').textContent = '🔗 Link පිටපත් කළා!'; }, () => prompt('Link:', u)); });
  document.querySelectorAll('#prefSeg button').forEach(b => b.addEventListener('click', () => net.send('pref', { v: b.dataset.v })));
  document.querySelectorAll('#roundSeg button').forEach(b => b.addEventListener('click', () => net.send('rounds', { v: +b.dataset.v })));
  $('lbPub').addEventListener('change', () => net.send('public', { v: $('lbPub').checked }));
  document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => net.send('mode', { v: b.dataset.v })));
  $('mapSegL').innerHTML = cfg.maps.map(mm => `<button data-v="${mm.id}">${esc(mm.name)}</button>`).join('');
  document.querySelectorAll('#mapSegL button').forEach(b => b.addEventListener('click', () => net.send('map', { v: b.dataset.v })));
  document.querySelectorAll('#envTime button').forEach(b => b.addEventListener('click', () => net.send('env', { time: b.dataset.v })));
  document.querySelectorAll('#envWx button').forEach(b => b.addEventListener('click', () => net.send('env', { weather: b.dataset.v })));
  clk('bReady', () => { const mine = room.players.find(p => p.id === me.profile.id); net.send('ready', { v: !(mine && mine.ready) }); });
  clk('bStart', () => net.send('start'));
  clk('bLeave', () => { net.send('leave'); });
  clk('bAgain', () => { showPanel(null); startSolo(lastSoloDaily, lastSoloRace); });
  clk('bNext', () => { if (!lastResult) return; net.send(lastResult.over ? 'rematch' : 'next'); });
  clk('bShareImg', shareImg);
  clk('bResMenu', () => { if (room) net.send('leave'); else showMenu(); });
  // HUD buttons
  const press = (id, fn) => { const el = $(id); el.addEventListener('pointerdown', (e) => { e.preventDefault(); Audio.unlock(); fn(); }); };
  press('b_q', () => game.ability('q')); press('b_f', () => game.ability('f')); press('b_r', () => game.ability('r'));
  press('b_e', () => game.actionE()); press('b_sp', () => game.actionSpace());
  const hold = (id, key) => { const el = $(id); el.addEventListener('pointerdown', (e) => { e.preventDefault(); game.touch[key] = key === 'sneak' ? !game.touch.sneak : true; el.style.filter = game.touch[key] ? 'brightness(.8)' : ''; }); if (key === 'sprint') { const off = () => { game.touch.sprint = false; el.style.filter = ''; }; el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off); } };
  hold('b_sprint', 'sprint'); hold('b_sneak', 'sneak');
  const eb = $('emoteBar'); eb.innerHTML = EMOTE_LIST.map((t, i) => `<button data-i="${i}">${i + 1}. ${esc(t)}</button>`).join('');
  eb.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { game.emote(+b.dataset.i); eb.classList.remove('on'); }));
  $('btnEmote').addEventListener('click', () => eb.classList.toggle('on'));
  $('btnMute').addEventListener('click', () => { Audio.unlock(); const on = Audio.toggleMusic(); Audio.toggleSfx(); $('btnMute').textContent = on ? '🔊' : '🔇'; });
  $('btnPause').addEventListener('click', () => { if (game.mode === 'mp') { if (confirm('ක්‍රීඩාවෙන් ඉවත් වෙනවාද?')) { net.send('leave'); } } else game.togglePause(); });
  clk('bResume', () => game.togglePause());
  clk('bQuit', () => { soloRun = null; game.stop(); showMenu(); });
  // joystick + camera drag
  const joy = $('joy'), knob = $('joyKnob'); let jid = null, jc = null;
  joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); const r = joy.getBoundingClientRect(); jc = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; moveJoy(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) moveJoy(e); });
  const endJoy = (e) => { if (e.pointerId === jid) { jid = null; knob.style.transform = ''; game.touch.x = game.touch.z = 0; } };
  joy.addEventListener('pointerup', endJoy); joy.addEventListener('pointercancel', endJoy);
  function moveJoy(e) { let dx = e.clientX - jc.x, dy = e.clientY - jc.y; const m = Math.hypot(dx, dy), R = 55; if (m > R) { dx = dx / m * R; dy = dy / m * R; } knob.style.transform = `translate(${dx}px,${dy}px)`; game.touch.x = dx / R; game.touch.z = -dy / R; }
  let camId = null, last = null; const cv = $('gl');
  cv.addEventListener('touchstart', (e) => { Audio.unlock(); if (camId === null) { const t = e.changedTouches[0]; camId = t.identifier; last = { x: t.clientX, y: t.clientY }; } }, { passive: true });
  cv.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === camId && game.running) { game.camYaw -= (t.clientX - last.x) * 0.006; game.camPitch = Math.max(-0.15, Math.min(1.1, game.camPitch + (t.clientY - last.y) * 0.004)); last = { x: t.clientX, y: t.clientY }; } }, { passive: true });
  const endCam = (e) => { for (const t of e.changedTouches) if (t.identifier === camId) camId = null; };
  cv.addEventListener('touchend', endCam); cv.addEventListener('touchcancel', endCam);
  addEventListener('resize', () => { if (menuCam) { menuCam.aspect = innerWidth / innerHeight; menuCam.updateProjectionMatrix(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && net && !net.open && me.token) net.connect(); });
}

// ---------------------------------------------------------------- analytics heartbeat
let sid = null;
async function heartbeat() {
  try { const r = await api('/api/session', { token: me.token }); sid = r.sid; } catch (e) {}
  setInterval(() => { if (sid && !document.hidden) api('/api/session', { token: me.token, sid }).catch(() => {}); }, 30000);
}

// expose for debugging / automated tests
window.__kassa = { get game() { return game; }, get net() { return net; }, get me() { return me; }, get room() { return room; } };
boot();
