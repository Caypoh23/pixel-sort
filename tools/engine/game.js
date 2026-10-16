/* Pixel Sort prototype engine.
   One time-based simulation drives both the playable page and the deterministic video renderer:
   every animation is a function of the timeline time t (seconds). */
(function () {
  'use strict';
  const W = 1080, H = 1920, CAP = 4;
  const DATA = window.PS_DATA;
  const LEVELS = DATA.levels;
  const QMARK = DATA.qmark;

  // ---------- helpers ----------
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeInQuad = (t) => t * t;
  const easeOutBack = (t) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const prog = (t, t0, d) => clamp((t - t0) / d, 0, 1);
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
  const css = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const GOLD = [255, 200, 61], GOLD_DEEP = [229, 145, 0], BROWN = [92, 52, 6];
  const FONT_UI = 'Fredoka, "Arial Rounded MT Bold", system-ui, sans-serif';
  const FONT_DISPLAY = '"Lilita One", Fredoka, system-ui, sans-serif';

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; }

  // ---------- layout ----------
  const CARD = { x: 220, y: 392, size: 640, pad: 24 };
  CARD.cell = (CARD.size - CARD.pad * 2) / 16;
  const BAR = { x: 220, y: 1058, w: 540, h: 18 };

  function tubeLayout(n) {
    const r = n <= 5 ? 42 : n <= 6 ? 41 : n <= 7 ? 39 : 36;
    const tw = r * 2 + 20;
    const avail = n <= 5 ? 760 : 860;
    const gap = Math.min(46, (avail - n * tw) / (n - 1));
    const total = n * tw + (n - 1) * gap;
    const x0 = (W - total) / 2;
    const pitch = r * 2 + 5;
    const th = CAP * pitch + 26;
    const bottom = 1592;
    const top = bottom - th;
    return {
      n, r, tw, gap, x0, pitch, th, top, bottom,
      hoverY: top - r - 34,
      cx: (i) => x0 + i * (tw + gap) + tw / 2,
      slotY: (k) => bottom - 13 - r - k * pitch,
    };
  }

  // ---------- pre-rendered art ----------
  const ART = { balls: new Map(), tubes: new Map() };

  function tileArt(ctx, x, y, s, col) {
    const k = s / 37, g = 3 * k, sz = s - g, r = 7 * k, X = x + g / 2, Y = y + g / 2;
    ctx.fillStyle = css(col); rr(ctx, X, Y, sz, sz, r); ctx.fill();
    ctx.save(); rr(ctx, X, Y, sz, sz, r); ctx.clip();
    ctx.fillStyle = css(BLACK, 0.11); ctx.fillRect(X, Y + sz - 5 * k, sz, 5 * k);
    ctx.fillStyle = css(WHITE, 0.2); ctx.fillRect(X, Y, sz, 4 * k);
    ctx.restore();
    ctx.fillStyle = css(WHITE, 0.28); rr(ctx, X + 5 * k, Y + 6 * k, sz * 0.3, 5 * k, 2.5 * k); ctx.fill();
    ctx.strokeStyle = css(mix(col, [40, 50, 80], 0.2)); ctx.lineWidth = 2 * k; rr(ctx, X + k, Y + k, sz - 2 * k, sz - 2 * k, r - k); ctx.stroke();
  }
  const THUMBS = new Map();
  function picThumb(idx, size) {
    const key = idx + ':' + size;
    if (THUMBS.has(key)) return THUMBS.get(key);
    const c = mk(size, size), x = c.getContext('2d'), s = size / 16;
    for (let p = 0; p < 256; p++) {
      const gx = p % 16, gy = (p / 16) | 0;
      const col = idx < 0 ? (QMARK[gy][gx] ? [184, 174, 206] : [219, 214, 230]) : hex2rgb(LEVELS[idx].colors[LEVELS[idx].grid[gy][gx]]);
      tileArt(x, gx * s, gy * s, s, col);
    }
    THUMBS.set(key, c);
    return c;
  }

  function buildBackground() {
    const c = mk(W, H), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#15445E'); g.addColorStop(0.55, '#0E2F45'); g.addColorStop(1, '#091E2E');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const r = rng(77), s = 54;
    for (let yy = 0; yy < H; yy += s) for (let xx = 0; xx < W; xx += s) {
      const a = r() * 0.035;
      x.fillStyle = `rgba(255,255,255,${a})`; rr(x, xx + 3, yy + 3, s - 6, s - 6, 8); x.fill();
    }
    const v = x.createRadialGradient(W / 2, H * 0.42, 200, W / 2, H * 0.45, H * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,8,16,0.45)');
    x.fillStyle = v; x.fillRect(0, 0, W, H);
    ART.bg = c;
  }

  function buildCard() {
    const m = 60, c = mk(CARD.size + m * 2, CARD.size + m * 2), x = c.getContext('2d');
    x.save();
    x.shadowColor = 'rgba(0,10,20,0.45)'; x.shadowBlur = 46; x.shadowOffsetY = 18;
    x.fillStyle = '#FFFFFF'; rr(x, m, m, CARD.size, CARD.size, 34); x.fill();
    x.restore();
    x.strokeStyle = 'rgba(20,40,60,0.08)'; x.lineWidth = 2; rr(x, m + 1, m + 1, CARD.size - 2, CARD.size - 2, 33); x.stroke();
    ART.card = c; ART.cardM = m;
  }

  function buildLevelArt(L) {
    const s = CARD.cell;
    const hid = mk(CARD.size, CARD.size), hx = hid.getContext('2d');
    const rev = mk(CARD.size, CARD.size), rx = rev.getContext('2d');
    const flash = mk(s, s), fx = flash.getContext('2d');
    for (let p = 0; p < 256; p++) {
      const gx = p % 16, gy = (p / 16) | 0, X = CARD.pad + gx * s, Y = CARD.pad + gy * s;
      tileArt(hx, X, Y, s, QMARK[gy][gx] ? [184, 174, 206] : [219, 214, 230]);
      tileArt(rx, X, Y, s, hex2rgb(L.colors[L.grid[gy][gx]]));
    }
    fx.fillStyle = '#FFFFFF'; rr(fx, 1.5, 1.5, s - 3, s - 3, 7); fx.fill();
    ART.hidden = hid; ART.revealed = rev; ART.flash = flash;
    // album thumbnail
    const th = mk(160, 160), tx = th.getContext('2d');
    for (let p = 0; p < 256; p++) { const gx = p % 16, gy = (p / 16) | 0; tx.fillStyle = L.colors[L.grid[gy][gx]]; tx.fillRect(gx * 10, gy * 10, 10, 10); }
    return th;
  }

  function ballSprite(hex, r) {
    const key = hex + r;
    if (ART.balls.has(key)) return ART.balls.get(key);
    const pad = 6, c = mk(r * 2 + pad * 2, r * 2 + pad * 2), x = c.getContext('2d');
    const col = hex2rgb(hex), cx = r + pad, cy = r + pad;
    const light = luminance(col) > 0.8;
    const g = x.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r * 1.02);
    g.addColorStop(0, css(mix(col, WHITE, 0.6)));
    g.addColorStop(0.42, css(col));
    g.addColorStop(1, css(mix(col, light ? [120, 130, 160] : BLACK, light ? 0.45 : 0.32)));
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    // bounce light
    const b = x.createLinearGradient(0, cy + r * 0.3, 0, cy + r);
    b.addColorStop(0, 'rgba(255,255,255,0)'); b.addColorStop(1, 'rgba(255,255,255,0.18)');
    x.fillStyle = b; x.beginPath(); x.arc(cx, cy, r * 0.96, 0, Math.PI * 2); x.fill();
    x.strokeStyle = light ? 'rgba(60,70,100,0.35)' : 'rgba(0,0,0,0.25)'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, r - 1, 0, Math.PI * 2); x.stroke();
    x.save(); x.translate(cx - r * 0.36, cy - r * 0.44); x.rotate(-0.6);
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.beginPath(); x.ellipse(0, 0, r * 0.26, r * 0.15, 0, 0, Math.PI * 2); x.fill();
    x.restore();
    x.fillStyle = 'rgba(255,255,255,0.7)'; x.beginPath(); x.arc(cx + r * 0.05, cy - r * 0.62, r * 0.06, 0, Math.PI * 2); x.fill();
    const s = { c, pad };
    ART.balls.set(key, s);
    return s;
  }
  function luminance(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }

  function tubePath(x, X, Y, w, h) {
    const r = w / 2;
    x.beginPath();
    x.moveTo(X, Y);
    x.lineTo(X, Y + h - r);
    x.arc(X + r, Y + h - r, r, Math.PI, 0, true);
    x.lineTo(X + w, Y);
  }
  function tubeSprites(lay) {
    const key = lay.tw + ':' + lay.th;
    if (ART.tubes.has(key)) return ART.tubes.get(key);
    const m = 20, w = lay.tw, h = lay.th;
    const back = mk(w + m * 2, h + m * 2), bx = back.getContext('2d');
    tubePath(bx, m, m, w, h); bx.closePath();
    const g = bx.createLinearGradient(m, 0, m + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.5, 'rgba(255,255,255,0.04)'); g.addColorStop(1, 'rgba(255,255,255,0.12)');
    bx.fillStyle = g; bx.fill();
    const front = mk(w + m * 2, h + m * 2), fx = front.getContext('2d');
    tubePath(fx, m, m, w, h);
    fx.strokeStyle = 'rgba(225,245,255,0.62)'; fx.lineWidth = 5; fx.lineJoin = 'round'; fx.stroke();
    fx.save(); tubePath(fx, m, m, w, h); fx.closePath(); fx.clip();
    fx.fillStyle = 'rgba(255,255,255,0.20)'; rr(fx, m + 9, m + 22, 9, h - w / 2 - 30, 4.5); fx.fill();
    fx.fillStyle = 'rgba(255,255,255,0.08)'; rr(fx, m + w - 16, m + 30, 6, h * 0.45, 3); fx.fill();
    fx.restore();
    fx.fillStyle = 'rgba(225,245,255,0.7)'; rr(fx, m - 9, m - 7, w + 18, 14, 7); fx.fill();
    const s = { back, front, m };
    ART.tubes.set(key, s);
    return s;
  }

  // ---------- simulation ----------
  let G = null;

  function newGame(idx, opts = {}) {
    const L = LEVELS[idx];
    const nT = L.tubes.length + (opts.extra ? 1 : 0);
    const lay = tubeLayout(nT);
    const balls = [], tubes = [];
    L.tubes.forEach((t) => tubes.push(t.map((c) => { const b = { id: balls.length, c, col: L.colors[c], segs: [], lands: [] }; balls.push(b); return b; })));
    while (tubes.length < nT) tubes.push([]);
    tubes.forEach((t, i) => t.forEach((b, k) => { b.home = { x: lay.cx(i), y: lay.slotY(k) }; }));
    if (ART.levelIdx !== idx) { buildLevelArt(L); ART.levelIdx = idx; }
    G = {
      idx, L, lay, nT, balls, tubes,
      sel: -1, selBall: null, selSince: 0,
      selIntervals: [],
      busy: new Array(nT).fill(-1e9),
      complete: new Array(nT).fill(Infinity),
      shakes: [], taps: [], bursts: [],
      revealK: L.colors.map(() => 0),
      pixT: new Float64Array(256).fill(Infinity),
      history: [], winT: Infinity, extra: !!opts.extra, extraT: opts.extraT ?? -1e9,
      audio: [], silent: false, animEnd: 0,
    };
    tubeSprites(lay);
    return G;
  }

  const cx = (i) => G.lay.cx(i);
  function slotPos(i, k) { return { x: G.lay.cx(i), y: G.lay.slotY(k) }; }

  function ballPos(b, t) {
    let s = null;
    for (let q = b.segs.length - 1; q >= 0; q--) if (b.segs[q].t0 <= t) { s = b.segs[q]; break; }
    if (!s) return b.home;
    const u = clamp((t - s.t0) / (s.t1 - s.t0), 0, 1);
    if (s.k === 'lift') {
      let y = lerp(s.a.y, s.b.y, easeOutCubic(u));
      if (u >= 1) y += Math.sin((t - s.t1) * 7) * 5;
      return { x: s.a.x, y };
    }
    if (s.k === 'travel') {
      const e = easeInOutCubic(u);
      return { x: lerp(s.a.x, s.b.x, e), y: lerp(s.a.y, s.b.y, e) - s.arc * Math.sin(Math.PI * e) };
    }
    const e = easeInQuad(u);
    return { x: lerp(s.a.x, s.b.x, e), y: lerp(s.a.y, s.b.y, e) };
  }

  function sfx(type, t, p) { if (!G.silent) G.audio.push({ t, type, p: p || {} }); if (Sound.live) Sound.live(type, t, p || {}); }
  function bump(t) { G.animEnd = Math.max(G.animEnd, t); }

  function canMove(i, j) {
    if (i === j) return false;
    const a = G.tubes[i], b = G.tubes[j];
    if (!a.length || b.length >= CAP) return false;
    return !b.length || b[b.length - 1].c === a[a.length - 1].c;
  }
  function tubeDone(i) { const t = G.tubes[i]; return t.length === CAP && t.every((b) => b.c === t[0].c); }
  function solved() { return G.tubes.every((t, i) => t.length === 0 || tubeDone(i)); }
  function anyMove() {
    for (let i = 0; i < G.nT; i++) { if (tubeDone(i)) continue; for (let j = 0; j < G.nT; j++) if (canMove(i, j)) return true; }
    return false;
  }

  function doSelect(i, t) {
    t = Math.max(t, G.busy[i]);
    const tube = G.tubes[i], b = tube[tube.length - 1];
    const a = ballPos(b, t);
    b.segs.push({ k: 'lift', t0: t, t1: t + 0.11, a, b: { x: a.x, y: G.lay.hoverY } });
    G.sel = i; G.selBall = b; G.selSince = t;
    G.selIntervals.push({ i, t0: t, t1: Infinity });
    sfx('lift', t, { k: tube.length - 1 });
    bump(t + 0.2);
    return t;
  }
  function closeSel(t) { const s = G.selIntervals[G.selIntervals.length - 1]; if (s && s.t1 === Infinity) s.t1 = t; }
  function doDeselect(t) {
    const i = G.sel, b = G.selBall; if (i < 0) return t;
    t = Math.max(t, G.selSince + 0.11);
    const k = G.tubes[i].length - 1;
    const a = ballPos(b, t), to = slotPos(i, k);
    b.segs.push({ k: 'drop', t0: t, t1: t + 0.12, a, b: to });
    b.lands.push(t + 0.12);
    G.busy[i] = Math.max(G.busy[i], t + 0.12);
    closeSel(t);
    G.sel = -1; G.selBall = null;
    sfx('settle', t + 0.12, { k });
    bump(t + 0.3);
    return t;
  }
  function doMove(j, t) {
    const i = G.sel, b = G.selBall;
    const dist = Math.abs(cx(j) - cx(i));
    const dTravel = 0.15 + dist * 0.00022;
    t = Math.max(t, G.selSince + 0.08, G.busy[j] - dTravel + 0.02);
    G.tubes[i].pop();
    const k = G.tubes[j].length;
    G.tubes[j].push(b);
    const a = ballPos(b, t), hov = { x: cx(j), y: G.lay.hoverY };
    b.segs.push({ k: 'travel', t0: t, t1: t + dTravel, a, b: hov, arc: 34 + dist * 0.06 });
    const to = slotPos(j, k);
    const dDrop = 0.08 + (to.y - hov.y) * 0.00022;
    const tl = t + dTravel + dDrop;
    b.segs.push({ k: 'drop', t0: t + dTravel, t1: tl, a: hov, b: to });
    b.lands.push(tl);
    G.busy[j] = tl; G.busy[i] = Math.max(G.busy[i], t);
    closeSel(t);
    G.sel = -1; G.selBall = null;
    G.history.push([i, j]);
    sfx('land', tl, { k });
    afterLand(j, tl);
    bump(tl + 0.3);
    return { t, tl };
  }

  function reveal(c, k, t) {
    if (k <= G.revealK[c]) return;
    const order = G.L.order[c], N = order.length;
    const from = Math.floor((N * G.revealK[c]) / CAP);
    const to = k >= CAP ? N : Math.floor((N * k) / CAP);
    G.revealK[c] = k;
    const n = to - from;
    if (n <= 0) return;
    const spread = Math.min(0.55, 0.012 * n + 0.08);
    for (let q = 0; q < n; q++) G.pixT[order[from + q]] = t + 0.04 + spread * (n === 1 ? 0 : q / (n - 1));
    sfx('reveal', t + 0.04, { n, spread });
    bump(t + spread + 0.5);
  }

  function afterLand(j, t) {
    const tube = G.tubes[j], c = tube[0].c;
    const pure = tube.every((b) => b.c === c);
    if (pure) reveal(c, tube.length, t);
    if (pure && tube.length === CAP) {
      G.complete[j] = t;
      G.bursts.push({ kind: 'pop', t, x: cx(j), y: G.lay.top - 6, col: G.L.colors[c], seed: 1000 + G.history.length * 37 + j });
      sfx('complete', t + 0.03, { c });
      bump(t + 1.2);
    }
    if (solved()) {
      G.winT = t + 0.25;
      G.bursts.push({ kind: 'confetti', t: G.winT + 0.45, seed: 4242 + G.idx });
      sfx('win', G.winT + 0.3, {});
      bump(G.winT + 4.5);
    }
  }

  function rebuild(history, extra, now) {
    const idx = G.idx;
    newGame(idx, { extra, extraT: extra ? G.extraT : -1e9 });
    G.silent = true;
    const T = -1000;
    for (const [i, j] of history) {
      const b = G.tubes[i].pop(), k = G.tubes[j].length;
      G.tubes[j].push(b);
      b.home = slotPos(j, k); b.segs = []; b.lands = [];
      G.history.push([i, j]);
      afterLand(j, T);
    }
    G.audio = []; G.silent = false;
    G.animEnd = now + 0.5;
  }

  // ---------- rendering ----------
  let canvas, ctx;

  function revealedCount(t) { let n = 0; const P = G.pixT; for (let p = 0; p < 256; p++) if (P[p] <= t) n++; return n; }

  function drawCard(t) {
    const winU = easeOutCubic(prog(t, G.winT + 0.35, 0.55));
    const z = 1 + 0.035 * winU;
    const ccx = CARD.x + CARD.size / 2, ccy = CARD.y + CARD.size / 2;
    ctx.save();
    ctx.translate(ccx, ccy); ctx.scale(z, z); ctx.translate(-ccx, -ccy);
    if (winU > 0) {
      const gl = ctx.createRadialGradient(ccx, ccy, CARD.size * 0.3, ccx, ccy, CARD.size * 0.85);
      gl.addColorStop(0, `rgba(255,214,90,${0.35 * winU})`); gl.addColorStop(1, 'rgba(255,214,90,0)');
      ctx.fillStyle = gl; ctx.fillRect(CARD.x - 300, CARD.y - 300, CARD.size + 600, CARD.size + 600);
    }
    ctx.drawImage(ART.card, CARD.x - ART.cardM, CARD.y - ART.cardM);
    ctx.drawImage(ART.hidden, CARD.x, CARD.y);
    const s = CARD.cell, P = G.pixT;
    for (let p = 0; p < 256; p++) {
      const pt = P[p];
      if (pt > t) continue;
      const gx = p % 16, gy = (p / 16) | 0;
      const sx = CARD.pad + gx * s, sy = CARD.pad + gy * s;
      const u = (t - pt) / 0.34;
      if (u >= 1) { ctx.drawImage(ART.revealed, sx, sy, s, s, CARD.x + sx, CARD.y + sy, s, s); continue; }
      const sc = lerp(0.3, 1, easeOutBack(clamp(u, 0, 1)));
      const d = s * sc, ox = CARD.x + sx + (s - d) / 2, oy = CARD.y + sy + (s - d) / 2;
      ctx.drawImage(ART.revealed, sx, sy, s, s, ox, oy, d, d);
      ctx.globalAlpha = Math.pow(1 - u, 1.6) * 0.9;
      ctx.drawImage(ART.flash, ox, oy, d, d);
      ctx.globalAlpha = 1;
    }
    // shine sweep on completion
    const su = prog(t, G.winT + 0.5, 0.75);
    if (su > 0 && su < 1) {
      ctx.save(); rr(ctx, CARD.x, CARD.y, CARD.size, CARD.size, 34); ctx.clip();
      const bx = lerp(CARD.x - 300, CARD.x + CARD.size + 300, easeInOutCubic(su));
      ctx.translate(bx, CARD.y + CARD.size / 2); ctx.rotate(0.45);
      const g = ctx.createLinearGradient(-90, 0, 90, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-90, -700, 180, 1400);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawProgress(t) {
    const hideU = prog(t, G.winT + 0.2, 0.25);
    const n = revealedCount(t), f = n / 256;
    if (hideU < 1) {
      ctx.save(); ctx.globalAlpha = 1 - hideU;
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; rr(ctx, BAR.x, BAR.y, BAR.w, BAR.h, BAR.h / 2); ctx.fill();
      if (f > 0) {
        const g = ctx.createLinearGradient(BAR.x, 0, BAR.x + BAR.w, 0);
        g.addColorStop(0, '#FFE07A'); g.addColorStop(1, '#FFB21F');
        ctx.fillStyle = g; rr(ctx, BAR.x, BAR.y, Math.max(BAR.h, BAR.w * f), BAR.h, BAR.h / 2); ctx.fill();
      }
      ctx.fillStyle = '#FFFFFF'; ctx.font = `700 34px ${FONT_UI}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(f * 100) + '%', CARD.x + CARD.size, BAR.y + BAR.h / 2 + 1);
      ctx.restore();
    }
    const nu = prog(t, G.winT + 0.4, 0.45);
    if (nu > 0) {
      const sc = easeOutBack(nu);
      ctx.save(); ctx.translate(W / 2, BAR.y + 32); ctx.scale(sc, sc);
      ctx.font = `400 84px ${FONT_DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = css(BROWN); ctx.strokeText(G.L.name + '!', 0, 0);
      ctx.fillStyle = css(GOLD); ctx.fillText(G.L.name + '!', 0, 0);
      ctx.restore();
    }
  }

  function selectedAt(i, t) { for (const s of G.selIntervals) if (s.i === i && t >= s.t0 && t < s.t1) return true; return false; }
  function shakeAt(i, t) {
    let x = 0;
    for (const s of G.shakes) if (s.i === i && t >= s.t && t < s.t + 0.36) { const u = (t - s.t) / 0.36; x += Math.sin(u * Math.PI * 6) * 14 * (1 - u); }
    return x;
  }

  function drawTubes(t) {
    const lay = G.lay, spr = tubeSprites(lay);
    const fadeU = easeOutCubic(prog(t, G.winT + 0.15, 0.45));
    ctx.save();
    ctx.globalAlpha = 1 - 0.78 * fadeU;
    ctx.translate(0, 26 * fadeU);
    const inside = [], outside = [];
    for (const b of G.balls) {
      const p = ballPos(b, t);
      (p.y > lay.top + 6 ? inside : outside).push([b, p]);
    }
    const sh = []; for (let i = 0; i < lay.n; i++) sh.push(shakeAt(i, t));
    for (let i = 0; i < lay.n; i++) {
      const X = cx(i) + sh[i];
      const ap = G.extra && i === lay.n - 1 ? easeOutBack(prog(t, G.extraT, 0.4)) : 1;
      if (ap <= 0) continue;
      ctx.save();
      if (ap < 1) { ctx.translate(X, lay.bottom); ctx.scale(ap, ap); ctx.translate(-X, -lay.bottom); }
      const cu = prog(t, G.complete[i], 0.35);
      if (cu > 0) {
        const col = hex2rgb(G.tubes[i].length ? G.tubes[i][0].col : '#FFFFFF');
        const gl = ctx.createRadialGradient(X, lay.top + lay.th / 2, 10, X, lay.top + lay.th / 2, lay.th * 0.75);
        gl.addColorStop(0, css(col, 0.42 * cu)); gl.addColorStop(1, css(col, 0));
        ctx.fillStyle = gl; ctx.fillRect(X - lay.th, lay.top - lay.th * 0.3, lay.th * 2, lay.th * 1.6);
      }
      if (selectedAt(i, t)) {
        ctx.save(); ctx.translate(X - lay.tw / 2 - 9, lay.top - 4);
        tubePath(ctx, 0, 0, lay.tw + 18, lay.th + 13);
        ctx.strokeStyle = 'rgba(255,205,70,0.9)'; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.restore();
      }
      ctx.drawImage(spr.back, X - lay.tw / 2 - spr.m, lay.top - spr.m);
      ctx.restore();
    }
    for (const [b, p] of inside) drawBall(b, p, t, sh);
    for (let i = 0; i < lay.n; i++) {
      const X = cx(i) + sh[i];
      const ap = G.extra && i === lay.n - 1 ? easeOutBack(prog(t, G.extraT, 0.4)) : 1;
      if (ap <= 0) continue;
      ctx.save();
      if (ap < 1) { ctx.translate(X, lay.bottom); ctx.scale(ap, ap); ctx.translate(-X, -lay.bottom); }
      ctx.drawImage(spr.front, X - lay.tw / 2 - spr.m, lay.top - spr.m);
      const cu = prog(t, G.complete[i], 0.3);
      if (cu > 0 && G.tubes[i].length) {
        const col = hex2rgb(G.tubes[i][0].col), sc = easeOutBack(cu);
        const cw = lay.tw + 14, chh = 30, cyy = lay.top - 20;
        ctx.save(); ctx.translate(X, cyy + chh / 2); ctx.scale(sc, sc);
        ctx.fillStyle = css(mix(col, BLACK, 0.25)); rr(ctx, -cw / 2, -chh / 2 + 5, cw, chh, 12); ctx.fill();
        ctx.fillStyle = css(col); rr(ctx, -cw / 2, -chh / 2, cw, chh - 4, 12); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(ctx, -cw / 2 + 10, -chh / 2 + 5, cw * 0.4, 6, 3); ctx.fill();
        ctx.restore();
        // check badge
        const bu = easeOutBack(prog(t, G.complete[i] + 0.12, 0.3));
        if (bu > 0) {
          ctx.save(); ctx.translate(X, cyy - 34); ctx.scale(bu, bu);
          ctx.fillStyle = css(GOLD); ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = css(BROWN); ctx.lineWidth = 4; ctx.stroke();
          ctx.strokeStyle = css(BROWN); ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(-10, 1); ctx.lineTo(-3, 8); ctx.lineTo(11, -8); ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    }
    for (const [b, p] of outside) drawBall(b, p, t, sh);
    ctx.restore();
  }

  function drawBall(b, p, t, sh) {
    const r = G.lay.r, spr = ballSprite(b.col, r);
    let sx = 1, sy = 1;
    for (let q = b.lands.length - 1; q >= 0; q--) {
      const lt = b.lands[q];
      if (lt <= t) { const u = (t - lt) / 0.2; if (u < 1) { const k = Math.sin(Math.PI * u) * (1 - u); sx = 1 + 0.14 * k; sy = 1 - 0.16 * k; } break; }
    }
    let x = p.x;
    if (sh) { const i = Math.round((p.x - G.lay.x0 - G.lay.tw / 2) / (G.lay.tw + G.lay.gap)); if (i >= 0 && i < sh.length && Math.abs(G.lay.cx(i) - p.x) < 2) x += sh[i]; }
    const S0 = spr.c.width, w = S0 * sx, h = S0 * sy;
    ctx.drawImage(spr.c, x - w / 2, p.y + r - (2 * r + spr.pad) * sy, w, h);
  }

  function drawBursts(t) {
    for (const bu of G.bursts) {
      const dt = t - bu.t;
      if (bu.kind === 'pop') {
        if (dt < 0 || dt > 0.95) continue;
        const r = rng(bu.seed), col = hex2rgb(bu.col);
        for (let k = 0; k < 30; k++) {
          const ang = -Math.PI / 2 + (r() - 0.5) * 2.6, sp = 420 + r() * 620, sz = 9 + r() * 12;
          const kind = r(); const c = kind < 0.58 ? col : kind < 0.82 ? WHITE : GOLD;
          const x = bu.x + Math.cos(ang) * sp * dt, y = bu.y + Math.sin(ang) * sp * dt + 0.5 * 2100 * dt * dt;
          const a = 1 - clamp((dt - 0.5) / 0.45, 0, 1);
          ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(r() * 6 + dt * (r() * 10 - 5));
          ctx.fillStyle = css(c); rr(ctx, -sz / 2, -sz / 2, sz, sz, 3); ctx.fill();
          ctx.restore();
        }
        // ring
        const ru = dt / 0.4;
        if (ru < 1) { ctx.save(); ctx.globalAlpha = 0.6 * (1 - ru); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 6 * (1 - ru) + 1; ctx.beginPath(); ctx.arc(bu.x, bu.y + 20, 30 + 90 * easeOutCubic(ru), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      } else if (bu.kind === 'confetti') {
        if (dt < 0 || dt > 3.6 || reduced()) continue;
        const r = rng(bu.seed);
        const pal = G.L.colors.map(hex2rgb).concat([GOLD, WHITE]);
        for (let k = 0; k < 120; k++) {
          const x0 = r() * W, y0 = -60 - r() * 520, vy = 260 + r() * 360, vx = (r() - 0.5) * 220;
          const sw = 20 + r() * 40, fr = 1.5 + r() * 2.5, ph = r() * 6, sz = 14 + r() * 14, c = pal[(r() * pal.length) | 0], rot = r() * 6, spin = (r() - 0.5) * 9;
          const y = y0 + vy * dt + 0.5 * 420 * dt * dt;
          if (y < -40 || y > H + 40) continue;
          const x = x0 + vx * dt + Math.sin(ph + dt * fr) * sw;
          ctx.save(); ctx.globalAlpha = 1 - clamp((dt - 2.8) / 0.8, 0, 1); ctx.translate(x, y); ctx.rotate(rot + spin * dt);
          ctx.scale(1, Math.abs(Math.cos(ph + dt * 5)) * 0.8 + 0.2);
          ctx.fillStyle = css(c); ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
          ctx.restore();
        }
      }
    }
  }

  function drawTaps(t) {
    for (const tp of G.taps) {
      const dt = t - tp.t;
      if (dt < 0 || dt > 0.45) continue;
      const u = dt / 0.45;
      ctx.save();
      ctx.globalAlpha = 0.55 * (1 - u); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 26 + 46 * easeOutCubic(u), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.42 * (1 - clamp(dt / 0.25, 0, 1)); ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 30, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function star(cxx, cyy, R, r) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? r : R; ctx.lineTo(cxx + Math.cos(a) * rad, cyy + Math.sin(a) * rad); }
    ctx.closePath();
  }

  function drawWin(t) {
    if (t < G.winT) return;
    const lay = G.lay;
    const y = lay.top + lay.th * 0.5;
    const u = prog(t, G.winT + 0.25, 0.42);
    if (u <= 0) return;
    const sc = easeOutBack(u);
    ctx.save(); ctx.translate(W / 2, y); ctx.scale(sc, sc);
    const bw = 820, bh = 150;
    // tails
    ctx.fillStyle = css(GOLD_DEEP);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * (bw / 2 - 30), -bh / 2 + 34); ctx.lineTo(s * (bw / 2 + 70), -bh / 2 + 34); ctx.lineTo(s * (bw / 2 + 30), 10 + 26);
      ctx.lineTo(s * (bw / 2 + 70), bh / 2 + 34); ctx.lineTo(s * (bw / 2 - 30), bh / 2 + 34); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = css(BROWN); ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.stroke();
    }
    const g = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    g.addColorStop(0, '#FFE27A'); g.addColorStop(0.55, '#FFC83D'); g.addColorStop(1, '#F2A400');
    ctx.fillStyle = g; rr(ctx, -bw / 2, -bh / 2, bw, bh, 26); ctx.fill();
    ctx.strokeStyle = css(BROWN); ctx.lineWidth = 7; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(ctx, -bw / 2 + 22, -bh / 2 + 14, bw - 44, 16, 8); ctx.fill();
    ctx.font = `400 92px ${FONT_DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = css(BROWN); ctx.strokeText('LEVEL COMPLETE', 0, 6);
    ctx.fillStyle = '#FFFFFF'; ctx.fillText('LEVEL COMPLETE', 0, 6);
    ctx.restore();
    // stars
    [[-150, 0.55, 58], [0, 0.7, 76], [150, 0.85, 58]].forEach(([dx, d, R], k) => {
      const su = prog(t, G.winT + d, 0.35);
      if (su <= 0) return;
      const s2 = easeOutBack(su);
      ctx.save(); ctx.translate(W / 2 + dx, y - 150 - (k === 1 ? 26 : 0)); ctx.scale(s2, s2); ctx.rotate((1 - su) * (k - 1) * 0.6);
      star(0, 0, R, R * 0.48); ctx.fillStyle = css(GOLD); ctx.fill();
      ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.strokeStyle = css(BROWN); ctx.stroke();
      star(-R * 0.08, -R * 0.12, R * 0.42, R * 0.2); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
      ctx.restore();
    });
  }

  function drawCaption(lines, cxx, top, size, u) {
    if (u <= 0) return;
    ctx.save();
    ctx.font = `700 ${size}px ${FONT_UI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lh = size * 1.32, padX = size * 0.42;
    const sc = easeOutBack(u);
    ctx.translate(cxx, top + (lines.length * lh) / 2); ctx.scale(sc, sc); ctx.translate(-cxx, -(top + (lines.length * lh) / 2));
    lines.forEach((ln, k) => {
      const w = ctx.measureText(ln).width + padX * 2;
      ctx.fillStyle = '#FFFFFF'; rr(ctx, cxx - w / 2, top + k * lh - 2, w, lh + 4, size * 0.3); ctx.fill();
    });
    ctx.fillStyle = '#111418';
    lines.forEach((ln, k) => ctx.fillText(ln, cxx, top + k * lh + lh / 2 + 2));
    ctx.restore();
  }

  function drawLogo() {
    ctx.save();
    ctx.font = `400 58px ${FONT_DISPLAY}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const a = 'PIXEL ', b = 'SORT', wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
    const x0 = W / 2 - (wa + wb) / 2, y = 1712;
    ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,16,28,0.6)';
    ctx.strokeText(a, x0, y); ctx.strokeText(b, x0 + wa, y);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(a, x0, y);
    ctx.fillStyle = css(GOLD); ctx.fillText(b, x0 + wa, y);
    ctx.restore();
  }

  function drawHeader(t, opt) {
    if (opt && opt.video) {
      const ctaT = opt.cta ? opt.ctaT : Infinity;
      if (t < ctaT) drawCaption(opt.hook, W / 2, 178, 68, opt.hookPop ? prog(t, 0, 0.25) : 1);
      else drawCaption(opt.cta, W / 2, 178, 68, prog(t, ctaT, 0.3));
      drawLogo();
      return;
    }
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `400 70px ${FONT_DISPLAY}`; ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(0,20,35,0.55)';
    const label = 'LEVEL ' + (G.idx + 1);
    ctx.strokeText(label, W / 2, 132); ctx.fillStyle = '#FFFFFF'; ctx.fillText(label, W / 2, 132);
    ctx.font = `600 40px ${FONT_UI}`; ctx.fillStyle = 'rgba(232,246,255,0.75)';
    const sub = G.winT <= t ? 'Picture complete' : G.idx === 0 && G.history.length < 2 ? 'Tap a tube, then tap where the ball goes' : `Moves ${G.history.length}`;
    ctx.fillText(sub, W / 2, 206);
    ctx.restore();
  }

  function render(t, opt) {
    if (!G) return;
    if (opt && opt.video) ctx.drawImage(ART.bg, 0, 0); else ctx.clearRect(0, 0, W, H);
    drawCard(t);
    drawProgress(t);
    drawTubes(t);
    drawBursts(t);
    drawTaps(t);
    drawWin(t);
    drawHeader(t, opt);
  }

  // ---------- sound (WebAudio synth, also used offline for videos) ----------
  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const PENTA = [72, 74, 76, 79, 81, 84];
  function impulse(ac, dur, decay) {
    const len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(2, len, ac.sampleRate), r = rng(1234);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
  }
  function chain(ac, dest) {
    const input = ac.createGain();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    const conv = ac.createConvolver(); conv.buffer = impulse(ac, 1.6, 3.2);
    const wet = ac.createGain(); wet.gain.value = 0.2;
    input.connect(comp); input.connect(conv); conv.connect(wet); wet.connect(comp); comp.connect(dest);
    return input;
  }
  function tone(ac, out, t, f, dur, o = {}) {
    const osc = ac.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || 0.05));
    const g = ac.createGain(), gain = o.gain ?? 0.2, at = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(out); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(ac, out, t, dur, o = {}) {
    const len = Math.max(1, Math.floor(ac.sampleRate * dur)), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0), r = rng(o.seed || 1);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.value = o.freq || 2000; f.Q.value = o.q || 1;
    const g = ac.createGain(); g.gain.setValueAtTime(o.gain ?? 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
  }
  const VOICES = {
    lift(ac, out, t, p) { tone(ac, out, t, 560, 0.12, { gain: 0.13, f2: 880, glide: 0.07 }); tone(ac, out, t, 1120, 0.07, { gain: 0.025, f2: 1700, glide: 0.05 }); },
    settle(ac, out, t, p) { tone(ac, out, t, NOTE(PENTA[clamp(p.k, 0, 5)]) / 2, 0.12, { type: 'triangle', gain: 0.1 }); },
    land(ac, out, t, p) {
      const f = NOTE(PENTA[clamp(p.k, 0, 5)]);
      tone(ac, out, t, f, 0.26, { type: 'triangle', gain: 0.22 }); tone(ac, out, t, f * 2, 0.1, { gain: 0.05 });
      noise(ac, out, t, 0.025, { gain: 0.06, freq: 3400, q: 0.8, seed: 7 });
    },
    complete(ac, out, t) {
      [84, 88, 91, 96].forEach((n, i) => { const tt = t + i * 0.055; tone(ac, out, tt, NOTE(n), 0.9, { gain: 0.085 }); tone(ac, out, tt, NOTE(n) * 2.76, 0.3, { gain: 0.02 }); });
      noise(ac, out, t, 0.28, { gain: 0.009, freq: 7000, q: 0.7, type: 'highpass', seed: 11 });
    },
    reveal(ac, out, t, p) {
      const r = rng(Math.floor(t * 1000) + p.n), k = Math.min(8, 2 + Math.floor(p.n / 5));
      for (let i = 0; i < k; i++) tone(ac, out, t + p.spread * (i / k), NOTE(PENTA[(r() * 6) | 0] + 24), 0.12, { gain: 0.022 });
    },
    invalid(ac, out, t) { tone(ac, out, t, 210, 0.16, { type: 'square', gain: 0.04, f2: 140, glide: 0.12 }); },
    win(ac, out, t) {
      [72, 76, 79, 84].forEach((n, i) => tone(ac, out, t + i * 0.1, NOTE(n), 0.55, { type: 'triangle', gain: 0.13 }));
      [60, 64, 67, 72].forEach((n) => tone(ac, out, t + 0.42, NOTE(n), 1.8, { type: 'triangle', gain: 0.05, attack: 0.02 }));
      [96, 100, 103, 108].forEach((n, i) => tone(ac, out, t + 0.5 + i * 0.07, NOTE(n), 0.9, { gain: 0.025 }));
    },
    booster(ac, out, t) { [67, 72, 76].forEach((n, i) => tone(ac, out, t + i * 0.06, NOTE(n), 0.3, { type: 'triangle', gain: 0.09 })); },
  };
  function music(ac, out, t0, dur) {
    const beat = 60 / 96, bar = beat * 4;
    const prog4 = [[60, 64, 67, 72], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]];
    const bass = [48, 43, 45, 41];
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(1, t0 + 0.03);
    g.gain.setValueAtTime(1, Math.max(t0 + 0.4, t0 + dur - 0.9)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(out);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.connect(g);
    const pat = [0, 1, 2, 3, 2, 1, 2, 3];
    for (let b = 0; b * bar < dur; b++) {
      const ch = prog4[b % 4], tb = t0 + b * bar;
      for (let s = 0; s < 8; s++) { const t = tb + (s * beat) / 2; if (t > t0 + dur) break; tone(ac, lp, t, NOTE(ch[pat[s]] + 12), 0.34, { type: 'triangle', gain: s % 2 ? 0.036 : 0.046 }); }
      tone(ac, lp, tb, NOTE(bass[b % 4]), bar * 0.48, { type: 'triangle', gain: 0.09, attack: 0.01 });
      tone(ac, lp, tb + bar / 2, NOTE(bass[b % 4]), bar * 0.45, { type: 'triangle', gain: 0.072, attack: 0.01 });
      for (let q = 0; q < 4; q++) noise(ac, g, tb + q * beat + beat / 2, 0.04, { gain: 0.012, freq: 8000, type: 'highpass', seed: 3 + q + b * 4 });
    }
  }

  const Sound = {
    ac: null, out: null, bus: null, on: true, live: null,
    ensure() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.out = this.ac.createGain(); this.out.gain.value = 0.9; this.out.connect(this.ac.destination);
      this.newBus();
    },
    newBus() {
      if (!this.ac) return;
      if (this.bus) { try { this.bus.disconnect(); } catch (e) { /* already gone */ } }
      this.bus = chain(this.ac, this.out);
    },
  };

  // ---------- interactive play ----------
  const play = { T0: 0, demo: false, raf: 0, onState: null, onEvent: null, levelT0: 0, moved: false, undos: 0 };
  function emit(name, props) {
    if (!play.onEvent || !G) return;
    try { play.onEvent(name, Object.assign({ level: G.idx + 1, picture: G.L.id }, props || {})); } catch (e) { /* analytics must never break play */ }
  }
  const now = () => (performance.now() - play.T0) / 1000;

  Sound.live = null;
  function liveSfx(type, t, p) {
    if (!Sound.on || !Sound.ac || !Sound.bus || S.mode !== 'play') return;
    const dt = t - now();
    if (dt < -0.05) return;
    const at = Sound.ac.currentTime + Math.max(0, dt) + 0.01;
    VOICES[type] && VOICES[type](Sound.ac, Sound.bus, at, p);
  }

  const S = { mode: 'play', video: null };

  function startLevel(idx, opts = {}) {
    Sound.newBus();
    newGame(idx, opts);
    G.animEnd = now() + 0.5;
    play.demo = false;
    play.levelT0 = now(); play.moved = false; play.undos = 0;
    kick();
    notify();
  }

  function hitTube(x, y) {
    const lay = G.lay;
    if (y < lay.hoverY - lay.r - 60 || y > lay.bottom + 60) return -1;
    for (let i = 0; i < lay.n; i++) if (Math.abs(x - cx(i)) <= (lay.tw + lay.gap) / 2) return i;
    return -1;
  }

  function tapTube(i) {
    if (play.demo || G.winT < Infinity) return;
    const t = now();
    if (G.sel < 0) {
      if (!G.tubes[i].length || tubeDone(i)) { if (G.tubes[i].length) shake(i, t); return; }
      doSelect(i, t);
    } else if (G.sel === i) {
      doDeselect(t);
    } else if (canMove(G.sel, i)) {
      doMove(i, t);
      if (!play.moved) { play.moved = true; emit('first_move', { seconds: Math.round((t - play.levelT0) * 10) / 10 }); }
      if (G.winT === Infinity && !anyMove()) setTimeout(() => { emit('stuck', { moves: G.history.length }); notify('stuck'); }, 700);
    } else if (G.tubes[i].length && !tubeDone(i)) {
      doDeselect(t); doSelect(i, t + 0.02);
    } else {
      shake(i, t); doDeselect(t);
    }
    kick(); notify();
  }
  function shake(i, t) { G.shakes.push({ i, t }); sfx('invalid', t, {}); bump(t + 0.4); }

  function undo() {
    if (play.demo || !G.history.length || G.winT < Infinity) return;
    const t = now();
    const [i, j] = G.history[G.history.length - 1];
    const b = G.tubes[j][G.tubes[j].length - 1];
    const p = ballPos(b, t);
    const bid = b.id;
    rebuild(G.history.slice(0, -1), G.extra, t);
    play.undos++;
    emit('undo', { moves: G.history.length });
    const nb = G.balls[bid];
    nb.segs.push({ k: 'travel', t0: t, t1: t + 0.26, a: p, b: nb.home, arc: 50 });
    nb.lands.push(t + 0.26);
    sfx('settle', t + 0.26, { k: G.tubes[i].length - 1 });
    G.animEnd = t + 0.6;
    kick(); notify();
  }
  function addTube() {
    if (play.demo || G.extra || G.winT < Infinity) return false;
    const t = now();
    G.extraT = t;
    rebuild(G.history, true, t);
    G.extraT = t;
    sfx('booster', t, {});
    emit('booster_used', { moves: G.history.length });
    G.animEnd = t + 0.7;
    kick(); notify();
    return true;
  }
  function demo() {
    startLevel(G.idx);
    play.demo = true;
    G.byDemo = true;
    scheduleSolution(now() + 0.5, { p0: 0.62, p1: 0.5, seed: 3 });
    kick(); notify();
  }

  function scheduleSolution(t, cfg) {
    const r = rng(cfg.seed || 1), sol = G.L.solution;
    sol.forEach(([i, j], m) => {
      const pr = m / Math.max(1, sol.length - 1);
      const period = lerp(cfg.p0, cfg.p1, pr) * (0.92 + r() * 0.16);
      const hold = 0.2 + r() * 0.06;
      const ts = doSelect(i, t);
      G.taps.push({ x: cx(i), y: G.lay.top + G.lay.th * 0.55, t: ts });
      const mv = doMove(j, ts + hold);
      G.taps.push({ x: cx(j), y: G.lay.top + G.lay.th * 0.55, t: mv.t });
      t = ts + period;
    });
  }

  function frame() {
    play.raf = 0;
    const t = now();
    render(t, null);
    if (play.demo && G.winT < Infinity && t > G.winT) { play.demo = false; notify(); }
    if (t < G.animEnd || G.sel >= 0 || (G.winT < Infinity && t < G.winT + 4.5)) kick();
    if (G.winT < Infinity && t > G.winT + 1.2 && !play.winShown) {
      play.winShown = true;
      emit('level_complete', { moves: G.history.length, seconds: Math.round((G.winT - play.levelT0) * 10) / 10, undos: play.undos, booster: G.extra, watched_solution: !!G.byDemo });
      notify('win');
    }
  }
  function kick() { if (!play.raf && S.mode === 'play') play.raf = requestAnimationFrame(frame); }
  function notify(evt) { if (play.onState) play.onState(evt || 'update'); }

  function reduced() { try { return S.mode === 'play' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  // ---------- video API ----------
  function renderAlbum(t, opt) {
    ctx.drawImage(ART.bg, 0, 0);
    const cols = 3, size = 272, pad = 14, gap = 34, cw = size + pad * 2;
    const x0 = (W - (cols * cw + (cols - 1) * gap)) / 2, y0 = 452;
    opt.slots.forEach((slot, k) => {
      const col = k % cols, row = (k / cols) | 0;
      const x = x0 + col * (cw + gap), y = y0 + row * (cw + 104);
      const u = prog(t, 0.12 + k * 0.13, 0.42);
      if (u <= 0) return;
      const sc = easeOutBack(u), mx = x + cw / 2, my = y + cw / 2;
      ctx.save(); ctx.translate(mx, my); ctx.scale(sc, sc); ctx.translate(-mx, -my);
      ctx.save(); ctx.shadowColor = 'rgba(0,10,20,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
      ctx.fillStyle = '#FFFFFF'; rr(ctx, x, y, cw, cw, 26); ctx.fill(); ctx.restore();
      ctx.drawImage(picThumb(slot, size), x + pad, y + pad);
      ctx.font = `600 38px ${FONT_UI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = slot < 0 ? 'rgba(232,246,255,0.6)' : '#FFFFFF';
      const nm = slot < 0 ? 'Next…' : LEVELS[slot].name.charAt(0) + LEVELS[slot].name.slice(1).toLowerCase();
      ctx.fillText(nm, mx, y + cw + 40);
      if (opt.fresh.includes(slot)) {
        const bu = easeOutBack(prog(t, 0.45 + k * 0.13, 0.3));
        if (bu > 0) {
          ctx.save(); ctx.translate(x + cw - 16, y + 14); ctx.rotate(0.18); ctx.scale(bu, bu);
          ctx.fillStyle = css(GOLD); rr(ctx, -54, -24, 108, 48, 24); ctx.fill();
          ctx.strokeStyle = css(BROWN); ctx.lineWidth = 5; ctx.stroke();
          ctx.fillStyle = css(BROWN); ctx.font = `400 34px ${FONT_DISPLAY}`; ctx.fillText('NEW', 0, 2);
          ctx.restore();
        }
      }
      ctx.restore();
    });
    const nu = easeOutBack(prog(t, 0.2 + opt.slots.length * 0.13, 0.4));
    if (nu > 0) {
      const done = opt.slots.filter((s) => s >= 0).length;
      ctx.save(); ctx.translate(W / 2, y0 + 2 * (cw + 104) + 56); ctx.scale(nu, nu);
      ctx.font = `400 76px ${FONT_DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = css(BROWN);
      const label = `ALBUM ${done}/${opt.slots.length}`;
      ctx.strokeText(label, 0, 0); ctx.fillStyle = css(GOLD); ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    const ctaT = opt.cta ? opt.ctaT : Infinity;
    if (t < ctaT) drawCaption(opt.hook, W / 2, 178, 68, 1);
    else drawCaption(opt.cta, W / 2, 178, 68, prog(t, ctaT, 0.3));
    drawLogo();
  }

  const video = {
    setup(cfg) {
      S.mode = 'video';
      newGame(cfg.level);
      scheduleSolution(cfg.intro ?? 0.6, { p0: cfg.p0 ?? 0.66, p1: cfg.p1 ?? 0.5, seed: cfg.seed ?? 1 });
      const winT = G.winT;
      S.video = { video: true, hook: cfg.hook, cta: cfg.cta, hookPop: !!cfg.hookPop, ctaT: winT + (cfg.ctaDelay ?? 1.75), duration: winT + (cfg.outro ?? 3.7) };
      S.events = G.audio;
      return { duration: S.video.duration, winT, moves: G.history.length, sounds: G.audio.length };
    },
    album(cfg) {
      S.mode = 'video';
      S.video = { video: true, album: true, hook: cfg.hook, cta: cfg.cta, ctaT: cfg.ctaT ?? 1.2, duration: cfg.duration ?? 3.4, slots: cfg.slots, fresh: cfg.fresh || [] };
      S.events = cfg.slots.map((s, k) => ({ t: 0.12 + k * 0.13 + 0.12, type: 'land', p: { k: Math.min(5, k) } }));
      S.events.push({ t: 0.2 + cfg.slots.length * 0.13 + 0.1, type: 'complete', p: {} });
      return { duration: S.video.duration };
    },
    frame(t, type = 'image/png', q) { if (S.video.album) renderAlbum(t, S.video); else render(t, S.video); return canvas.toDataURL(type, q); },
    async audio(o = {}) {
      const rate = o.rate || 48000, dur = o.duration || S.video.duration;
      const ac = new OfflineAudioContext(2, Math.ceil(rate * dur), rate);
      const bus = chain(ac, ac.destination);
      if (o.music !== false) music(ac, bus, 0, dur);
      if (o.sfx !== false) for (const e of S.events) if (VOICES[e.type] && e.t < dur) VOICES[e.type](ac, bus, Math.max(0, e.t), e.p);
      const buf = await ac.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
      const inter = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { inter[i * 2] = L[i]; inter[i * 2 + 1] = R[i]; }
      const bytes = new Uint8Array(inter.buffer);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
  };

  // ---------- boot ----------
  async function init(cv, opts = {}) {
    canvas = cv; ctx = canvas.getContext('2d');
    try {
      await Promise.all([
        document.fonts.load(`700 60px ${FONT_UI}`), document.fonts.load(`600 30px ${FONT_UI}`), document.fonts.load(`400 80px ${FONT_DISPLAY}`),
      ]);
    } catch (e) { /* fall back to system fonts */ }
    buildBackground(); buildCard();
    play.T0 = performance.now();
    Sound.live = liveSfx;
    if (opts.video) { S.mode = 'video'; return; }
    S.mode = 'play';
    startLevel(opts.level || 0);
    if (opts.history && opts.history.length) { rebuild(opts.history, !!opts.extra, now()); kick(); notify(); }
  }

  window.PS = {
    init, video, levels: LEVELS, Sound,
    art: { thumb: (i, size) => picThumb(i, size), bg: () => ART.bg, ball: (hex, r) => ballSprite(hex, r).c },
    get state() { return G; },
    play: {
      tapAt(x, y) { const i = hitTube(x, y); if (i >= 0) { Sound.ensure(); tapTube(i); } },
      tapTube(i) { if (i >= 0 && i < G.nT) { Sound.ensure(); tapTube(i); } },
      undo, restart: () => { Sound.ensure(); play.winShown = false; emit('level_restart', { moves: G.history.length }); startLevel(G.idx); emit('level_start', { via: 'restart' }); },
      level: (i, via) => { play.winShown = false; startLevel(clamp(i, 0, LEVELS.length - 1)); emit('level_start', { via: via || 'menu' }); },
      addTube, demo: () => { Sound.ensure(); play.winShown = false; demo(); emit('watch_solution'); },
      set onEvent(f) { play.onEvent = f; },
      get demoing() { return play.demo; },
      set onState(f) { play.onState = f; },
      thumb: (i) => { const L = LEVELS[i]; const c = mk(160, 160), x = c.getContext('2d'); for (let p = 0; p < 256; p++) { const gx = p % 16, gy = (p / 16) | 0; x.fillStyle = L.colors[L.grid[gy][gx]]; x.fillRect(gx * 10, gy * 10, 10, 10); } return c; },
      kick,
    },
  };
})();
