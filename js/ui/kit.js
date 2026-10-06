/* =====================================================================
   UI KIT — pure functions that return HTML strings, plus modal / toast.
   Every page builds its screen from these so the app looks like one
   product. Escape all user text with esc().
   ===================================================================== */
window.PCT = window.PCT || {};

PCT.ui = (function () {
  const U = PCT.util;
  const esc = U.esc;
  const I = (n, s, c) => PCT.icon(n, s, c);
  const E = () => PCT.engine;
  const S = () => PCT.sel;

  /* ---------------- atoms ---------------- */
  const badge = (text, tone, opts) => `<span class="badge tone-${tone || 'grey'}${opts && opts.solid ? ' solid' : ''}"${opts && opts.title ? ` title="${esc(opts.title)}"` : ''}>${opts && opts.dot === false ? '' : '<i class="bdot"></i>'}${esc(text)}</span>`;
  /** Badge coloured by the Status Master: status(state, 'activity', 'Overdue') */
  const status = (state, kind, name) => badge(name, S().statusTone(state, kind, name));
  const actStatus = (state, a) => status(state, 'activity', E().displayStatus(state, a));
  const money = v => `<span class="nowrap">${U.fmt.inr(v)}</span>`;
  const moneyShort = v => `<span class="nowrap" title="${U.fmt.inr(v)}">${U.fmt.inrShort(v)}</span>`;
  const tag = t => `<span class="tag">${esc(t)}</span>`;
  const dot = tone => `<i class="dot-ind tone-${tone}"></i>`;

  const AV_COLORS = ['#1E4180', '#12805C', '#6D28D9', '#B45309', '#0E7490', '#BE185D', '#4D7C0F', '#9F1239', '#1D4ED8', '#7C2D12'];
  function avatar(name, size) {
    const n = String(name || '?');
    const ini = n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return `<span class="avatar ${size || ''}" style="background:${AV_COLORS[h % AV_COLORS.length]}">${esc(ini)}</span>`;
  }
  /** Person chip: avatar + name (+ role/title) */
  function person(state, userId, opts) {
    opts = opts || {};
    const u = E().user(state, userId);
    if (!u) return '<span class="muted">—</span>';
    const r = E().role(state, u.roleId) || {};
    return `<span class="person">${avatar(u.name, opts.size || 'sm')}<span class="ellipsis"><span class="nm">${esc(u.name)}</span>${opts.sub !== false ? `<small>${esc(opts.subText || u.title || r.name || '')}</small>` : ''}</span></span>`;
  }

  function priority(state, pid) {
    const p = U.byId(state.masters.priorities, pid) || { name: pid, tone: 'grey' };
    return badge(p.name, p.tone);
  }

  /** Due wording with colour: Today / Tomorrow / 3 days overdue */
  function due(t, opts) {
    if (!t) return '<span class="muted">—</span>';
    const d = U.daysBetween(PCT.clock.now(), t);
    const over = PCT.clock.now() > t;
    const tone = over ? 'red' : d === 0 ? 'orange' : d === 1 ? 'yellow' : 'grey';
    const label = over ? (d === 0 ? 'Overdue today' : `${-d} ${-d === 1 ? 'day' : 'days'} overdue`) : U.fmt.due(t);
    return `<span class="nowrap" title="${U.fmt.dateTime(t)}" style="color:var(--${tone === 'grey' ? 'ink-2' : tone === 'yellow' ? 'yellow' : tone})${over ? ';font-weight:650' : ''}">${esc(label)}</span>${opts && opts.date ? `<span class="sub">${U.fmt.date(t)}</span>` : ''}`;
  }

  const ageing = days => `<span class="nowrap">${U.fmt.days(days || 0)}</span>`;

  /* ---------------- layout ---------------- */
  function pageHead(o) {
    return `<div class="page-head">
      <div class="grow">
        ${o.crumbs ? `<div class="crumbs">${o.crumbs.map(c => c.href ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`).join(I('chevronRight', 12))}</div>` : ''}
        <h1>${o.icon ? I(o.icon, 22) : ''}${esc(o.title)}${o.badge || ''}</h1>
        ${o.sub ? `<div class="sub">${o.sub}</div>` : ''}
      </div>
      ${o.actions ? `<div class="page-actions">${o.actions}</div>` : ''}
    </div>`;
  }

  function card(o) {
    const head = o.title || o.actions ? `<div class="card-head ${o.plainHead ? 'plain' : ''}"><div class="grow"><div class="card-title">${o.icon ? I(o.icon, 16) : ''}${o.title || ''}</div>${o.sub ? `<div class="card-sub">${o.sub}</div>` : ''}</div>${o.actions ? `<div class="row wrap">${o.actions}</div>` : ''}</div>` : '';
    return `<section class="card ${o.cls || ''}"${o.id ? ` id="${o.id}"` : ''}>${head}<div class="card-body ${o.flush ? 'flush' : ''}">${o.body || ''}</div>${o.foot ? `<div class="card-foot">${o.foot}</div>` : ''}</section>`;
  }

  function kpi(o) {
    const tag = o.href ? 'a' : 'div';
    return `<${tag} class="kpi tone-${o.tone || 'none'}"${o.href ? ` href="${o.href}"` : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>
      <div class="label">${o.icon ? I(o.icon, 14) : ''}${esc(o.label)}</div>
      <div class="value ${o.money ? 'money' : ''}">${o.value}</div>
      ${o.sub ? `<div class="sub">${o.sub}</div>` : ''}
    </${tag}>`;
  }

  function empty(icon, title, text, action) {
    return `<div class="empty">${I(icon || 'inbox', 32)}<h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action || ''}</div>`;
  }

  function alert(tone, html, icon) {
    const ic = icon || { info: 'info', warn: 'alert', danger: 'alert', success: 'checkCircle' }[tone] || 'info';
    return `<div class="alert alert-${tone}">${I(ic, 16)}<div class="grow">${html}</div></div>`;
  }

  function progress(pct, tone) { return `<div class="progress tone-${tone || 'blue'}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>`; }

  /** Horizontal bars: items [{label, value, display, tone, href}] */
  function hbars(items, opts) {
    const max = Math.max(1, ...items.map(i => Number(i.value) || 0));
    return `<div class="hbars">${items.map(i => `<div class="hbar tone-${i.tone || (opts && opts.tone) || 'navy'}">
      <div class="ellipsis" title="${esc(i.label)}">${i.href ? `<a href="${i.href}">${esc(i.label)}</a>` : esc(i.label)}</div>
      <div class="track"><i style="width:${Math.max(2, (Number(i.value) || 0) / max * 100)}%"></i></div>
      <div class="num">${i.display != null ? i.display : esc(i.value)}</div>
    </div>`).join('')}</div>`;
  }

  /**
   * Tabs. ctx.ui[key] holds the active tab; clicking dispatches global action 'tab'.
   * tabs: [{id, label, count, icon}]
   */
  function tabs(key, list, active) {
    return `<div class="tabs" role="tablist">${list.map(t => `<button class="tab ${t.id === active ? 'active' : ''}" data-act="tab" data-key="${esc(key)}" data-tab="${esc(t.id)}" role="tab">${t.icon ? I(t.icon, 14) : ''}${esc(t.label)}${t.count != null ? `<span class="count">${t.count}</span>` : ''}</button>`).join('')}</div>`;
  }
  /** Segmented control, same mechanics as tabs */
  function seg(key, list, active) {
    return `<div class="seg">${list.map(t => `<button class="${t.id === active ? 'active' : ''}" data-act="tab" data-key="${esc(key)}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('')}</div>`;
  }

  /**
   * Table.
   * columns: [{ key, label, align:'right'|'center', render:(row)=>html, sort:(row)=>value|true, width, cls }]
   * opts: { rows, key (ui-state key for sorting), sort:{key,dir}, rowHref:(row)=>'#/..', rowClass:(row)=>'row-red',
   *         empty:'text', dense, foot: html, limit }
   * Sorting: header click dispatches global action 'sort' with data-key/data-col; ctx.ui[key+'Sort'] = {col, dir}.
   */
  function table(columns, rows, opts) {
    opts = opts || {};
    const sortState = opts.sort || null;
    let data = rows.slice();
    if (sortState && sortState.col) {
      const col = columns.find(c => c.key === sortState.col);
      if (col) {
        const fn = typeof col.sort === 'function' ? col.sort : (r => r[col.key]);
        data = U.sortBy(data, r => { const v = fn(r); return v == null ? (sortState.dir === 'desc' ? -Infinity : Infinity) : (typeof v === 'string' ? v.toLowerCase() : v); }, sortState.dir);
      }
    }
    const total = data.length;
    if (opts.limit && data.length > opts.limit) data = data.slice(0, opts.limit);
    const th = columns.map(c => {
      const sortable = c.sort !== false && opts.key;
      const sorted = sortState && sortState.col === c.key;
      const arrow = sorted ? (sortState.dir === 'desc' ? '↓' : '↑') : '↕';
      return `<th class="${sortable ? 'sortable' : ''} ${sorted ? 'sorted' : ''} ${c.align === 'right' ? 'num' : ''} ${c.cls || ''} ${c.hideOnMobile ? 'hide-m' : ''}" ${c.width ? `style="width:${c.width}"` : ''} ${sortable ? `data-act="sort" data-key="${esc(opts.key)}" data-col="${esc(c.key)}"` : ''}>${esc(c.label)}${sortable ? `<span class="sort">${arrow}</span>` : ''}</th>`;
    }).join('');
    const body = data.length ? data.map(r => {
      const href = opts.rowHref ? opts.rowHref(r) : null;
      return `<tr class="${href ? 'clickable' : ''} ${opts.rowClass ? opts.rowClass(r) || '' : ''}" ${href ? `data-href="${esc(href)}"` : ''}>${columns.map(c => `<td class="${c.align === 'right' ? 'num' : ''} ${c.cls || ''} ${c.hideOnMobile ? 'hide-m' : ''}" ${c.align === 'center' ? 'style="text-align:center"' : ''}>${c.render ? c.render(r) : esc(r[c.key] == null ? '' : r[c.key])}</td>`).join('')}</tr>`;
    }).join('') : `<tr><td colspan="${columns.length}"><div class="table-empty">${esc(opts.empty || 'No records')}</div></td></tr>`;
    return `<div class="table-wrap"><table class="tbl ${opts.dense ? 'dense' : ''}"><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${opts.foot ? `<tfoot>${opts.foot}</tfoot>` : ''}</table></div>${opts.limit && total > opts.limit ? `<div class="pager"><span>Showing ${opts.limit} of ${total}</span>${opts.moreHref ? `<a href="${opts.moreHref}">View all ${I('arrowRight', 12)}</a>` : ''}</div>` : ''}`;
  }

  /* ---------------- form fields ----------------
     field({ name, label, type, value, options:[{value,label}]|[string], required, hint, placeholder,
             min, max, step, rows, readonly, full, prefix, disabled, multiple })
     types: text | number | money | date | select | textarea | checkbox | email | file | hidden
     Dates are rendered as <input type=date data-type="date"> and read back as ms by formValues().  */
  function field(o) {
    const id = o.id || ('f_' + (o.name || '').replace(/[^a-z0-9_]/gi, '_') + '_' + Math.random().toString(36).slice(2, 6));
    const req = o.required ? '<span class="req">*</span>' : '';
    const common = `name="${esc(o.name)}" id="${esc(id)}" ${o.required ? 'required' : ''} ${o.readonly ? 'readonly' : ''} ${o.disabled ? 'disabled' : ''} ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''}`;
    let input = '';
    const v = o.value == null ? '' : o.value;
    switch (o.type) {
      case 'hidden': return `<input type="hidden" name="${esc(o.name)}" value="${esc(v)}">`;
      case 'textarea': input = `<textarea ${common} rows="${o.rows || 3}">${esc(v)}</textarea>`; break;
      case 'select': {
        const opts = (o.options || []).map(x => typeof x === 'object' ? x : { value: x, label: x });
        input = `<select ${common} ${o.multiple ? 'multiple' : ''}>${o.placeholder && !o.multiple ? `<option value="">${esc(o.placeholder)}</option>` : ''}${opts.map(x => `<option value="${esc(x.value)}" ${(Array.isArray(v) ? v.includes(x.value) : String(x.value) === String(v)) ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`;
        break;
      }
      case 'checkbox': return `<div class="field ${o.full ? 'full' : ''}"><label class="check"><input type="checkbox" name="${esc(o.name)}" ${v ? 'checked' : ''} ${o.disabled ? 'disabled' : ''}> ${esc(o.label)}</label>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>`;
      case 'date': input = `<input type="date" data-type="date" ${common} value="${esc(typeof v === 'number' ? U.toInputDate(v) : v)}" ${o.min ? `min="${esc(typeof o.min === 'number' ? U.toInputDate(o.min) : o.min)}"` : ''}>`; break;
      case 'money': input = `<div class="input-prefix"><span>₹</span><input type="number" data-type="number" ${common} value="${esc(v)}" min="${o.min != null ? o.min : 0}" step="${o.step || 1}"></div>`; break;
      case 'number': input = `<input type="number" data-type="number" ${common} value="${esc(v)}" ${o.min != null ? `min="${o.min}"` : ''} ${o.max != null ? `max="${o.max}"` : ''} step="${o.step || 'any'}">`; break;
      case 'file': input = `<div class="file-drop">${I('upload', 16)}<input type="file" data-file-for="${esc(o.name)}"><input type="hidden" name="${esc(o.name)}" value="${esc(v)}"><span class="fname">${v ? esc(v) : ''}</span>${o.sample !== false ? `<button type="button" class="btn btn-xs btn-ghost" data-act="sample-file" data-name="${esc(o.name)}" data-sample="${esc(o.sample || 'Document.pdf')}">Use sample file</button>` : ''}</div>`; break;
      default: input = `<input type="${o.type || 'text'}" ${common} value="${esc(v)}">`;
    }
    return `<div class="field ${o.full ? 'full' : ''}"${o.style ? ` style="${o.style}"` : ''}>${o.label ? `<label for="${esc(id)}">${esc(o.label)}${req}</label>` : ''}${input}${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>`;
  }

  /** Checklist of booleans: name prefix → values read as {prefix: {item: bool}} via formValues() */
  function checklist(name, items, checked) {
    return `<div class="checklist">${items.map(it => { const on = checked == null ? true : checked === true || (checked && checked[it] !== false); return `<label class="check ${on ? 'done' : ''}"><input type="checkbox" name="${esc(name)}.${esc(it)}" ${on ? 'checked' : ''} data-act-change="checkstyle"> ${esc(it)}</label>`; }).join('')}</div>`;
  }

  /**
   * Read all named controls inside a container into an object.
   * - checkbox → boolean; name "a.b" → nested {a:{b:..}}
   * - data-type="number" → Number; data-type="date" → ms timestamp
   * - select[multiple] → array
   */
  function formValues(root) {
    const out = {};
    root.querySelectorAll('[name]').forEach(el => {
      if (el.disabled) return;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
      else if (el.tagName === 'SELECT' && el.multiple) v = Array.from(el.selectedOptions).map(o => o.value);
      else if (el.dataset.type === 'number') v = el.value === '' ? null : Number(el.value);
      else if (el.dataset.type === 'date') v = U.fromInputDate(el.value);
      else v = el.value;
      U.set(out, el.name, v);
    });
    return out;
  }

  /* ---------------- process visuals ---------------- */
  /** Horizontal stage stepper for a purchase */
  function stepper(state, p, opts) {
    opts = opts || {};
    const cur = E().currentActivity(p);
    const items = (p.stages || []).filter(s => opts.showSkipped || s.status !== 'Skipped');
    return `<div class="stepper">${items.map(s => {
      const n = (p.stages || []).indexOf(s) + 1;
      let cls = s.status === 'Completed' ? 'done' : s.status === 'Skipped' ? 'skipped' : s.status === 'Rejected' ? 'rejected' : 'todo';
      if (cur && cur.stageId === s.stageId) cls = (cur.status === 'Blocked' || p.status === 'On Hold') ? 'blocked' : E().isOverdue(state, cur) ? 'overdue' : 'current';
      const mark = cls === 'done' ? '✓' : cls === 'rejected' ? '✕' : String(n);
      const sub = cls === 'done' && s.completedAt ? U.fmt.dateShort(s.completedAt) : cls === 'current' ? 'Now' : cls === 'overdue' ? 'Overdue' : cls === 'blocked' ? 'Blocked' : cls === 'skipped' ? 'Not required' : '';
      return `<div class="step ${cls}" title="${esc(s.name)}"><div class="sdot">${mark}</div><div class="slabel">${esc(s.name)}</div><div class="ssub">${esc(sub)}</div></div>`;
    }).join('')}</div>`;
  }

  /**
   * WHO HAS THE BALL? — the core card. Ball With (dept) · Owner · Current Activity · Next Action · Due · Ageing
   * opts: { compact, viewer (user), actions (html) }
   */
  function ballCard(state, p, opts) {
    opts = opts || {};
    const b = E().ball(state, p);
    if (b.closed) {
      const tone = p.status === 'Closed' ? 'green' : 'grey';
      return `<section class="ball tone-${tone} ${opts.compact ? 'compact' : ''}"><div class="ball-head"><span class="ball-orb"></span><span class="ball-title">${p.status === 'Closed' ? 'Purchase closed — nobody holds the ball' : `Purchase ${esc(p.status.toLowerCase())}`}</span></div>
        <div class="muted mt-8">${p.status === 'Closed' ? `Closed ${U.fmt.date(p.closedAt)} · every required activity, approval, document and payment is complete.` : esc(closedReason(state, p))}</div></section>`;
    }
    const tone = b.status === 'Overdue' || b.status === 'Blocked' ? 'red' : b.status === 'Waiting' ? 'yellow' : 'orange';
    const mine = opts.viewer && opts.viewer.id === b.ownerUserId;
    const waiting = b.waitingOn === 'vendor' ? ' · waiting on vendor' : b.waitingOn === 'requestor' ? ' · waiting on requestor' : b.waitingOn === 'bank' ? ' · waiting on bank' : '';
    return `<section class="ball tone-${tone} ${opts.compact ? 'compact' : ''}">
      <div class="ball-head">
        <span class="ball-orb"></span>
        <span class="overline">Who has the ball?</span>
        <span class="ball-title">${mine ? 'BALL IS WITH YOU' : `Ball with ${esc(b.ownerName)}`}</span>
        ${actStatusBadge(state, b.status)}${b.onHold ? badge('On Hold', 'orange') : ''}
      </div>
      <div class="ball-grid">
        <div><span>Ball with</span><b>${esc(b.withLabel)}</b></div>
        <div><span>Owner</span><b>${esc(b.ownerName)}</b></div>
        <div class="wide"><span>Current activity</span><b>${esc(b.activityName)}</b></div>
        <div><span>Due</span><b>${due(b.dueAt)}</b></div>
        <div><span>Ageing</span><b>${U.fmt.days(b.ageingDays)}</b></div>
        ${opts.compact ? '' : `<div class="wide" style="grid-column: 1 / -1"><span>Next action</span><b>${esc(b.nextAction)}${esc(waiting)}</b></div>`}
      </div>
      ${b.blocker ? `<div class="mt-12">${alert('danger', `<b>Blocked:</b> ${esc(b.blocker)}`)}</div>` : ''}
      ${opts.actions ? `<div class="ball-foot"><div class="muted small">${esc(b.stageName)} · stage ${(p.stages.findIndex(s => s.stageId === b.stageId) + 1)} of ${p.stages.length}</div><div class="row wrap">${opts.actions}</div></div>` : ''}
    </section>`;
  }
  const actStatusBadge = (state, st) => status(state, 'activity', st);
  function closedReason(state, p) {
    const a = (p.activities || []).find(x => x.status === 'Rejected');
    const who = a && a.completedBy ? E().userName(state, a.completedBy) : '';
    const when = p.closedAt ? U.fmt.date(p.closedAt) : '';
    return `${p.status}${who ? ' by ' + who : ''}${when ? ' on ' + when : ''}${a && a.remarks ? ' — ' + a.remarks : ''}`;
  }

  /* ---------------- modal / confirm / toast ---------------- */
  let modalHandlers = null;
  const modal = {
    /**
     * open({ title, body, size:'lg'|'xl', actions:[{label, act, tone:'primary'|'danger'|..., close}], onAction:{ act: (values, el) => boolean|void } })
     * Return false from a handler to keep the modal open (e.g. validation failed).
     */
    open(o) {
      modalHandlers = o.onAction || {};
      const root = document.getElementById('modal-root');
      const acts = (o.actions || [{ label: 'Close', act: 'close' }]).map(a => `<button type="button" class="btn btn-${a.tone || 'secondary'}" data-modal-act="${esc(a.act)}">${a.icon ? I(a.icon, 15) : ''}${esc(a.label)}</button>`).join('');
      root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><div class="modal ${o.size || ''}" role="dialog" aria-modal="true"><form class="modal-form" onsubmit="return false"><div class="modal-head"><h3>${o.title || ''}</h3><button type="button" class="btn btn-ghost btn-icon" data-modal-act="close" aria-label="Close">${I('x', 18)}</button></div><div class="modal-body">${o.body || ''}</div><div class="modal-foot">${acts}</div></form></div></div>`;
      const first = root.querySelector('input:not([type=hidden]),select,textarea');
      if (first && window.innerWidth > 560) setTimeout(() => { first.focus({ preventScroll: true }); const b = root.querySelector('.modal-body'); if (b) b.scrollTop = 0; }, 30);
    },
    close() { const r = document.getElementById('modal-root'); if (r) r.innerHTML = ''; modalHandlers = null; },
    handle(act, el) {
      if (act === 'close') { modal.close(); return; }
      const form = document.querySelector('#modal-root .modal-form');
      const h = modalHandlers && modalHandlers[act];
      if (!h) { modal.close(); return; }
      const keep = h(formValues(form), form, el);
      if (keep !== false) modal.close();
    },
    isOpen() { return !!document.querySelector('#modal-root .modal'); }
  };

  function confirm(o) {
    return new Promise(resolve => {
      modal.open({
        title: o.title || 'Please confirm', body: `<p>${o.text || ''}</p>${o.extra || ''}`,
        actions: [{ label: 'Cancel', act: 'close' }, { label: o.confirmLabel || 'Confirm', act: 'ok', tone: o.tone || 'primary' }],
        onAction: { ok: v => { resolve(v); } }
      });
      const root = document.getElementById('modal-root');
      root.querySelector('[data-modal-act="close"]').addEventListener('click', () => resolve(false), { once: true });
    });
  }

  function toast(msg, tone, title) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast tone-${tone || 'navy'}`;
    el.innerHTML = `${I(tone === 'red' ? 'alert' : tone === 'green' ? 'checkCircle' : 'info', 16)}<div class="tx">${title ? `<b>${esc(title)}</b>` : ''}${esc(msg)}</div>`;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, tone === 'red' ? 6500 : 3800);
    setTimeout(() => el.remove(), tone === 'red' ? 7000 : 4200);
  }

  /** Inject page-specific CSS once: css('my-page', '.x{...}') — keeps css/app.css shared and stable */
  function css(id, text) {
    if (document.getElementById('css-' + id)) return;
    const st = document.createElement('style'); st.id = 'css-' + id; st.textContent = text; document.head.appendChild(st);
  }

  /** Plain-language explanation of a condition object */
  const cond = c => esc(E().describeCond(c));

  return {
    esc, I, badge, status, actStatus, money, moneyShort, tag, dot, avatar, person, priority, due, ageing,
    pageHead, card, kpi, empty, alert, progress, hbars, tabs, seg, table, field, checklist, formValues,
    stepper, ballCard, modal, confirm, toast, cond, css
  };
})();
