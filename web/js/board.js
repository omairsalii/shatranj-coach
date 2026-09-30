// لوحة شطرنج تفاعلية (نقر أو سحب) مع أسهم وتظليل.

const FILES = 'abcdefgh';
const PROMO_ARABIC = { q: 'وزير', r: 'طابية', b: 'فيل', n: 'حصان' };

let spriteLoaded = null;
export function loadSprite() {
  if (!spriteLoaded) {
    spriteLoaded = fetch('img/pieces.svg').then((r) => r.text()).then((txt) => {
      const holder = document.createElement('div');
      holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      holder.innerHTML = txt.replace(/<\?xml[^>]*>/, '');
      document.body.appendChild(holder);
    });
  }
  return spriteLoaded;
}

export function pieceSvg(color, type) {
  return `<svg viewBox="0 0 40 40" class="pc"><use href="#${color}${type}"></use></svg>`;
}

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.orientation = opts.orientation || 'w';
    this.chess = null;
    this.selected = null;
    this.lastMove = null;
    this.arrows = [];
    this.marks = {};
    this.interactive = true;
    this.drag = null;
    el.classList.add('board');
    el.innerHTML = '';
    this.squaresEl = document.createElement('div');
    this.squaresEl.className = 'squares';
    el.appendChild(this.squaresEl);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 800 800');
    this.svg.classList.add('arrows');
    el.appendChild(this.svg);
    this.squareEls = {};
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('div');
      sq.className = 'sq';
      this.squaresEl.appendChild(sq);
    }
    this._layout();
    this.squaresEl.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._moveDrag(e));
    window.addEventListener('pointerup', (e) => this._up(e));
  }

  _layout() {
    const cells = this.squaresEl.children;
    this.squareEls = {};
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const file = this.orientation === 'w' ? c : 7 - c;
        const rank = this.orientation === 'w' ? 7 - r : r;
        const name = FILES[file] + (rank + 1);
        const cell = cells[r * 8 + c];
        cell.dataset.sq = name;
        cell.className = 'sq ' + ((file + rank) % 2 ? 'light' : 'dark');
        let coords = '';
        if (c === 0) coords += `<span class="rk">${rank + 1}</span>`;
        if (r === 7) coords += `<span class="fl">${FILES[file]}</span>`;
        cell.dataset.coords = coords;
        this.squareEls[name] = cell;
      }
    }
  }

  setOrientation(o) {
    this.orientation = o;
    this._layout();
    this.render();
  }

  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

  set(chess, lastMove) {
    this.chess = chess;
    if (lastMove !== undefined) this.lastMove = lastMove;
    this.selected = null;
    this.render();
  }

  setArrows(arrows) { this.arrows = arrows || []; this._drawArrows(); }
  setMarks(marks) { this.marks = marks || {}; this.render(); }

  render() {
    if (!this.chess) return;
    const board = this.chess.board();
    let checkSq = null;
    if (this.chess.inCheck()) {
      for (const row of board) for (const p of row) if (p && p.type === 'k' && p.color === this.chess.turn()) checkSq = p.square;
    }
    const targets = new Set();
    const captures = new Set();
    if (this.selected) {
      for (const m of this.chess.moves({ square: this.selected, verbose: true })) {
        (m.captured ? captures : targets).add(m.to);
      }
    }
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const name = FILES[file] + (rank + 1);
        const p = board[7 - rank][file];
        const cell = this.squareEls[name];
        let cls = 'sq ' + ((file + rank) % 2 ? 'light' : 'dark');
        if (this.lastMove && (this.lastMove.from === name || this.lastMove.to === name)) cls += ' last';
        if (this.selected === name) cls += ' sel';
        if (checkSq === name) cls += ' check';
        if (this.marks[name]) cls += ' mark-' + this.marks[name];
        cell.className = cls;
        let html = cell.dataset.coords || '';
        if (p && !(this.drag && this.drag.from === name && this.drag.moved)) html += pieceSvg(p.color, p.type);
        if (targets.has(name)) html += '<span class="dot"></span>';
        if (captures.has(name)) html += '<span class="ring"></span>';
        cell.innerHTML = html;
      }
    }
    this._drawArrows();
  }

  _center(sq) {
    const file = FILES.indexOf(sq[0]);
    const rank = +sq[1] - 1;
    const c = this.orientation === 'w' ? file : 7 - file;
    const r = this.orientation === 'w' ? 7 - rank : rank;
    return [c * 100 + 50, r * 100 + 50];
  }

  _drawArrows() {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg.innerHTML = '';
    const defs = document.createElementNS(ns, 'defs');
    const colors = { green: '#15803d', blue: '#1d4ed8', red: '#dc2626', orange: '#ea580c' };
    for (const [k, v] of Object.entries(colors)) {
      defs.innerHTML += `<marker id="ah-${k}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${v}"/></marker>`;
    }
    this.svg.appendChild(defs);
    for (const a of this.arrows) {
      const [x1, y1] = this._center(a.from);
      const [x2, y2] = this._center(a.to);
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const ex = x2 - (dx / len) * 30, ey = y2 - (dy / len) * 30;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', ex); line.setAttribute('y2', ey);
      const col = a.color || 'green';
      line.setAttribute('stroke', colors[col]);
      line.setAttribute('stroke-width', 18);
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', a.opacity || 0.8);
      line.setAttribute('marker-end', `url(#ah-${col})`);
      this.svg.appendChild(line);
    }
  }

  _sqFromPoint(x, y) {
    const rect = this.squaresEl.getBoundingClientRect();
    if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return null;
    const c = Math.floor(((x - rect.left) / rect.width) * 8);
    const r = Math.floor(((y - rect.top) / rect.height) * 8);
    const file = this.orientation === 'w' ? c : 7 - c;
    const rank = this.orientation === 'w' ? 7 - r : r;
    return FILES[file] + (rank + 1);
  }

  _canPick(sq) {
    if (!this.interactive || !this.chess) return false;
    const p = this.chess.get(sq);
    if (!p || p.color !== this.chess.turn()) return false;
    return !this.opts.canMove || this.opts.canMove(p.color);
  }

  _down(e) {
    const sq = this._sqFromPoint(e.clientX, e.clientY);
    if (!sq || !this.chess) return;
    if (this.selected && this.selected !== sq) {
      const legal = this.chess.moves({ square: this.selected, verbose: true }).some((m) => m.to === sq);
      if (legal) { this._tryMove(this.selected, sq); return; }
    }
    if (this._canPick(sq)) {
      e.preventDefault();
      this.selected = sq;
      this.drag = { from: sq, x: e.clientX, y: e.clientY, moved: false, ghost: null };
      this.render();
    } else if (this.selected) {
      this.selected = null;
      this.render();
    }
  }

  _moveDrag(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    if (!d.moved) {
      d.moved = true;
      const p = this.chess.get(d.from);
      const size = this.squaresEl.getBoundingClientRect().width / 8;
      d.ghost = document.createElement('div');
      d.ghost.className = 'ghost';
      d.ghost.style.width = d.ghost.style.height = size * 1.15 + 'px';
      d.ghost.innerHTML = pieceSvg(p.color, p.type);
      document.body.appendChild(d.ghost);
      this.render();
    }
    d.ghost.style.left = e.clientX + 'px';
    d.ghost.style.top = e.clientY + 'px';
  }

  _up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.ghost) d.ghost.remove();
    if (!d.moved) return;
    const to = this._sqFromPoint(e.clientX, e.clientY);
    if (to && to !== d.from) this._tryMove(d.from, to);
    else this.render();
  }

  async _tryMove(from, to) {
    const moves = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!moves.length) { this.selected = null; this.render(); return; }
    let promotion;
    if (moves.some((m) => m.promotion)) {
      promotion = await this._askPromotion(this.chess.turn());
      if (!promotion) { this.selected = null; this.render(); return; }
    }
    this.selected = null;
    if (this.opts.onMove) this.opts.onMove({ from, to, promotion });
    this.render();
  }

  _askPromotion(color) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'promo';
      ov.innerHTML = '<div class="promo-box"><p>رقِّ البيدق إلى:</p><div class="promo-row">' +
        ['q', 'r', 'b', 'n'].map((t) => `<button data-p="${t}" title="${PROMO_ARABIC[t]}">${pieceSvg(color, t)}<small>${PROMO_ARABIC[t]}</small></button>`).join('') +
        '</div></div>';
      ov.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        ov.remove();
        resolve(b ? b.dataset.p : null);
      });
      this.el.appendChild(ov);
    });
  }
}
