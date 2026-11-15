// Computer-controlled Raja for solo mode: patrol -> suspicious -> chase -> search (incl. checking hiding spots).
import { losClear, angDiff, lerpAng, clamp, collideCircle } from './util.js';

export class RajaAI {
  constructor(game, ch, pos, opts = {}) {
    this.g = game; this.ch = ch; this.x = pos[0]; this.z = pos[1]; this.ry = 0; this.vx = 0; this.vz = 0; this.r = 0.7;
    this.style = opts.style || 'roamer'; this.home = opts.home || null; this.homeR = opts.homeR || 0;
    this.name = opts.name || 'රජා'; this.dmg = opts.dmg || 20; this.scentEvery = opts.scentEvery || 4; this.hitCd = 0;
    this.state = 'patrol'; this.alert = 0; this.path = null; this.pi = 0; this.repath = 0; this.stateT = 0;
    this.lastSeen = null; this.down = 0; this.swingT = -1; this.recover = 0; this.wait = 0;
    this.check = []; this.talkT = 6; this.stuckT = 0; this.stuckX = pos[0]; this.stuckZ = pos[1];
    this.patrolIdx = 0; this.invul = 0; this.speedMul = 1; this.active = true; this.markT = 0;
    this.sweep = null;
  }
  get speedBase() { return (1 + 0.16 * this.g.progress) * this.g.diff.spd; }
  see(k) {
    if (k.hidden || k.safe) return 0;
    const dx = k.x - this.x, dz = k.z - this.z, d = Math.hypot(dx, dz);
    const g = this.g;
    let range = 22 * g.diff.vis * (1 + 0.2 * g.progress) * (k.disguise ? 0.35 : 1) * (k.cover ? 0.5 : 1) * (k.sneak ? 0.55 : 1) * (g.mods.includes('rain') ? 0.75 : 1);
    if (g.mods.includes('dusk')) range *= 0.9;
    if (g.mods.includes('night')) range *= 0.8;
    if (g.mods.includes('fog')) range *= 0.6;
    if (d > range) return 0;
    if (d > 7) { const a = Math.abs(angDiff(this.ry, Math.atan2(dx, dz))); if (a > 1.05) return 0; }   // close range: Raja senses you all round him
    if (!losClear(this.x, this.z, k.x, k.z, this.g.world.cols, 1.7)) return 0;
    if (d > 3 && g.smokeBlocks(this.x, this.z, k.x, k.z)) return 0;
    return 1 - d / range * 0.6;   // closer = faster alert
  }
  setState(s) { this.state = s; this.stateT = 0; this.path = null; this.repath = 0; }
  say(line) { this.ch.say(line, 2.2); }
  pickPatrol() {
    // Raja only ever hunts Kassa: he prowls the streets around him, never the hotel
    const g = this.g, nav = g.nav, rnd = g.rnd, b = g.map.box, k = g.kassaInfo();
    let tx, tz;
    if (g.progress > 0.3 && rnd() < 0.45) {   // once Kassa is well on his way, Raja cuts him off near the hotel
      const door = g.map.hotel.door, f = 0.35 + rnd() * 0.35;
      tx = door[0] + (k.x - door[0]) * f + (rnd() - 0.5) * 10; tz = door[1] + (k.z - door[1]) * f + (rnd() - 0.5) * 10;
      [tx, tz] = nav.nearestFreePoint(clamp(tx, b.x0 + 8, b.x1 - 8), clamp(tz, b.z0 + 8, b.z1 - 8));
      return [tx, tz];
    }
    if (rnd() < 0.6) {
      const a = rnd() * 6.283, r = 8 + rnd() * 28;
      [tx, tz] = nav.nearestFreePoint(clamp(k.x + Math.cos(a) * r, b.x0 + 8, b.x1 - 8), clamp(k.z + Math.sin(a) * r, b.z0 + 8, b.z1 - 8));
    } else if (this.style === 'sweeper') {
      if (!this.pts) { const mm = g.map; this.pts = []; mm.roadLinesZ.forEach((zz, a) => { const row = mm.roadLinesX.map(xx => [xx, zz]); if (a % 2) row.reverse(); this.pts.push(...row); }); this.patrolIdx = Math.floor(rnd() * this.pts.length); }
      const q = this.pts[this.patrolIdx++ % this.pts.length];
      [tx, tz] = nav.nearestFreePoint(q[0], q[1]);
    } else { [tx, tz] = nav.randomFree(rnd); }
    return [tx, tz];
  }
  goTo(x, z) {
    const p = this.g.nav.path(this.x, this.z, x, z);
    this.path = p; this.pi = 0; this.repath = 0;
    return !!p;
  }
  follow(dt, speed) {
    if (!this.path) return true;
    let tgt = this.path[this.pi];
    while (tgt && Math.hypot(tgt[0] - this.x, tgt[1] - this.z) < 0.8) { this.pi++; tgt = this.path[this.pi]; }
    if (!tgt) { this.path = null; return true; }
    // skip ahead if we can see further waypoints (smooth corners)
    for (let k = Math.min(this.path.length - 1, this.pi + 3); k > this.pi; k--) {
      const q = this.path[k];
      if (Math.hypot(q[0] - this.x, q[1] - this.z) < 9 && losClear(this.x, this.z, q[0], q[1], this.g.world.cols, 0)) { this.pi = k; tgt = q; break; }
    }
    this.steer(dt, tgt[0] - this.x, tgt[1] - this.z, speed);
    return false;
  }
  steer(dt, dx, dz, speed) {
    const d = Math.hypot(dx, dz) || 1;
    speed *= this.g.world.terrainSpeed(this.x, this.z);
    const tvx = dx / d * speed, tvz = dz / d * speed, k = Math.min(1, dt * 9);
    this.vx += (tvx - this.vx) * k; this.vz += (tvz - this.vz) * k;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.collide();
    if (Math.hypot(this.vx, this.vz) > 0.5) this.ry = lerpAng(this.ry, Math.atan2(this.vx, this.vz), Math.min(1, dt * 10));
  }
  collide() {
    const pos = { x: this.x, z: this.z };
    collideCircle(pos, this.r, this.g.world.cols, this.g.world.dyn);
    this.x = pos.x; this.z = pos.z;
  }
  halt(dt) { this.vx *= 0.8; this.vz *= 0.8; }
  turnTo(dt, a, rate = 6) { this.ry = lerpAng(this.ry, a, Math.min(1, dt * rate)); }

  update(dt) {
    const g = this.g, w = g.world;
    let k = g.kassaInfo();
    const dk = g.decoyInfo();
    if (dk && !g.race) { const sD = this.see(dk), sK = this.see(k); if (sD > 0 && (sK === 0 || Math.hypot(dk.x - this.x, dk.z - this.z) < Math.hypot(k.x - this.x, k.z - this.z))) k = dk; }
    if (this.pending > 0) return;
    if (this.stunPause > 0) { this.stunPause -= dt; this.halt(dt); this.sync(); return; }
    this.stateT += dt; this.invul -= dt; this.talkT -= dt; this.hitCd -= dt;
    if (this.down > 0) {
      this.down -= dt; this.halt(dt); this.ch.setStars(true);
      if (this.down <= 0) { this.ch.setStars(false); this.ch.once = null; this.ch.anim = 'idle'; this.setState('search'); }
      this.sync(); return;
    }
    // hazards
    if (this.invul <= 0) {
      const v = w.vehicleHit(this.x, this.z, 0.6);
      if (v) { this.knock(1.6, 'vehicle'); this.invul = 3; return; }
      const b = g.bananaAt(this.x, this.z, 0.9);
      if (b) { g.removeBanana(b); this.knock(2.2, 'banana'); this.invul = 2; g.toast('රජා ලිස්සා වැටුණා! 🍌', '#ffe14d'); return; }
    }
    if (this.swingT >= 0) {
      this.swingT += dt; this.halt(dt);
      if (this.swingT > 0.55 && !this.swingDone) {   // wind-up: Kassa can see it and dodge
        this.swingDone = true;
        const d = Math.hypot(k.x - this.x, k.z - this.z);
        if (k.decoy) { g.popDecoy(this); this.swingT = -1; this.stunPause = 1.2; return; }
        if (!k.hidden && d < 3.4 && !k.safe) { if (g.race) g.raceTag(this); else g.hitKassa(this); return; }
      }
      if (this.swingT > 0.9) { this.swingT = -1; this.recover = 0.3; this.setState('search'); }
      this.sync(); return;
    }
    if (g.race) { this.updateRace(dt, k); return; }
    { const kr = g.kassaInfo(); if (!kr.hidden && !g.ending && this.hitCd <= 0 && Math.hypot(kr.x - this.x, kr.z - this.z) < 2.1) { g.hitKassa(this); this.ch.once = null; this.ch.play('swing', 0.5); return; } }   // Raja meets you = he hits you
    // a hunter never idles: every so often he picks up Kassa's scent and heads for that area
    if (this.state === 'patrol' || this.state === 'look') {
      this.scentT = (this.scentT ?? 3) - dt;
      if (this.scentT <= 0) { this.scentT = this.scentEvery; this.lastSeen = { x: k.x + (Math.random() - 0.5) * 20, z: k.z + (Math.random() - 0.5) * 20 }; this.searchInit = false; this.setState('search'); }
    }
    // perception
    const sight = this.see(k);
    const prog = g.progress;
    if (sight > 0) {
      this.alert = Math.min(1.6, this.alert + dt * (1.0 + sight * 2.2 + prog) * g.diff.alert);
      this.lastSeen = { x: k.x, z: k.z };
      this.lastSeenT = g.t;
    } else this.alert = Math.max(0, this.alert - dt * 0.45);
    if (g.alertHint && g.alertHint.t > (this.hintT ?? -1)) { this.hintT = g.alertHint.t; this.lastSeen = { x: g.alertHint.x, z: g.alertHint.z }; if (this.state === 'patrol' || this.state === 'look' || this.state === 'search') { this.searchInit = false; this.setState('search'); this.say('ඇහුණා... මොකක්ද ඒ?'); } }
    // sounds
    for (const n of g.noises) {
      if (n.heard) continue;
      if (Math.hypot(n.x - this.x, n.z - this.z) < n.r && this.state !== 'chase') {
        n.heard = true; this.lastSeen = { x: n.x + (Math.random() - 0.5) * 4, z: n.z + (Math.random() - 0.5) * 4 };
        this.setState('search'); this.say(g.pickLine('rajaSearch')); this.check = [];
      }
    }
    if (this.state !== 'chase' && this.alert >= 0.35 && this.alert < 1) { this.ch.setMark('?'); this.turnTo(dt, Math.atan2(k.x - this.x, k.z - this.z), 5); }
    if (this.state !== 'chase' && this.alert >= 1) {
      this.setState('chase'); this.ch.setMark('!', '#ff4d4d'); g.onRajaSpotted(this);
    }
    if (this.state !== 'chase' && this.alert < 0.35) this.ch.setMark(null);

    const base = (g.mods.includes('angry') ? 1.1 : 1) * this.speedBase * this.speedMul;
    switch (this.state) {
      case 'patrol': {
        this.ch.setAnim('walk');
        if (!this.path || this.repath > 12) { const [tx, tz] = this.pickPatrol(); if (!this.goTo(tx, tz)) { this.repath = 0; } }
        this.repath += dt;
        if (this.follow(dt, 3.7 * base)) { this.wait = 1 + Math.random() * 1.5; this.setState('look'); }
        break;
      }
      case 'look': {
        this.halt(dt); this.ch.setAnim('look'); this.ry += Math.sin(this.stateT * 1.6) * dt * 1.4;
        if (this.stateT > this.wait) this.setState('patrol');
        break;
      }
      case 'chase': {
        this.ch.setAnim('chase'); this.ch.setMark(this.tired > 0 ? '💦' : '!', '#ff4d4d');
        const d = Math.hypot(k.x - this.x, k.z - this.z);
        this.chaseT = (this.chaseT || 0) + dt; this.tired = (this.tired || 0) - dt;
        if (this.chaseT > g.diff.stam && !(this.tired > -8)) { this.tired = 3.5; this.chaseT = 0; this.say('හ්ම්… මහන්සියි!'); }
        const tm = this.tired > 0 ? 0.9 : 1;
        if (sight > 0 || (k.hidden === false && d < 6 && losClear(this.x, this.z, k.x, k.z, w.cols, 1.7))) { this.lastSeen = { x: k.x, z: k.z }; this.loseT = 0; }
        else this.loseT = (this.loseT || 0) + dt;
        const tgt = this.lastSeen || { x: k.x, z: k.z };
        const dt2 = Math.hypot(tgt.x - this.x, tgt.z - this.z);
        if (this.talkT <= 0 && sight > 0) { this.talkT = 7; this.say(g.pickLine('taunt')); }
        if (k.decoy && d < 2.6) { g.popDecoy(this); this.stunPause = 1.2; break; }
        if (sight > 0 && d < 3.3 && !k.hidden && !k.decoy) {
          this.swingT = 0; this.swingDone = false; this.ch.play('swing', 0.9); g.sfx('swing'); if (!g.race) g.warnSwing(this); break;
        }
        if (sight > 0 && d < 9 && losClear(this.x, this.z, k.x, k.z, w.cols, 0.3)) this.steer(dt, k.x - this.x, k.z - this.z, 8.2 * base * tm);
        else {
          this.repath -= dt;
          if (!this.path || this.repath <= 0) { this.goTo(tgt.x, tgt.z); this.repath = 0.35; }
          const done = this.follow(dt, 8.2 * base * tm);
          if (done && dt2 < 3) { this.check = []; this.setState('search'); this.ch.setMark('?'); }
        }
        if (this.loseT > 9) { this.alert = 0.4; this.check = []; this.setState('search'); this.ch.setMark('?'); }
        break;
      }
      case 'search': {
        // go to last seen / heard position, look around, then peek into nearby hiding places
        this.ch.setAnim(this.path ? 'walk' : 'look');
        if (!this.searchInit) { this.searchInit = true; this.phase = 'go'; this.goTo(...(this.lastSeen ? [this.lastSeen.x, this.lastSeen.z] : this.pickPatrol())); this.searchT = 0; }
        this.searchT += dt;
        if (this.phase === 'go') {
          if (this.follow(dt, 5.2 * base)) { this.phase = 'look'; this.phaseT = 0; }
        } else if (this.phase === 'look') {
          this.halt(dt); this.phaseT += dt; this.ch.setAnim('look'); this.ry += Math.sin(this.phaseT * 2.2) * dt * 2;
          if (this.phaseT > 2.2) {
            const ls = this.lastSeen || { x: this.x, z: this.z };
            this.check = w.hideSpots.filter(s => Math.hypot(s.x - ls.x, s.z - ls.z) < 18).sort((a, b) => Math.hypot(a.x - this.x, a.z - this.z) - Math.hypot(b.x - this.x, b.z - this.z)).slice(0, 4);
            if (g.hotelSearch && w.hotelSpot) this.check.push(w.hotelSpot);
            this.phase = 'peek'; this.phaseT = 0; this.cur = null;
          }
        } else if (this.phase === 'peek') {
          if (!this.cur) { this.cur = this.check.shift(); if (!this.cur) { this.searchInit = false; this.setState('patrol'); this.lastSeen = null; break; } this.goTo(this.cur.x, this.cur.z + 0.01); }
          this.ch.setAnim('walk');
          const done = this.follow(dt, 5.2 * base);
          const d = Math.hypot(this.cur.x - this.x, this.cur.z - this.z);
          if (d < 2.1 || done) {
            if (g.hiddenSpot === this.cur || (g.kassaInfo().hidden && Math.hypot(k.x - this.x, k.z - this.z) < 2.3)) { g.popKassa(true); this.alert = 1.2; this.setState('chase'); this.say(g.pickLine('rajaSpot')); }
            else { this.ch.play('look', 1.0); this.cur = null; this.phaseT = 0; }
          }
        }
        if (this.stateT > 25) { this.searchInit = false; this.setState('patrol'); }
        break;
      }
    }
    if (this.state !== 'search') this.searchInit = false;
    // stuck handling
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      if (Math.hypot(this.x - this.stuckX, this.z - this.stuckZ) < 0.4 && this.path && this.state !== 'look') { this.path = null; this.repath = 0; }
      this.stuckT = 0; this.stuckX = this.x; this.stuckZ = this.z;
    }
    this.sync();
  }
  // race mode: run for the hotel door, shove the player when close, rubber-band to keep it tight
  updateRace(dt, k) {
    const g = this.g, door = g.map.hotel.door;
    this.tagCd = (this.tagCd || 0) - dt; this.burstT = (this.burstT || 0) - dt; this.burstCd = (this.burstCd ?? 6) - dt; this.repath -= dt;
    if (!this.path || this.repath <= 0) { this.goTo(door[0], door[1] - 3); this.repath = 2.5; }
    const aiD = Math.hypot(this.x - door[0], this.z - door[1]), kD = Math.hypot(k.x - door[0], k.z - door[1]);
    if (this.burstCd <= 0) { this.burstT = 2.2; this.burstCd = 14 + Math.random() * 6; this.fxBurst = true; }
    const rb = aiD < kD - 25 ? 0.9 : aiD > kD + 25 ? 1.06 : 1;
    const spd = 6.3 * g.diff.spd * rb * (this.burstT > 0 ? 1.45 : 1);
    const dK = Math.hypot(k.x - this.x, k.z - this.z);
    if (dK < 2.4 && this.tagCd <= 0 && !g.me.stun) { this.swingT = 0; this.swingDone = false; this.ch.play('swing', 0.9); g.sfx('swing'); this.tagCd = 6; return; }
    this.ch.setAnim(this.burstT > 0 ? 'chase' : 'run');
    this.follow(dt, spd);
    if (this.z < door[1] - 1 && Math.abs(this.x) < 5) g.onRaceFinish('ai');
    this.sync();
  }
  // ambush: burst out of a hiding spot
  pop(spot, k) {
    this.x = spot.x; this.z = spot.z; this.vx = this.vz = 0; this.pending = 0; this.ch.root.visible = true;
    this.ry = Math.atan2(k.x - spot.x, k.z - spot.z);
    this.ch.once = null; this.ch.play('surprise', 0.6); this.stunPause = 0.75; this.alert = 1.6;
    this.lastSeen = { x: k.x, z: k.z }; this.setState('chase'); this.ch.setMark('!', '#ff4d4d');
    this.collide();
  }
  knock(sec, why) {
    this.down = sec; this.ch.play('slip', sec); this.ch.once = null; this.ch.anim = 'slip'; this.ch.animT = 0;
    this.ch.setMark(null); this.g.sfx(why === 'vehicle' || why === 'coconut' ? 'bonk' : 'slip'); this.g.fxPop('BONK!', this.x, 2.4, this.z);
    this.swingT = -1; this.path = null; this.alert = 0.2;
  }
  sync() {
    const c = this.ch;
    c.root.position.set(this.x, this.g.world.groundY(this.x, this.z), this.z);
    c.root.rotation.y = this.ry;
    c.speed = Math.hypot(this.vx, this.vz);
    c.update(this.g.dtLast || 0.016);
  }
}
