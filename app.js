(() => {
  'use strict';

  // ---------------------------------------------------------------- settings
  const POLL_MS = 5000;
  const LRCLIB = 'https://lrclib.net/api';
  const DEFAULTS = { user: '', key: '', manual: false, show: 'both', tones: 'marks', size: 24, delay: 3, wake: false };

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: keep in memory only */ } },
  };
  const S = Object.assign({}, DEFAULTS, store.get('settings', {}));
  const saveSettings = () => store.set('settings', S);
  const picks = store.get('picks', {}); // trackKey -> LRCLIB id the user chose by hand

  // ---------------------------------------------------------------- elements
  const $ = id => document.getElementById(id);
  const el = {
    title: $('title'), status: $('status'), dot: $('dot'), lyrics: $('lyrics'), banner: $('syncBanner'),
    controls: $('controls'), clock: $('clock'),
    dlgSetup: $('dlgSetup'), dlgSearch: $('dlgSearch'), dlgSettings: $('dlgSettings'),
  };

  // ---------------------------------------------------------------- state
  let track = null;        // { key, artist, title, album }
  let lyr = null;          // { id, synced, lines: [{ t, text, roma }], song, meta }
  let unsynced = true;     // true until we know where in the song we are
  let clock = { base: 0, at: Date.now(), running: false };
  let curIdx = -1;
  let userScrollAt = 0;
  let lastPollAt = 0;      // time of the last successful Last.fm check
  let pollTimer = null;
  let loadSeq = 0;         // guards against out-of-order lyric loads
  let candidates = [];     // LRCLIB results for the current track
  const lyricCache = new Map();

  const now = () => Date.now();
  const pos = () => clock.base + (clock.running ? (now() - clock.at) / 1000 : 0);
  function setPos(p, running = clock.running) { clock = { base: Math.max(0, p), at: now(), running }; updateClockUI(); }

  // ---------------------------------------------------------------- helpers
  function h(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  const norm = s => (s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const trackKey = (artist, title) => norm(artist) + '|' + norm(title);
  const fmt = sec => { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.dot.className = 'dot' + (kind ? ' ' + kind : '');
  }

  async function getJSON(url, ms = 12000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (r.status === 404) return null;
      const body = await r.json().catch(() => null);
      if (!r.ok && !body) throw new Error('HTTP ' + r.status);
      return body;
    } finally { clearTimeout(t); }
  }

  // Last.fm normally allows cross-site fetch; JSONP is a fallback in case it doesn't.
  let lfmMode = 'fetch';
  function jsonp(url, ms = 12000) {
    return new Promise((resolve, reject) => {
      const cb = '__lfm' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const done = () => { delete window[cb]; s.remove(); clearTimeout(t); };
      const t = setTimeout(() => { done(); reject(new Error('timeout')); }, ms);
      window[cb] = data => { done(); resolve(data); };
      s.onerror = () => { done(); reject(new Error('network')); };
      s.src = url + '&callback=' + cb;
      document.head.appendChild(s);
    });
  }

  async function lastfmNowPlaying(user, key) {
    const url = 'https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&format=json&limit=1'
      + '&user=' + encodeURIComponent(user) + '&api_key=' + encodeURIComponent(key);
    let data;
    if (lfmMode === 'fetch') {
      try { data = await getJSON(url); }
      catch (e) {
        if (e.name === 'AbortError') throw e;
        data = await jsonp(url); lfmMode = 'jsonp';
      }
    } else data = await jsonp(url);
    if (!data) throw new Error('No response from Last.fm');
    if (data.error) {
      const msg = {
        6: 'Last.fm user not found. Check the username.',
        10: 'Last.fm says the API key is invalid.',
        17: 'Your Last.fm listening history is private. Turn off "Hide recent listening" in Last.fm privacy settings.',
        26: 'This API key was suspended by Last.fm.',
        8: 'Last.fm had a hiccup. Retrying… (new accounts can take a few minutes, or until your first scrobble)',
        11: 'Last.fm is temporarily offline. Retrying…',
        16: 'Last.fm had a temporary error. Retrying…',
        29: 'Too many requests to Last.fm. Slowing down.',
      }[data.error] || ('Last.fm error: ' + (data.message || data.error));
      const err = new Error(msg); err.lfm = data.error; throw err;
    }
    let list = data.recenttracks && data.recenttracks.track;
    if (!list) return null;
    if (!Array.isArray(list)) list = [list];
    const t = list.find(x => x['@attr'] && x['@attr'].nowplaying === 'true');
    if (!t) return null;
    const artist = (t.artist && (t.artist['#text'] || t.artist.name)) || '';
    const title = t.name || '';
    const album = (t.album && t.album['#text']) || '';
    return { key: trackKey(artist, title), artist, title, album };
  }

  // ---------------------------------------------------------------- polling
  function schedulePoll(ms = POLL_MS) {
    clearTimeout(pollTimer);
    if (S.manual || !S.user || !S.key) return;
    pollTimer = setTimeout(poll, ms);
  }

  async function poll() {
    if (S.manual || !S.user || !S.key) return;
    if (document.visibilityState === 'hidden') return; // resumes on visibilitychange
    const before = lastPollAt;
    try {
      const np = await lastfmNowPlaying(S.user, S.key);
      const at = now();
      lastPollAt = at;
      if (!np) {
        setStatus(track ? 'Nothing playing right now' : 'Play something on Spotify', '');
        if (!track) renderEmpty('waiting');
      } else if (!track || np.key !== track.key) {
        // A new song. If we were checking regularly, we know roughly when it began.
        const sawStart = before && (at - before) <= POLL_MS * 2 + 3000;
        const startedAt = sawStart ? (before + at) / 2 - S.delay * 1000 : null;
        onNewTrack(np, startedAt);
        setStatus('Playing · via Last.fm', 'live');
      } else {
        setStatus('Playing · via Last.fm', 'live');
      }
      schedulePoll();
    } catch (e) {
      setStatus(e.message || 'Could not reach Last.fm', 'warn');
      schedulePoll(e.lfm === 29 ? 30000 : POLL_MS * 2);
    }
  }

  function onNewTrack(t, startedAt) {
    track = t;
    el.title.textContent = t.title + (t.artist ? ' — ' + t.artist : '');
    document.title = t.title;
    if (startedAt) { unsynced = false; setPos((now() - startedAt) / 1000, true); }
    else { unsynced = true; setPos(0, false); }
    loadLyricsFor(t);
  }

  // ---------------------------------------------------------------- lyrics lookup
  const lrclibSearch = params => getJSON(LRCLIB + '/search?' + new URLSearchParams(params)).then(r => Array.isArray(r) ? r : []);
  const lrclibGet = id => getJSON(LRCLIB + '/get/' + encodeURIComponent(id));

  function cleanTitle(t) {
    return t
      .replace(/\s*[(\[（【][^)\]）】]*(feat|ft\.|with |remaster|prod\.|from |op |ed |theme|version|ver\.)[^)\]）】]*[)\]）】]/gi, '')
      .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '')
      .trim() || t;
  }

  function score(c, t) {
    let s = 0;
    if (c.instrumental) s -= 100;
    if (c.syncedLyrics) s += 50; else if (c.plainLyrics) s += 10; else s -= 100;
    const ct = norm(c.trackName), tt = norm(t.title), ctt = norm(cleanTitle(t.title));
    if (ct === tt || ct === ctt) s += 30; else if (ct && (tt.includes(ct) || ct.includes(ctt))) s += 15;
    const ca = norm(c.artistName), ta = norm(t.artist);
    if (ca && ta && (ca.includes(ta) || ta.includes(ca))) s += 30;
    if (t.album && norm(c.albumName) === norm(t.album)) s += 10;
    return s;
  }

  async function findCandidates(t) {
    const seen = new Map();
    const add = list => list.forEach(c => { if (!seen.has(c.id)) seen.set(c.id, c); });
    const best = () => Math.max(-1e9, ...[...seen.values()].map(c => score(c, t)));
    add(await lrclibSearch({ track_name: t.title, artist_name: t.artist }));
    if (best() < 100) add(await lrclibSearch({ q: cleanTitle(t.title) + ' ' + t.artist }));
    if (best() < 80) add(await lrclibSearch({ track_name: cleanTitle(t.title) }));
    return [...seen.values()].sort((a, b) => score(b, t) - score(a, t));
  }

  async function loadLyricsFor(t) {
    const seq = ++loadSeq;
    lyr = null; curIdx = -1; candidates = [];
    renderEmpty('loading');
    try {
      let rec = lyricCache.get(t.key);
      if (!rec && picks[t.key]) rec = await lrclibGet(picks[t.key]);
      if (!rec) {
        candidates = await findCandidates(t);
        if (seq !== loadSeq) return;
        const top = candidates[0];
        if (top && score(top, t) >= 40 && (top.syncedLyrics || top.plainLyrics)) rec = top;
      }
      if (seq !== loadSeq) return;
      if (!rec) { renderEmpty('none'); return; }
      lyricCache.set(t.key, rec);
      applyLyrics(rec);
    } catch (e) {
      if (seq !== loadSeq) return;
      renderEmpty('error', e.message);
    }
  }

  // ---------------------------------------------------------------- lyrics display
  function parseLRC(text) {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
      if (!stamps.length) continue;
      const words = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
      for (const m of stamps) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text: words });
    }
    out.sort((a, b) => a.t - b.t);
    // drop repeated empty lines
    return out.filter((l, i) => l.text || !(out[i - 1] && !out[i - 1].text));
  }

  function applyLyrics(rec) {
    const synced = !!rec.syncedLyrics;
    const lines = synced
      ? parseLRC(rec.syncedLyrics)
      : (rec.plainLyrics || '').split(/\r?\n/).map(text => ({ t: null, text: text.trim() }));
    const song = Romanizer.detectSong(lines.map(l => l.text));
    lyr = { id: rec.id, synced, lines, song, meta: rec };
    curIdx = -1;
    romanizeAll();
    render();
    if (song.ja && !Romanizer.japaneseReady()) {
      setStatus('Loading Japanese dictionary (first time only)…', '');
      Romanizer.loadJapanese()
        .then(() => { if (lyr && lyr.id === rec.id) { romanizeAll(); render(); } setStatus(track && !S.manual ? 'Playing · via Last.fm' : 'Ready', track && !S.manual ? 'live' : ''); })
        .catch(() => setStatus('Japanese dictionary failed to load. Check your connection.', 'warn'));
    }
  }

  function romanizeAll() {
    if (!lyr) return;
    for (const l of lyr.lines) l.roma = Romanizer.romanizeLine(l.text, lyr.song, { tones: S.tones });
  }

  function render() {
    const box = el.lyrics;
    box.replaceChildren();
    box.className = 'lyrics show-' + S.show + (lyr && (!lyr.synced || unsynced) ? ' unsynced' : '');
    if (!lyr) return;
    const frag = document.createDocumentFragment();
    lyr.lines.forEach((l, i) => {
      const b = h('button', 'ln' + (l.text ? '' : ' gap'));
      b.type = 'button';
      b.dataset.i = i;
      if (!l.text) {
        b.append(h('span', 'r', '♪'));
      } else if (l.roma === null) {
        b.append(h('span', 'r', '…'), h('span', 'o', l.text));
      } else if (l.roma) {
        b.append(h('span', 'r', l.roma), h('span', 'o', l.text));
      } else {
        b.append(h('span', 'r', l.text));           // nothing to romanize (e.g. English line)
        if (S.show === 'orig') b.append(h('span', 'o', l.text));
      }
      frag.append(b);
    });
    if (!lyr.synced) box.append(h('p', 'note', 'These lyrics aren\'t time-synced on LRCLIB, so they won\'t scroll by themselves.'));
    box.append(frag);
    el.controls.hidden = !lyr.synced;
    updateBanner();
    tick(true);
  }

  function renderEmpty(kind, detail) {
    lyr = null;
    el.banner.hidden = true;
    el.controls.hidden = true;
    const box = el.lyrics;
    box.className = 'lyrics';
    const d = h('div', 'empty');
    const add = (tag, text, cls) => d.append(h(tag, cls, text));
    if (kind === 'loading') {
      const p = h('p'); p.append(h('span', 'spinner'), document.createTextNode('Finding lyrics…')); d.append(p);
    } else if (kind === 'waiting') {
      add('h3', 'Play a song on Spotify');
      add('p', 'Lyrics appear here a few seconds after a song starts. Keep this app open while you listen.');
    } else if (kind === 'manual') {
      add('h3', 'Search for a song');
      add('p', 'Pick the song you\'re playing, then tap the line that\'s being sung to start the lyrics in time.');
      const b = h('button', 'primary', 'Search lyrics'); b.type = 'button'; b.onclick = () => openSearch(); d.append(b);
    } else if (kind === 'none' || kind === 'error') {
      add('h3', kind === 'none' ? 'No lyrics found' : 'Couldn\'t load lyrics');
      add('p', kind === 'none'
        ? 'LRCLIB doesn\'t seem to have this song under this name. Try searching with a different spelling, the original-language title, or the artist\'s native name.'
        : (detail || 'Check your connection and try again.'));
      const b = h('button', 'primary', 'Search manually'); b.type = 'button'; b.onclick = () => openSearch(); d.append(b);
    }
    box.replaceChildren(d);
  }

  function updateBanner() {
    el.banner.hidden = !(lyr && lyr.synced && unsynced);
    document.body.classList.toggle('paused', !clock.running);
  }

  function updateClockUI() {
    el.clock.textContent = fmt(pos());
    document.body.classList.toggle('paused', !clock.running);
  }

  function indexAt(p) {
    const L = lyr.lines; let lo = 0, hi = L.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (L[m].t <= p) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  function tick(force) {
    updateClockUI();
    if (!lyr || !lyr.synced || unsynced) return;
    const i = indexAt(pos());
    if (i === curIdx && !force) return;
    const nodes = el.lyrics.children;
    if (nodes[curIdx]) nodes[curIdx].classList.remove('cur');
    for (let k = 0; k < nodes.length; k++) nodes[k].classList.toggle('past', k < i);
    curIdx = i;
    const node = nodes[i];
    if (node) {
      node.classList.add('cur');
      if (now() - userScrollAt > 3500) {
        const top = node.offsetTop - el.lyrics.clientHeight * 0.36;
        el.lyrics.scrollTo({ top, behavior: force ? 'auto' : 'smooth' });
      }
    }
  }
  setInterval(tick, 200);

  // ---------------------------------------------------------------- interactions
  el.lyrics.addEventListener('click', e => {
    const b = e.target.closest('.ln');
    if (!b || !lyr || !lyr.synced) return;
    const l = lyr.lines[+b.dataset.i];
    unsynced = false;
    setPos(l.t + 0.05, true);
    userScrollAt = 0;
    el.lyrics.classList.remove('unsynced');
    updateBanner();
    tick(true);
    requestWake();
  });
  for (const ev of ['touchstart', 'wheel', 'pointerdown']) el.lyrics.addEventListener(ev, () => { userScrollAt = now(); }, { passive: true });

  $('btnPlay').onclick = () => {
    if (unsynced) { unsynced = false; el.lyrics.classList.remove('unsynced'); setPos(pos(), true); }
    else setPos(pos(), !clock.running);
    updateBanner(); tick(true); requestWake();
  };
  // −0.5s: lyrics were ahead of the singer, so move them back. +0.5s: move them forward.
  $('btnBack').onclick = () => { setPos(pos() - 0.5); tick(true); };
  $('btnFwd').onclick = () => { setPos(pos() + 0.5); tick(true); };
  $('btnWrong').onclick = () => openSearch(true);
  $('btnSearch').onclick = () => openSearch();
  $('btnSettings').onclick = openSettings;
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  // tap on the dimmed backdrop closes sheets
  for (const d of [el.dlgSearch, el.dlgSettings]) d.addEventListener('click', e => { if (e.target === d) d.close(); });

  // ---------------------------------------------------------------- search sheet
  function resultItem(c, onPick) {
    const li = h('li');
    const b = h('button'); b.type = 'button';
    if (lyr && lyr.id === c.id) b.classList.add('picked');
    b.append(h('span', 't', c.trackName || '(untitled)'), h('span', 'a', [c.artistName, c.albumName].filter(Boolean).join(' · ')));
    const m = h('span', 'm');
    m.append(h('span', 'tag' + (c.syncedLyrics ? ' good' : ''), c.syncedLyrics ? 'Synced' : c.instrumental ? 'Instrumental' : 'Not synced'));
    if (c.duration) m.append(h('span', null, fmt(c.duration)));
    const first = ((c.plainLyrics || c.syncedLyrics || '').replace(/\[[^\]]*\]/g, '').split('\n').find(x => x.trim()) || '').trim();
    if (first) m.append(h('span', null, first.slice(0, 40)));
    b.append(m);
    b.onclick = () => onPick(c);
    li.append(b);
    return li;
  }

  function showResults(list, note) {
    const ul = $('results');
    ul.replaceChildren(...list.filter(c => !c.instrumental).map(c => resultItem(c, pickResult)));
    $('searchNote').textContent = note || (list.length ? '' : 'No results. Try the title in its original language, or fewer words.');
  }

  function pickResult(c) {
    el.dlgSearch.close();
    if (S.manual || !track) {
      // manual mode: this becomes the current song; user taps a line (or play) to start
      track = { key: trackKey(c.artistName, c.trackName), artist: c.artistName, title: c.trackName, album: c.albumName };
      el.title.textContent = c.trackName + ' — ' + c.artistName;
      unsynced = true; setPos(0, false);
    } else {
      picks[track.key] = c.id; store.set('picks', picks);
    }
    lyricCache.set(track.key, c);
    loadSeq++;
    applyLyrics(c);
  }

  function openSearch(fromWrong) {
    const q = $('inQuery');
    $('searchTitle').textContent = fromWrong && track ? 'Pick the right lyrics' : 'Find lyrics';
    if (track) q.value = cleanTitle(track.title) + ' ' + track.artist;
    if (fromWrong && candidates.length) showResults(candidates, 'Best matches for what\'s playing. Tap one to use it; it\'ll be remembered for this song.');
    else { $('results').replaceChildren(); $('searchNote').textContent = ''; }
    el.dlgSearch.showModal();
    if (!(fromWrong && candidates.length) && track) runSearch();
  }

  async function runSearch() {
    const q = $('inQuery').value.trim();
    if (!q) return;
    $('searchNote').textContent = 'Searching…';
    try { showResults(await lrclibSearch({ q })); }
    catch { $('searchNote').textContent = 'Search failed. Check your connection.'; }
  }
  $('formSearch').addEventListener('submit', e => { e.preventDefault(); $('inQuery').blur(); runSearch(); });

  // ---------------------------------------------------------------- setup sheet
  function openSetup() {
    $('inUser').value = S.user; $('inKey').value = S.key;
    $('setupErr').hidden = true;
    el.dlgSetup.showModal();
  }
  $('formSetup').addEventListener('submit', async e => {
    e.preventDefault();
    const user = $('inUser').value.trim(), key = $('inKey').value.trim();
    const err = $('setupErr'), btn = $('btnSaveSetup');
    if (!user || !/^[0-9a-f]{32}$/i.test(key)) { err.textContent = 'Enter your username and the 32-character API key.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Checking…'; err.hidden = true;
    const start = () => {
      Object.assign(S, { user, key, manual: false }); saveSettings();
      el.dlgSetup.close();
      track = null; lastPollAt = 0;
      renderEmpty('waiting'); setStatus('Connecting…', '');
      poll();
    };
    try {
      await lastfmNowPlaying(user, key);
      start();
    } catch (ex) {
      // Only a wrong username/key or a private profile stops setup. Temporary Last.fm
      // failures (e.g. error 8 on brand-new accounts) are retried by the normal polling.
      if ([6, 10, 17, 26].includes(ex.lfm)) { err.textContent = ex.message; err.hidden = false; }
      else start();
    } finally { btn.disabled = false; btn.textContent = 'Connect'; }
  });
  $('btnManual').onclick = () => {
    S.manual = true; saveSettings(); el.dlgSetup.close(); clearTimeout(pollTimer);
    setStatus('Manual mode', ''); renderEmpty('manual'); openSearch();
  };

  // ---------------------------------------------------------------- settings sheet
  function openSettings() {
    document.querySelector(`input[name=show][value=${S.show}]`).checked = true;
    document.querySelector(`input[name=tones][value=${S.tones}]`).checked = true;
    $('inSize').value = S.size; $('inDelay').value = S.delay; $('delayVal').textContent = S.delay + 's';
    $('inWake').checked = S.wake;
    $('acctLine').textContent = S.manual || !S.user ? 'Not connected (manual mode).' : 'Connected as ' + S.user + '.';
    el.dlgSettings.showModal();
  }
  document.querySelectorAll('input[name=show]').forEach(r => r.onchange = () => { S.show = r.value; saveSettings(); render(); });
  document.querySelectorAll('input[name=tones]').forEach(r => r.onchange = () => { S.tones = r.value; saveSettings(); romanizeAll(); render(); });
  $('inSize').oninput = e => { S.size = +e.target.value; applySize(); saveSettings(); };
  $('inDelay').oninput = e => { S.delay = +e.target.value; $('delayVal').textContent = S.delay + 's'; saveSettings(); };
  $('inWake').onchange = e => { S.wake = e.target.checked; saveSettings(); S.wake ? requestWake() : releaseWake(); };
  $('btnEditAcct').onclick = () => { el.dlgSettings.close(); openSetup(); };
  const applySize = () => document.documentElement.style.setProperty('--size', S.size + 'px');

  // ---------------------------------------------------------------- screen wake lock
  let wakeLock = null;
  async function requestWake() {
    if (!S.wake || wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    catch { /* not allowed right now */ }
  }
  function releaseWake() { if (wakeLock) wakeLock.release().catch(() => {}); wakeLock = null; }

  // ---------------------------------------------------------------- lifecycle
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(true); poll(); requestWake(); }
    else clearTimeout(pollTimer);
  });
  document.addEventListener('pointerdown', requestWake, { once: true });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  applySize();
  updateClockUI();
  if (S.manual) { setStatus('Manual mode', ''); renderEmpty('manual'); }
  else if (!S.user || !S.key) { setStatus('Not connected', ''); renderEmpty('waiting'); openSetup(); }
  else { setStatus('Connecting…', ''); renderEmpty('waiting'); poll(); }

  // exposed for debugging in the console
  window.__lyrics = { get state() { return { track, lyr, clock, unsynced, S }; } };
})();
