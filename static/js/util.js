// Shared helpers: RNG, collision, line of sight, nav grid.
export const TAU = Math.PI * 2;
export function mulberry(seed) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + f() * (b - a);
  f.int = (a, b) => Math.floor(a + f() * (b - a + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
export function lerpAng(a, b, t) { return a + angDiff(a, b) * t; }

// Static AABB colliders {x0,x1,z0,z1,h}. Pushes circle (pos.x,pos.z,r) out. Returns true if touched.
export function collideCircle(pos, r, cols, extraCircles) {
  let hit = false;
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.off) continue;
      if (pos.x < c.x0 - r || pos.x > c.x1 + r || pos.z < c.z0 - r || pos.z > c.z1 + r) continue;
      const cx = clamp(pos.x, c.x0, c.x1), cz = clamp(pos.z, c.z0, c.z1);
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), p = (r - d) / d; pos.x += dx * p; pos.z += dz * p; }
        else {
          // centre inside the box: push along the shallowest axis
          const l = pos.x - c.x0, rr = c.x1 - pos.x, t = pos.z - c.z0, b = c.z1 - pos.z, m = Math.min(l, rr, t, b);
          if (m === l) pos.x = c.x0 - r; else if (m === rr) pos.x = c.x1 + r; else if (m === t) pos.z = c.z0 - r; else pos.z = c.z1 + r;
        }
      }
    }
    if (extraCircles) for (const c of extraCircles) {
      if (c.off) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), p = (rr - d) / d; pos.x += dx * p; pos.z += dz * p; hit = true; }
    }
  }
  return hit;
}

// 2D segment vs AABB (slab). Only boxes taller than minH block sight.
export function segHitsBox(ax, az, bx, bz, c) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const p = [-dx, dx, -dz, dz], q = [ax - c.x0, c.x1 - ax, az - c.z0, c.z1 - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return false; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}
export function losClear(ax, az, bx, bz, cols, minH = 1.6) {
  const x0 = Math.min(ax, bx) - 0.1, x1 = Math.max(ax, bx) + 0.1, z0 = Math.min(az, bz) - 0.1, z1 = Math.max(az, bz) + 0.1;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.off || c.h < minH || c.x1 < x0 || c.x0 > x1 || c.z1 < z0 || c.z0 > z1) continue;
    if (segHitsBox(ax, az, bx, bz, c)) return false;
  }
  return true;
}

// Grid pathfinding for the AI Raja. Cell 1.5 units. box = {x0,x1,z0,z1}
export class NavGrid {
  constructor(box, cols, radius, cell = 1.5) {
    this.cell = cell; this.minX = box.x0; this.minZ = box.z0;
    this.nx = Math.ceil((box.x1 - box.x0) / cell); this.nz = Math.ceil((box.z1 - box.z0) / cell);
    const N = this.nx * this.nz;
    this.blocked = new Uint8Array(N);
    this.rebuild(cols, radius);
    this.g = new Float32Array(N); this.came = new Int32Array(N); this.seen = new Int32Array(N); this.stamp = 0;
  }
  rebuild(cols, r) {
    const { nx, nz, cell } = this; this.blocked.fill(0);
    for (const c of cols) {
      if (c.off || c.nonav) continue;
      const i0 = Math.max(0, Math.floor((c.x0 - r - this.minX) / cell)), i1 = Math.min(nx - 1, Math.floor((c.x1 + r - this.minX) / cell));
      const j0 = Math.max(0, Math.floor((c.z0 - r - this.minZ) / cell)), j1 = Math.min(nz - 1, Math.floor((c.z1 + r - this.minZ) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.minX + (i + 0.5) * cell, z = this.minZ + (j + 0.5) * cell;
        const dx = x - clamp(x, c.x0, c.x1), dz = z - clamp(z, c.z0, c.z1);
        if (dx * dx + dz * dz < r * r) this.blocked[j * nx + i] = 1;
      }
    }
  }
  cellOf(x, z) { return [clamp(Math.floor((x - this.minX) / this.cell), 0, this.nx - 1), clamp(Math.floor((z - this.minZ) / this.cell), 0, this.nz - 1)]; }
  center(i, j) { return [this.minX + (i + 0.5) * this.cell, this.minZ + (j + 0.5) * this.cell]; }
  nearestFree(i, j) {
    if (!this.blocked[j * this.nx + i]) return [i, j];
    for (let r = 1; r < 10; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) continue;
      if (!this.blocked[b * this.nx + a]) return [a, b];
    }
    return [i, j];
  }
  path(sx, sz, tx, tz) {
    const n = this.nx;
    const [si, sj] = this.nearestFree(...this.cellOf(sx, sz)), [ti, tj] = this.nearestFree(...this.cellOf(tx, tz));
    const start = sj * n + si, goal = tj * n + ti;
    if (start === goal) return [[tx, tz]];
    this.stamp++;
    const st = this.stamp, g = this.g, came = this.came, seen = this.seen;
    const heap = [];
    const push = (f, idx) => { heap.push([f, idx]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    g[start] = 0; seen[start] = st; came[start] = -1; push(0, start);
    const h = (idx) => Math.hypot((idx % n) - ti, ((idx / n) | 0) - tj);
    let found = false, iter = 0;
    while (heap.length && iter++ < 40000) {
      const [, cur] = pop();
      if (cur === goal) { found = true; break; }
      const ci = cur % n, cj = (cur / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = ci + di, b = cj + dj;
        if (a < 0 || b < 0 || a >= n || b >= this.nz) continue;
        const ni = b * n + a;
        if (this.blocked[ni]) continue;
        if (di && dj && (this.blocked[cj * n + a] || this.blocked[b * n + ci])) continue;
        const ng = g[cur] + (di && dj ? 1.414 : 1);
        if (seen[ni] !== st || ng < g[ni]) { seen[ni] = st; g[ni] = ng; came[ni] = cur; push(ng + h(ni), ni); }
      }
    }
    if (!found) return null;
    const out = [];
    for (let c = goal; c !== -1; c = came[c]) out.push(this.center(c % n, (c / n) | 0));
    out.reverse(); out[out.length - 1] = [tx, tz];
    return out;
  }
  nearestFreePoint(x, z) { const [i, j] = this.nearestFree(...this.cellOf(x, z)); return this.center(i, j); }
  randomFree(rnd) {
    for (let k = 0; k < 80; k++) {
      const i = Math.floor(rnd() * this.nx), j = Math.floor(rnd() * this.nz);
      if (!this.blocked[j * this.nx + i]) return this.center(i, j);
    }
    return [0, 0];
  }
}

const THREE = window.THREE;
// ---- static geometry merging (cuts draw calls: one mesh per material)
export function collectMeshes(root, include) {
  const out = [];
  root.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.visible && (include ? include(o) : true)) out.push(o); });
  return out;
}
export function mergeInto(parent, meshes, inv) {
  const buckets = new Map(), tmp = new THREE.Matrix4();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    tmp.copy(inv).multiply(m.matrixWorld);
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(tmp);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.attributes.position.count, materialIndex: 0 }];
    for (const g of groups) { const mat = mats.length === 1 ? mats[0] : mats[g.materialIndex || 0]; if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push({ geo, start: g.start, count: g.count }); }
  }
  for (const [mat, parts] of buckets) {
    let n = 0; for (const p of parts) n += p.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const p of parts) {
      const a = p.geo.attributes;
      pos.set(a.position.array.subarray(p.start * 3, (p.start + p.count) * 3), o * 3);
      if (a.normal) nor.set(a.normal.array.subarray(p.start * 3, (p.start + p.count) * 3), o * 3);
      if (a.uv) uv.set(a.uv.array.subarray(p.start * 2, (p.start + p.count) * 2), o * 2);
      o += p.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    parent.add(new THREE.Mesh(g, mat));
  }
  for (const m of meshes) { m.geometry.dispose && 0; if (m.parent) m.parent.remove(m); }
}
export function mergeGroup(g) {
  g.updateMatrixWorld(true);
  const meshes = collectMeshes(g);
  if (meshes.length < 3) return g;
  mergeInto(g, meshes, new THREE.Matrix4().copy(g.matrixWorld).invert());
  return g;
}

