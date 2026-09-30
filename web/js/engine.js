// غلاف لمحرك Stockfish يعمل داخل Web Worker، مع طابور طلبات متسلسل.

const wasmSupported = typeof WebAssembly === 'object' &&
  WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));

export class Engine {
  constructor() {
    this.worker = new Worker(wasmSupported ? 'engine/stockfish.wasm.js' : 'engine/stockfish.js');
    this.queue = [];
    this.current = null;
    this.listeners = [];
    this.worker.onmessage = (e) => this._onLine(typeof e.data === 'string' ? e.data : String(e.data));
    this.send('uci');
    this.send('setoption name Hash value 16');
    this.skill = null;
    this.multipv = 1;
  }

  send(cmd) { this.worker.postMessage(cmd); }

  _onLine(line) {
    const job = this.current;
    if (!job) return;
    if (line.startsWith('info') && line.includes(' pv ')) {
      const info = parseInfo(line);
      if (info) job.lines[info.multipv - 1] = info;
    } else if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      this.current = null;
      job.resolve({ bestmove: best && best !== '(none)' ? best : null, lines: job.lines.filter(Boolean) });
      this._next();
    }
  }

  _next() {
    if (this.current || !this.queue.length) return;
    const job = this.queue.shift();
    this.current = job;
    if (job.skill !== this.skill) {
      this.send(`setoption name Skill Level value ${job.skill}`);
      this.skill = job.skill;
    }
    if (job.multipv !== this.multipv) {
      this.send(`setoption name MultiPV value ${job.multipv}`);
      this.multipv = job.multipv;
    }
    this.send('ucinewgame');
    this.send(`position fen ${job.fen}`);
    let go = 'go';
    if (job.depth) go += ` depth ${job.depth}`;
    if (job.movetime) go += ` movetime ${job.movetime}`;
    if (job.searchmoves) go += ` searchmoves ${job.searchmoves}`;
    this.send(go);
  }

  // يحلل الوضع ويعيد أفضل الخطوط. النتيجة دائماً من منظور الطرف صاحب الدور.
  // إذا أُعطي depth و movetime معاً يتوقف البحث عند أيهما يتحقق أولاً.
  analyse(fen, { depth = 12, movetime = 0, multipv = 1, skill = 20, searchmoves = '' } = {}) {
    return new Promise((resolve) => {
      this.queue.push({ fen, depth, movetime, multipv, skill, searchmoves, lines: [], resolve });
      this._next();
    });
  }

  // يلغي كل الطلبات المنتظرة (مثلاً عند بدء مباراة جديدة).
  cancelAll() {
    for (const job of this.queue) job.resolve({ bestmove: null, lines: [], cancelled: true });
    this.queue = [];
    if (this.current) this.send('stop');
  }
}

function parseInfo(line) {
  const t = line.split(' ');
  const out = { multipv: 1, depth: 0, cp: null, mate: null, pv: [] };
  for (let i = 0; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': out.depth = +t[++i]; break;
      case 'multipv': out.multipv = +t[++i]; break;
      case 'score':
        if (t[i + 1] === 'cp') out.cp = +t[i + 2];
        else if (t[i + 1] === 'mate') out.mate = +t[i + 2];
        i += 2;
        break;
      case 'pv': out.pv = t.slice(i + 1); i = t.length; break;
    }
  }
  if (!out.pv.length) return null;
  if (t.includes('lowerbound') || t.includes('upperbound')) return null;
  return out;
}

// تحويل التقييم إلى رقم واحد بالسنتي-بيدق (الكش مات يعطى قيمة كبيرة).
export function scoreValue(line) {
  if (!line) return 0;
  if (line.mate !== null && line.mate !== undefined) {
    return line.mate > 0 ? 100000 - line.mate * 100 : -100000 - line.mate * 100;
  }
  return line.cp;
}

// مستويات اللعب: من مبتدئ جداً إلى أقوى مستوى.
export const LEVELS = [
  { name: 'مبتدئ جداً', skill: 0, movetime: 80, depth: 1 },
  { name: 'مبتدئ', skill: 2, movetime: 150, depth: 2 },
  { name: 'سهل', skill: 4, movetime: 200, depth: 4 },
  { name: 'متوسط', skill: 7, movetime: 300, depth: 6 },
  { name: 'جيد', skill: 10, movetime: 400, depth: 8 },
  { name: 'قوي', skill: 13, movetime: 600, depth: 10 },
  { name: 'قوي جداً', skill: 16, movetime: 800, depth: 12 },
  { name: 'خبير', skill: 18, movetime: 1200, depth: 14 },
  { name: 'أستاذ', skill: 20, movetime: 1500, depth: 16 },
  { name: 'بطل (أقصى قوة)', skill: 20, movetime: 3000, depth: 22 },
];
