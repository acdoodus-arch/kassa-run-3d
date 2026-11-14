// Synthesised audio: SFX + a lively baila-flavoured music loop. No audio files needed.
let ctx = null, master = null, musicGain = null, sfxGain = null;
let musicOn = true, sfxOn = true, voiceOn = false, intensity = 0, timer = null, step = 0, nextT = 0, started = false;
try { musicOn = localStorage.getItem('kr_music') !== '0'; sfxOn = localStorage.getItem('kr_sfx') !== '0'; voiceOn = localStorage.getItem('kr_voice') === '1'; } catch (e) {}

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.28; musicGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.7; sfxGain.connect(master);
  return true;
}
const noteHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
function tone(f, t, dur, type = 'square', vol = 0.2, dest, slideTo) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || sfxGain); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, vol = 0.2, hp = 800, dest) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur)), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(dest || sfxGain); s.start(t);
}

const SFX = {
  click: (t) => tone(660, t, 0.07, 'square', 0.12),
  pickup: (t) => { tone(660, t, 0.08, 'triangle', 0.25); tone(990, t + 0.07, 0.14, 'triangle', 0.25); tone(1320, t + 0.14, 0.18, 'triangle', 0.2); },
  bonk: (t) => { tone(220, t, 0.18, 'sine', 0.5, null, 60); noise(t, 0.12, 0.35, 300); tone(880, t + 0.05, 0.1, 'square', 0.12); },
  slip: (t) => { tone(800, t, 0.5, 'sine', 0.25, null, 120); tone(200, t + 0.4, 0.15, 'square', 0.2); },
  swing: (t) => noise(t, 0.2, 0.25, 1500),
  honk: (t) => { tone(310, t, 0.28, 'sawtooth', 0.14); tone(392, t, 0.28, 'sawtooth', 0.12); },
  whistle: (t) => { tone(2400, t, 0.35, 'sine', 0.18, null, 3000); tone(2600, t + 0.4, 0.25, 'sine', 0.18, null, 3100); },
  camera: (t) => { noise(t, 0.05, 0.4, 3000); tone(1800, t, 0.05, 'square', 0.1); },
  alert: (t) => { tone(220, t, 0.14, 'sawtooth', 0.3); tone(233, t, 0.14, 'sawtooth', 0.3); tone(220, t + 0.18, 0.14, 'sawtooth', 0.3); tone(233, t + 0.18, 0.14, 'sawtooth', 0.3); tone(147, t + 0.36, 0.4, 'sawtooth', 0.3); },
  boost: (t) => tone(300, t, 0.35, 'sawtooth', 0.15, null, 1100),
  disguise: (t) => { tone(500, t, 0.1, 'triangle', 0.2); tone(700, t + 0.08, 0.1, 'triangle', 0.2); tone(400, t + 0.16, 0.2, 'triangle', 0.2); },
  hide: (t) => { tone(400, t, 0.12, 'sine', 0.2, null, 200); },
  boing: (t) => tone(200, t, 0.3, 'sine', 0.35, null, 700),
  win: (t) => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.12, 0.2, 'square', 0.2)); },
  lose: (t) => { [392, 370, 349, 330].forEach((f, i) => tone(f, t + i * 0.25, 0.3, 'sawtooth', 0.25, null, f * 0.9)); },
  tick: (t) => tone(1000, t, 0.05, 'square', 0.1),
  go: (t) => { tone(880, t, 0.4, 'square', 0.25); },
  footstep: (t) => noise(t, 0.05, 0.08, 200),
  ping: (t) => { tone(1500, t, 0.1, 'sine', 0.2); tone(1500, t + 0.2, 0.1, 'sine', 0.15); },
  emote: (t) => { tone(500, t, 0.08, 'triangle', 0.2); tone(750, t + 0.07, 0.1, 'triangle', 0.2); },
  jam: (t) => { for (let i = 0; i < 4; i++) { tone(300 + i * 20, t + i * 0.22, 0.18, 'sawtooth', 0.12); } },
};
export const Audio = {
  unlock() { if (!ensure()) return; if (ctx.state === 'suspended') ctx.resume(); if (!started) { started = true; if (musicOn && this._wantMusic) this.music(true); } },
  sfx(name, vol = 1) {
    if (!sfxOn || !ensure() || !SFX[name]) return;
    if (ctx.state === 'suspended') return;
    const t = ctx.currentTime + 0.01;
    try { SFX[name](t, vol); } catch (e) {}
  },
  music(on) {
    this._wantMusic = on;
    if (!ensure()) return;
    if (!on || !musicOn) { if (timer) { clearInterval(timer); timer = null; } return; }
    if (timer) return;
    nextT = ctx.currentTime + 0.1; step = 0;
    timer = setInterval(schedule, 90);
  },
  setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); },
  toggleMusic() { musicOn = !musicOn; try { localStorage.setItem('kr_music', musicOn ? '1' : '0'); } catch (e) {} this.music(this._wantMusic); return musicOn; },
  toggleSfx() { sfxOn = !sfxOn; try { localStorage.setItem('kr_sfx', sfxOn ? '1' : '0'); } catch (e) {} return sfxOn; },
  toggleVoice() { voiceOn = !voiceOn; try { localStorage.setItem('kr_voice', voiceOn ? '1' : '0'); } catch (e) {} return voiceOn; },
  get musicOn() { return musicOn; }, get sfxOn() { return sfxOn; }, get voiceOn() { return voiceOn; },
  speak(text) {
    if (!voiceOn || !('speechSynthesis' in window)) return;
    const v = speechSynthesis.getVoices().find(x => /^si/i.test(x.lang));
    if (!v) return;
    const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = v.lang; u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u);
  },
  hasSinhalaVoice() { return 'speechSynthesis' in window && speechSynthesis.getVoices().some(x => /^si/i.test(x.lang)); },
};

// ---- music: C major pentatonic hook over a baila-style 16-step groove
const CHORDS = [0, 5, 7, 0], PENT = [0, 2, 4, 7, 9, 12, 14];
const MEL = (() => { let a = 12345; const r = () => (a = (a * 1664525 + 1013904223) >>> 0) / 4294967296; const m = []; let p = 3; for (let i = 0; i < 64; i++) { if (r() < 0.55) { p = Math.max(0, Math.min(6, p + Math.floor(r() * 5) - 2)); m.push(PENT[p]); } else m.push(null); } return m; })();
function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  const bpm = 108 + intensity * 28, spb = 60 / bpm / 4;
  if (nextT < ctx.currentTime - 0.2) nextT = ctx.currentTime + 0.05;   // resumed after being suspended: don't replay the backlog
  while (nextT < ctx.currentTime + 0.3) {
    const s = step % 16, bar = Math.floor(step / 16) % 4, t = nextT, ch = CHORDS[bar];
    if ([0, 6, 8, 14].includes(s)) tone(120, t, 0.12, 'sine', 0.7, musicGain, 40);                // kick
    if (s === 4 || s === 12) { noise(t, 0.1, 0.35, 1200, musicGain); tone(180, t, 0.08, 'triangle', 0.2, musicGain); } // clap
    if (s % 2 === 0) noise(t, 0.03, 0.12 + (s % 4 === 2 ? 0.08 : 0), 6000, musicGain);                 // hats
    if ([0, 3, 6, 8, 11, 14].includes(s)) tone(s % 3 ? 300 : 220, t, 0.07, 'sine', 0.3, musicGain, 180); // conga 3-3-2
    if ([0, 6, 8, 14].includes(s)) tone(noteHz(36 + ch), t, spb * 3, 'sawtooth', 0.25, musicGain);          // bass
    if (s % 2 === 1) tone(noteHz(60 + ch + 4), t, spb, 'square', 0.04, musicGain);                          // skank
    const m = MEL[step % 64];
    if (m !== null && (intensity > 0.1 || bar % 2 === 0)) tone(noteHz(72 + ch * 0 + m), t, spb * 1.6, 'triangle', 0.16, musicGain);
    if (intensity > 0.5 && s % 4 === 0) tone(noteHz(84 + ch), t, spb * 0.8, 'square', 0.05, musicGain);
    nextT += spb; step++;
  }
}
