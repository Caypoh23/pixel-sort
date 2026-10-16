/* Pixel Sort web build: page wiring, analytics, install-intent question, sharing. */
(function () {
  'use strict';
  const C = window.PS_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  // ---------- analytics: PostHog + Meta Pixel, both optional ----------
  const A = (() => {
    const queue = [];
    let ph = null;
    const sp = { build: C.build || 'web' };
    const qs = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => { const v = qs.get(k); if (v) sp[k] = v.slice(0, 80); });
    if (!sp.utm_source && qs.get('fbclid')) sp.utm_source = 'facebook';
    if (!sp.utm_source && qs.get('src')) sp.utm_source = qs.get('src').slice(0, 40);
    try {
      const first = sessionStorage.getItem('ps.attribution');
      if (first) Object.assign(sp, JSON.parse(first));
      else sessionStorage.setItem('ps.attribution', JSON.stringify(sp));
    } catch (e) { /* storage unavailable */ }

    if (C.posthogKey) {
      const host = C.posthogHost || 'https://us.i.posthog.com';
      const s = document.createElement('script');
      s.async = true; s.crossOrigin = 'anonymous';
      s.src = host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
      s.onload = () => {
        const p = window.posthog;
        if (!p || typeof p.init !== 'function') return;
        p.init(C.posthogKey, { api_host: host, person_profiles: 'identified_only', autocapture: false, capture_pageview: true, capture_pageleave: true });
        p.register(sp);
        ph = p;
        while (queue.length) { const [n, pr] = queue.shift(); p.capture(n, pr); }
      };
      document.head.appendChild(s);
    }
    if (C.metaPixelId) {
      /* Meta Pixel base code */
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', String(C.metaPixelId));
      window.fbq('track', 'PageView');
    }
    const PIXEL = { first_move: 'StartPlaying', level_complete: 'LevelComplete', install_intent: 'InstallIntent', share_click: 'ShareGame' };
    function track(name, props) {
      const p = Object.assign({}, sp, props || {});
      if (ph) ph.capture(name, p); else if (C.posthogKey) queue.push([name, p]);
      if (window.fbq && PIXEL[name]) window.fbq('trackCustom', PIXEL[name], props || {});
      if (C.debug) console.info('[track]', name, p);
      (window.__psEvents = window.__psEvents || []).push([name, p]);
    }
    return { track };
  })();

  // ---------- layout ----------
  const stage = $('stage'), cv = $('game');
  function fit() {
    const r = $('app').getBoundingClientRect();
    const s = Math.max(0.05, Math.min(r.width / 1080, r.height / 1920));
    stage.style.width = 1080 * s + 'px';
    stage.style.height = 1920 * s + 'px';
    stage.style.setProperty('--u', s);
  }
  addEventListener('resize', fit);
  fit();

  // ---------- saved progress ----------
  const KEY = 'pixelsort.web.v1';
  const store = {
    read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } },
    write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const saved = store.read();
  const prog = {
    level: Number.isInteger(saved.level) ? saved.level : 0,
    solved: Array.isArray(saved.solved) ? saved.solved : [],
    sound: saved.sound !== false,
    asked: !!saved.asked,
  };
  const save = () => store.write({ level: PS.state ? PS.state.idx : prog.level, solved: prog.solved, sound: prog.sound, asked: prog.asked });

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function setSound(on) {
    prog.sound = on; PS.Sound.on = on;
    $('btn-sound').setAttribute('aria-label', on ? 'Mute sound' : 'Turn sound on');
    $('ico-sound').innerHTML = on
      ? '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6a8 8 0 0 1 0 12"/>'
      : '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 6 6M22 9l-6 6"/>';
    save();
  }

  // ---------- follow links ----------
  const NETWORKS = [['instagram', 'Instagram'], ['youtube', 'YouTube'], ['threads', 'Threads'], ['x', 'X']];
  function followLinks(container, placement) {
    container.innerHTML = '';
    const links = C.links || {};
    NETWORKS.forEach(([k, label]) => {
      if (!links[k]) return;
      const a = document.createElement('a');
      a.href = links[k]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label;
      a.addEventListener('click', () => A.track('follow_click', { network: k, placement }));
      container.appendChild(a);
    });
    container.hidden = !container.children.length;
  }

  // ---------- install intent: asked once, after the second picture ----------
  function askIntent(level) {
    if (prog.asked || level < 2) return false;
    prog.asked = true; save();
    $('intent-q').hidden = false; $('intent-thanks').hidden = true;
    $('intent').hidden = false;
    A.track('install_intent_shown', { level });
    return true;
  }
  document.querySelectorAll('[data-answer]').forEach((b) => {
    b.addEventListener('click', () => {
      A.track('install_intent', { answer: b.dataset.answer, level: PS.state ? PS.state.idx + 1 : 0 });
      $('intent-q').hidden = true; $('intent-thanks').hidden = false;
      followLinks($('intent-follow'), 'intent');
      $('intent-close').focus({ preventScroll: true });
    });
  });
  $('intent-close').onclick = () => { $('intent').hidden = true; $('btn-next').focus({ preventScroll: true }); };

  // ---------- sharing ----------
  async function share() {
    const url = location.origin + location.pathname + '?utm_source=share';
    const data = { title: 'Pixel Sort', text: 'Sort the colors, reveal the picture. Can you guess it before it’s done?', url };
    if (navigator.share) {
      try { await navigator.share(data); A.track('share_click', { method: 'native' }); } catch (e) { /* dismissed */ }
      return;
    }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); A.track('share_click', { method: 'copy' }); }
    catch (e) { toast(url); A.track('share_click', { method: 'shown' }); }
  }

  // ---------- state sync ----------
  function sync(evt) {
    const G = PS.state; if (!G) return;
    const won = G.winT < Infinity;
    $('btn-undo').disabled = PS.play.demoing || won || !G.history.length;
    $('btn-tube').disabled = PS.play.demoing || won || G.extra;
    $('btn-solve').disabled = PS.play.demoing || won;
    if (evt === 'stuck' && !won) $('stuck').hidden = false;
    if (evt === 'win') {
      const id = PS.levels[G.idx].id;
      if (!G.byDemo && !prog.solved.includes(id)) prog.solved.push(id);
      const last = G.idx === PS.levels.length - 1;
      $('btn-next').textContent = last ? 'Play again' : 'Next picture';
      $('hud-bottom').hidden = true; $('win').hidden = false;
      save();
      if (!G.byDemo && askIntent(G.idx + 1)) return;
      $('btn-next').focus({ preventScroll: true });
    }
    if (!won) { $('win').hidden = true; $('hud-bottom').hidden = false; }
  }

  function closePanels() { $('stuck').hidden = true; $('intent').hidden = true; }
  function goLevel(i, via) { closePanels(); PS.play.level(i, via); save(); }

  cv.addEventListener('pointerdown', (e) => {
    if (!$('album').hidden || !$('intent').hidden) return;
    const r = cv.getBoundingClientRect();
    $('stuck').hidden = true;
    PS.play.tapAt(((e.clientX - r.left) * 1080) / r.width, ((e.clientY - r.top) * 1920) / r.height);
  });
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') && (e.key === 'Enter' || e.key === ' ')) return;
    if (!$('album').hidden) { if (e.key === 'Escape') closeAlbum(); return; }
    if (!$('intent').hidden) { if (e.key === 'Escape') $('intent').hidden = true; return; }
    if (/^[1-9]$/.test(e.key)) { closePanels(); PS.play.tapTube(+e.key - 1); }
    else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { closePanels(); PS.play.undo(); }
    else if (e.key === 'r' || e.key === 'R') { closePanels(); PS.play.restart(); }
  });

  const boosterNote = 'Free here. In the real game: an ad or coins.';
  $('btn-undo').onclick = () => { closePanels(); PS.play.undo(); };
  $('btn-restart').onclick = () => { closePanels(); PS.play.restart(); };
  $('btn-tube').onclick = () => { closePanels(); if (PS.play.addTube()) toast(boosterNote); };
  $('btn-solve').onclick = () => { closePanels(); PS.play.demo(); toast('Watching the solution. Restart to play.'); };
  $('stuck-tube').onclick = () => { closePanels(); if (PS.play.addTube()) toast(boosterNote); };
  $('stuck-undo').onclick = () => { closePanels(); PS.play.undo(); };
  $('stuck-restart').onclick = () => { closePanels(); PS.play.restart(); };
  $('btn-next').onclick = () => { const G = PS.state; goLevel((G.idx + 1) % PS.levels.length, 'next'); };
  $('btn-share').onclick = share;
  $('btn-sound').onclick = () => { PS.Sound.ensure(); setSound(!prog.sound); };

  // ---------- album ----------
  function openAlbum() {
    const grid = $('album-grid'); grid.innerHTML = '';
    PS.levels.forEach((L, i) => {
      const done = prog.solved.includes(L.id);
      const btn = document.createElement('button');
      btn.className = 'pic' + (done ? ' done' : '');
      btn.setAttribute('aria-label', done ? `${L.name}, level ${i + 1}, play again` : `Level ${i + 1}, not solved yet`);
      if (done) btn.appendChild(PS.play.thumb(i));
      else { const u = document.createElement('div'); u.className = 'unknown'; u.textContent = '?'; btn.appendChild(u); }
      const cap = document.createElement('span');
      cap.textContent = done ? L.name.charAt(0) + L.name.slice(1).toLowerCase() : `Level ${i + 1}`;
      btn.appendChild(cap);
      btn.onclick = () => { closeAlbum(); goLevel(i, 'album'); };
      grid.appendChild(btn);
    });
    $('album-count').textContent = `${prog.solved.length} of ${PS.levels.length} pictures`;
    followLinks($('album-follow'), 'album');
    $('album').hidden = false;
    $('album-close').focus({ preventScroll: true });
    A.track('album_open', { solved: prog.solved.length });
  }
  function closeAlbum() { $('album').hidden = true; $('btn-album').focus({ preventScroll: true }); }
  $('btn-album').onclick = openAlbum;
  $('btn-album2').onclick = openAlbum;
  $('album-close').onclick = closeAlbum;

  // ---------- boot ----------
  (async function start() {
    PS.Sound.on = prog.sound;
    PS.play.onEvent = (name, props) => A.track(name, props);
    await PS.init(cv, { level: Math.min(prog.level, PS.levels.length - 1) });
    setSound(prog.sound);
    PS.play.onState = sync;
    sync();
    A.track('level_start', { level: PS.state.idx + 1, picture: PS.state.L.id, via: 'load', returning: prog.solved.length > 0 });
  })();
})();
