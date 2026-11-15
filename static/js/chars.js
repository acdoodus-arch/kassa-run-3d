// Cartoon characters (procedural, articulated) + text sprites.
const THREE = window.THREE;
import { TAU, clamp, mergeGroup, mergeInto, collectMeshes } from './util.js';

export const FONT = '"Noto Sans Sinhala","Nirmala UI","Iskoola Pota","Sinhala Sangam MN","Segoe UI",system-ui,sans-serif';

const matCache = {};
export const M = (c) => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c }));
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x24122e, side: THREE.BackSide });
export function mesh(geo, color, outline = true, ow = 1.09) { return mkMesh(geo, color, outline, ow); }
function mkMesh(geo, color, outline = true, ow = 1.09) {
  const m = new THREE.Mesh(geo, M(color));
  if (outline) { const o = new THREE.Mesh(geo, outlineMat); o.scale.setScalar(ow); m.add(o); }
  return m;
}

// ---------- text sprites / textures
const texCache = new Map();
export function textTexture(text, o = {}) {
  const key = text + '|' + JSON.stringify(o);
  if (texCache.has(key)) return texCache.get(key);
  const size = o.size || 38, pad = o.pad ?? 16;
  const font = `800 ${size}px ${FONT}`;
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = font;
  let w = Math.ceil(x.measureText(text).width) + pad * 2;
  const h = size + pad * 1.4;
  c.width = Math.min(1024, w); c.height = Math.ceil(h);
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (o.bg) {
    x.fillStyle = o.bg; const r = o.round ?? 18; const W = c.width, H = c.height;
    x.beginPath(); x.moveTo(r, 0); x.arcTo(W, 0, W, H, r); x.arcTo(W, H, 0, H, r); x.arcTo(0, H, 0, 0, r); x.arcTo(0, 0, W, 0, r); x.closePath(); x.fill();
    if (o.stroke) { x.strokeStyle = o.stroke; x.lineWidth = 4; x.stroke(); }
  }
  if (o.shadow) { x.lineWidth = 7; x.strokeStyle = o.shadow; x.lineJoin = 'round'; x.strokeText(text, c.width / 2, c.height / 2 + 2, c.width - pad); }
  x.fillStyle = o.color || '#fff';
  x.fillText(text, c.width / 2, c.height / 2 + 2, c.width - pad);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const r = { tex, w: c.width, h: c.height };
  texCache.set(key, r);
  return r;
}
export function makeSprite(text, o = {}) {
  const t = textTexture(text, o);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthWrite: false, depthTest: o.depthTest ?? true, fog: false }));
  const s = o.scale || 0.0075;
  sp.scale.set(t.w * s, t.h * s, 1);
  sp.userData = { sc: s };
  return sp;
}
export function setSpriteText(sp, text, o = {}) {
  const t = textTexture(text, o);
  sp.material.map = t.tex; sp.material.needsUpdate = true;
  const s = o.scale || sp.userData.sc || 0.0075;
  sp.scale.set(t.w * s, t.h * s, 1);
}

let shadowTex = null;
export function blobShadow(r = 0.7) {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: true }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.04; m.renderOrder = 1;
  return m;
}

// ---------- character specs
const SK = ['#f0c4a0', '#d9a074', '#b97a50', '#8d5a3a', '#6b4128'];
const PANTS = ['#2b3a55', '#3a3a3a', '#6b5b45', '#1e272e', '#556b8d', '#4a5d3a', '#8b7355'];
const HAIR = ['#17110d', '#2a1a10', '#3b2a1c', '#4a3a2a', '#6e6e6e'];
export const SPECS = {
  kassa: (o = {}) => ({ main: true, ring: '#ffe600', scale: 1.04, w: 0.95, head: 1.14, skin: '#c58a5f', shirt: o.shirt || '#ff1f7a', pants: o.shorts || '#00b8e6', kneeShorts: true, shoes: '#ffffff', hat: { color: o.cap || '#ffe600', brim: true }, glasses: true, pack: '#2b59c3', hair: '#17110d', nose: true }),
  raja: (o = {}) => {
    const v = o.kind || 'raja';
    const base = { main: true, ring: '#ff2d2d', scale: 1.06, w: 1.3, head: 1.08, skin: '#9a6039', shirt: '#c1121f', pants: '#1b1f3a', shoes: '#111111', hat: { color: '#ffd23f', brim: true, badge: true }, shades: true, mustache: true, belly: 0.6, whistle: true, tool: 'hammer', hair: '#111', nose: true };
    if (v === 'sprinter') return { ...base, scale: 0.96, w: 1.0, belly: 0, shirt: '#1faa59', pants: '#f2f2f2', kneeShorts: true, hat: { color: '#ffffff', band: true }, mustache: false };
    if (v === 'scout') return { ...base, scale: 0.98, w: 1.05, belly: 0.15, shirt: '#2aa7c9', pants: '#8b7355', hat: { color: '#f4e3a1', brim: true }, shades: false, glasses: true, pack: '#7a5a2a' };
    if (v === 'bruiser') return { ...base, scale: 1.12, w: 1.6, belly: 0.85, shirt: '#e8590c', pants: '#1d1d1d', hat: { color: '#222', brim: true } };
    return base;
  },
  ped: (r) => {
    const female = r() < 0.38, skin = SK[Math.floor(r() * SK.length)], hair = HAIR[Math.floor(r() * HAIR.length)];
    const o = { simple: true, scale: (female ? 0.86 : 0.9) + r() * 0.14, w: 0.85 + r() * 0.25, skin, shirt: pickCol(r), pants: PANTS[Math.floor(r() * PANTS.length)], shoes: '#2a2a2a', hair, nose: false, belly: !female && r() < 0.25 ? 0.3 : 0 };
    if (female) { o.longHair = true; if (r() < 0.55) o.dress = pickCol(r); }
    else { o.kneeShorts = r() < 0.2; if (r() < 0.18) o.hat = { color: pickCol(r), brim: true }; }
    return o;
  },
  reporter: () => ({ scale: 0.95, w: 1, skin: '#d9a074', shirt: '#c62828', pants: '#222', shoes: '#fff', hair: '#2a1a10', tool: 'mic', camera: true, nose: true }),
  guard: () => ({ scale: 1.02, w: 1.2, skin: '#8d5a3a', shirt: '#1d2f6f', pants: '#14204a', shoes: '#111', hat: { color: '#1d2f6f', brim: true, badge: true }, mustache: true, belly: 0.3, hair: '#111', sleeve: 'long', nose: true }),
  seeker: () => ({ simple: true, scale: 0.96, w: 1.0, skin: '#c08a5d', shirt: '#1e88e5', pants: '#37474f', shoes: '#fff', hat: { color: '#ff9800' }, hair: '#222' }),
  watcher: () => ({ scale: 1.02, w: 1.1, skin: '#b97a50', shirt: '#ffb400', pants: '#333', shoes: '#111', hat: { color: '#ffb400', brim: true }, whistle: true, belly: 0.2, hair: '#111', nose: true }),
};
const PEDCOL = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#e9c46a', '#9b5de5', '#06d6a0', '#ef476f', '#ffd166', '#118ab2', '#ffffff', '#8ac926'];
function pickCol(r) { return PEDCOL[Math.floor(r() * PEDCOL.length)]; }

const JOINTS = ['y', 'lean', 'roll', 'aLx', 'aRx', 'aLz', 'aRz', 'lLx', 'lRx', 'kLx', 'kRx', 'hy', 'hx', 'sy', 'crouch'];

export class Character {
  constructor(spec) {
    this.spec = spec;
    const s = spec, w = s.w, simple = !!s.simple;
    const mesh = (g, c) => mkMesh(g, c, !!s.main, s.main ? 1.12 : 1.09);
    const root = new THREE.Group(); this.root = root;
    const body = new THREE.Group(); body.rotation.order = 'YXZ'; root.add(body); this.body = body;
    const seg = simple ? 7 : 10, pants = s.pants || '#2b3a55', shoes = s.shoes || '#222';
    // legs: thigh + shin + shoe
    this.legs = []; this.knees = [];
    for (const side of [1, -1]) {
      const g = new THREE.Group(); g.position.set(side * 0.1 * w, 0.92, 0);
      const th = mesh(new THREE.CylinderGeometry(0.085 * w, 0.066 * w, 0.47, seg), s.dress || pants); th.position.y = -0.235; g.add(th);
      // shin + shoe hang from a knee joint (attached after the thigh is merged, see below)
      const kn = new THREE.Group(); kn.position.y = -0.47;
      const sh = mesh(new THREE.CylinderGeometry(0.064 * w, 0.046 * w, 0.43, seg - 1), (s.kneeShorts || s.dress) ? s.skin : pants); sh.position.y = -0.215; kn.add(sh);
      const shoe = mesh(new THREE.BoxGeometry(0.1 * w, 0.07, 0.26), shoes); shoe.position.set(0, -0.415, 0.05); kn.add(shoe);
      body.add(g); this.legs.push(g); this.knees.push(kn);
    }
    const torso = new THREE.Group(); torso.position.y = 0.92; body.add(torso); this.torso = torso;
    const pelvis = mesh(new THREE.CylinderGeometry(0.165 * w, 0.17 * w, 0.2, 12), s.dress || pants); pelvis.position.y = 0.07; torso.add(pelvis);
    const chest = mesh(new THREE.CylinderGeometry(0.2 * w, 0.16 * w, 0.5, 12), s.shirt); chest.scale.z = 0.72; chest.position.y = 0.42; torso.add(chest);
    if (s.belly) { const b = mesh(new THREE.SphereGeometry(0.18 * w, 12, 10), s.shirt); b.scale.set(1, 0.9, 0.75 + s.belly * 0.45); b.position.set(0, 0.26, 0.05 + s.belly * 0.07); torso.add(b); }
    if (s.dress) { const sk = mesh(new THREE.CylinderGeometry(0.17 * w, 0.31 * w, 0.8, 14), s.dress); sk.position.y = -0.28; torso.add(sk); }
    for (const sd of [1, -1]) { const sp = mesh(new THREE.SphereGeometry(0.07, 8, 6), s.shirt); sp.position.set(sd * 0.2 * w, 0.64, 0); torso.add(sp); }
    const neck = mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.1, 8), s.skin); neck.position.y = 0.73; torso.add(neck);
    if (s.pack) { const p = mesh(new THREE.BoxGeometry(0.28 * w, 0.34, 0.14), s.pack); p.position.set(0, 0.42, -0.16 * w); torso.add(p); }
    if (s.whistle) { const wh = mesh(new THREE.SphereGeometry(0.03, 8, 6), '#ffffff'); wh.position.set(0, 0.56, 0.14 * w); torso.add(wh); }
    if (s.camera) {
      const cb = mesh(new THREE.BoxGeometry(0.2, 0.16, 0.28), '#222'); cb.position.set(-0.27 * w, 0.82, 0.05); torso.add(cb);
      const ln = mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.1, 10), '#9ad'); ln.rotation.x = Math.PI / 2; ln.position.set(-0.27 * w, 0.82, 0.23); torso.add(ln);
      this.flash = new THREE.PointLight(0xffffff, 0, 8); this.flash.position.set(-0.27 * w, 0.95, 0.5); torso.add(this.flash);
    }
    // head
    const head = new THREE.Group(); head.position.y = 0.86; head.scale.setScalar(s.head || 1); torso.add(head); this.head = head;
    const skull = mesh(new THREE.SphereGeometry(0.115, simple ? 10 : 16, simple ? 8 : 12), s.skin); skull.scale.set(0.92, 1.1, 1); head.add(skull);
    for (const sd of [1, -1]) { const ear = mesh(new THREE.SphereGeometry(0.024, 6, 5), s.skin); ear.position.set(sd * 0.105, -0.005, 0); ear.scale.set(0.6, 1, 0.9); head.add(ear); }
    if (!simple) {
      for (const sd of [1, -1]) {
        const e = mesh(new THREE.SphereGeometry(0.02, 8, 6), '#f4f4f4'); e.position.set(sd * 0.04, 0.02, 0.102); head.add(e);
        const pu = mesh(new THREE.SphereGeometry(0.011, 6, 5), '#161616'); pu.position.set(sd * 0.04, 0.02, 0.118); head.add(pu);
        const br = mesh(new THREE.BoxGeometry(0.05, 0.01, 0.014), '#1a1410'); br.position.set(sd * 0.04, 0.052, 0.106); head.add(br);
      }
      const mouth = mesh(new THREE.BoxGeometry(0.05, 0.011, 0.012), '#7a2e2e'); mouth.position.set(0, -0.058, 0.106); head.add(mouth);
    }
    if (s.nose) { const n = mesh(new THREE.SphereGeometry(0.02, 8, 6), s.skin); n.scale.set(0.9, 1.2, 1.3); n.position.set(0, -0.012, 0.118); head.add(n); }
    if (s.glasses) for (const sd of [1, -1]) { const g = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, 5, 14), M('#111')); g.position.set(sd * 0.045, 0.02, 0.112); head.add(g); }
    if (s.shades) { const g = mesh(new THREE.BoxGeometry(0.2, 0.04, 0.02), '#0b0b0b'); g.position.set(0, 0.02, 0.112); head.add(g); }
    if (s.mustache) { const m2 = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), '#111'); m2.position.set(0, -0.04, 0.112); head.add(m2); }
    if (s.hair && !(s.hat && s.hat.brim && false)) { const hr = new THREE.Mesh(new THREE.SphereGeometry(0.123, 12, 8, 0, TAU, 0, Math.PI * 0.55), M(s.hair)); hr.scale.set(0.95, 1.12, 1.03); hr.position.y = 0.004; hr.rotation.x = -0.28; head.add(hr); }
    if (s.longHair) { const lh = mesh(new THREE.BoxGeometry(0.2, 0.34, 0.07), s.hair); lh.position.set(0, -0.1, -0.1); head.add(lh); }
    if (s.hat) {
      const cap = mesh(new THREE.SphereGeometry(0.13, 14, 8, 0, TAU, 0, Math.PI / 2), s.hat.color); cap.position.y = 0.03; cap.scale.set(0.97, 0.9, 1.02); head.add(cap);
      if (s.hat.brim) { const br = mesh(new THREE.BoxGeometry(0.2, 0.012, 0.12), s.hat.color); br.position.set(0, 0.04, 0.12); head.add(br); }
      if (s.hat.band) { const bd = new THREE.Mesh(new THREE.CylinderGeometry(0.131, 0.131, 0.03, 14), M('#e63946')); bd.position.y = 0.055; head.add(bd); }
      if (s.hat.badge) { const bg = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 10), '#ffd700'); bg.rotation.x = Math.PI / 2; bg.position.set(0, 0.09, 0.126); head.add(bg); }
    }
    // arms: upper arm (sleeve) + forearm + hand
    this.arms = [];
    for (const side of [1, -1]) {
      const g = new THREE.Group(); g.position.set(side * (0.2 * w + 0.07), 0.64, 0);
      if (simple) { const arm = mesh(new THREE.CylinderGeometry(0.05, 0.036, 0.58, 7), s.shirt); arm.position.y = -0.29; g.add(arm); }
      else {
        const up = mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.3, 9), s.shirt); up.position.y = -0.15; g.add(up);
        const fo = mesh(new THREE.CylinderGeometry(0.042, 0.033, 0.27, 9), s.sleeve === 'long' ? s.shirt : s.skin); fo.position.y = -0.435; g.add(fo);
        const hand = mesh(new THREE.SphereGeometry(0.04, 8, 6), s.skin); hand.scale.set(1, 1.25, 0.75); hand.position.y = -0.6; g.add(hand);
      }
      torso.add(g); this.arms.push(g);
    }
    // arms[0] = left (+x), arms[1] = right (-x). The tool lives in the right hand.
    if (s.tool === 'hammer') {
      const hg = new THREE.Group(); hg.position.set(0, -0.6, 0.05); hg.scale.setScalar(0.9);
      const handle = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), '#8a5a2b'); handle.position.y = -0.3; hg.add(handle);
      const hd = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 12), '#ff3b3b'); hd.rotation.z = Math.PI / 2; hd.position.y = -0.7; hg.add(hd);
      for (const dx of [-0.11, 0.11]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.06, 12), M('#ffe14d')); st.rotation.z = Math.PI / 2; st.position.set(dx, -0.7, 0); hg.add(st); }
      this.arms[1].add(hg); this.tool = hg;
    } else if (s.tool === 'mic') {
      const mg = new THREE.Group(); mg.position.set(0, -0.6, 0.06);
      const st = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), '#333'); st.position.y = -0.08; mg.add(st);
      const hd = mesh(new THREE.SphereGeometry(0.05, 8, 6), '#bbb'); hd.position.y = -0.22; mg.add(hd);
      this.arms[1].add(mg);
    }
    if (s.ring) {
      const rg = new THREE.Mesh(new THREE.RingGeometry(0.42 * w, 0.62 * w, 28), new THREE.MeshBasicMaterial({ color: s.ring, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      rg.rotation.x = -Math.PI / 2; rg.position.y = 0.035; rg.renderOrder = 2; root.add(rg); this.marker = rg;
    }
    root.scale.setScalar(s.scale);
    // fewer draw calls: fuse each rigid part's meshes (per material) while keeping the joints
    root.updateMatrixWorld(true);
    for (const g of [...this.legs, this.head, ...this.arms]) mergeGroup(g);
    this.legs.forEach((g, i) => g.add(this.knees[i]));
    const loose = torso.children.filter(c => c.isMesh);
    if (loose.length > 2) mergeInto(torso, loose.flatMap(m => collectMeshes(m)), new THREE.Matrix4().copy(torso.matrixWorld).invert());
    if (!s.simple) { this.shadow = blobShadow(0.7 * w); root.add(this.shadow); } else { this.shadow = new THREE.Object3D(); }
    // fx
    this.stars = new THREE.Group(); this.stars.visible = false; this.stars.position.y = 2.1;
    for (let i = 0; i < 3; i++) { const sp = makeSprite('★', { size: 60, color: '#ffe14d', shadow: '#c77700', pad: 4 }); sp.scale.setScalar(0.45); sp.userData.i = i; this.stars.add(sp); }
    root.add(this.stars);
    this.mark = null; this.nameTag = null; this.bubble = null; this.bubbleT = 0;
    this.cur = {}; for (const j of JOINTS) this.cur[j] = 0; this.cur.sy = 1;
    this.anim = 'idle'; this.animT = 0; this.phase = Math.random() * 10; this.speed = 0; this.pitch = 0; this.spin = 0;
    this.once = null;
    this.topY = 2.05 * s.scale;
  }
  setName(name, color = '#fff') {
    if (this.nameTag) { this.root.remove(this.nameTag); }
    this.nameTag = makeSprite(name, { size: 34, color, bg: 'rgba(20,10,40,.6)', pad: 12, scale: 0.0062 });
    this.nameTag.position.y = (this.topY + 0.35) / this.spec.scale; this.root.add(this.nameTag);
  }
  say(text, dur = 2.4) {
    if (!this.bubble) { this.bubble = makeSprite(text, { size: 36, color: '#2a1a40', bg: '#fffbe8', stroke: '#2a1a40', pad: 16, scale: 0.0075 }); this.root.add(this.bubble); }
    setSpriteText(this.bubble, text, { size: 36, color: '#2a1a40', bg: '#fffbe8', stroke: '#2a1a40', pad: 16, scale: 0.0075 });
    this.bubble.position.y = (this.topY + 1.15) / this.spec.scale; this.bubble.visible = true; this.bubbleT = dur;
  }
  setStars(on) { this.stars.visible = !!on; }
  // fade this character (used when he stands between the camera and Kassa). Materials are cloned once.
  setOpacity(a) {
    if (!this._fade) {
      this._fade = [];
      const cl = (m) => { const c = m.clone(); c.transparent = true; this._fade.push(c); return c; };
      this.root.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material); });
    }
    for (const m of this._fade) { m.opacity = a; m.depthWrite = a >= 1; }
  }
  setMark(txt, color = '#ffdd33') {
    if (!txt) { if (this.mark) this.mark.visible = false; return; }
    if (!this.mark) { this.mark = makeSprite(txt, { size: 80, color, shadow: '#000', pad: 4, scale: 0.012 }); this.root.add(this.mark); }
    else setSpriteText(this.mark, txt, { size: 80, color, shadow: '#000', pad: 4, scale: 0.012 });
    this.mark.position.y = (this.topY + 0.8) / this.spec.scale; this.mark.visible = true;
  }
  play(name, dur = 0) { this.anim = name; this.animT = 0; this.once = dur ? { until: dur, then: null } : null; }
  setAnim(name) { if (this.anim !== name && !this.once) { this.anim = name; this.animT = 0; } }
  target(t) {
    const a = this.anim, s = this.speed, ph = this.phase;
    const T = { y: 0, lean: 0, roll: 0, aLx: 0, aRx: 0, aLz: 0.08, aRz: 0.08, lLx: 0, lRx: 0, kLx: 0, kRx: 0, hy: 0, hx: 0, sy: 1, crouch: 0 };
    let pitch = 0, spin = 0;
    const run = (amp, lean, bob) => {
      const p = Math.sin(ph), q = Math.cos(ph);
      T.lLx = p * amp; T.lRx = -p * amp; T.aLx = -p * amp * 0.9; T.aRx = p * amp * 0.9;
      T.kLx = Math.max(0, -q) * amp * 1.1; T.kRx = Math.max(0, q) * amp * 1.1;   // knee bends while the leg swings forward
      T.y = Math.abs(p) * bob; T.lean = lean; T.roll = p * 0.05 * amp; T.hy = -p * 0.07 * amp;   // hip sway + head counter-sway
    };
    switch (a) {
      case 'idle': T.y = Math.sin(t * 2) * 0.012; T.aLz = 0.1 + Math.sin(t * 2) * 0.03; T.aRz = T.aLz; T.hy = Math.sin(t * 0.8) * 0.25; break;
      case 'walk': run(0.62, 0.06, 0.05); break;
      case 'run': run(1.0, 0.2, 0.07); break;
      case 'sprint': run(1.15, 0.38, 0.1); T.aLz = 0.2; T.aRz = 0.2; break;
      case 'sneak': run(0.4, 0.35, 0); T.crouch = 0.35; T.hy = Math.sin(t * 2.4) * 0.6; T.aLx = -0.4; T.aRx = -0.4; break;
      case 'hide': T.crouch = 0.6; T.aLx = -2.4; T.aRx = -2.4; T.lean = 0.5; T.roll = Math.sin(t * 40) * 0.03; break;
      case 'panic': run(1.1, 0.15, 0.1); T.aLx = -2.8 + Math.sin(t * 22) * 0.5; T.aRx = -2.8 - Math.sin(t * 22) * 0.5; T.aLz = 0.5; T.aRz = 0.5; T.hy = Math.sin(t * 10) * 0.6; break;
      case 'look': T.hy = Math.sin(t * 1.6) * 1.15; T.aRx = -1.6; T.aRz = 0.2; T.lean = 0.08; break;
      case 'surprise': { const k = clamp(t / 0.25, 0, 1); T.y = Math.sin(k * Math.PI) * 0.35; T.aLx = -2.6; T.aRx = -2.6; T.aLz = 0.8; T.aRz = 0.8; T.sy = 1.08; T.hx = -0.2; break; }
      case 'chase': run(1.0, 0.3, 0.07); T.aRx = -2.2 + Math.sin(ph) * 0.3; T.aLx = Math.sin(ph) * 1.0; break;
      case 'swing': { const k = clamp(t / 0.45, 0, 1); T.aRx = k < 0.35 ? -2.9 * (k / 0.35) : -2.9 + (k - 0.35) / 0.65 * 3.2; T.lean = k < 0.35 ? -0.2 : 0.5; T.aLx = -1; T.y = 0; break; }
      case 'fall': pitch = -1.5; T.y = 0.1; T.aLz = 1.2; T.aRz = 1.2; T.aLx = -0.5; T.aRx = -0.3; T.lLx = 0.3; T.lRx = -0.3; break;
      case 'slip': if (t < 0.5) { pitch = -t * 12.56; T.y = Math.sin(t / 0.5 * Math.PI) * 1.0; T.aLx = -2.5; T.aRx = -2.5; } else { pitch = -1.5; T.y = 0.1; T.aLz = 1.2; T.aRz = 1.2; } break;
      case 'caught': T.sy = 0.72; T.roll = Math.sin(t * 28) * 0.12; T.aLz = 1.0; T.aRz = 1.0; T.aLx = -0.4; T.aRx = -0.4; T.hy = Math.sin(t * 9) * 0.5; break;
      case 'celebrate': T.y = Math.abs(Math.sin(t * 6)) * 0.45; T.aLx = -2.9; T.aRx = -2.9; T.aLz = 0.5; T.aRz = 0.5; T.lLx = Math.sin(t * 12) * 0.4; T.lRx = -Math.sin(t * 12) * 0.4; T.roll = Math.sin(t * 6) * 0.08; break;
      case 'dance': T.y = Math.abs(Math.sin(t * 5)) * 0.2; spin = t * 3; T.aLx = -2.2 + Math.sin(t * 10) * 0.4; T.aRx = -2.2 - Math.sin(t * 10) * 0.4; T.aLz = 0.7; T.aRz = 0.7; break;
      case 'wave': T.aRx = -2.6; T.aRz = 0.6 + Math.sin(t * 12) * 0.4; T.hy = Math.sin(t * 2) * 0.3; break;
    }
    return { T, pitch, spin };
  }
  update(dt) {
    this.animT += dt;
    const stride = (this.anim === 'walk' || this.anim === 'run') && this.speed > 1.5;   // real walking speed sets the stride rate
    this.phase += dt * (stride ? clamp(this.speed * 2.3, 4, 16) : this.anim === 'sneak' ? 6 : this.anim === 'sprint' ? 17 : this.anim === 'chase' ? 14 : this.anim === 'panic' ? 16 : this.anim === 'walk' ? 8 : 12);
    if (this.once) { if (this.animT >= this.once.until) { this.once = null; this.anim = 'idle'; this.animT = 0; } }
    const { T, pitch, spin } = this.target(this.animT);
    const k = Math.min(1, dt * 16), c = this.cur;
    for (const j of JOINTS) c[j] += (T[j] - c[j]) * k;
    this.pitch = pitch; this.spin = spin;
    const b = this.body;
    b.position.y = c.y - c.crouch * 0.32;
    b.rotation.set(pitch, spin, c.roll);
    b.scale.set(1 / Math.sqrt(c.sy), c.sy, 1 / Math.sqrt(c.sy));
    this.torso.rotation.x = c.lean;
    this.head.rotation.set(c.hx, c.hy, 0);
    this.arms[0].rotation.set(c.aLx, 0, c.aLz);
    this.arms[1].rotation.set(c.aRx, 0, -c.aRz);
    const ls = 1 - c.crouch * 0.85;
    this.legs[0].rotation.x = c.lLx; this.legs[1].rotation.x = c.lRx; this.legs[0].scale.y = this.legs[1].scale.y = ls;
    this.knees[0].rotation.x = c.kLx; this.knees[1].rotation.x = c.kRx;
    if (this.marker) { const pu = 1 + Math.sin(this.animT * 4) * 0.07; this.marker.scale.set(pu, pu, 1); }
    this.shadow.position.y = 0.04 - b.position.y;
    const sc = 1 - clamp(c.y, 0, 1) * 0.3; this.shadow.scale.set(sc, sc, 1);
    if (this.bubbleT > 0) { this.bubbleT -= dt; if (this.bubbleT <= 0 && this.bubble) this.bubble.visible = false; }
    if (this.stars.visible) { const t = this.animT * 4; this.stars.children.forEach((sp, i) => { const a = t + i * TAU / 3; sp.position.set(Math.cos(a) * 0.5, Math.sin(t * 2 + i) * 0.08, Math.sin(a) * 0.5); }); }
    if (this.flash && this.flash.intensity > 0) this.flash.intensity = Math.max(0, this.flash.intensity - dt * 30);
  }
}

export function makeChar(kind, o = {}) {
  let spec;
  if (kind === 'kassa') spec = SPECS.kassa(o);
  else if (kind === 'raja') spec = SPECS.raja(o);
  else if (kind === 'ped') spec = SPECS.ped(o.r || Math.random);
  else spec = SPECS[kind](o);
  return new Character(spec);
}
