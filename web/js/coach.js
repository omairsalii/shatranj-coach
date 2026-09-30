// المدرب العربي: يشرح النقلات، يكتشف التكتيكات، ويقيّم جودة النقلات.
import { Chess } from '../lib/chess.js';
import { scoreValue } from './engine.js';

export const PIECE = { p: 'البيدق', n: 'الحصان', b: 'الفيل', r: 'الطابية', q: 'الوزير', k: 'الملك' };
export const PIECE_IND = { p: 'بيدق', n: 'حصان', b: 'فيل', r: 'طابية', q: 'وزير', k: 'ملك' };
export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const FILES = 'abcdefgh';
const CENTER = new Set(['d4', 'e4', 'd5', 'e5']);
const WIDE_CENTER = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6']);

const DIRS = {
  n: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  k: [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
};
DIRS.q = [...DIRS.b, ...DIRS.r];

const sqName = (f, r) => FILES[f] + (r + 1);
const sqXY = (s) => [FILES.indexOf(s[0]), +s[1] - 1];
const other = (c) => (c === 'w' ? 'b' : 'w');
const side = (c) => (c === 'w' ? 'الأبيض' : 'الأسود');

// مربعات يهاجمها حجر معيّن (هندسياً، بغض النظر عن التثبيت).
export function attacksFrom(chess, sq) {
  const p = chess.get(sq);
  if (!p) return [];
  const [f, r] = sqXY(sq);
  const out = [];
  const inside = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;
  if (p.type === 'p') {
    const dy = p.color === 'w' ? 1 : -1;
    for (const dx of [-1, 1]) if (inside(f + dx, r + dy)) out.push(sqName(f + dx, r + dy));
  } else if (p.type === 'n' || p.type === 'k') {
    for (const [dx, dy] of DIRS[p.type]) if (inside(f + dx, r + dy)) out.push(sqName(f + dx, r + dy));
  } else {
    for (const [dx, dy] of DIRS[p.type]) {
      let x = f + dx, y = r + dy;
      while (inside(x, y)) {
        const s = sqName(x, y);
        out.push(s);
        if (chess.get(s)) break;
        x += dx; y += dy;
      }
    }
  }
  return out;
}

function pieces(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p && (!color || p.color === color)) out.push(p);
  return out;
}

export function material(chess, color) {
  return pieces(chess, color).reduce((s, p) => s + (p.type === 'k' ? 0 : VAL[p.type]), 0);
}

// القطع المعلّقة: مهاجَمة وغير محمية، أو مهاجَمة بقطعة أرخص منها.
export function hangingPieces(chess, color) {
  const res = [];
  for (const p of pieces(chess, color)) {
    if (p.type === 'k') continue;
    const attackers = chess.attackers(p.square, other(color));
    if (!attackers.length) continue;
    const defenders = chess.attackers(p.square, color);
    const minAtt = Math.min(...attackers.map((s) => VAL[chess.get(s).type]));
    if (!defenders.length || minAtt < VAL[p.type]) res.push({ ...p, attackers, defenders });
  }
  return res;
}

function applyUci(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

export function uciToSan(fen, uci) {
  const c = new Chess(fen);
  const m = applyUci(c, uci);
  return m ? m.san : uci;
}

export function pvToSan(fen, pv, max = 6) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    const m = applyUci(c, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

// وصف النقلة بالعربية.
export function describeMove(m) {
  if (m.san.startsWith('O-O-O')) return 'التبييت الطويل (نحو جهة الوزير)';
  if (m.san.startsWith('O-O')) return 'التبييت القصير (نحو جهة الملك)';
  let s = PIECE[m.piece];
  if (m.captured) s += ` يأخذ ${PIECE[m.captured]} في ${m.to}`;
  else s += ` من ${m.from} إلى ${m.to}`;
  if (m.promotion) s += ` ويترقّى إلى ${PIECE_IND[m.promotion]}`;
  return s;
}

// تحليل الأفكار التكتيكية والاستراتيجية لنقلة معيّنة.
export function motifs(fen, uci) {
  const before = new Chess(fen);
  const me = before.turn();
  const opp = other(me);
  const after = new Chess(fen);
  const m = applyUci(after, uci);
  if (!m) return { move: null, list: [] };
  const list = [];
  const add = (key, text, weight) => list.push({ key, text, weight });

  if (after.isCheckmate()) { add('mate', 'كش مات! تنتهي المباراة فوراً.', 100); return { move: m, list }; }

  if (m.captured) {
    const defended = after.attackers(m.to, opp).length > 0;
    const gain = VAL[m.captured];
    if (!defended) add('capture', `تكسب ${PIECE[m.captured]} مجاناً لأنه غير محمي.`, 40 + gain);
    else if (gain > VAL[m.piece]) add('capture', `تأخذ ${PIECE[m.captured]} (قيمته ${gain}) بـ${PIECE[m.piece]} الأقل قيمة، وهذه مبادلة رابحة.`, 30 + gain);
    else if (gain === VAL[m.piece]) add('trade', `مبادلة متكافئة: ${PIECE[m.piece]} مقابل ${PIECE[m.captured]}.`, 8);
    else add('capture', `تأخذ ${PIECE[m.captured]}.`, 6);
  }
  if (m.promotion) add('promo', `ترقية البيدق إلى ${PIECE_IND[m.promotion]}، مكسب مادي ضخم.`, 60);

  // الأهداف التي يهاجمها الحجر المتحرك بعد النقلة.
  const movedType = m.promotion || m.piece;
  const targets = attacksFrom(after, m.to)
    .map((s) => ({ s, p: after.get(s) }))
    .filter((t) => t.p && t.p.color === opp)
    .filter((t) => t.p.type === 'k' || VAL[t.p.type] > VAL[movedType] || after.attackers(t.s, opp).length === 0);
  const givesCheck = after.inCheck();

  if (targets.length >= 2) {
    const names = targets.map((t) => (t.p.type === 'k' ? 'الملك' : `${PIECE[t.p.type]} (${t.s})`));
    add('fork', `شوكة! ${PIECE[movedType]} يهاجم ${names.join(' و')} في نفس الوقت، ولا يمكن للخصم إنقاذ الجميع.`, 50);
  } else if (targets.length === 1 && targets[0].p.type !== 'k') {
    add('threat', `تهاجم ${PIECE[targets[0].p.type]} في ${targets[0].s} وتجبر الخصم على الرد.`, 12);
  }

  // التثبيت والسيخ للقطع البعيدة المدى.
  if ('bqr'.includes(movedType)) {
    const [f, r] = sqXY(m.to);
    for (const [dx, dy] of DIRS[movedType]) {
      let x = f + dx, y = r + dy;
      const hit = [];
      while (x >= 0 && x < 8 && y >= 0 && y < 8 && hit.length < 2) {
        const p = after.get(sqName(x, y));
        if (p) {
          if (p.color !== opp) break;
          hit.push({ ...p, square: sqName(x, y) });
        }
        x += dx; y += dy;
      }
      if (hit.length === 2) {
        const [a, b] = hit;
        const rearWeak = !after.attackers(b.square, opp).length;
        if (a.type === 'p' && b.type !== 'k') continue;
        if (VAL[b.type] > VAL[a.type] && (b.type === 'k' || VAL[b.type] > VAL[movedType] || rearWeak)) {
          const abs = b.type === 'k';
          add('pin', `تثبيت${abs ? ' مطلق' : ''}: ${PIECE[a.type]} في ${a.square} لا يستطيع التحرك لأن خلفه ${PIECE[b.type]}${abs ? ' (حركته غير قانونية)' : ''}.`, abs ? 30 : 22);
        } else if (VAL[a.type] > VAL[b.type] && (a.type === 'k' || VAL[a.type] > VAL[movedType]) && (rearWeak || VAL[b.type] > VAL[movedType])) {
          add('skewer', `سيخ (هجوم بالشّك): ${PIECE[a.type]} مجبر على الابتعاد فيكشف ${PIECE[b.type]} في ${b.square} خلفه.`, 35);
        }
      }
    }
  }

  // الهجوم المكشوف: قطع أخرى أصبحت تهاجم أهدافاً بعد تحرك هذا الحجر.
  const beforeAtt = new Set();
  for (const p of pieces(before, me)) if (p.square !== m.from) for (const s of attacksFrom(before, p.square)) beforeAtt.add(p.square + s);
  for (const p of pieces(after, me)) {
    if (p.square === m.to || !'bqr'.includes(p.type)) continue;
    for (const s of attacksFrom(after, p.square)) {
      const t = after.get(s);
      if (t && t.color === opp && !beforeAtt.has(p.square + s) && (t.type === 'k' || VAL[t.type] > VAL[p.type] || !after.attackers(s, opp).length)) {
        if (t.type === 'k') add('disc-check', givesCheck && targets.some((x) => x.p.type === 'k') ? `كش مزدوج! ${PIECE[p.type]} و${PIECE[movedType]} يعطيان كش معاً، والحل الوحيد هو تحريك الملك.` : `كش مكشوف: بابتعاد ${PIECE[m.piece]} أصبح ${PIECE[p.type]} يعطي كش للملك.`, 45);
        else add('discovered', `هجوم مكشوف: ${PIECE[p.type]} في ${p.square} أصبح يهاجم ${PIECE[t.type]} في ${s}.`, 30);
      }
    }
  }

  if (givesCheck && !list.some((x) => x.key === 'disc-check')) add('check', 'كش للملك: تجبر الخصم على الدفاع وتكسب الوقت (التيمبو).', 10);

  // الدفاع عن قطع معلّقة.
  const hangBefore = hangingPieces(before, me).filter((h) => h.square !== m.from);
  const hangAfter = new Set(hangingPieces(after, me).map((h) => h.square));
  const saved = hangBefore.filter((h) => !hangAfter.has(h.square));
  if (before.get(m.from) && hangingPieces(before, me).some((h) => h.square === m.from) && !hangAfter.has(m.to)) {
    add('escape', `تنقذ ${PIECE[m.piece]} الذي كان مهدَّداً.`, 20);
  } else if (saved.length) {
    add('defend', `تحمي ${PIECE[saved[0].type]} في ${saved[0].square} الذي كان في خطر.`, 18);
  }

  // مبادئ استراتيجية.
  const moveNo = before.moveNumber();
  if (m.san.startsWith('O-O')) add('castle', 'التبييت يؤمّن الملك بعيداً عن المركز ويُدخل الطابية إلى اللعب.', 16);
  if (moveNo <= 12 && 'nb'.includes(m.piece) && (m.from[1] === '1' || m.from[1] === '8')) {
    add('develop', `تطوير ${PIECE[m.piece]}: إخراج القطع الصغيرة مبكراً من أهم مبادئ الافتتاح.`, 9);
  }
  if (m.piece === 'p' && CENTER.has(m.to)) add('center', 'تحتل المركز بالبيدق، مما يمنح قطعك مساحة وحرية حركة.', 8);
  else if (m.piece !== 'p' && m.piece !== 'k' && attacksFrom(after, m.to).some((s) => CENTER.has(s))) {
    if (moveNo <= 15) add('center', 'القطعة تراقب مربعات المركز المهمة.', 4);
  }
  if (m.piece === 'r' && isOpenFile(after, m.to[0])) add('openfile', 'الطابية على عمود مفتوح، وهو أقوى مكان لها.', 7);
  if (m.piece === 'p' && isPassed(after, m.to, me)) add('passed', 'بيدق حر يتقدم نحو الترقية ولا يوجد بيدق يمنعه.', 10);
  if (m.piece === 'k' && isEndgame(after) ) add('kingact', 'في النهايات يصبح الملك قطعة مقاتلة؛ تفعيله أمر مهم.', 6);
  if (m.piece === 'n' && isOutpost(after, m.to, me)) add('outpost', 'الحصان على موقع قوي (نقطة ارتكاز) محمي ببيدق ولا يمكن طرده ببيادق الخصم.', 9);

  list.sort((a, b) => b.weight - a.weight);
  return { move: m, list };
}

function isOpenFile(chess, file) {
  for (let r = 1; r <= 8; r++) { const p = chess.get(file + r); if (p && p.type === 'p') return false; }
  return true;
}

function isPassed(chess, sq, color) {
  const [f, r] = sqXY(sq);
  const dir = color === 'w' ? 1 : -1;
  for (let y = r + dir; y >= 0 && y < 8; y += dir) {
    for (let x = f - 1; x <= f + 1; x++) {
      if (x < 0 || x > 7) continue;
      const p = chess.get(sqName(x, y));
      if (p && p.type === 'p' && p.color !== color) return false;
    }
  }
  return true;
}

function isOutpost(chess, sq, color) {
  const [f, r] = sqXY(sq);
  const rel = color === 'w' ? r : 7 - r;
  if (rel < 3 || rel > 5) return false;
  const defended = chess.attackers(sq, color).some((s) => chess.get(s).type === 'p');
  if (!defended) return false;
  const dir = color === 'w' ? 1 : -1;
  for (let y = r + dir; y >= 0 && y < 8; y += dir) {
    for (const x of [f - 1, f + 1]) {
      if (x < 0 || x > 7) continue;
      const p = chess.get(sqName(x, y));
      if (p && p.type === 'p' && p.color !== color) return false;
    }
  }
  return true;
}

export function isEndgame(chess) {
  const heavy = pieces(chess).filter((p) => 'qrbn'.includes(p.type)).reduce((s, p) => s + VAL[p.type], 0);
  return heavy <= 26;
}

// نسبة الفوز من التقييم (نفس صيغة المواقع الشهيرة تقريباً).
export function winPct(cp) {
  const c = Math.max(-2000, Math.min(2000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

export function formatEval(line, whitePov = true, turn = 'w') {
  if (!line) return '0.0';
  let cp = line.cp, mate = line.mate;
  if (whitePov && turn === 'b') { if (cp !== null) cp = -cp; if (mate !== null) mate = -mate; }
  if (mate !== null && mate !== undefined) return (mate > 0 ? '+' : '-') + 'M' + Math.abs(mate);
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);
}

export const GRADES = {
  best: { label: 'أفضل نقلة', icon: '★', cls: 'g-best' },
  excellent: { label: 'ممتازة', icon: '✓✓', cls: 'g-excellent' },
  good: { label: 'جيدة', icon: '✓', cls: 'g-good' },
  book: { label: 'نقلة افتتاح معروفة', icon: '📖', cls: 'g-book' },
  inaccuracy: { label: 'غير دقيقة', icon: '?!', cls: 'g-inacc' },
  mistake: { label: 'خطأ', icon: '?', cls: 'g-mistake' },
  blunder: { label: 'خطأ فادح', icon: '??', cls: 'g-blunder' },
};

function materialSwing(fen, pv, plies = 8) {
  const c = new Chess(fen);
  const me = c.turn();
  const start = material(c, me) - material(c, other(me));
  for (const u of pv.slice(0, plies)) if (!applyUci(c, u)) break;
  return material(c, me) - material(c, other(me)) - start;
}

// شرح أفضل نقلة في الوضع (يُستخدم في التلميح وفي "ماذا ألعب؟").
export function explainBest(fen, line) {
  if (!line || !line.pv.length) return { san: '', html: 'لا توجد نقلات.' };
  const { move, list } = motifs(fen, line.pv[0]);
  const parts = [];
  const top = list.slice(0, 3).map((x) => x.text);
  if (line.mate && line.mate > 0) parts.push(line.mate === 1 ? 'هذه النقلة تعطي كش مات مباشرة!' : `هذه النقلة تبدأ هجوماً ينتهي بكش مات خلال ${line.mate} نقلات.`);
  parts.push(...top);
  const swing = materialSwing(fen, line.pv);
  if (!line.mate && swing >= 2 && !list.some((x) => x.key === 'capture' || x.key === 'fork')) {
    parts.push(`سلسلة النقلات المتوقعة تكسب لك ما يعادل ${swing} نقاط من المادة.`);
  }
  if (!parts.length) parts.push(positionalReason(fen, move));
  const cont = pvToSan(fen, line.pv, 6);
  return {
    san: move ? move.san : line.pv[0],
    from: move && move.from, to: move && move.to,
    text: parts,
    html: `<b>${move ? move.san : ''}</b> — ${move ? describeMove(move) : ''}<ul>${parts.map((p) => `<li>${p}</li>`).join('')}</ul>` +
      (cont.length > 1 ? `<div class="line">التسلسل المتوقع: <span dir="ltr">${cont.join(' ')}</span></div>` : ''),
  };
}

function positionalReason(fen, move) {
  const c = new Chess(fen);
  if (!move) return 'نقلة هادئة تحسّن الوضع.';
  const n = c.moveNumber();
  if (n <= 10) return 'نقلة تتبع مبادئ الافتتاح: تحسين القطع والاستعداد للتبييت.';
  if (move.piece === 'p') return 'نقلة بيدق تحسّن بنية البيادق وتكسب مساحة.';
  if (move.piece === 'k') return 'تحسين موقع الملك.';
  return `تحسين موقع ${PIECE[move.piece]} ليصبح أكثر نشاطاً ويتحكم في مربعات أكثر.`;
}

// مراجعة نقلة اللاعب.
// before: تحليل الوضع قبل النقلة (multipv). playedLine: خط يبدأ بنقلة اللاعب من نفس الوضع
// (من بحث searchmoves) — مقارنة الخطين من نفس الجذر أدق من تحليلين منفصلين.
export function reviewMove(fenBefore, playedUci, before, playedLine, { bookName } = {}) {
  const bestLine = before.lines[0];
  const bestScore = scoreValue(bestLine);
  const same = before.lines.find((l) => l.pv[0] === playedUci);
  const pl = same || playedLine;
  const afterChess = new Chess(fenBefore);
  const played = applyUci(afterChess, playedUci);
  let playedScore;
  if (afterChess.isCheckmate()) playedScore = 100000;
  else if (afterChess.isDraw() || afterChess.isStalemate()) playedScore = 0;
  else if (pl) playedScore = Math.min(scoreValue(pl), bestScore);
  else playedScore = bestScore;
  // خط الخصم بعد نقلة اللاعب (من منظوره).
  const afterLine = pl && pl.pv.length > 1
    ? { cp: pl.cp === null ? null : -pl.cp, mate: pl.mate === null || pl.mate === undefined ? null : -pl.mate, pv: pl.pv.slice(1) }
    : null;

  const lossPct = Math.max(0, winPct(bestScore) - winPct(playedScore));
  const cpLoss = Math.max(0, bestScore - playedScore);
  // في الافتتاح تقييمات المحرك متقاربة ومتذبذبة، لذلك نكون أكثر تسامحاً.
  const k = new Chess(fenBefore).moveNumber() <= 10 ? 1.6 : 1;
  let grade;
  if (bestLine && bestLine.pv[0] === playedUci) grade = 'best';
  else if (bookName && lossPct < 8) grade = 'book';
  else if (lossPct <= 2 * k || cpLoss <= 25) grade = 'excellent';
  else if (lossPct <= 6 * k || cpLoss <= 60) grade = 'good';
  else if (lossPct <= 12 * k) grade = 'inaccuracy';
  else if (lossPct <= 22 * k) grade = 'mistake';
  else grade = 'blunder';
  // تفويت كش مات مضمون ليس نقلة "جيدة" حتى لو بقي الوضع رابحاً.
  if (bestLine && bestLine.mate > 0 && !(playedScore > 50000) && ['excellent', 'good', 'book'].includes(grade)) grade = 'inaccuracy';

  const g = GRADES[grade];
  const html = [];
  html.push(`<div class="grade ${g.cls}"><span>${g.icon}</span> ${g.label}</div>`);
  html.push(`<p>نقلتك <b dir="ltr">${played ? played.san : playedUci}</b>: ${played ? describeMove(played) : ''}.</p>`);
  const mine = motifs(fenBefore, playedUci).list.slice(0, 2).map((x) => x.text);

  if (grade === 'best' || grade === 'excellent' || grade === 'good' || grade === 'book') {
    if (grade === 'best') html.push('<p>أحسنت! هذه النقلة التي يختارها المحرك.</p>');
    if (grade === 'book' && bookName) html.push(`<p>نقلة معروفة في <b>${bookName}</b>.</p>`);
    if (mine.length) html.push(`<ul>${mine.map((t) => `<li>${t}</li>`).join('')}</ul>`);
    if (grade !== 'best' && bestLine && bestLine.pv[0] !== playedUci && lossPct > 1) {
      const eb = explainBest(fenBefore, bestLine);
      html.push(`<details><summary>نقلة أدق قليلاً: <b dir="ltr">${eb.san}</b></summary>${eb.html}</details>`);
    }
  } else {
    // ما المشكلة في نقلة اللاعب؟
    const problems = [];
    if (bestLine && bestLine.mate > 0) problems.push(`فاتتك فرصة كش مات${bestLine.mate > 1 ? ` خلال ${bestLine.mate} نقلات` : ' مباشرة'}!`);
    if (afterLine && afterLine.pv.length && !afterChess.isGameOver()) {
      const fenAfter = afterChess.fen();
      const reply = motifs(fenAfter, afterLine.pv[0]);
      if (afterLine.mate && afterLine.mate > 0) problems.push(`بعد نقلتك يستطيع الخصم أن يعطيك كش مات خلال ${afterLine.mate} نقلات، تبدأ بـ <b dir="ltr">${reply.move ? reply.move.san : ''}</b>.`);
      else if (reply.move) {
        const r = reply.list.filter((x) => ['capture', 'fork', 'pin', 'skewer', 'discovered', 'disc-check', 'promo', 'threat'].includes(x.key)).slice(0, 2);
        if (r.length) problems.push(`يستطيع الخصم الرد بـ <b dir="ltr">${reply.move.san}</b> (${describeMove(reply.move)}): ${r.map((x) => x.text).join(' ')}`);
        const swing = materialSwing(fenAfter, afterLine.pv);
        if (swing >= 2) problems.push(`النتيجة المتوقعة: تخسر ما يعادل ${swing} نقاط من المادة.`);
      }
      const hang = hangingPieces(afterChess, afterChess.turn() === 'w' ? 'b' : 'w');
      if (hang.length && !problems.length) problems.push(`تركت ${PIECE[hang[0].type]} في ${hang[0].square} بدون حماية كافية.`);
    }
    if (!problems.length) {
      problems.push(grade === 'inaccuracy'
        ? 'النقلة مقبولة وليست خطأً كبيراً، لكن توجد نقلة أدق تمنحك أفضلية أكبر.'
        : 'النقلة تضعف موقفك مقارنة بالبدائل المتاحة، وتعطي الخصم أفضلية.');
    }
    html.push(`<p class="problem">⚠️ ${problems.join('<br>')}</p>`);
    if (bestLine) {
      const eb = explainBest(fenBefore, bestLine);
      html.push(`<div class="better"><p>✅ النقلة الأفضل كانت:</p>${eb.html}</div>`);
    }
  }
  return { grade, lossPct, playedScore, bestScore, best: bestLine && bestLine.pv[0], html: html.join('') };
}

// تعليق على نقلة الخصم: ما الذي يهدده الآن؟
export function explainOpponentMove(fenBefore, uci) {
  const { move, list } = motifs(fenBefore, uci);
  if (!move) return '';
  const dangerous = list.filter((x) => ['mate', 'fork', 'pin', 'skewer', 'discovered', 'disc-check', 'threat', 'check', 'capture', 'promo'].includes(x.key)).slice(0, 2);
  let s = `الخصم لعب <b dir="ltr">${move.san}</b>: ${describeMove(move)}.`;
  if (dangerous.length) s += ` <span class="warn">انتبه: ${dangerous.map((x) => x.text).join(' ')}</span>`;
  const c = new Chess(fenBefore);
  applyUci(c, uci);
  const myHanging = hangingPieces(c, c.turn());
  if (myHanging.length) s += ` <span class="warn">قطعة مهددة: ${PIECE[myHanging[0].type]} في ${myHanging[0].square}.</span>`;
  return s;
}

// نصائح عن الخطة في الوضع الحالي للطرف صاحب الدور.
export function planAdvice(fen) {
  const c = new Chess(fen);
  const me = c.turn();
  const tips = [];
  const n = c.moveNumber();
  const backRank = me === 'w' ? '1' : '8';
  const undeveloped = pieces(c, me).filter((p) => 'nb'.includes(p.type) && p.square[1] === backRank);
  const k = pieces(c, me).find((p) => p.type === 'k');
  const castled = k && (k.square[0] === 'g' || k.square[0] === 'c' || k.square[0] === 'b' || k.square[0] === 'h');
  const endgame = isEndgame(c);
  const diff = material(c, me) - material(c, other(me));

  if (diff >= 3) tips.push(`أنت متقدم مادياً بـ ${diff} نقاط: بسّط اللعب بتبادل القطع (وليس البيادق) لتصل إلى نهاية رابحة.`);
  else if (diff <= -3) tips.push(`أنت متأخر مادياً بـ ${-diff} نقاط: تجنب التبادلات وابحث عن الهجوم وتعقيد الوضع.`);

  const hang = hangingPieces(c, me);
  if (hang.length) tips.push(`أولاً: ${PIECE[hang[0].type]} في ${hang[0].square} مهدد، احمه أو حركه.`);
  const theirHang = hangingPieces(c, other(me));
  if (theirHang.length) tips.push(`فرصة: ${PIECE[theirHang[0].type]} الخصم في ${theirHang[0].square} ضعيف الحماية، هل يمكنك أخذه بأمان؟`);

  if (!endgame) {
    if (n <= 15 && undeveloped.length) tips.push(`طوّر قطعك الصغيرة المتبقية (${undeveloped.map((p) => PIECE[p.type] + ' ' + p.square).join('، ')}) قبل مهاجمة الخصم.`);
    if (!castled && k && k.square[0] === 'e' && n >= 5) tips.push('ملكك ما زال في المركز؛ فكّر في التبييت قريباً لحمايته.');
    const rooks = pieces(c, me).filter((p) => p.type === 'r');
    const open = FILES.split('').filter((f) => isOpenFile(c, f));
    if (rooks.length && open.length && !rooks.some((r) => open.includes(r.square[0]))) tips.push(`يوجد عمود مفتوح (${open.join('، ')}): ضع طابيتك عليه للسيطرة.`);
    if (n <= 12) tips.push('في الافتتاح: سيطر على المركز، طوّر الأحصنة قبل الفيلة، لا تحرك نفس القطعة مرتين بلا سبب، ولا تخرج الوزير مبكراً.');
    else tips.push('في وسط اللعب: ابحث عن أضعف نقطة عند الخصم (قطعة غير محمية، ملك مكشوف، بيدق ضعيف) ووجه قطعك نحوها. قبل كل نقلة اسأل: ما الذي يهدده خصمي؟');
  } else {
    tips.push('في النهاية: فعّل ملكك وقرّبه من المركز، وادفع البيادق الحرة، وضع الطوابي خلف البيادق الحرة.');
    const passed = pieces(c, me).filter((p) => p.type === 'p' && isPassed(c, p.square, me));
    if (passed.length) tips.push(`لديك بيدق حر في ${passed.map((p) => p.square).join('، ')}: ادعمه بقطعك وادفعه نحو الترقية.`);
  }
  return tips;
}

// كتاب افتتاحات مختصر بأسماء عربية وفكرة كل افتتاح.
export const OPENINGS = [
  { moves: 'e4 e5 Nf3 Nc6 Bb5', name: 'الافتتاح الإسباني (روي لوبيز)', idea: 'الفيل يضغط على الحصان المدافع عن بيدق e5، وخطة الأبيض بناء مركز قوي بـ c3 و d4.' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5', name: 'جوكو بيانو (الإيطالي الهادئ)', idea: 'الفيلان يستهدفان النقطتين الضعيفتين f7 و f2، ويبني الأبيض المركز بـ c3 ثم d4.' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6', name: 'دفاع الحصانين', idea: 'الأسود يهاجم بيدق e4 مباشرة بدل الدفاع السلبي؛ احذر من هجوم Ng5 على f7.' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4', name: 'الافتتاح الإيطالي', idea: 'تطوير سريع والتصويب على f7 الضعيفة المحمية بالملك فقط.' },
  { moves: 'e4 e5 Nf3 Nc6 d4', name: 'الافتتاح الأسكتلندي', idea: 'الأبيض يفتح المركز فوراً ليحصل على لعب حر للقطع.' },
  { moves: 'e4 e5 Nf3 Nc6 Nc3 Nf6', name: 'افتتاح الأحصنة الأربعة', idea: 'تطوير متناظر وهادئ؛ مناسب لتعلّم مبادئ الافتتاح.' },
  { moves: 'e4 e5 Nf3 Nf6', name: 'الدفاع الروسي (بتروف)', idea: 'الأسود يرد بالهجوم المضاد على e4؛ دفاع صلب جداً.' },
  { moves: 'e4 e5 Nf3 d6', name: 'دفاع فيليدور', idea: 'الأسود يحمي e5 بالبيدق؛ صلب لكنه سلبي قليلاً.' },
  { moves: 'e4 e5 f4', name: 'غامبيت الملك', idea: 'الأبيض يضحي ببيدق لفتح العمود f والهجوم السريع؛ افتتاح رومانسي حاد.' },
  { moves: 'e4 e5 Nc3', name: 'افتتاح فيينا', idea: 'الأبيض يطور الحصان ويستعد لـ f4 أحياناً.' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', name: 'الصقلي - نايدورف', idea: 'أشهر نظام في الصقلي؛ a6 تمنع Nb5 وتجهز لـ e5 أو b5.' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', name: 'الصقلي - التنين', idea: 'الفيل على g7 يضرب القطر الطويل؛ مباريات حادة بتبييت متعاكس.' },
  { moves: 'e4 c5', name: 'الدفاع الصقلي', idea: 'الأسود يحارب على d4 من الجناح ويخلق وضعاً غير متناظر؛ أكثر رد مقاتل على e4.' },
  { moves: 'e4 e6', name: 'الدفاع الفرنسي', idea: 'الأسود يستعد لـ d5 ليضرب مركز الأبيض؛ بنية صلبة لكن الفيل الأبيض الخانات محبوس.' },
  { moves: 'e4 c6', name: 'دفاع كارو-كان', idea: 'مثل الفرنسي لكن يُبقي الفيل حراً؛ دفاع متين جداً.' },
  { moves: 'e4 d5', name: 'الدفاع الإسكندنافي', idea: 'الأسود يتحدى e4 فوراً؛ الوزير يخرج مبكراً لكنه يعود لمكان آمن.' },
  { moves: 'e4 Nf6', name: 'دفاع ألخين', idea: 'استفزاز البيادق البيضاء للتقدم ثم مهاجمتها كأهداف.' },
  { moves: 'e4 d6', name: 'دفاع بيرتس', idea: 'الأسود يبني بتأنٍ مع فيل على g7 ويضرب المركز لاحقاً.' },
  { moves: 'e4 g6', name: 'الدفاع الحديث', idea: 'مرن جداً؛ الأسود يترك المركز للأبيض ثم يهاجمه.' },
  { moves: 'e4 e5', name: 'افتتاح البيدق الملكي المفتوح', idea: 'كل طرف يحتل المركز ببيدق؛ طوّر الحصان والفيل بسرعة.' },
  { moves: 'd4 d5 c4 dxc4', name: 'غامبيت الوزير المقبول', idea: 'الأسود يأخذ البيدق مؤقتاً ليطور قطعه بحرية ثم يرده غالباً.' },
  { moves: 'd4 d5 c4 e6', name: 'غامبيت الوزير المرفوض', idea: 'الأسود يحافظ على d5 ببنية صلبة؛ من أعرق الدفاعات.' },
  { moves: 'd4 d5 c4 c6', name: 'الدفاع السلافي', idea: 'يحمي d5 بالبيدق c مع إبقاء الفيل الأبيض الخانات حراً.' },
  { moves: 'd4 d5 c4', name: 'غامبيت الوزير', idea: 'الأبيض يقدم بيدق c لإبعاد بيدق d5 عن المركز.' },
  { moves: 'd4 d5 Bf4', name: 'نظام لندن', idea: 'نظام ثابت سهل: Bf4 و e3 و Nf3 و c3؛ خطة واضحة ضد أي دفاع.' },
  { moves: 'd4 Nf6 Bf4', name: 'نظام لندن', idea: 'نظام ثابت سهل: Bf4 و e3 و Nf3 و c3؛ خطة واضحة ضد أي دفاع.' },
  { moves: 'd4 Nf6 c4 e6 Nc3 Bb4', name: 'الدفاع الهندي - نيمزو', idea: 'الفيل يثبت الحصان ويضغط على e4؛ مستعد لإعطاء الفيل مقابل إفساد بيادق الأبيض.' },
  { moves: 'd4 Nf6 c4 g6 Nc3 d5', name: 'دفاع غرونفيلد', idea: 'الأسود يسمح للأبيض ببناء مركز كبير ثم يهاجمه بالقطع.' },
  { moves: 'd4 Nf6 c4 g6', name: 'الدفاع الهندي الملكي', idea: 'الأسود يبيّت بسرعة ثم يهاجم المركز بـ e5 أو c5، ومباريات هجومية على الملك.' },
  { moves: 'd4 Nf6 c4 c5', name: 'دفاع بينوني', idea: 'بنية غير متناظرة؛ الأسود يلعب على الجناح الوزيري بـ b5.' },
  { moves: 'd4 Nf6 c4 e6', name: 'الدفاعات الهندية', idea: 'الأسود يراقب e4 بالقطع قبل تحديد بنية البيادق.' },
  { moves: 'd4 f5', name: 'الدفاع الهولندي', idea: 'الأسود يسيطر على e4 ويستعد لهجوم على الجناح الملكي.' },
  { moves: 'd4 d5', name: 'افتتاح البيدق الوزيري المغلق', idea: 'لعب استراتيجي هادئ؛ الصراع على المربعات e4 و c4.' },
  { moves: 'd4 Nf6', name: 'الدفاعات الهندية', idea: 'الأسود يراقب e4 بالحصان قبل تحديد بنية البيادق.' },
  { moves: 'c4', name: 'الافتتاح الإنجليزي', idea: 'الأبيض يسيطر على d5 من الجناح؛ لعب مرن وموضعي.' },
  { moves: 'Nf3', name: 'افتتاح ريتي', idea: 'تطوير مرن يؤجل احتلال المركز بالبيادق.' },
  { moves: 'e4', name: 'افتتاح البيدق الملكي', idea: 'يحتل المركز ويفتح الطريق للوزير والفيل. أكثر نقلة أولى شعبية.' },
  { moves: 'd4', name: 'افتتاح البيدق الوزيري', idea: 'يحتل المركز والبيدق محمي بالوزير؛ يقود لمباريات استراتيجية.' },
];

export function detectOpening(sanHistory) {
  const seq = sanHistory.join(' ');
  let best = null;
  for (const o of OPENINGS) {
    if ((seq === o.moves || seq.startsWith(o.moves + ' ')) && (!best || o.moves.length > best.moves.length)) best = o;
  }
  return best;
}

// هل النقلة الأخيرة جزء من خط افتتاح معروف؟
export function isBookMove(sanHistory) {
  const seq = sanHistory.join(' ');
  return OPENINGS.some((o) => o.moves === seq || o.moves.startsWith(seq + ' '));
}

export { side };
