// Procedural cartoon Colombo: roads, shops, parks, hotel, traffic, pedestrians, events.
const THREE = window.THREE;
import { mulberry, TAU, clamp, lerp, mergeGroup, mergeInto } from './util.js';
import { mesh, M, makeSprite, textTexture, blobShadow, makeChar, FONT } from './chars.js';


const rotY = (o, a) => { o.rotation.y = a; return o; };


// ---- realistic vehicle building blocks
const _pm = {};
const P = (c, sh = 70) => _pm[c + '|' + sh] || (_pm[c + '|' + sh] = new THREE.MeshPhongMaterial({ color: c, shininess: sh, specular: 0x555555 }));
const GLASS = new THREE.MeshPhongMaterial({ color: 0x1b2a3a, shininess: 140, specular: 0x99aabb });
const TIRE = new THREE.MeshLambertMaterial({ color: 0x18181a });
const RIM = new THREE.MeshPhongMaterial({ color: 0xcfd3d8, shininess: 90, specular: 0x888888 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x25272b });
const LAMP = new THREE.MeshBasicMaterial({ color: 0xfff6cf });
const TAIL = new THREE.MeshBasicMaterial({ color: 0xd62020 });
const AMBER = new THREE.MeshBasicMaterial({ color: 0xffa31a });
// extrude a side profile [[x(front +), y], ...] across `width` -> body shell whose length runs along +z
function profMesh(pts, width, mat, bevel = 0.05) {
  const sh = new THREE.Shape(); pts.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y)); sh.closePath();
  const d = Math.max(0.05, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -d / 2); g.rotateY(-Math.PI / 2);
  return new THREE.Mesh(g, mat);
}
function boxAt(g, w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; }
function wheelAt(g, x, y, z, r, wd) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wd, 16), TIRE); t.rotation.z = Math.PI / 2; t.position.set(x, y, z); g.add(t);
  const rm = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, wd + 0.03, 10), RIM); rm.rotation.z = Math.PI / 2; rm.position.set(x, y, z); g.add(rm);
  const hb = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, wd + 0.06, 8), DARK); hb.rotation.z = Math.PI / 2; hb.position.set(x, y, z); g.add(hb);
}
function figureAt(g, x, y, z, shirt, skin) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.5, 8), M(shirt)); t.position.set(x, y + 0.25, z); g.add(t);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), M(skin)); hd.position.set(x, y + 0.64, z); g.add(hd);
  const cp = new THREE.Mesh(new THREE.SphereGeometry(0.115, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), M('#2b2b2b')); cp.position.set(x, y + 0.67, z); g.add(cp);
  for (const sd of [-1, 1]) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.45, 6), M(shirt)); a.rotation.x = -1.0; a.position.set(x + sd * 0.2, y + 0.38, z + 0.2); g.add(a); }
}

function uvScale(geo, su, sv) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return geo; }
function windowTexture(base, lit, night) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const ec = night ? document.createElement('canvas') : null, ex = ec ? ec.getContext('2d') : null;
  if (ec) { ec.width = ec.height = 128; ex.fillStyle = '#000'; ex.fillRect(0, 0, 128, 128); }
  x.fillStyle = base; x.fillRect(0, 0, 128, 128);
  if (night) { x.fillStyle = 'rgba(8,10,40,.62)'; x.fillRect(0, 0, 128, 128); }
  x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, 120, 128, 8);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const on = Math.random() < lit;
    x.fillStyle = '#3b4a63'; x.fillRect(i * 32 + 6, j * 32 + 6, 20, 22);
    x.fillStyle = on ? '#ffe9a0' : (night ? '#1c2640' : '#6aa9d6'); x.fillRect(i * 32 + 8, j * 32 + 8, 16, 18);
    if (!night) { x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(i * 32 + 8, j * 32 + 8, 6, 18); }
    if (ex && on) { ex.fillStyle = '#ffd86a'; ex.fillRect(i * 32 + 8, j * 32 + 8, 16, 18); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (ec) { const et = new THREE.CanvasTexture(ec); et.wrapS = et.wrapT = THREE.RepeatWrapping; t.emiTex = et; }
  return t;
}

export class World {
  constructor(scene, map, cfg, seed, mods = [], season = null, quality = 1) {
    this.scene = scene; this.map = map; this.cfg = cfg; this.seed = seed; this.mods = mods; this.season = season;
    this.q = quality;
    this.rnd = mulberry(seed ^ 0x9e3779b9);
    this.cols = []; this.dyn = []; this.hideSpots = []; this.pickups = []; this.vehicles = []; this.peds = [];
    this.updaters = []; this.bx = map.box; this.rx = map.roadLinesX; this.rz = map.roadLinesZ;
    this.hw = map.roadWidth / 2;
    this.occ = []; this.hills = []; this.platforms = []; this.terrainRects = []; this.terrain = []; this.lakes = []; this.riverPts = null;
    this.group = new THREE.Group(); scene.add(this.group);
    this.events = []; this.activeEvents = []; this.tick = 0;
    this.rush = mods.includes('rush');
    this.build();
  }
  add(o) { this.group.add(o); return o; }
  // hiding spots must be on the pavement or in a building, never in the middle of a road or outside the map
  cleanHideSpots() {
    const m = this.map, b = m.box;
    const onRoadCentre = (x, z) => {
      for (const lx of m.roadLinesX) if (Math.abs(x - lx) < 4.6 && z > b.z0 && z < b.z1) return true;
      for (const lz of m.roadLinesZ) if (Math.abs(z - lz) < 4.6 && x > b.x0 && x < b.x1) return true;
      return false;
    };
    this.hideSpots = this.hideSpots.filter(s => s.vehicle || (s.x > b.x0 + 1 && s.x < b.x1 - 1 && s.z > b.z0 + 1 && s.z < b.z1 - 1 && !onRoadCentre(s.x, s.z)));
    this.hideSpots.forEach((h, i) => h.id = i);
  }
  box(x0, x1, z0, z1, h, extra) { const c = { x0, x1, z0, z1, h, ...extra }; this.cols.push(c); return c; }
  dispose() { this.scene.remove(this.group); this.group.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); }); }

  onDiag(x, z, pad = 0) {
    const d = this.map.diagonal; if (!d) return false;
    const dx = d.x1 - d.x0, dz = d.z1 - d.z0, l2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - d.x0) * dx + (z - d.z0) * dz) / l2));
    return Math.hypot(x - (d.x0 + dx * t), z - (d.z0 + dz * t)) < d.w / 2 + pad;
  }
  initWater(dusk, night) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 128, 128); g.addColorStop(0, '#3fb0ee'); g.addColorStop(1, '#2a8bd4'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = 'rgba(255,255,255,.38)'; x.lineWidth = 2.5; x.lineCap = 'round';
    for (let i = 0; i < 9; i++) { x.beginPath(); for (let u = 0; u <= 128; u += 6) { const y = ((i * 15 + Math.sin(u * 0.12 + i * 2) * 4) % 128 + 128) % 128; u ? x.lineTo(u, y) : x.moveTo(u, y); } x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; this.waterTex = t;
    this.waterMat = new THREE.MeshLambertMaterial({ map: t, color: night ? 0x5568a8 : dusk ? 0xffc9a0 : 0xffffff, transparent: true, opacity: 0.93, side: THREE.DoubleSide });
    this.updaters.push((tt) => { t.offset.set(tt * 0.025, tt * 0.04); });
  }
  // ---- overlap guards: nothing may be dropped inside a building, a prop or another footprint
  free(x, z, r) {
    for (const c of this.cols) { if (c.off) continue; if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return false; }
    for (const o of this.occ) if (Math.hypot(x - o.x, z - o.z) < r + o.r) return false;
    return true;
  }
  reserve(x, z, r) { this.occ.push({ x, z, r }); }
  addPalm(x, z) { if (!this.free(x, z, 0.9)) return false; this.reserve(x, z, 0.9); this.palmPts.push([x, z]); return true; }
  addTree(x, z, sc, y = 0) { if (!this.free(x, z, 1.0)) return false; this.treePts.push([x, z, sc, y]); this.box(x - 0.45, x + 0.45, z - 0.45, z + 0.45, 4, { tree: 1 }); return true; }
  span(horiz, l) { const b = this.bx; return horiz ? [b.x0, b.x1] : [l === 0 ? -45 : b.z0, b.z1]; }
  // ground height (curbs)
  groundY(x, z) {
    if (z < this.map.hotel.frontZ - 0.5 && Math.abs(x) < 20) return 0.14; // lobby floor level
    for (const p of this.platforms) {
      if (p.shape === 'circ' ? Math.hypot(x - p.cx, z - p.cz) < p.r : (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1)) return p.y;
    }
    const hw = this.hw;
    let onRoadX = false, onRoadZ = false;
    for (const l of this.rx) if (Math.abs(x - l) < hw) onRoadX = true;
    for (const l of this.rz) if (Math.abs(z - l) < hw) onRoadZ = true;
    if (onRoadX || onRoadZ) return 0;
    return 0.12 + (this.hills.length ? this.hillH(x, z) : 0);
  }
  hillH(x, z) {
    let h = 0;
    for (const hl of this.hills) { const d = Math.hypot(x - hl.x, z - hl.z); if (d < hl.r) h = Math.max(h, hl.h * Math.pow(0.5 * (1 + Math.cos(Math.PI * d / hl.r)), 1.4)); }
    return h;
  }
  riverDist(x, z) {
    const P = this.riverPts; if (!P) return 1e9;
    let best = 1e9;
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i][0], az = P[i][1], dx = P[i + 1][0] - ax, dz = P[i + 1][1] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)); if (d < best) best = d;
    }
    return best;
  }
  onRiver(x, z, pad = 0) { return !!this.riverPts && this.riverDist(x, z) < this.map.river.w / 2 + pad; }
  terrainSpeed(x, z) { for (const r of this.terrainRects) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r.speed; return 1; }
  bridgeY(x, z) { for (const p of this.platforms) if (p.bridge && x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return p.y; return 0; }

  build() {
    const m = this.map, rnd = this.rnd, scene = this.scene;
    const pal = m.palette;
    const dusk = this.mods.includes('dusk'), rain = this.mods.includes('rain'), night = this.night = this.mods.includes('night'), fogm = this.mods.includes('fog');
    const skyCol = night ? '#0a0f2e' : dusk ? '#ffb27a' : rain ? '#9db4c4' : fogm ? '#c3ccd2' : pal.sky, fogCol = night ? '#10163a' : dusk ? '#ffd1a1' : rain ? '#b9c6cf' : fogm ? '#c9d1d6' : pal.fog;
    scene.background = new THREE.Color(skyCol);
    scene.fog = new THREE.Fog(fogCol, fogm ? 8 : rain ? 40 : night ? 50 : 110, fogm ? 85 : rain ? 120 : night ? 170 : 260);
    this.hemi = new THREE.HemisphereLight(night ? 0x5566aa : dusk ? 0xffd9b0 : 0xffffff, night ? 0x1a1a3a : dusk ? 0x7a5a8a : 0x88a070, night ? 0.62 : dusk ? 0.85 : fogm ? 0.95 : 1.0); this.add(this.hemi);
    this.sun = new THREE.DirectionalLight(night ? 0x8fa8ff : dusk ? 0xffa060 : 0xfff2d0, night ? 0.45 : dusk ? 0.7 : 0.85); this.sun.position.set(-60, 90, 40); this.add(this.sun);
    this.buildSky(skyCol, dusk);
    this.initWater(dusk, night);
    // ground / sea
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), M(pal.grass)); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; this.add(ground);
    const seaG = new THREE.PlaneGeometry(400, 400); uvScale(seaG, 50, 50); const sea = new THREE.Mesh(seaG, this.waterMat); sea.rotation.x = -Math.PI / 2; sea.position.set(this.bx.x0 - 200, 0.02, (this.bx.z0 + this.bx.z1) / 2); this.add(sea); this.sea = sea;
    // boundary walls (invisible colliders + low fence visuals)
    const bb = this.bx;
    this.box(bb.x0 - 20, bb.x0, bb.z0 - 20, bb.z1 + 20, 6, { bound: 1 }); this.box(bb.x1, bb.x1 + 20, bb.z0 - 20, bb.z1 + 20, 6, { bound: 1 });
    this.box(bb.x0 - 20, bb.x1 + 20, bb.z0 - 20, bb.z0, 6, { bound: 1 }); this.box(bb.x0 - 20, bb.x1 + 20, bb.z1, bb.z1 + 20, 6, { bound: 1 });
    this.buildRoads();
    this.buildBlocks();
    this.buildHotel();
    this.buildStreetProps();
    this.cleanHideSpots();
    this.instLamps();
    this.buildTraffic();
    this.buildPeds();
    this.buildPickups();
    this.buildEvents();
    if (this.season && this.season.bunting || this.mods.includes('festival')) this.buildBunting();
    this.mergeStatic();
    // reserve gate marker pulse
    this.updaters.push((t) => { if (this.beacon) { this.beacon.material.opacity = (this.night ? 0.42 : 0.2) + 0.08 * Math.sin(t * 2); this.beaconRing.rotation.y = t * 0.5; } });
  }

  mergeStatic() {
    const skip = new Set([...this.terrain, this.sea, this.dome, this.beacon, this.beaconRing, ...this.shortcutRings, ...this.pickups.map(p => p.ring)]);
    const meshes = [];
    for (const c of this.group.children) if (c.isMesh && !c.isInstancedMesh && !skip.has(c)) meshes.push(c);
    const all = [];
    for (const m of meshes) m.traverse(o => { if (o.isMesh) all.push(o); });
    // hiding spots are static too: fold them in (a placeholder keeps the old wobble hook harmless)
    for (const hs of this.hideSpots) { if (!hs.g || hs.merged) continue; hs.g.traverse(o => { if (o.isMesh) all.push(o); }); hs.merged = true; const gg = hs.g; hs.g = new THREE.Object3D(); this._dropGroups = (this._dropGroups || []).concat(gg); }
    this.group.updateMatrixWorld(true);
    this.group.updateMatrixWorld(true);
    mergeInto(this.group, all, new THREE.Matrix4().copy(this.group.matrixWorld).invert());
    for (const gg of this._dropGroups || []) if (gg.parent) gg.parent.remove(gg);
  }
  winCyl(r, h, ci, roofMat) {
    const geo = new THREE.CylinderGeometry(r, r, h, 18, 1), uv = geo.attributes.uv, su = (Math.PI * 2 * r) / 6, sv = h / 6;
    for (let i = 0; i < 38; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return new THREE.Mesh(geo, [this.winMats[ci], roofMat, roofMat]);
  }
  winBox(w, h, d, ci, roofMat) {
    const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) { const su = f < 2 ? d / 6 : f > 3 ? w / 6 : 1, sv = f < 4 ? h / 6 : 1; if (f === 2 || f === 3) continue; for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
    const m = this.winMats[ci];
    return new THREE.Mesh(geo, [m, m, roofMat, roofMat, m, m]);
  }

  buildSky(skyCol, dusk) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, this.night ? '#02030c' : dusk ? '#5a5aa8' : '#3d9be0'); g.addColorStop(0.55, skyCol); g.addColorStop(1, this.night ? '#1a2250' : '#ffffff');
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 16, 12), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.BackSide, fog: false, depthWrite: false }));
    this.add(dome); this.dome = dome;
    if (this.night) {
      const n = 420, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = this.rnd() * Math.PI * 2, e = 0.12 + this.rnd() * 1.3, r = 420; pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false })); stars.frustumCulled = false; this.add(stars); this.stars = stars;
      const mc = document.createElement('canvas'); mc.width = mc.height = 128; const mx = mc.getContext('2d'); const mg = mx.createRadialGradient(64, 64, 10, 64, 64, 60);
      mg.addColorStop(0, 'rgba(255,255,240,1)'); mg.addColorStop(0.35, 'rgba(255,255,230,.95)'); mg.addColorStop(0.4, 'rgba(210,225,255,.25)'); mg.addColorStop(1, 'rgba(180,200,255,0)'); mx.fillStyle = mg; mx.fillRect(0, 0, 128, 128);
      const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), fog: false, depthWrite: false })); moon.scale.set(70, 70, 1); moon.position.set(-190, 230, -150); this.add(moon); this.moon = moon;
    }
    const cc = document.createElement('canvas'); cc.width = cc.height = 128; const cx = cc.getContext('2d');
    for (let i = 0; i < 7; i++) { const gg = cx.createRadialGradient(30 + i * 12, 64 + Math.sin(i * 2) * 14, 2, 30 + i * 12, 64, 34); gg.addColorStop(0, 'rgba(255,255,255,.95)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = gg; cx.fillRect(0, 0, 128, 128); }
    const ct = new THREE.CanvasTexture(cc); this.clouds = [];
    for (let i = 0; i < 12; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, opacity: this.night ? 0.22 : dusk ? 0.6 : 0.9, fog: false, depthWrite: false }));
      sp.position.set((this.rnd() - 0.5) * 600, 70 + this.rnd() * 40, (this.rnd() - 0.5) * 600); sp.scale.set(90, 45, 1); this.add(sp); this.clouds.push(sp);
    }
    this.updaters.push((t, dt) => { for (const s of this.clouds) { s.position.x += dt * 2; if (s.position.x > 300) s.position.x = -300; } });
  }

  buildRoads() {
    const m = this.map, hw = this.hw, b = this.bx;
    const roadMat = M(m.palette.road), line = new THREE.MeshBasicMaterial({ color: 0xf6f0d0 }), yel = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const mkRoad = (x0, x1, z0, z1) => { const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), roadMat); g.rotation.x = -Math.PI / 2; g.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2); this.add(g); };
    for (const l of this.rz) mkRoad(b.x0, b.x1, l - hw, l + hw);
    for (const l of this.rx) { const [a0, a1] = this.span(false, l); mkRoad(l - hw, l + hw, a0, a1); }
    const dm = new THREE.Matrix4(), dashes = [], cws = [];
    const q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const place = (arr, x, z, ang) => { q.setFromAxisAngle(up, ang); dm.compose(new THREE.Vector3(x, 0.03, z), q, s1); arr.push(dm.clone()); };
    const nearX = (v) => this.rx.some(l => Math.abs(v - l) < hw + 1), nearZ = (v) => this.rz.some(l => Math.abs(v - l) < hw + 1);
    for (const l of this.rz) for (let v = b.x0 + 3; v < b.x1; v += 6) if (!nearX(v)) place(dashes, v, l, Math.PI / 2);
    for (const l of this.rx) { const [a0, a1] = this.span(false, l); for (let v = a0 + 3; v < a1; v += 6) if (!nearZ(v)) place(dashes, l, v, 0); }
    for (const a of this.rx) for (const c of this.rz) {
      if (a === 0 && c === -40) continue;
      for (const sd of [-1, 1]) for (let k = -4; k <= 4; k += 1.6) { place(cws, a + k, c + sd * (hw + 1.2), 0); place(cws, a + sd * (hw + 1.2), c + k, Math.PI / 2); }
    }
    const mk = (arr, geo, mat) => { const im = new THREE.InstancedMesh(geo, mat, arr.length); arr.forEach((mt, i) => im.setMatrixAt(i, mt)); this.add(im); };
    mk(dashes, new THREE.BoxGeometry(0.25, 0.02, 2.4), yel);
    mk(cws, new THREE.BoxGeometry(0.7, 0.02, 3.2), line);
  }

  buildBlocks() {
    const m = this.map, rnd = this.rnd, pal = m.palette, cenX = m.blockCentersX, cenZ = m.blockCentersZ, S = m.blockSize / 2;
    this.winTex = pal.buildings.map(c => windowTexture(c, this.night ? 0.7 : 0.35, this.night));
    this.winMats = this.winTex.map(t => { const m2 = new THREE.MeshLambertMaterial({ map: t }); if (t.emiTex) { m2.emissiveMap = t.emiTex; m2.emissive = new THREE.Color(0xffffff); } return m2; });
    this.lampPts = []; this.treePts = []; this.palmPts = []; this.bushPts = [];
    this.gates = [];
    this.shortcutRings = [];
    const hotel = m.hotel;
    this.buildRiver();
    for (let j = 0; j < cenZ.length; j++) for (let i = 0; i < cenX.length; i++) {
      const type = m.grid[j][i], cx = cenX[i], cz = cenZ[j];
      if (type === 'hotel') continue;
      // slab
      const SLAB = { park: '#7ad565', hill: '#7ad565', depot: '#5b606c', market: '#e8cfa0', paddy: '#8bbf5a', lake: '#e8d9a8', beach: '#f0dca0', plaza: '#ead9b2' };
      const col = SLAB[type] || m.palette.sidewalk;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(m.blockSize, 0.12, m.blockSize), M(col)); slab.position.set(cx, 0.06, cz); this.add(slab);
      if (type === 'shops' || type === 'market') this.buildLots(cx, cz, type, i, j);
      else if (type === 'park') this.buildPark(cx, cz);
      else if (type === 'depot') this.buildDepot(cx, cz);
      else if (type === 'plaza') this.buildPlaza(cx, cz);
      else if (type === 'hill') this.buildHill(cx, cz);
      else if (type === 'lake') this.buildLake(cx, cz);
      else if (type === 'paddy') this.buildPaddy(cx, cz);
      else if (type === 'beach') this.buildBeach(cx, cz);
      // lamps along the road edges
      for (const sd of [-1, 1]) for (let k = -10; k <= 10; k += 10) { this.lampPts.push([cx + sd * (S - 0.4), cz + k]); this.lampPts.push([cx + k, cz + sd * (S - 0.4)]); }
    }
    this.buildDiagonal();
    // hotel block slab (plaza)
    const pz = new THREE.Mesh(new THREE.BoxGeometry(70, 0.12, 30), M('#efe3c8')); pz.position.set(0, 0.06, this.map.hotel.door[1] + 50.5 - 60); this.add(pz);
  }

  sign(text, w, h, bgColor, x, y, z, ry) {
    this._sm = this._sm || {};
    const key = text + '|' + bgColor;
    if (!this._sm[key]) this._sm[key] = new THREE.MeshBasicMaterial({ map: textTexture(text, { size: 56, color: '#fff', bg: bgColor, round: 10, pad: 22, shadow: 'rgba(0,0,0,.45)' }).tex, fog: true });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this._sm[key]);
    p.position.set(x, y, z); p.rotation.y = ry; this.add(p); return p;
  }

  buildLots(cx, cz, type, bi, bj) {
    const rnd = this.rnd, m = this.map, pal = m.palette, signs = m.signs;
    const lot = 13.5, inset = 0.8, off = 1.5 + lot / 2;
    const roadCols = ['#e63946', '#2a9d8f', '#f4a261', '#7b2cbf', '#118ab2', '#ef476f', '#fb8500', '#06a77d'];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const lx = cx + (a ? off : -off), lz = cz + (b ? off : -off);
      const w = lot - inset * 2, d = lot - inset * 2;
      if (this.onDiag(lx, lz, 4) || this.onRiver(lx, lz, 9)) continue;   // the diagonal boulevard cuts through here
      if (type === 'market' && (a + b) % 2 === 0) { this.buildMarketLot(lx, lz, w, d); continue; }
      const h = 7 + rnd() * 16, ci = Math.floor(rnd() * pal.buildings.length);
      const roofM = M('#8a8f9c'), nb = pal.buildings.length, ci2 = (ci + 3) % nb, v = rnd(), pod = 5, hh = h - pod; let pitched = false;
      const put = (mm, x, y, z) => { mm.position.set(x, y + 0.12, z); this.add(mm); };
      const ledge = (yy, ww = w, dd = d) => put(new THREE.Mesh(new THREE.BoxGeometry(ww + 0.5, 0.24, dd + 0.5), M('#f6f1e7')), lx, yy, lz);
      if (v < 0.4) {
        put(this.winBox(w, h, d, ci, roofM), lx, h / 2, lz);
        for (let ly = 5.6; ly < h - 1; ly += 4.5) ledge(ly);
        if (h < 17 && rnd() < (this.map.pitched ?? 0.2)) { pitched = true; const rf = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 3.4, 4), M('#b5472a')); rf.rotation.y = Math.PI / 4; put(rf, lx, h + 1.7, lz); }
      } else {
        put(this.winBox(w, pod, d, ci, roofM), lx, pod / 2, lz); ledge(pod);                                    // shop podium
        if (v < 0.58) { const h1 = hh * 0.55; put(this.winBox(w * 0.86, h1, d * 0.86, ci, roofM), lx, pod + h1 / 2, lz); put(this.winBox(w * 0.58, hh - h1, d * 0.58, ci2, roofM), lx, pod + h1 + (hh - h1) / 2, lz); }   // wedding-cake tiers
        else if (v < 0.74) put(this.winCyl(w * 0.44, hh, ci2, roofM), lx, pod + hh / 2, lz);          // round tower
        else if (v < 0.87) { put(this.winBox(w, hh, d * 0.5, ci, roofM), lx, pod + hh / 2, lz - d * 0.25); put(this.winBox(w * 0.5, hh * 0.72, d * 0.5, ci2, roofM), lx - w * 0.25, pod + hh * 0.36, lz + d * 0.25); }   // L shape
        else { put(this.winBox(w * 0.4, hh, d * 0.7, ci, roofM), lx - w * 0.28, pod + hh / 2, lz); put(this.winBox(w * 0.4, hh * 0.8, d * 0.7, ci2, roofM), lx + w * 0.28, pod + hh * 0.4, lz); }   // twin towers
      }
      this.box(lx - w / 2, lx + w / 2, lz - d / 2, lz + d / 2, h);
      // roof detail
      if (!pitched) {       const tank = mesh(new THREE.CylinderGeometry(1, 1, 1.6, 8), '#c0c6d0', false); tank.position.set(lx + (rnd() - 0.5) * 4, h + 0.9, lz + (rnd() - 0.5) * 4); this.add(tank); }
      // shop fronts on road-facing sides
      const faces = [];
      if (a === 0) faces.push([-1, 0]); else faces.push([1, 0]);
      if (b === 0) faces.push([0, -1]); else faces.push([0, 1]);
      for (const [fx, fz] of faces) {
        const px = lx + fx * (w / 2 + 0.06), pz = lz + fz * (d / 2 + 0.06), ry = fx === 1 ? Math.PI / 2 : fx === -1 ? -Math.PI / 2 : fz === 1 ? 0 : Math.PI;
        const si = Math.floor(rnd() * signs.length), bg = roadCols[si % roadCols.length];
        const sw = fx ? d : w;
        this.sign(signs[si], Math.min(8.5, sw - 1), 1.7, bg, px, 3.6, pz, ry);
        // awning
        const aw = new THREE.Mesh(new THREE.BoxGeometry(fx ? 1.4 : sw - 1, 0.15, fx ? sw - 1 : 1.4), M(bg)); aw.position.set(px + fx * 0.7, 2.7, pz + fz * 0.7); aw.rotation.z = fx ? -fx * 0.15 : 0; aw.rotation.x = fz ? fz * 0.15 : 0; this.add(aw);
        if (rnd() < 0.5) {   // a shop door the player can slip into
          const off2 = (rnd() < 0.5 ? -1 : 1) * (sw / 2 - 1.5), dxp = fx ? px + fx * 0.14 : lx + off2, dzp = fx ? lz + off2 : pz + fz * 0.14;
          const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.25), M('#7a4a22')); door.position.set(dxp, 1.27, dzp); door.rotation.y = ry; this.add(door);
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), M('#ffd700')); knob.position.set(dxp + (fx ? fx * 0.16 : 0.4), 1.2, dzp + (fz ? fz * 0.16 : 0)); this.add(knob);
        }
        // shop window
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(5, sw - 6), 1.8), (this.glassMat = this.glassMat || new THREE.MeshBasicMaterial({ color: 0xbfe8ff }))); gl.position.set(px + fx * 0.02, 1.4, pz + fz * 0.02); gl.rotation.y = ry; this.add(gl);
      }
      // rooftop billboard on some
      if (!pitched && rnd() < 0.2 && h > 14) {
        const ads = ['හෝටලේ තව ටිකයි!', 'කොළඹ දුවන්න!', 'කස්සා සුපිරි!', 'රජා ගාමන්ට්ස් — අල්ලලා ගන්න!'];
        this.sign(ads[Math.floor(rnd() * ads.length)], 9, 2.4, '#222a54', lx, h + 2.2, lz + d / 2 - 0.5, 0);
      }
    }
    // alley gates (shortcuts only Kassa can squeeze through)
    const half = 2.3;
    const arms = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const gated = arms.map(() => rnd() <= 0.5);
    if (gated.every(Boolean)) gated[Math.floor(rnd() * 4)] = false;   // never seal the alley cross: keep one arm open to Raja
    for (const [i, [ax, az]] of arms.entries()) {
      if (!gated[i]) continue;
      const gx = cx + ax * 7.6, gz = cz + az * 7.6;
      const gapW = 1.3, th = 0.7;
      if (ax === 0) { this.gateBox(gx - half, gx - gapW / 2, gz - th / 2, gz + th / 2); this.gateBox(gx + gapW / 2, gx + half, gz - th / 2, gz + th / 2); }
      else { this.gateBox(gx - th / 2, gx + th / 2, gz - half, gz - gapW / 2); this.gateBox(gx - th / 2, gx + th / 2, gz + gapW / 2, gz + half); }
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 20), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(gx, 0.2, gz); this.add(ring); this.shortcutRings.push(ring);
      this.gates.push({ x: gx, z: gz });
      // trash cans in the gap to look intentional
    }
    this.updaters.push((t) => { for (const r of this.shortcutRings) { const s = 1 + Math.sin(t * 3) * 0.12; r.scale.set(s, s, s); } });
    if (rnd() < 0.55) this.addManhole(cx + 0.6, cz + 0.6);
    // a couple of dumpsters + trash in the alleys (hide spots)
    for (let k = 0; k < 2; k++) {
      if (rnd() < 0.6) {
        const sx = rnd() < 0.5 ? -1 : 1, sz = rnd() < 0.5 ? -1 : 1;
        this.addDumpster(cx + sx * (off - 1.3 + rnd() * 0.5), cz + sz * 1.3 + (rnd() - 0.5) * 0.4, rnd() < 0.5 ? 0 : Math.PI / 2);
      }
    }
  }
  gateBox(x0, x1, z0, z1) {
    this.box(x0, x1, z0, z1, 1.3);
    const g = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.3, z1 - z0), M('#b5651d')); g.position.set((x0 + x1) / 2, 0.75, (z0 + z1) / 2); this.add(g);
    const top = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.05, 0.12, z1 - z0 + 0.05), M('#8a4b12')); top.position.set((x0 + x1) / 2, 1.45, (z0 + z1) / 2); this.add(top);
  }

  addDumpster(x, z, ry) {
    if (!this.free(x, z, 1.8)) return;
    const w = ry ? 1.4 : 2.4, d = ry ? 2.4 : 1.4;
    const g = new THREE.Group(); g.position.set(x, 0.12, z);
    const b = mesh(new THREE.BoxGeometry(2.4, 1.2, 1.4), '#2e8b57'); b.position.y = 0.6; g.add(b);
    const l = mesh(new THREE.BoxGeometry(2.5, 0.12, 1.5), '#1f5c3a'); l.position.set(0, 1.25, 0); g.add(l);
    mergeGroup(g); g.rotation.y = ry; this.add(g);
    this.box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 1.3);
    this.hideSpots.push({ x, z, type: 'dumpster', r: 2.6, g, busy: 0 });
  }
  addBush(x, z, s = 1, y = 0) {
    if (!this.free(x, z, 1.1)) return;
    const g = new THREE.Group(); g.position.set(x, 0.1 + y, z);
    const cols = ['#2f9e44', '#37b24d', '#2b8a3e'];
    for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.SphereGeometry(0.7 * s, 8, 6), M(cols[i % 3])); sp.position.set((i % 2 - 0.5) * 0.7 * s, 0.6 * s, (i > 1 ? 0.5 : -0.3) * s); g.add(sp); }
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), M('#ff4d6d')); fl.position.set(0.5 * s, 1.1 * s, 0.5 * s); g.add(fl);
    mergeGroup(g); this.add(g);
    this.hideSpots.push({ x, z, type: 'bush', r: 2.4, g, busy: 0 });
  }
  addTuk(x, z, ry, col) {
    if (!this.free(x, z, 1.7)) return;
    const g = this.tukModel(col); g.position.set(x, 0, z); g.rotation.y = ry; this.add(g);
    const c = Math.abs(Math.sin(ry)) > 0.5 ? [1.4, 1.0] : [1.0, 1.4];
    this.box(x - c[0], x + c[0], z - c[1], z + c[1], 1.8);
    this.hideSpots.push({ x, z, type: 'tuk', r: 2.8, g, busy: 0 });
  }

  addBarrels(x, z) {
    if (!this.free(x, z, 1.3)) return;
    const g = new THREE.Group(); g.position.set(x, 0.12, z); const cols = ['#c0392b', '#2980b9', '#27ae60', '#e67e22'];
    [[-0.5, -0.4], [0.5, -0.4], [0, 0.45], [-0.5, 0.5]].forEach(([bx, bz], i) => { const b = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10), cols[i % 4]); b.position.set(bx, 0.55, bz); g.add(b); });
    const top = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 10), '#7f8c8d'); top.position.set(0, 1.6, 0); g.add(top);
    mergeGroup(g); this.add(g); this.box(x - 1.0, x + 1.0, z - 1.0, z + 1.0, 1.6);
    this.hideSpots.push({ x, z, type: 'barrels', r: 2.6, g, busy: 0 });
  }
  addCart(x, z, ry) {
    if (!this.free(x, z, 1.7)) return;
    const g = new THREE.Group(); g.position.set(x, 0.12, z);
    const bed = mesh(new THREE.BoxGeometry(2.0, 0.5, 1.1), '#a0632a'); bed.position.y = 0.8; g.add(bed);
    const tarp = mesh(new THREE.BoxGeometry(2.1, 0.9, 1.2), '#16a085'); tarp.position.y = 1.5; tarp.scale.set(1, 1, 1); g.add(tarp);
    for (const sx of [-0.8, 0.8]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 10), M('#222')); w.rotation.x = Math.PI / 2; w.position.set(sx, 0.45, 0.65); g.add(w); }
    mergeGroup(g); g.rotation.y = ry; this.add(g);
    const c = Math.abs(Math.sin(ry)) > 0.5 ? [0.8, 1.3] : [1.3, 0.8]; this.box(x - c[0], x + c[0], z - c[1], z + c[1], 1.9);
    this.hideSpots.push({ x, z, type: 'cart', r: 2.6, g, busy: 0 });
  }
  addBooth(x, z) {
    if (!this.free(x, z, 1.0)) return;
    const g = new THREE.Group(); g.position.set(x, 0.12, z);
    const b = mesh(new THREE.BoxGeometry(1.1, 2.6, 1.1), '#d62828'); b.position.y = 1.3; g.add(b);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 1.14), M('#bfe8ff')); gl.position.y = 1.5; g.add(gl);
    const top = mesh(new THREE.BoxGeometry(1.25, 0.2, 1.25), '#7b1d1d'); top.position.y = 2.7; g.add(top);
    mergeGroup(g); this.add(g); this.box(x - 0.6, x + 0.6, z - 0.6, z + 0.6, 2.7);
    this.hideSpots.push({ x, z, type: 'booth', r: 2.2, g, busy: 0 });
  }
  addManhole(x, z) {
    if (!this.free(x, z, 1.0)) return;
    this.reserve(x, z, 1.0);
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 14), M('#3a3f4a')); d.position.set(x, 0.15, z); this.add(d);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 5, 14), M('#caa24a')); r.rotation.x = Math.PI / 2; r.position.set(x, 0.17, z); this.add(r);
    this.hideSpots.push({ x, z, type: 'manhole', r: 1.9, g: null, busy: 0 });
  }
  addCarPark(x, z, ry, col) {
    if (!this.free(x, z, 2.5)) return;
    const g = this.carModel(col); g.position.set(x, 0, z); g.rotation.y = ry; this.add(g);
    const c = Math.abs(Math.sin(ry)) > 0.5 ? [2.1, 1.0] : [1.0, 2.1]; this.box(x - c[0], x + c[0], z - c[1], z + c[1], 1.9);
    this.hideSpots.push({ x, z, type: 'car', r: 3.0, g, busy: 0 });
  }

  // round plaza: concentric rings, fountain, radial trees (not a rectangle in sight)
  buildPlaza(cx, cz) {
    const rnd = this.rnd;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(14.2, 14.2, 0.07, 36), M('#ead9b2')); disc.position.set(cx, 0.155, cz); this.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(8.2, 11.4, 40), M('#4a4f5c')); ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.2, cz); this.add(ring);
    const dash = new THREE.Mesh(new THREE.RingGeometry(9.7, 9.9, 40), new THREE.MeshBasicMaterial({ color: 0xffd23f })); dash.rotation.x = -Math.PI / 2; dash.position.set(cx, 0.22, cz); this.add(dash);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 0.12, 30), M('#7ad565')); inner.position.set(cx, 0.2, cz); this.add(inner);
    const basin = mesh(new THREE.CylinderGeometry(4, 4.3, 0.7, 24), '#bfe8ff'); basin.position.set(cx, 0.5, cz); this.add(basin);
    const wat = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.1, 24), M('#4cc9f0')); wat.position.set(cx, 0.86, cz); this.add(wat);
    const col = mesh(new THREE.CylinderGeometry(0.7, 0.9, 5, 10), '#fff4d6'); col.position.set(cx, 2.6, cz); this.add(col);
    const top = mesh(new THREE.SphereGeometry(1.0, 10, 8), '#ffd23f'); top.position.set(cx, 5.4, cz); this.add(top);
    this.box(cx - 3.6, cx + 3.6, cz - 3.6, cz + 3.6, 5);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = 12.6, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (Math.abs(x - cx) > 14.4 || Math.abs(z - cz) > 14.4) continue; this.addTree(x, z, 0.9 + rnd() * 0.4); }
    for (let i = 0; i < 6; i++) { const a = ((i + 0.5) / 6) * Math.PI * 2, r = 6.2; this.addBush(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0.8); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.78, x = cx + Math.cos(a) * 12.2, z = cz + Math.sin(a) * 12.2; const bn = mesh(new THREE.BoxGeometry(1.8, 0.5, 0.6), '#8b5a2b'); bn.position.set(x, 0.4, z); bn.rotation.y = -a; this.add(bn); this.box(x - 0.8, x + 0.8, z - 0.8, z + 0.8, 0.6); }
    this.addBooth(cx + 13.4, cz + 1); this.addBarrels(cx - 13.4, cz - 1);
    this.sign('රවුම් චතුරශ්‍රය', 6.5, 1.3, '#1d3557', cx, 6.8, cz, 0);
  }

  // diagonal boulevard across the city: paving, centre dashes, lamps and palms (lots on its line are left empty)
  buildDiagonal() {
    const d = this.map.diagonal; if (!d) return;
    const dx = d.x1 - d.x0, dz = d.z1 - d.z0, len = Math.hypot(dx, dz), th = Math.atan2(-dz, dx), cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    const mk = (w, mat, y) => { const m2 = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat); m2.rotation.order = 'YXZ'; m2.rotation.set(-Math.PI / 2, th, 0); m2.position.set(cx, y, cz); this.add(m2); };
    mk(d.w, M('#d9c9a6'), 0.17); mk(d.w - 1.6, M('#c9b88f'), 0.175); mk(0.25, new THREE.MeshBasicMaterial({ color: 0xffd23f }), 0.18);
    const nx = -dz / len, nz = dx / len, ux = dx / len, uz = dz / len;
    for (let t = 6; t < len - 4; t += 15) for (const sd of [-1, 1]) {
      const x = d.x0 + ux * t + nx * sd * (d.w / 2 - 0.4), z = d.z0 + uz * t + nz * sd * (d.w / 2 - 0.4);
      if (z < -44 || this.rx.some(r => Math.abs(x - r) < 6) && this.rz.some(r => Math.abs(z - r) < 6)) continue;
      this.lampPts.push([x, z]);
    }
    for (let t = 14; t < len - 6; t += 26) { const x = d.x0 + ux * t + nx * (d.w / 2 + 1.2), z = d.z0 + uz * t + nz * (d.w / 2 + 1.2); if (this.rx.some(r => Math.abs(x - r) < 7) || this.rz.some(r => Math.abs(z - r) < 7)) continue; this.addPalm(x, z); }
  }

  // ---------------------------------------------------------------- geography
  rock(x, z, y, r) {
    if (!this.free(x, z, r + 0.6)) return;
    const g = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), M('#9a9488')); g.position.set(x, y + 0.12 + r * 0.55, z); g.scale.set(1, 0.7, 0.9); g.rotation.y = this.rnd() * 6; this.add(g);
    const c = r * 0.85; this.box(x - c, x + c, z - c, z + c, 1.4);
    this.hideSpots.push({ x, z, type: 'rock', r: r + 1.5, g: null, busy: 0 });
  }
  buildHill(cx, cz) {
    const rnd = this.rnd, R = 15, H = 7.5;
    this.hills.push({ x: cx, z: cz, r: R, h: H });
    const geo = new THREE.PlaneGeometry(R * 2 + 1, R * 2 + 1, 46, 46); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), cg = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const wx = cx + pos.getX(i), wz = cz + pos.getZ(i), h = this.hillH(wx, wz); pos.setY(i, h + 0.125);
      const t = h / H; cg.set(t < 0.5 ? '#74d05f' : t < 0.8 ? '#4fa84a' : '#a39a86'); if (t > 0.01) cg.offsetHSL(0, 0, (Math.sin(wx * 0.8) * Math.cos(wz * 0.7)) * 0.03);
      col[i * 3] = cg.r; col[i * 3 + 1] = cg.g; col[i * 3 + 2] = cg.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    const mesh2 = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })); mesh2.position.set(cx, 0, cz); this.add(mesh2); this.terrain.push(mesh2);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * 6.283, r = 4 + rnd() * 9.5, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (this.onDiag(x, z, 2)) continue;
      this.addTree(x, z, 0.8 + rnd() * 0.7, this.hillH(x, z));
    }
    for (let i = 0; i < 7; i++) { const a = rnd() * 6.283, r = 3 + rnd() * 10, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; this.rock(x, z, this.hillH(x, z), 0.9 + rnd() * 0.8); }
    for (let i = 0; i < 5; i++) { const a = rnd() * 6.283, r = 4 + rnd() * 9, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; this.addBush(x, z, 0.85, this.hillH(x, z)); }
    // summit lookout
    const y0 = H + 0.12, g = new THREE.Group(); g.position.set(cx, y0, cz);
    const base = mesh(new THREE.CylinderGeometry(2.6, 3, 0.7, 10), '#c9c3b5'); base.position.y = 0.35; g.add(base);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; const post = mesh(new THREE.CylinderGeometry(0.16, 0.16, 3, 6), '#7a4b22'); post.position.set(Math.cos(a) * 1.9, 2.2, Math.sin(a) * 1.9); g.add(post); }
    const roof = mesh(new THREE.ConeGeometry(3.4, 1.8, 8), '#b5472a'); roof.position.y = 4.6; g.add(roof);
    const pole = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5), '#444', false); pole.position.y = 6.4; g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshBasicMaterial({ color: 0xff4d6d, side: THREE.DoubleSide })); flag.position.set(0.7, 7.2, 0); g.add(flag);
    mergeGroup(g); this.add(g); this.box(cx - 2.2, cx + 2.2, cz - 2.2, cz + 2.2, 4.5);
    this.hideSpots.push({ x: cx, z: cz + 3.4, type: 'lookout', r: 2.6, g: null, busy: 0 });
    this.sign('කන්ද මුදුන', 4.6, 1.0, '#2b8a3e', cx, y0 + 8.4, cz - 0.1, 0);
  }
  buildLake(cx, cz) {
    const R = 10.5, rnd = this.rnd;
    const shore = new THREE.Mesh(new THREE.RingGeometry(R - 0.3, R + 1.8, 40), M('#e1cc92')); shore.rotation.x = -Math.PI / 2; shore.position.set(cx, 0.15, cz); this.add(shore);
    const wg = new THREE.CircleGeometry(R, 40); uvScale(wg, R * 2 / 8, R * 2 / 8); const water = new THREE.Mesh(wg, this.waterMat); water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.17, cz); this.add(water);
    const isl = mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.7, 14), '#6cc15a'); isl.position.set(cx, 0.4, cz); this.add(isl);
    this.platforms.push({ shape: 'circ', cx, cz, r: 3.5, y: 0.75 });
    // jetty from the south shore to the island
    const jz0 = cz + 3.4, jz1 = cz + R + 1.2;
    const jet = mesh(new THREE.BoxGeometry(2.4, 0.2, jz1 - jz0), '#a0632a'); jet.position.set(cx, 0.45, (jz0 + jz1) / 2); this.add(jet);
    for (let k = 0; k < 5; k++) { const pst = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 5), '#6b4a24', false); pst.position.set(cx + (k % 2 ? 1.1 : -1.1), 0.3, jz0 + 0.7 + k * (jz1 - jz0 - 1.4) / 4); this.add(pst); }
    this.platforms.push({ shape: 'rect', x0: cx - 1.2, x1: cx + 1.2, z0: jz0 - 0.2, z1: jz1, y: 0.58 });
    // lake-house on the island + palm
    const g = new THREE.Group(); g.position.set(cx + 0.6, 0.75, cz - 0.4);
    const wall = mesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), '#f6e0b5'); wall.position.y = 0.8; g.add(wall);
    const rf = mesh(new THREE.ConeGeometry(2.3, 1.3, 4), '#b5472a'); rf.rotation.y = Math.PI / 4; rf.position.y = 2.2; g.add(rf);
    mergeGroup(g); this.add(g); this.box(cx + 0.6 - 1.3, cx + 0.6 + 1.3, cz - 0.4 - 1.3, cz - 0.4 + 1.3, 2.5);
    this.hideSpots.push({ x: cx + 0.6, z: cz + 1.4, type: 'hut', r: 2.6, g: null, busy: 0 });
    this.addPalm(cx - 1.8, cz + 0.8);
    // water is not walkable: a grid of low colliders everywhere except the island and the jetty
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const x = cx + i * 3, z = cz + j * 3;
      if (Math.hypot(i * 3, j * 3) > R - 0.2 || Math.hypot(i * 3, j * 3) < 3.9 || (Math.abs(i * 3) < 2.2 && j * 3 > 2)) continue;
      this.box(x - 1.5, x + 1.5, z - 1.5, z + 1.5, 0.3, { water: 1 });
    }
    for (let i = 0; i < 6; i++) { const a = Math.PI * (0.1 + rnd() * 1.8), x = cx + Math.cos(a) * (R + 2.6), z = cz + Math.sin(a) * (R + 2.6); if (Math.abs(x - cx) > 14 || Math.abs(z - cz) > 14) continue; this.addTree(x, z, 0.9 + rnd() * 0.4, 0); }
    this.sign('වැව', 3, 1.0, '#118ab2', cx, 3.2, cz + R + 1.8, 0);
  }
  buildPaddy(cx, cz) {
    const rnd = this.rnd;
    this.terrainRects.push({ x0: cx - 15, x1: cx + 15, z0: cz - 15, z1: cz + 15, speed: 0.72 });
    for (let k = 0; k < 6; k++) {
      const z = cz - 12.5 + k * 5, strip = new THREE.Mesh(new THREE.BoxGeometry(27, 0.06, 3.6), M(k % 2 ? '#9ccf5f' : '#7fb347')); strip.position.set(cx, 0.15, z); this.add(strip);
      const wat = new THREE.Mesh(new THREE.BoxGeometry(27, 0.04, 0.9), M('#6ec6e8')); wat.position.set(cx, 0.17, z + 2.35); this.add(wat);
      const bund = new THREE.Mesh(new THREE.BoxGeometry(28.5, 0.34, 0.5), M('#7a5a32')); bund.position.set(cx, 0.28, z + 2.5); this.add(bund);
    }
    for (const [dx, dz] of [[-11, -11], [11, 11]]) {   // watch huts on stilts
      const x = cx + dx, z = cz + dz, g = new THREE.Group(); g.position.set(x, 0.12, z);
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const st = mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.4, 5), '#6b4a24', false); st.position.set(px, 0.7, pz); g.add(st); }
      const fl = mesh(new THREE.BoxGeometry(2.8, 0.2, 2.8), '#a0632a'); fl.position.y = 1.4; g.add(fl);
      const rf = mesh(new THREE.ConeGeometry(2.5, 1.5, 4), '#c9a24a'); rf.rotation.y = Math.PI / 4; rf.position.y = 2.7; g.add(rf);
      mergeGroup(g); this.add(g); this.box(x - 1.5, x + 1.5, z - 1.5, z + 1.5, 3);
      this.hideSpots.push({ x, z, type: 'hut', r: 2.9, g: null, busy: 0 });
    }
    for (let i = 0; i < 4; i++) {   // haystacks
      const x = cx - 12 + rnd() * 24, z = cz - 12 + rnd() * 24, g = new THREE.Group(); g.position.set(x, 0.12, z);
      const h = mesh(new THREE.ConeGeometry(1.5, 2.6, 9), '#d4b45a'); h.position.y = 1.3; g.add(h);
      mergeGroup(g); this.add(g); this.box(x - 1.1, x + 1.1, z - 1.1, z + 1.1, 2.4);
      this.hideSpots.push({ x, z, type: 'haystack', r: 2.8, g: null, busy: 0 });
    }
    for (let i = 0; i < 5; i++) { const x = cx - 13 + rnd() * 26, z = cz - 13 + rnd() * 26; this.palmPts.length < 60 && rnd() < 0.5 && this.addPalm(x, z); }
    this.sign('වී ගොවිපළ', 4.6, 1.1, '#5a8f29', cx, 3.4, cz + 15.2, 0);
  }
  buildBeach(cx, cz) {
    const rnd = this.rnd;
    this.terrainRects.push({ x0: cx - 15, x1: cx + 15, z0: cz - 15, z1: cz + 15, speed: 0.82 });
    for (let i = 0; i < 9; i++) this.addPalm(cx - 14 + rnd() * 28, cz - 14 + rnd() * 28);
    for (let i = 0; i < 3; i++) {   // beach huts
      const x = cx - 8 + i * 8, z = cz + 6 + rnd() * 4, g = new THREE.Group(); g.position.set(x, 0.12, z);
      const w = mesh(new THREE.BoxGeometry(2.4, 2, 2.2), ['#ff9aa2', '#ffd166', '#8ecae6'][i]); w.position.y = 1; g.add(w);
      const r = mesh(new THREE.ConeGeometry(2, 1.2, 4), '#b5472a'); r.rotation.y = Math.PI / 4; r.position.y = 2.6; g.add(r);
      mergeGroup(g); this.add(g); this.box(x - 1.3, x + 1.3, z - 1.2, z + 1.2, 2.8);
      this.hideSpots.push({ x, z, type: 'hut', r: 2.8, g: null, busy: 0 });
    }
    for (let i = 0; i < 2; i++) {   // outrigger boats
      const x = cx - 7 + i * 14, z = cz - 8 + rnd() * 4, g = new THREE.Group(); g.position.set(x, 0.12, z);
      const hull = mesh(new THREE.BoxGeometry(5, 0.7, 1.1), '#e63946'); hull.position.y = 0.45; g.add(hull);
      const out = mesh(new THREE.BoxGeometry(4.4, 0.18, 0.2), '#8d5524'); out.position.set(0, 0.5, 1.3); g.add(out);
      mergeGroup(g); this.add(g); this.box(x - 2.6, x + 2.6, z - 0.8, z + 1.6, 1.0);
      this.hideSpots.push({ x, z, type: 'boat', r: 3, g: null, busy: 0 });
    }
    this.sign('වෙරළ', 3.2, 1, '#0aa6c9', cx, 3.4, cz + 15.2, 0);
  }
  buildRiver() {
    const R = this.map.river; if (!R) return;
    const curve = new THREE.CatmullRomCurve3(R.points.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'catmullrom', 0.5);
    const P = curve.getPoints(Math.ceil(curve.getLength() / 3)); this.riverPts = P.map(v => [v.x, v.z]);
    const strip = (w, y, mat, uvu, uvv) => {
      const pos = [], uv = [], idx = [], nor = []; let len = 0;
      for (let i = 0; i < P.length; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
        if (i) len += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
        pos.push(P[i].x + nx * w / 2, y, P[i].z + nz * w / 2, P[i].x - nx * w / 2, y, P[i].z - nz * w / 2); nor.push(0, 1, 0, 0, 1, 0);
        uv.push(0, len / 8 * uvv, w / 8 * uvu, len / 8 * uvv);
        if (i < P.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      const m2 = new THREE.Mesh(g, mat); this.add(m2); return m2;
    };
    strip(R.w + 3.2, 0.14, new THREE.MeshLambertMaterial({ color: 0xdbc58f, side: THREE.DoubleSide }), 0, 0);
    strip(R.w, 0.17, this.waterMat, 1, 1);
    const hw = this.hw;
    // bridges where the river meets a road
    const deckMat = M('#c4b393'), rail = M('#8d7b5a');
    const bridge = (x0, x1, z0, z1, alongX) => {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), deckMat); deck.position.set((x0 + x1) / 2, 0.22, (z0 + z1) / 2); this.add(deck);
      for (const sd of [0, 1]) { const rl = alongX ? new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.9, 0.25), rail) : new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, z1 - z0), rail); rl.position.set(alongX ? (x0 + x1) / 2 : (sd ? x1 - 0.12 : x0 + 0.12), 0.8, alongX ? (sd ? z1 - 0.12 : z0 + 0.12) : (z0 + z1) / 2); this.add(rl); }
      this.platforms.push({ shape: 'rect', x0, x1, z0, z1, y: 0.37, bridge: true });
    };
    const ext = R.w / 2 + 5.5;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      for (const l of this.rz) if ((a.z < l && b.z >= l) || (a.z > l && b.z <= l)) { const t = (l - a.z) / (b.z - a.z), xc = a.x + (b.x - a.x) * t; bridge(xc - ext, xc + ext, l - hw - 0.4, l + hw + 0.4, true); }
      for (const l of this.rx) if ((a.x < l && b.x >= l) || (a.x > l && b.x <= l)) { const t = (l - a.x) / (b.x - a.x), zc = a.z + (b.z - a.z) * t; bridge(l - hw - 0.4, l + hw + 0.4, zc - ext, zc + ext, false); }
    }
    // the water itself blocks movement except along the road bridges
    let acc = 0;
    for (let i = 1; i < P.length; i++) {
      acc += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); if (acc < 2.2) continue; acc = 0;
      const x = P[i].x, z = P[i].z;
      if (this.rz.some(l => Math.abs(z - l) < hw + 2) || this.rx.some(l => Math.abs(x - l) < hw + 2)) continue;
      this.box(x - 2.7, x + 2.7, z - 2.7, z + 2.7, 0.3, { water: 1 });
    }
    // riverside palms
    for (let i = 8; i < P.length; i += 9) { const x = P[i].x + (this.rnd() < 0.5 ? 1 : -1) * (R.w / 2 + 2.2), z = P[i].z; if (!this.rz.some(l => Math.abs(z - l) < hw + 4)) this.addPalm(x, z); }
  }

  buildMarketLot(lx, lz, w, d) {
    const rnd = this.rnd;
    const cols = ['#e63946', '#ffb703', '#2a9d8f', '#8338ec', '#fb5607', '#3a86ff'];
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), M('#f1dfb8')); floor.position.set(lx, 0.15, lz); this.add(floor);
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
      const sx = lx - w / 2 + 2.2 + k * 3.7, sz = lz - d / 2 + 2.2 + r * 6.3;
      const c = cols[Math.floor(rnd() * cols.length)];
      const g = new THREE.Group(); g.position.set(sx, 0.12, sz);
      const tb = mesh(new THREE.BoxGeometry(3, 0.9, 1.6), '#a0632a'); tb.position.y = 0.45; g.add(tb);
      for (const [px, pz] of [[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.7], [1.4, 0.7]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), M('#444')); p.position.set(px, 1.2, pz); g.add(p); }
      const can = mesh(new THREE.BoxGeometry(3.4, 0.14, 2.2), c); can.position.y = 2.45; can.rotation.x = 0.12; g.add(can);
      const fruitCols = ['#ff7b00', '#ffd60a', '#e63946', '#70e000'];
      for (let f = 0; f < 6; f++) { const fr = new THREE.Mesh(new THREE.SphereGeometry(0.17, 6, 5), M(fruitCols[Math.floor(rnd() * 4)])); fr.position.set(-1.1 + f * 0.44, 1.02, (rnd() - 0.5) * 0.8); g.add(fr); }
      mergeGroup(g); this.add(g);
      this.box(sx - 1.6, sx + 1.6, sz - 0.9, sz + 0.9, 2.5, { nonav: false });
      this.hideSpots.push({ x: sx, z: sz, type: 'stall', r: 2.8, g, busy: 0 });
    }
    this.sign('පොල් — පළතුරු — හිනා!', 5, 1.2, '#ff7b00', lx, 3.4, lz + d / 2, 0);
  }

  buildPark(cx, cz) {
    const rnd = this.rnd;
    // path cross
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(30, 3), M('#e8d9a8')); p1.rotation.x = -Math.PI / 2; p1.position.set(cx, 0.14, cz); this.add(p1);
    const p2 = p1.clone(); p2.rotation.z = Math.PI / 2; p2.position.set(cx, 0.141, cz); this.add(p2);
    // pond & gazebo
    const pond = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.08, 20), M('#4cc9f0')); pond.position.set(cx + 6, 0.16, cz + 6); this.add(pond);
    this.box(cx + 2.8, cx + 9.2, cz + 2.8, cz + 9.2, 0.4, { low: 1 });
    for (let i = 0; i < 12; i++) { // trees
      const x = cx + (rnd() - 0.5) * 26, z = cz + (rnd() - 0.5) * 26;
      if (Math.abs(x - cx) < 2.5 || Math.abs(z - cz) < 2.5 || this.onRiver(x, z, 3)) continue;
      this.addTree(x, z, 0.8 + rnd() * 0.6);
    }
    for (let i = 0; i < 7; i++) {
      const x = cx + (rnd() - 0.5) * 24, z = cz + (rnd() - 0.5) * 24;
      if (Math.abs(x - cx) < 2 || Math.abs(z - cz) < 2 || this.onRiver(x, z, 3)) continue;
      this.addBush(x, z, 0.9 + rnd() * 0.5);
    }
    for (const [bx, bz] of [[-4.5, 2.5], [4.5, -2.5], [-2.5, -4.5]]) { // benches
      const bn = mesh(new THREE.BoxGeometry(2, 0.5, 0.6), '#8b5a2b'); bn.position.set(cx + bx, 0.4, cz + bz); this.add(bn);
      this.box(cx + bx - 1, cx + bx + 1, cz + bz - 0.3, cz + bz + 0.3, 0.6);
    }
    this.sign('කොළඹ හරිත උද්‍යානය', 7, 1.4, '#2b8a3e', cx, 5.2, cz - 14.8, 0);
  }

  buildDepot(cx, cz) {
    const rnd = this.rnd;
    const cols = ['#d62828', '#f77f00', '#1d3557'];
    for (let k = 0; k < 4; k++) {
      const bx = cx - 10 + k * 6.6, bz = cz + 8 + (k % 2) * 1.5;
      if (k === 1) continue; // leave a lane around Kassa's spawn
      const g = this.busModel(cols[k % 3], 'දුම්රිය ස්ථානය'); g.position.set(bx, 0.12, bz); g.rotation.y = 0; this.add(g);
      this.box(bx - 1.4, bx + 1.4, bz - 4.4, bz + 4.4, 3);
      this.hideSpots.push({ x: bx, z: bz, type: 'bus', r: 5.4, g: null, busy: 0 });
    }
    const shelter = mesh(new THREE.BoxGeometry(8, 0.2, 3), '#3a7bd5'); shelter.position.set(cx + 8.5, 3, cz - 12); this.add(shelter);
    for (const sx of [-3.8, 3.8]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), M('#555')); p.position.set(cx + 8.5 + sx, 1.6, cz - 12); this.add(p); }
    this.sign('බස් නැවතුම්පළ — කොළඹ', 8, 1.5, '#1d3557', cx + 8.5, 4.2, cz - 12, 0);
    for (const k of [0, 2]) this.addDumpster(cx - 11 + k * 11, cz - 13.5, 0);
    this.addTuk(cx + 11, cz - 6, Math.PI / 2, '#ffd23f');
    this.addTuk(cx - 12, cz - 3, 0, '#2ec4b6');
  }

  buildHotel() {
    const m = this.map, h = m.hotel, L = h.lobby, rnd = this.rnd;
    this.hotel = h;
    const wallH = 5.5;
    // lobby floor (marble)
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#f6efe0' : '#d9c9a8'; x.fillRect(i * 32, j * 32, 32, 32); }
    const ft = new THREE.CanvasTexture(c); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(10, 3.5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L.x1 - L.x0, L.z1 - L.z0), new THREE.MeshLambertMaterial({ map: ft }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.14, (L.z0 + L.z1) / 2); this.add(floor);
    // wings (windows)
    const gold = M('#d4af37');
    for (const [x0, z0, x1, z1] of h.wings) {
      const hh = 14, w = x1 - x0, d = z1 - z0;
      const b = this.winBox(w, hh, d, 5, gold); b.position.set((x0 + x1) / 2, hh / 2 + 0.12, (z0 + z1) / 2); this.add(b);
      this.box(x0, x1, z0, z1, hh);
    }
    // back + front walls
    this.box(L.x0, L.x1, L.z0 - 7, L.z0, 8);
    const back = new THREE.Mesh(new THREE.BoxGeometry(40, wallH, 7), M('#f3e5c0')); back.position.set(0, wallH / 2, L.z0 - 3.5); this.add(back);
    const fz = h.frontZ;
    const ZO = h.door[1] + 50.5;   // interior was laid out for the old hotel position at z = -50.5
    this.box(L.x0, -6, fz - 1, fz, 8); this.box(6, L.x1, fz - 1, fz, 8);   // 12-unit entrance in the middle
    for (const [a, b] of [[L.x0, -6], [6, L.x1]]) { const w = new THREE.Mesh(new THREE.BoxGeometry(b - a, wallH, 1), M('#f3e5c0')); w.position.set((a + b) / 2, wallH / 2 + 0.12, fz - 0.5); this.add(w); const win = new THREE.Mesh(new THREE.PlaneGeometry(b - a - 2, 2.4), new THREE.MeshBasicMaterial({ color: 0x9fdcff })); win.position.set((a + b) / 2, 2.8, fz + 0.02); this.add(win); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(12.2, 1.2, 1), M('#f3e5c0')); lintel.position.set(0, wallH - 0.6, fz - 0.5); this.add(lintel);
    const gate = new THREE.Group(); gate.position.set(0, 0.12, fz + 0.25);
    for (let i = 0; i < 8; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.6, 0.12), M('#c0262d')); bar.position.set(-2.7 + i * 0.77, 1.8, 0); gate.add(bar); }
    for (const yy of [0.8, 3.2]) { const rl = new THREE.Mesh(new THREE.BoxGeometry(6, 0.14, 0.14), M('#8a1c21')); rl.position.set(0, yy, 0); gate.add(rl); }
    const lockS = makeSprite('🔒 පාස් නැතිව බෑ!', { size: 48, color: '#fff', bg: 'rgba(192,38,45,.92)', pad: 10, scale: 0.008 }); lockS.position.set(0, 4.3, 0); gate.add(lockS);
    this.add(gate); this.gateGroup = gate;
    // tower
    const tower = this.winBox(40, 34, 20, 5, gold); tower.position.set(0, wallH + 17, ZO - 62); this.add(tower);
    // ceiling slab over lobby
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(40, 0.4, 15), M('#fff4d6')); ceil.position.set(0, wallH + 0.2, (L.z0 + L.z1) / 2 + 0.5); this.add(ceil);
    // sign
    this.sign('ලක්ෂ්‍රි හෝටලය', 18, 3.2, '#b8860b', 0, 9.2, fz + 0.3, 0);
    const stars = makeSprite('★ ★ ★ ★ ★  LUXURY HOTEL', { size: 56, color: '#ffe680', shadow: '#5a3b00', pad: 6, scale: 0.02, depthTest: true });
    stars.position.set(0, 12, fz + 0.5); this.add(stars);
    // roof beacon so the hotel is visible from everywhere
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 6, 90, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.25, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    beam.position.set(0, 34 + wallH + 45, ZO - 62); this.add(beam); this.beacon = beam;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffd23f, fog: false })); ring.position.set(0, wallH + 36, ZO - 62); ring.rotation.x = Math.PI / 2; this.add(ring); this.beaconRing = ring;
    // red carpet, columns, fountain, palms
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(6, 11), new THREE.MeshLambertMaterial({ color: 0xb3123a })); carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.145, ZO - 45.5); this.add(carpet);
    const carpet2 = carpet.clone(); carpet2.scale.y = 0.6; carpet2.position.set(0, 0.146, ZO - 56); this.add(carpet2);
    for (const sx of [-4.5, 4.5]) { const col = mesh(new THREE.CylinderGeometry(0.6, 0.7, 5.5, 10), '#fff4d6'); col.position.set(sx, 2.8, fz + 1.2); this.add(col); this.box(sx - 0.6, sx + 0.6, fz + 0.6, fz + 1.8, 5.5); }
    for (const sx of [-22, 22]) { this.addPalm(sx, ZO - 47.5); }
    for (const sx of [-10, 10]) { const fo = mesh(new THREE.CylinderGeometry(2, 2.2, 0.8, 14), '#9ee7ff'); fo.position.set(sx, 0.5, ZO - 46.8); this.add(fo); this.box(sx - 2, sx + 2, ZO - 48.8, ZO - 44.8, 0.9, { low: 1 }); }
    // lobby furniture: desk, pillars, plants, sofas
    const desk = mesh(new THREE.BoxGeometry(12, 1.1, 1.6), '#7b4a22'); desk.position.set(0, 0.7, ZO - 61.3); this.add(desk); this.box(-6, 6, ZO - 62.1, ZO - 60.5, 1.1, { desk: 1 });
    const bell = mesh(new THREE.SphereGeometry(0.2, 8, 6), '#ffd700', false); bell.position.set(0, 1.4, ZO - 61.3); this.add(bell);
    for (const [px, pz] of [[-9, ZO - 54], [9, ZO - 54], [-9, ZO - 59], [9, ZO - 59]]) { const pl = mesh(new THREE.CylinderGeometry(0.7, 0.8, wallH, 10), '#fff4d6'); pl.position.set(px, wallH / 2, pz); this.add(pl); this.box(px - 0.7, px + 0.7, pz - 0.7, pz + 0.7, wallH); }
    for (const sx of [-16, 16]) { const so = mesh(new THREE.BoxGeometry(3.4, 0.9, 1.4), '#b3123a'); so.position.set(sx, 0.55, ZO - 55); this.add(so); this.box(sx - 1.7, sx + 1.7, ZO - 55.7, ZO - 54.3, 0.9); }
    for (const [px, pz] of [[-18.3, ZO - 52.3], [18.3, ZO - 52.3], [-18.3, ZO - 63.5], [18.3, ZO - 63.5]]) {
      const pot = mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.7, 8), '#a0522d'); pot.position.set(px, 0.5, pz); this.add(pot);
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), M('#2f9e44')); lf.position.set(px, 1.5, pz); this.add(lf); this.box(px - 0.5, px + 0.5, pz - 0.5, pz + 0.5, 2);
    }
    // closets
    this.closetMarks = [];
    h.closets.forEach(([cx, cz], i) => {
      const g = new THREE.Group(); g.position.set(cx, 0.12, cz + 0.5);
      const cab = mesh(new THREE.BoxGeometry(3, 2.6, 1.2), '#6b3e1e'); cab.position.y = 1.3; g.add(cab);
      const dr = mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), '#8d5524', false); dr.position.set(-0.7, 1.3, 0.62); g.add(dr);
      const dr2 = dr.clone(); dr2.position.x = 0.7; g.add(dr2);
      const kn = mesh(new THREE.SphereGeometry(0.07, 6, 5), '#ffd700', false); kn.position.set(-0.15, 1.2, 0.7); g.add(kn);
      this.add(g); this.closetMarks.push(g);
    });
    this.box(-20, 20, h.closets[0][1] - 0.2 + 0.7, h.closets[0][1] + 1.5, 0.1, { off: true });
    // watchers' posts and guard post positions
    this.watchers = []; this.guardPos = h.guard;
  }

  setClosetActive(idx) {
    this.activeCloset = idx;
    const [cx, cz] = this.hotel.closets[idx];
    if (this.closetGlow) this.group.remove(this.closetGlow);
    const g = new THREE.Group();
    const r = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 24), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    r.rotation.x = -Math.PI / 2; r.position.set(cx, 0.2, cz - 0.1); g.add(r);
    const lab = makeSprite('හැංගෙන්න! 🔑', { size: 44, color: '#fff', bg: 'rgba(179,18,58,.85)', pad: 10, scale: 0.008 }); lab.position.set(cx, 3.6, cz + 0.4); g.add(lab);
    this.closetGlow = g; this.add(g);
    this.closetRing = r;
    // hide pos: inside the closet
    this.hotelSpot = { x: cx, z: cz + 0.2, type: 'closet', r: 3.2, closet: true, busy: 0, g: this.closetMarks[idx] };
  }

  instLamps() {
    this.lampPts = this.lampPts.filter(([x, z]) => this.free(x, z, 0.25));
    const pole = new THREE.CylinderGeometry(0.1, 0.14, 5, 6), head = new THREE.SphereGeometry(0.4, 8, 6);
    const dusk = this.mods.includes('dusk');
    const poleI = new THREE.InstancedMesh(pole, M('#444a55'), this.lampPts.length), headI = new THREE.InstancedMesh(head, new THREE.MeshBasicMaterial({ color: dusk ? 0xfff2a0 : 0xfff6c8 }), this.lampPts.length);
    const mt = new THREE.Matrix4();
    this.lampPts.forEach(([x, z], i) => { mt.makeTranslation(x, 2.6, z); poleI.setMatrixAt(i, mt); mt.makeTranslation(x, 5.1, z); headI.setMatrixAt(i, mt); });
    this.add(poleI); this.add(headI);
    if (this.night || dusk) {
      const glow = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: this.night ? 0.28 : 0.16, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), this.lampPts.length);
      this.lampPts.forEach(([x, z], i) => { mt.makeTranslation(x, 5.1, z); glow.setMatrixAt(i, mt); }); this.add(glow);
    }
    // trees
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6), can = new THREE.IcosahedronGeometry(1.6, 0);
    const tI = new THREE.InstancedMesh(trunk, M('#7a4b22'), this.treePts.length), cI = new THREE.InstancedMesh(can, M('#3fae49'), this.treePts.length), c2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.2, 0), M('#58c95b'), this.treePts.length);
    const sc = new THREE.Vector3(), q = new THREE.Quaternion(), pp = new THREE.Vector3();
    this.treePts.forEach(([x, z, s, y = 0], i) => {
      sc.set(s, s, s); pp.set(x, y + 1.1 * s + 0.1, z); mt.compose(pp, q, sc); tI.setMatrixAt(i, mt);
      pp.set(x, y + 3.3 * s, z); mt.compose(pp, q, sc); cI.setMatrixAt(i, mt);
      pp.set(x + 0.4 * s, y + 4.4 * s, z - 0.2 * s); mt.compose(pp, q, sc); c2.setMatrixAt(i, mt);
    });
    this.add(tI); this.add(cI); this.add(c2);
    // palms (coconut)
    if (this.palmPts.length) {
      const pt = new THREE.CylinderGeometry(0.2, 0.35, 7, 6), lf = new THREE.ConeGeometry(2.6, 1.0, 5);
      const pI = new THREE.InstancedMesh(pt, M('#9b6a3a'), this.palmPts.length), lI = new THREE.InstancedMesh(lf, M('#2fa84f'), this.palmPts.length);
      this.palmPts.forEach(([x, z], i) => { mt.makeTranslation(x, 3.6, z); pI.setMatrixAt(i, mt); mt.makeTranslation(x, 7.3, z); lI.setMatrixAt(i, mt); this.box(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 6); });
      this.add(pI); this.add(lI);
    }
  }

  busModel(col, dest = 'හෝටලය') {
    const g = new THREE.Group(), W = 2.5, body = P(col, 90);
    g.add(profMesh([[-4.3, 0.55], [-4.3, 2.9], [-4.1, 3.08], [3.6, 3.08], [4.05, 2.8], [4.3, 1.6], [4.3, 0.55]], W, body));
    g.add(profMesh([[-4.31, 0.95], [-4.31, 1.3], [4.31, 1.3], [4.31, 0.95]], W + 0.05, P('#f4f4f4', 60), 0.01));          // white waist stripe
    g.add(profMesh([[-4.05, 1.75], [-4.05, 2.8], [3.55, 2.8], [3.85, 2.55], [3.85, 1.75]], W + 0.07, GLASS, 0.01));        // window band
    for (let x = -3.3; x <= 3.4; x += 1.45) boxAt(g, W + 0.1, 1.1, 0.14, body, 0, 2.27, x);                               // window pillars
    boxAt(g, W - 0.5, 0.14, 5.6, P('#e9ecef', 40), 0, 3.15, -0.4);                                                         // roof panel
    for (const z of [-2.2, 0.4, 2.6]) boxAt(g, 0.5, 0.12, 0.5, DARK, 0, 3.26, z);                                          // roof vents
    const ws = boxAt(g, W - 0.25, 1.15, 0.06, GLASS, 0, 2.2, 4.19); ws.rotation.x = -0.14;                                  // windscreen
    boxAt(g, W + 0.14, 0.3, 0.2, DARK, 0, 0.62, 4.33); boxAt(g, W + 0.14, 0.3, 0.2, DARK, 0, 0.62, -4.33);                 // bumpers
    boxAt(g, 1.2, 0.5, 0.05, DARK, 0, 1.0, 4.34); boxAt(g, 0.5, 0.16, 0.04, P('#f4f4f4', 30), 0, 0.82, -4.36);            // grille + rear plate
    for (const sd of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 10), LAMP); hl.rotation.x = Math.PI / 2; hl.position.set(sd * 0.9, 1.0, 4.32); g.add(hl);
      boxAt(g, 0.22, 0.12, 0.06, AMBER, sd * 1.13, 0.78, 4.33); boxAt(g, 0.3, 0.16, 0.06, TAIL, sd * 0.95, 1.1, -4.34);
      boxAt(g, 0.05, 0.6, 0.35, DARK, sd * 1.5, 2.0, 3.85); boxAt(g, 0.28, 0.5, 0.05, GLASS, sd * 1.64, 2.0, 3.85);     // mirrors
    }
    boxAt(g, 0.06, 1.55, 0.9, GLASS, 1.29, 1.75, 2.9);                                                                      // door
    const f = this.signMesh(dest, 2.0, 0.5, '#111', 3.0); f.position.set(0, 2.95, 4.1); g.add(f);
    const bk = this.signMesh('කඩිනම්!', 2.0, 0.5, '#111', 3.0); bk.position.set(0, 2.9, -4.35); bk.rotation.y = Math.PI; g.add(bk);
    for (const sd of [-1, 1]) { wheelAt(g, sd * 1.12, 0.52, 2.75, 0.52, 0.34); wheelAt(g, sd * 1.12, 0.52, -2.6, 0.52, 0.34); boxAt(g, 0.1, 0.5, 1.3, DARK, sd * 1.26, 0.9, 2.75); boxAt(g, 0.1, 0.5, 1.3, DARK, sd * 1.26, 0.9, -2.6); }
    if (this.night) this.addHeadlights(g, 4.4, 2.5, 1.0);
    return mergeGroup(g);
  }
  addHeadlights(g, zf, wd, y) {
    for (const sd of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 5), new THREE.MeshBasicMaterial({ color: 0xfff2b0 })); l.position.set(sd * wd * 0.32, y, zf); g.add(l); }
    if (!this._glowMat) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,240,170,.9)'); gr.addColorStop(1, 'rgba(255,240,170,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); this._glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }); }
    const sp = new THREE.Sprite(this._glowMat); sp.scale.set(4.5, 4.5, 1); sp.position.set(0, y, zf + 1.6); g.add(sp);
  }
  signMesh(text, w, h, bg) {
    const t = textTexture(text, { size: 48, color: '#ffe14d', bg, round: 6, pad: 12 });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t.tex }));
  }
  tukModel(col) {
    const g = new THREE.Group(), body = P(col, 90);
    g.add(profMesh([[1.25, 0.5], [1.2, 0.95], [0.85, 1.12], [0.55, 1.18], [-1.28, 1.05], [-1.3, 0.5], [-0.9, 0.38], [0.95, 0.38]], 1.3, body, 0.06));
    boxAt(g, 1.36, 0.08, 1.95, P('#1c1f26', 40), 0, 1.78, -0.2);                                                            // canopy roof
    for (const [x, z] of [[-0.62, 0.5], [0.62, 0.5], [-0.62, -1.15], [0.62, -1.15]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 5), DARK); p.position.set(x, 1.47, z); g.add(p); }
    const ws = boxAt(g, 1.25, 0.6, 0.04, GLASS, 0, 1.45, 0.62); ws.rotation.x = -0.45;                                       // windscreen
    boxAt(g, 1.25, 0.42, 0.05, P(col, 60), 0, 1.3, -1.28);                                                                   // rear panel
    boxAt(g, 1.0, 0.16, 0.5, DARK, 0, 0.7, -0.75); boxAt(g, 1.0, 0.45, 0.1, DARK, 0, 1.0, -1.0);                           // rear seat
    boxAt(g, 0.42, 0.16, 0.42, DARK, 0, 0.7, 0.05);                                                                          // driver seat
    boxAt(g, 0.7, 0.05, 0.05, P('#d8dde3', 100), 0, 1.18, 0.78);                                                             // handlebar
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), LAMP); hl.position.set(0, 0.95, 1.27); g.add(hl);
    boxAt(g, 0.18, 0.08, 0.05, TAIL, -0.5, 0.95, -1.31); boxAt(g, 0.18, 0.08, 0.05, TAIL, 0.5, 0.95, -1.31);
    wheelAt(g, 0, 0.27, 1.05, 0.27, 0.14); wheelAt(g, -0.6, 0.27, -0.7, 0.27, 0.16); wheelAt(g, 0.6, 0.27, -0.7, 0.27, 0.16);
    boxAt(g, 0.34, 0.05, 0.55, body, 0, 0.58, 1.05);                                                                         // front mudguard
    figureAt(g, 0, 0.7, 0.05, '#6b7d4f', '#b97a50');                                                                         // the driver
    if (this.night) this.addHeadlights(g, 1.3, 1.3, 0.95);
    return mergeGroup(g);
  }
  carModel(col) {
    const g = new THREE.Group(), body = P(col, 100), W = 1.85;
    g.add(profMesh([[-2.05, 0.38], [-2.05, 0.8], [-1.75, 0.9], [-1.25, 0.95], [-0.85, 1.45], [0.35, 1.5], [0.95, 1.0], [1.75, 0.88], [2.05, 0.72], [2.05, 0.38], [1.6, 0.3], [-1.6, 0.3]], W, body, 0.05));
    g.add(profMesh([[-0.78, 0.98], [-0.64, 1.4], [0.3, 1.43], [0.84, 1.02]], W + 0.04, GLASS, 0.01));                         // side glass
    const wsF = boxAt(g, W - 0.18, 0.5, 0.04, GLASS, 0, 1.2, 0.9); wsF.rotation.x = 0.88;                                    // windscreen
    const wsR = boxAt(g, W - 0.2, 0.42, 0.04, GLASS, 0, 1.2, -0.84); wsR.rotation.x = -0.95;                                 // rear glass
    boxAt(g, W + 0.04, 0.14, 0.12, DARK, 0, 0.42, 2.06); boxAt(g, W + 0.04, 0.14, 0.12, DARK, 0, 0.42, -2.06);              // bumpers
    boxAt(g, 0.8, 0.14, 0.04, DARK, 0, 0.62, 2.07); boxAt(g, 0.42, 0.12, 0.03, P('#f4f4f4', 30), 0, 0.62, -2.08);          // grille + plate
    for (const sd of [-1, 1]) {
      boxAt(g, 0.3, 0.13, 0.06, LAMP, sd * 0.62, 0.74, 2.06); boxAt(g, 0.3, 0.12, 0.06, TAIL, sd * 0.66, 0.78, -2.06);
      boxAt(g, 0.12, 0.1, 0.16, DARK, sd * 1.0, 1.0, 0.55);                                                                  // mirrors
      wheelAt(g, sd * 0.88, 0.34, 1.25, 0.34, 0.24); wheelAt(g, sd * 0.88, 0.34, -1.25, 0.34, 0.24);
    }
    boxAt(g, 1.0, 0.03, 1.4, P(col, 60), 0, 1.51, -0.2);
    if (this.night) this.addHeadlights(g, 2.1, 1.9, 0.75);
    return mergeGroup(g);
  }

  buildStreetProps() {
    const rnd = this.rnd, hw = this.hw;
    // parked tuk-tuks & dumpsters along kerbs; bus stops
    const cols = ['#ffd23f', '#ef476f', '#2ec4b6', '#ff9f1c', '#8ecae6'];
    let n = 0;
    for (const horiz of [true, false]) for (const l of (horiz ? this.rz : this.rx)) {
      const [a0, a1] = this.span(horiz, l);
      for (let k = 0; k < 6; k++) {
        const v = a0 + 8 + rnd() * (a1 - a0 - 16), sd = rnd() < 0.5 ? -1 : 1;
        if ((horiz ? this.rx : this.rz).some(r => Math.abs(v - r) < 9)) continue;
        if (horiz && l === -40 && Math.abs(v) < 38) continue;
        if (this.onDiag(horiz ? v : l, horiz ? l : v, 3) || this.onRiver(horiz ? v : l, horiz ? l : v, 8)) continue;
        if (horiz) this.addTuk(v, l + sd * (hw - 0.35), Math.PI / 2, cols[n++ % cols.length]); else this.addTuk(l + sd * (hw - 0.35), v, 0, cols[n++ % cols.length]);
      }
    }
    // more kinds of hiding places along the kerbs
    const spotAt = (count, fn) => {
      for (let i = 0; i < count; i++) {
        const horiz = rnd() < 0.5, l = (horiz ? this.rz : this.rx)[Math.floor(rnd() * 5)], [a0, a1] = this.span(horiz, l), v = a0 + 8 + rnd() * (a1 - a0 - 16), sd = rnd() < 0.5 ? -1 : 1;
        if ((horiz ? this.rx : this.rz).some(r => Math.abs(v - r) < 9)) continue;
        const x = horiz ? v : l + sd * (hw - 0.3), z = horiz ? l + sd * (hw - 0.3) : v;
        if (this.onDiag(x, z, 3) || this.onRiver(x, z, 8) || (z < -42 && Math.abs(x) < 38)) continue;
        fn(x, z, horiz);
      }
    };
    spotAt(18, (x, z) => this.addBarrels(x, z));
    spotAt(12, (x, z, h) => this.addCart(x, z, h ? 0 : Math.PI / 2));
    spotAt(10, (x, z) => this.addBooth(x, z));
    spotAt(16, (x, z) => this.addManhole(x, z));
    spotAt(14, (x, z, h) => this.addCarPark(x, z, h ? Math.PI / 2 : 0, ['#4361ee', '#f72585', '#fb8500', '#adb5bd', '#06d6a0'][Math.floor(rnd() * 5)]));
    // bus stops
    for (const [x, z, ry] of [[-34.5, -22, 0], [34.5, 22, 0], [-6, 36, Math.PI / 2], [74.5, 62, 0], [-74.5, 102, 0], [34.5, 142, 0], [-34.5, 62, 0], [74.5, -22, 0], [-6, 116, Math.PI / 2]]) {
      const g = new THREE.Group(); g.position.set(x, 0.12, z); g.rotation.y = ry;
      const roof = mesh(new THREE.BoxGeometry(1.6, 0.12, 4), '#3a7bd5'); roof.position.y = 2.4; g.add(roof);
      const back = mesh(new THREE.BoxGeometry(0.1, 2.2, 4), '#b8e1ff'); back.position.set(0.7, 1.2, 0); g.add(back);
      mergeGroup(g); this.add(g);
      const c = Math.abs(Math.sin(ry)) > 0.5 ? [2, 0.8] : [0.8, 2];
      this.box(x - c[0], x + c[0], z - c[1], z + c[1], 2.4);
      this.hideSpots.push({ x, z, type: 'shelter', r: 2.8, g, busy: 0 });
    }
    // sidewalk palms + sea promenade rail
    for (let i = 0; i < 26; i++) {
      const horiz = rnd() < 0.5, l = (horiz ? this.rz : this.rx)[Math.floor(rnd() * 5)], [a0, a1] = this.span(horiz, l), v = a0 + 6 + rnd() * (a1 - a0 - 12), sd = rnd() < 0.5 ? -1 : 1;
      if ((horiz ? this.rx : this.rz).some(r => Math.abs(v - r) < 8)) continue;
      const x = horiz ? v : l + sd * (hw + 0.5), z = horiz ? l + sd * (hw + 0.5) : v;
      if (z < -44 && Math.abs(x) < 36) continue;
      this.addPalm(x, z);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, this.bx.z1 - this.bx.z0), M('#e8e8e8')); rail.position.set(this.bx.x0 + 0.5, 0.6, (this.bx.z0 + this.bx.z1) / 2); this.add(rail);
    this.hideSpots.forEach((h, i) => h.id = i);
  }

  buildTraffic() {
    const rnd = this.rnd, bb = this.bx;
    const busCols = ['#d62828', '#f77f00', '#1d3557', '#2a9d8f'], tukCols = ['#ffd23f', '#ef476f', '#2ec4b6'], carCols = ['#4361ee', '#f72585', '#fb8500', '#adb5bd', '#06d6a0'];
    const per = this.rush ? 4 : 2, SP = 7.0;
    const lanes = [];
    for (const horiz of [true, false]) for (const l of (horiz ? this.rz : this.rx)) for (const dir of [1, -1]) {
      const lane = horiz ? l + (dir === 1 ? -2.5 : 2.5) : l + (dir === 1 ? 2.5 : -2.5);   // left-hand traffic
      const a0 = horiz ? bb.x0 + 1 : bb.z0 + 1, a1 = horiz ? bb.x1 - 1 : bb.z1 - 1;   // lanes stay inside the map edge
      lanes.push({ horiz, l, dir, lane, a0, L: a1 - a0, n: per + (rnd() < 0.4 ? 1 : 0) });
    }
    const placed = []; let id = 0;
    for (const ln of lanes) for (let k = 0; k < ln.n; k++) {
      const r = rnd(), type = r < 0.25 ? 'bus' : r < 0.65 ? 'tuk' : 'car';
      const len = type === 'bus' ? 8.6 : type === 'tuk' ? 2.6 : 4, wid = type === 'bus' ? 2.6 : type === 'tuk' ? 1.5 : 1.9;
      let cand = null;
      for (let tries = 0; tries < 30 && !cand; tries++) {
        const c = { horiz: ln.horiz, dir: ln.dir, lane: ln.lane, a0: ln.a0, L: ln.L, sp: SP, len, wid, road: ln.l, s0: rnd() * ln.L };
        let ok = true;
        for (const o of placed) {
          if (o.horiz === c.horiz && o.road === c.road && o.dir === c.dir) { let d = Math.abs(o.s0 - c.s0) % ln.L; d = Math.min(d, ln.L - d); if (d < (o.len + len) / 2 + 7) { ok = false; break; } }
          else if (o.horiz !== c.horiz) {
            const hxA = c.horiz ? len : wid, hzA = c.horiz ? wid : len, hxB = o.horiz ? o.len : o.wid, hzB = o.horiz ? o.wid : o.len;
            for (let t = 0; t < 240; t += 0.5) {
              const A = this.vehPos(c, t), B = this.vehPos(o, t);
              if (Math.abs(A[0] - B[0]) < (hxA + hxB) / 2 + 0.9 && Math.abs(A[1] - B[1]) < (hzA + hzB) / 2 + 0.9) { ok = false; break; }
            }
            if (!ok) break;
          }
        }
        if (ok) cand = c;
      }
      if (!cand) continue;
      const model = type === 'bus' ? this.busModel(busCols[Math.floor(rnd() * 4)], rnd() < 0.5 ? 'හෝටලය' : 'කොළඹ — ගාල්ල') : type === 'tuk' ? this.tukModel(tukCols[Math.floor(rnd() * 3)]) : this.carModel(carCols[Math.floor(rnd() * 5)]);
      this.add(model);
      Object.assign(cand, { id: id++, type, model, hidden: false, x: 0, z: 0, honk: 0 });
      this.vehicles.push(cand); placed.push(cand);
    }
  }
  vehPos(v, t) {
    const s = ((v.s0 + v.sp * t) % v.L + v.L) % v.L;
    const a = v.dir === 1 ? v.a0 + s : v.a0 + v.L - s;
    return v.horiz ? [a, v.lane] : [v.lane, a];
  }
  updateTraffic(t) {
    for (const v of this.vehicles) {
      const [x, z] = this.vehPos(v, t);
      v.x = x; v.z = z;
      v.model.position.set(x, this.platforms.length ? this.bridgeY(x, z) : 0, z);
      v.model.rotation.y = v.horiz ? (v.dir === 1 ? Math.PI / 2 : -Math.PI / 2) : (v.dir === 1 ? 0 : Math.PI);
      const fo = this.focus; v.model.visible = !v.hidden && (!fo || Math.abs(x - fo.x) + Math.abs(z - fo.z) < 190);
    }
  }
  // returns vehicle hit by circle at (x,z)
  vehicleHit(x, z, r) {
    for (const v of this.vehicles) {
      if (v.hidden) continue;
      const hx = (v.horiz ? v.len : v.wid) / 2 + r, hz = (v.horiz ? v.wid : v.len) / 2 + r;
      if (Math.abs(x - v.x) < hx && Math.abs(z - v.z) < hz) return v;
    }
    return null;
  }

  buildPeds() {
    const rnd = this.rnd, hw = this.hw;
    const n = Math.round((this.mods.includes('festival') ? 30 : 20) * (this.q < 1 ? 0.6 : 1));
    for (let i = 0; i < n; i++) {
      const ch = makeChar('ped', { r: rnd }); this.add(ch.root);
      const horiz = rnd() < 0.5, l = (horiz ? this.rz : this.rx)[Math.floor(rnd() * 5)], sd = rnd() < 0.5 ? -1 : 1;
      const [r0, r1] = this.span(horiz, l), a = r0 + 10 + rnd() * (r1 - r0 - 70), b = a + 40 + rnd() * 40;
      const off = hw + 0.45;
      this.peds.push({ ch, horiz, line: l + sd * off, a, b, t0: rnd() * 100, sp: 1.6 + rnd() * 1.2, circ: { x: 0, z: 0, r: 0.38 }, pause: 0 });
      this.dyn.push(this.peds[this.peds.length - 1].circ);
    }
    // vendors standing at stalls
    this.vendors = [];
  }
  updatePeds(t) {
    const foc = this.focus || { x: 0, z: 0 };
    for (const p of this.peds) {
      const span = p.b - p.a, per = span / p.sp, k = ((t + p.t0) % (per * 2)) / per;
      const f = k < 1 ? k : 2 - k, s = p.a + f * span, dirn = k < 1 ? 1 : -1;
      const x = p.horiz ? s : p.line, z = p.horiz ? p.line : s;
      p.ch.root.position.set(x, this.groundY(x, z), z);
      p.ch.root.rotation.y = p.horiz ? (dirn > 0 ? Math.PI / 2 : -Math.PI / 2) : (dirn > 0 ? 0 : Math.PI);
      p.circ.x = x; p.circ.z = z;
      const far = Math.hypot(x - foc.x, z - foc.z) > 75;
      p.ch.root.visible = !far;
      if (!far) { p.ch.setAnim('walk'); p.ch.speed = 1; p.ch.update(this._dt || 0.016); }
      // skip animating far peds for performance
    }
  }

  buildPickups() {
    const rnd = this.rnd, hw = this.hw;
    const types = [{ k: 'banana', e: '🍌', name: 'කෙසෙල් ලෙල්ල' }, { k: 'vada', e: '🍩', name: 'වඩේ ශක්තිය' }, { k: 'coconut', e: '🥥', name: 'පොල් ගෙඩිය' }, { k: 'smoke', e: '💨', name: 'දුම් බෝම්බය' }, { k: 'decoy', e: '🎭', name: 'ඩමි කස්සා' }, { k: 'lucky', e: '⭐', name: 'වාසනාව' }, { k: 'heal', e: '❤️', name: 'ජීවිතය' }];
    const cand = [], bb = this.bx;
    for (const l of this.rz) for (let v = bb.x0 + 5; v <= bb.x1 - 5; v += 10) { if (this.rx.some(r => Math.abs(v - r) < 8)) continue; cand.push([v, l + hw + 0.5]); }
    for (const l of this.rx) for (let v = bb.z0 + 5; v <= bb.z1 - 5; v += 10) { if (this.rz.some(r => Math.abs(v - r) < 8)) continue; cand.push([l - hw - 0.5, v]); }
    for (const g of this.gates) cand.push([g.x + 0, g.z + 0]); // reward for finding shortcuts
    const ks = this.map.kassaSpawn;
    const picked = new Set();
    this.pickups = [];
    for (let i = 0; i < 40 && cand.length; i++) {
      const idx = Math.floor(rnd() * cand.length); if (picked.has(idx)) continue; picked.add(idx);
      const [x, z] = cand[idx]; if (z < -45 || Math.hypot(x - ks[0], z - ks[1]) < 25 || !this.free(x, z, 0.8)) continue;
      const ty = types[i % types.length], sp = makeSprite(ty.e, { size: 90, color: '#fff', pad: 6, scale: 0.011, depthTest: true });
      sp.position.set(x, 1.5, z); this.add(sp);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.2, z); this.add(ring);
      this.pickups.push({ x, z, type: ty.k, name: ty.name, sp, ring, respawn: 0 });
    }
    this.updaters.push((t) => { for (const p of this.pickups) { p.sp.position.y = 1.4 + Math.sin(t * 3 + p.x) * 0.2; p.sp.visible = p.ring.visible = p.respawn <= 0; } });
  }

  buildBunting() {
    const cols = [0xff4d6d, 0xffd23f, 0x4cc9f0, 0x80ed99, 0xf72585];
    const geo = new THREE.ConeGeometry(0.4, 0.9, 3);
    const n = 500; const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n); const mt = new THREE.Matrix4(); let i = 0;
    const col = new THREE.Color();
    for (const l of this.rz) for (let v = this.bx.x0 + 5; v < this.bx.x1 - 5 && i < n; v += 3) { if (this.rx.some(r => Math.abs(v - r) < 6)) continue; mt.makeRotationZ(Math.PI); mt.setPosition(v, 6.5 + Math.sin(v) * 0.15, l - 4.4); im.setMatrixAt(i, mt); col.setHex(cols[i % 5]); im.setColorAt(i, col); i++; }
    im.count = i; this.add(im);
  }

  // ---------------- timed events (deterministic from seed) ----------------
  buildEvents() {
    const r = mulberry(this.seed ^ 0x51ed270b), segs = [], bb = this.bx;
    const mids = (arr, lo, hi) => { const a = [lo, ...arr.filter(v => v > lo && v < hi), hi]; const out = []; for (let k = 1; k < a.length; k++) if (a[k] - a[k - 1] > 20) out.push((a[k] + a[k - 1]) / 2); return out; };
    const ks = this.map.kassaSpawn;
    for (const l of this.rz) if (l !== -40) for (const v of mids(this.rx, bb.x0, bb.x1)) segs.push({ horiz: true, line: l, at: v });
    for (const l of this.rx) for (const v of mids(this.rz, l === 0 ? -45 : bb.z0, bb.z1)) segs.push({ horiz: false, line: l, at: v });
    const usable = segs.filter(s => Math.hypot(s.horiz ? s.at - ks[0] : s.line - ks[0], s.horiz ? s.line - ks[1] : s.at - ks[1]) > 22);
    const used = [];
    let t = 18 + r() * 8, kind = r() < 0.5 ? 'jam' : 'crowd';
    for (let i = 0; i < 22; i++) {
      let s; for (let k = 0; k < 20; k++) { s = usable[Math.floor(r() * usable.length)]; if (!used.slice(-3).includes(s)) break; }
      used.push(s);
      const dur = kind === 'jam' ? 40 : 28;
      this.events.push({ t, dur, kind, seg: s, on: false, id: i });
      t += 18 + r() * 14; kind = kind === 'jam' ? 'crowd' : 'jam';
    }
    // collider + visuals per event, created lazily
  }
  startEvent(e) {
    const s = e.seg, hw = this.hw;
    const x0 = s.horiz ? s.at - 1.6 : s.line - hw, x1 = s.horiz ? s.at + 1.6 : s.line + hw, z0 = s.horiz ? s.line - hw : s.at - 1.6, z1 = s.horiz ? s.line + hw : s.at + 1.6;
    e.col = this.box(x0, x1, z0, z1, 3, { event: 1 });
    e.vis = [];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (e.kind === 'jam') {
      const cols = ['#ffd23f', '#ef476f', '#2ec4b6', '#ff9f1c'];
      const bus = this.busModel('#f77f00', 'ජෑම් එකේ!'); const dir = s.horiz ? Math.PI / 2 : 0;
      for (let k = 0; k < 5; k++) {
        const m = k === 2 ? bus : (k % 2 ? this.tukModel(cols[k % 4]) : this.carModel(cols[k % 4]));
        const off = (k - 2) * 2.2, jit = (Math.random() - 0.5) * 1.5;
        m.position.set(s.horiz ? cx + jit : cx + off, 0, s.horiz ? cz + off : cz + jit); m.rotation.y = dir + (Math.random() - 0.5) * 0.4;
        this.add(m); e.vis.push(m);
      }
      for (const v of this.vehicles) if (v.road === s.line && v.horiz === s.horiz) v.hidden = v.hidden || (Math.abs((s.horiz ? v.x : v.z) - s.at) < 40);
    } else {
      e.crowd = [];
      const rr = mulberry(e.id * 77 + 5);
      for (let k = 0; k < 9; k++) {
        const ch = makeChar('ped', { r: rr }); this.add(ch.root); e.vis.push(ch.root);
        const a = (k - 4) * 1.15;
        const px = s.horiz ? cx + (rr() - 0.5) * 1.2 : s.line + a, pz = s.horiz ? s.line + a : cz + (rr() - 0.5) * 1.2;
        ch.root.position.set(px + (s.horiz ? 0 : 0), 0.0, pz); ch.root.rotation.y = rr() * TAU; ch.play('celebrate'); ch.once = null; ch.anim = 'celebrate';
        e.crowd.push(ch);
      }
    }
    e.on = true; this.onEvent && this.onEvent('start', e);
  }
  endEvent(e) {
    e.on = false; e.done = true;
    if (e.col) e.col.off = true;
    (e.vis || []).forEach(o => this.group.remove(o));
    if (e.kind === 'jam') for (const v of this.vehicles) if (v.road === e.seg.line && v.horiz === e.seg.horiz) v.hidden = false;
    this.onEvent && this.onEvent('end', e);
  }
  eventPos(e) { const s = e.seg; return s.horiz ? [s.at, s.line] : [s.line, s.at]; }

  update(t, dt) {
    this._dt = dt;
    this.updateTraffic(t);
    this.updatePeds(t);
    for (const e of this.events) {
      if (!e.done && !e.on && t >= e.t) this.startEvent(e);
      else if (e.on && t >= e.t + e.dur) this.endEvent(e);
      if (e.on && e.crowd) e.crowd.forEach(c => c.update(dt));
    }
    for (const u of this.updaters) u(t, dt);
    for (const p of this.pickups) if (p.respawn > 0) p.respawn -= dt;
  }
  // events currently blocking something (for AI navigation refresh)
  activeKey() { return this.events.filter(e => e.on).map(e => e.id).join(','); }
}
