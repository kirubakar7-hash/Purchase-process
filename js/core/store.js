/* =====================================================================
   STORE — single source of truth shared by every open tab / window.
   - Persisted in localStorage (falls back to memory if blocked)
   - Cross-tab sync: BroadcastChannel + 'storage' event + light poll of a
     small version key (cheap) — so a presenter can open several roles in
     separate windows and watch the ball move live.
   - Session (who am I in THIS tab) lives in sessionStorage / ?as=U03.
   Production swap: replace load/save with REST + websocket; keep API.
   ===================================================================== */
window.PCT = window.PCT || {};

PCT.store = (function () {
  const KEY = 'pct.v2.state';
  const VKEY = 'pct.v2.version';
  const SCHEMA = 3;
  let cache = null;          // last state object seen by this tab
  let memoryOnly = false;
  const listeners = [];
  let channel = null;

  function storageVersion() {
    try { const v = localStorage.getItem(VKEY); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.meta && s.meta.schema === SCHEMA) return s; }
    } catch (e) { memoryOnly = true; }
    return null;
  }
  function save(s) {
    cache = s;
    if (memoryOnly) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
      localStorage.setItem(VKEY, JSON.stringify({ v: s.meta.version, run: s.meta.runId }));
    } catch (e) {
      memoryOnly = true;
      console.warn('Storage unavailable — running in memory only', e);
    }
    try { channel && channel.postMessage({ v: s.meta.version, run: s.meta.runId }); } catch (e) { /* ignore */ }
  }

  function fresh() {
    const s = PCT.seed.build();
    s.meta.schema = SCHEMA;
    return s;
  }

  /** Latest state (re-reads storage only if another tab changed it). */
  function get() {
    if (cache && !memoryOnly) {
      const v = storageVersion();
      if (v && (v.v !== cache.meta.version || v.run !== cache.meta.runId)) cache = load() || cache;
    }
    if (!cache) { cache = load(); if (!cache) { cache = fresh(); save(cache); } }
    PCT.clock.offsetDays = cache.meta.clockOffsetDays || 0;
    return cache;
  }

  function emit() { listeners.forEach(fn => { try { fn(cache); } catch (e) { console.error(e); } }); }

  /**
   * Atomic change: read latest → mutate → save → broadcast → re-render.
   * The mutator may return a result object; returning {ok:false} aborts the save.
   */
  function commit(mutator) {
    const s = get();
    const snapshot = JSON.stringify(s);
    let result;
    try { result = mutator(s); } catch (e) { cache = JSON.parse(snapshot); console.error(e); return { ok: false, error: 'Unexpected error: ' + e.message }; }
    if (result && result.ok === false) { cache = JSON.parse(snapshot); return result; }
    s.meta.version = (s.meta.version || 0) + 1;
    s.meta.updatedAt = Date.now();
    save(s);
    emit();
    return result === undefined ? { ok: true } : result;
  }

  function replace(newState) {
    const prev = cache;
    newState.meta.schema = SCHEMA;
    newState.meta.version = ((prev && prev.meta.version) || 0) + 1;
    save(newState);
    PCT.clock.offsetDays = newState.meta.clockOffsetDays || 0;
    emit();
  }

  function reset() { replace(fresh()); }

  function check() {
    if (memoryOnly || !cache) return;
    const v = storageVersion();
    if (v && (v.v !== cache.meta.version || v.run !== cache.meta.runId)) { get(); emit(); }
  }

  function subscribe(fn) { listeners.push(fn); }

  function init() {
    try { channel = new BroadcastChannel('pct-v2'); channel.onmessage = check; } catch (e) { channel = null; }
    window.addEventListener('storage', e => { if (e.key === VKEY) check(); });
    setInterval(check, 1200);
    return get();
  }

  /* ---------- per-tab session: who is using this window ---------- */
  const session = {
    userId() {
      const q = new URLSearchParams(location.search).get('as');
      if (q) { try { sessionStorage.setItem('pct.user', q); } catch (e) { /* ignore */ } return q; }
      try { return sessionStorage.getItem('pct.user'); } catch (e) { return session._mem || null; }
    },
    setUser(id) { try { sessionStorage.setItem('pct.user', id); } catch (e) { session._mem = id; } },
    clear() { try { sessionStorage.removeItem('pct.user'); } catch (e) { session._mem = null; } }
  };

  function isMemoryOnly() { return memoryOnly; }

  return { init, get, commit, replace, reset, subscribe, session, isMemoryOnly, KEY };
})();
