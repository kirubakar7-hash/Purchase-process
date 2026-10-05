/* =====================================================================
   CORE UTILITIES — clock, formatting, dates (SLA working days), ids,
   collections, downloads. No business logic here.
   ===================================================================== */
window.PCT = window.PCT || {};

/* ---------- Clock ----------
   Everything time-based (SLA, ageing, escalation) reads PCT.clock.now().
   - offsetDays : demo "time travel" (shared via state.meta.clockOffsetDays)
   - fixed      : used by the seeder to back-date generated history      */
PCT.clock = {
  offsetDays: 0,
  fixed: null,
  now() { return this.fixed != null ? this.fixed : Date.now() + this.offsetDays * 864e5; },
  set(t) { this.fixed = t; },
  release() { this.fixed = null; }
};

PCT.util = (function () {
  const DAY = 864e5;

  /* ---------- ids & strings ---------- */
  let seq = 0;
  const uid = (prefix) => (prefix ? prefix + '-' : '') + Date.now().toString(36).slice(-5) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n, w) => String(n).padStart(w, '0');
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const titleCase = s => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  /* ---------- object paths ---------- */
  function get(obj, path, dflt) {
    if (!path) return obj;
    const v = String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    return v === undefined ? dflt : v;
  }
  function set(obj, path, val) {
    const ks = String(path).split('.');
    let o = obj;
    ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    o[ks[ks.length - 1]] = val;
    return obj;
  }

  /* ---------- collections ---------- */
  const sum = (arr, fn) => (arr || []).reduce((a, x) => a + (Number(fn ? fn(x) : x) || 0), 0);
  const avg = (arr, fn) => arr && arr.length ? sum(arr, fn) / arr.length : 0;
  function groupBy(arr, fn) { const m = {}; (arr || []).forEach(x => { const k = typeof fn === 'function' ? fn(x) : x[fn]; (m[k] = m[k] || []).push(x); }); return m; }
  function sortBy(arr, fn, dir) { const d = dir === 'desc' ? -1 : 1; return (arr || []).slice().sort((a, b) => { const x = fn(a), y = fn(b); return x < y ? -d : x > y ? d : 0; }); }
  const uniq = arr => Array.from(new Set(arr || []));
  const byId = (arr, id) => (arr || []).find(x => x.id === id);

  /* ---------- dates ---------- */
  const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const endOfBusiness = t => { const d = new Date(t); d.setHours(18, 0, 0, 0); return d.getTime(); };
  const isWeekend = (t, weekend) => (weekend || [0, 6]).includes(new Date(t).getDay());

  /** Add n days; if working=true skip weekend days. Result is end of business day. */
  function addDays(t, n, working, weekend) {
    let d = startOfDay(t);
    n = Math.max(0, Math.ceil(Number(n) || 0));
    if (!working) return endOfBusiness(d + n * DAY + 2 * 36e5); // +2h guards DST edges
    let added = 0;
    while (added < n) { d = startOfDay(d + DAY + 2 * 36e5); if (!isWeekend(d, weekend)) added++; }
    while (isWeekend(d, weekend)) d = startOfDay(d + DAY + 2 * 36e5);
    return endOfBusiness(d);
  }
  /** Whole calendar days between two instants (b - a), by calendar date. */
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
  const ageDays = (t, now) => t ? Math.max(0, daysBetween(t, now || PCT.clock.now())) : 0;
  const toInputDate = t => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; };
  const fromInputDate = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };

  /* ---------- formatting ---------- */
  const inrF = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const numF = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const fmt = {
    inr: v => inrF.format(Math.round(Number(v) || 0)),
    /** Compact Indian notation: ₹2.5L, ₹1.2Cr, ₹45K */
    inrShort: v => {
      const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : '';
      if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')}Cr`;
      if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2).replace(/\.?0+$/, '')}L`;
      if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
      return `${s}₹${numF.format(a)}`;
    },
    num: v => numF.format(Number(v) || 0),
    pct: (v, d) => `${(Number(v) || 0).toFixed(d == null ? 0 : d)}%`,
    date: t => t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    dateShort: t => t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—',
    time: t => t ? new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—',
    dateTime: t => t ? `${new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, ${new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : '—',
    /** Relative due wording: Today / Tomorrow / In 3 days / 2 days overdue */
    due: t => {
      if (!t) return '—';
      const d = daysBetween(PCT.clock.now(), t);
      if (d === 0) return 'Today';
      if (d === 1) return 'Tomorrow';
      if (d === -1) return 'Yesterday';
      return d > 0 ? `In ${d} days` : `${-d} days ago`;
    },
    days: n => `${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`,
    ago: t => {
      if (!t) return '—';
      const m = Math.round((PCT.clock.now() - t) / 6e4);
      if (m < 1) return 'just now';
      if (m < 60) return `${m} min ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h} h ago`;
      return fmt.days(Math.round(h / 24)) + ' ago';
    }
  };

  /* ---------- downloads ---------- */
  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function toCSV(rows, columns) {
    const cols = columns || Object.keys(rows[0] || {}).map(k => ({ key: k, label: k }));
    const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.map(c => cell(c.label)).join(',')].concat(rows.map(r => cols.map(c => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))).join('\r\n');
  }

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  return { DAY, uid, esc, pad, clone, titleCase, get, set, sum, avg, groupBy, sortBy, uniq, byId,
    startOfDay, endOfBusiness, isWeekend, addDays, daysBetween, ageDays, toInputDate, fromInputDate,
    fmt, download, toCSV, debounce };
})();

PCT.esc = PCT.util.esc;
PCT.fmt = PCT.util.fmt;
