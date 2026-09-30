import { Chess } from '../lib/chess.js';
import { Board, loadSprite, pieceSvg } from './board.js';
import { Engine, LEVELS, scoreValue } from './engine.js';
import * as Coach from './coach.js';
import { LESSON_GROUPS } from './lessons.js';
import { OnlineGame, parseCode } from './online.js';

// رابط نسخة الويب المستخدمة في روابط الدعوة عند التشغيل من داخل التطبيق.
const WEB_BASE = 'https://omairsalii.github.io/shatranj-coach/';

const $ = (s) => document.querySelector(s);
const other = (c) => (c === 'w' ? 'b' : 'w');
const colorName = (c) => (c === 'w' ? 'الأبيض' : 'الأسود');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Bridge = window.AndroidBridge;

// ---------- الإعدادات ----------
const DEFAULTS = { name: 'لاعب', sound: true, showEval: true, aiLevel: 3, coachLevel: 2, aiHints: true, coachComments: true };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('chess-settings') || '{}') }; } catch { /* تجاهل */ }
function saveSettings() { try { localStorage.setItem('chess-settings', JSON.stringify(settings)); } catch { /* تجاهل */ } }

// ---------- المحركات ----------
let playerEngine = null;
let analystEngine = null;
const player = () => (playerEngine ||= new Engine());
const analyst = () => (analystEngine ||= new Engine());

// ---------- الأصوات ----------
let audioCtx = null;
function sound(kind) {
  if (!settings.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const f = { move: 520, capture: 330, check: 760, end: 440 }[kind] || 520;
    o.frequency.value = f;
    o.type = kind === 'capture' ? 'square' : 'sine';
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (kind === 'end' ? 0.6 : 0.12));
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + (kind === 'end' ? 0.6 : 0.13));
  } catch { /* تجاهل */ }
}

// ---------- أدوات الواجهة ----------
const screenStack = ['home'];
function show(id, push = true) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (push && screenStack[screenStack.length - 1] !== id) screenStack.push(id);
  window.scrollTo(0, 0);
}

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

let modalOnClose = null;
function openModal(html, onClose) {
  $('#modalBox').innerHTML = html;
  $('#modal').classList.remove('hidden');
  modalOnClose = onClose || null;
  return $('#modalBox');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  const cb = modalOnClose;
  modalOnClose = null;
  if (cb) cb();
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function confirmBox(text, yes = 'نعم', no = 'لا') {
  return new Promise((resolve) => {
    const box = openModal(`<p style="line-height:1.8">${text}</p><div class="row"><button class="btn" data-r="1">${yes}</button><button class="btn secondary" data-r="0">${no}</button></div>`, () => resolve(false));
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { modalOnClose = null; closeModal(); resolve(b.dataset.r === '1'); }));
  });
}

function segHtml(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
}
function wireSegs(box) {
  box.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  }));
}
const segVal = (box, name) => box.querySelector(`[data-seg="${name}"] .on`)?.dataset.v;

function levelOptions(sel) {
  return LEVELS.map((l, i) => `<option value="${i}" ${i === +sel ? 'selected' : ''}>${i + 1} - ${l.name}</option>`).join('');
}

// ---------- حالة المباراة ----------
let G = null;
let gameToken = 0;
const board = new Board($('#board'), {
  onMove: (m) => onUserMove(m),
  canMove: (color) => canHumanMove(color),
});

function canHumanMove(color) {
  if (!G || G.over || G.viewing) return false;
  if (G.mode === 'local') return true;
  if (G.mode === 'online') return G.started && color === G.myColor && G.net && G.connected;
  return color === G.myColor && !G.aiThinking;
}

function newGame(opts) {
  if (G && G.net && G.mode === 'online' && opts.mode !== 'online') { G.net.close(); }
  if (playerEngine) playerEngine.cancelAll();
  if (analystEngine) analystEngine.cancelAll();
  gameToken++;
  G = {
    mode: opts.mode,
    chess: new Chess(),
    myColor: opts.myColor || 'w',
    level: opts.level ?? 3,
    hintsMe: !!opts.hintsMe,
    hintsOpp: !!opts.hintsOpp,
    over: false,
    lastMove: null,
    reviews: {},
    pre: null,
    names: opts.names || {},
    token: gameToken,
    net: opts.net || null,
    connected: false,
    started: opts.mode !== 'online',
    hintCount: 0,
    viewing: false,
  };
  $('#coachFeed').innerHTML = '';
  $('#openingName').textContent = '';
  board.setArrows([]);
  board.setMarks({});
  board.setOrientation(G.mode === 'local' ? 'w' : G.myColor);
  const titles = { ai: `ضد الكمبيوتر — ${LEVELS[G.level].name}`, coach: 'التدريب مع المدرب', online: 'مباراة مع صديق', local: 'لاعبان على جهاز واحد' };
  $('#gameTitle').textContent = titles[G.mode];
  setupControls();
  show('game');
  update();
  if (G.mode === 'coach') {
    coachSay(`<b>مرحباً بك في التدريب!</b> ستلعب بالقطع ${G.myColor === 'w' ? 'البيضاء' : 'السوداء'} ضد مستوى <b>${LEVELS[G.level].name}</b>.<br>بعد كل نقلة سأخبرك هل هي جيدة أم خاطئة، ولماذا، وما النقلة الأفضل. استخدم <b>💡 تلميح</b> لمعرفة أفضل نقلة مع شرحها، و<b>🧭 ما الخطة؟</b> لتعرف ماذا تفعل في الوضع الحالي.`);
  }
  afterPositionChange();
}

function setupControls() {
  const m = G.mode;
  const hintsOn = hintsAvailable();
  $('#hintBtn').classList.toggle('hidden', !hintsOn && m !== 'online');
  $('#hintBtn').disabled = !hintsOn;
  $('#planBtn').classList.toggle('hidden', !(m === 'coach' || ((m === 'ai' || m === 'online') && hintsOn)));
  $('#undoBtn').classList.toggle('hidden', m === 'online');
  $('#drawBtn').classList.toggle('hidden', m === 'local' || m === 'coach');
  $('#onlinePanel').classList.toggle('hidden', !(m === 'online' && G.net && G.net.isHost));
  $('#coachPanel').classList.toggle('hidden', m === 'local');
  $('#evalBar').classList.toggle('hidden', !showEvalBar());
  $('#netStatus').textContent = '';
  if (m === 'online' && G.net && G.net.isHost) {
    $('#oppHintsToggle').checked = G.hintsOpp;
    $('#myHintsToggle').checked = G.hintsMe;
  }
}

function hintsAvailable() {
  if (!G) return false;
  if (G.mode === 'coach') return true;
  if (G.mode === 'local') return false;
  return G.hintsMe;
}
function showEvalBar() {
  if (!G || !settings.showEval) return false;
  if (G.mode === 'online') return false;
  if (G.mode === 'ai') return G.hintsMe;
  return G.mode === 'coach' || G.mode === 'local';
}

$('#oppHintsToggle').addEventListener('change', (e) => {
  if (!G || !G.net) return;
  G.hintsOpp = e.target.checked;
  G.net.send({ t: 'hints', allowed: G.hintsOpp });
  toast(G.hintsOpp ? 'تم تفعيل التلميحات للخصم' : 'تم إيقاف التلميحات للخصم');
});
$('#myHintsToggle').addEventListener('change', (e) => {
  if (!G) return;
  G.hintsMe = e.target.checked;
  setupControls();
  if (!G.hintsMe) board.setArrows([]);
});

function playerName(color) {
  if (!G) return '';
  if (G.mode === 'local') return colorName(color);
  if (color === G.myColor) return settings.name || 'أنت';
  if (G.mode === 'online') return G.names.opp || 'الصديق';
  return `الكمبيوتر (${LEVELS[G.level].name})`;
}

function capturedHtml(color) {
  // القطع التي أسرها صاحب هذا اللون.
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const count = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const row of G.chess.board()) for (const p of row) if (p && p.color === other(color) && p.type !== 'k') count[p.type]++;
  let html = '';
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const n = Math.max(0, start[t] - count[t]);
    for (let i = 0; i < n; i++) html += pieceSvg(other(color), t);
  }
  const diff = Coach.material(G.chess, color) - Coach.material(G.chess, other(color));
  if (diff > 0) html += `<em>+${diff}</em>`;
  return html;
}

function update() {
  if (!G) return;
  const top = board.orientation === 'w' ? 'b' : 'w';
  const bottom = other(top);
  const turn = G.chess.turn();
  for (const [el, c] of [[$('#playerTop'), top], [$('#playerBottom'), bottom]]) {
    const n = el.querySelector('.name');
    n.textContent = playerName(c) + (G.mode !== 'local' ? ` (${colorName(c)})` : '');
    n.classList.toggle('turn', !G.over && turn === c);
    el.querySelector('.caps').innerHTML = capturedHtml(c);
  }
  $('#evalBar').classList.toggle('flipped', board.orientation === 'b');
  renderMoves();
  let st = '';
  if (G.over) st = G.resultText;
  else if (G.mode === 'online' && !G.started) st = 'بانتظار الخصم…';
  else if (G.chess.inCheck()) st = `كش! دور ${colorName(turn)}`;
  else if (G.mode === 'local') st = `دور ${colorName(turn)}`;
  else st = turn === G.myColor ? 'دورك' : (G.mode === 'online' ? 'دور الخصم' : 'الكمبيوتر يفكر…');
  $('#status').textContent = st;
  $('#undoBtn').disabled = G.mode === 'online' || G.chess.history().length === 0;
  $('#resignBtn').disabled = G.over || (G.mode === 'online' && !G.started);
  $('#drawBtn').disabled = G.over || (G.mode === 'online' && !G.started);
  const op = Coach.detectOpening(G.chess.history());
  $('#openingName').textContent = op ? op.name : '';
}

function renderMoves() {
  const h = G.chess.history({ verbose: true });
  const el = $('#moveList');
  let html = '';
  h.forEach((m, i) => {
    if (i % 2 === 0) html += `<span class="no">${i / 2 + 1}.</span>`;
    const r = G.reviews[i];
    const icon = r ? `<b class="${Coach.GRADES[r.grade].cls}" style="border-radius:4px;padding:0 3px">${Coach.GRADES[r.grade].icon}</b>` : '';
    html += `<span class="mv ${i === h.length - 1 ? 'cur' : ''}" data-ply="${i}">${m.san}${icon}</span>`;
  });
  el.innerHTML = html || '<span class="no">لا توجد نقلات بعد</span>';
  el.scrollLeft = el.scrollWidth;
}

function coachSay(html, { actions } = {}) {
  const feed = $('#coachFeed');
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = html;
  if (actions && actions.length) {
    const a = document.createElement('div');
    a.className = 'actions';
    for (const [label, fn] of actions) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      a.appendChild(b);
    }
    div.appendChild(a);
  }
  feed.prepend(div);
  return div;
}

function setEval(line, turn) {
  if (!line) return;
  let s = scoreValue(line);
  if (turn === 'b') s = -s;
  const pct = Coach.winPct(s);
  $('#evalBar .fill').style.height = pct + '%';
  $('#evalBar span').textContent = Coach.formatEval(line, true, turn).replace('+', '');
}

// ---------- منطق اللعب ----------
function afterPositionChange() {
  if (!G) return;
  board.set(G.chess, G.lastMove);
  update();
  if (checkGameOver()) return;
  const token = G.token;
  const fen = G.chess.fen();
  const turn = G.chess.turn();
  if ((G.mode === 'ai' || G.mode === 'coach') && turn !== G.myColor) {
    aiMove(token);
  } else if (G.mode === 'coach' || (G.mode === 'ai' && showEvalBar()) || (G.mode === 'local' && showEvalBar())) {
    G.pre = { fen, p: analyst().analyse(fen, PRE_OPTS) };
    G.pre.p.then((r) => { if (G && G.token === token && r.lines[0]) setEval(r.lines[0], turn); });
  }
}

function checkGameOver() {
  const c = G.chess;
  let text = null, winner = null;
  if (c.isCheckmate()) { winner = other(c.turn()); text = `كش مات! فاز ${colorName(winner)}`; }
  else if (c.isStalemate()) text = 'تعادل: جمود (لا توجد نقلات قانونية)';
  else if (c.isInsufficientMaterial()) text = 'تعادل: المادة غير كافية للمات';
  else if (c.isThreefoldRepetition()) text = 'تعادل: تكرار الوضع ثلاث مرات';
  else if (c.isDrawByFiftyMoves()) text = 'تعادل: قاعدة الخمسين نقلة';
  if (!text) return false;
  endGame(text, winner);
  return true;
}

function endGame(text, winner) {
  if (G.over) return;
  G.over = true;
  G.resultText = text;
  sound('end');
  update();
  let head = text;
  if (G.mode !== 'local' && winner) head = winner === G.myColor ? `🏆 ${text} — أحسنت!` : `😔 ${text}`;
  setTimeout(() => showGameOverModal(head), 500);
}

function showGameOverModal(head) {
  const canReview = G.chess.history().length >= 2;
  const box = openModal(`<h2>انتهت المباراة</h2><p style="font-size:17px">${head}</p>
    ${canReview ? '<button class="btn block" data-a="review">🎓 مراجعة المباراة مع المدرب</button>' : ''}
    ${G.mode === 'online' ? '<button class="btn block secondary" data-a="rematch">🔁 طلب مباراة جديدة</button>' : '<button class="btn block secondary" data-a="again">🔁 مباراة جديدة</button>'}
    <button class="btn block secondary" data-a="close">إغلاق</button>`);
  box.querySelector('[data-a="review"]')?.addEventListener('click', () => { closeModal(); reviewGame(); });
  box.querySelector('[data-a="again"]')?.addEventListener('click', () => { closeModal(); newGame({ ...G, level: G.level, myColor: G.myColor, names: G.names }); });
  box.querySelector('[data-a="rematch"]')?.addEventListener('click', () => { closeModal(); requestRematch(); });
  box.querySelector('[data-a="close"]').addEventListener('click', closeModal);
}

function onUserMove({ from, to, promotion }) {
  if (!G || !canHumanMove(G.chess.turn())) return;
  const fenBefore = G.chess.fen();
  let move;
  try { move = G.chess.move({ from, to, promotion }); } catch { return; }
  if (!move) return;
  const uci = from + to + (promotion || '');
  G.lastMove = { from, to };
  board.setArrows([]);
  playMoveSound(move);
  if (G.mode === 'online') G.net.send({ t: 'move', uci, ply: G.chess.history().length - 1 });
  if (G.mode === 'coach') reviewUserMove(fenBefore, uci, G.chess.history().length - 1);
  afterPositionChange();
}

function playMoveSound(move) {
  if (G.chess.inCheck()) sound('check');
  else if (move.captured) sound('capture');
  else sound('move');
}

const PRE_OPTS = { depth: 13, multipv: 4 };

// تقييم نقلة اللاعب من نفس الجذر (searchmoves) إن لم تكن ضمن أفضل الخطوط.
async function analysePlayed(fenBefore, uci, before, depth = 13) {
  const same = before.lines.find((l) => l.pv[0] === uci);
  if (same) return same;
  const c = new Chess(fenBefore);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  if (c.isGameOver()) return null;
  const r = await analyst().analyse(fenBefore, { depth, searchmoves: uci });
  return r.lines[0] || null;
}

async function reviewUserMove(fenBefore, uci, ply) {
  const token = G.token;
  const history = G.chess.history();
  const thinking = coachSay('<span class="thinking">المدرب يحلل نقلتك…</span>');
  const pre = G.pre && G.pre.fen === fenBefore ? G.pre.p : analyst().analyse(fenBefore, PRE_OPTS);
  const before = await pre;
  const playedLine = await analysePlayed(fenBefore, uci, before);
  if (!G || G.token !== token) { thinking.remove(); return; }
  const sanHist = history.slice(0, ply + 1);
  const op = Coach.isBookMove(sanHist) ? Coach.detectOpening(sanHist) : null;
  const r = Coach.reviewMove(fenBefore, uci, before, playedLine, { bookName: op && op.name });
  G.reviews[ply] = r;
  renderMoves();
  let extra = '';
  if (op && Coach.detectOpening(sanHist) && ply < 14 && !G.announcedOpening?.[op.name]) {
    G.announcedOpening = { ...(G.announcedOpening || {}), [op.name]: true };
    extra = `<div class="line">📖 <b>${op.name}</b>: ${op.idea}</div>`;
  }
  const actions = [];
  if (['mistake', 'blunder', 'inaccuracy'].includes(r.grade) && !G.over) {
    actions.push(['↩️ تراجع وجرّب مرة أخرى', () => takeBackTo(ply, r.best)]);
  }
  thinking.innerHTML = r.html + extra;
  if (actions.length) {
    const a = document.createElement('div');
    a.className = 'actions';
    for (const [label, fn] of actions) { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; a.appendChild(b); }
    thinking.appendChild(a);
  }
}

// الرجوع إلى ما قبل نقلة اللاعب رقم ply وإظهار سهم أفضل نقلة.
function takeBackTo(ply, bestUci) {
  if (!G) return;
  if (playerEngine) playerEngine.cancelAll();
  if (analystEngine) analystEngine.cancelAll();
  while (G.chess.history().length > ply) G.chess.undo();
  for (const k of Object.keys(G.reviews)) if (+k >= ply) delete G.reviews[k];
  G.over = false;
  G.token = ++gameToken;
  G.aiThinking = false;
  const h = G.chess.history({ verbose: true });
  G.lastMove = h.length ? { from: h[h.length - 1].from, to: h[h.length - 1].to } : null;
  afterPositionChange();
  if (bestUci) {
    const show = () => {
      board.setArrows([{ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), color: 'green' }]);
      coachSay(`حسناً، رجعنا. فكّر مرة أخرى… السهم الأخضر يوضح النقلة الأفضل إن احتجت إليها.`);
    };
    coachSay('حاول أن تجد نقلة أفضل بنفسك أولاً.', { actions: [['أظهر النقلة الأفضل', show]] });
  }
}

async function aiMove(token) {
  const fen = G.chess.fen();
  G.aiThinking = true;
  update();
  const lvl = LEVELS[G.level];
  const lowLevel = G.level <= 1;
  const started = Date.now();
  const res = await player().analyse(fen, { skill: lvl.skill, depth: lvl.depth, movetime: lvl.movetime * 3, multipv: lowLevel ? 4 : 1 });
  const wait = Math.max(0, 450 - (Date.now() - started));
  if (wait) await sleep(wait);
  if (!G || G.token !== token || G.chess.fen() !== fen || G.over) return;
  G.aiThinking = false;
  let uci = res.bestmove;
  // المستويات الدنيا ترتكب أخطاء بشرية أحياناً.
  if (lowLevel) {
    const r = Math.random();
    const chance = G.level === 0 ? 0.35 : 0.15;
    if (r < chance) {
      const legal = G.chess.moves({ verbose: true });
      const m = legal[Math.floor(Math.random() * legal.length)];
      uci = m.from + m.to + (m.promotion || '');
    } else if (res.lines.length > 1 && Math.random() < 0.5) {
      uci = res.lines[Math.floor(Math.random() * res.lines.length)].pv[0];
    }
  }
  if (!uci) return;
  let move;
  try { move = G.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return; }
  G.lastMove = { from: move.from, to: move.to };
  playMoveSound(move);
  if (G.mode === 'coach' && settings.coachComments) {
    const txt = Coach.explainOpponentMove(fen, uci);
    if (txt) coachSay(txt);
  }
  afterPositionChange();
}

async function showHint() {
  if (!G || G.over || !hintsAvailable()) return;
  const turn = G.chess.turn();
  if (G.mode !== 'local' && turn !== G.myColor) { toast('انتظر دورك لطلب تلميح'); return; }
  const fen = G.chess.fen();
  const token = G.token;
  $('#hintBtn').disabled = true;
  const msg = coachSay('<span class="thinking">أبحث عن أفضل نقلة…</span>');
  const pre = G.pre && G.pre.fen === fen ? G.pre.p : analyst().analyse(fen, PRE_OPTS);
  const res = await pre;
  $('#hintBtn').disabled = !hintsAvailable();
  if (!G || G.token !== token || G.chess.fen() !== fen) { msg.remove(); return; }
  const line = res.lines[0];
  if (!line) { msg.innerHTML = 'لا توجد نقلات.'; return; }
  G.hintCount++;
  const ex = Coach.explainBest(fen, line);
  const arrows = [{ from: line.pv[0].slice(0, 2), to: line.pv[0].slice(2, 4), color: 'green' }];
  if (res.lines[1]) arrows.push({ from: res.lines[1].pv[0].slice(0, 2), to: res.lines[1].pv[0].slice(2, 4), color: 'blue', opacity: 0.5 });
  board.setArrows(arrows);
  let alt = '';
  if (res.lines[1]) alt = `<div class="line">بديل جيد (السهم الأزرق): <b dir="ltr">${Coach.uciToSan(fen, res.lines[1].pv[0])}</b></div>`;
  msg.innerHTML = `💡 <b>التلميح:</b> ${ex.html}${alt}`;
}

function showPlan() {
  if (!G || G.over) return;
  const tips = Coach.planAdvice(G.chess.fen());
  const op = Coach.detectOpening(G.chess.history());
  let html = '🧭 <b>الخطة المقترحة الآن:</b><ul>' + tips.map((t) => `<li>${t}</li>`).join('') + '</ul>';
  if (op && G.chess.history().length < 16) html += `<div class="line">📖 ${op.name}: ${op.idea}</div>`;
  coachSay(html);
}

function undoMove() {
  if (!G || G.mode === 'online') return;
  const h = G.chess.history().length;
  if (!h) return;
  if (G.mode === 'local') takeBackTo(h - 1);
  else {
    let target = h - 1;
    // نرجع حتى يعود الدور للاعب.
    const c = new Chess();
    const hist = G.chess.history();
    for (let i = 0; i < target; i++) c.move(hist[i]);
    if (c.turn() !== G.myColor) target--;
    takeBackTo(Math.max(0, target));
  }
  G.over = false;
  update();
}

async function resign() {
  if (!G || G.over) return;
  if (!(await confirmBox('هل تريد الاستسلام؟'))) return;
  if (G.mode === 'online') G.net.send({ t: 'resign' });
  const loser = G.mode === 'local' ? G.chess.turn() : G.myColor;
  endGame(`استسلم ${G.mode === 'local' ? colorName(loser) : 'اللاعب ' + playerName(loser)} — فاز ${colorName(other(loser))}`, other(loser));
}

async function offerDraw() {
  if (!G || G.over) return;
  if (G.mode === 'online') {
    G.net.send({ t: 'draw-offer' });
    toast('تم إرسال عرض التعادل');
    return;
  }
  if (G.mode === 'ai') {
    toast('الكمبيوتر يفكر في عرضك…');
    const res = await analyst().analyse(G.chess.fen(), { depth: 12 });
    const s = scoreValue(res.lines[0]) * (G.chess.turn() === G.myColor ? -1 : 1);
    if (s <= 40 && G.chess.history().length > 20) endGame('تعادل بالاتفاق', null);
    else toast('الكمبيوتر رفض التعادل ويريد مواصلة اللعب');
  }
}

// ---------- مراجعة المباراة ----------
async function reviewGame() {
  const hist = G.chess.history({ verbose: true });
  const token = G.token;
  const box = openModal('<h2>مراجعة المباراة</h2><p>المدرب يحلل كل النقلات… <b id="rvProg">0%</b></p>');
  const c = new Chess();
  const fens = [c.fen()];
  for (const m of hist) { c.move(m.san); fens.push(c.fen()); }
  const sides = G.mode === 'local' ? ['w', 'b'] : [G.myColor];
  const analyses = [];
  const played = [];
  for (let i = 0; i < hist.length; i++) {
    const m = hist[i];
    if (sides.includes(m.color)) {
      const uci = m.from + m.to + (m.promotion || '');
      analyses[i] = await analyst().analyse(fens[i], { depth: 11, multipv: 3 });
      played[i] = await analysePlayed(fens[i], uci, analyses[i], 11);
    }
    const p = box.querySelector('#rvProg');
    if (p) p.textContent = Math.round(((i + 1) / hist.length) * 100) + '%';
    if (!G || G.token !== token) return;
  }
  closeModal();
  const counts = { best: 0, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  const items = [];
  let lossSum = 0, n = 0;
  hist.forEach((m, i) => {
    if (!sides.includes(m.color)) return;
    const uci = m.from + m.to + (m.promotion || '');
    const sanHist = hist.slice(0, i + 1).map((x) => x.san);
    const op = Coach.isBookMove(sanHist) ? Coach.detectOpening(sanHist) : null;
    const r = Coach.reviewMove(fens[i], uci, analyses[i], played[i], { bookName: op && op.name });
    G.reviews[i] = r;
    counts[r.grade]++;
    lossSum += Math.min(r.lossPct, 40); n++;
    items.push({ i, m, r });
  });
  const accuracy = n ? Math.max(0, Math.round(100 - lossSum / n * 2.2)) : 100;
  renderMoves();
  const bad = items.filter((x) => ['inaccuracy', 'mistake', 'blunder'].includes(x.r.grade));
  let html = `<b>📊 ملخص المراجعة</b><div class="summary-grid" style="margin-top:6px">
    <div>الدقة<br><b style="font-size:20px">${accuracy}%</b></div>
    <div>★ أفضل / ممتازة<br><b>${counts.best + counts.excellent}</b></div>
    <div>✓ جيدة / افتتاح<br><b>${counts.good + counts.book}</b></div>
    <div>?! غير دقيقة<br><b>${counts.inaccuracy}</b></div>
    <div>? أخطاء<br><b>${counts.mistake}</b></div>
    <div>?? أخطاء فادحة<br><b>${counts.blunder}</b></div></div>`;
  html += bad.length ? '<p>اضغط على أي نقلة لرؤية الوضع والشرح:</p>' : '<p>لا توجد أخطاء واضحة. عمل رائع!</p>';
  const div = coachSay(html);
  const list = document.createElement('div');
  list.className = 'review-list';
  for (const it of bad) {
    const b = document.createElement('button');
    b.className = 'review-item';
    b.innerHTML = `<span class="grade ${Coach.GRADES[it.r.grade].cls}">${Coach.GRADES[it.r.grade].icon}</span> النقلة ${Math.floor(it.i / 2) + 1}${it.m.color === 'w' ? '' : '…'} <b dir="ltr">${it.m.san}</b>`;
    b.addEventListener('click', () => viewPosition(fens[it.i], it));
    list.appendChild(b);
  }
  div.appendChild(list);
  const a = document.createElement('div');
  a.className = 'actions';
  const back = document.createElement('button');
  back.textContent = 'العودة للوضع النهائي';
  back.onclick = () => { G.viewing = false; board.setArrows([]); board.setMarks({}); board.set(G.chess, G.lastMove); };
  a.appendChild(back);
  div.appendChild(a);
  $('#coachPanel').scrollIntoView({ behavior: 'smooth' });
}

function viewPosition(fen, it) {
  G.viewing = true;
  board.set(new Chess(fen), null);
  const arrows = [{ from: it.m.from, to: it.m.to, color: 'red' }];
  if (it.r.best) arrows.push({ from: it.r.best.slice(0, 2), to: it.r.best.slice(2, 4), color: 'green' });
  board.setArrows(arrows);
  openModal(`<h2>النقلة ${Math.floor(it.i / 2) + 1}</h2><div class="coach-feed" style="max-height:none;padding:0">${it.r.html}</div>
    <p class="muted">🔴 السهم الأحمر: نقلتك — 🟢 السهم الأخضر: الأفضل</p><button class="btn block" id="okv">تم</button>`);
  $('#okv').onclick = closeModal;
}

// ---------- اللعب أونلاين ----------
function inviteLink(code) {
  const isWeb = /^https?:$/.test(location.protocol) && !location.hostname.includes('appassets.androidplatform.net') && location.hostname !== 'localhost';
  const base = isWeb ? location.origin + location.pathname : WEB_BASE;
  return `${base}?join=${code}`;
}

function shareInvite(code) {
  const link = inviteLink(code);
  const text = `♟️ تعال نلعب شطرنج!\nافتح الرابط للانضمام: ${link}\nأو افتح تطبيق "شطرنج المدرب" واختر "انضم بدعوة" وأدخل الرمز: ${code}`;
  if (Bridge && Bridge.share) { Bridge.share(text); return; }
  if (navigator.share) { navigator.share({ title: 'دعوة لعب شطرنج', text }).catch(() => {}); return; }
  copyText(text);
}

function copyText(text) {
  if (Bridge && Bridge.copy) { Bridge.copy(text); toast('تم النسخ ✓'); return; }
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
    () => toast('تم النسخ ✓'),
    () => { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('تم النسخ ✓'); },
  );
}

function setupOnline() {
  const box = openModal(`<h2>🔗 العب مع صديق</h2>
    <label class="f">اسمك</label><input type="text" id="oName" value="${escapeHtml(settings.name)}" maxlength="20">
    <label class="f">لونك</label>${segHtml('color', [['w', 'الأبيض'], ['b', 'الأسود'], ['r', 'عشوائي']], 'w')}
    <label class="f">التلميحات</label>
    <label class="switch"><input type="checkbox" id="oMine" checked><span>تفعيل التلميحات لي أنا</span></label>
    <label class="switch" style="margin-top:8px"><input type="checkbox" id="oOpp"><span>السماح للخصم باستخدام التلميحات</span></label>
    <p class="muted">يمكنك تغيير هذه الخيارات أثناء المباراة. التلميحات تظهر فقط على جهاز من يملكها.</p>
    <button class="btn block" id="oCreate">إنشاء الغرفة ومشاركة الرابط</button>`);
  wireSegs(box);
  box.querySelector('#oCreate').onclick = () => {
    settings.name = box.querySelector('#oName').value.trim() || 'لاعب';
    saveSettings();
    let color = segVal(box, 'color');
    if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
    const hintsMe = box.querySelector('#oMine').checked;
    const hintsOpp = box.querySelector('#oOpp').checked;
    closeModal();
    hostOnline({ color, hintsMe, hintsOpp });
  };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function hostOnline({ color, hintsMe, hintsOpp }) {
  const net = new OnlineGame({ onMessage: (m) => onNetMessage(m), onStatus: (s, t) => onNetStatus(s, t) });
  net.isHost = true;
  newGame({ mode: 'online', myColor: color, hintsMe, hintsOpp, net });
  let code;
  try { code = await net.host(); } catch { return; }
  if (!G || G.net !== net) return;
  G.code = code;
  showInvite(code);
}

function showInvite(code) {
  const link = inviteLink(code);
  const box = openModal(`<h2>ادعُ صديقك</h2>
    <p class="muted">أرسل الرابط لصديقك. عندما يفتحه ستبدأ المباراة تلقائياً. إذا كان لدى صديقك التطبيق يمكنه إدخال الرمز في "انضم بدعوة".</p>
    <div class="code">${code}</div>
    <div class="invite">${link}</div>
    <div class="row" style="margin-top:10px"><button class="btn" id="iShare">📤 مشاركة</button><button class="btn secondary" id="iCopy">📋 نسخ الرابط</button></div>
    <p class="muted" id="iWait" style="text-align:center;margin-top:12px">⏳ بانتظار انضمام صديقك… أبقِ هذه الشاشة مفتوحة.</p>
    <button class="btn block secondary" id="iHide">إخفاء</button>`);
  box.querySelector('#iShare').onclick = () => shareInvite(code);
  box.querySelector('#iCopy').onclick = () => copyText(link);
  box.querySelector('#iHide').onclick = closeModal;
}

async function joinOnline(code) {
  const net = new OnlineGame({ onMessage: (m) => onNetMessage(m), onStatus: (s, t) => onNetStatus(s, t) });
  newGame({ mode: 'online', myColor: 'b', net });
  try { await net.join(code); } catch { /* تظهر الرسالة عبر onStatus */ }
}

function onNetStatus(state, text) {
  if (!G || G.mode !== 'online') return;
  const el = $('#netStatus');
  el.textContent = state === 'connected' ? '● متصل' : state === 'lost' ? '● منقطع' : state === 'error' ? '● خطأ' : '…';
  el.className = 'net ' + (state === 'connected' ? 'ok' : state === 'lost' || state === 'error' ? 'bad' : '');
  G.connected = state === 'connected';
  if (state === 'error') {
    openModal(`<h2>تعذّر الاتصال</h2><p>${text}</p><button class="btn block" id="eOk">حسناً</button>`);
    $('#eOk').onclick = closeModal;
  } else if (state === 'lost') toast(text);
  update();
}

function sendSetup() {
  G.net.send({
    t: 'setup',
    hostColor: G.myColor,
    hintsGuest: G.hintsOpp,
    hostName: settings.name,
    moves: G.chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')),
    over: G.over ? G.resultText : null,
  });
}

function loadMoves(moves) {
  G.chess = new Chess();
  for (const u of moves) G.chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  const h = G.chess.history({ verbose: true });
  G.lastMove = h.length ? { from: h[h.length - 1].from, to: h[h.length - 1].to } : null;
}

async function onNetMessage(msg) {
  if (!G || G.mode !== 'online') return;
  const net = G.net;
  switch (msg.t) {
    case '_open':
      G.connected = true;
      if (net.isHost) { sendSetup(); }
      else net.send({ t: 'hello', name: settings.name });
      break;
    case 'hello':
      G.names.opp = String(msg.name || 'الصديق').slice(0, 20);
      if (!G.started) {
        G.started = true;
        if (!$('#modal').classList.contains('hidden')) closeModal();
        toast(`انضم ${G.names.opp}! المباراة بدأت`);
        sound('check');
      }
      update();
      break;
    case 'setup':
      G.names.opp = String(msg.hostName || 'الصديق').slice(0, 20);
      G.myColor = other(msg.hostColor);
      G.hintsMe = !!msg.hintsGuest;
      loadMoves(msg.moves || []);
      if (!G.started) toast('تم الاتصال! المباراة بدأت');
      G.started = true;
      G.over = false;
      board.setOrientation(G.myColor);
      setupControls();
      onNetStatus('connected', '');
      board.set(G.chess, G.lastMove);
      update();
      if (msg.over) { G.over = true; G.resultText = msg.over; update(); } else checkGameOver();
      break;
    case 'move': {
      if (G.over) break;
      if (msg.ply !== G.chess.history().length || G.chess.turn() === G.myColor) {
        if (net.isHost) sendSetup(); else net.send({ t: 'sync-request' });
        break;
      }
      let m;
      try { m = G.chess.move({ from: msg.uci.slice(0, 2), to: msg.uci.slice(2, 4), promotion: msg.uci[4] }); } catch { break; }
      G.lastMove = { from: m.from, to: m.to };
      board.setArrows([]);
      playMoveSound(m);
      afterPositionChange();
      break;
    }
    case 'sync-request':
      if (net.isHost) sendSetup();
      break;
    case 'hints':
      G.hintsMe = !!msg.allowed;
      setupControls();
      if (!G.hintsMe) board.setArrows([]);
      toast(G.hintsMe ? 'سمح لك صديقك باستخدام التلميحات 💡' : 'أوقف صديقك التلميحات');
      break;
    case 'resign':
      endGame(`استسلم ${G.names.opp || 'الخصم'} — فزت!`, G.myColor);
      break;
    case 'draw-offer': {
      const ok = await confirmBox(`${G.names.opp || 'الخصم'} يعرض التعادل. هل تقبل؟`, 'قبول', 'رفض');
      net.send({ t: ok ? 'draw-accept' : 'draw-decline' });
      if (ok) endGame('تعادل بالاتفاق', null);
      break;
    }
    case 'draw-accept': endGame('تعادل بالاتفاق', null); break;
    case 'draw-decline': toast('رفض الخصم التعادل'); break;
    case 'rematch-request': {
      const ok = await confirmBox(`${G.names.opp || 'الخصم'} يطلب مباراة جديدة. موافق؟`, 'نعم', 'لا');
      if (!ok) { net.send({ t: 'rematch-decline' }); break; }
      if (net.isHost) startRematch(); else net.send({ t: 'rematch-accept' });
      break;
    }
    case 'rematch-accept': if (net.isHost) startRematch(); break;
    case 'rematch-decline': toast('رفض الخصم مباراة جديدة'); break;
    case 'full':
      onNetStatus('error', 'هذه الغرفة ممتلئة؛ يوجد لاعبان بالفعل.');
      break;
  }
}

function requestRematch() {
  if (!G || !G.net) return;
  G.net.send({ t: 'rematch-request' });
  toast('تم إرسال طلب مباراة جديدة');
}

function startRematch() {
  G.myColor = other(G.myColor);
  G.chess = new Chess();
  G.over = false;
  G.lastMove = null;
  G.reviews = {};
  G.token = ++gameToken;
  $('#coachFeed').innerHTML = '';
  board.setArrows([]);
  board.setOrientation(G.myColor);
  sendSetup();
  afterPositionChange();
  toast('مباراة جديدة! تم تبديل الألوان');
}

function joinPrompt() {
  const box = openModal(`<h2>📥 انضم بدعوة</h2>
    <label class="f">الصق رابط الدعوة أو اكتب الرمز (6 أحرف)</label>
    <input type="text" id="jCode" dir="ltr" placeholder="ABC123 أو الرابط" autocomplete="off">
    <label class="f">اسمك</label><input type="text" id="jName" value="${escapeHtml(settings.name)}" maxlength="20">
    <button class="btn block" id="jGo">انضمام</button>`);
  box.querySelector('#jGo').onclick = () => {
    const code = parseCode(box.querySelector('#jCode').value);
    if (!code) { toast('الرابط أو الرمز غير صحيح'); return; }
    settings.name = box.querySelector('#jName').value.trim() || 'لاعب';
    saveSettings();
    closeModal();
    joinOnline(code);
  };
}

// ---------- إعداد أوضاع اللعب ----------
function setupAi() {
  const box = openModal(`<h2>🤖 العب ضد الكمبيوتر</h2>
    <label class="f">المستوى</label><select id="aLevel">${levelOptions(settings.aiLevel)}</select>
    <label class="f">لونك</label>${segHtml('color', [['w', 'الأبيض'], ['b', 'الأسود'], ['r', 'عشوائي']], 'w')}
    <label class="switch" style="margin-top:12px"><input type="checkbox" id="aHints" ${settings.aiHints ? 'checked' : ''}><span>تفعيل التلميحات وشريط التقييم</span></label>
    <button class="btn block" id="aGo">ابدأ المباراة</button>`);
  wireSegs(box);
  box.querySelector('#aGo').onclick = () => {
    settings.aiLevel = +box.querySelector('#aLevel').value;
    settings.aiHints = box.querySelector('#aHints').checked;
    saveSettings();
    let color = segVal(box, 'color');
    if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
    closeModal();
    newGame({ mode: 'ai', myColor: color, level: settings.aiLevel, hintsMe: settings.aiHints });
  };
}

function setupCoach() {
  const box = openModal(`<h2>🎓 التدريب مع المدرب</h2>
    <p class="muted">تلعب ضد الكمبيوتر، والمدرب يقيّم كل نقلة لك، ويشرح بالعربية لماذا هي جيدة أو خاطئة، وما النقلة المفترض أن تلعبها ولماذا، ويحذرك من تهديدات الخصم.</p>
    <label class="f">مستوى الخصم</label><select id="cLevel">${levelOptions(settings.coachLevel)}</select>
    <label class="f">لونك</label>${segHtml('color', [['w', 'الأبيض'], ['b', 'الأسود']], 'w')}
    <label class="switch" style="margin-top:12px"><input type="checkbox" id="cComments" ${settings.coachComments ? 'checked' : ''}><span>شرح نقلات الخصم وتهديداته</span></label>
    <button class="btn block" id="cGo">ابدأ التدريب</button>`);
  wireSegs(box);
  box.querySelector('#cGo').onclick = () => {
    settings.coachLevel = +box.querySelector('#cLevel').value;
    settings.coachComments = box.querySelector('#cComments').checked;
    saveSettings();
    closeModal();
    newGame({ mode: 'coach', myColor: segVal(box, 'color'), level: settings.coachLevel, hintsMe: true });
  };
}

function openSettings() {
  const box = openModal(`<h2>⚙️ الإعدادات</h2>
    <label class="f">اسمك (يظهر لأصدقائك)</label><input type="text" id="sName" value="${escapeHtml(settings.name)}" maxlength="20">
    <label class="switch" style="margin-top:12px"><input type="checkbox" id="sSound" ${settings.sound ? 'checked' : ''}><span>الأصوات</span></label>
    <label class="switch" style="margin-top:8px"><input type="checkbox" id="sEval" ${settings.showEval ? 'checked' : ''}><span>إظهار شريط التقييم (في التدريب ومع التلميحات)</span></label>
    <button class="btn block" id="sSave">حفظ</button>
    <p class="muted" style="margin-top:14px">محرك الشطرنج: Stockfish (GPLv3). صور القطع: Cburnett (CC BY-SA 3.0).</p>`);
  box.querySelector('#sSave').onclick = () => {
    settings.name = box.querySelector('#sName').value.trim() || 'لاعب';
    settings.sound = box.querySelector('#sSound').checked;
    settings.showEval = box.querySelector('#sEval').checked;
    saveSettings();
    closeModal();
    if (G) setupControls();
    toast('تم الحفظ');
  };
}

function gameMenu() {
  const box = openModal(`<h2>خيارات</h2>
    ${G.mode === 'online' && G.code && G.net.isHost ? '<button class="btn block" data-a="invite">🔗 إظهار رابط الدعوة</button>' : ''}
    ${G.mode === 'online' ? '' : '<button class="btn block" data-a="new">🔁 مباراة جديدة بنفس الإعدادات</button>'}
    ${G.chess.history().length >= 2 ? '<button class="btn block secondary" data-a="review">🎓 مراجعة المباراة حتى الآن</button>' : ''}
    <button class="btn block secondary" data-a="copy">📋 نسخ المباراة (PGN)</button>
    <button class="btn block secondary" data-a="close">إغلاق</button>`);
  box.querySelector('[data-a="invite"]')?.addEventListener('click', () => { closeModal(); showInvite(G.code); });
  box.querySelector('[data-a="new"]')?.addEventListener('click', () => { closeModal(); newGame({ ...G }); });
  box.querySelector('[data-a="review"]')?.addEventListener('click', () => { closeModal(); reviewGame(); });
  box.querySelector('[data-a="copy"]').addEventListener('click', () => { copyText(G.chess.pgn()); closeModal(); });
  box.querySelector('[data-a="close"]').addEventListener('click', closeModal);
}

// ---------- الدروس ----------
let lessonBoard = null;

function openLessonsIndex() {
  $('#lessonsTitle').textContent = 'الدروس والتكتيكات';
  const body = $('#lessonsBody');
  body.innerHTML = '';
  LESSON_GROUPS.forEach((g, gi) => {
    const h = document.createElement('h3');
    h.className = 'group-title';
    h.textContent = `${g.icon} ${g.title}`;
    body.appendChild(h);
    g.lessons.forEach((l, li) => {
      const b = document.createElement('button');
      b.className = 'lesson-item';
      b.innerHTML = `<span>${l.title}</span><small>${l.puzzles ? `🧩 ${l.puzzles.length}` : l.line ? '▶️' : ''}</small>`;
      b.onclick = () => openLesson(gi, li);
      body.appendChild(b);
    });
  });
  show('lessons');
}

function openLesson(gi, li) {
  const g = LESSON_GROUPS[gi];
  const l = g.lessons[li];
  $('#lessonsTitle').textContent = l.title;
  const body = $('#lessonsBody');
  body.innerHTML = `<div class="lesson"><h2>${l.title}</h2>${l.body}</div>`;
  if (l.line) renderOpeningLine(body, l.line);
  if (l.puzzles) renderPuzzles(body, l.puzzles);
  const nav = document.createElement('div');
  nav.className = 'row';
  const next = g.lessons[li + 1];
  nav.innerHTML = `<button class="btn secondary" id="lBack">كل الدروس</button>${next ? `<button class="btn" id="lNext">التالي: ${next.title}</button>` : ''}`;
  body.appendChild(nav);
  nav.querySelector('#lBack').onclick = () => { screenStack.pop(); openLessonsIndex(); };
  if (next) nav.querySelector('#lNext').onclick = () => openLesson(gi, li + 1);
  screenStack.push('lesson');
  window.scrollTo(0, 0);
}

function renderOpeningLine(body, line) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson puzzle-box';
  wrap.innerHTML = '<div class="lb"></div><div class="puzzle-msg" dir="ltr"></div><div class="opening-nav"><button data-n="start">⏮</button><button data-n="prev">◀</button><button data-n="next">▶</button><button data-n="end">⏭</button></div><button class="btn block secondary" data-n="play">العب هذا الافتتاح ضد الكمبيوتر مع المدرب</button>';
  body.appendChild(wrap);
  const sans = line.split(' ');
  lessonBoard = new Board(wrap.querySelector('.lb'), {});
  lessonBoard.interactive = false;
  let idx = 0;
  const render = () => {
    const c = new Chess();
    let last = null;
    for (let i = 0; i < idx; i++) { const m = c.move(sans[i]); last = { from: m.from, to: m.to }; }
    lessonBoard.set(c, last);
    const txt = sans.map((s, i) => `${i % 2 === 0 ? (i / 2 + 1) + '. ' : ''}${i === idx - 1 ? `[${s}]` : s}`).join(' ');
    wrap.querySelector('.puzzle-msg').textContent = txt;
  };
  wrap.querySelector('.opening-nav').addEventListener('click', (e) => {
    const n = e.target.dataset.n;
    if (n === 'start') idx = 0;
    if (n === 'prev') idx = Math.max(0, idx - 1);
    if (n === 'next') idx = Math.min(sans.length, idx + 1);
    if (n === 'end') idx = sans.length;
    render();
  });
  wrap.querySelector('[data-n="play"]').onclick = () => {
    newGame({ mode: 'coach', myColor: 'w', level: settings.coachLevel, hintsMe: true });
    coachSay(`📖 تدرّب على الافتتاح: <span dir="ltr">${line}</span>`);
  };
  render();
}

function renderPuzzles(body, puzzles) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson puzzle-box';
  wrap.innerHTML = `<b>🧩 تمرين <span class="pn"></span> من ${puzzles.length}</b> — <span class="side"></span><div class="lb"></div><div class="puzzle-msg"></div>
    <div class="row"><button class="btn secondary" data-a="hint">💡 تلميح</button><button class="btn secondary" data-a="solve">👁️ الحل</button><button class="btn secondary" data-a="retry">↺ إعادة</button></div>
    <button class="btn block hidden" data-a="next">التمرين التالي ←</button>`;
  body.appendChild(wrap);
  let pi = 0, step = 0, chess = null, solved = false;
  const msg = wrap.querySelector('.puzzle-msg');
  const pb = new Board(wrap.querySelector('.lb'), {
    onMove: ({ from, to, promotion }) => attempt(from + to + (promotion || '')),
    canMove: () => !solved,
  });
  const load = () => {
    const p = puzzles[pi];
    chess = new Chess(p.fen);
    step = 0; solved = false;
    pb.setOrientation(chess.turn());
    pb.setArrows([]);
    pb.set(chess, null);
    wrap.querySelector('.pn').textContent = pi + 1;
    wrap.querySelector('.side').textContent = `الدور على ${colorName(chess.turn())} — جد أفضل نقلة`;
    msg.textContent = '';
    msg.className = 'puzzle-msg';
    wrap.querySelector('[data-a="next"]').classList.toggle('hidden', true);
  };
  const finish = () => {
    solved = true;
    const p = puzzles[pi];
    const ex = Coach.motifs(p.fen, p.solution[0]).list.slice(0, 2).map((x) => x.text).join(' ');
    msg.innerHTML = `✓ أحسنت! ${ex}`;
    msg.className = 'puzzle-msg ok';
    sound('check');
    if (pi < puzzles.length - 1) wrap.querySelector('[data-a="next"]').classList.remove('hidden');
  };
  const attempt = (uci) => {
    const p = puzzles[pi];
    const expected = p.solution[step];
    const fenBefore = chess.fen();
    let m;
    try { m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return; }
    pb.set(chess, { from: m.from, to: m.to });
    pb.setArrows([]);
    if (uci === expected || chess.isCheckmate()) {
      sound(m.captured ? 'capture' : 'move');
      if (chess.isCheckmate() || step + 1 >= p.solution.length) { finish(); return; }
      const reply = p.solution[step + 1];
      step += 2;
      msg.textContent = 'صحيح! تابع…';
      msg.className = 'puzzle-msg ok';
      setTimeout(() => {
        const r = chess.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
        pb.set(chess, { from: r.from, to: r.to });
        sound('move');
        if (step >= p.solution.length) finish();
      }, 500);
    } else {
      msg.textContent = 'ليست هذه النقلة الأفضل، حاول مرة أخرى.';
      msg.className = 'puzzle-msg bad';
      setTimeout(() => { chess.load(fenBefore); pb.set(chess, null); }, 700);
    }
  };
  wrap.addEventListener('click', (e) => {
    const a = e.target.dataset.a;
    if (a === 'hint') { msg.textContent = puzzles[pi].hint || 'ابحث عن الكش والأخذ والتهديد أولاً.'; msg.className = 'puzzle-msg'; }
    if (a === 'solve') { const u = puzzles[pi].solution[step]; if (u) pb.setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4), color: 'green' }]); }
    if (a === 'retry') load();
    if (a === 'next') { pi++; load(); }
  });
  load();
}

// ---------- الأزرار والتنقل ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const actions = {
    coach: setupCoach,
    ai: setupAi,
    online: setupOnline,
    join: joinPrompt,
    local: () => newGame({ mode: 'local' }),
    lessons: openLessonsIndex,
    settings: openSettings,
    back: goBack,
    hint: showHint,
    plan: showPlan,
    undo: undoMove,
    flip: () => { board.flip(); update(); },
    resign,
    draw: offerDraw,
    gameMenu,
  };
  if (actions[a]) actions[a]();
});

async function goBack() {
  if (!$('#modal').classList.contains('hidden')) { closeModal(); return true; }
  const cur = screenStack[screenStack.length - 1];
  if (cur === 'home') return false;
  if (cur === 'game' && G && !G.over && G.chess.history().length > 0) {
    if (!(await confirmBox('هل تريد مغادرة المباراة؟'))) return true;
  }
  if (cur === 'game' && G && G.mode === 'online' && G.net) { G.net.close(); G.net = null; }
  if (cur === 'game') { if (playerEngine) playerEngine.cancelAll(); gameToken++; if (G) G.token = gameToken; }
  screenStack.pop();
  if (screenStack[screenStack.length - 1] === 'lesson') screenStack.pop();
  const prev = screenStack[screenStack.length - 1];
  if (prev === 'lessons') openLessonsIndex();
  else show(prev, false);
  return true;
}

// زر الرجوع في أندرويد.
window.onAndroidBack = () => {
  const handled = !$('#modal').classList.contains('hidden') || screenStack[screenStack.length - 1] !== 'home';
  if (handled) goBack();
  return handled;
};

// روابط الدعوة القادمة من خارج التطبيق.
window.onDeepLink = (url) => {
  const code = parseCode(url);
  if (code) { closeModal(); joinOnline(code); }
};

loadSprite().then(() => {
  const code = parseCode(location.search) || parseCode(location.hash);
  if (code) {
    history.replaceState(null, '', location.pathname);
    joinOnline(code);
  }
});
