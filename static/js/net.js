// WebSocket client with auto-reconnect, clock sync and message dispatch.
export class Net {
  constructor() {
    this.ws = null; this.handlers = {}; this.token = null; this.open = false; this.offset = 0; this.rtt = 0;
    this.want = false; this.retry = 0; this.samples = [];
  }
  on(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); return this; }
  emit(t, m) { (this.handlers[t] || []).forEach(f => f(m)); }
  serverNow() { return Date.now() + this.offset; }
  connect(token) {
    this.token = token || this.token; this.want = true;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const B = (window.KASSA_BACKEND || '').replace(/\/$/, '');
    const url = B ? B.replace(/^http/, 'ws') + '/ws' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const ws = new WebSocket(url); this.ws = ws;
    ws.onopen = () => { this.open = true; this.retry = 0; this.send('hello', { token: this.token }); this.syncClock(); this.emit('open', {}); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'pong') {
        const now = Date.now(), rtt = now - m.c; this.rtt = rtt;
        this.samples.push({ rtt, off: m.s + rtt / 2 - now }); if (this.samples.length > 8) this.samples.shift();
        const best = this.samples.reduce((a, b) => (a.rtt <= b.rtt ? a : b)); this.offset = best.off; return;
      }
      this.emit(m.t, m); this.emit('*', m);
    };
    ws.onclose = () => {
      this.open = false; this.emit('close', {});
      if (this.want) { this.retry++; setTimeout(() => this.connect(), Math.min(5000, 400 * this.retry)); }
    };
    ws.onerror = () => {};
    clearInterval(this._pi); this._pi = setInterval(() => this.syncClock(), 8000);
  }
  syncClock() { if (this.open) this.send('ping', { c: Date.now() }); }
  send(t, o = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...o })); }
  close() { this.want = false; if (this.ws) this.ws.close(); }
}
