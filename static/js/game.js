// Core gameplay: one class drives solo (AI Raja) and online (human Raja) rounds.
const THREE = window.THREE;
import { mulberry, clamp, lerp, angDiff, lerpAng, collideCircle, losClear, NavGrid, TAU } from './util.js';
import { World } from './world.js';
import { makeChar, makeSprite, setSpriteText, textTexture, M } from './chars.js';
import { RajaAI } from './ai.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const K = { WALK: 3.4, RUN: 6.0, SPRINT: 8.6, SNEAK: 2.2, RAJA: 6.5, BURST: 9.5, MAXHIDE: 7, HOTEL_HIDE: 10 };
const EMOTES = ['කොහෙද දුවන්නේ?', 'හෝටලේ තව ටිකයි!', 'ඉක්මනට හැංගෙන්න!', 'අහු වුණා!', 'හෙමීට හෙමීට...', '😂😂😂', 'අයියෝ!', 'හා හා...'];
export const EMOTE_LIST = EMOTES;
export const DIFF = {
  easy: { ais: 1, spd: 0.9, vis: 0.8, alert: 0.8, hide: 10, stam: 16, ambush: 55, drain: 0.8, seekers: 2, dmgMul: 0.5 },
  normal: { ais: 2, spd: 0.95, vis: 0.9, alert: 1.0, hide: 8, stam: 14, ambush: 40, drain: 1, seekers: 3, dmgMul: 0.7 },
  hard: { ais: 3, spd: 1.1, vis: 1.1, alert: 1.3, hide: 6, stam: 12, ambush: 25, drain: 1.2, seekers: 5, dmgMul: 1 },
  insane: { ais: 4, spd: 1.3, vis: 1.45, alert: 2, hide: 3.5, stam: 10, ambush: 9, drain: 1.5, seekers: 12, dmgMul: 1.4 },
};
const SPOT = {
  bush: ['පඳුර', '🌿', 1], dumpster: ['කුණු බඳුන', '🗑️', 0.9], tuk: ['ටුක් ටුක් එක', '🛺', 1], stall: ['කඩේ මේසය', '🍉', 1], shelter: ['බස් නැවතුම', '🚏', 1.1],
  barrels: ['බැරල්', '🛢️', 1], cart: ['කරත්තය', '🛒', 1], booth: ['දුරකථන කූඩුව', '☎️', 0.8], manhole: ['මෑන්හෝල්', '🕳️', 1.25], shopdoor: ['කඩේ ඇතුලට', '🚪', 1.4],
  car: ['කාර් එක', '🚗', 1], bus: ['බස් එක', '🚌', 1.2], ride: ['ගමන් යන වාහනය', '🚕', 1.3], closet: ['කබඩ් එක', '🔑', 1],
  hut: ['පැලක්/කුඩාගෙයක්', '🛖', 1.2], haystack: ['පිදුරු ගොඩ', '🌾', 1.1], rock: ['ගල් පාෂාණය', '🪨', 1], lookout: ['නිරීක්ෂණ කූඩුව', '🗼', 1.2], boat: ['ඔරුව', '🛶', 1.1],
};
const ITEM = {
  heal: { i: '❤️', t: 'ජීවිතය' }, banana: { i: '🍌', t: 'කෙසෙල් ලෙල්ල දාන්න' }, vada: { i: '🍩', t: 'වඩේ කන්න' }, lucky: { i: '⭐', t: 'වාසනාව පාවිච්චි කරන්න' },
  coconut: { i: '🥥', t: 'පොල් ගෙඩිය ගහන්න' }, smoke: { i: '💨', t: 'දුම් බෝම්බය දාන්න' }, decoy: { i: '🎭', t: 'ඩමි කස්සා දුවවන්න' },
};
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export class Game {
  constructor(renderer, canvas, net, cfg, map) {
    this.renderer = renderer; this.canvas = canvas; this.net = net; this.cfg = cfg; this.map = map; this.baseMap = map; this.maps = null;
    this.keys = {}; this.touch = { x: 0, z: 0, sprint: false, sneak: false };
    this.opts = { map: 'hillcountry', difficulty: 'normal', time: 'day', weather: 'clear', fov: 62, sens: 1, camDist: 6.2, lines: true, shake: true }; this.diff = DIFF.normal;
    this.running = false; this.paused = false; this.q = 1; this.myName = 'Kassa'; this.myId = null;
    this.camYaw = Math.PI; this.camPitch = 0.32; this.camDist = 6.2; this.shake = 0;
    this.onEnd = null; this.lastFrame = 0; this.hudT = 0; this.mmT = 0; this.sendT = 0;
    this.bindInput();
    this.scene = null; this.world = null;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 700);
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.q < 1 ? 1 : 1.75));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  pickLine(k) { const a = this.cfg.dialogue[k] || ['']; return a[Math.floor(Math.random() * a.length)]; }
  sfx(n) { Audio.sfx(n); }

  // ------------------------------------------------------------------ setup
  start(o) {
    this.stop();
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    this.map = (this.maps && this.maps[o.map || this.opts.map]) || this.baseMap;
    this.runId = (this.runId || 0) + 1;
    this.o = o; this.mode = o.mode; this.role = o.role || 'kassa'; this.mods = o.mods || []; this.seed = o.seed;
    this.myName = o.name || 'Kassa'; this.myId = o.myId || null; this.roles = o.roles || {};
    this.race = !!(o.race || o.mode === 'race'); this.diff = this.mode === 'mp' ? DIFF.normal : (DIFF[o.difficulty || this.opts.difficulty] || DIFF.hard);
    this.camDist = this.opts.camDist;
    this.scene = new THREE.Scene();
    this.rnd = mulberry(this.seed ^ 0xabcdef);
    this.world = new World(this.scene, this.map, this.cfg, this.seed, this.mods, o.season, this.q);
    const closetIdx = o.closet ?? Math.floor(this.rnd() * this.map.hotel.closets.length);
    this.world.setClosetActive(closetIdx);
    this.world.onEvent = (type, e) => this.onWorldEvent(type, e);
    this.nav = new NavGrid(this.map.box, this.world.cols, 0.82);
    this.navKey = '';
    this.noises = []; this.bananas = []; this.fx = []; this.remotes = new Map(); this.alertHint = null; this.hint = null; this.trail = null;
    this.phase = 'countdown'; this.ending = false; this.paused = false;
    this.head = o.head || 0; this.roundTime = o.roundTime || 0;
    this.msgT = {}; this.lastRajaWarn = -99; this.hideCount = 0; this.nearHotelSaid = false;
    this.coins = 0; this.rushT = 5; this.walkNoiseT = 0;
    this.cd = { q: 0, f: 0, r: 0, e: 0, sp: 0 }; this.boostT = 0; this.disguiseT = 0; this.item = null;
    this.stamina = 100; this.stamDelay = 0; this.exhausted = false; this.hotelT = 0; this.hotelHide = null;
    this.hiddenSpot = null; this.hotelSearch = false; this.progress = 0;
    this.trailPts = []; this.hintMarks = []; this.searchUntil = 0;
    this.lives = this.mode !== 'mp' && !this.race; this.maxHp = 100; this.hp = 100; this.lifeFlash = 0;
    this.smokes = []; this.projectiles = []; this.decoy = null; this.ambush = null; this.ambushT = undefined; this.cover = false; this.coverT = 0; this.dustT = 0; this.fovNow = this.opts.fov;
    // local actor
    const spawn = this.race ? (this.role === 'kassa' ? this.map.kassaSpawn : [-this.map.kassaSpawn[0], this.map.kassaSpawn[1]]) : (this.role === 'kassa' ? this.map.kassaSpawn : this.map.rajaSpawns[o.rspawn ?? 0]);
    const me = this.me = { x: spawn[0], z: spawn[1], y: 0, ry: this.role === 'kassa' ? Math.PI : 0, vx: 0, vz: 0, r: this.role === 'kassa' ? 0.42 : 0.7, stun: 0, invul: 0, hidden: false, ho: false, hideT: 0, anim: 'idle', sprinting: false, sneaking: false, tp: false, catchAnim: 0 };
    const skin = (this.cfg.skins || []).find(s => s.id === (o.skin || 'classic')) || {};
    this.ch = makeChar(this.role === 'kassa' ? 'kassa' : 'raja', { shirt: skin.shirt, shorts: skin.shorts, cap: skin.cap, kind: o.kind });
    this.ch.setName(this.myName, this.role === 'kassa' ? '#ffd23f' : '#ff8fa3');
    this.scene.add(this.ch.root);
    this.dist0 = Math.hypot(this.map.kassaSpawn[0] - this.map.hotel.door[0], this.map.kassaSpawn[1] - this.map.hotel.door[1]);
    this.camYaw = this.role === 'kassa' ? Math.PI : 0;
    this.buildNPCs();
    if (this.mode !== 'mp') {
      const n = this.race ? 1 : this.diff.ais, sp0 = Math.floor(this.rnd() * this.map.rajaSpawns.length);
      const styles = ['roamer', 'sweeper', 'roamer', 'sweeper'], kinds = ['raja', 'bruiser', 'sprinter', 'scout'], names = ['රජා', 'මහ රජා', 'පුංචි රජා', 'රජුගේ සොයුරා'];
      this.ais = [];
      for (let i = 0; i < n; i++) {
        const rs = this.race ? [-this.map.kassaSpawn[0], this.map.kassaSpawn[1]] : this.map.rajaSpawns[(sp0 + i * 2) % this.map.rajaSpawns.length];
        const ai = new RajaAI(this, makeChar('raja', { kind: kinds[i] }), rs, { style: styles[i], dmg: i === 1 ? 40 : 25, scentEvery: i === 1 ? 3 : 4 });
        this.scene.add(ai.ch.root); ai.ch.setName(names[i], '#ff8fa3'); this.ais.push(ai);
      }
      this.junior = null;
      if (this.race) { this.roundTime = 150; for (const ai of this.ais) ai.ry = 0; }
      this.t = -3.2; this.go = performance.now();
    } else {
      this.ais = []; this.startAt = o.startAt; this.t = (this.net.serverNow() - this.startAt) / 1000;
      if (o.resume && o.pos) { me.x = o.pos.x; me.z = o.pos.z; me.hidden = false; }
      for (const [id, r] of Object.entries(this.roles)) if (id !== this.myId) this.makeRemote(id, r);
    }
    // everyone starts with one random trick so the first ambush is survivable
    if (this.role === 'kassa' || this.race) this.item = ['smoke', 'decoy', 'coconut', 'banana'][Math.floor(this.rnd() * 4)];
    this.hits = 0; this.tricks = 0; this._pz = this.me.z; this.fragHide = null;
    this.quest = null;   // hotel-pass quest removed: the front door is always open
    this.gateOpen = true; this.gateWhy = '';   // (was never set, so the invisible door wall blocked every entry)
    // solo: Kassa starts hidden in the closest hiding place and steps out when ready (E)
    if (this.role === 'kassa' && this.mode !== 'mp' && !this.race && !o.resume) {
      const okS = ['bush', 'dumpster', 'hut', 'rock', 'barrels', 'cart', 'booth', 'haystack', 'stall', 'car', 'boat', 'shelter'];
      const near = this.world.hideSpots.filter(s => okS.includes(s.type) && !s.vehicle).sort((a, b) => Math.hypot(a.x - spawn[0], a.z - spawn[1]) - Math.hypot(b.x - spawn[0], b.z - spawn[1]))[0];
      if (near) { this.hide(near); this.hideLimit = 9999; this.toast('🌿 හැංගිලා ඉන්නවා… රජා ගමන් කරන විට බලන්න. සූදානම් වුණාම E = ගොඩ එන්න', '#9fe8ff'); }
    }
    if (this.world.gateGroup) this.world.gateGroup.visible = !!this.quest;
    this.buildRain();
    this.shadows = this.renderer.shadowMap.enabled;
    if (this.shadows) {
      const sun = this.world.sun; sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 10; sc.far = 220; sun.shadow.bias = -0.0008;
      this.scene.add(sun.target);
      this.world.group.traverse(o => { if (o.isMesh && o.material && o.material.isMeshLambertMaterial) o.receiveShadow = true; });
      for (const v of this.world.vehicles) this.shadowify(v.model);
      this.shadowify(this.ch.root); for (const ai of this.ais) this.shadowify(ai.ch.root); for (const sk of this.seekers) this.shadowify(sk.ch.root);
      for (const r of this.remotes.values()) this.shadowify(r.ch.root);
    }
    this.buildMinimap();
    this.setupHud();
    this.running = true; this.lastFrame = performance.now();
    this.countShown = -9;
    Audio.music(true); Audio.setIntensity(0);
    if (this.mode !== 'mp') this.banner(this.race ? '🏁 රජාට කලින් හෝටලයට!' : 'හෝටලයට පැන ගන්න! 🏨 — රජාගෙන් බේරෙන්න', 3600);
    // preview camera pose
    this.updateCamera(0.016, true);
    cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame((t) => this.loop(t));
  }
  shadowify(root) { root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } }); }
  stop() {
    this.running = false; cancelAnimationFrame(this._raf);
    if (this.world) { this.world.dispose(); this.world = null; }
    this.scene = null; $('hud') && $('hud').classList.remove('on');
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  }

  buildNPCs() {
    const w = this.world, h = this.map.hotel, r = mulberry(this.seed ^ 0x77aa);
    // guard
    this.guard = { ch: makeChar('guard'), x: h.guard[0], z: h.guard[1], cd: 0 };
    this.guard.ch.root.position.set(h.guard[0], 0.14, h.guard[1]); this.scene.add(this.guard.ch.root); this.guard.ch.setName('ආරක්ෂකයා', '#9ad');
    this.guard.cone = this.makeCone(14, 0.55, 0xffe14d); this.guard.cone.position.set(h.guard[0], 0.2, h.guard[1]); this.scene.add(this.guard.cone);
    // watchers outside
    const wp = h.watchers.slice().sort(() => r() - 0.5).slice(0, 2);
    this.watchers = wp.map((p, i) => {
      const ch = makeChar('watcher'); ch.root.position.set(p[0], 0.12, p[1]); this.scene.add(ch.root); ch.setName('ආරක්ෂක මාමා', '#ffb400');
      const cone = this.makeCone(15, 0.5, 0xff8a00); cone.position.set(p[0], 0.2, p[1]); this.scene.add(cone);
      return { ch, cone, x: p[0], z: p[1], base: Math.PI * (0.85 + r() * 0.3), ph: r() * 6, cd: 0 };
    });
    // reporter
    const mp = this.map, cand = [];
    for (const xx of mp.roadLinesX) for (const zz of mp.roadLinesZ) if (zz !== -40 && Math.hypot(xx - mp.kassaSpawn[0], zz - mp.kassaSpawn[1]) > 40 && zz > -35) cand.push([xx + 12, zz]);
    const sp = cand[Math.floor(r() * cand.length)];
    const rep = makeChar('reporter'); rep.root.position.set(sp[0] + 6.5, 0.12, sp[1]); this.scene.add(rep.root); rep.setName('📰 රිපෝටර්', '#ff9aa2');
    this.reporter = { ch: rep, x: sp[0] + 6.5, z: sp[1], hx: sp[0] + 6.5, hz: sp[1], ry: 0, state: 'idle', follow: false, lose: 0, flashT: 0, alertT: 2, giveT: 0, vx: 0, vz: 0 };
    this.buildSeekers();
    if (this.role === 'raja' || this.race) { this.reporter.ch.root.visible = false; this.reporter.state = this.race ? 'off' : this.reporter.state; }
    if (this.race) { this.guard.cone.visible = false; for (const wc of this.watchers) { wc.cone.visible = false; wc.ch.root.visible = false; wc.cd = 1e9; } this.guard.cd = 1e9; }
  }
  buildSeekers() {
    this.seekers = [];
    if (this.race || this.role === 'raja') return;
    const n = this.mode === 'mp' ? 4 : this.diff.seekers;
    for (let i = 0; i < n; i++) {
      let p = this.nav.randomFree(this.rnd), tries = 0;
      while (Math.hypot(p[0] - this.map.kassaSpawn[0], p[1] - this.map.kassaSpawn[1]) < 50 && tries++ < 30) p = this.nav.randomFree(this.rnd);
      const ch = makeChar('seeker'); ch.setName('🔎 හොයනවා', '#ffb347'); ch.root.position.set(p[0], 0.12, p[1]); this.scene.add(ch.root);
      this.seekers.push({ ch, x: p[0], z: p[1], ry: this.rnd() * 6.28, vx: 0, vz: 0, state: 'roam', path: null, pi: 0, wait: 0, ping: 0, lost: 0, repath: 0 });
    }
  }
  // ordinary people hunting for Kassa too: if one spots you he shouts and Raja learns where you are
  updateSeekers(dt) {
    const me = this.me, w = this.world;
    for (const s of this.seekers) {
      const dx = me.x - s.x, dz = me.z - s.z, d = Math.hypot(dx, dz);
      if (d > 110) { s.ch.root.visible = false; continue; }
      s.ch.root.visible = true;
      const range = 15 * (this.disguiseT > 0 ? 0.4 : 1) * (this.cover ? 0.6 : 1) * (me.sneaking ? 0.6 : 1) * (this.mods.includes('night') ? 0.8 : 1) * (this.mods.includes('fog') ? 0.6 : 1) * (this.mods.includes('rain') ? 0.8 : 1);
      const sees = this.phase === 'run' && !me.hidden && d < range && (d < 4 || Math.abs(angDiff(s.ry, Math.atan2(dx, dz))) < 1.1) && losClear(s.x, s.z, me.x, me.z, w.cols, 1.7) && !(d > 3 && this.smokeBlocks(s.x, s.z, me.x, me.z));
      if (sees) {
        if (s.state !== 'chase') { s.state = 'chase'; s.path = null; s.ch.say(this.pickLine('seekerSpot'), 2); Audio.sfx('whistle'); this.toast('🔎 කවුරුහරි දැක්කා! රජාට කියනවා!', '#ffb347'); s.ping = 0; }
        s.lost = 0; s.ping -= dt;
        if (s.ping <= 0) { s.ping = 2.5; this.alertRaja(me.x, me.z, 'seeker'); }
      } else if (s.state === 'chase') { s.lost += dt; if (s.lost > 4.5) { s.state = 'roam'; s.path = null; s.ch.say('අපෝ… නැතිවුණා!', 1.8); } }
      let spd = 3.2;
      if (s.state === 'chase') { spd = d < 1.4 ? 0 : 5.4; s.repath -= dt; if (!s.path || s.repath <= 0) { s.path = this.nav.path(s.x, s.z, me.x, me.z); s.pi = 0; s.repath = 0.5; } }
      else if (s.wait > 0) { s.wait -= dt; spd = 0; s.ry += Math.sin(this.t * 2 + s.x) * dt; }
      else if (!s.path) { const q = this.nav.randomFree(this.rnd); s.path = this.nav.path(s.x, s.z, q[0], q[1]); s.pi = 0; }
      if (s.path && spd > 0) {
        let wp = s.path[s.pi]; while (wp && Math.hypot(wp[0] - s.x, wp[1] - s.z) < 0.9) { s.pi++; wp = s.path[s.pi]; }
        if (!wp) { s.path = null; if (s.state !== 'chase') s.wait = 1 + Math.random() * 2; spd = 0; }
        else { const tx = wp[0] - s.x, tz = wp[1] - s.z, td = Math.hypot(tx, tz) || 1, k = Math.min(1, dt * 8); s.vx += (tx / td * spd - s.vx) * k; s.vz += (tz / td * spd - s.vz) * k; }
      }
      if (!s.path || spd === 0) { s.vx *= 0.8; s.vz *= 0.8; }
      s.hitCd = (s.hitCd || 0) - dt; s.dmg = 10;
      if (this.lives && s.state === 'chase' && d < 1.7 && s.hitCd <= 0 && !me.hidden && this.phase === 'run') { s.ch.once = null; s.ch.play('swing', 0.5); this.hitKassa(s); }
      s.x += s.vx * dt; s.z += s.vz * dt; const pos = { x: s.x, z: s.z }; collideCircle(pos, 0.5, w.cols, null); s.x = pos.x; s.z = pos.z;
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 0.5) s.ry = lerpAng(s.ry, Math.atan2(s.vx, s.vz), Math.min(1, dt * 8)); else if (s.state === 'chase') s.ry = lerpAng(s.ry, Math.atan2(dx, dz), Math.min(1, dt * 8));
      s.ch.root.position.set(s.x, w.groundY(s.x, s.z), s.z); s.ch.root.rotation.y = s.ry; s.ch.setAnim(sp > 0.5 ? (s.state === 'chase' ? 'run' : 'walk') : 'look'); s.ch.speed = 1; s.ch.update(dt);
    }
  }
  makeCone(range, half, color) {
    const n = 14, pos = [0, 0, 0];
    for (let i = 0; i <= n; i++) { const a = -half + (2 * half * i) / n; pos.push(Math.sin(a) * range, 0, Math.cos(a) * range); }
    const idx = []; for (let i = 1; i <= n; i++) idx.push(0, i + 1, i);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = 2; return m;
  }
  buildRain() {
    this.rain = null;
    if (!this.mods.includes('rain')) return;
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 50; pos[i * 3 + 1] = Math.random() * 25; pos[i * 3 + 2] = (Math.random() - 0.5) * 50; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe6ff, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false }));
    this.rain.frustumCulled = false; this.scene.add(this.rain);
  }

  // ------------------------------------------------------------------ remote players (MP)
  makeRemote(id, r) {
    const kind = r.role === 'raja' ? 'raja' : 'kassa';
    const skin = (this.cfg.skins || []).find(s => s.id === r.skin) || {};
    const ch = makeChar(kind, { kind: r.kind, shirt: skin.shirt, shorts: skin.shorts, cap: skin.cap });
    ch.setName(r.name || '?', kind === 'kassa' ? '#ffd23f' : '#ff8fa3');
    ch.root.visible = false; this.scene.add(ch.root);
    const rem = { ch, id, role: r.role, kind: r.kind, x: 0, z: 0, y: 0, ry: 0, tx: 0, tz: 0, ty: 0, tr: 0, anim: 'idle', hid: 0, seenAt: 0, has: false, vx: 0, vz: 0, name: r.name };
    this.remotes.set(id, rem); return rem;
  }
  onSnap(m) {
    if (!this.running) return;
    const now = performance.now();
    for (const p of m.p) {
      let r = this.remotes.get(p.i); if (!r) { const info = this.roles[p.i] || { role: 'raja', name: '?' }; r = this.makeRemote(p.i, info); }
      if (!r.has) { r.x = p.x; r.z = p.z; r.ry = p.r; r.has = true; }
      r.tx = p.x; r.tz = p.z; r.ty = p.y; r.tr = p.r; r.anim = p.a; r.hid = p.h; r.sprint = p.s; r.dg = p.g; r.seenAt = now;
      if (p.rp && this.role === 'raja') { this.reporter.state = 'remote'; this.reporter.tx = p.rp[0]; this.reporter.tz = p.rp[1]; this.reporter.try = p.rp[2]; this.reporter.seen = now; }
    }
  }
  onEv(m) {
    if (!this.running) return;
    switch (m.k) {
      case 'hint': this.hint = { x: m.x, z: m.z, r: m.r, until: this.t + 7 }; this.hintMarks.push(this.hint); this.toast(m.n === 'loud' ? '📢 ශබ්දයක් ඇසුණා!' : m.n === 'ping' ? '📍 කස්සා ආසන්නයේ!' : '📷 කස්සා දැක්කා!', '#ffe14d'); Audio.sfx('ping'); break;
      case 'trail': this.trailPts = m.pts.map(p => ({ x: p[0], z: p[1], until: this.t + 7 })); this.cd.r = m.cd; this.toast('🔍 කස්සා ගිය පාර!', '#7de0ff'); Audio.sfx('ping'); break;
      case 'loud_fail': this.cd.f = m.cd; this.toast('ශබ්දයක් ඇසුණේ නෑ…', '#aaa'); break;
      case 'noise': this.noiseBlips = this.noiseBlips || []; this.noiseBlips.push({ x: m.x, z: m.z, until: this.t + 3.5 }); this.toast('👣 පා සද්ද!', '#ffd0a0'); Audio.sfx('footstep'); break;
      case 'in_hotel': this.toast('කස්සා හෝටලේට ඇතුල් වුණා! 🏨', '#ffe14d'); this.hotelSearch = true; Audio.sfx('alert'); break;
      case 'hotel_hide': this.hotelHide = { start: this.t, secs: m.secs }; if (this.role === 'raja') { this.banner('කස්සා හෝටලේ හැංගෙනවා! ඉක්මනට අල්ලන්න!', 3000); Audio.sfx('alert'); } break;
      case 'hotel_hide_stop': this.hotelHide = null; break;
      case 'miss': this.toast('මග හැරුණා!', '#aaa'); break;
      case 'stunned': this.knockMe(m.secs || 2.5, 'tag'); this.toast('තල්ලු වුණා! 😵', '#ff7a7a'); break;
      case 'peer_disc': this.toast('ක්‍රීඩකයෙක් විසන්ධි වුණා… ⏳', '#ffcc66'); break;
      case 'peer_back': this.toast('ක්‍රීඩකයා ආපසු ආවා ✅', '#9f9'); break;
      case 'peer_left': this.toast('ක්‍රීඩකයෙක් ඉවත් වුණා', '#ffcc66'); break;
    }
  }
  onFx(m) {
    if (!this.running) return;
    const r = this.remotes.get(m.id);
    if (m.k === 'banana') this.addBanana(m.x, m.z, false);
    else if (m.k === 'distract') { this.fxPop('💥 ඩොං!', m.x, 1.6, m.z, '#ffd23f'); Audio.sfx('bonk'); }
    else if (m.k === 'boost' && r) { r.ch.say('⚡', 1); }
    else if (m.k === 'disguise' && r) { r.ch.say('🎭', 1.5); }
    else if (m.k === 'bonk') { this.fxPop('BONK!', m.x, 2.4, m.z); Audio.sfx('bonk'); }
    else if (m.k === 'coconut') this.throwCoconut(m.x, m.z, Math.sin(m.d), Math.cos(m.d), false);
    else if (m.k === 'smoke') this.dropSmoke(m.x, m.z, false);
    else if (m.k === 'decoy') this.spawnDecoy(m.x, m.z, m.d, false, r ? r.name : '?');
  }
  onEmote(m) {
    const txt = EMOTES[m.e] || '😂';
    const r = this.remotes.get(m.id);
    if (m.id === this.myId) this.ch.say(txt, 2.2); else if (r) r.ch.say(txt, 2.2);
    Audio.sfx('emote');
  }
  updateRemotes(dt) {
    const now = performance.now(), me = this.me;
    for (const r of this.remotes.values()) {
      if (!r.has) continue;
      const k = Math.min(1, dt * 14);
      const d = Math.hypot(r.tx - r.x, r.tz - r.z);
      if (d > 8) { r.x = r.tx; r.z = r.tz; } else { r.x += (r.tx - r.x) * k; r.z += (r.tz - r.z) * k; }
      r.y = r.ty; r.ry = lerpAng(r.ry, r.tr, k);
      const fresh = now - r.seenAt < 900;
      let vis = fresh && !r.hid;
      const dd = Math.hypot(r.x - me.x, r.z - me.z);
      if (vis && dd > 9 && !losClear(me.x, me.z, r.x, r.z, this.world.cols, 1.7)) vis = false;
      if (vis && r.role === 'kassa' && r.dg && dd > 14) vis = dd < 9;   // disguised / blended-in Kassa is harder to spot
      if (vis && r.role === 'kassa' && dd > 3 && this.smokeBlocks(me.x, me.z, r.x, r.z)) vis = false;   // smoke bomb
      r.vis = vis; r.ch.root.visible = vis;
      r.ch.root.position.set(r.x, this.world.groundY(r.x, r.z) + r.y * 0, r.z); r.ch.root.rotation.y = r.ry;
      r.ch.setStars(r.anim === 'caught' || r.anim === 'stunned');
      if (r.ch.anim !== r.anim) { r.ch.anim = r.anim; r.ch.animT = 0; r.ch.once = null; }
      r.ch.speed = 1; r.ch.update(dt);
      r.ch.nameTag && (r.ch.nameTag.visible = dd < 28);
    }
    // reporter proxy (Raja side)
    if (this.role === 'raja' && this.reporter.state === 'remote') {
      const R = this.reporter, fresh = now - (R.seen || 0) < 900;
      R.ch.root.visible = fresh;
      if (fresh) { R.x = lerp(R.x, R.tx, Math.min(1, dt * 10)); R.z = lerp(R.z, R.tz, Math.min(1, dt * 10)); R.ch.root.position.set(R.x, 0.12, R.z); R.ch.root.rotation.y = R.try; R.ch.setAnim('run'); }
      R.ch.update(dt);
    }
  }
  kassaRemote() { for (const r of this.remotes.values()) if (r.role === 'kassa') return r; return null; }

  // ------------------------------------------------------------------ info used by AI
  kassaInfo() { const m = this.me; return { x: m.x, z: m.z, hidden: m.hidden, safe: false, sprint: m.sprinting, sneak: m.sneaking, disguise: this.disguiseT > 0, cover: this.cover }; }
  addNoise(x, z, r, life = 1.2) { this.noises.push({ x, z, r, until: this.t + life, heard: false }); }
  bananaAt(x, z, r) { return this.bananas.find(b => Math.hypot(b.x - x, b.z - z) < r); }
  removeBanana(b) { this.scene.remove(b.sp); this.bananas = this.bananas.filter(x => x !== b); }
  addBanana(x, z, mine) {
    const sp = makeSprite('🍌', { size: 70, color: '#fff', pad: 4, scale: 0.008 }); sp.position.set(x, 0.5, z); this.scene.add(sp);
    this.bananas.push({ x, z, sp, until: this.t + 45, mine: !!mine });
  }

  // ---- tricks: coconut, smoke bomb, decoy
  useItem() {
    const me = this.me; if (!this.item || me.hidden || me.stun > 0) return;
    const it = this.item; this.item = null; this.tricks++;
    const fx = Math.sin(me.ry), fz = Math.cos(me.ry);
    if (it === 'banana') { const x = me.x - fx * 1.4, z = me.z - fz * 1.4; this.addBanana(x, z, true); this.net.send('fx', { k: 'banana', x, z }); this.toast('🍌 ලෙල්ල දැම්මා!', '#ffe14d'); Audio.sfx('pickup'); }
    else if (it === 'vada') { this.stamina = 100; this.exhausted = false; this.boostT = 3; if (this.lives) this.heal(15); Audio.sfx('boost'); this.toast('🍩 වඩේ ශක්තිය! (+ජීවිතය)', '#ffb347'); }
    else if (it === 'lucky') { for (const k of Object.keys(this.cd)) this.cd[k] = 0; Audio.sfx('win'); this.toast('⭐ වාසනාව! ශක්ති නැවුම්!', '#ffe14d'); }
    else if (it === 'coconut') { const x = me.x + fx * 0.9, z = me.z + fz * 0.9; this.throwCoconut(x, z, fx, fz, true); this.net.send('fx', { k: 'coconut', x, z, d: me.ry }); this.ch.say('🥥 ඕන්න!', 1.2); }
    else if (it === 'smoke') { this.dropSmoke(me.x, me.z, true); this.net.send('fx', { k: 'smoke', x: me.x, z: me.z }); this.toast('💨 දුම් බෝම්බය! රජාට පේන්නේ නෑ!', '#cfd8dc'); this.ch.say('හෙහ් හෙහ්… 💨', 1.6); }
    else if (it === 'decoy') { this.spawnDecoy(me.x, me.z, me.ry + 0.0, true, this.myName); this.net.send('fx', { k: 'decoy', x: me.x, z: me.z, d: me.ry }); this.toast('🎭 ඩමි කස්සා දුවනවා! ඔබ හැංගෙන්න!', '#ffd23f'); this.disguiseT = Math.max(this.disguiseT, 0.01); }
  }
  throwCoconut(x, z, dx, dz, mine) {
    const sp = makeSprite('🥥', { size: 80, color: '#fff', pad: 2, scale: 0.01 }); sp.position.set(x, 1.3, z); this.scene.add(sp);
    this.projectiles.push({ sp, x, z, vx: dx * 22, vz: dz * 22, life: 1.0, mine }); Audio.sfx('swing');
  }
  smokeTex() {
    if (this._smokeTex) return this._smokeTex;
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(235,238,242,.95)'); g.addColorStop(0.6, 'rgba(200,205,212,.55)'); g.addColorStop(1, 'rgba(200,205,212,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (this._smokeTex = new THREE.CanvasTexture(c));
  }
  dropSmoke(x, z, mine) {
    const puffs = [], tex = this.smokeTex();
    for (let i = 0; i < 9; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.0, depthWrite: false }));
      const a = Math.random() * TAU, d = Math.random() * 3.6; sp.position.set(x + Math.cos(a) * d, 0.8 + Math.random() * 2.4, z + Math.sin(a) * d); sp.scale.setScalar(4 + Math.random() * 3);
      this.scene.add(sp); puffs.push(sp);
    }
    this.smokes.push({ x, z, r: 5.5, life: 8, max: 8, puffs, mine }); Audio.sfx('hide');
  }
  smokeBlocks(ax, az, bx, bz) { for (const s of this.smokes) if (s.life > 0.6 && segDist(s.x, s.z, ax, az, bx, bz) < s.r * 0.85) return true; return false; }
  spawnDecoy(x, z, ry, mine, name) {
    if (this.decoy) this.scene.remove(this.decoy.ch.root);
    const skin = (this.cfg.skins || []).find(s => s.id === ((this.o && this.o.skin) || 'classic')) || {};
    const ch = makeChar('kassa', { shirt: skin.shirt, shorts: skin.shorts, cap: skin.cap }); ch.setName(name || this.myName, '#ffd23f'); this.scene.add(ch.root);
    if (this.shadows) this.shadowify(ch.root);
    ch.root.position.set(x, 0.1, z); ch.anim = 'sprint';
    const a = ry + (Math.random() < 0.5 ? 0.9 : -0.9);   // runs off at an angle so it splits the chase
    this.decoy = { ch, x, z, ry: a, vx: Math.sin(a) * 6.4, vz: Math.cos(a) * 6.4, t: 7, mine };
    Audio.sfx('disguise');
  }
  decoyInfo() { const d = this.decoy; return d && d.t > 0 ? { x: d.x, z: d.z, hidden: false, sprint: false, sneak: false, disguise: false, cover: false, decoy: true } : null; }
  popDecoy(by) {
    const d = this.decoy; if (!d) return;
    this.fxPop('💨 ඩමි!', d.x, 2.4, d.z); Audio.sfx('boing'); this.scene.remove(d.ch.root); d.t = 0; this.decoy = null;
    if (by && by.say) by.say('අයියෝ ඩමි එකක්!'); this.toast('රජා ඩමි එකට රැවටුණා! 🎭', '#7dff9a');
  }
  updateTricks(dt) {
    for (const p of this.projectiles) {
      p.life -= dt; p.x += p.vx * dt; p.z += p.vz * dt; p.sp.position.set(p.x, 1.3 + Math.sin(p.life * 20) * 0.1, p.z);
      let dead = p.life <= 0;
      for (const c of this.world.cols) { if (c.off || c.h < 1.2 || c.bound) continue; if (p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1) { dead = true; break; } }
      if (!dead && p.mine) for (const ai of this.ais) if (ai.down <= 0 && !(ai.pending > 0) && Math.hypot(ai.x - p.x, ai.z - p.z) < 1.2) { ai.knock(2.2, 'coconut'); this.toast('🥥 පොල් ගෙඩියෙන් රජාට ගැහුවා!', '#ffe14d'); dead = true; break; }
      if (!dead && !p.mine && this.mode === 'mp' && !this.me.stun && !this.me.hidden && Math.hypot(this.me.x - p.x, this.me.z - p.z) < 1.2) { this.knockMe(2.0, 'coconut'); this.toast('🥥 පොල් ගෙඩියක් වැදුණා!', '#ff7a7a'); dead = true; }
      if (dead) { p.life = -1; this.scene.remove(p.sp); if (p.mine || true) this.fxPop('ප්‍රොච්!', p.x, 1.6, p.z, '#ffd23f'); }
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
    for (const s of this.smokes) {
      s.life -= dt; const k = s.life / s.max, a = Math.min(1, (1 - k) * 6) * Math.min(1, s.life / 1.5) * 0.6;
      for (const sp of s.puffs) { sp.material.opacity = Math.max(0, a); sp.position.y += dt * 0.12; sp.scale.multiplyScalar(1 + dt * 0.03); }
      if (s.life <= 0) for (const sp of s.puffs) this.scene.remove(sp);
    }
    this.smokes = this.smokes.filter(s => s.life > 0);
    const d = this.decoy;
    if (d) {
      d.t -= dt;
      const pos = { x: d.x + d.vx * dt, z: d.z + d.vz * dt };
      const hit = collideCircle(pos, 0.42, this.world.cols, this.world.dyn);
      d.x = pos.x; d.z = pos.z; if (hit) { d.vx *= 0.6; d.vz *= 0.6; }
      d.ch.root.position.set(d.x, this.world.groundY(d.x, d.z), d.z); d.ch.root.rotation.y = Math.atan2(d.vx, d.vz); d.ch.speed = 6; d.ch.update(dt);
      if (d.t <= 0) { this.fxPop('💨', d.x, 2.2, d.z); this.scene.remove(d.ch.root); this.decoy = null; }
    }
  }
  updateCover(dt) {
    this.coverT -= dt; if (this.coverT > 0) return; this.coverT = 0.25;
    const me = this.me; let n = 0;
    for (const p of this.world.peds) if (p.ch.root.visible && Math.hypot(p.circ.x - me.x, p.circ.z - me.z) < 3.4) n++;
    for (const e of this.world.events) if (e.on && e.crowd) for (const c of e.crowd) if (Math.hypot(c.root.position.x - me.x, c.root.position.z - me.z) < 4) n++;
    this.cover = this.role === 'kassa' && n >= 2 && !me.sprinting && !me.hidden;
    this.inSmoke = this.smokes.some(s => Math.hypot(s.x - me.x, s.z - me.z) < s.r);
  }

  // ------------------------------------------------------------------ main loop
  loop(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame((t) => this.loop(t));
    let dt = Math.min(0.05, (now - this.lastFrame) / 1000); this.lastFrame = now;
    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }
    this.dtLast = dt;
    try { this.update(dt); } catch (e) { this.reportError(e); }
    this.renderer.render(this.scene, this.camera);
  }
  reportError(e) {
    if (this._errN > 3) return; this._errN = (this._errN || 0) + 1; console.error(e);
    try { fetch((window.KASSA_BACKEND || '').replace(/\/$/, '') + '/api/error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: this.net.token, msg: String(e && e.message || e), ctx: String(e && e.stack || '').slice(0, 500) }) }); } catch (x) {}
  }

  update(dt) {
    const me = this.me, w = this.world;
    // game clock
    if (this.mode === 'mp') this.t = (this.net.serverNow() - this.startAt) / 1000; else this.t += dt;
    if (this.phase === 'countdown' && this.t >= 0) { this.phase = 'run'; this.big('GO!  පිටත් වෙන්න!', 900); Audio.sfx('go'); this.timerStart = this.t; }
    if (this.phase === 'countdown') {
      const c = Math.ceil(-this.t);
      if (c !== this.countShown && c > 0 && c <= 4) { this.countShown = c; this.big(String(c), 800); Audio.sfx('tick'); }
    }
    const rt = Math.max(0, this.t);
    w.focus = me;
    w.update(this.t, dt);
    const key = w.activeKey(); if (key !== this.navKey) { this.navKey = key; this.nav.rebuild(w.cols, 0.82); }
    this.noises = this.noises.filter(n => n.until > this.t);
    this.bananas = this.bananas.filter(b => { if (b.until < this.t) { this.scene.remove(b.sp); return false; } return true; });
    for (const k of Object.keys(this.cd)) if (this.cd[k] > 0) this.cd[k] -= dt;
    this.boostT -= dt; this.disguiseT -= dt;
    this.updateTricks(dt); this.updateCover(dt); this.updateQuest(dt);
    if (this.shadows) { const sn = w.sun; sn.position.set(me.x - 35, 70, me.z + 25); sn.target.position.set(me.x, 0, me.z); }

    if (!this.ending) { this.role === 'kassa' ? this.controlKassa(dt) : this.controlRaja(dt); }
    else this.syncMe(dt);

    // progress to hotel
    const hd = this.map.hotel.door, dh = Math.hypot(me.x - hd[0], me.z - hd[1]);
    this.distHotel = dh; this.progress = (this.role === 'kassa' || this.race) ? clamp(1 - dh / this.dist0, 0, 1) : (this.remotes.size && this.kassaRemote() && this.kassaRemote().has ? clamp(1 - Math.hypot(this.kassaRemote().x - hd[0], this.kassaRemote().z - hd[1]) / this.dist0, 0, 1) : 0);

    if (this.race && this.mode !== 'mp' && this.phase === 'run' && !this.ending) {
      const hd2 = this.map.hotel.door;
      if (me.z < hd2[1] - 1 && Math.abs(me.x) < 5) this.onRaceFinish('me');
      else if (this.roundTime && rt >= this.roundTime) { const ai = this.ais[0], dA = Math.hypot(ai.x - hd2[0], ai.z - hd2[1]); this.onRaceFinish(dA < dh ? 'ai' : 'me', 'timeout'); }
    }
    if (this.role === 'kassa' || this.mode !== 'mp') {
      this.updateNPCs(dt); this.updateSeekers(dt);
      if (this.mode !== 'mp' && this.phase === 'run' && !this.ending && !this.noAI) {
        for (const ai of this.ais) ai.update(dt);
        this.soloDirector(dt);
      } else if (this.mode !== 'mp') for (const ai of this.ais) ai.sync();
    } else this.updateNPCsVisualOnly(dt);
    if (this.mode === 'mp') this.updateRemotes(dt);
    this.updateGuardVisual(dt);
    this.updateDust(dt);
    this.updateFx(dt);
    this.updateCamera(dt);
    // music intensity from nearest Raja
    let md = 99;
    if (this.mode !== 'mp') for (const ai of this.ais) md = Math.min(md, Math.hypot(ai.x - me.x, ai.z - me.z));
    else for (const r of this.remotes.values()) if (r.vis && r.role !== this.role) md = Math.min(md, Math.hypot(r.x - me.x, r.z - me.z));
    this.nearestOpp = md;
    Audio.setIntensity(clamp(1 - md / 35, 0, 1));
    if (this.role === 'kassa' && md < 30 && this.t - this.lastRajaWarn > 25 && this.mode === 'mp' && this.phase === 'run') { this.lastRajaWarn = this.t; this.banner('අයියෝ! රජා එනවා!', 2200); Audio.sfx('alert'); }
    // network
    if (this.mode === 'mp' && this.phase !== 'ending') { this.sendT -= dt; if (this.sendT <= 0) { this.sendT = 0.05; this.sendState(); } }
    // timers / hud
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(rt); }
    this.mmT -= dt; if (this.mmT <= 0) { this.mmT = 0.08; this.drawMinimap(); }
    if (this.mode === 'mp' && this.phase === 'run' && this.roundTime && rt > this.roundTime + 3) { /* server decides */ }
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const down = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.code === 'Space' ? ' ' : e.key.toLowerCase(); this.keys[k] = true;
      if (!this.running) return;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (e.repeat) return;
      if (k === 'e') this.actionE();
      else if (k === ' ') this.actionSpace();
      else if (k === 'q') this.ability('q');
      else if (k === 'f') this.ability('f');
      else if (k === 'r') this.ability('r');
      else if (k === 'm') document.body.classList.toggle('bigmap');
      else if (k === 'escape') this.togglePause();
      else if (k >= '1' && k <= '8') this.emote(parseInt(k) - 1);
    };
    addEventListener('keydown', down);
    addEventListener('keyup', (e) => { this.keys[e.code === 'Space' ? ' ' : e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    // mouse look
    this.canvas.addEventListener('mousedown', (e) => { if (!this.running) return; Audio.unlock(); if (!document.pointerLockElement && !('ontouchstart' in window)) { try { this.canvas.requestPointerLock(); } catch (x) {} } this._drag = true; });
    addEventListener('mouseup', () => { this._drag = false; });
    addEventListener('mousemove', (e) => {
      if (!this.running || this.paused) return;
      if (document.pointerLockElement === this.canvas || this._drag) { this.camYaw -= e.movementX * 0.0035 * this.opts.sens; this.camPitch = clamp(this.camPitch + e.movementY * 0.003 * this.opts.sens, -0.15, 1.1); }
    });
    addEventListener('wheel', (e) => { if (this.running) this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 0.6, 3.5, 11); }, { passive: true });
    // touch camera drag (right side) + joystick (left side) handled in main.js via game.touch
  }
  togglePause() {
    if (this.mode === 'mp' || !this.running || this.ending) return;
    this.paused = !this.paused; $('pause').classList.toggle('on', this.paused);
    if (this.paused) { try { document.exitPointerLock(); } catch (e) {} } else this.lastFrame = performance.now();
  }
  emote(i) { if (this.mode === 'mp') this.net.send('emote', { id: i }); else { this.ch.say(EMOTES[i], 2.2); Audio.sfx('emote'); } }

  // ------------------------------------------------------------------ local movement
  moveInput() {
    const k = this.keys, t = this.touch;
    let ix = (k['d'] || k['arrowright'] ? 1 : 0) - (k['a'] || k['arrowleft'] ? 1 : 0) + t.x;
    let iz = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0) + t.z;
    const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
    const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
    return { wx: sy * iz - cy * ix, wz: cy * iz + sy * ix, mag: Math.min(1, len) };
  }
  stepMe(dt, wx, wz, speed) {
    const me = this.me, k = Math.min(1, dt * 11), tm = this.terrainMul = this.world.terrainSpeed(me.x, me.z);
    me.vx += (wx * speed * tm - me.vx) * k; me.vz += (wz * speed * tm - me.vz) * k;
    me.x += me.vx * dt; me.z += me.vz * dt;
    const pos = { x: me.x, z: me.z };
    collideCircle(pos, me.r, this.world.cols, this.world.dyn);
    me.x = pos.x; me.z = pos.z;
    const sp = Math.hypot(me.vx, me.vz);
    if (sp > 0.6) me.ry = lerpAng(me.ry, Math.atan2(me.vx, me.vz), Math.min(1, dt * 14));
    return sp;
  }
  syncMe(dt, anim) {
    const me = this.me, ch = this.ch;
    me.y = lerp(me.y, this.world.groundY(me.x, me.z), Math.min(1, dt * 15));
    ch.root.position.set(me.x, me.y, me.z); ch.root.rotation.y = me.ry;
    if (anim) ch.setAnim(anim);
    ch.speed = Math.hypot(me.vx, me.vz);
    ch.update(dt);
  }
  hitHazards(dt) {
    const me = this.me; me.invul -= dt;
    if (me.invul > 0 || me.hidden) return;
    const v = this.world.vehicleHit(me.x, me.z, me.r);
    if (v) {
      this.knockMe(1.7, 'vehicle', v);
      if (this.lives) { this.hits++; const vd = Math.round(15 * this.diff.dmgMul); this.hp = Math.max(0, this.hp - vd); this.lifeFlash = 1; this.flash('rgba(255,40,40,.4)'); this.fxPop('-' + vd, me.x, 3.1, me.z, '#ff4d4d'); this.toast('🚌 වාහනයට හැප්පුණා! -' + vd + ' ❤️', '#ff7a7a'); if (this.hp <= 0) { this.onCaught(null); return; } }
      this.ch.say(this.pickLine('vehicle'), 1.8);
    }
    const b = this.bananaAt(me.x, me.z, 0.9);
    if (b && !b.mine) { this.removeBanana(b); this.knockMe(2.2, 'banana'); this.toast('ලිස්සා වැටුණා! 🍌', '#ffe14d'); }
  }
  knockMe(sec, why, v) {
    const me = this.me; me.stun = sec; me.invul = sec + 1.5;
    this.ch.once = null; this.ch.anim = 'slip'; this.ch.animT = 0; this.ch.setStars(true);
    if (v) { const dx = me.x - v.x, dz = me.z - v.z, d = Math.hypot(dx, dz) || 1; me.vx = dx / d * 6; me.vz = dz / d * 6; }
    else { me.vx *= 0.3; me.vz *= 0.3; }
    Audio.sfx(why === 'vehicle' || why === 'coconut' || why === 'tag' ? 'bonk' : 'slip'); this.fxPop(why === 'vehicle' || why === 'coconut' || why === 'tag' ? 'BONK!' : 'ය්ෂ්!', me.x, 2.6, me.z); this.shake = this.opts.shake ? 0.5 : 0;
    if (this.mode === 'mp') this.net.send('fx', { k: 'bonk', x: me.x, z: me.z });
    if (this.role === 'kassa') { this.addNoise(me.x, me.z, 18, 1.5); }
  }

  controlKassa(dt) {
    const me = this.me, ch = this.ch, w = this.world;
    const inp = this.moveInput();
    const frozen = this.phase !== 'run';
    this.hitHazards(dt);
    if (me.stun > 0) {
      me.stun -= dt; this.stepMe(dt, 0, 0, 0);
      this.syncMe(dt);
      if (me.stun <= 0) { ch.setStars(false); ch.anim = 'idle'; ch.animT = 0; }
      me.anim = 'stunned';
      return;
    }
    if (me.hidden) {
      me.hideT += dt; me.vx = me.vz = 0; this.syncMe(dt); this.setPrompt(null);
      if (this.lives && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 2 * dt);
      if (this.fragHide) { this.fragHide.t += dt; if (this.fragHide.t >= 1.8) this.collectFragment(this.fragHide); }
      ch.root.visible = false; me.anim = 'hide';
      const s = this.hiddenSpot;
      if (s && s.vehicle) { me.x = s.vehicle.x; me.z = s.vehicle.z; if (s.vehicle.hidden) this.unhide(); }
      if (!me.ho && me.hideT > (this.hideLimit || this.maxHide)) { this.unhide(); this.toast('ඉවරයි! තව හැංගෙන්න බෑ!', '#ffd23f'); }
      // found by an opponent standing right next to the spot
      if (this.mode === 'mp') { for (const r of this.remotes.values()) if (r.role === 'raja' && r.has && Math.hypot(r.x - me.x, r.z - me.z) < 2.0) { this.popKassa(true); break; } }
      else for (const ai of this.ais) if (Math.hypot(ai.x - me.x, ai.z - me.z) < 1.7 && ai.down <= 0) { this.popKassa(true); ai.alert = 1.2; ai.setState('chase'); break; }
      if (me.ho && this.mode !== 'mp') { this.hotelT += dt; if (this.hotelT >= K.HOTEL_HIDE) this.endSolo(true); }
      if (me.ho) { this.hotelHide = this.hotelHide || { start: this.t, secs: K.HOTEL_HIDE }; }
      return;
    }
    ch.root.visible = true;
    // stamina / sprint
    me.sneaking = !!(this.keys['c'] || this.keys['control'] || this.touch.sneak) && !frozen;
    const wantSprint = !!(this.keys['shift'] || this.touch.sprint) && inp.mag > 0.2 && !me.sneaking && !frozen;
    if (this.exhausted && this.stamina > 30) this.exhausted = false;
    me.sprinting = wantSprint && this.stamina > 2 && !this.exhausted;
    if (me.sprinting) { this.stamina = Math.max(0, this.stamina - 26 * dt * (this.mode === 'mp' ? 1 : this.diff.drain)); this.stamDelay = 1; if (this.stamina <= 0) { this.exhausted = true; this.toast('ශක්තිය ඉවරයි! හෙමීට…', '#ffd23f'); } }
    else { this.stamDelay -= dt; if (this.stamDelay <= 0) this.stamina = Math.min(100, this.stamina + 20 * dt); }
    // solo: Kassa walks by default (quiet). Shift = run (noisy, Raja catches up). Multiplayer unchanged.
    const solo = this.mode !== 'mp';
    let speed = me.sneaking ? K.SNEAK : me.sprinting ? (solo ? K.RUN : K.SPRINT) : (solo ? K.WALK : K.RUN);
    if (this.boostT > 0) speed *= 1.5;
    speed *= Math.max(0.55, inp.mag);
    if (frozen) { inp.wx = inp.wz = 0; }
    if (this.dashT > 0) { this.dashT -= dt; inp.wx = this.dashDir.x; inp.wz = this.dashDir.z; speed = K.SPRINT * 2.1; }
    const sp = this.stepMe(dt, inp.wx, inp.wz, speed);
    if (!this.gateOpen) { const gz = this.map.hotel.frontZ + 0.9; if (me.z < gz && this._pz >= gz && Math.abs(me.x) < 3.4) { me.z = gz; me.vz = 0; if (!this._gateT || this.t - this._gateT > 3) { this._gateT = this.t; this.toast('🔒 ' + (this.gateWhy || 'දොර වසා ඇත!'), '#ff7a7a'); Audio.sfx('whistle'); } } }
    this._pz = me.z;
    let anim = 'idle';
    if (sp > 0.8) anim = me.sneaking ? 'sneak' : (me.sprinting || this.boostT > 0) ? 'sprint' : (sp > 5.2 ? 'run' : 'walk');
    if (this.nearestOpp < 9 && sp < 0.8 && this.phase === 'run') anim = 'panic';
    me.anim = anim;
    this.syncMe(dt, anim);
    // sprint noise (solo AI hears it)
    if (me.sprinting) { this._noiseT = (this._noiseT || 0) - dt; if (this._noiseT <= 0) { this._noiseT = 0.9; this.addNoise(me.x, me.z, 28, 0.9); } }
    else if (Math.hypot(me.vx, me.vz) > 1.5 && this.mode !== 'mp') { this.walkNoiseT -= dt; if (this.walkNoiseT <= 0) { this.walkNoiseT = 1.5; this.addNoise(me.x, me.z, 7, 0.8); } }
    if (this.phase !== 'run') return;
    this.pickups(dt);
    this.coinsAndCrowds(dt);
    this.hotelLogic(dt);
    if (me.sprinting || this.boostT > 0) { this.dustT -= dt; if (this.dustT <= 0) { this.dustT = 0.12; this.puffDust(me.x - Math.sin(me.ry) * 0.5, me.z - Math.cos(me.ry) * 0.5); } }
    // random funny lines
    this.lineT = (this.lineT || 5) - dt;
    if (this.lineT <= 0) {
      this.lineT = 9 + Math.random() * 8;
      if (this.nearestOpp < 20) this.ch.say(this.pickLine('panic'), 2); else if (this.progress > 0.55) this.ch.say(this.pickLine('nearHotel'), 2.2); else if (Math.random() < 0.5) this.ch.say(this.pickLine('badDay'), 2.2);
    }
    if (!this.nearHotelSaid && this.distHotel < 48) { this.nearHotelSaid = true; this.banner(this.pickLine('nearHotel'), 2200); }
    // prompts
    const spot = this.race ? null : this.findSpot();
    let pr = null;
    if (spot) { const lb = SPOT[spot.type] || ['', '🌿']; pr = spot.closet ? 'E — කුස්සි කබඩ් එකේ හැංගෙන්න 🔑' : spot.vehicle ? 'E — 🚕 මේ වාහනයට පැනලා හැංගෙන්න!' : 'E — ' + lb[1] + ' ' + lb[0] + ' ඇතුළේ හැංගෙන්න'; }
    else if (this.item) pr = 'SPACE — ' + ITEM[this.item].i + ' ' + ITEM[this.item].t;
    else if (this.cd.sp <= 0 && this.nearestOpp < 14) pr = 'SPACE — 💨 පැනලා මගහරින්න (dodge)';
    this.setPrompt(pr);
  }
  controlRaja(dt) {
    const me = this.me, ch = this.ch;
    this.hitHazards(dt);
    if (me.hidden) {   // ambush: waiting inside a hiding spot, SPACE pounces
      me.hideT += dt; me.vx = me.vz = 0; this.syncMe(dt); ch.root.visible = false; me.anim = 'hide';
      this.setPrompt('SPACE — පැන ගහන්න! 🔨  (E — එළියට)');
      if (me.hideT > 8) this.unhide();
      return;
    }
    ch.root.visible = true;
    const frozen = this.phase !== 'run' || this.t < this.head;
    if (me.stun > 0) { me.stun -= dt; this.stepMe(dt, 0, 0, 0); this.syncMe(dt); if (me.stun <= 0) { ch.setStars(false); ch.anim = 'idle'; } me.anim = 'stunned'; return; }
    const inp = this.moveInput();
    if (frozen) { inp.wx = inp.wz = 0; }
    let speed = K.RAJA * ({ sprinter: 1.08, bruiser: 0.95, scout: 1.0 }[this.o.kind] || 1) * Math.max(0.55, inp.mag);
    if (this.boostT > 0) speed = K.BURST * Math.max(0.55, inp.mag);
    const sp = this.stepMe(dt, inp.wx, inp.wz, speed);
    me.anim = sp > 0.8 ? (this.boostT > 0 ? 'chase' : 'run') : 'idle';
    this.syncMe(dt, me.anim);
    if (me.catchAnim > 0) { me.catchAnim -= dt; me.anim = 'swing'; }
    if (this.race && this.phase === 'run') this.pickups(dt);
    if (frozen && this.phase === 'run') this.setPrompt('⏳ කස්සාට ආරම්භය ලැබෙනවා… ' + Math.max(0, Math.ceil(this.head - this.t)) + 's'); else { const sp2 = (!this.race && this.mode === 'mp') ? this.findSpot() : null; this.setPrompt(sp2 && !sp2.closet ? 'E — හැංගී ඉන්න (ඇම්බුෂ්) 🌿' : (this.race && this.item ? 'E — ' + ITEM[this.item].i + ' ' + ITEM[this.item].t : null)); }
    // raja sees kassa -> excited mark
    const kr = this.kassaRemote();
    if (kr && kr.vis) { ch.setMark('!', '#ff4d4d'); this._seenK = this.t; } else if (this.t - (this._seenK || -9) > 1.5) ch.setMark(null);
  }

  findSpot() {
    const me = this.me; let best = null, bd = 1e9;
    for (const s of this.world.hideSpots) {
      if (s.busy > 0) continue;
      const d = Math.hypot(s.x - me.x, s.z - me.z);
      if (d < s.r && d < bd) { best = s; bd = d; }
    }
    const hs = this.world.hotelSpot;
    if (hs && Math.hypot(hs.x - me.x, hs.z - me.z) < 3.2 && me.z < this.map.hotel.frontZ - 0.5) { best = hs; }
    // hop onto a passing bus / tuk-tuk / car: other people's vehicles are a moving hiding place
    if (!best && !this.race) for (const v of this.world.vehicles) {
      if (v.hidden || (v.noRide || 0) > this.t) continue;
      const hx = (v.horiz ? v.len : v.wid) / 2 + 3.2, hz = (v.horiz ? v.wid : v.len) / 2 + 3.2;
      if (Math.abs(me.x - v.x) < hx && Math.abs(me.z - v.z) < hz) { const d = Math.hypot(me.x - v.x, me.z - v.z); if (d < bd) { bd = d; best = { type: 'ride', vehicle: v, x: v.x, z: v.z, r: 0, busy: 0 }; } }
    }
    return best;
  }
  get maxHide() { return this.mode === 'mp' ? K.MAXHIDE : this.diff.hide; }
  actionE() {
    if (this.phase !== 'run' || this.ending || this.paused) return;
    Audio.unlock();
    if (this.role === 'kassa') {
      if (this.race) { this.toast('රෙස් එකේ හැංගෙන්න බෑ — දුවන්න! 🏁', '#ccc'); return; }
      if (this.me.hidden) { this.unhide(); return; }
      if (this.me.stun > 0) return;
      const s = this.findSpot();
      if (!s) { this.toast('මෙතන හැංගෙන්න තැනක් නෑ', '#ccc'); return; }
      this.hide(s);
    } else {
      if (this.me.hidden) { this.unhide(); return; }
      if (this.race) { if (this.item) this.useItem(); else this.catchAttempt(); return; }
      const s = this.mode === 'mp' && this.t >= this.head ? this.findSpot() : null;
      if (s && !s.closet && this.me.stun <= 0) this.hide(s); else this.catchAttempt();
    }
  }
  actionSpace() {
    if (this.phase !== 'run' || this.ending || this.paused) return;
    Audio.unlock();
    if (this.role === 'raja') return this.catchAttempt();
    if (this.item) this.useItem(); else this.dash();
  }
  // SPACE with no item: a quick dodge-dash with a moment of invulnerability
  dash() {
    const me = this.me;
    if (this.cd.sp > 0 || me.hidden || me.stun > 0 || this.phase !== 'run') return;
    this.tricks++; this.cd.sp = 3.5; this.dashT = 0.38; me.invul = Math.max(me.invul, 0.55);
    const inp = this.moveInput(); let dx = inp.wx, dz = inp.wz;
    if (Math.hypot(dx, dz) < 0.1) { dx = Math.sin(me.ry); dz = Math.cos(me.ry); }
    const l = Math.hypot(dx, dz) || 1; this.dashDir = { x: dx / l, z: dz / l };
    Audio.sfx('boost'); this.fxPop('💨', me.x, 2.4, me.z); this.shake = 0.15;
  }
  catchAttempt() {
    if (this.role !== 'raja' || this.t < this.head || this.cd.e > 0 || this.me.stun > 0) return;
    if (this.me.hidden) { this.unhide(); this.toast('බූ! 👻', '#ffd23f'); }
    const me = this.me, d = this.decoy;
    if (d && !d.mine && Math.hypot(d.x - me.x, d.z - me.z) < 3.2) {   // tagged the decoy instead of the real Kassa
      this.popDecoy(this.ch); this.cd.e = 1.5; me.stun = 1.1; me.invul = 0; this.ch.once = null; this.ch.anim = 'surprise'; this.ch.animT = 0; Audio.sfx('swing'); return;
    }
    this.cd.e = this.race ? 4 : 0.9; me.catchAnim = 0.45;
    this.ch.once = null; this.ch.play('swing', 0.5); Audio.sfx('swing');
    this.net.send('catch');
  }
  ability(k) {
    if (this.phase !== 'run' || this.ending || this.paused) return;
    if (this.role === 'raja' && this.t < this.head) return;
    if (this.race && this.role === 'raja' && k !== 'q') return;
    if (this.cd[k] > 0) { return; }
    Audio.unlock();
    const me = this.me;
    if (this.role === 'kassa') {
      if (me.hidden || me.stun > 0) return;
      this.tricks++;
      if (k === 'q') { this.cd.q = 16; this.boostT = 2.5; Audio.sfx('boost'); this.fxPop('⚡', me.x, 2.6, me.z); this.net.send('fx', { k: 'boost', x: me.x, z: me.z }); }
      else if (k === 'f') { this.cd.f = 28; this.disguiseT = 8; Audio.sfx('disguise'); this.ch.say('🎭 හෙහ් හෙහ්!', 2); this.net.send('fx', { k: 'disguise', x: me.x, z: me.z }); this.setDisguiseLook(true); }
      else if (k === 'r') {
        this.cd.r = 14; const bx0 = this.map.box, tx = clamp(me.x + Math.sin(me.ry) * 14, bx0.x0 + 5, bx0.x1 - 5), tz = clamp(me.z + Math.cos(me.ry) * 14, bx0.z0 + 5, bx0.z1 - 5);
        this.fxPop('💥 ඩොං!', tx, 1.6, tz, '#ffd23f'); Audio.sfx('bonk');
        this.addNoise(tx, tz, 40, 2.5); this.noises[this.noises.length - 1].distract = true;
        this.net.send('fx', { k: 'distract', x: tx, z: tz });
      }
    } else {
      if (k === 'q') { this.cd.q = 18; this.boostT = 2.5; Audio.sfx('boost'); this.fxPop('⚡', me.x, 2.6, me.z); }
      else if (k === 'r') { this.cd.r = 2; this.net.send('ab', { n: 'search' }); }
      else if (k === 'f') { this.cd.f = 1.5; this.net.send('ab', { n: 'loud' }); }
    }
  }
  setDisguiseLook(on) {
    if (!this._dgMark) { this._dgMark = makeSprite('🎭', { size: 70, color: '#fff', pad: 2, scale: 0.01 }); this.ch.root.add(this._dgMark); }
    this._dgMark.position.y = 2.6; this._dgMark.visible = on;
  }
  hide(s) {
    const me = this.me;
    this.hiddenSpot = s; me.hidden = true; me.hideT = 0; me.pre = { x: me.x, z: me.z };
    this.fragHide = this.quest ? (this.quest.marks.find(m => m.spot === s && !m.got) || null) : null; if (this.fragHide) { this.fragHide.t = 0; this.toast('🧩 පාස් කොටස ගන්නවා… ටිකක් හැංගී ඉන්න!', '#7df9ff'); }
    this.hideLimit = s.vehicle ? 30 : (this.mode === 'mp' ? K.MAXHIDE : this.diff.hide) * (SPOT[s.type] || [0, 0, 1])[2];
    if (s.vehicle) this.toast('🚕 වාහනයක් මත හැංගුණා! ගමන් යනවා…', '#9fe8ff');
    me.x = s.x; me.z = s.z; me.vx = me.vz = 0; this.ch.root.visible = false; this.hideCount++;
    if (s.closet) { me.ho = true; this.hotelT = 0; me.pre = { x: s.x, z: s.z + 2.4 }; }
    Audio.sfx('hide'); if (this.role === 'kassa') this.ch.say(this.pickLine('hide'), 1.5);
    if (this.mode === 'mp') this.net.send('fx', { k: 'hide', x: me.x, z: me.z });
    this.msgs && 0;
  }
  unhide() {
    const me = this.me, s = this.hiddenSpot;
    me.hidden = false; me.ho = false;
    if (s && s.vehicle) { const v = s.vehicle, sg = Math.sign(v.lane - v.road) || 1, off = this.world.hw + 0.4; if (v.horiz) { me.x = v.x; me.z = v.road + sg * off; } else { me.x = v.road + sg * off; me.z = v.z; } v.noRide = this.t + 5; }
    else if (me.pre) { me.x = me.pre.x; me.z = me.pre.z; }
    this.ch.root.visible = true; if (s) { if (!s.closet) s.busy = 9; if (s.g) s.g.rotation.z = 0; }
    this.hiddenSpot = null; this.hotelT = 0; this.hotelHide = null; this.fragHide = null;
    this.setPrompt(null);
  }
  popKassa(found) {
    const me = this.me; if (!me.hidden) return;
    this.unhide(); me.stun = 0.7; me.invul = 0; this.ch.once = null; this.ch.anim = 'surprise'; this.ch.animT = 0;
    this.toast('අහු වුණා! හැංගිලා හිටපු තැන අල්ලා ගත්තා!', '#ff7a7a'); Audio.sfx('alert');
  }
  pickups(dt) {
    const me = this.me;
    for (const p of this.world.pickups) {
      if (p.respawn > 0) continue;
      if (p.type === 'heal') { if (this.lives && this.hp < this.maxHp && Math.hypot(p.x - me.x, p.z - me.z) < 1.4) { p.respawn = 40; this.heal(25); Audio.sfx('pickup'); this.toast('❤️ ජීවිතය +25!', '#ff8fa3'); } continue; }
      if (this.item) continue;
      if (Math.hypot(p.x - me.x, p.z - me.z) < 1.3) {
        p.respawn = 25; this.item = p.type; Audio.sfx('pickup'); this.toast('ගත්තා! ' + ITEM[p.type].i + ' ' + p.name + (this.role === 'kassa' ? ' — SPACE' : ' — E'), '#ffe14d'); if (this.role === 'kassa') this.ch.say(ITEM[p.type].i + ' ඔහ්!', 1.4); break;
      }
    }
  }

  // solo: coins on the pavement, and people who walk across the street ahead when Kassa keeps moving
  coinsAndCrowds(dt) {
    const me = this.me;
    if (this.role !== 'kassa' || this.mode === 'mp' || this.race || me.hidden || !this.world.coins) return;
    for (const c of this.world.coins) if (!c.got && Math.hypot(c.x - me.x, c.z - me.z) < 1.6) { c.got = true; this.coins++; Audio.sfx('pickup'); }
    this.rushT -= dt;
    const sp = Math.hypot(me.vx, me.vz);
    if (this.rushT <= 0 && sp > 2.5) {
      this.rushT = 7 + Math.random() * 6;
      const dx = me.vx / sp, dz = me.vz / sp, L = 16, mr = this.map.roadLinesX, mz = this.map.roadLinesZ;
      const near = (arr, v) => arr.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
      if (Math.abs(dz) > Math.abs(dx)) this.world.spawnRush(me.z + dz * L, near(mr, me.x), true);      // walking along a street: they cross ahead
      else this.world.spawnRush(me.x + dx * L, near(mz, me.z), false);
      this.toast('🚶 ඉදිරියෙන් මිනිස් රැලක්! ඉඩ දෙන්න, නැත්නම් මිශ්‍ර වෙන්න.', '#9fe8ff');
    }
  }

  // ------------------------------------------------------------------ hotel guard / watchers / reporter
  guardAngle() { return Math.sin(this.t * 0.75) * 1.25; }
  updateGuardVisual(dt) {
    const g = this.guard, a = this.guardAngle();
    g.ch.root.rotation.y = a * 0.7; g.ch.head.rotation.y = a * 0.3; g.cone.rotation.y = a;
    g.ch.setAnim('idle'); g.ch.update(dt);
    const near = Math.hypot(this.me.x - g.x, this.me.z - g.z) < 60;
    g.cone.visible = near && !this.race;
    for (const wc of this.watchers) {
      const ang = wc.base + Math.sin(this.t * 0.6 + wc.ph) * 0.8;
      wc.cur = ang; wc.ch.root.rotation.y = ang; wc.cone.rotation.y = ang; wc.ch.setAnim('idle'); wc.ch.update(dt);
      wc.cone.visible = !this.race && Math.hypot(this.me.x - wc.x, this.me.z - wc.z) < 70;
    }
  }
  hotelLogic(dt) {
    const me = this.me, g = this.guard, L = this.map.hotel.lobby;
    if (this.race) return;
    if (me.z > L.z1 || me.z < L.z0 || Math.abs(me.x) > L.x1 || me.hidden) return;
    g.cd -= dt;
    if (g.cd > 0 || me.stun > 0) return;
    const dx = me.x - g.x, dz = me.z - g.z, d = Math.hypot(dx, dz);
    let range = 14 * (this.disguiseT > 0 ? 0.4 : 1) * (me.sneaking ? 0.55 : 1);
    const a = this.guardAngle();
    const inCone = d < range && Math.abs(angDiff(a, Math.atan2(dx, dz))) < 0.55;
    if ((inCone || d < 2.2) && losClear(g.x, g.z, me.x, me.z, this.world.cols, 1.7)) {
      g.cd = 4;
      g.ch.say(this.pickLine('guard'), 2.2); Audio.sfx('whistle');
      // the guard no longer throws Kassa out (that made the hotel impossible to enter): he whistles and calls Raja
      this.alertRaja(me.x, me.z, 'guard'); this.toast('🛎️ ආරක්ෂකයා දැක්කා! ඉක්මනට කබඩ් එකකට!', '#ff7a7a');
    }
  }
  updateNPCs(dt) {
    const me = this.me;
    // watchers
    for (const wc of this.watchers) {
      wc.cd -= dt;
      if (this.phase !== 'run' || me.hidden || wc.cd > 0) continue;
      const dx = me.x - wc.x, dz = me.z - wc.z, d = Math.hypot(dx, dz);
      const range = 15 * (this.disguiseT > 0 ? 0.35 : 1) * (me.sneaking ? 0.6 : 1);
      if (d < range && Math.abs(angDiff(wc.cur || wc.base, Math.atan2(dx, dz))) < 0.5 && losClear(wc.x, wc.z, me.x, me.z, this.world.cols, 1.7)) {
        wc.cd = 7; wc.ch.say('ඒ කස්සා!', 2); Audio.sfx('whistle'); this.alertRaja(me.x, me.z, 'watch'); this.toast('ආරක්ෂක මාමා දැක්කා! 🚨', '#ff9a3c');
      }
    }
    // reporter
    const R = this.reporter, rc = R.ch;
    if (R.state === 'remote') return;
    const d = Math.hypot(me.x - R.x, me.z - R.z);
    const canSee = this.phase === 'run' && !me.hidden && this.disguiseT <= 0 && this.t > 25 && d < 15 && losClear(R.x, R.z, me.x, me.z, this.world.cols, 1.7);
    if (R.state === 'idle') {
      rc.setAnim('look'); rc.update(dt);
      if (canSee) { R.state = 'follow'; R.lose = 0; rc.say(this.pickLine('reporter'), 2.2); this.toast('📷 රිපෝටර් දැක්කා! පැන ගන්න!', '#ff9aa2'); Audio.sfx('camera'); R.alertT = 1.5; }
    } else if (R.state === 'follow') {
      const tx = me.x - R.x, tz = me.z - R.z;
      if (d > 4.5) { R.vx = tx / d * 5.8; R.vz = tz / d * 5.8; } else { R.vx *= 0.8; R.vz *= 0.8; }
      R.x += R.vx * dt; R.z += R.vz * dt;
      const pos = { x: R.x, z: R.z }; collideCircle(pos, 0.5, this.world.cols, null); R.x = pos.x; R.z = pos.z;
      R.ry = Math.atan2(tx, tz); rc.root.position.set(R.x, 0.12, R.z); rc.root.rotation.y = R.ry; rc.setAnim('run'); rc.update(dt);
      R.flashT -= dt; if (R.flashT <= 0 && d < 12) { R.flashT = 1.3; if (rc.flash) rc.flash.intensity = 2.5; Audio.sfx('camera'); this.flash('rgba(255,255,255,.55)'); }
      R.alertT -= dt; if (R.alertT <= 0 && !me.hidden) { R.alertT = 3.5; this.alertRaja(R.x, R.z, 'cam'); }
      if (d > 26 || me.hidden || this.disguiseT > 0) R.lose += dt; else R.lose = Math.max(0, R.lose - dt);
      if (R.lose > 2.5) { R.state = 'return'; rc.say('අහ්... නැතිවුණා!', 2); this.toast('රිපෝටර්ගෙන් ගැලවුණා! 😎', '#7dff9a'); }
      if (this.ais[0] && this.mode !== 'mp') { /* alertRaja handles */ }
    } else if (R.state === 'return') {
      const tx = R.hx - R.x, tz = R.hz - R.z, dd = Math.hypot(tx, tz);
      if (dd < 1) { R.state = 'idle'; } else { R.x += tx / dd * 4 * dt; R.z += tz / dd * 4 * dt; R.ry = Math.atan2(tx, tz); }
      rc.root.position.set(R.x, 0.12, R.z); rc.root.rotation.y = R.ry; rc.setAnim('walk'); rc.update(dt);
    }
  }
  updateNPCsVisualOnly(dt) { this.reporter.ch.update(dt); }
  alertRaja(x, z, kind) {
    if (this.mode === 'mp') { this.net.send('fx', { k: 'alert', x, z, n: kind }); }
    else this.alertHint = { x: x + (Math.random() - 0.5) * 6, z: z + (Math.random() - 0.5) * 6, t: this.t };
  }

  // ------------------------------------------------------------------ solo director & results
  soloDirector(dt) {
    const me = this.me;
    if (this.race) return;
    // "Raja appears!" — a Raja who has lost track for long bursts into the area ahead of Kassa
    this.appearT = (this.appearT ?? 40) - dt;
    const idle = this.ais.find(a => a.state !== 'chase' && a.down <= 0 && !(a.pending > 0));
    if (idle && this.appearT <= 0 && !me.hidden) {
      const d = Math.hypot(idle.x - me.x, idle.z - me.z);
      if (d > 55) {
        this.appearT = 40 + Math.random() * 25;
        const b0 = this.map.box, hd = Math.hypot(me.vx, me.vz) > 1 ? Math.atan2(me.vx, me.vz) : Math.random() * 6.28, ang = hd + (Math.random() - 0.5) * 2.0, rr = 32 + Math.random() * 14;
        let tx = me.x + Math.sin(ang) * rr, tz = me.z + Math.cos(ang) * rr;
        [tx, tz] = this.nav.nearestFreePoint(clamp(tx, b0.x0 + 8, b0.x1 - 8), clamp(tz, b0.z0 + 8, b0.z1 - 8));
        if (Math.hypot(tx - me.x, tz - me.z) > 28) {
          idle.x = tx; idle.z = tz; idle.lastSeen = { x: me.x, z: me.z }; idle.setState('search'); idle.alert = 0.4;
          this.banner(this.pickLine('rajaComing'), 2400); Audio.sfx('alert'); this.shake = this.opts.shake ? 0.3 : 0;
        }
      }
    }
    // sudden ambush: Raja leaps out of a hiding spot just ahead (telegraphed by a rustle and a warning)
    this.ambushT = (this.ambushT ?? this.diff.ambush * 0.6) - dt;
    const A = this.ambush;
    if (A) {
      A.t -= dt;
      if (A.t <= 0) {
        this.ambush = null; this.ambushT = this.diff.ambush * (0.8 + Math.random() * 0.6);
        if (!me.hidden && A.ai.down <= 0) {
          A.ai.pop(A.spot, this.kassaInfo());
          this.banner(this.pickLine('rajaPop'), 2000); Audio.sfx('alert'); this.shake = this.opts.shake ? 0.5 : 0; this.flash('rgba(255,60,60,.35)');
          A.ai.say(this.pickLine('taunt'));
        } else { A.ai.pending = 0; A.ai.ch.root.visible = true; }
      }
    } else if (this.ambushT <= 0 && this.t > 12 && this.progress < 0.93) this.tryAmbush(idle);
    // Raja's younger brother guards the hotel plaza once Kassa gets close
    if (!this.junior && this.distHotel < 55 && this.progress > 0.5) {
      const b1 = this.map.box, ja = Math.random() * 6.28, jp = this.nav.nearestFreePoint(clamp(me.x + Math.sin(ja) * 45, b1.x0 + 8, b1.x1 - 8), clamp(me.z + Math.cos(ja) * 45, b1.z0 + 8, b1.z1 - 8));
      const jr = new RajaAI(this, makeChar('raja', { kind: 'sprinter' }), jp, { style: 'roamer' });
      this.scene.add(jr.ch.root); jr.ch.setName('රජාගේ මල්ලි', '#ff8fa3'); this.junior = jr; this.ais.push(jr); if (this.shadows) this.shadowify(jr.ch.root);
      this.banner('අයියෝ! රජාගේ මල්ලිත් හොයනවා!', 2600); Audio.sfx('alert');
    }
  }
  tryAmbush(ai) {
    const me = this.me, sp = Math.hypot(me.vx, me.vz);
    if (!ai || sp < 2.5 || me.hidden || me.stun > 0 || this.distHotel < 28) { this.ambushT = 1.5; return; }
    const heading = Math.atan2(me.vx, me.vz);
    const c = this.world.hideSpots.filter(s => { const d = Math.hypot(s.x - me.x, s.z - me.z); return d > 9 && d < 19 && Math.abs(angDiff(heading, Math.atan2(s.x - me.x, s.z - me.z))) < 0.8; });
    if (!c.length) { this.ambushT = 2; return; }
    const spot = c[Math.floor(Math.random() * c.length)];
    ai.pending = 999; ai.ch.root.visible = false; ai.ch.setMark(null);
    this.ambush = { ai, spot, t: 1.2 };
    this.fxPop('‼', spot.x, 2.6, spot.z, '#ff4d4d'); Audio.sfx('hide'); setTimeout(() => Audio.sfx('hide'), 280);
    this.toast('👀 ' + this.pickLine('ambushWarn'), '#ff9a9a');
  }
  onRaceFinish(who, reason) {
    if (this.ending) return;
    this.ending = true;
    const won = who === 'me';
    this.endSequence(won, 'race', null, null, reason);
  }
  raceTag(ai) { this.knockMe(2.4, 'tag'); this.toast('රජා තල්ලු කළා! 😵', '#ff7a7a'); }
  onRajaSpotted(ai) {
    if (this.mode !== 'mp') this.alertHint = { x: this.me.x + (Math.random() - 0.5) * 8, z: this.me.z + (Math.random() - 0.5) * 8, t: this.t };
    if (this.t - this.lastRajaWarn > 10) { this.lastRajaWarn = this.t; this.banner(this.pickLine('rajaComing'), 2200); Audio.sfx('alert'); this.shake = 0.25; if (this.role === 'kassa') this.ch.setMark('😱', '#fff'), setTimeout(() => this.ch.setMark(null), 1200); }
  }
  // life bar: Raja, Maha Raja and the searchers wear Kassa down instead of ending the run at once
  hitKassa(src) {
    const me = this.me;
    if (this.ending || me.hidden || me.invul > 0) return false;
    if (!this.lives) { this.onCaught(src); return true; }
    this.hits++;
    const dmg = Math.round(((src && src.dmg) || 20) * this.diff.dmgMul); this.hp = Math.max(0, this.hp - dmg); if (src) src.hitCd = 1.3;
    this.lifeFlash = 1; this.flash('rgba(255,40,40,.4)'); this.fxPop('-' + dmg, me.x, 3.1, me.z, '#ff4d4d');
    this.toast((dmg >= 30 ? '👑 මහ රජා ගැහුවා! -' : dmg >= 20 ? '🔨 රජා ගැහුවා! -' : '👊 ගැහුවා! -') + dmg + ' ❤️', '#ff7a7a');
    if (this.hp <= 0) { this.onCaught(src); return true; }
    this.knockMe(0.5, 'tag', src); me.invul = 1.0;
    return true;
  }
  // ---- hotel pass quest: three fragments hidden inside hiding places across the map; the gate stays shut until you hold them all and shake off Raja
  makeQuest() {
    const w = this.world, door = this.map.hotel.door, ks = this.map.kassaSpawn, ok = ['bush', 'dumpster', 'shopdoor', 'manhole', 'hut', 'lookout', 'rock', 'cart', 'booth', 'barrels', 'haystack', 'stall', 'car', 'boat'];
    let cand = w.hideSpots.filter(s => ok.includes(s.type) && Math.hypot(s.x - door[0], s.z - door[1]) > 45 && Math.hypot(s.x - ks[0], s.z - ks[1]) > 35 && w.groundY(s.x, s.z) < 9);
    const b0 = this.map.box;
    cand = cand.filter(s => s.x > b0.x0 + 8 && s.x < b0.x1 - 8 && s.z > b0.z0 + 8 && s.z < b0.z1 - 8 && this.nav.path(ks[0], ks[1], s.x, s.z));
    const pick = [];
    for (let tries = 0; tries < 200 && pick.length < 3 && cand.length; tries++) {
      const s = cand[Math.floor(this.rnd() * cand.length)];
      if (pick.every(p => Math.hypot(p.x - s.x, p.z - s.z) > 55)) pick.push(s);
    }
    for (const s of cand) { if (pick.length >= 3) break; if (!pick.includes(s)) pick.push(s); }
    const marks = pick.map(spot => {
      const sp = makeSprite('🧩 පාස් කොටස', { size: 54, color: '#fff', bg: 'rgba(20,60,90,.85)', pad: 10, scale: 0.009 }); sp.position.set(spot.x, 4.2, spot.z); this.scene.add(sp);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 40, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      beam.position.set(spot.x, 20, spot.z); this.scene.add(beam);
      return { spot, got: false, sp, beam, t: 0 };
    });
    return { need: Math.min(3, marks.length), got: 0, marks };
  }
  collectFragment(m) {
    m.got = true; this.quest.got++; this.fragHide = null; this.scene.remove(m.sp); this.scene.remove(m.beam);
    Audio.sfx('win'); this.flash('rgba(125,249,255,.35)'); this.fxPop('🧩', m.spot.x, 3, m.spot.z, '#7df9ff');
    if (this.quest.got >= this.quest.need) this.banner('🧩 පාස් කොටස් සියල්ලම! දැන් හෝටලයට — රජා පිටුපස නැති වෙලාවක ඇතුල් වෙන්න!', 3400);
    else this.toast('🧩 පාස් කොටස් ' + this.quest.got + '/' + this.quest.need + ' — ඊළඟ එක හොයන්න!', '#7df9ff');
  }
  updateQuest(dt) {
    if (!this.quest) return;
    const me = this.me, pulse = 1 + Math.sin(this.t * 4) * 0.15;
    for (const m of this.quest.marks) if (!m.got) { m.sp.scale.set(m.sp.scale.x, m.sp.scale.y, 1); m.beam.material.opacity = 0.28 + Math.sin(this.t * 3) * 0.1; }
    const chased = this.ais.some(a => !(a.pending > 0) && a.down <= 0 && a.state === 'chase' && Math.hypot(a.x - me.x, a.z - me.z) < 40);
    const open = this.quest.got >= this.quest.need && !chased;
    if (open !== this.gateOpen && this.phase === 'run') {
      this.gateOpen = open;
      if (open) this.toast('🔓 හෝටලයේ දොර විවෘතයි! හැංගිලා ඇතුල් වෙන්න', '#7dff9a'); else if (this.quest.got >= this.quest.need) this.toast('🔒 රජා ළඟ ඉන්නවා — දොර වැසුණා! ඔහුව මගහරින්න', '#ff7a7a');
    }
    this.gateWhy = this.quest.got < this.quest.need ? 'පාස් කොටස් ' + this.quest.got + '/' + this.quest.need : 'රජා ඔබව හොයනවා!';
    if (this.world.gateGroup) this.world.gateGroup.visible = !this.gateOpen;
  }
  // points: speed, life left, stealth and the techniques you used all count (mirrored on the server)
  scoreParts(won) {
    const t = Math.max(0, this.t - (this.timerStart || 0)), m = { easy: 0.8, normal: 1, hard: 1.3, insane: 1.6 }[this.opts.difficulty] || 1;
    return { m, parts: [['🏆 ජයග්‍රහණය', 1000], ['⏱ කාලය', Math.max(0, Math.round((420 - t) * 4))], ['❤️ ඉතිරි ජීවිතය', Math.round(this.hp * 10)], ['🌿 හැංගුම්', Math.min(6, this.hideCount) * 40], ['🎯 උපක්‍රම', Math.min(8, this.tricks) * 30], ['🛡️ ගැහුම් නැති', Math.max(0, 250 - this.hits * 60)], ['🧩 පාස් කොටස්', (this.quest ? this.quest.got : 0) * 100]] };
  }
  scoreNow() { const s = this.scoreParts(true); return Math.round(s.parts.reduce((a, p) => a + p[1], 0) * s.m); }
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); this.lifeFlash = -1; }
  onCaught(ai) {
    if (this.ending) return;
    this.ending = true;
    this.me.hidden && this.unhide();
    this.endSequence(false, 'caught', ai);
  }
  endSolo(won) { if (this.ending) return; this.ending = true; this.endSequence(won, won ? 'escaped' : 'caught'); }
  // Plays the slapstick catch / celebration, then calls onEnd
  endSequence(won, reason, ai, mpResult, why) {
    const me = this.me; this.ending = true; this.phase = 'ending'; this.setPrompt(null);
    if (reason === 'race' && !won) {
      this.ch.root.visible = true; this.ch.once = null; this.ch.anim = 'caught'; this.ch.animT = 0; this.ch.setStars(true); Audio.sfx('lose');
      this.banner(why === 'timeout' ? 'වේලාව ඉවරයි! රජා ළඟයි ⏰' : 'රජා මුලින්ම හෝටලයට ආවා! 🏁', 3000);
      for (const ai2 of this.ais) { ai2.ch.once = null; ai2.ch.anim = 'celebrate'; ai2.halted = true; }
    } else if (won) {
      this.ch.root.visible = true; me.hidden = false; this.ch.once = null; this.ch.anim = 'celebrate'; this.ch.animT = 0; Audio.sfx('win');
      this.banner(reason === 'race' ? '🏁 ඔබ මුලින්ම හෝටලයට ආවා!' : this.pickLine('win'), 3000); this.confetti(me.x, me.z); this.camTarget = { orbit: true };
    } else {
      this.ch.root.visible = true; this.ch.once = null; this.ch.anim = 'caught'; this.ch.animT = 0; this.ch.setStars(true);
      Audio.sfx('bonk'); setTimeout(() => Audio.sfx('lose'), 700);
      this.fxPop('BONK!', me.x, 2.8, me.z); this.shake = 1; this.flash('rgba(255,255,255,.8)');
      const c = $('caught'); c.textContent = this.pickLine('caught'); c.classList.add('on');
      setTimeout(() => c.classList.remove('on'), 2300);
    }
    const delay = won ? 3600 : (reason === 'race' ? 3200 : 2800), rid = this.runId;
    setTimeout(() => { if (rid !== this.runId || !this.running) return; this.onEnd && this.onEnd({ won, reason, time: Math.max(0, this.t - (this.timerStart || 0)), hides: this.hideCount, hp: Math.round(this.hp), hits: this.hits, tricks: this.tricks, frags: this.quest ? this.quest.got : 0, diff: this.opts.difficulty, coins: this.coins, mpResult }); }, delay);
  }
  // MP: server declared the end of the round
  onServerResult(m) {
    if (this.ending) return;
    const iWon = (m.winner === 'kassa') === (this.role === 'kassa');
    this.ending = true; this.phase = 'ending'; this.setPrompt(null);
    const k = this.role === 'kassa' ? this : null;
    const kr = this.kassaRemote(), kch = this.role === 'kassa' ? this.ch : (kr && kr.ch);
    const pos = this.role === 'kassa' ? { x: this.me.x, z: this.me.z } : (kr ? { x: kr.x, z: kr.z } : { x: this.me.x, z: this.me.z });
    if (m.reason === 'caught' && kch) {
      kch.root.visible = true; kch.once = null; kch.anim = 'caught'; kch.animT = 0; kch.setStars(true);
      this.fxPop('BONK!', pos.x, 2.8, pos.z); Audio.sfx('bonk'); setTimeout(() => Audio.sfx(iWon ? 'win' : 'lose'), 700); this.shake = 1;
      const c = $('caught'); c.textContent = this.pickLine('caught'); c.classList.add('on'); setTimeout(() => c.classList.remove('on'), 2300);
    } else if (m.reason === 'escaped') {
      if (kch) { kch.root.visible = true; kch.once = null; kch.anim = 'celebrate'; kch.animT = 0; }
      this.banner(this.pickLine('win'), 3000); this.confetti(pos.x, pos.z); Audio.sfx(iWon ? 'win' : 'lose');
      if (this.role === 'kassa') { this.me.hidden = false; this.ch.root.visible = true; }
    } else if (m.reason === 'race') {
      const wid = m.winnerId, wr = wid === this.myId ? { x: this.me.x, z: this.me.z } : (this.remotes.get(wid) || { x: this.me.x, z: this.me.z });
      this.banner(iWon ? '🏁 ඔබ මුලින්ම හෝටලයට ආවා!' : '🏁 ' + ((this.roles[wid] || {}).name || '?') + ' මුලින්ම හෝටලයට ආවා!', 3000); this.confetti(wr.x, wr.z); Audio.sfx(iWon ? 'win' : 'lose');
    } else { Audio.sfx(iWon ? 'win' : 'lose'); this.banner(m.reason === 'timeout' ? 'වේලාව ඉවරයි! ⏰' : 'ක්‍රීඩකයෙක් විසන්ධි වුණා', 2500); }
    const rid = this.runId;
    setTimeout(() => { if (rid !== this.runId || !this.running) return; this.onEnd && this.onEnd({ mp: true, msg: m }); }, m.reason === 'caught' ? 2800 : 3200);
  }

  sendState() {
    const me = this.me;
    const o = { x: me.x, z: me.z, y: me.y, ry: me.ry, an: me.anim || 'idle', hid: me.hidden ? 1 : 0, sp: me.sprinting ? 1 : 0, dg: (this.disguiseT > 0 || this.cover || this.inSmoke) ? 1 : 0, ho: me.ho ? 1 : 0 };
    if (me.tp) { o.tp = 1; me.tp = false; }
    if (this.role === 'kassa' && this.reporter.state === 'follow') o.rep = [this.reporter.x, this.reporter.z, this.reporter.ry];
    this.net.send('state', o);
  }
  onCorr(m) { this.me.x = m.x; this.me.z = m.z; }

  // ------------------------------------------------------------------ world events
  onWorldEvent(type, e) {
    if (type === 'start') {
      const [x, z] = this.world.eventPos(e);
      const near = Math.hypot(this.me.x - x, this.me.z - z) < 90;
      if (e.kind === 'jam') { this.toast('🛺 ' + this.pickLine('jam'), '#ffb347'); if (near) Audio.sfx('jam'); }
      else { this.toast('👥 ' + this.pickLine('crowd'), '#ffb347'); }
    }
  }

  // ------------------------------------------------------------------ fx
  fxPop(text, x, y, z, color = '#ffe14d') {
    if (!this.scene) return;
    const sp = makeSprite(text, { size: 110, color, shadow: '#7a2200', pad: 8, scale: 0.012, depthTest: false });
    sp.position.set(x, y, z); sp.renderOrder = 10; this.scene.add(sp);
    this.fx.push({ sp, life: 1.1, max: 1.1, vy: 1.4, kind: 'pop' });
  }
  confetti(x, z) {
    const cols = ['#ff4d6d', '#ffd23f', '#4cc9f0', '#80ed99', '#f72585', '#fff'];
    for (let i = 0; i < 70; i++) {
      const sp = makeSprite('■', { size: 30, color: cols[i % cols.length], pad: 0, scale: 0.012, depthTest: true });
      sp.position.set(x, 2.5, z); this.scene.add(sp);
      this.fx.push({ sp, life: 2.8, max: 2.8, vx: (Math.random() - 0.5) * 9, vy: 4 + Math.random() * 6, vz: (Math.random() - 0.5) * 9, kind: 'conf' });
    }
  }
  puffDust(x, z) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex(), transparent: true, opacity: 0.5, depthWrite: false })); sp.position.set(x, 0.3, z); sp.scale.setScalar(0.9); this.scene.add(sp);
    this.fx.push({ sp, life: 0.55, max: 0.55, vy: 0.8, kind: 'dust' });
  }
  updateDust() {}
  updateFx(dt) {
    for (const f of this.fx) {
      f.life -= dt;
      if (f.kind === 'dust') { f.sp.position.y += f.vy * dt; f.sp.scale.multiplyScalar(1 + dt * 2.2); f.sp.material.opacity = Math.max(0, f.life / f.max) * 0.45; if (f.life <= 0) this.scene.remove(f.sp); continue; }
      if (f.kind === 'pop') { f.sp.position.y += f.vy * dt; const k = 1 - f.life / f.max; f.sp.material.opacity = f.life < 0.4 ? f.life / 0.4 : 1; f.sp.scale.multiplyScalar(1 + dt * 0.2); }
      else { f.vy -= 14 * dt; f.sp.position.x += f.vx * dt; f.sp.position.y = Math.max(0.1, f.sp.position.y + f.vy * dt); f.sp.position.z += f.vz * dt; f.sp.material.opacity = Math.min(1, f.life); }
      if (f.life <= 0) this.scene.remove(f.sp);
    }
    this.fx = this.fx.filter(f => f.life > 0);
    if (this.rain) {
      const p = this.rain.geometry.attributes.position, c = this.camera.position;
      this.rain.position.set(c.x, 0, c.z);
      for (let i = 0; i < p.count; i++) { let y = p.getY(i) - 28 * dt; if (y < 0) y += 25; p.setY(i, y); }
      p.needsUpdate = true;
    }
    for (const s of this.world.hideSpots) if (s.busy > 0) s.busy -= dt;
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt, snap) {
    const me = this.me, cam = this.camera;
    let tx = me.x, tz = me.z, ty = (this.world.groundY(me.x, me.z)) + 1.5;
    if (this.camTarget && this.camTarget.orbit) this.camYaw += dt * 0.7;
    if (this.ending && !(this.camTarget && this.camTarget.orbit) && this.role === 'raja') { /* keep following Raja */ }
    if (me.hidden) { ty += 0.6; }
    const cp = this.camPitch, dist = this.camDist * (this.phase === 'countdown' ? 1.15 : 1);
    const fx = Math.sin(this.camYaw) * Math.cos(cp), fz = Math.cos(this.camYaw) * Math.cos(cp), fy = Math.sin(cp);
    let want = dist;
    // camera collision: shorten until outside any tall box
    for (let s = 1.2; s <= dist; s += 0.5) {
      const x = tx - fx * s, z = tz - fz * s, y = ty + fy * s;
      let blocked = y < 0.4;
      if (!blocked) for (const c of this.world.cols) { if (c.off || c.bound || c.h < y) continue; if (x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3) { blocked = true; break; } }
      if (blocked) { want = Math.max(1.6, s - 0.7); break; }
    }
    this._cd = this._cd === undefined ? want : this._cd;
    this._cd += (want - this._cd) * Math.min(1, dt * (want < this._cd ? 14 : 3));
    const d = snap ? want : this._cd;
    { const cx2 = tx - fx * d, cz2 = tz - fz * d; cam.position.set(cx2, Math.max(0.5, ty + fy * d, this.world.groundY(cx2, cz2) + 0.7), cz2); }
    if (this.shake > 0 && this.opts.shake) { this.shake = Math.max(0, this.shake - dt * 2.2); cam.position.x += (Math.random() - 0.5) * this.shake * 0.7; cam.position.y += (Math.random() - 0.5) * this.shake * 0.7; }
    const fovT = this.opts.fov + ((me.sprinting || this.boostT > 0) && !me.hidden ? 9 : 0); this.fovNow += (fovT - this.fovNow) * Math.min(1, dt * 6);
    if (Math.abs(cam.fov - this.fovNow) > 0.05) { cam.fov = this.fovNow; cam.updateProjectionMatrix(); }
    const sl = $('speed'); if (sl) sl.style.opacity = this.opts.lines && (me.sprinting || this.boostT > 0) && !me.hidden && this.phase === 'run' ? 1 : 0;
    cam.lookAt(tx, ty + 0.2, tz);
    if (this.world.dome) this.world.dome.position.set(cam.position.x, 0, cam.position.z);
  }

  // ------------------------------------------------------------------ HUD
  setupHud() {
    $('hud').classList.add('on');
    const k = this.role === 'kassa';
    $('hudRole').textContent = k ? '🏃 කස්සා' : '🔨 රජා' + (this.o.kind && this.o.kind !== 'raja' ? ' (' + ({ sprinter: 'ධාවක', scout: 'ගවේෂක', bruiser: 'බලවන්ත' }[this.o.kind] || '') + ')' : '');
    $('hudObj').textContent = this.race ? '🏁 රෙස්! හෝටලයේ දොරට මුලින්ම ළඟා වන්න!' : (this.quest ? 'පාස් කොටස් 3ක් (හැංගිලා) → හෝටලය → කබඩ් එක' : k ? 'හෝටලයට පැන, කබඩ් එකේ හැංගෙන්න!' : 'කස්සා අල්ලන්න! (SPACE / E)');
    const lab = this.race ? (k ? { q: ['Q', '⚡ වේගය'], f: ['F', '🎭 වෙස්'], r: ['R', '💥 ඩොං'], e: ['E', '—'], sp: ['␣', '🎒 අයිතමය'] } : { q: ['Q', '⚡ වේගය'], f: ['F', ''], r: ['R', ''], e: ['E', '🎒 අයිතමය'], sp: ['␣', '🔨 තල්ලු'] }) : k ? { q: ['Q', '⚡ වේගය'], f: ['F', '🎭 වෙස්'], r: ['R', '💥 ඩොං'], e: ['E', '🌿 හැංගෙන්න'], sp: ['␣', '🎒 අයිතමය'] } : { q: ['Q', '⚡ වේගය'], f: ['F', '📢 ශබ්දය'], r: ['R', '🔍 සොයන්න'], e: ['E', '🔨 අල්ලන්න'], sp: ['␣', '🔨 අල්ලන්න'] };
    for (const [id, [key, txt]] of Object.entries(lab)) { const b = $('b_' + id); if (b) { b.querySelector('.lbl').textContent = txt; b.querySelector('.key').textContent = key; } }
    $('b_sprint').style.display = k ? '' : 'none'; $('b_sneak').style.display = k ? '' : 'none';
    $('stamWrap').style.display = k ? '' : 'none';
    $('hideWrap').classList.remove('on');
    this.setPrompt(null);
    $('hudTimerLabel').textContent = this.mode === 'mp' ? '⏱ ඉතිරි' : '⏱ වේලාව';
    const dl = { easy: 'ලේසි', normal: 'සාමාන්‍ය', hard: 'අමාරු', insane: 'පිස්සු' }[this.opts.difficulty];
    $('hudRound').textContent = this.mode === 'mp' ? (this.race ? '🏁 රෙස් · ' : '') + 'වටය ' + this.o.round + '/' + this.o.rounds : (this.race ? '🏁 හෝටල් රෙස් · ' + dl : (this.mode === 'daily' ? '📅 දෛනික · ' + dl : 'තනි ක්‍රීඩාව · ' + dl));
  }
  setPrompt(t) { const p = $('prompt'); if (t) { p.textContent = t; p.classList.add('on'); } else p.classList.remove('on'); }
  toast(text, color = '#fff') {
    const el = $('toast'); const d = document.createElement('div'); d.className = 'ti'; d.textContent = text; d.style.color = color; el.prepend(d);
    while (el.children.length > 3) el.removeChild(el.lastChild);
    setTimeout(() => d.remove(), 2600);
  }
  banner(text, ms = 2000) { if (!text) return; const b = $('banner'); b.textContent = text; b.classList.add('on'); clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove('on'), ms); Audio.speak(text); }
  big(text, ms = 900) { const b = $('big'); b.textContent = text; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); clearTimeout(this._bgt); this._bgt = setTimeout(() => b.classList.remove('on'), ms); }
  flash(color) { const f = $('flash'); f.style.background = color; f.style.opacity = 1; setTimeout(() => { f.style.opacity = 0; }, 120); }
  fmt(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
  updateHud(rt) {
    const me = this.me;
    if (this.mode === 'mp') {
      const rem = this.roundTime - rt; $('hudTimer').textContent = this.fmt(this.phase === 'countdown' ? this.roundTime : rem);
      $('hudTimer').classList.toggle('warn', rem < 30 && this.phase === 'run');
      if (this.role === 'kassa' && this.phase === 'run') $('hudSub').textContent = rt < this.head ? '🏁 ආරම්භක ඉදිරියට: ' + Math.ceil(this.head - rt) + 's' : '';
      else if (this.role === 'raja' && this.phase === 'run') $('hudSub').textContent = rt < this.head ? '⏳ කස්සා දුවනවා… ' + Math.ceil(this.head - rt) + 's' : '';
    } else if (this.race) { $('hudTimerLabel').textContent = '⏱ ඉතිරි'; $('hudTimer').textContent = this.fmt(this.roundTime - rt); }
    else { $('hudTimer').textContent = this.fmt(this.phase === 'countdown' ? 0 : rt - (this.timerStart || 0)); $('hudSub').textContent = ''; }
    if (this.race && this.phase === 'run') {
      const hd3 = this.map.hotel.door; let od = null;
      if (this.mode === 'mp') { const o2 = [...this.remotes.values()][0]; if (o2 && o2.has) od = Math.hypot(o2.x - hd3[0], o2.z - hd3[1]); } else if (this.ais[0]) od = Math.hypot(this.ais[0].x - hd3[0], this.ais[0].z - hd3[1]);
      const myd = Math.hypot(me.x - hd3[0], me.z - hd3[1]);
      $('hudSub').textContent = od == null ? '' : (od < myd ? '⚠️ ප්‍රතිවාදියා ' + Math.round(myd - od) + 'm ඉදිරියෙන්!' : '✅ ඔබ ' + Math.round(od - myd) + 'm ඉදිරියෙන්');
    }
    // hotel distance + arrow
    const hd = this.map.hotel.door; let tgt = this.role === 'kassa' ? hd : (this.kassaRemote() && this.kassaRemote().vis ? [this.kassaRemote().x, this.kassaRemote().z] : hd);
    let fragTarget = false;
    if (this.quest && this.quest.got < this.quest.need) { let bd = 1e9; for (const m of this.quest.marks) if (!m.got) { const d = Math.hypot(m.spot.x - me.x, m.spot.z - me.z); if (d < bd) { bd = d; tgt = [m.spot.x, m.spot.z]; fragTarget = true; } } }
    const dx = tgt[0] - me.x, dz = tgt[1] - me.z;
    const rel = angDiff(this.camYaw, Math.atan2(dx, dz));
    $('hudArrow').style.transform = 'rotate(' + (-rel) + 'rad)';
    $('hudDist').textContent = (fragTarget ? '🧩 ' : this.role === 'kassa' || !(this.kassaRemote() && this.kassaRemote().vis) ? '🏨 ' : '🎯 ') + Math.round(Math.hypot(dx, dz)) + 'm';
    // stamina & cooldowns
    $('stamFill').style.width = this.stamina + '%'; $('stamFill').classList.toggle('low', this.exhausted);
    const cdmax = this.role === 'kassa' ? { q: 16, f: 28, r: 14, e: 9, sp: 3.5 } : { q: 18, f: 20, r: 25, e: 0.9, sp: 0.9 };
    for (const id of ['q', 'f', 'r']) { const b = $('b_' + id), c = this.cd[id]; b.classList.toggle('cool', c > 0); b.querySelector('.cd').style.height = (c > 0 ? clamp(c / cdmax[id], 0, 1) * 100 : 0) + '%'; }
    const be = $('b_e'); if (this.role === 'raja') { be.classList.toggle('cool', this.cd.e > 0); be.querySelector('.cd').style.height = (this.cd.e > 0 ? 100 : 0) + '%'; }
    const bs = $('b_sp'); if (this.role === 'kassa') { bs.querySelector('.lbl').textContent = this.item ? ITEM[this.item].i : '💨 පැනීම'; bs.classList.toggle('has', !!this.item); const sc = this.item ? 0 : this.cd.sp; bs.classList.toggle('cool', sc > 0); bs.querySelector('.cd').style.height = (sc > 0 ? clamp(sc / 3.5, 0, 1) * 100 : 0) + '%'; }
    if (this.race && this.role === 'raja') { const be2 = $('b_e'); be2.querySelector('.lbl').textContent = this.item ? ITEM[this.item].i : '🎒 —'; }
    // effects row
    const fx = []; if (this.boostT > 0) fx.push('⚡'); if (this.disguiseT > 0) fx.push('🎭 ' + Math.ceil(this.disguiseT)); if (this.lives && this.ais.length) { let nd = 1e9; for (const a of this.ais) if (!(a.pending > 0)) nd = Math.min(nd, Math.hypot(a.x - me.x, a.z - me.z)); if (nd < 1e8) fx.push('🔨 රජා ' + Math.round(nd) + 'm'); }
    if (this.coins) fx.push('🪙 ' + this.coins);
    if (this.cover) fx.push('👥 සෙනඟ අතර'); if (this.inSmoke) fx.push('💨'); if ((this.terrainMul || 1) < 0.95) fx.push(this.terrainMul < 0.8 ? '🌾 මඩ — වේගය අඩුයි' : '🏖️ වැලි — වේගය අඩුයි'); $('hudFx').textContent = fx.join('  ');
    const qw = $('questWrap');
    if (qw) {
      qw.style.display = this.lives ? '' : 'none';
      if (this.lives) { $('questTxt').textContent = ''; $('gateTxt').textContent = ''; $('scoreTxt').textContent = '⭐ ' + this.scoreNow(); }
    }
    const lw = $('lifeWrap');
    if (lw) {
      lw.style.display = this.lives ? '' : 'none';
      if (this.lives) { const f = $('lifeFill'); f.style.width = this.hp / this.maxHp * 100 + '%'; f.style.background = this.hp > 60 ? 'linear-gradient(90deg,#4ade80,#a3e635)' : this.hp > 30 ? 'linear-gradient(90deg,#facc15,#fb923c)' : 'linear-gradient(90deg,#ef4444,#b91c1c)'; $('lifeTxt').textContent = Math.ceil(this.hp); lw.classList.toggle('hurt', this.lifeFlash > 0.2); lw.classList.toggle('heal', this.lifeFlash < 0); this.lifeFlash *= 0.7; if (Math.abs(this.lifeFlash) < 0.05) this.lifeFlash = 0; }
    }
    // hide bar
    const hw = $('hideWrap');
    if (me.hidden) {
      hw.classList.add('on');
      if (me.ho) { const hh = this.hotelHide || { start: this.t - this.hotelT, secs: K.HOTEL_HIDE }; const el = this.mode === 'mp' ? this.t - hh.start : this.hotelT; $('hideFill').style.width = clamp(el / hh.secs, 0, 1) * 100 + '%'; $('hideTxt').textContent = '🏨 කබඩ් එකේ හැංගිලා… ' + Math.max(0, Math.ceil(hh.secs - el)) + 's'; $('hideFill').className = 'gold'; }
      else { $('hideFill').style.width = clamp(1 - me.hideT / (this.hideLimit || this.maxHide), 0, 1) * 100 + '%'; $('hideTxt').textContent = ((SPOT[(this.hiddenSpot || {}).type] || [0, '🌿'])[1]) + ' හැංගිලා… (E පිටවීමට)'; $('hideFill').className = ''; }
    } else if (this.role === 'raja' && this.hotelHide) {
      hw.classList.add('on'); const el = this.t - this.hotelHide.start; $('hideFill').style.width = clamp(el / this.hotelHide.secs, 0, 1) * 100 + '%'; $('hideTxt').textContent = '🚨 කස්සා හෝටලේ හැංගිලා! ' + Math.max(0, Math.ceil(this.hotelHide.secs - el)) + 's'; $('hideFill').className = 'gold';
    } else hw.classList.remove('on');
    // proximity warning (Kassa)
    $('danger').classList.toggle('on', this.role === 'kassa' && !this.race && this.nearestOpp < 16 && this.phase === 'run');
  }

  // ------------------------------------------------------------------ minimap
  buildMinimap() {
    const S = 300, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    const b = this.map.box, k = S / Math.max(b.x1 - b.x0, b.z1 - b.z0);
    this.mmK = k; this.mmB = b;
    const px = (v) => (v - b.x0) * k, pz = (v) => (v - b.z0) * k, m = this.map;
    x.fillStyle = '#6ccf5d'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#2fa4d9'; x.fillRect(0, 0, 5, S);
    x.fillStyle = '#4a4f5c';
    for (const l of m.roadLinesZ) x.fillRect(0, pz(l - 5), S, 10 * k);
    for (const l of m.roadLinesX) { const z0 = b.z0; x.fillRect(px(l - 5), pz(z0), 10 * k, (b.z1 - z0) * k); }
    m.blockCentersZ.forEach((cz, j) => m.blockCentersX.forEach((cx, i) => {
      const t = m.grid[j][i]; if (t === 'hotel') return;
      x.fillStyle = { plaza: '#ead9b2', park: '#58b84a', hill: '#4f9a43', paddy: '#a7d36b', lake: '#e8d9a8', beach: '#f0dca0', depot: '#7b8090', market: '#e8cfa0' }[t] || '#d9d0bf';
      x.fillRect(px(cx - 15), pz(cz - 15), 30 * k, 30 * k);
    }));
    x.fillStyle = '#f3c63c'; { const H = m.hotel; const zTop = H.lobby.z0 - 7; x.fillRect(px(-32), pz(zTop), 64 * k, (H.frontZ - zTop) * k); }
    const dg = m.diagonal; if (dg) { x.strokeStyle = '#d9c9a6'; x.lineWidth = dg.w * k; x.beginPath(); x.moveTo(px(dg.x0), pz(dg.z0)); x.lineTo(px(dg.x1), pz(dg.z1)); x.stroke(); }
    m.blockCentersZ.forEach((cz, j) => m.blockCentersX.forEach((cx, i) => { if (m.grid[j][i] === 'plaza') { x.fillStyle = '#4cc9f0'; x.beginPath(); x.arc(px(cx), pz(cz), 4.2 * k, 0, TAU); x.fill(); } }));
    m.blockCentersZ.forEach((cz, j) => m.blockCentersX.forEach((cx, i) => { if (m.grid[j][i] === 'lake') { x.fillStyle = '#4cc9f0'; x.beginPath(); x.arc(px(cx), pz(cz), 10.5 * k, 0, TAU); x.fill(); } }));
    const rp = this.world.riverPts; if (rp) { x.strokeStyle = '#4cc9f0'; x.lineWidth = m.river.w * k; x.lineJoin = 'round'; x.beginPath(); rp.forEach((p, i) => i ? x.lineTo(px(p[0]), pz(p[1])) : x.moveTo(px(p[0]), pz(p[1]))); x.stroke(); }
    this.mmBase = c;
  }
  drawMinimap() {
    const cv = $('mm'); if (!cv || !this.mmBase) return; const x = cv.getContext('2d'); cv.width = cv.height = 300;
    const b = this.mmB, k = this.mmK;
    x.drawImage(this.mmBase, 0, 0);
    const px = (v) => (v - b.x0) * k, pz = (v) => (v - b.z0) * k;
    const me = this.me;
    const dot = (X, Z, col, r = 5) => { x.fillStyle = col; x.beginPath(); x.arc(px(X), pz(Z), r, 0, TAU); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 1.5; x.stroke(); };
    if (this.role === 'kassa' && !this.race) { x.fillStyle = 'rgba(255,210,63,.9)'; for (const g of this.world.gates) x.fillRect(px(g.x) - 2, pz(g.z) - 2, 4, 4); }
    for (const e of this.world.events) if (e.on) { const [ex, ez] = this.world.eventPos(e); x.fillStyle = e.kind === 'jam' ? '#ff7a00' : '#c04cff'; x.fillRect(px(ex) - 6, pz(ez) - 3, 12, 6); }
    for (const s of this.smokes) { x.fillStyle = 'rgba(220,225,230,.7)'; x.beginPath(); x.arc(px(s.x), pz(s.z), s.r * k, 0, TAU); x.fill(); }
    if (this.race) {
      if (this.mode === 'mp') { for (const r of this.remotes.values()) if (r.has) dot(r.x, r.z, '#ff4d4d', 5); } else for (const ai of this.ais) dot(ai.x, ai.z, '#ff4d4d', 5);
    } else if (this.role === 'raja') {
      this.hintMarks = this.hintMarks.filter(h => h.until > this.t);
      for (const h of this.hintMarks) { x.strokeStyle = 'rgba(255,60,60,.9)'; x.lineWidth = 2; x.beginPath(); x.arc(px(h.x), pz(h.z), h.r * k, 0, TAU); x.stroke(); x.fillStyle = 'rgba(255,60,60,.18)'; x.fill(); }
      for (const p of this.trailPts) if (p.until > this.t) dot(p.x, p.z, '#7de0ff', 4);
      for (const n of (this.noiseBlips || [])) if (n.until > this.t) { x.strokeStyle = '#ffd0a0'; x.lineWidth = 2; x.beginPath(); x.arc(px(n.x), pz(n.z), 8, 0, TAU); x.stroke(); }
      const kr = this.kassaRemote(); if (kr && kr.vis) dot(kr.x, kr.z, '#ffd23f', 6);
      for (const r of this.remotes.values()) if (r.role === 'raja' && r.has) dot(r.x, r.z, '#ff8fa3', 4);
    } else {
      if (this.mode !== 'mp') { for (const ai of this.ais) { if (ai.pending > 0) continue; const d = Math.hypot(ai.x - me.x, ai.z - me.z); if (d < 30) dot(ai.x, ai.z, '#ff4d4d', 5); } }
      else for (const r of this.remotes.values()) if (r.role === 'raja' && r.has && (r.vis || Math.hypot(r.x - me.x, r.z - me.z) < 22)) dot(r.x, r.z, '#ff4d4d', 5);
    }
    if (this.decoy) dot(this.decoy.x, this.decoy.z, '#ffd23f', 4);
    if (this.quest) for (const m of this.quest.marks) if (!m.got) { x.fillStyle = '#7df9ff'; x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath(); x.rect(px(m.spot.x) - 5, pz(m.spot.z) - 5, 10, 10); x.fill(); x.stroke(); }
    for (const sk of (this.seekers || [])) if (sk.state === 'chase' || Math.hypot(sk.x - me.x, sk.z - me.z) < 22) dot(sk.x, sk.z, '#ff9800', 3.5);
    x.save(); x.translate(px(me.x), pz(me.z)); x.rotate(-me.ry); x.fillStyle = this.role === 'kassa' ? '#ffd23f' : '#ff8fa3'; x.strokeStyle = '#000'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, 8); x.lineTo(-6, -6); x.lineTo(6, -6); x.closePath(); x.fill(); x.stroke(); x.restore();
    x.fillStyle = '#ffd23f'; x.strokeStyle = '#000'; x.lineWidth = 2; x.font = 'bold 20px sans-serif'; x.textAlign = 'center'; const hzL = pz(this.map.hotel.door[1] - 6); x.strokeText('🏨', px(0), hzL); x.fillText('🏨', px(0), hzL);
  }
}
