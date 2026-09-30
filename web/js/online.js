// اللعب أونلاين مع صديق عبر WebRTC (PeerJS) — بدون خادم خاص.
/* global Peer */

const PREFIX = 'shatranj-ar-v1-';
// خادم الربط (signaling). الافتراضي هو خادم PeerJS العام المجاني؛ يمكن تغييره بتعريف window.PEER_SERVER.
const peerOptions = () => ({ debug: 0, ...(window.PEER_SERVER || {}) });
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode() {
  let s = '';
  const arr = crypto.getRandomValues(new Uint8Array(6));
  for (const b of arr) s += ALPHABET[b % ALPHABET.length];
  return s;
}

// يستخرج رمز الدعوة من رابط كامل أو من الرمز نفسه.
export function parseCode(text) {
  if (!text) return null;
  const t = text.trim();
  const m = t.match(/[?&#]join=([A-Za-z0-9]{6})/) || t.match(/join\/([A-Za-z0-9]{6})/) || t.match(/^([A-Za-z0-9]{6})$/);
  return m ? m[1].toUpperCase() : null;
}

export class OnlineGame {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.peer = null;
    this.conn = null;
    this.code = null;
    this.isHost = false;
    this.closed = false;
  }

  _makePeer(id) {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
      const t = setTimeout(() => reject(new Error('timeout')), 15000);
      peer.on('open', () => { clearTimeout(t); resolve(peer); });
      peer.on('error', (err) => { clearTimeout(t); reject(err); });
    });
  }

  async host(code) {
    this.isHost = true;
    this.code = code || newCode();
    this.onStatus('connecting', 'جارٍ تجهيز الغرفة…');
    try {
      this.peer = await this._makePeer(PREFIX + this.code);
    } catch (err) {
      if (err && err.type === 'unavailable-id') return this.host(newCode());
      this.onStatus('error', 'تعذر الاتصال بخادم الربط. تأكد من الإنترنت ثم حاول مرة أخرى.');
      throw err;
    }
    this.peer.on('connection', (conn) => {
      if (this.conn && this.conn.open) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); }); return; }
      this._attach(conn);
    });
    this.peer.on('disconnected', () => { if (!this.closed) this.peer.reconnect(); });
    this.onStatus('waiting', 'بانتظار انضمام صديقك…');
    return this.code;
  }

  async join(code) {
    this.isHost = false;
    this.code = code;
    this.onStatus('connecting', 'جارٍ الاتصال بصديقك…');
    try {
      this.peer = await this._makePeer();
    } catch (err) {
      this.onStatus('error', 'تعذر الاتصال بخادم الربط. تأكد من الإنترنت ثم حاول مرة أخرى.');
      throw err;
    }
    this.peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') this.onStatus('error', 'لم يتم العثور على الغرفة. تأكد أن صديقك ما زال في شاشة الانتظار وأن الرابط صحيح.');
    });
    this._connectToHost();
  }

  _connectToHost() {
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
    this._attach(conn);
  }

  _attach(conn) {
    this.conn = conn;
    conn.on('open', () => {
      this.onStatus('connected', 'متصل ✓');
      this.onMessage({ t: '_open' });
    });
    conn.on('data', (msg) => this.onMessage(msg));
    conn.on('close', () => {
      if (this.closed) return;
      this.onStatus('lost', 'انقطع الاتصال بالخصم…');
      if (!this.isHost) setTimeout(() => { if (!this.closed && (!this.conn || !this.conn.open)) this._connectToHost(); }, 2500);
    });
    conn.on('error', () => {});
  }

  send(msg) {
    if (this.conn && this.conn.open) { this.conn.send(msg); return true; }
    return false;
  }

  close() {
    this.closed = true;
    try { if (this.conn) this.conn.close(); } catch { /* تجاهل */ }
    try { if (this.peer) this.peer.destroy(); } catch { /* تجاهل */ }
  }
}
