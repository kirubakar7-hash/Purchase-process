/* =====================================================================
   ACTION FORMS — the "What must I do now?" panel for the CURRENT
   activity of a purchase.

     PCT.actionForms.render(ctx, p, a)  → html   (Purchase Detail, My Actions,
                                                  Approvals … embed it)
     PCT.actionForms.available(ctx, p, a) → bool (is there a panel for this viewer?)
     PCT.actionForms.actions            → { 'af-…': (ctx, el, ev) => … }
                                          (the app dispatches af-* everywhere)

   One polished form per activity.actionType (see engine.js H.*). Every
   form shows the step, its due date and what happens next. All changes go
   through ctx.act / ctx.commit so the engine validates + audits them.
   Live totals are DOM-only (no re-render). Each form sits inside
   <div id="af-<activityId>"> so typed values survive live re-renders.
   ===================================================================== */
(function () {
  'use strict';
  const U = PCT.util;
  const fmt = U.fmt;
  const esc = U.esc;
  const I = (n, s) => PCT.icon(n, s);
  const E = PCT.engine;
  const S = PCT.sel;
  const ui = PCT.ui;
  const now = () => PCT.clock.now();

  const MODES = ['NEFT', 'RTGS', 'IMPS', 'Cheque'];
  const BANKS = ['HDFC Bank — Current A/c ••••0021', 'ICICI Bank — Current A/c ••••4410', 'SBI — Current A/c ••••7702'];
  const HOLD_TYPES = ['Invoice mismatch', 'Missing document', 'Tax mismatch', 'Price mismatch', 'Quantity mismatch', 'Other'];
  const RECOVERY_MODES = ['Bank receipt (NEFT / RTGS)', 'Vendor credit note', 'Cheque'];
  const SPEC = ['Yes', 'Partial', 'No'];

  /* =================================================================
     CSS (page-specific, injected once)
     ================================================================= */
  const CSS = `
.af{display:flex;flex-direction:column;gap:14px;min-width:0}
.af-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:#F8FAFC}
.af-head .af-title{display:flex;flex-direction:column;min-width:0;flex:1 1 240px}
.af-head .af-title b{font-size:14px;line-height:1.3}
.af-head .af-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px}
.af-head .af-meta>span{display:inline-flex;align-items:center;gap:4px}
.af-next{flex-basis:100%;display:flex;gap:6px;align-items:flex-start;font-size:12.5px;color:var(--ink-2);padding-top:7px;border-top:1px dashed var(--line)}
.af-next .ic{margin-top:2px;color:var(--blue-600)}
.af-body{display:flex;flex-direction:column;gap:14px;min-width:0}
.af-sec{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--navy-700);padding-bottom:6px;border-bottom:1px solid var(--line-2);margin-bottom:10px}
.af-sec .grow{text-transform:none;letter-spacing:0;font-weight:500;color:var(--muted);text-align:right;font-size:12px}
.af-lead{font-size:13.5px;color:var(--ink-2)}
.af-figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:10px}
.af-figs>div{border:1px solid var(--line);border-radius:9px;padding:9px 12px;background:#fff;min-width:0}
.af-figs>div>span{display:block;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.af-figs>div>b{display:block;font-size:16px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.af-figs>div>small{display:block;font-size:11.5px;color:var(--muted);margin-top:1px}
.af-figs.sm{grid-template-columns:repeat(auto-fit,minmax(92px,1fr))}.af-figs.sm>div>b{font-size:15px}
.af-figs .hl{background:var(--blue-50);border-color:#D4E1FA}
.af-figs .good>b{color:var(--green)}.af-figs .bad>b{color:var(--red)}.af-figs .warn>b{color:var(--orange)}
.af-figs .dark{background:var(--navy-800);border-color:var(--navy-800);color:#fff}.af-figs .dark>span,.af-figs .dark>small{color:#A9BBD6}
.af-box{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:#fff;min-width:0}
.af-box.tint{background:#FAFBFD}
.af-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px}
.af-actions .af-spacer{flex:1 1 auto}
.af-hidden{display:none!important}
.btn.af-soft{opacity:.55;cursor:not-allowed}
.field.af-err input,.field.af-err textarea,.field.af-err select,.field.af-err .file-drop{border-color:var(--red)!important;box-shadow:0 0 0 3px var(--red-bg)!important}
.alert.af-err{border-color:var(--red);box-shadow:0 0 0 3px var(--red-bg)}
.af-checks-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.af-count{font-size:12px;font-weight:650;color:var(--muted)}
.af-count.all{color:var(--green)}
.af-checks .check{align-items:flex-start}
.af-checks .check input{margin-top:1px}
.af-checks .check small{display:block;font-size:11.5px;margin-top:2px;color:var(--muted)}
.af-checks .check small.ok{color:var(--green)}.af-checks .check small.bad{color:var(--red)}
.af-cl1{grid-template-columns:minmax(0,1fr)!important}
.af-q{margin-top:6px;font-size:14px;font-weight:600;color:var(--ink)}
.af-quote-txt{font-style:italic;color:var(--ink-2)}
.af-formula{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap}
.af-formula>div{flex:1 1 130px;border:1px solid var(--line);border-radius:9px;padding:9px 12px;background:#fff;min-width:0}
.af-formula>div>span{display:block;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.af-formula>div>b{display:block;font-size:17px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
.af-formula>.op{flex:0 0 auto;display:grid;place-items:center;font-size:20px;font-weight:700;color:var(--faint);border:0;background:none;padding:0 2px}
.af-formula>.res{background:var(--navy-800);border-color:var(--navy-800);color:#fff}
.af-formula>.res>span{color:#A9BBD6}
.af-banner{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:10px;font-weight:750;font-size:16px;letter-spacing:.02em;flex-wrap:wrap}
.af-banner small{font-weight:500;font-size:12.5px;letter-spacing:0;color:var(--ink-2)}
.af-banner.ok{background:var(--green-bg);color:var(--green);border:1px solid #BFE6D3}
.af-banner.bad{background:var(--red-bg);color:var(--red);border:1px solid #F5C9C9}
.af-banner.pending{background:var(--grey-bg);color:var(--ink-2);border:1px solid var(--line)}
.af-mk{font-weight:800;white-space:nowrap}.af-mk.ok{color:var(--green)}.af-mk.bad{color:var(--red)}
.match-card .af-mrow{display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:3px 0;border-bottom:1px dashed var(--line-2)}
.match-card .af-mrow:last-child{border-bottom:0}
.match-card .af-mrow span{color:var(--muted)}
.match-card .af-mrow b{text-align:right;font-variant-numeric:tabular-nums}
.match-card .af-mref{font-family:var(--mono);font-size:12px;color:var(--ink-2);margin-bottom:6px;overflow-wrap:anywhere}
.match-card.bad{border-color:#F5C9C9;box-shadow:inset 0 3px 0 var(--red)}
.match-card.ok{box-shadow:inset 0 3px 0 var(--green)}
.af-yn{display:inline-flex;border:1px solid #D5DCE6;border-radius:8px;overflow:hidden;flex:none}
.af-yn label{cursor:pointer;position:relative;margin:0}
.af-yn label+label{border-left:1px solid #D5DCE6}
.af-yn input{position:absolute;opacity:0;pointer-events:none}
.af-yn span{display:inline-block;padding:6px 11px;font-size:12.5px;font-weight:600;color:var(--muted);background:#fff;white-space:nowrap}
.af-yn input:checked+span.y{background:var(--green-bg);color:var(--green)}
.af-yn input:checked+span.n{background:var(--red-bg);color:var(--red)}
.af-yn input:focus-visible+span{box-shadow:inset 0 0 0 2px var(--blue-500)}
.af-crit{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1.1fr);gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-2)}
.af-crit:last-child{border-bottom:0}
.af-crit .input{height:34px}
.af-bar{height:10px;border-radius:5px;background:var(--grey-bg);overflow:hidden;display:flex}
.af-bar i{display:block;height:100%}
.af-bar .u{background:var(--navy-600)}.af-bar .t{background:var(--blue-500);opacity:.6}.af-bar .x{background:var(--red)}
.af-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:6px}
.af-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.af-rank{display:inline-grid;place-items:center;min-width:28px;height:20px;padding:0 6px;border-radius:5px;font-size:11px;font-weight:750;background:var(--grey-bg);color:var(--ink-2)}
.af-rank.l1{background:var(--green);color:#fff}
.af-note{font-size:12.5px;color:var(--muted)}
.af-stars{color:#B45309;font-weight:650;white-space:nowrap}
.af-vchoice .choice{position:relative;display:block}
.af-vchoice .choice input{position:absolute;opacity:0;pointer-events:none}
.af-vchoice .choice .af-rank{margin-right:6px}
.af-qv{border:1px solid var(--line);border-radius:10px;background:#fff;min-width:0}
.af-qv-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px}
.af-qv-body{padding:12px;border-top:1px solid var(--line-2);background:#FAFBFD;border-radius:0 0 10px 10px}
.af-tbl-actions{display:grid;grid-template-columns:auto auto;gap:4px;justify-content:end}
.af-tbl-actions .btn{width:100%}
.af-box>*+*,.af-form>*+*{margin-top:12px}
.af-box>.af-sec+*{margin-top:0}
.af .file-drop{flex-wrap:wrap;min-width:0}
.af .file-drop input[type=file]{max-width:100%;min-width:0;flex:1 1 160px}
.af-m-only{display:none}
.pd .af .table-wrap>.tbl,.af .table-wrap>.tbl{min-width:0}
.af-figs>div:only-child{grid-column:1 / -1}
.af .kv dd .badge{white-space:normal;height:auto;min-height:22px;padding-top:2px;padding-bottom:2px}
.af-sub{display:block;font-size:12px;color:var(--muted);margin-top:1px}
.af-ro{display:flex;flex-direction:column;gap:10px}
.af-cb{width:16px;height:16px;accent-color:var(--navy-700);cursor:pointer}
.af-chev{transition:transform .15s}
[aria-expanded="true"] .af-chev{transform:rotate(180deg)}
.af-who{font-size:12px;color:var(--ink-2);margin-top:3px}
.af-who b{font-weight:650}
.af .check-row{align-items:flex-start}
.af .check-row .af-mk{font-size:15px;width:18px;text-align:center}
.af-docs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.af-tight .tbl td,.af-tight .tbl th{padding:7px 10px}
@media (max-width:900px){.af-crit{grid-template-columns:minmax(0,1fr) auto}.af-crit .af-crit-r{grid-column:1 / -1}}
@media (max-width:560px){
 .af-m-only{display:block}
 .af-tbl-actions{grid-template-columns:auto}
 .af-actions{justify-content:stretch}.af-actions .btn{flex:1 1 auto}.af-actions .af-spacer{display:none}
 .af-formula>.op{display:none}.af-formula>div{flex-basis:100%}
 .af-figs{grid-template-columns:repeat(2,minmax(0,1fr))}
 .af-head{padding:9px 10px}
}`;
  function ensureCss() { try { ui.css('action-forms', CSS); } catch (e) { /* no document */ } }
  ensureCss();

  /* =================================================================
     SMALL HELPERS
     ================================================================= */
  const slug = s => String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '_');
  const fid = (a, name, sfx) => `af_${slug(a.id)}_${slug(name)}${sfx ? '_' + slug(sfx) : ''}`;
  const fld = (a, o) => ui.field(Object.assign({ id: fid(a, o.name, o.sfx) }, o));
  const uname = (state, id) => (!id || id === 'system') ? 'System' : E.userName(state, id);
  const vname = (state, id) => S.vendorName(state, id);
  const money = v => ui.money(v);
  const num = v => fmt.num(v);
  const dash = '<span class="muted">—</span>';
  const qt = t => t ? `<span class="af-quote-txt">“${esc(t)}”</span>` : dash;
  const EOB = t => t ? U.endOfBusiness(t) : null;
  /** A date picked in a form → use "now" when it is today (keeps a realistic time in the audit trail). */
  const dayOrNow = t => !t ? null : (U.toInputDate(t) === U.toInputDate(now()) ? now() : t);
  const isSvc = (state, p) => E.context(state, p).categoryType === 'service';
  const doc = (p, id) => (p.documents || []).find(d => d.docId === id);
  const docOk = d => !!d && ['Received', 'Verified', 'Not Required'].includes(d.status);
  const validQuotes = p => (p.quotations || []).filter(q => q.status !== 'Withdrawn');
  const ranked = p => U.sortBy(validQuotes(p), q => Number(q.total) || 0).map((q, i) => Object.assign({ rank: 'L' + (i + 1) }, q));
  const selectedQuote = p => (p.quotations || []).find(q => p.selection && q.vendorId === p.selection.vendorId && q.status !== 'Withdrawn');
  const lastAdvance = (state, p) => (p.advanceIds || []).map(id => E.advance(state, id)).filter(x => x && x.status !== 'Rejected').pop() || null;
  const payList = (state, p) => (p.paymentIds || []).map(id => state.payments.find(x => x.id === id)).filter(Boolean);
  const onDetail = ctx => /^purchases\//.test(String(ctx.route || ''));
  const pct = v => `${Math.round((Number(v) || 0) * 100) / 100}%`;
  const short = name => String(name || '').split(' ')[0].replace(/[^A-Za-z0-9]/g, '');
  const rankBadge = r => `<span class="af-rank ${r === 'L1' ? 'l1' : ''}">${esc(r)}</span>`;
  const specBadge = s => ui.badge(s || 'Yes', s === 'No' ? 'red' : s === 'Partial' ? 'yellow' : 'green', { dot: false });
  const stars = r => r ? `<span class="af-stars">★ ${Number(r).toFixed(1)}</span>` : '<span class="muted">New</span>';
  function docBadge(state, d) {
    if (!d) return ui.badge('Not applicable', 'grey', { dot: false });
    const tone = { Missing: 'red', Received: 'blue', Verified: 'green', 'Not Required': 'grey' }[d.status] || 'grey';
    return ui.badge(d.status, tone);
  }
  function kv(rows) { return `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? dash : v}</dd>`).join('')}</dl>`; }
  /** Figure tiles: [{label, value(html), sub(html), cls, out, subOut}] */
  function figs(items, cls) {
    return `<div class="af-figs ${cls || ''}">${items.filter(Boolean).map(f => `<div class="${f.cls || ''}"><span>${esc(f.label)}</span><b${f.out ? ` data-out="${f.out}"` : ''}>${f.value}</b>${f.sub != null ? `<small${f.subOut ? ` data-out="${f.subOut}"` : ''}>${f.sub}</small>` : ''}</div>`).join('')}</div>`;
  }
  const sec = (title, icon, right) => `<div class="af-sec">${icon ? I(icon, 14) : ''}<span>${esc(title)}</span>${right ? `<span class="grow">${right}</span>` : ''}</div>`;
  function btn(label, o) {
    o = o || {};
    const data = o.data || {};
    const attrs = Object.keys(data).map(k => ` data-${k}="${esc(data[k])}"`).join('');
    return `<button type="button" class="btn ${o.cls || ''}${o.soft ? ' af-soft' : ''}" data-act="${esc(o.act || 'af-op')}"${o.op ? ` data-op="${esc(o.op)}"` : ''}${attrs}${o.disabled ? ' disabled' : ''}${o.title ? ` title="${esc(o.title)}"` : ''}${o.expanded != null ? ` aria-expanded="${o.expanded ? 'true' : 'false'}"` : ''}>${o.icon ? I(o.icon, 15) : ''}${esc(label)}${o.chev ? `<span class="af-chev">${I('chevronDown', 13)}</span>` : ''}</button>`;
  }
  const bar = (...b) => `<div class="af-actions">${b.filter(Boolean).join('')}</div>`;
  const spacer = '<span class="af-spacer"></span>';
  /** Toggle button + key in ctx.local (DOM-only show/hide so typed values are kept). */
  const toggleBtn = (ctx, key, label, o) => btn(label, Object.assign({ act: 'af-toggle', data: { key }, cls: 'btn-sm btn-ghost', chev: true, expanded: !!ctx.local[key] }, o || {}));
  const toggled = (ctx, key, invert) => (invert ? !ctx.local[key] : !!ctx.local[key]);
  const togAttr = (ctx, key, invert) => `data-toggle="${esc(key)}"${invert ? ' data-invert="1"' : ''} class="${toggled(ctx, key, invert) ? '' : 'af-hidden'}"`;
  /** Live-calculated form container */
  const formOpen = (calc, data, cls) => `<div class="af-form ${cls || ''}" data-calc="${calc || 'none'}" data-act-input="af-calc" data-act-change="af-calc"${Object.keys(data || {}).map(k => ` data-${k}="${esc(data[k])}"`).join('')}>`;
  const opts = (list, val, lab) => list.map(x => typeof x === 'object' ? { value: x[val || 'id'], label: x[lab || 'name'] } : { value: x, label: x });

  /** Checklist with live counter. items: [string] or [{label, ok, detail}]; checked: {label: bool} or null (use it.ok) */
  function checks(name, items, checked, o) {
    o = o || {};
    const list = items.map(it => typeof it === 'string' ? { label: it } : it);
    const isOn = it => checked ? !!checked[it.label] : !!it.ok;
    const done = list.filter(isOn).length;
    return `<div class="af-checks" data-gate="${o.gate ? '1' : ''}">
      <div class="af-checks-head"><span class="overline">${esc(o.title || 'Checklist')}</span><span class="af-count ${done === list.length ? 'all' : ''}" data-count>${done}/${list.length} ticked</span></div>
      <div class="checklist ${o.one ? 'af-cl1' : ''}">${list.map(it => { const on = isOn(it); return `<label class="check ${on ? 'done' : ''}"><input type="checkbox" name="${esc(name)}.${esc(it.label)}" ${on ? 'checked' : ''} data-act-change="af-check"><span class="grow"><span>${esc(it.label)}</span>${it.detail != null ? `<small class="${it.ok ? 'ok' : 'bad'}">${it.ok ? '✓' : '!'} ${esc(it.detail)}</small>` : ''}</span></label>`; }).join('')}</div>
    </div>`;
  }
  const allFalse = items => { const o = {}; items.forEach(i => { o[i] = false; }); return o; };

  /** Next activity after this one (skips conditions that are already known to be false). */
  function nextStep(state, p, a) {
    const c = E.context(state, p);
    const i = (p.activities || []).indexOf(a);
    for (let j = i + 1; j < p.activities.length; j++) {
      const x = p.activities[j];
      if (x.status !== 'Not Started') continue;
      if (x.condition) {
        const v = x.condition.field ? U.get(c, x.condition.field) : undefined;
        if (v == null && x.condition.field) return { x, cond: true };
        if (!E.evalCond(x.condition, c)) continue;
      }
      return { x };
    }
    return null;
  }
  function nextText(state, p, a) {
    if (a.actionType === 'closure') return 'The purchase is <b>closed</b>; the requestor is notified and the file is locked.';
    const n = nextStep(state, p, a);
    if (!n) return 'Closure checks and close-out by Procurement.';
    const cond = n.cond ? (n.x.actionType === 'selection_approval' ? ' <span class="muted">(only if a non-L1 vendor is selected)</span>' : ' <span class="muted">(if required)</span>') : '';
    return `<b>${esc(n.x.name)}</b> → ${esc(uname(state, n.x.ownerUserId))}${cond}`;
  }

  /* =================================================================
     WRAPPER: header (step · due · what happens next) + body
     ================================================================= */
  function wrap(ctx, p, a, body, o) {
    o = o || {};
    const { state } = ctx;
    const idx = (p.stages || []).findIndex(s => s.stageId === a.stageId) + 1;
    const head = `<div class="af-head">
      <div class="af-title"><span class="overline">Step ${idx} of ${(p.stages || []).length} · ${esc(a.stageName)}</span><b>${esc(o.title || a.name)}</b></div>
      <div class="af-meta">${ui.actStatus(state, a)}<span>${I('clock', 13)} Due&nbsp;${ui.due(a.dueAt)}</span>${a.dueAt ? `<span class="muted">${esc(fmt.date(a.dueAt))}</span>` : ''}</div>
      <div class="af-next">${I('arrowRight', 13)}<span><b>What happens next:</b> ${o.next || nextText(state, p, a)}</span></div>
    </div>`;
    return `<div class="af" id="af-${esc(a.id)}" data-af data-pid="${esc(p.id)}" data-aid="${esc(a.id)}">${head}<div class="af-body">${body}</div></div>`;
  }

  /* =================================================================
     RENDER ENTRY
     ================================================================= */
  function render(ctx, p, a) {
    ensureCss();
    queueRefresh();
    if (!ctx.local) ctx.local = {};
    const { state, user } = ctx;
    if (!p) return '';
    a = a || E.currentActivity(p);
    if (!a) {
      return `<div class="af">${ui.empty('inbox', p.status === 'Closed' ? 'Purchase closed' : 'No open activity', p.status === 'Closed' ? 'Every control passed — nothing left to do.' : 'There is nothing to act on right now.')}</div>`;
    }
    const clarOpen = !!(a.clarification && !a.clarification.response);
    const can = !!user && E.canAct(state, user, p, a);
    try {
      if (p.status === 'On Hold') return wrap(ctx, p, a, onHoldView(ctx, p, a));
      if (clarOpen) {
        if (user && user.id === p.requestorId) return wrap(ctx, p, a, clarifyForm(ctx, p, a), { title: 'Answer clarification', next: `Your answer goes back to <b>${esc(uname(state, a.ownerUserId))}</b> to continue “${esc(a.name)}”.` });
        return wrap(ctx, p, a, clarWaiting(ctx, p, a));
      }
      if (!can) {
        if (financeVariance(ctx, p, a)) return wrap(ctx, p, a, R.match(ctx, p, a, { financeOnly: true }), { title: 'Accept 3-way match variance (Finance)' });
        return wrap(ctx, p, a, readOnly(ctx, p, a));
      }
      const fn = R[a.actionType] || R.task;
      return wrap(ctx, p, a, returnedNote(ctx, p, a) + fn(ctx, p, a));
    } catch (e) {
      console.error(e);
      return wrap(ctx, p, a, ui.alert('danger', `<b>The action panel could not be shown.</b> ${esc(e.message)}`));
    }
  }

  /** Is there an action panel for this viewer? (owner / pool, requestor answering, Finance accepting a match variance) */
  function available(ctx, p, a) {
    a = a || (p && E.currentActivity(p));
    if (!p || !a || !ctx.user) return false;
    return E.canAct(ctx.state, ctx.user, p, a) || financeVariance(ctx, p, a);
  }
  function financeVariance(ctx, p, a) {
    return !!(ctx.user && ctx.user.roleId === 'finance' && a.actionType === 'match' && a.status === 'Blocked' && p.status === 'Open');
  }

  function returnedNote(ctx, p, a) {
    if (!a.returnedReason || a.actionType === 'pr_submit') return '';
    return ui.alert('warn', `<b>Returned to this step for rework:</b> ${esc(a.returnedReason)}`, 'undo');
  }

  function onHoldView(ctx, p, a) {
    return ui.alert('warn', `<b>Purchase on hold.</b> ${esc((a.blocker || '').replace(/^On hold:\s*/, '') || 'Put on hold')} — nobody can act until Procurement, Finance or the department head resumes it.`, 'pause');
  }

  function readOnly(ctx, p, a) {
    const { state, user } = ctx;
    const b = E.ball(state, p);
    const waiting = b.waitingOn ? ` · waiting on ${esc(b.waitingOn)}` : '';
    return `<div class="af-ro">
      <p class="af-lead">The ball is with <b>${esc(b.ownerName)}</b> (${esc(b.withLabel)}). You will see the action form here when it is your turn.</p>
      ${kv([['Current step', esc(a.name)], ['Next action', esc(b.nextAction) + waiting], ['Due', `${ui.due(b.dueAt)} <span class="muted small">${esc(fmt.date(b.dueAt))}</span>`], b.blocker ? ['Blocked', `<span style="color:var(--red)">${esc(b.blocker)}</span>`] : null])}
      ${user && a.ownerUserId === user.id && p.status === 'On Hold' ? ui.alert('info', 'This step is yours but the purchase is on hold.') : ''}
    </div>`;
  }

  /* ---------------- clarification ---------------- */
  function clarifyForm(ctx, p, a) {
    const { state } = ctx;
    const c = a.clarification;
    return `${ui.alert('warn', `<b>${esc(uname(state, c.askedBy))} needs a clarification</b> before deciding on “${esc(a.name)}” · asked ${esc(fmt.dateTime(c.askedAt))}<div class="af-q">“${esc(c.question)}”</div>`, 'message')}
      ${formOpen(null, {})}
        <div class="form-grid cols-1">${fld(a, { name: 'response', label: 'Your answer', type: 'textarea', rows: 4, required: true, full: true, placeholder: 'Answer the question; mention any document you have attached on the Documents tab.' })}</div>
        ${bar(btn('Send answer', { act: 'af-clarify', cls: 'btn-primary', icon: 'send' }))}
      </div>
      ${miniSummary(ctx, p)}`;
  }
  function clarWaiting(ctx, p, a) {
    const { state, user } = ctx;
    const c = a.clarification;
    const mine = user && user.id === a.ownerUserId;
    return `${ui.alert('warn', `<b>${mine ? 'Waiting for the requestor’s clarification' : 'Waiting for clarification from the requestor'}</b> — ${esc(uname(state, p.requestorId))} has the ball.<div class="af-q">“${esc(c.question)}”</div><div class="small mt-4">Asked by ${esc(uname(state, c.askedBy))} · ${esc(fmt.dateTime(c.askedAt))} (${esc(fmt.ago(c.askedAt))})</div>`, 'clock')}
      ${mine ? '<p class="af-note">The approval form re-opens for you as soon as the answer arrives.</p>' : ''}`;
  }
  function qaBox(ctx, p, a) {
    const c = a.clarification;
    if (!c || !c.response) return '';
    const { state } = ctx;
    return ui.alert('info', `<b>Clarification</b> · ${esc(uname(state, c.askedBy))} asked: ${qt(c.question)}<div class="mt-4"><b>${esc(uname(state, p.requestorId))} answered</b> ${esc(fmt.dateTime(c.respondedAt))}: ${qt(c.response)}</div>`, 'message');
  }

  /* =================================================================
     SUMMARIES SHARED BY SEVERAL FORMS
     ================================================================= */
  function miniSummary(ctx, p) {
    const { state } = ctx;
    return `<div class="af-box tint">${sec('Purchase', 'cart')}${figs([
      { label: 'Estimated value', value: money(p.estValue), cls: 'hl' },
      { label: 'Category', value: esc(S.catName(state, p.categoryId)) },
      { label: 'Department', value: esc(S.deptName(state, p.deptId)), sub: esc(S.ccName(state, p.costCentreId)) },
      { label: 'Required by', value: p.requiredBy ? esc(fmt.date(p.requiredBy)) : dash, sub: p.requiredBy ? ui.due(p.requiredBy) : null }
    ])}</div>`;
  }

  function prSummary(ctx, p) {
    const { state } = ctx;
    const f = p.flags || {};
    const c = E.context(state, p);
    const flags = [
      f.advanceRequired ? ui.badge(`Advance ${f.advancePct || 0}%`, 'orange', { dot: false }) : '',
      f.singleSource ? ui.badge('Single source', 'orange', { dot: false }) : '',
      f.emergency ? ui.badge('Emergency', 'red', { dot: false }) : '',
      c.agreementRequired ? ui.badge('Agreement required', 'blue', { dot: false }) : '',
      c.techEval ? ui.badge('Technical evaluation', 'purple', { dot: false }) : ''
    ].filter(Boolean).join(' ');
    return `${figs([
      { label: 'Estimated value', value: money(p.estValue), cls: 'hl', sub: esc(S.catName(state, p.categoryId)) },
      { label: 'Quantity', value: `${esc(num(p.qty))} ${esc(p.uom || '')}` },
      { label: 'Required by', value: p.requiredBy ? esc(fmt.date(p.requiredBy)) : dash, sub: p.requiredBy ? ui.due(p.requiredBy) : null },
      { label: 'Priority', value: ui.priority(state, p.priority) }
    ])}
    <div class="af-box mt-12">${kv([
      ['Requirement', `<b>${esc(p.title)}</b>`],
      ['Department', `${esc(S.deptName(state, p.deptId))} · <span class="muted">${esc(S.ccName(state, p.costCentreId))}</span>`],
      ['Requestor', ui.person(state, p.requestorId)],
      ['Justification', qt(p.justification)],
      p.specification ? ['Specification', qt(p.specification)] : null,
      p.description ? ['Description', esc(p.description)] : null,
      ['Budget available', p.budgetAvailable ? ui.badge('Yes — confirmed by requestor', 'green') : ui.badge('No — needs budget approval', 'red')],
      flags ? ['Flags', flags] : null
    ])}</div>`;
  }

  /** Cost-centre budget context: committed + this purchase vs budget. */
  function budgetBox(ctx, p) {
    const { state } = ctx;
    const cc = U.byId(state.masters.costCentres, p.costCentreId);
    if (!cc || !cc.budget) return `<div class="af-box">${sec('Budget', 'rupee')}<p class="af-note">No budget is configured for this cost centre.</p></div>`;
    const used = U.sum(state.purchases.filter(x => x.id !== p.id && x.costCentreId === cc.id && ['Open', 'On Hold', 'Closed'].includes(x.status)), x => x.po ? x.po.total : x.estValue);
    const mine = p.po ? p.po.total : p.estValue;
    const after = cc.budget - used - mine;
    const w = v => Math.max(0, Math.min(100, v / cc.budget * 100));
    const over = after < 0;
    return `<div class="af-box">${sec('Budget context', 'rupee', esc(cc.id))}
      ${figs([
        { label: 'Budget', value: esc(fmt.inrShort(cc.budget)), sub: esc(cc.name) },
        { label: 'Committed', value: esc(fmt.inrShort(used)), sub: `${Math.round(used / cc.budget * 100)}% used` },
        { label: 'After this', value: esc(fmt.inrShort(after)), cls: over ? 'bad' : 'good', sub: over ? 'over budget' : 'remaining' }
      ], 'sm')}
      <div class="af-bar mt-12"><i class="u" style="width:${w(used)}%"></i><i class="${over ? 'x' : 't'}" style="width:${w(mine)}%"></i></div>
      <div class="af-legend"><span><i style="background:var(--navy-600)"></i>Committed / spent</span><span><i style="background:${over ? 'var(--red)' : 'var(--blue-500)'}"></i>This purchase ${esc(fmt.inr(mine))}</span></div>
      ${over ? `<div class="mt-8">${ui.alert('danger', `Exceeds the cost-centre budget by <b>${esc(fmt.inr(-after))}</b>.`)}</div>` : ''}
      ${!p.budgetAvailable ? `<div class="mt-8">${ui.alert('warn', 'The requestor marked budget as <b>not available</b>.')}</div>` : ''}
    </div>`;
  }

  /** Approval chain with prior decisions. */
  function approvalChain(ctx, p, a) {
    const { state } = ctx;
    const items = (p.approvals || []).map(l => {
      const cur = a && a.approvalLevel === l.level;
      const st = l.status === 'Approved' ? 'Completed' : l.status === 'Rejected' ? 'Rejected' : l.status === 'Returned' ? 'Waiting' : cur ? 'In Progress' : 'Not Started';
      const label = cur && l.status === 'Pending' ? 'Your decision' : l.status;
      return `<li class="${l.status === 'Approved' ? 'done' : cur ? 'current' : ''}"><span class="vd">${l.status === 'Approved' ? '✓' : 'L' + l.level}</span><div class="vbody">
        <div class="row between wrap gap-4"><b>L${l.level} · ${esc(l.label)}</b>${ui.badge(label, S.statusTone(state, 'activity', st))}</div>
        <div class="small muted">${esc(uname(state, l.userId))}${l.at ? ' · ' + esc(fmt.dateTime(l.at)) : ''}</div>
        ${l.remarks && l.status !== 'Pending' ? `<div class="small mt-4">${qt(l.remarks)}</div>` : ''}</div></li>`;
    });
    const band = (p.approvals || [])[0];
    return `<div class="af-box">${sec('Approval chain', 'approve', band && band.matrixName ? esc(band.matrixName) : '')}<ul class="vsteps">${items.join('') || '<li class="muted">No approval levels</li>'}</ul></div>`;
  }

  /** Approve / Return / Clarify / Reject panel (approval, selection_approval, po_approve, advance_approve, payment_approval). */
  function decisionPanel(ctx, p, a, o) {
    const has = op => o.ops.includes(op);
    const need = [has('return') && 'return', has('clarify') && 'ask the requestor a question', has('reject') && 'reject'].filter(Boolean);
    return `${o.summary || ''}
      ${formOpen(o.calc || null, o.data || {})}
        ${o.before || ''}
        <div class="form-grid cols-1 ${o.before ? 'mt-12' : ''}">${fld(a, { name: 'remarks', label: o.remarksLabel || 'Remarks', type: 'textarea', rows: 3, full: true, placeholder: o.placeholder || 'Add a note for the audit trail…', hint: `Optional when approving${need.length ? ` · required to ${need.join(', ')}` : ''}.` })}</div>
        ${bar(
          has('reject') ? btn(o.rejectLabel || 'Reject', { op: 'reject', cls: 'btn-outline-danger', icon: 'xCircle' }) : '',
          spacer,
          has('clarify') ? btn('Ask clarification', { op: 'clarify', icon: 'message' }) : '',
          has('return') ? btn(o.returnLabel || 'Return', { op: 'return', cls: 'btn-warn', icon: 'undo' }) : '',
          btn(o.approveLabel || 'Approve', { op: 'approve', cls: 'btn-success', icon: 'check', soft: o.softApprove, title: o.softTitle })
        )}
      </div>`;
  }

  function poBox(ctx, p, title) {
    const { state } = ctx;
    const po = p.po || {};
    const v = E.vendor(state, po.vendorId) || {};
    return `<div class="af-box">${sec(title || 'Purchase order', 'po', po.number ? `${esc(po.number)} ${ui.status(state, 'po', po.status)}` : '')}
      ${figs([
        { label: 'Vendor', value: esc(v.name || '—'), sub: `${esc(v.city || '')}${v.gstin ? ' · ' + esc(v.gstin) : ''}` },
        { label: 'Quantity', value: `${esc(num(po.qty))} ${esc(p.uom || '')}`, sub: `@ ${esc(fmt.inr(po.unitPrice))}` },
        { label: 'Basic + tax', value: esc(fmt.inr(po.basic)), sub: `+ ${esc(fmt.inr(po.tax))} (${esc(pct(po.taxPct))})` },
        { label: 'PO total', value: money(po.total), cls: 'hl' }
      ])}
      <div class="mt-12">${kv([
        ['Delivery', `${esc(String(po.deliveryDays || 0))} days${po.expectedDelivery ? ` · expected ${esc(fmt.date(po.expectedDelivery))}` : ''}`],
        ['Payment terms', esc(po.paymentTerms || '—')],
        ['Warranty', esc(po.warranty || '—')],
        ['Valid until', po.validUntil ? `${esc(fmt.date(po.validUntil))}${po.validUntil < now() && !['Vendor Accepted', 'Partially Completed', 'Completed'].includes(po.status) ? ' ' + ui.badge('Expired', 'red') : ''}` : '—']
      ])}</div>
    </div>`;
  }

  /* =================================================================
     RENDERERS — one per activity.actionType
     ================================================================= */
  const R = {};

  /* ---------- requirement / generic task ---------- */
  R.requirement = (ctx, p, a) => `${formOpen(null, {})}
      ${(a.checklist || []).length ? checks('checklist', a.checklist, allFalse(a.checklist), { title: 'Requirement checklist', gate: true }) : ''}
      <div class="form-grid cols-1 mt-12">${fld(a, { name: 'remarks', label: 'Remarks', type: 'textarea', rows: 3, full: true, placeholder: 'What is needed, why, and by when?' })}</div>
      ${bar(btn('Mark requirement captured', { op: 'complete', cls: 'btn-primary', icon: 'check' }))}
    </div>`;
  R.task = (ctx, p, a) => `${a.description ? `<p class="af-lead">${esc(a.description)}</p>` : ''}
    ${formOpen(null, {})}
      ${(a.checklist || []).length ? checks('checklist', a.checklist, allFalse(a.checklist), { gate: true }) : ''}
      <div class="form-grid cols-1 mt-12">${fld(a, { name: 'remarks', label: 'Remarks', type: 'textarea', rows: 3, full: true })}</div>
      ${bar(btn('Complete step', { op: 'complete', cls: 'btn-primary', icon: 'check' }))}
    </div>`;

  /* ---------- pr_submit: edit + submit (draft or returned) ---------- */
  R.pr_submit = (ctx, p, a) => {
    const { state } = ctx;
    const f = p.flags || {};
    const ret = p.returned;
    const miss = E.validatePR(state, p);
    const cats = state.masters.categories.filter(c => c.status === 'Active' || c.id === p.categoryId);
    const depts = state.masters.departments.filter(d => d.status === 'Active' || d.id === p.deptId);
    const ccs = state.masters.costCentres.filter(c => c.status === 'Active' || c.id === p.costCentreId);
    const advTypes = state.masters.advanceTypes.filter(t => t.status === 'Active');
    const levels = E.approvalLevels(state, p);
    const top = ret
      ? ui.alert('danger', `<b>Returned to you by ${esc(uname(state, ret.by))}</b> on ${esc(fmt.dateTime(ret.at))}${ret.stage ? ` at ${esc(ret.stage)}` : ''}:<div class="af-q">“${esc(ret.reason)}”</div><div class="small mt-4">Update the request below, save, and resubmit. Approvals restart from the first level.</div>`, 'undo')
      : (p.status === 'Draft' ? ui.alert('info', '<b>Draft — not submitted yet.</b> Submitting generates the PR number and sends it to Procurement for initial review.') : '');
    const missing = miss.length ? ui.alert('warn', `<b>Required before you can submit:</b> ${esc(miss.join(', '))}`) : '';
    return `${top}${missing}
      ${formOpen('pr', { cat: p.categoryId, dept: p.deptId })}
        <div class="form-grid">
          <div class="form-section" style="margin-top:0">What do you need?</div>
          ${fld(a, { name: 'title', label: 'Requirement title', value: p.title, required: true, full: true })}
          ${fld(a, { name: 'description', label: 'Description', type: 'textarea', rows: 2, value: p.description, full: true })}
          ${fld(a, { name: 'specification', label: 'Specification', type: 'textarea', rows: 2, value: p.specification, full: true, hint: 'Make, model, capacity, standards — what the vendor must quote against.' })}
          ${fld(a, { name: 'categoryId', label: 'Purchase category', type: 'select', value: p.categoryId, options: opts(cats), placeholder: 'Select…', required: true })}
          ${fld(a, { name: 'priority', label: 'Priority', type: 'select', value: p.priority, options: opts(state.masters.priorities.filter(x => x.status === 'Active')) })}
          ${fld(a, { name: 'qty', label: 'Quantity', type: 'number', value: p.qty, min: 0, required: true })}
          ${fld(a, { name: 'uom', label: 'Unit of measure', value: p.uom })}
          <div class="form-section">Cost &amp; budget</div>
          ${fld(a, { name: 'estValue', label: 'Estimated value (incl. tax)', type: 'money', value: p.estValue, required: true })}
          ${fld(a, { name: 'requiredBy', label: 'Required by', type: 'date', value: p.requiredBy, required: true })}
          ${fld(a, { name: 'deptId', label: 'Department', type: 'select', value: p.deptId, options: opts(depts), placeholder: 'Select…', required: true })}
          ${fld(a, { name: 'costCentreId', label: 'Cost centre', type: 'select', value: p.costCentreId, options: ccs.map(c => ({ value: c.id, label: `${c.id} · ${c.name}` })), placeholder: 'Select…', required: true })}
          ${fld(a, { name: 'justification', label: 'Business justification', type: 'textarea', rows: 2, value: p.justification, required: true, full: true })}
          ${fld(a, { name: 'budgetAvailable', label: 'Budget is available in this cost centre', type: 'checkbox', value: p.budgetAvailable !== false, full: true })}
          <div class="form-section">Purchase flags</div>
          ${fld(a, { name: 'flags.advanceRequired', label: 'Vendor advance required', type: 'checkbox', value: !!f.advanceRequired })}
          ${fld(a, { name: 'flags.singleSource', label: 'Single source (justify at comparison)', type: 'checkbox', value: !!f.singleSource })}
          ${fld(a, { name: 'flags.emergency', label: 'Emergency purchase', type: 'checkbox', value: !!f.emergency })}
          ${fld(a, { name: 'flags.agreementRequired', label: 'Agreement / contract required', type: 'checkbox', value: !!f.agreementRequired })}
          <div data-show="adv" class="${f.advanceRequired ? '' : 'af-hidden'}" style="display:contents">
            ${fld(a, { name: 'flags.advancePct', label: 'Advance %', type: 'number', value: f.advancePct || '', min: 1, max: 100, hint: 'Of the PO value. Bands: ≤25% Dept Head · ≤50% Finance · above Management.' })}
            ${fld(a, { name: 'flags.advanceTypeId', label: 'Advance type', type: 'select', value: f.advanceTypeId || 'ADT-PART', options: opts(advTypes) })}
          </div>
        </div>
        <div class="af-box tint mt-16"><div class="row between wrap"><span class="overline">Approvals this PR will need</span><span class="af-note">Approval Matrix · live</span></div><div class="mt-4" data-out="chain">${chainText(levels)}</div></div>
        ${bar(spacer, btn('Save changes', { op: 'edit', icon: 'check' }), btn(ret ? 'Resubmit PR' : 'Submit PR', { op: 'submit', cls: 'btn-primary', icon: 'send' }))}
      </div>`;
  };
  function chainText(levels) {
    if (!levels || !levels.length) return '<span class="muted">—</span>';
    return `${levels.map(l => `<span class="tag">L${l.level} · ${esc(l.label)}</span>`).join(' → ')}${levels[0].matrixName ? ` <span class="af-note">· ${esc(levels[0].matrixName)}</span>` : ''}`;
  }

  /* ---------- review ---------- */
  R.review = (ctx, p, a) => `${prSummary(ctx, p)}
    ${formOpen(null, {})}
      ${checks('checklist', a.checklist || [], allFalse(a.checklist || []), { title: 'Completeness checklist', gate: true })}
      <div class="form-grid cols-1 mt-12">${fld(a, { name: 'remarks', label: 'Remarks / reason', type: 'textarea', rows: 3, full: true, placeholder: 'e.g. Specification complete; existing rate contract not applicable.', hint: 'Optional to complete · required to return the PR (the requestor sees it).' })}</div>
      ${bar(btn('Return to requestor', { op: 'return', cls: 'btn-warn', icon: 'undo' }), spacer, btn('Complete review', { op: 'complete', cls: 'btn-primary', icon: 'check' }))}
    </div>`;

  /* ---------- approval (PR, per level) ---------- */
  R.approval = (ctx, p, a) => {
    const { state, user } = ctx;
    const lv = (p.approvals || []).find(l => l.level === a.approvalLevel) || {};
    const n = (p.approvals || []).length;
    const intro = `<p class="af-lead">You are approving at <b>L${a.approvalLevel} · ${esc(lv.label || '')}</b>${n > 1 ? ` (level ${a.approvalLevel} of ${n})` : ''} · Approval Matrix band <b>${esc(lv.matrixName || '—')}</b>${lv.matrixId ? ` <span class="muted">(${esc(lv.matrixId)})</span>` : ''}.</p>`;
    const sod = user && user.id === p.requestorId ? ui.alert('danger', '<b>Segregation of duties:</b> you raised this purchase and cannot approve it.') : '';
    const summary = `${intro}${sod}${onDetail(ctx) ? '' : qaBox(ctx, p, a)}${prSummary(ctx, p)}<div class="grid grid-2 mt-12">${budgetBox(ctx, p)}${approvalChain(ctx, p, a)}</div>`;
    return decisionPanel(ctx, p, a, { summary, ops: ['approve', 'return', 'clarify', 'reject'], approveLabel: `Approve L${a.approvalLevel}`, returnLabel: 'Return to requestor', placeholder: 'Remarks, or your question for the requestor…', softApprove: !!sod });
  };

  /* ---------- sourcing ---------- */
  R.sourcing = (ctx, p, a) => {
    const { state } = ctx;
    const single = !!(p.flags && p.flags.singleSource);
    const min = E.rule(state, 'R03') ? (Number(E.ruleParam(state, 'R03', 'minQuotes', 3)) || 3) : 1;
    const inCat = v => (v.categoryIds || []).includes(p.categoryId) && v.approved;
    const all = state.masters.vendors.filter(v => v.status === 'Active');
    const selKey = 'af_sel_' + a.id, allKey = 'af_all_' + a.id, newKey = 'af_new_' + a.id;
    const def = (p.sourcing && p.sourcing.vendorIds) || U.sortBy(all.filter(inCat), v => -(v.rating || 0)).slice(0, single ? 1 : min).map(v => v.id);
    const sel = new Set(ctx.local[selKey] || def);
    const showAll = !!ctx.local[allKey];
    const rows = U.sortBy(all.map(v => ({ v, id: v.id, name: v.name, rating: v.rating || 0, exposure: E.vendorOutstanding(state, v.id), match: inCat(v) })), r => (r.match ? 0 : 100) - r.rating);
    const nMatch = rows.filter(r => r.match).length;
    const table = ui.table([
      { key: 'pick', label: '', sort: false, width: '36px', render: r => `<input type="checkbox" class="af-cb" name="v.${esc(r.id)}" ${sel.has(r.id) ? 'checked' : ''} data-act-change="af-vpick" aria-label="Shortlist ${esc(r.name)}">` },
      { key: 'name', label: 'Vendor', render: r => `<b>${esc(r.name)}</b>${r.v.msme ? ' ' + ui.badge('MSME', 'purple', { dot: false }) : ''}<span class="sub">${esc(r.v.city || '')}${r.match ? '' : ' · not listed for this category'}</span>` },
      { key: 'rating', label: 'Rating', align: 'right', render: r => stars(r.rating) },
      { key: 'cats', label: 'Categories', hideOnMobile: true, sort: r => (r.v.categoryIds || []).join(), render: r => `<span class="small">${esc((r.v.categoryIds || []).map(c => S.catName(state, c)).join(', '))}</span>` },
      { key: 'exposure', label: 'Advance exposure', align: 'right', render: r => r.exposure > 0 ? `<b style="color:var(--orange)">${esc(fmt.inr(r.exposure))}</b><span class="sub">outstanding</span>` : '<span class="muted">Nil</span>' },
      { key: 'status', label: 'Status', hideOnMobile: true, sort: r => r.v.approved ? 0 : 1, render: r => r.v.approved ? ui.badge('Approved', 'green') : ui.badge(r.v.onboarding || 'Pending KYC', 'yellow') }
    ], rows, { key: 'af_src', sort: ctx.local.af_srcSort, dense: true, rowClass: r => `${r.match ? '' : 'af-tg-' + slug(allKey) + (showAll ? '' : ' af-hidden')}${sel.has(r.id) ? ' row-selected' : ''}`, empty: 'No active vendors in the Vendor Master.' });
    return `${single ? ui.alert('info', '<b>Single-source purchase.</b> One vendor is enough; the single-source justification is captured at comparison.') : ''}
      ${formOpen('sourcing', { min, single: single ? 1 : 0, selkey: selKey, allkey: allKey })}
        <div class="af-sec">${I('vendor', 14)}<span>Approved vendors for ${esc(S.catName(state, p.categoryId))}</span><span class="grow">${nMatch} in category · rating · open advance exposure</span></div>
        ${table}
        <div class="row between wrap mt-12">
          <div class="row wrap">${toggleBtn(ctx, allKey, `Show all vendors (${rows.length - nMatch} more)`, { icon: 'users' })}${toggleBtn(ctx, newKey, 'Add new vendor', { icon: 'plus' })}</div>
          <b data-out="selcount">${sel.size} selected</b>
        </div>
        <div data-show="r03" class="mt-8 ${!single && sel.size < min ? '' : 'af-hidden'}">${ui.alert('warn', `<b>Rule R03:</b> ${min} quotations are needed before comparison — shortlist at least ${min} vendors (currently <span data-out="selcount2">${sel.size}</span>).`)}</div>
        <div ${togAttr(ctx, newKey)}><div class="af-box tint mt-12">
          ${sec('New vendor (added as “Pending KYC”)', 'plus')}
          <div class="form-grid">
            ${fld(a, { name: 'newVendor.name', label: 'Vendor name', required: true })}
            ${fld(a, { name: 'newVendor.city', label: 'City' })}
            ${fld(a, { name: 'newVendor.gstin', label: 'GSTIN', placeholder: '15-character GSTIN' })}
            ${fld(a, { name: 'newVendor.pan', label: 'PAN' })}
            ${fld(a, { name: 'newVendor.contact', label: 'Contact e-mail / phone', full: true })}
          </div>
          <p class="af-note mt-8">The vendor is created in the Vendor Master as <b>not yet approved</b> and added to this shortlist. KYC must be completed before a PO is issued.</p>
        </div></div>
        ${bar(spacer, btn('Confirm shortlist', { op: 'complete', cls: 'btn-primary', icon: 'check' }))}
      </div>`;
  };

  /* ---------- RFQ ---------- */
  R.rfq = (ctx, p, a) => (p.rfqs || []).length ? rfqTracker(ctx, p, a) : rfqSend(ctx, p, a);
  function rfqSend(ctx, p, a) {
    const { state } = ctx;
    const ids = (p.sourcing && p.sourcing.vendorIds) || [];
    const due = U.addDays(now(), 3, true);
    const list = ids.map(id => E.vendor(state, id)).filter(Boolean);
    return `${formOpen('rfqsend', {})}
      ${sec('Send RFQ to the shortlisted vendors', 'send', `${list.length} shortlisted`)}
      <div class="stack-sm">${list.map(v => `<label class="check-row"><input type="checkbox" class="af-cb" name="v.${esc(v.id)}" checked><span class="grow"><b>${esc(v.name)}</b><small>${esc(v.city || '')} · ${esc(v.contact || '')}</small></span>${stars(v.rating)}</label>`).join('') || ui.empty('vendor', 'No vendors shortlisted', 'Vendor sourcing produced no shortlist.')}</div>
      <div class="form-grid mt-12">${fld(a, { name: 'dueDate', label: 'Response due date', type: 'date', value: due, min: now(), required: true, hint: 'Vendors still pending after this date are flagged for follow-up.' })}
        <div class="field"><label>RFQ documents</label><div class="af-note" style="padding-top:8px">${I('file', 13)} One RFQ per vendor is generated with the specification and terms.</div></div></div>
      ${bar(spacer, btn('Send RFQ', { op: 'send', cls: 'btn-primary', icon: 'send' }))}
    </div>`;
  }
  function rfqTracker(ctx, p, a) {
    const { state } = ctx;
    const rfqs = p.rfqs || [];
    const pending = rfqs.filter(r => r.status === 'Sent' || r.status === 'Waiting');
    const got = rfqs.filter(r => r.status === 'Received');
    const closed = rfqs.filter(r => r.status === 'Expired' || r.status === 'Cancelled');
    const respTime = r => {
      if (r.responseDate) { const d = (r.responseDate - r.rfqDate) / U.DAY; return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${Math.round(d * 10) / 10} days`; }
      if (r.status === 'Sent' || r.status === 'Waiting') return `<span class="muted">pending ${esc(fmt.days(U.ageDays(r.rfqDate)))}</span>`;
      return dash;
    };
    const rows = rfqs.map(r => Object.assign({ vendor: vname(state, r.vendorId), fu: (r.followUps || []).length }, r));
    const table = ui.table([
      { key: 'vendor', label: 'Vendor', render: r => `<b>${esc(r.vendor)}</b><span class="sub mono">${esc(r.id)}</span><span class="af-m-only mt-4">${ui.status(state, 'rfq', r.status)} <span class="small">${(r.status === 'Sent' || r.status === 'Waiting') ? 'due ' + ui.due(r.dueDate) : ''}</span>${r.fu ? `<span class="small muted"> · ${r.fu} follow-up${r.fu === 1 ? '' : 's'}</span>` : ''}</span>` },
      { key: 'rfqDate', label: 'Sent', hideOnMobile: true, render: r => esc(fmt.dateShort(r.rfqDate)) },
      { key: 'dueDate', label: 'Due', hideOnMobile: true, render: r => (r.status === 'Sent' || r.status === 'Waiting') ? ui.due(r.dueDate) : esc(fmt.dateShort(r.dueDate)) },
      { key: 'status', label: 'Status', hideOnMobile: true, render: r => ui.status(state, 'rfq', r.status) },
      { key: 'responseDate', label: 'Response time', sort: r => r.responseDate ? r.responseDate - r.rfqDate : null, render: respTime, hideOnMobile: true },
      { key: 'fu', label: 'Follow-ups', align: 'right', hideOnMobile: true, render: r => r.fu ? `${r.fu}<span class="sub">last ${esc(fmt.dateShort(r.followUps[r.fu - 1].at))}</span>` : '<span class="muted">0</span>' },
      { key: 'act', label: 'Actions', sort: false, render: r => (r.status === 'Sent' || r.status === 'Waiting') ? `<div class="af-tbl-actions">
          ${btn('Received', { act: 'af-rfq-row', op: 'received', data: { rfq: r.id }, cls: 'btn-xs btn-success', title: 'Mark the vendor response as received' })}
          ${btn('Follow up', { act: 'af-rfq-row', op: 'followup', data: { rfq: r.id }, cls: 'btn-xs', title: 'Log a follow-up with the vendor' })}
          ${btn('Expire', { act: 'af-rfq-row', op: 'expire', data: { rfq: r.id }, cls: 'btn-xs btn-ghost', title: 'No response — expire this RFQ' })}
          ${btn('Cancel', { act: 'af-rfq-row', op: 'cancel', data: { rfq: r.id }, cls: 'btn-xs btn-ghost', title: 'Withdraw the RFQ from this vendor' })}</div>` : (r.status === 'Received' ? '<span class="af-note">quote to record</span>' : '') }
    ], rows, { key: 'af_rfq', sort: ctx.local.af_rfqSort, rowClass: r => r.status === 'Received' ? 'row-green' : (r.status === 'Sent' || r.status === 'Waiting') && r.dueDate && now() > r.dueDate ? 'row-red' : '' });
    const invitable = state.masters.vendors.filter(v => v.status === 'Active' && v.approved && (v.categoryIds || []).includes(p.categoryId) && !rfqs.some(r => r.vendorId === v.id && r.status !== 'Cancelled'));
    const invKey = 'af_inv_' + a.id;
    const waitingNote = pending.length
      ? ui.alert(a.status === 'Waiting' ? 'warn' : 'info', `<b>${a.status === 'Waiting' ? 'Waiting on vendors' : 'Responses pending'}</b> — ${pending.length} of ${rfqs.length} ${pending.length === 1 ? 'vendor has' : 'vendors have'} not responded (${esc(pending.map(r => vname(state, r.vendorId)).join(', '))}). Follow up, mark responses received, or expire non-responders.`, 'clock')
      : ui.alert('success', `<b>All vendors have answered or been closed.</b> Close the RFQ round to record the quotations.`);
    return `${figs([
        { label: 'Invited', value: String(rfqs.length) },
        { label: 'Received', value: String(got.length), cls: got.length ? 'good' : '' },
        { label: 'Pending', value: String(pending.length), cls: pending.length ? 'warn' : '' },
        { label: 'Expired / cancelled', value: String(closed.length) }
      ])}
      ${waitingNote}
      <div>${sec('RFQ tracker', 'rfq')}${table}</div>
      ${formOpen(null, {})}
        ${invitable.length ? `<div class="row wrap">${toggleBtn(ctx, invKey, 'Invite another vendor', { icon: 'plus' })}</div>
        <div ${togAttr(ctx, invKey)}><div class="af-box tint mt-8"><div class="form-grid">
          ${fld(a, { name: 'inviteVendor', label: 'Vendor', type: 'select', options: invitable.map(v => ({ value: v.id, label: `${v.name} · ★ ${v.rating}` })), placeholder: 'Select…' })}
          ${fld(a, { name: 'inviteDue', label: 'Response due', type: 'date', value: U.addDays(now(), 3, true), min: now() })}
        </div>${bar(btn('Send RFQ', { op: 'invite', icon: 'send', cls: 'btn-sm' }))}</div></div>` : ''}
        ${bar(spacer, btn(`Close RFQ round${got.length ? ` (${got.length} received)` : ''}`, { op: 'complete', cls: 'btn-primary', icon: 'check', disabled: !got.length, title: got.length ? '' : 'At least one vendor response must be received' }))}
      </div>`;
  }

  /* ---------- quotation ---------- */
  R.quotation = (ctx, p, a) => {
    const { state } = ctx;
    const valid = validQuotes(p);
    const vendors = U.uniq((p.rfqs || []).filter(r => r.status === 'Received').map(r => r.vendorId).concat(valid.map(q => q.vendorId)));
    const notResp = (p.rfqs || []).filter(r => !vendors.includes(r.vendorId));
    const rank = ranked(p);
    const single = !!(p.flags && p.flags.singleSource);
    const min = single ? 1 : (E.rule(state, 'R03') ? Number(E.ruleParam(state, 'R03', 'minQuotes', 3)) || 3 : 1);
    const f = p.flags || {};
    const blocks = vendors.map(vid => {
      const q = valid.find(x => x.vendorId === vid);
      const r = (p.rfqs || []).find(x => x.vendorId === vid);
      const v = E.vendor(state, vid) || {};
      const key = 'af_q_' + a.id + '_' + vid;
      const open = q ? !!ctx.local[key] : true;
      const amt = q ? q.amount : '';
      const tax = q ? q.taxPct : 18;
      const tAmt = Math.round((Number(amt) || 0) * (Number(tax) || 0) / 100);
      const rk = q ? (rank.find(x => x.id === q.id) || {}).rank : null;
      return `<div class="af-qv">
        <div class="af-qv-head">
          <b>${esc(v.name || vid)}</b>${rk ? rankBadge(rk) : ''}
          <span class="af-note">${r ? `${esc(r.id)} · ${r.responseDate ? 'received ' + esc(fmt.dateShort(r.responseDate)) : esc(r.status)}` : 'direct quotation'}</span>
          <span class="grow"></span>
          ${q ? `${ui.badge(`Recorded · ${fmt.inr(q.total)}`, 'green')} ${toggleBtn(ctx, key, 'Edit', { icon: 'edit', cls: 'btn-xs btn-ghost' })}` : ui.badge('Not recorded', 'grey')}
        </div>
        <div data-toggle="${esc(key)}" class="${open ? '' : 'af-hidden'}">
          ${formOpen('quote', {}, 'af-qv-body')}
            <input type="hidden" name="vendorId" value="${esc(vid)}">
            <div class="form-grid cols-3">
              ${fld(a, { sfx: vid, name: 'amount', label: 'Basic amount (excl. tax)', type: 'money', value: amt, required: true })}
              ${fld(a, { sfx: vid, name: 'taxPct', label: 'GST %', type: 'number', value: tax, min: 0, max: 40 })}
              <div class="field"><label>Total (incl. tax)</label><div class="af-figs"><div class="hl"><span>Tax <span data-out="tax">${esc(fmt.inr(tAmt))}</span></span><b data-out="total">${esc(fmt.inr((Number(amt) || 0) + tAmt))}</b></div></div></div>
              ${fld(a, { sfx: vid, name: 'deliveryDays', label: 'Delivery (days)', type: 'number', value: q ? q.deliveryDays : '', min: 0 })}
              ${fld(a, { sfx: vid, name: 'validityDays', label: 'Validity (days)', type: 'number', value: q ? q.validityDays : 30, min: 1 })}
              ${fld(a, { sfx: vid, name: 'specCompliance', label: 'Meets specification?', type: 'select', value: q ? q.specCompliance : 'Yes', options: SPEC })}
              ${fld(a, { sfx: vid, name: 'paymentTerms', label: 'Payment terms', value: q ? q.paymentTerms : (f.advanceRequired ? `${f.advancePct || 0}% advance, balance 30 days` : '30 days from invoice') })}
              ${fld(a, { sfx: vid, name: 'warranty', label: 'Warranty', value: q ? q.warranty : '' , placeholder: 'e.g. 12 months' })}
              ${fld(a, { sfx: vid, name: 'commercialTerms', label: 'Commercial terms', value: q ? q.commercialTerms : '', placeholder: 'Freight, installation, GST…' })}
              ${fld(a, { sfx: vid, name: 'fileName', label: 'Quotation document', type: 'file', value: q ? q.fileName : '', sample: `Quotation_${short(v.name)}_${p.id}.pdf`, full: true })}
            </div>
            ${bar(q ? btn('Withdraw', { op: 'remove', cls: 'btn-sm btn-outline-danger', icon: 'trash', data: { qid: q.id } }) : '', spacer, btn(q ? 'Update quotation' : 'Save quotation', { op: 'save', cls: 'btn-sm btn-primary', icon: 'check' }))}
          </div>
        </div>
      </div>`;
    }).join('');
    const tbl = rank.length ? ui.table([
      { key: 'rank', label: 'Rank', sort: r => r.total, render: r => rankBadge(r.rank) },
      { key: 'vendor', label: 'Vendor', sort: r => vname(state, r.vendorId), render: r => `<b>${esc(vname(state, r.vendorId))}</b>${r.fileName ? `<span class="sub">${I('file', 11)} ${esc(r.fileName)}</span>` : ''}` },
      { key: 'amount', label: 'Basic', align: 'right', render: r => esc(fmt.inr(r.amount)) },
      { key: 'tax', label: 'Tax', align: 'right', hideOnMobile: true, render: r => `${esc(fmt.inr(r.tax))}<span class="sub">${esc(pct(r.taxPct))}</span>` },
      { key: 'total', label: 'Total', align: 'right', render: r => `<b>${esc(fmt.inr(r.total))}</b>` },
      { key: 'deliveryDays', label: 'Delivery', align: 'right', render: r => `${esc(String(r.deliveryDays || 0))} d` },
      { key: 'specCompliance', label: 'Spec', render: r => specBadge(r.specCompliance) }
    ], rank, { key: 'af_qt', sort: ctx.local.af_qtSort, dense: true, rowClass: r => r.rank === 'L1' ? 'row-green' : '' }) : '';
    return `${!single && valid.length < min ? ui.alert('warn', `<b>Rule R03:</b> ${min} quotations are required for comparison — ${valid.length} recorded so far.`) : ''}
      ${blocks || ui.empty('rfq', 'No vendor responses yet', 'Responses marked “received” in the RFQ step appear here.')}
      ${notResp.length ? `<p class="af-note">${I('info', 13)} No quotation from: ${esc(notResp.map(r => `${vname(state, r.vendorId)} (${r.status})`).join(', '))}</p>` : ''}
      ${tbl ? `<div>${sec('Quotation register', 'layers', `${valid.length} valid · ranked by total`)}${tbl}</div>` : ''}
      ${formOpen(null, {})}${bar(spacer, btn(`Complete — ${valid.length} quotation${valid.length === 1 ? '' : 's'} recorded`, { op: 'complete', cls: 'btn-primary', icon: 'check', disabled: !valid.length }))}</div>`;
  };

  /* ---------- comparison ---------- */
  R.comparison = (ctx, p, a) => {
    const { state } = ctx;
    const rank = ranked(p);
    const valid = rank.length;
    const single = !!(p.flags && p.flags.singleSource);
    const min = single ? 1 : Number(E.ruleParam(state, 'R03', 'minQuotes', 1));
    const blocked = !!E.rule(state, 'R03') && valid < min;
    const l1 = rank[0];
    const rec = (p.comparison && p.comparison.recommendedVendorId) || (l1 && l1.vendorId) || '';
    const table = ui.table([
      { key: 'rank', label: 'Rank', sort: r => r.total, render: r => rankBadge(r.rank) },
      { key: 'vendor', label: 'Vendor', sort: r => vname(state, r.vendorId), render: r => `<b>${esc(vname(state, r.vendorId))}</b>` },
      { key: 'amount', label: 'Price', align: 'right', render: r => esc(fmt.inr(r.amount)) },
      { key: 'tax', label: 'Tax', align: 'right', render: r => `${esc(fmt.inr(r.tax))}<span class="sub">${esc(pct(r.taxPct))}</span>` },
      { key: 'total', label: 'Total', align: 'right', render: r => `<b>${esc(fmt.inr(r.total))}</b>${l1 && r.rank !== 'L1' ? `<span class="sub" style="color:var(--red)">+${esc(fmt.inr(r.total - l1.total))} (${Math.round((r.total - l1.total) / l1.total * 1000) / 10}%)</span>` : '<span class="sub" style="color:var(--green)">lowest</span>'}` },
      { key: 'specCompliance', label: 'Specification', render: r => specBadge(r.specCompliance) },
      { key: 'deliveryDays', label: 'Delivery', align: 'right', render: r => `${esc(String(r.deliveryDays || 0))} days` },
      { key: 'warranty', label: 'Warranty', render: r => esc(r.warranty || '—') },
      { key: 'paymentTerms', label: 'Payment terms', render: r => `<span class="small">${esc(r.paymentTerms || '—')}</span>` },
      { key: 'commercialTerms', label: 'Commercial terms', hideOnMobile: true, render: r => `<span class="small">${esc(r.commercialTerms || '—')}</span>` }
    ], rank, { key: 'af_cmp', sort: ctx.local.af_cmpSort, rowClass: r => r.rank === 'L1' ? 'row-green' : '', empty: 'No valid quotations.' });
    const te = E.context(state, p).techEval;
    return `${blocked ? ui.alert('danger', `<b>Rule R03 — ${min} quotations required, ${valid} received. Comparison is blocked.</b> Obtain the missing quotation${min - valid > 1 ? 's' : ''}; if a vendor cannot quote, raise an exception for the Procurement Lead.`) : ''}
      <div>${sec('Comparison statement', 'layers', `${valid} quotation${valid === 1 ? '' : 's'} · L1 highlighted`)}${table}</div>
      ${formOpen('compare', { l1: l1 ? l1.vendorId : '', single: single ? 1 : 0 })}
        <div class="form-grid">
          ${fld(a, { name: 'recommendedVendorId', label: 'Recommended vendor', type: 'select', value: rec, options: rank.map(r => ({ value: r.vendorId, label: `${r.rank} · ${vname(state, r.vendorId)} · ${fmt.inr(r.total)}` })), required: true })}
          <div class="field"><label>Next</label><div class="af-note" style="padding-top:8px">${te ? `${I('shield', 13)} Technical evaluation follows (category requires it).` : `${I('arrowRight', 13)} Vendor selection follows.`}</div></div>
          ${fld(a, { name: 'justification', label: single ? 'Single-source justification' : 'Justification', type: 'textarea', rows: 3, full: true, value: (p.comparison && p.comparison.justification) || '', placeholder: single ? 'Why only this vendor can supply; how the price was benchmarked.' : 'Why this vendor is recommended (required when not L1).' })}
        </div>
        <div data-show="justreq" class="mt-8 ${single || (l1 && rec !== l1.vendorId) ? '' : 'af-hidden'}">${ui.alert('warn', single ? '<b>Single source:</b> a justification is mandatory.' : '<b>Not the L1 vendor:</b> a justification is mandatory, and the selection will need Department Head approval (Rule R11).')}</div>
        ${bar(spacer, btn('Submit comparison & recommend', { op: 'complete', cls: 'btn-primary', icon: 'check', soft: blocked, title: blocked ? 'Rule R03 blocks the comparison' : '' }))}
      </div>`;
  };

  /* ---------- technical evaluation ---------- */
  R.tech_eval = (ctx, p, a) => {
    const { state } = ctx;
    const vid = p.comparison && p.comparison.recommendedVendorId;
    const q = validQuotes(p).find(x => x.vendorId === vid) || {};
    const owner = (p.activities.find(x => x.actionType === 'comparison') || {}).ownerUserId;
    const crit = a.checklist || [];
    return `<div class="af-box">${sec('Offer under evaluation', 'shield', esc(vname(state, vid)))}
        ${figs([
          { label: 'Vendor', value: esc(vname(state, vid)), cls: 'hl' },
          { label: 'Quoted total', value: money(q.total) },
          { label: 'Delivery', value: `${esc(String(q.deliveryDays || 0))} days` },
          { label: 'Warranty', value: esc(q.warranty || '—') },
          { label: 'Spec compliance', value: specBadge(q.specCompliance) }
        ])}
        ${p.specification ? `<div class="mt-12">${kv([['Required specification', qt(p.specification)], q.fileName ? ['Quotation', `${I('file', 13)} ${esc(q.fileName)}`] : null])}</div>` : ''}
      </div>
      ${formOpen('tech', { n: crit.length })}
        ${sec('Evaluation criteria', 'check', 'mark each criterion')}
        <div>${crit.map((c, i) => `<div class="af-crit"><b>${esc(c)}</b>
          <div class="af-yn" role="radiogroup" aria-label="${esc(c)}"><label><input type="radio" name="c.${i}.ok" value="1" checked><span class="y">✓ Approved</span></label><label><input type="radio" name="c.${i}.ok" value="0"><span class="n">✕ Not approved</span></label></div>
          <div class="af-crit-r"><input class="input" type="text" name="c.${i}.remark" id="${fid(a, 'remark', i)}" placeholder="Remark (optional)"></div></div>`).join('')}</div>
        <div class="mt-12" data-out="result">${ui.alert('success', '<b>Overall: technically acceptable.</b> The purchase moves on to vendor selection.')}</div>
        <div class="form-grid cols-1 mt-12">${fld(a, { name: 'remarks', label: 'Evaluation remarks', type: 'textarea', rows: 2, full: true, placeholder: 'Summary of the evaluation for the file.' })}</div>
        <p class="af-note mt-8">Any criterion marked “Not approved” returns the purchase to Quotation Comparison (${esc(uname(state, owner))}) for a new recommendation.</p>
        ${bar(spacer, btn('Submit evaluation', { op: 'complete', cls: 'btn-primary', icon: 'check' }))}
      </div>`;
  };

  /* ---------- vendor selection ---------- */
  R.selection = (ctx, p, a) => {
    const { state } = ctx;
    const rank = ranked(p);
    const l1 = rank[0] || {};
    const cmp = p.comparison || {};
    const def = (p.selection && p.selection.vendorId) || cmp.recommendedVendorId || l1.vendorId;
    const head = E.resolveOwner(state, p, 'dept_head');
    const r11 = !!E.rule(state, 'R11');
    return `<div class="af-box tint">${kv([
        ['Recommendation', `<b>${esc(vname(state, cmp.recommendedVendorId))}</b>${cmp.recommendedVendorId === l1.vendorId ? ' ' + rankBadge('L1') : ''}${cmp.by ? ` <span class="muted small">by ${esc(uname(state, cmp.by))}</span>` : ''}`],
        cmp.justification ? ['Justification', qt(cmp.justification)] : null,
        p.techEval ? ['Technical evaluation', `${ui.badge(p.techEval.result, p.techEval.result === 'Approved' ? 'green' : 'red')}${p.techEval.by ? ` <span class="muted small">${esc(uname(state, p.techEval.by))}</span>` : ''}`] : null
      ])}</div>
      ${formOpen('select', { l1: l1.vendorId || '', r11: r11 ? 1 : 0 })}
        ${sec('Choose the vendor', 'vendor')}
        <div class="choice-cards af-vchoice">${rank.map(r => `<label class="choice ${r.vendorId === def ? 'active' : ''}"><input type="radio" name="vendorId" value="${esc(r.vendorId)}" ${r.vendorId === def ? 'checked' : ''}><b>${rankBadge(r.rank)}${esc(vname(state, r.vendorId))}</b><small>${esc(fmt.inr(r.total))} · ${esc(String(r.deliveryDays || 0))} days · spec ${esc(r.specCompliance || 'Yes')}</small></label>`).join('')}</div>
        <div data-show="r11" class="mt-12 ${def && def !== l1.vendorId ? '' : 'af-hidden'}">
          ${ui.alert('warn', `<b>Rule R11 — the lowest-price (L1) vendor is not selected.</b> A justification is required and <b>${esc(uname(state, head))}</b> (Department Head) must approve the selection before the PO.`)}
          <div class="form-grid cols-1 mt-12">${fld(a, { name: 'reason', label: 'Selection justification', type: 'textarea', rows: 3, full: true, required: true, value: (p.selection && p.selection.reason) || cmp.justification || '', placeholder: 'e.g. L1 failed previous site audit; L2 delivers 7 days earlier.' })}</div>
        </div>
        ${bar(spacer, btn('Confirm vendor selection', { op: 'complete', cls: 'btn-primary', icon: 'check' }))}
      </div>`;
  };

  /* ---------- non-L1 selection approval ---------- */
  R.selection_approval = (ctx, p, a) => {
    const { state } = ctx;
    const sel = p.selection || {};
    const rank = ranked(p);
    const l1 = rank[0] || {};
    const s = rank.find(r => r.vendorId === sel.vendorId) || {};
    const diff = (s.total || 0) - (l1.total || 0);
    const summary = `${figs([
        { label: 'Selected vendor', value: esc(vname(state, sel.vendorId)), sub: `${esc(s.rank || '')} · ${esc(fmt.inr(s.total))}`, cls: 'hl' },
        { label: 'Lowest (L1)', value: esc(vname(state, l1.vendorId)), sub: esc(fmt.inr(l1.total)) },
        { label: 'Extra cost', value: esc(fmt.inr(diff)), cls: diff > 0 ? 'warn' : '', sub: l1.total ? `${Math.round(diff / l1.total * 1000) / 10}% above L1` : '' },
        { label: 'Selected by', value: esc(uname(state, sel.by)), sub: sel.at ? esc(fmt.dateShort(sel.at)) : '' }
      ])}
      <div class="af-box mt-12">${kv([['Reason (Rule R11)', qt(sel.reason)], ['Delivery', `${esc(String(s.deliveryDays || 0))} days vs L1 ${esc(String(l1.deliveryDays || 0))} days`], ['Spec compliance', `${specBadge(s.specCompliance)} vs L1 ${specBadge(l1.specCompliance)}`], ['Purchase', `${esc(p.title)} · est. ${esc(fmt.inr(p.estValue))}`]])}</div>`;
    return decisionPanel(ctx, p, a, { summary, ops: ['approve', 'return'], approveLabel: 'Approve selection', returnLabel: 'Return to buyer' });
  };

  /* ---------- PO create ---------- */
  R.po_create = (ctx, p, a) => {
    const { state } = ctx;
    const q = selectedQuote(p) || {};
    const po = p.po;
    const vid = (p.selection || {}).vendorId || q.vendorId;
    const v = E.vendor(state, vid) || {};
    const qty = po ? po.qty : (p.qty || 1);
    const unit = po ? po.unitPrice : (q.amount ? Math.round(q.amount / (p.qty || 1) * 100) / 100 : Math.round(p.estValue / qty * 100) / 100);
    const tax = po ? po.taxPct : (q.taxPct != null ? q.taxPct : 18);
    const basic = Math.round(qty * unit);
    const taxAmt = Math.round(basic * tax / 100);
    const agreement = !!E.context(state, p).agreementRequired;
    const d9 = doc(p, 'D09');
    return `<div class="af-box tint">${sec('Selected vendor & quotation', 'vendor', q.id ? esc(q.id) : '')}${figs([
        { label: 'Vendor', value: esc(v.name || '—'), sub: `${esc(v.gstin || '')}${v.bank ? ' · ' + esc(v.bank) : ''}` },
        { label: 'Quotation total', value: money(q.total), sub: q.id ? `${esc((ranked(p).find(r => r.id === q.id) || {}).rank || '')}${p.selection && !p.selection.lowestSelected ? ' · non-L1 (approved)' : ' · lowest price'}` : '' },
        { label: 'Estimated value', value: money(p.estValue) }
      ])}</div>
      ${formOpen('po', { quote: q.total || 0, est: p.estValue || 0 })}
        ${sec(po ? `Revise ${po.number}` : 'PO terms', 'po', 'prefilled from the selected quotation')}
        <div class="form-grid cols-3">
          ${fld(a, { name: 'qty', label: `Quantity (${p.uom || 'Nos'})`, type: 'number', value: qty, min: 0, required: true })}
          ${fld(a, { name: 'unitPrice', label: 'Unit price', type: 'money', value: unit, step: 'any', required: true })}
          ${fld(a, { name: 'taxPct', label: 'GST %', type: 'number', value: tax, min: 0, max: 40 })}
          ${fld(a, { name: 'deliveryDays', label: 'Delivery (days)', type: 'number', value: po ? po.deliveryDays : (q.deliveryDays || 15), min: 0 })}
          ${fld(a, { name: 'validityDays', label: 'PO validity (days)', type: 'number', value: po ? po.validityDays : 30, min: 1 })}
          ${fld(a, { name: 'warranty', label: 'Warranty', value: po ? po.warranty : (q.warranty || '') })}
          ${fld(a, { name: 'paymentTerms', label: 'Payment terms', value: po ? po.paymentTerms : (q.paymentTerms || '30 days from invoice'), full: true })}
        </div>
        <div class="mt-12">${figs([
          { label: 'Basic', value: esc(fmt.inr(basic)), out: 'basic' },
          { label: 'Tax', value: esc(fmt.inr(taxAmt)), out: 'tax' },
          { label: 'PO total', value: esc(fmt.inr(basic + taxAmt)), out: 'total', cls: 'dark', sub: q.total ? 'matches quotation' : '', subOut: 'diff' }
        ])}</div>
        ${agreement ? `<div class="af-box tint mt-12">${sec('Agreement / contract (mandatory for this category)', 'file', docBadge(state, d9))}
          ${docOk(d9) ? `<p class="af-note">${I('checkCircle', 13)} On file: <b>${esc(d9.fileName || '')}</b></p>` : fld(a, { name: 'agreementFileName', label: 'Signed agreement', type: 'file', sample: `Agreement_${p.id}.pdf`, full: true, hint: 'Rule R07 — the PO stage cannot be completed without it.' })}</div>` : ''}
        <div class="mt-12">${checks('checklist', a.checklist || [], allFalse(a.checklist || []), { title: 'PO verification', gate: true })}</div>
        ${bar(spacer, btn(po ? 'Update PO & send for approval' : 'Create PO & send for approval', { op: 'create', cls: 'btn-primary', icon: 'po' }))}
      </div>`;
  };

  /* ---------- PO approve ---------- */
  R.po_approve = (ctx, p, a) => {
    const { state, user } = ctx;
    const po = p.po || {};
    const q = selectedQuote(p) || {};
    const sod = user && po.createdBy === user.id;
    const agreement = !!E.context(state, p).agreementRequired;
    const summary = `${sod ? ui.alert('danger', '<b>Segregation of duties:</b> you created this PO and cannot approve it. Ask the Procurement Lead or reassign.') : ''}
      ${poBox(ctx, p)}
      <div class="af-box mt-12">${kv([
        ['Selected quotation', q.total ? `${esc(fmt.inr(q.total))}${po.total !== q.total ? ` <span style="color:${po.total > q.total ? 'var(--red)' : 'var(--green)'}">(${po.total > q.total ? '+' : ''}${esc(fmt.inr(po.total - q.total))} vs PO)</span>` : ' <span class="muted">· PO matches quotation</span>'}` : '—'],
        ['Estimate', `${esc(fmt.inr(p.estValue))}${po.total > p.estValue ? ` <span style="color:var(--red)">· PO exceeds estimate by ${esc(fmt.inr(po.total - p.estValue))}</span>` : ''}`],
        ['Vendor selection', p.selection ? `${p.selection.lowestSelected ? rankBadge('L1') + ' lowest price' : 'Non-L1 · ' + qt(p.selection.reason)}` : '—'],
        agreement ? ['Agreement', docBadge(state, doc(p, 'D09'))] : null,
        ['Created by', `${esc(uname(state, po.createdBy))} · ${esc(fmt.dateTime(po.createdAt))}`]
      ])}</div>`;
    return decisionPanel(ctx, p, a, { summary, ops: ['approve', 'return'], approveLabel: 'Approve PO', returnLabel: 'Return to buyer', softApprove: sod, softTitle: 'You created this PO' });
  };

  /* ---------- PO send / vendor acceptance ---------- */
  R.po_send = (ctx, p, a) => {
    const { state } = ctx;
    const po = p.po || {};
    const v = E.vendor(state, po.vendorId) || {};
    if (po.status !== 'Sent') {
      return `${poBox(ctx, p, 'Approved purchase order')}
        ${formOpen(null, {})}
          <p class="af-lead">${I('send', 14)} The PO is e-mailed to <b>${esc(v.name || '')}</b>${v.contact ? ` (${esc(v.contact)})` : ''}. The step then waits for the vendor’s acceptance; delivery is due ${esc(String(po.deliveryDays || 0))} days after acceptance.</p>
          ${bar(spacer, btn(`Send ${po.number || 'PO'} to vendor`, { op: 'send', cls: 'btn-primary', icon: 'send' }))}
        </div>`;
    }
    return `${ui.alert('warn', `<b>Waiting on vendor</b> — ${esc(po.number)} was sent to ${esc(v.name || '')} on ${esc(fmt.dateTime(po.sentAt))} (${esc(fmt.ago(po.sentAt))}). Record the acceptance once the vendor confirms.`, 'clock')}
      ${poBox(ctx, p)}
      ${formOpen('posend', { days: po.deliveryDays || 0 })}
        <div class="form-grid">
          ${fld(a, { name: 'date', label: 'Vendor accepted on', type: 'date', value: now(), required: true })}
          <div class="field"><label>Expected delivery</label><div class="af-figs"><div class="hl"><span>Acceptance + ${esc(String(po.deliveryDays || 0))} days</span><b data-out="exp">${esc(fmt.date(U.addDays(now(), po.deliveryDays || 0, false)))}</b></div></div></div>
        </div>
        ${bar(spacer, btn('Record vendor acceptance', { op: 'accept', cls: 'btn-success', icon: 'check' }))}
      </div>`;
  };

  /* ---------- advance request ---------- */
  function advBand(state, pctV) {
    return U.sortBy((state.masters.advanceApproval || []).filter(b => b.status === 'Active'), b => b.maxPct).find(b => pctV <= b.maxPct) || null;
  }
  function bandText(state, p, pctV) {
    const b = advBand(state, pctV);
    if (!b) return '<span class="muted">No band — Finance approves</span>';
    const role = E.role(state, b.approverRole) || {};
    return `<b>${esc(b.name)}</b> → ${esc(role.name || b.approverRole)} · <b>${esc(uname(state, E.resolveOwner(state, p, b.approverRole)))}</b>`;
  }
  R.advance_request = (ctx, p, a) => {
    const { state } = ctx;
    const po = p.po || {};
    const f = p.flags || {};
    const pctV = Number(f.advancePct) || 0;
    const amount = Math.round((po.total || 0) * pctV / 100);
    const sr1 = U.byId(state.masters.settlementRules, 'SR-1');
    const days = (sr1 && sr1.status === 'Active' && sr1.params && sr1.params.settlementDays) || 30;
    const exposure = E.vendorOutstanding(state, po.vendorId);
    const d12 = doc(p, 'D12');
    const bands = U.sortBy((state.masters.advanceApproval || []).filter(b => b.status === 'Active'), b => b.maxPct);
    return `${figs([
        { label: 'PO', value: esc(po.number || '—'), sub: esc(vname(state, po.vendorId)) },
        { label: 'PO total', value: money(po.total) },
        { label: 'Payment terms', value: `<span style="font-size:13px">${esc(po.paymentTerms || '—')}</span>` },
        { label: 'Vendor exposure', value: esc(fmt.inr(exposure)), cls: exposure > 0 ? 'warn' : '', sub: exposure > 0 ? 'other advances outstanding' : 'no open advances' }
      ])}
      ${formOpen('advance', { total: po.total || 0, pid: p.id })}
        <div class="form-grid">
          ${fld(a, { name: 'typeId', label: 'Advance type', type: 'select', value: f.advanceTypeId || 'ADT-PART', options: opts(state.masters.advanceTypes.filter(t => t.status === 'Active')), required: true })}
          ${fld(a, { name: 'pct', label: 'Advance % of PO', type: 'number', value: pctV || '', min: 1, max: 100, required: true })}
          <div class="field"><label>Advance amount</label><div class="af-figs"><div class="dark"><span>Calculated</span><b data-out="amount">${esc(fmt.inr(amount))}</b></div></div></div>
          ${fld(a, { name: 'amount', label: 'Override amount (optional)', type: 'money', placeholder: 'Leave blank to use %', hint: 'e.g. a rounded figure agreed with the vendor.' })}
          ${fld(a, { name: 'settlementDays', label: 'Settlement period (days)', type: 'number', value: days, min: 1, hint: 'Settlement Rule SR-1 — adjust within N days of payment.' })}
          ${docOk(d12) ? `<div class="field"><label>Proforma invoice</label><div class="af-note" style="padding-top:8px">${I('checkCircle', 13)} On file: <b>${esc(d12.fileName || '')}</b></div></div>` : fld(a, { name: 'proformaFileName', label: 'Proforma invoice', type: 'file', required: true, sample: `Proforma_${p.id}.pdf` })}
          ${fld(a, { name: 'justification', label: 'Business justification', type: 'textarea', rows: 2, full: true, required: true, placeholder: 'Why the vendor needs an advance (material procurement, mobilisation…)' })}
        </div>
        <div class="af-box tint mt-12"><div class="row between wrap"><span class="overline">Approver for this advance</span><span class="af-note">Advance Approval Master</span></div>
          <div class="mt-4" data-out="band">${bandText(state, p, pctV)}</div>
          <div class="af-legend">${bands.map(b => `<span>${esc(b.name)} → ${esc((E.role(state, b.approverRole) || {}).name || b.approverRole)}</span>`).join('')}</div>
        </div>
        ${bar(spacer, btn('Submit advance request', { op: 'submit', cls: 'btn-primary', icon: 'send' }))}
      </div>`;
  };

  /* ---------- advance approve ---------- */
  R.advance_approve = (ctx, p, a) => {
    const { state, user } = ctx;
    const adv = lastAdvance(state, p);
    if (!adv) return ui.alert('danger', 'No advance request found for this purchase.');
    const po = p.po || {};
    const type = U.byId(state.masters.advanceTypes, adv.typeId) || {};
    const b = advBand(state, adv.pct);
    const exposure = E.vendorOutstanding(state, adv.vendorId);
    const sod = user && adv.requestedBy === user.id;
    const summary = `${sod ? ui.alert('danger', '<b>Segregation of duties:</b> you requested this advance and cannot approve it.') : ''}
      ${figs([
        { label: 'Advance', value: money(adv.amount), cls: 'hl', sub: `${esc(pct(adv.pct))} of PO` },
        { label: 'PO total', value: money(po.total), sub: esc(po.number || '') },
        { label: 'Type', value: esc(type.name || adv.typeId) },
        { label: 'Settle within', value: `${esc(String(adv.settlementDays))} days`, sub: 'after payment (SR-1)' }
      ])}
      <div class="af-box mt-12">${kv([
        ['Advance ID', `<span class="mono">${esc(adv.id)}</span> ${ui.status(state, 'advance', adv.status)}`],
        ['Vendor', `${esc(vname(state, adv.vendorId))}${exposure > 0 ? ` <span style="color:var(--orange)">· already holds ${esc(fmt.inr(exposure))} in other advances</span>` : ' <span class="muted">· no other open advances</span>'}`],
        ['Justification', qt(adv.justification)],
        ['Requested by', `${esc(uname(state, adv.requestedBy))} · ${esc(fmt.dateTime(adv.requestedAt))}`],
        ['Proforma invoice', docBadge(state, doc(p, 'D12'))],
        ['Approval band', b ? `<b>${esc(b.name)}</b> → ${esc((E.role(state, b.approverRole) || {}).name || b.approverRole)}` : '—']
      ])}</div>`;
    return decisionPanel(ctx, p, a, { summary, ops: ['approve', 'return', 'reject'], approveLabel: `Approve ${fmt.inr(adv.amount)} advance`, returnLabel: 'Return to buyer', rejectLabel: 'Reject advance', softApprove: sod });
  };

  /* ---------- advance verify ---------- */
  R.advance_verify = (ctx, p, a) => {
    const { state } = ctx;
    const adv = lastAdvance(state, p);
    if (!adv) return ui.alert('danger', 'No advance found for this purchase.');
    const po = p.po || {};
    const v = E.vendor(state, adv.vendorId) || {};
    const appr = (po.history || []).find(h => h.status === 'Approved');
    const d12 = doc(p, 'D12');
    const ev = {
      'PO approved': { ok: !!appr, detail: appr ? `${po.number} approved by ${uname(state, appr.by)} · ${fmt.dateShort(appr.at)} (now ${po.status})` : `${po.number || 'PO'} not approved` },
      'Vendor validated': { ok: !!(v.approved && v.status === 'Active' && v.gstin && v.pan), detail: `${v.approved ? 'Approved vendor' : 'Vendor not approved'} · GSTIN ${v.gstin || 'missing'} · PAN ${v.pan || 'missing'}` },
      'Proforma invoice': { ok: docOk(d12), detail: d12 ? `${d12.status}${d12.fileName ? ' · ' + d12.fileName : ''}` : 'Missing' },
      'Bank details verified': { ok: !!v.bank, detail: v.bank ? `Beneficiary bank ${v.bank}` : 'No bank details in Vendor Master' },
      'Approval completed': { ok: !!(adv.approval && adv.approval.status === 'Approved'), detail: adv.approval ? `${adv.approval.status} by ${uname(state, adv.approval.by)} · ${fmt.dateShort(adv.approval.at)}` : 'Not approved' }
    };
    const items = (a.checklist || []).map(c => Object.assign({ label: c }, ev[c] || { ok: true, detail: null }));
    const blocked = a.status === 'Blocked';
    const holdKey = 'af_hold_' + a.id;
    return `${blocked ? `${ui.alert('warn', `<b>On hold:</b> ${esc(a.blocker || '')}`, 'pause')}${formOpen(null, {})}${bar(btn('Resume verification', { op: 'resume', cls: 'btn-sm', icon: 'play' }))}</div>` : ''}
      ${figs([
        { label: 'Advance', value: money(adv.amount), cls: 'hl', sub: `${esc(adv.id)} · ${esc(pct(adv.pct))}` },
        { label: 'Vendor', value: esc(v.name || ''), sub: esc(v.bank || '') },
        { label: 'Approved by', value: esc(adv.approval ? uname(state, adv.approval.by) : '—') }
      ])}
      ${formOpen(null, {})}
        ${checks('checklist', items, null, { title: 'Verification — evidence from the purchase file', one: true })}
        <div class="form-grid cols-1 mt-12">${fld(a, { name: 'remarks', label: 'Remarks', type: 'textarea', rows: 2, full: true })}</div>
        ${bar(blocked ? '' : toggleBtn(ctx, holdKey, 'Put on hold', { icon: 'pause', cls: 'btn-sm btn-warn' }), spacer, btn('Verify advance', { op: 'verify', cls: 'btn-primary', icon: 'shield' }))}
      </div>
      ${blocked ? '' : `<div ${togAttr(ctx, holdKey)}>${formOpen(null, {}, 'af-box tint')}
        <div class="form-grid cols-1">${fld(a, { name: 'holdReason', label: 'Reason for hold', type: 'textarea', rows: 2, full: true, required: true, placeholder: 'e.g. Bank letter not on vendor letterhead' })}</div>
        ${bar(btn('Hold verification', { op: 'hold', cls: 'btn-warn', icon: 'pause' }))}
      </div></div>`}`;
  };

  /* ---------- advance pay ---------- */
  R.advance_pay = (ctx, p, a) => {
    const { state } = ctx;
    const adv = lastAdvance(state, p);
    if (!adv) return ui.alert('danger', 'No advance found for this purchase.');
    const v = E.vendor(state, adv.vendorId) || {};
    const settle = U.addDays(now(), adv.settlementDays || 30, false);
    return `${figs([
        { label: 'Advance payable', value: money(adv.amount), cls: 'dark', sub: `${esc(pct(adv.pct))} of ${esc((p.po || {}).number || 'PO')}` },
        { label: 'Beneficiary', value: esc(v.name || ''), sub: esc(v.bank || 'no bank on file') },
        { label: 'Approved / verified', value: esc(adv.approval ? uname(state, adv.approval.by) : '—'), sub: adv.verification ? `verified by ${esc(uname(state, adv.verification.by))}` : 'not verified' }
      ])}
      ${ui.alert('info', `<b>After payment this becomes an “Advance Outstanding” of ${esc(fmt.inr(adv.amount))}</b> — it is <b>not</b> closed. It must be adjusted against the vendor’s invoice (or recovered) within ${esc(String(adv.settlementDays))} days, i.e. by about <b>${esc(fmt.date(settle))}</b> (Settlement Rule SR-1).`)}
      ${formOpen(null, {})}
        <div class="form-grid">
          ${fld(a, { name: 'mode', label: 'Payment mode', type: 'select', value: 'RTGS', options: MODES })}
          ${fld(a, { name: 'bank', label: 'Paid from', type: 'select', value: BANKS[0], options: BANKS })}
          ${fld(a, { name: 'utr', label: 'UTR / bank reference', required: true, placeholder: 'e.g. HDFCR52026100612345' })}
          ${fld(a, { name: 'date', label: 'Payment date', type: 'date', value: now(), required: true })}
        </div>
        ${bar(spacer, btn(`Pay ${fmt.inr(adv.amount)} advance`, { op: 'pay', cls: 'btn-primary', icon: 'payment' }))}
      </div>`;
  };

  /* ---------- delivery / service ---------- */
  R.delivery = (ctx, p, a) => {
    const { state } = ctx;
    const svc = isSvc(state, p);
    const po = p.po || {};
    const delivered = U.sum(p.deliveries, d => d.qty);
    const balance = Math.max(0, (po.qty || 0) - delivered);
    const expected = po.expectedDelivery;
    const grace = Number(E.ruleParam(state, 'R10', 'graceDays', 0)) || 0;
    const d14 = doc(p, 'D14');
    const delayKey = 'af_delay_' + a.id;
    const delayEx = state.exceptions.find(e => e.purchaseId === p.id && e.type === 'Vendor delay' && (e.status === 'Open' || e.status === 'In Progress'));
    const prior = p.deliveries || [];
    const lateNow = expected && now() > expected;
    const tbl = prior.length ? ui.table([
      { key: 'date', label: 'Date', render: d => esc(fmt.date(d.date)) },
      { key: 'qty', label: 'Qty', align: 'right', render: d => esc(num(d.qty)) },
      { key: 'quality', label: 'Quality', render: d => ui.badge(d.quality, d.quality === 'OK' ? 'green' : 'orange', { dot: false }) },
      { key: 'note', label: svc ? 'Report' : 'Delivery note', render: d => `${esc(d.note || '—')}${d.fileName ? `<span class="sub">${esc(d.fileName)}</span>` : ''}` },
      { key: 'late', label: 'On time', render: d => d.late ? ui.badge(`Late ${d.delayDays}d`, 'red', { dot: false }) : ui.badge('On time', 'green', { dot: false }) }
    ], prior, { key: 'af_dlv', sort: ctx.local.af_dlvSort, dense: true }) : '';
    return `${a.status === 'Waiting' ? ui.alert('warn', `<b>Waiting on vendor</b> — ${esc(a.nextAction || 'balance delivery pending')}.`, 'clock') : ''}
      ${delayEx ? ui.alert('danger', `<b>Open exception:</b> ${esc(delayEx.title)} — ${esc(delayEx.description || '')}`) : ''}
      ${figs([
        { label: 'PO', value: esc(po.number || '—'), sub: esc(vname(state, po.vendorId)) },
        { label: 'Ordered', value: `${esc(num(po.qty))} ${esc(p.uom || '')}` },
        { label: svc ? 'Performed so far' : 'Delivered so far', value: esc(num(delivered)), sub: balance ? `${esc(num(balance))} balance` : 'complete' },
        { label: svc ? 'Service due' : 'Expected delivery', value: expected ? esc(fmt.date(expected)) : dash, sub: expected ? ui.due(expected) : null, cls: lateNow ? 'bad' : '' }
      ])}
      ${formOpen('delivery', { expected: expected || '', grace, balance })}
        ${sec(svc ? 'Record service performed' : 'Record delivery', svc ? 'check' : 'truck')}
        <div class="form-grid">
          ${fld(a, { name: 'actualDate', label: svc ? 'Service completed on' : 'Actual delivery date', type: 'date', value: now(), required: true })}
          ${fld(a, { name: 'qty', label: svc ? `Quantity performed (${p.uom || 'Job'})` : `Quantity delivered (${p.uom || 'Nos'})`, type: 'number', value: balance || po.qty || 1, min: 0, required: true })}
          ${fld(a, { name: 'quality', label: svc ? 'Service quality' : 'Quality on arrival', type: 'select', value: 'OK', options: [{ value: 'OK', label: 'OK' }, { value: 'Issues', label: 'Issues found' }] })}
          ${svc ? '' : fld(a, { name: 'rejection', label: 'Rejected at receipt (qty)', type: 'number', value: 0, min: 0 })}
          ${fld(a, { name: 'deliveryNote', label: svc ? 'Service report / job sheet no.' : 'Delivery note / challan no.', placeholder: svc ? 'e.g. JS-2041' : 'e.g. DC-10482' })}
          ${svc ? fld(a, { name: 'fileName', label: 'Service report (optional)', type: 'file', sample: `Service_Report_${p.id}.pdf` })
            : (docOk(d14) ? `<div class="field"><label>Delivery challan</label><div class="af-note" style="padding-top:8px">${I('checkCircle', 13)} On file: <b>${esc(d14.fileName || '')}</b> — attach the new challan if this is another lot.</div></div>` : fld(a, { name: 'fileName', label: 'Delivery challan', type: 'file', required: true, sample: `DC_${p.id}.pdf` }))}
          ${fld(a, { name: 'specOk', label: svc ? 'Service performed as per scope' : 'Material meets specification', type: 'checkbox', value: true })}
          ${fld(a, { name: 'partial', label: svc ? 'Partial — more work to follow' : 'Partial delivery — balance to follow', type: 'checkbox', value: false })}
          ${fld(a, { name: 'remarks', label: 'Remarks', type: 'textarea', rows: 2, full: true })}
        </div>
        <div data-show="late" class="mt-8 af-hidden">${ui.alert('warn', `<span data-out="late"></span>`)}</div>
        ${bar(toggleBtn(ctx, delayKey, 'Report a delay', { icon: 'clock', cls: 'btn-sm btn-warn' }), spacer, btn(svc ? 'Confirm service performed' : 'Record delivery', { op: 'record', cls: 'btn-primary', icon: svc ? 'check' : 'truck' }))}
      </div>
      <div ${togAttr(ctx, delayKey)}>${formOpen(null, {}, 'af-box tint')}
        ${sec('Vendor delay', 'clock', 'raises a vendor-delay exception')}
        <div class="form-grid">
          ${fld(a, { name: 'delayReason', label: 'Delay reason', type: 'textarea', rows: 2, full: true, required: true, placeholder: 'e.g. Imported parts held at customs' })}
          ${fld(a, { name: 'newDate', label: 'Revised expected date', type: 'date', value: expected && expected > now() ? expected : U.addDays(now(), 5, true), min: now() })}
        </div>
        ${bar(btn('Only update expected date', { op: 'update', cls: 'btn-sm btn-ghost', icon: 'calendar' }), spacer, btn('Report delay', { op: 'delay', cls: 'btn-warn', icon: 'alert' }))}
      </div></div>
      ${tbl ? `<div>${sec(svc ? 'Service records' : 'Deliveries', 'truck')}${tbl}</div>` : ''}`;
  };

  /* ---------- GRN / service confirmation ---------- */
  R.grn = (ctx, p, a) => {
    const { state } = ctx;
    const svc = isSvc(state, p);
    const po = p.po || {};
    const delivered = U.sum(p.deliveries, d => d.qty) || po.qty || 0;
    const grnd = U.sum(p.grns, g => g.qty);
    const recv = Math.max(0, delivered - grnd) || delivered;
    const rej = Math.min(recv, Math.max(0, U.sum(p.deliveries, d => d.rejection) - U.sum(p.grns, g => g.rejectedQty)));
    const last = (p.deliveries || []).slice(-1)[0];
    return `${figs([
        { label: 'PO', value: esc(po.number || '—'), sub: `${esc(num(po.qty))} ${esc(p.uom || '')} ordered` },
        { label: svc ? 'Performed' : 'Delivered', value: esc(num(delivered)), sub: last ? `last ${esc(fmt.dateShort(last.date))}${last.note ? ' · ' + esc(last.note) : ''}` : '' },
        { label: 'Already confirmed', value: esc(num(grnd)), sub: (p.grns || []).map(g => esc(g.number)).join(', ') || 'none' },
        { label: 'Quality at receipt', value: last ? ui.badge(last.quality, last.quality === 'OK' ? 'green' : 'orange', { dot: false }) : dash, sub: last && last.rejection ? `${last.rejection} rejected` : '' }
      ])}
      ${formOpen('grn', {})}
        ${sec(svc ? 'Service confirmation' : 'Goods receipt note', 'check')}
        <div class="form-grid cols-3">
          ${fld(a, { name: 'qty', label: svc ? 'Units performed' : 'Received qty', type: 'number', value: recv, min: 0, required: true })}
          ${fld(a, { name: 'acceptedQty', label: 'Accepted qty', type: 'number', value: recv - rej, min: 0, required: true })}
          ${fld(a, { name: 'rejectedQty', label: 'Rejected qty', type: 'number', value: rej, min: 0 })}
          ${fld(a, { name: 'receiptDate', label: svc ? 'Confirmation date' : 'Receipt date', type: 'date', value: now(), required: true })}
          ${fld(a, { name: 'remarks', label: 'Remarks', full: true, placeholder: rej ? 'Reason for rejection, e.g. weld cracks' : 'e.g. Received in good condition' })}
        </div>
        <div class="mt-8" data-out="check">${ui.alert('success', `Accepted ${num(recv - rej)} + rejected ${num(rej)} = received ${num(recv)}`)}</div>
        <p class="af-note mt-8">Only the accepted quantity is payable — the 3-way match compares the invoice against it.</p>
        ${bar(spacer, btn(svc ? 'Confirm service' : 'Create GRN', { op: 'create', cls: 'btn-primary', icon: 'check' }))}
      </div>`;
  };

  /* ---------- invoice receipt ---------- */
  function termDays(terms) { const m = String(terms || '').match(/(\d+)\s*days/g); if (!m) return 30; return Number(m[m.length - 1].replace(/\D/g, '')) || 30; }
  R.invoice = (ctx, p, a) => {
    const { state } = ctx;
    const po = p.po || {};
    const accepted = U.sum(p.grns, g => g.acceptedQty);
    const invoiced = U.sum(p.invoices, i => i.qty);
    const expect = Math.max(0, accepted - invoiced) || accepted;
    const value = Math.round(expect * (po.unitPrice || 0));
    const tax = Math.round(value * (po.taxPct || 0) / 100);
    const days = termDays(po.paymentTerms);
    const d17 = doc(p, 'D17');
    const prev = p.invoices || [];
    const v = E.vendor(state, po.vendorId) || {};
    return `${figs([
        { label: 'PO', value: esc(po.number || '—'), sub: `${esc(fmt.inr(po.unitPrice))} / unit · GST ${esc(pct(po.taxPct))}` },
        { label: 'GRN accepted', value: `${esc(num(accepted))} ${esc(p.uom || '')}`, sub: (p.grns || []).map(g => esc(g.number)).join(', ') },
        { label: 'Already invoiced', value: esc(num(invoiced)), sub: prev.length ? `${prev.length} invoice(s)` : 'none' },
        { label: 'Payable value', value: money(Math.round(expect * (po.unitPrice || 0) * (1 + (po.taxPct || 0) / 100))), cls: 'hl', sub: `${esc(num(expect))} × PO price + GST` }
      ])}
      ${formOpen('invoice', { expect, unit: po.unitPrice || 0, days })}
        ${sec(`Vendor invoice — ${v.name || ''}`, 'invoice')}
        <div class="form-grid cols-3">
          ${fld(a, { name: 'number', label: 'Invoice number', required: true, placeholder: `e.g. ${short(v.name).toUpperCase().slice(0, 4)}/INV/26-27/0123` })}
          ${fld(a, { name: 'date', label: 'Invoice date', type: 'date', value: now(), required: true })}
          ${fld(a, { name: 'receivedDate', label: 'Received on', type: 'date', value: now() })}
          ${fld(a, { name: 'qty', label: `Invoiced qty (${p.uom || 'Nos'})`, type: 'number', value: expect, min: 0, required: true })}
          ${fld(a, { name: 'value', label: 'Basic value (excl. tax)', type: 'money', value, required: true, hint: 'Defaults to qty × PO unit price.' })}
          ${fld(a, { name: 'taxPct', label: 'GST %', type: 'number', value: po.taxPct != null ? po.taxPct : 18, min: 0, max: 40 })}
          ${fld(a, { name: 'dueDate', label: 'Payment due date', type: 'date', value: U.addDays(now(), days, false), hint: `Per PO terms (${esc(String(days))} days).` })}
          <div class="field" style="grid-column:span 2"><label>Invoice total</label><div class="af-figs"><div class="dark"><span>Basic + GST <span data-out="tax">${esc(fmt.inr(tax))}</span></span><b data-out="total">${esc(fmt.inr(value + tax))}</b></div></div></div>
          ${docOk(d17) && prev.length ? fld(a, { name: 'fileName', label: 'Invoice copy', type: 'file', full: true, sample: `Invoice_${prev.length + 1}_${p.id}.pdf` }) : fld(a, { name: 'fileName', label: 'Invoice copy', type: 'file', required: true, full: true, sample: `Invoice_${p.id}.pdf` })}
          ${fld(a, { name: 'partial', label: 'More invoices to follow (partial invoice)', type: 'checkbox', value: false, full: true })}
        </div>
        <div data-show="qtywarn" class="mt-8 af-hidden">${ui.alert('warn', '<span data-out="qtywarn"></span>')}</div>
        ${bar(spacer, btn('Record invoice', { op: 'record', cls: 'btn-primary', icon: 'invoice' }))}
      </div>
      ${prev.length ? `<div>${sec('Invoices recorded', 'invoice')}${invoiceTable(ctx, p)}</div>` : ''}`;
  };
  function invoiceTable(ctx, p) {
    const { state } = ctx;
    return ui.table([
      { key: 'number', label: 'Invoice', render: i => `<b class="mono">${esc(i.number)}</b><span class="sub">${esc(fmt.date(i.date))}${i.fileName ? ' · ' + esc(i.fileName) : ''}</span>` },
      { key: 'qty', label: 'Qty', align: 'right', render: i => esc(num(i.qty)) },
      { key: 'value', label: 'Basic', align: 'right', render: i => esc(fmt.inr(i.value)) },
      { key: 'tax', label: 'Tax', align: 'right', hideOnMobile: true, render: i => `${esc(fmt.inr(i.tax))}<span class="sub">${esc(pct(i.taxPct))}</span>` },
      { key: 'total', label: 'Total', align: 'right', render: i => `<b>${esc(fmt.inr(i.total))}</b>` },
      { key: 'dueDate', label: 'Due', render: i => i.status === 'Paid' ? esc(fmt.dateShort(i.dueDate)) : ui.due(i.dueDate) },
      { key: 'status', label: 'Status', render: i => ui.status(state, 'invoice', i.status) }
    ], p.invoices || [], { key: 'af_inv', sort: ctx.local.af_invSort, dense: true });
  }

  /* ---------- invoice verification ---------- */
  R.invoice_verify = (ctx, p, a) => {
    const { state } = ctx;
    const po = p.po || {};
    const invs = p.invoices || [];
    const v = E.vendor(state, po.vendorId) || {};
    const it = E.invoiceTotals(p);
    const accepted = U.sum(p.grns, g => g.acceptedQty);
    const tol = Number(E.ruleParam(state, 'R04', 'tolerancePct', 0.5)) || 0;
    const expected = Math.round(it.qty * (po.unitPrice || 0) * (1 + (po.taxPct || 0) / 100));
    const within = Math.abs(it.total - expected) <= Math.max(1, expected * tol / 100);
    const svc = isSvc(state, p);
    const grnDoc = doc(p, svc ? 'D16' : 'D15');
    const dcDoc = svc ? null : doc(p, 'D14');
    const d17 = doc(p, 'D17');
    const taxOk = invs.every(i => Math.abs((Number(i.taxPct) || 0) - (Number(po.taxPct) || 0)) < 0.05);
    const ev = {
      Vendor: { ok: invs.every(i => i.vendorId === po.vendorId), detail: `${v.name || ''} · GSTIN ${v.gstin || '—'}` },
      Invoice: { ok: invs.every(i => i.number && i.date) && docOk(d17), detail: `${invs.map(i => i.number).join(', ')} · copy ${d17 ? d17.status.toLowerCase() : 'missing'}` },
      PO: { ok: !!po.number && invs.every(i => i.poNumber === po.number), detail: `${po.number || '—'} · ${po.status || ''}` },
      Tax: { ok: taxOk, detail: `Invoice GST ${invs.map(i => pct(i.taxPct)).join(', ')} vs PO ${pct(po.taxPct)}` },
      Amount: { ok: within, detail: `Invoice ${fmt.inr(it.total)} vs PO price × invoiced qty ${fmt.inr(expected)}${it.qty !== accepted ? ` · invoiced qty ${it.qty} ≠ GRN accepted ${accepted}` : ''}` },
      'Bank details': { ok: !!v.bank, detail: v.bank || 'No bank details in Vendor Master' },
      'Supporting documents': { ok: docOk(grnDoc) && (svc || docOk(dcDoc)), detail: `${svc ? 'Service confirmation' : 'GRN'} ${grnDoc ? grnDoc.status.toLowerCase() : 'missing'}${svc ? '' : ` · challan ${dcDoc ? dcDoc.status.toLowerCase() : 'missing'}`}` },
      Approval: { ok: (p.approvals || []).every(l => l.status === 'Approved') && (po.history || []).some(h => h.status === 'Approved'), detail: `PR ${(p.approvals || []).map(l => `L${l.level} ${l.status}`).join(' · ')} · PO approved` }
    };
    const items = (a.checklist || []).map(c => Object.assign({ label: c }, ev[c] || { ok: true, detail: null }));
    const blocked = a.status === 'Blocked';
    const holdKey = 'af_hold_' + a.id;
    return `${blocked ? `${ui.alert('warn', `<b>Invoice on hold:</b> ${esc((a.blocker || '').replace(/^Invoice on hold:\s*/, ''))}`, 'pause')}${formOpen(null, {})}${bar(btn('Resume verification', { op: 'resume', cls: 'btn-sm', icon: 'play' }))}</div>` : ''}
      <div>${sec('Invoices', 'invoice', `${esc(fmt.inr(it.total))} total`)}${invoiceTable(ctx, p)}</div>
      ${formOpen(null, {})}
        ${checks('checklist', items, null, { title: 'Verification checklist (evidence from PO, GRN and masters)' })}
        <div class="form-grid cols-1 mt-12">${fld(a, { name: 'remarks', label: 'Remarks', type: 'textarea', rows: 2, full: true })}</div>
        <p class="af-note mt-8">Untick any item that fails — verification is refused while an item fails; put the invoice on hold instead.</p>
        ${bar(blocked ? '' : toggleBtn(ctx, holdKey, 'Put invoice on hold', { icon: 'pause', cls: 'btn-sm btn-warn' }), spacer, btn('Verify invoice', { op: 'verify', cls: 'btn-primary', icon: 'shield' }))}
      </div>
      ${blocked ? '' : `<div ${togAttr(ctx, holdKey)}>${formOpen(null, {}, 'af-box tint')}
        ${sec('Hold invoice', 'pause', 'raises an exception for the buyer')}
        <div class="form-grid">
          ${fld(a, { name: 'holdType', label: 'Issue type', type: 'select', value: HOLD_TYPES[0], options: HOLD_TYPES })}
          ${fld(a, { name: 'holdReason', label: 'Reason', required: true, placeholder: 'e.g. GSTIN on invoice does not match vendor master' })}
        </div>
        ${bar(btn('Put on hold', { op: 'hold', cls: 'btn-warn', icon: 'pause' }))}
      </div></div>`}`;
  };

  /* ---------- 3-way match ---------- */
  function fmtLine(l, v, p) {
    if (v == null || v === '') return dash;
    if (l.money) return esc(fmt.inr(v));
    if (l.pct) return esc(pct(v));
    if (l.key === 'quantity') return `${esc(num(v))} <span class="muted small">${esc(p.uom || '')}</span>`;
    return esc(v);
  }
  R.match = (ctx, p, a, o) => {
    o = o || {};
    const { state, user } = ctx;
    const po = p.po || {};
    const m = E.matchResult(state, p);
    const it = E.invoiceTotals(p);
    const grns = p.grns || [];
    const invs = p.invoices || [];
    const acc = U.sum(grns, g => g.acceptedQty);
    const rej = U.sum(grns, g => g.rejectedQty);
    const blocked = a.status === 'Blocked';
    const ran = !!(p.match && p.match.result);
    const bad = m.lines.filter(l => !l.ok);
    const svc = isSvc(state, p);
    const invUnit = it.qty ? it.basic / it.qty : 0;
    const invTax = it.basic ? it.tax / it.basic * 100 : 0;
    const lineOk = k => (m.lines.find(l => l.key === k) || {}).ok !== false;
    const card = (title, ref, rows, ok) => `<div class="match-card ${ok ? 'ok' : 'bad'}"><div class="overline">${esc(title)}</div><div class="af-mref">${ref}</div>${rows.map(([k, v]) => `<div class="af-mrow"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>`;
    const cards = `<div class="match-grid">
      ${card('Purchase order', esc(po.number || '—'), [['Vendor', esc(vname(state, po.vendorId))], ['Quantity', `${esc(num(po.qty))} ${esc(p.uom || '')}`], ['Unit price', esc(fmt.inr(po.unitPrice))], ['Tax %', esc(pct(po.taxPct))], ['Total', esc(fmt.inr(po.total))]], true)}
      ${card(svc ? 'Service confirmation' : 'GRN', esc(grns.map(g => g.number).join(', ') || '—'), [['Accepted', `${esc(num(acc))} ${esc(p.uom || '')}`], ['Rejected', esc(num(rej))], ['Receipt', esc(grns.length ? fmt.date(grns[grns.length - 1].receiptDate) : '—')], ['Value at PO price', esc(fmt.inr(m.expected))]], lineOk('quantity') || !invs.length)}
      ${card('Invoice', esc(invs.map(i => i.number).join(', ') || '—'), [['Quantity', `${esc(num(it.qty))} ${esc(p.uom || '')}`], ['Unit price', esc(fmt.inr(invUnit))], ['Tax %', esc(pct(invTax))], ['Basic + tax', `${esc(fmt.inr(it.basic))} + ${esc(fmt.inr(it.tax))}`], ['Total', esc(fmt.inr(it.total))]], m.ok)}
    </div>`;
    const banner = blocked || (ran && p.match.result === 'Exception' && !m.ok)
      ? `<div class="af-banner bad">🔴 EXCEPTION <small>${esc(bad.length)} mismatch${bad.length === 1 ? '' : 'es'}: ${esc(bad.map(l => l.label).join(', '))} — payment is blocked until resolved.</small></div>`
      : m.ok
        ? `<div class="af-banner ${ran ? 'ok' : 'pending'}">${ran ? '🟢 MATCHED' : '🟢 Ready to match'} <small>${m.accepted ? `Variance accepted by ${esc(uname(state, m.accepted.by))}: ${esc(m.accepted.remarks)}` : `PO ↔ ${svc ? 'service confirmation' : 'GRN'} ↔ invoice agree within ±${esc(String(m.tolerancePct))}% (Rule R04).`}</small></div>`
        : `<div class="af-banner pending">Not run yet <small>Preview: ${esc(bad.length)} line${bad.length === 1 ? '' : 's'} will not match (${esc(bad.map(l => l.label).join(', '))}) — running the match raises exceptions and blocks payment.</small></div>`;
    const table = ui.table([
      { key: 'label', label: 'Check', render: l => `<b>${esc(l.label)}</b>` },
      { key: 'po', label: 'PO', align: 'right', hideOnMobile: true, render: l => fmtLine(l, l.po, p) },
      { key: 'grn', label: svc ? 'Service conf.' : 'GRN', align: 'right', hideOnMobile: true, render: l => fmtLine(l, l.grn, p) },
      { key: 'invoice', label: 'Invoice', align: 'right', render: l => fmtLine(l, l.invoice, p) },
      { key: 'ok', label: 'Result', sort: l => l.ok ? 1 : 0, render: l => `${l.ok ? '<span class="af-mk ok">✓ Match</span>' : '<span class="af-mk bad">✕ Mismatch</span>'}${l.detail ? `<span class="sub" style="color:var(--red)">${esc(l.detail)}</span>` : ''}` }
    ], m.lines, { key: 'af_m', sort: ctx.local.af_mSort, rowClass: l => l.ok ? '' : 'row-red' });
    const exs = state.exceptions.filter(e => e.purchaseId === p.id && e.key && e.key.indexOf('match:') === 0 && (e.status === 'Open' || e.status === 'In Progress'));
    let actions = '';
    if (!blocked && !o.financeOnly) {
      actions = `${formOpen(null, {})}${bar(spacer, btn('Run 3-way match', { op: 'run', cls: 'btn-primary', icon: 'refresh' }))}</div>`;
    } else if (blocked) {
      actions = resolvePanel(ctx, p, a, m, o);
    }
    return `${banner}${cards}
      <div>${sec('Line-by-line comparison', 'layers', `tolerance ±${esc(String(m.tolerancePct))}% · Rule R04`)}${table}</div>
      ${exs.length ? `<div class="af-box tint">${sec('Open exceptions', 'alert')}<ul class="list-plain">${exs.map(e => `<li class="row between gap-12"><span class="grow"><b>${esc(e.type)}</b> <span class="muted small mono">${esc(e.id)}</span><span class="af-sub">${esc(e.description || '')}</span></span>${ui.status(state, 'exception', e.status)}</li>`).join('')}</ul></div>` : ''}
      ${actions}`;
  };
  function resolvePanel(ctx, p, a, m, o) {
    const { state, user } = ctx;
    const po = p.po || {};
    const invs = p.invoices || [];
    const inv = invs[invs.length - 1] || {};
    const acc = U.sum(p.grns, g => g.acceptedQty);
    const otherQty = U.sum(invs.filter(i => i.id !== inv.id), i => i.qty);
    const fairQty = Math.max(0, acc - otherQty);
    const unitInv = inv.qty ? inv.value / inv.qty : (po.unitPrice || 0);
    const isFin = user && user.roleId === 'finance';
    const key = 'af_res_' + a.id;
    const choice = o.financeOnly ? 'accept_variance' : (ctx.local[key] || (isFin ? 'accept_variance' : 'credit_note'));
    const finName = uname(state, (state.masters.users.find(u => u.roleId === 'finance' && u.status === 'Active') || {}).id);
    const invSelFor = sfx => invs.length > 1 ? fld(a, { sfx, name: 'invoiceId', label: 'Invoice', type: 'select', value: inv.id, options: invs.map(i => ({ value: i.id, label: `${i.number} · ${fmt.inr(i.total)}` })) }) : `<input type="hidden" name="invoiceId" value="${esc(inv.id || '')}">`;
    const cnQty = Math.max(0, (inv.qty || 0) - fairQty);
    const cnVal = Math.round(cnQty * unitInv);
    const choices = [
      ['revised_invoice', 'Revised invoice', 'Vendor re-issues the invoice'],
      ['credit_note', 'Credit note', 'Vendor credits the difference'],
      ['accept_variance', 'Accept variance', 'Finance approves as-is']
    ].filter(c => !o.financeOnly || c[0] === 'accept_variance');
    const panel = (id, body) => `<div data-panel-of="${esc(key)}" data-panel="${id}" class="${choice === id ? '' : 'af-hidden'}">${body}</div>`;
    const data = { unit: po.unitPrice || 0, tax: po.taxPct || 0, expected: m.expected, invqty: inv.qty || 0, invval: inv.value || 0 };
    return `<div class="af-box">
      ${sec('Resolve the exception', 'shield', 'the match re-runs automatically')}
      <div class="choice-cards" data-choices="${esc(key)}">${choices.map(c => `<button type="button" class="choice ${choice === c[0] ? 'active' : ''}" data-act="af-choice" data-value="${c[0]}"><b>${esc(c[1])}</b><small>${esc(c[2])}</small></button>`).join('')}</div>
      ${o.financeOnly ? '' : panel('revised_invoice', `${formOpen('rv', data, 'mt-12')}
        <input type="hidden" name="resolution" value="revised_invoice">
        <div class="form-grid cols-3">
          ${invSelFor('rvi')}
          ${fld(a, { sfx: 'rv', name: 'number', label: 'Revised invoice no.', value: inv.number ? `${inv.number}-R1` : '', required: true })}
          ${fld(a, { sfx: 'rv', name: 'qty', label: 'Quantity', type: 'number', value: fairQty, min: 0 })}
          ${fld(a, { sfx: 'rv', name: 'value', label: 'Basic value', type: 'money', value: Math.round(fairQty * (po.unitPrice || 0)) })}
          ${fld(a, { sfx: 'rv', name: 'taxPct', label: 'GST %', type: 'number', value: po.taxPct != null ? po.taxPct : 18, min: 0 })}
          <div class="field"><label>Revised total</label><div class="af-figs"><div class="hl"><span>vs received ${esc(fmt.inr(m.expected))}</span><b data-out="total">—</b></div></div></div>
          ${fld(a, { sfx: 'rv', name: 'remarks', label: 'Remarks', full: true, placeholder: 'e.g. Vendor re-issued invoice for accepted quantity' })}
        </div>
        <div class="mt-8" data-out="verdict"></div>
        ${bar(spacer, btn('Apply revised invoice & re-run match', { op: 'resolve', cls: 'btn-primary', icon: 'refresh' }))}
      </div>`)}
      ${o.financeOnly ? '' : panel('credit_note', `${formOpen('cn', data, 'mt-12')}
        <input type="hidden" name="resolution" value="credit_note">
        <div class="form-grid cols-3">
          ${invSelFor('cni')}
          ${fld(a, { sfx: 'cn', name: 'ref', label: 'Credit note no.', required: true, placeholder: 'e.g. CN/26-27/0091' })}
          ${fld(a, { sfx: 'cn', name: 'cnQty', label: 'Credited quantity', type: 'number', value: cnQty, min: 0 })}
          ${fld(a, { sfx: 'cn', name: 'cnValue', label: 'Credited basic value', type: 'money', value: cnVal })}
          <div class="field"><label>Invoice after credit note</label><div class="af-figs"><div class="hl"><span data-out="netline">—</span><b data-out="total">—</b></div></div></div>
          ${fld(a, { sfx: 'cn', name: 'remarks', label: 'Remarks', full: true, placeholder: 'e.g. Credit for 20 rejected trolleys' })}
        </div>
        <div class="mt-8" data-out="verdict"></div>
        ${bar(spacer, btn('Apply credit note & re-run match', { op: 'resolve', cls: 'btn-primary', icon: 'refresh' }))}
      </div>`)}
      ${panel('accept_variance', `${formOpen(null, {}, 'mt-12')}
        <input type="hidden" name="resolution" value="accept_variance">
        ${invs.length > 1 ? `<div class="form-grid">${invSelFor('avi')}</div>` : invSelFor('avi')}
        ${isFin ? ui.alert('warn', `You are approving a variance of <b>${esc(fmt.inr(m.invoiceTotal - m.expected))}</b> (invoice ${esc(fmt.inr(m.invoiceTotal))} vs received value ${esc(fmt.inr(m.expected))}). The invoice will be paid as billed; the approval is recorded in the audit trail.`)
          : ui.alert('info', `<b>Only Finance can accept a variance</b> — ask ${esc(finName)} (Finance Controller). Use a revised invoice or credit note instead.`, 'lock')}
        <div class="form-grid cols-1 mt-12">${fld(a, { sfx: 'av', name: 'remarks', label: 'Reason for accepting the variance', type: 'textarea', rows: 2, full: true, required: true, disabled: !isFin })}</div>
        ${bar(spacer, btn('Accept variance & re-run match', { op: 'resolve', cls: 'btn-danger', icon: 'check', disabled: !isFin }))}
      </div>`)}
    </div>`;
  }

  /* ---------- payment approval ---------- */
  R.payment_approval = (ctx, p, a) => {
    const { state, user } = ctx;
    const po = p.po || {};
    const it = E.invoiceTotals(p);
    const own = E.purchaseAdvanceOutstanding(state, p);
    const vout = E.vendorOutstanding(state, po.vendorId, null);
    const adjustPlanned = Math.min(own, it.balance);
    const proposed = Math.max(0, it.balance - adjustPlanned);
    const v = E.vendor(state, po.vendorId) || {};
    const invs = p.invoices || [];
    const open = invs.filter(i => i.total - i.paidAmount - i.adjustedAmount > 0);
    const due = open.length ? Math.min(...open.map(i => i.dueDate || Infinity)) : null;
    const r02 = !!E.rule(state, 'R02') && vout > 0;
    const vis = new Set(S.visiblePurchases(state, user).map(x => x.id));
    const advs = state.advances.filter(x => x.vendorId === po.vendorId && E.advanceOutstanding(x) > 0);
    const r02Panel = r02 ? `<div class="af-r02">${ui.alert('warn', `<b>Rule R02 — Existing Advance: ${esc(fmt.inr(vout))} with ${esc(v.name || '')} — consider adjustment before payment.</b>
        <ul class="list-plain mt-8">${advs.map(x => { const ag = E.advanceAgeing(state, x); return `<li class="row between wrap"><span><span class="mono">${esc(x.id)}</span> · ${vis.has(x.purchaseId) ? `<a href="#/purchases/${esc(x.purchaseId)}">${esc(x.purchaseId)}</a>` : 'another purchase'}${x.purchaseId === p.id ? ' (this purchase — adjusted at Advance Adjustment)' : ''}</span><span><b>${esc(fmt.inr(E.advanceOutstanding(x)))}</b>${ag ? ` <span class="small">· ${esc(fmt.days(ag.days))}${ag.overdue ? ' · overdue' : ''}</span>` : ''}</span></li>`; }).join('')}</ul>
        <label class="check mt-8"><input type="checkbox" name="acknowledgeAdvance"> I have reviewed the outstanding advance${own > 0 ? ' (this PO’s advance is adjusted in the next step)' : ''} and approve this payment.</label>`)}</div>` : '';
    const summary = `${figs([
        { label: 'Invoice total', value: money(it.total), sub: invs.map(i => esc(i.number)).join(', ') },
        { label: 'Already paid', value: money(it.paid) },
        it.adjusted ? { label: 'Advance adjusted', value: money(it.adjusted) } : null,
        own > 0 ? { label: 'Advance to adjust', value: money(adjustPlanned), cls: 'warn', sub: 'this PO’s outstanding advance' } : null,
        { label: 'Proposed payment', value: money(proposed), cls: 'dark', sub: own > 0 ? 'balance after adjustment' : 'balance payable' }
      ])}
      <div class="grid grid-2 mt-12">
        <div class="af-box">${sec('Payee & due date', 'payment')}${kv([['Vendor', `<b>${esc(v.name || '')}</b>`], ['Bank', esc(v.bank || '—')], ['GSTIN / PAN', `${esc(v.gstin || '—')} / ${esc(v.pan || '—')}`], ['Due date', due && isFinite(due) ? `${esc(fmt.date(due))} · ${ui.due(due)}` : '—'], ['PO terms', esc(po.paymentTerms || '—')]])}</div>
        <div class="af-box">${sec('Match status', 'layers')}${kv([['3-way match', p.match ? ui.badge(p.match.result, p.match.result === 'Matched' ? 'green' : 'red') : dash], p.match && p.match.acceptedVariance ? ['Variance', `accepted by ${esc(uname(state, p.match.acceptedVariance.by))}`] : null, ['Invoices', invs.map(i => ui.status(state, 'invoice', i.status)).join(' ') || dash], ['Vendor exposure', vout > 0 ? `<b style="color:var(--orange)">${esc(fmt.inr(vout))}</b> outstanding advances` : 'None']])}</div>
      </div>`;
    const before = `${r02Panel}${checks('checklist', a.checklist || [], allFalse(a.checklist || []), { title: 'Payment proposal checklist', gate: true })}`;
    return decisionPanel(ctx, p, a, { summary, before, ops: ['approve', 'return'], approveLabel: `Approve payment of ${fmt.inr(proposed)}`, returnLabel: 'Return to AP' });
  };

  /* ---------- payment / balance payment ---------- */
  R.payment = (ctx, p, a) => payForm(ctx, p, a, 'Invoice');
  R.balance_payment = (ctx, p, a) => payForm(ctx, p, a, 'Balance');
  function payForm(ctx, p, a, kind) {
    const { state } = ctx;
    const it = E.invoiceTotals(p);
    const pays = payList(state, p);
    const processing = pays.find(x => x.type === kind && x.status === 'Processing');
    const failed = pays.filter(x => x.type === kind && x.status === 'Failed').pop();
    const v = E.vendor(state, p.po && p.po.vendorId) || {};
    const own = E.purchaseAdvanceOutstanding(state, p);
    const pa = p.paymentApproval;
    const balance = kind === 'Balance';
    const breakdown = balance
      ? `<div class="af-formula"><div><span>Invoice value</span><b>${esc(fmt.inr(it.total))}</b></div><div class="op">−</div><div><span>Advance adjusted</span><b>${esc(fmt.inr(it.adjusted))}</b></div>${it.paid ? `<div class="op">−</div><div><span>Already paid</span><b>${esc(fmt.inr(it.paid))}</b></div>` : ''}<div class="op">=</div><div class="res"><span>Balance payable</span><b>${esc(fmt.inr(it.balance))}</b></div></div>`
      : figs([
        { label: 'Invoice total', value: money(it.total), sub: (p.invoices || []).map(i => esc(i.number)).join(', ') },
        { label: 'Already paid', value: money(it.paid) },
        { label: 'Amount payable', value: money(it.balance), cls: 'dark', sub: pa ? `approved by ${esc(uname(state, pa.by))}` : '' }
      ]);
    let main;
    if (processing) {
      main = `${ui.alert('warn', `<b>Waiting on bank</b> — ${esc(processing.id)} for ${esc(fmt.inr(processing.amount))} sent ${esc(fmt.dateTime(processing.date))} via ${esc(processing.mode)} (${esc(processing.bank || '')}). Confirm the credit once the bank returns the UTR.`, 'clock')}
        ${formOpen(null, {}, 'af-box')}
          ${sec('Confirm credit', 'checkCircle')}
          <div class="form-grid">${fld(a, { name: 'cutr', label: 'UTR from bank', value: processing.utr || '', required: true, placeholder: 'e.g. HDFCN52026100612345' })}</div>
          ${bar(spacer, btn('Confirm credit (UTR)', { op: 'confirm', cls: 'btn-success', icon: 'check' }))}
        </div>
        ${formOpen(null, {}, 'af-box tint')}
          ${sec('Bank returned the payment?', 'alert')}
          <div class="form-grid cols-1">${fld(a, { name: 'failReason', label: 'Failure reason', required: true, placeholder: 'e.g. Beneficiary account name mismatch' })}</div>
          ${bar(btn('Mark failed', { op: 'fail', cls: 'btn-outline-danger', icon: 'xCircle' }))}
        </div>`;
    } else if (it.balance <= 0) {
      main = balance
        ? `${ui.alert('success', `<b>No balance payable</b> — the invoice is fully settled${it.adjusted ? ' by the advance adjustment' : ''}.`)}${formOpen(null, {})}${bar(spacer, btn('Complete (no balance payable)', { op: 'complete', cls: 'btn-success', icon: 'check' }))}</div>`
        : ui.alert('info', 'Nothing is payable on this purchase — the invoice balance is zero.');
    } else {
      main = `${a.status === 'Blocked' && failed ? ui.alert('danger', `<b>Previous attempt failed</b> — ${esc(failed.id)}: ${esc(failed.failureReason || a.blocker || '')}. Correct the bank details and re-process; the same payment record is reused.`) : ''}
        ${formOpen(null, {}, 'af-box')}
          ${sec(balance ? 'Pay the balance' : 'Release payment', 'payment', `to ${esc(v.name || '')} · ${esc(v.bank || '')}`)}
          <div class="form-grid">
            <div class="field"><label>Amount</label><div class="af-figs"><div class="dark"><span>${balance ? 'Balance payable' : 'Payable'}</span><b>${esc(fmt.inr(it.balance))}</b></div></div></div>
            ${fld(a, { name: 'mode', label: 'Payment mode', type: 'select', value: failed ? failed.mode : 'NEFT', options: MODES })}
            ${fld(a, { name: 'bank', label: 'Paid from', type: 'select', value: BANKS[0], options: BANKS })}
            ${fld(a, { name: 'date', label: 'Payment date', type: 'date', value: now() })}
            ${fld(a, { name: 'utr', label: 'UTR / bank reference', placeholder: 'Required to record as paid', full: true, hint: 'No UTR yet? Use “Send to bank” — the step waits on the bank until you confirm the credit.' })}
          </div>
          ${bar(btn('Send to bank (processing)', { op: 'pay', data: { variant: 'processing' }, icon: 'send' }), spacer, btn(`Pay ${fmt.inr(it.balance)} & record UTR`, { op: 'pay', cls: 'btn-primary', icon: 'payment' }))}
        </div>`;
    }
    const recovery = balance && own > 0 ? recoveryBox(ctx, p, a, own) : '';
    const tbl = pays.length ? ui.table([
      { key: 'id', label: 'Payment', render: x => `<b class="mono">${esc(x.id)}</b><span class="sub">${esc(x.type)}<span class="af-m-only">${esc(fmt.dateShort(x.date))}${x.utr ? ' · ' + esc(x.utr) : ''}</span></span>` },
      { key: 'amount', label: 'Amount', align: 'right', render: x => esc(fmt.inr(x.amount)) },
      { key: 'mode', label: 'Mode', hideOnMobile: true },
      { key: 'utr', label: 'UTR', hideOnMobile: true, render: x => x.utr ? `<span class="mono small">${esc(x.utr)}</span>` : dash },
      { key: 'date', label: 'Date', hideOnMobile: true, render: x => esc(fmt.dateShort(x.date)) },
      { key: 'status', label: 'Status', render: x => ui.status(state, 'payment', x.status) }
    ], pays, { key: 'af_pay', sort: ctx.local.af_paySort, dense: true }) : '';
    return `${breakdown}${recovery}${main}${tbl ? `<div>${sec('Payments on this purchase', 'payment')}${tbl}</div>` : ''}`;
  }
  function recoveryBox(ctx, p, a, own) {
    const { state } = ctx;
    const adv = lastAdvance(state, p) || {};
    return `${formOpen('recover', { out: own }, 'af-box')}
      ${sec('Excess advance outstanding', 'advance', `${esc(adv.id || '')} ${adv.status ? ui.status(state, 'advance', adv.status) : ''}`)}
      ${ui.alert('warn', `<b>${esc(fmt.inr(own))} of the advance is still outstanding</b> with ${esc(vname(state, adv.vendorId))}. Closure requires it to be fully adjusted or recovered — record the vendor refund or credit note${E.invoiceTotals(p).balance > 0 ? ' before paying the balance' : ''}.`)}
      ${figs([
        { label: 'Advance paid', value: esc(fmt.inr(adv.paidAmount)) },
        { label: 'Adjusted', value: esc(fmt.inr(E.advanceAdjusted(adv))) },
        { label: 'Recovered', value: esc(fmt.inr(E.advanceRecovered(adv))) },
        { label: 'Outstanding', value: esc(fmt.inr(own)), cls: 'warn' }
      ])}
      <div class="form-grid cols-3 mt-12">
        ${fld(a, { name: 'recAmount', label: 'Recover amount', type: 'money', value: own, required: true })}
        ${fld(a, { name: 'recRef', label: 'Receipt / credit note ref.', required: true, placeholder: 'e.g. RCPT-2026-0412' })}
        ${fld(a, { name: 'recMode', label: 'Recovered by', type: 'select', value: RECOVERY_MODES[0], options: RECOVERY_MODES })}
      </div>
      <div class="mt-8" data-out="recnote"></div>
      ${bar(spacer, btn('Recover excess advance', { op: 'recover', cls: 'btn-warn', icon: 'undo' }))}
    </div>`;
  }

  /* ---------- advance adjustment ---------- */
  R.adjustment = (ctx, p, a) => {
    const { state } = ctx;
    const advs = (p.advanceIds || []).map(id => E.advance(state, id)).filter(x => x && x.status !== 'Rejected');
    const invs = p.invoices || [];
    const open = i => Math.max(0, i.total - i.paidAmount - i.adjustedAmount);
    const ledger = {
      inv: invs.map(i => ({ id: i.id, number: i.number, total: i.total, paid: i.paidAmount, adjusted: i.adjustedAmount, open: open(i) })),
      adv: advs.map(x => ({ id: x.id, paid: x.paidAmount, adjusted: E.advanceAdjusted(x), recovered: E.advanceRecovered(x), out: E.advanceOutstanding(x) }))
    };
    const di = invs.find(i => open(i) > 0) || invs[invs.length - 1] || {};
    const da = advs.slice().reverse().find(x => E.advanceOutstanding(x) > 0) || advs[advs.length - 1] || {};
    const out = da.id ? E.advanceOutstanding(da) : 0;
    const op = di.id ? open(di) : 0;
    const sugg = Math.min(out, op);
    const totalOut = U.sum(advs, E.advanceOutstanding);
    const it = E.invoiceTotals(p);
    const hist = [];
    advs.forEach(x => (x.adjustments || []).filter(j => !j.purchaseId || j.purchaseId === p.id).forEach(j => hist.push(Object.assign({ advanceId: x.id }, j))));
    const sr = id => { const r = U.byId(state.masters.settlementRules, id); return r && r.status === 'Active'; };
    const tbl = hist.length ? ui.table([
      { key: 'at', label: 'Date', render: j => esc(fmt.dateTime(j.at)) },
      { key: 'advanceId', label: 'Advance', render: j => `<span class="mono">${esc(j.advanceId)}</span>` },
      { key: 'invoiceNumber', label: 'Invoice', render: j => `<span class="mono">${esc(j.invoiceNumber)}</span>` },
      { key: 'amount', label: 'Adjusted', align: 'right', render: j => `<b>${esc(fmt.inr(j.amount))}</b>` },
      { key: 'by', label: 'By', hideOnMobile: true, render: j => esc(uname(state, j.by)) },
      { key: 'remarks', label: 'Remarks', hideOnMobile: true, render: j => `<span class="small">${esc(j.remarks || '')}</span>` }
    ], hist, { key: 'af_adj', sort: ctx.local.af_adjSort, dense: true, foot: `<tr><td colspan="3">Total adjusted on this purchase</td><td class="num">${esc(fmt.inr(U.sum(hist, j => j.amount)))}</td><td class="hide-m" colspan="2"></td></tr>` }) : '';
    const canAdjust = totalOut > 0 && it.balance > 0;
    return `${figs([
        { label: 'Invoice value', value: money(it.total), sub: invs.map(i => esc(i.number)).join(', ') },
        { label: 'Advance paid', value: money(U.sum(advs, x => x.paidAmount)), sub: advs.map(x => esc(x.id)).join(', ') },
        { label: 'Advance outstanding', value: money(totalOut), cls: totalOut > 0 ? 'warn' : 'good' },
        { label: 'Invoice open balance', value: money(it.balance) }
      ])}
      ${canAdjust ? `${formOpen('adjust', { ledger: JSON.stringify(ledger) }, 'af-box')}
        ${sec('Adjustment calculator', 'rupee', [sr('SR-2') && 'SR-2 suggests the lower amount', sr('SR-3') && 'SR-3 partial allowed', sr('SR-4') && 'SR-4 multiple invoices'].filter(Boolean).join(' · '))}
        <div class="form-grid">
          ${invs.length > 1 ? fld(a, { name: 'invoiceId', label: 'Invoice (SR-4)', type: 'select', value: di.id, options: invs.map(i => ({ value: i.id, label: `${i.number} · open ${fmt.inr(open(i))}` })) }) : `<input type="hidden" name="invoiceId" value="${esc(di.id || '')}">`}
          ${advs.length > 1 ? fld(a, { name: 'advanceId', label: 'Advance', type: 'select', value: da.id, options: advs.map(x => ({ value: x.id, label: `${x.id} · outstanding ${fmt.inr(E.advanceOutstanding(x))}` })) }) : `<input type="hidden" name="advanceId" value="${esc(da.id || '')}">`}
        </div>
        <div class="mt-12">${figs([
          { label: 'Invoice open', value: esc(fmt.inr(op)), out: 'open', sub: esc(di.number || ''), subOut: 'invno' },
          { label: 'Advance outstanding', value: esc(fmt.inr(out)), out: 'out' },
          { label: 'Suggested (SR-2)', value: esc(fmt.inr(sugg)), out: 'sugg', cls: 'hl', sub: 'lower of the two' }
        ])}</div>
        <div class="form-grid mt-12">
          ${fld(a, { name: 'amount', label: 'Adjust amount', type: 'money', value: sugg, required: true, hint: 'Partial adjustment allowed (SR-3) — the remainder stays outstanding.' })}
          ${fld(a, { name: 'remarks', label: 'Remarks', placeholder: 'e.g. Milestone-1 adjustment as per contract' })}
        </div>
        <div class="af-formula mt-12">
          <div><span>Invoice value</span><b data-out="ftotal">${esc(fmt.inr(di.total || 0))}</b></div><div class="op">−</div>
          <div><span>Advance adjusted</span><b data-out="fadj">${esc(fmt.inr((di.adjustedAmount || 0) + sugg))}</b></div><div class="op">=</div>
          <div class="res"><span>Balance payable</span><b data-out="fbal">${esc(fmt.inr(op - sugg))}</b></div>
          <div><span>Advance outstanding after</span><b data-out="fout">${esc(fmt.inr(out - sugg))}</b></div>
        </div>
        <div class="mt-8" data-out="warn"></div>
        ${bar(spacer, btn('Adjust advance', { op: 'adjust', cls: 'btn-primary', icon: 'check' }))}
      </div>` : ui.alert(totalOut > 0 ? 'info' : 'success', totalOut > 0 ? `<b>No invoice balance left to adjust against.</b> ${esc(fmt.inr(totalOut))} of advance remains — it is recovered from the vendor at Balance Payment.` : '<b>The advance is fully adjusted.</b> Complete this step to move to Balance Payment.')}
      ${tbl ? `<div>${sec('Adjustment history', 'audit')}${tbl}</div>` : ''}
      ${formOpen(null, {})}${bar(spacer, btn('Complete adjustment', { op: 'complete', cls: 'btn-success', icon: 'checkCircle', soft: !hist.length && canAdjust, title: !hist.length && canAdjust ? 'Adjust the advance against the invoice first' : '' }))}</div>`;
  };

  /* ---------- closure ---------- */
  function whoActs(state, p, key) {
    const act = types => (p.activities || []).filter(x => types.includes(x.actionType) && x.status !== 'Skipped').pop();
    const nm = id => esc(uname(state, id));
    switch (key) {
      case 'activities': { const o = (p.activities || []).filter(x => x.actionType !== 'closure' && !E.DONE_STATES.includes(x.status)); return o.length ? o.slice(0, 3).map(x => `${esc(x.name)} — <b>${nm(x.ownerUserId)}</b>`).join('<br>') : ''; }
      case 'approvals': return (p.approvals || []).filter(l => l.status !== 'Approved').map(l => `L${l.level} ${esc(l.label)} — <b>${nm(l.userId)}</b>`).join('<br>');
      case 'documents': return `Upload the missing document(s) — <b>${nm(p.buyerId)}</b> (buyer) or the step owner`;
      case 'delivery': { const x = act(['grn']); return x ? `${esc(x.name)} — <b>${nm(x.ownerUserId)}</b>` : ''; }
      case 'invoice': { const x = act(['invoice_verify']); return x ? `${esc(x.name)} — <b>${nm(x.ownerUserId)}</b>` : ''; }
      case 'payment': { const x = act(['balance_payment', 'payment']); return x ? `${esc(x.name)} — <b>${nm(x.ownerUserId)}</b>` : ''; }
      case 'advance': { const adv = lastAdvance(state, p); return `Adjust or recover the advance — <b>${nm(adv && adv.ownerUserId || (act(['adjustment']) || {}).ownerUserId)}</b> (Finance)`; }
      case 'issues': { const ex = state.exceptions.filter(e => e.purchaseId === p.id && (e.status === 'Open' || e.status === 'In Progress')); return ex.map(e => `${esc(e.type)} <span class="mono small">${esc(e.id)}</span> — <b>${nm(e.ownerUserId)}</b>`).join('<br>'); }
      default: return '';
    }
  }
  R.closure = (ctx, p, a) => {
    const { state } = ctx;
    const checksList = E.closureChecks(state, p);
    const bad = checksList.filter(c => !c.ok);
    const missingDocs = (p.documents || []).filter(d => d.mandatory && d.status === 'Missing');
    const rows = checksList.map(c => `<div class="check-row ${c.ok ? 'ok' : 'bad'}"><span class="af-mk ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✕'}</span><div class="grow"><b>${esc(c.label)}</b><small>${esc(c.detail || '')}</small>
        ${c.ok ? '' : `<div class="af-who">Who must act: ${whoActs(state, p, c.key) || '—'}</div>`}
        ${!c.ok && c.key === 'documents' ? `<div class="af-docs">${missingDocs.map(d => btn(`Upload ${d.name}`, { act: 'af-upload', data: { doc: d.docId, name: d.name }, cls: 'btn-xs', icon: 'upload' })).join('')}</div>` : ''}
      </div></div>`).join('');
    return `${bad.length ? ui.alert('danger', `<b>Closure is blocked — ${bad.length} of ${checksList.length} controls are not met.</b> The people named below must act first.`) : ui.alert('success', `<b>All ${checksList.length} closure controls pass.</b> Closing locks the purchase file and notifies the requestor.`)}
      <div class="stack-sm">${rows}</div>
      ${formOpen(null, {})}
        <div class="form-grid cols-1">${fld(a, { name: 'remarks', label: 'Closure remarks', type: 'textarea', rows: 2, full: true, placeholder: 'Optional note for the purchase file' })}</div>
        ${bar(spacer, btn('Close purchase', { op: 'close', cls: 'btn-success', icon: 'checkCircle', disabled: !!bad.length, title: bad.length ? 'Every closure control must pass first' : '' }))}
      </div>`;
  };

  /* =================================================================
     LIVE CALCULATIONS (DOM-only; no re-render)
     ================================================================= */
  function out(f, name, html) { f.querySelectorAll(`[data-out="${name}"]`).forEach(el => { el.innerHTML = html; }); }
  function show(f, name, on) { f.querySelectorAll(`[data-show="${name}"]`).forEach(el => el.classList.toggle('af-hidden', !on)); }
  const val = (f, name) => { const el = f.querySelector(`[name="${name}"]`); return el ? el.value : ''; };
  const nval = (f, name) => Number(val(f, name)) || 0;
  const setVal = (f, name, v) => { const el = f.querySelector(`[name="${name}"]`); if (el) el.value = v; };

  const CALC = {
    quote(f) {
      const amt = nval(f, 'amount'); const t = Math.round(amt * nval(f, 'taxPct') / 100);
      out(f, 'tax', esc(fmt.inr(t))); out(f, 'total', esc(fmt.inr(amt + t)));
    },
    po(f) {
      const basic = Math.round(nval(f, 'qty') * nval(f, 'unitPrice'));
      const tax = Math.round(basic * nval(f, 'taxPct') / 100);
      const total = basic + tax;
      out(f, 'basic', esc(fmt.inr(basic))); out(f, 'tax', esc(fmt.inr(tax))); out(f, 'total', esc(fmt.inr(total)));
      const q = Number(f.dataset.quote) || 0;
      if (q) { const d = total - q; out(f, 'diff', Math.abs(d) < 1 ? 'matches quotation' : `${d > 0 ? '+' : '−'}${esc(fmt.inr(Math.abs(d)))} vs quotation`); }
    },
    invoice(f, o) {
      const qty = nval(f, 'qty');
      if (!o.passive && o.target && o.target.name === 'qty' && f.dataset.valueDirty !== '1') setVal(f, 'value', Math.round(qty * (Number(f.dataset.unit) || 0)));
      if (o.target && o.target.name === 'value') f.dataset.valueDirty = '1';
      const value = nval(f, 'value'); const tax = Math.round(value * nval(f, 'taxPct') / 100);
      out(f, 'tax', esc(fmt.inr(tax))); out(f, 'total', esc(fmt.inr(value + tax)));
      const exp = Number(f.dataset.expect) || 0;
      show(f, 'qtywarn', qty !== exp);
      out(f, 'qtywarn', `<b>Invoice quantity ${esc(num(qty))} ≠ GRN accepted ${esc(num(exp))}</b> — the 3-way match will raise a quantity mismatch exception unless a credit note or revised invoice is obtained.`);
      if (!o.passive && o.target && o.target.name === 'date') { const d = U.fromInputDate(val(f, 'date')); if (d) setVal(f, 'dueDate', U.toInputDate(U.addDays(d, Number(f.dataset.days) || 30, false))); }
    },
    advance(f) {
      const state = PCT.store.get();
      const pc = nval(f, 'pct'); const ov = nval(f, 'amount');
      const amt = ov > 0 ? Math.round(ov) : Math.round((Number(f.dataset.total) || 0) * pc / 100);
      out(f, 'amount', esc(fmt.inr(amt)) + (ov > 0 ? ' <small>override</small>' : ''));
      const p = E.purchase(state, f.dataset.pid);
      const effPct = ov > 0 && Number(f.dataset.total) ? ov / Number(f.dataset.total) * 100 : pc;
      if (p) out(f, 'band', bandText(state, p, pc) + (ov > 0 && Math.abs(effPct - pc) > 0.5 ? ` <span class="af-note">· override is ${esc(pct(Math.round(effPct * 10) / 10))} of PO</span>` : ''));
    },
    adjust(f, o) {
      let L; try { L = JSON.parse(f.dataset.ledger || '{}'); } catch (e) { return; }
      const inv = (L.inv || []).find(i => i.id === val(f, 'invoiceId')) || (L.inv || [])[0] || {};
      const adv = (L.adv || []).find(x => x.id === val(f, 'advanceId')) || (L.adv || [])[0] || {};
      const sugg = Math.min(adv.out || 0, inv.open || 0);
      if (!o.passive && o.target && (o.target.name === 'invoiceId' || o.target.name === 'advanceId')) setVal(f, 'amount', sugg);
      const amt = nval(f, 'amount');
      out(f, 'open', esc(fmt.inr(inv.open))); out(f, 'invno', esc(inv.number || '')); out(f, 'out', esc(fmt.inr(adv.out))); out(f, 'sugg', esc(fmt.inr(sugg)));
      out(f, 'ftotal', esc(fmt.inr(inv.total))); out(f, 'fadj', esc(fmt.inr((inv.adjusted || 0) + amt)));
      out(f, 'fbal', esc(fmt.inr(Math.max(0, (inv.open || 0) - amt)))); out(f, 'fout', esc(fmt.inr(Math.max(0, (adv.out || 0) - amt))));
      const w = amt > (adv.out || 0) ? `Cannot adjust more than the outstanding advance (${fmt.inr(adv.out)}).` : amt > (inv.open || 0) ? `Cannot adjust more than the invoice open balance (${fmt.inr(inv.open)}).` : amt > 0 && amt < sugg ? `Partial adjustment — ${fmt.inr((adv.out || 0) - amt)} of advance stays outstanding (SR-3).` : '';
      out(f, 'warn', w ? ui.alert(amt > (adv.out || 0) || amt > (inv.open || 0) ? 'danger' : 'info', esc(w)) : '');
    },
    recover(f) {
      const o2 = Number(f.dataset.out) || 0; const amt = nval(f, 'recAmount');
      out(f, 'recnote', amt > o2 ? ui.alert('danger', `Recovery cannot exceed the outstanding ${esc(fmt.inr(o2))}.`) : amt > 0 && amt < o2 ? `<span class="af-note">${esc(fmt.inr(o2 - amt))} will remain outstanding.</span>` : '');
    },
    grn(f) {
      const q = nval(f, 'qty'), ac = nval(f, 'acceptedQty'), rj = nval(f, 'rejectedQty');
      out(f, 'check', ac + rj === q ? ui.alert('success', `Accepted ${esc(num(ac))} + rejected ${esc(num(rj))} = received ${esc(num(q))}`) : ui.alert('danger', `Accepted ${esc(num(ac))} + rejected ${esc(num(rj))} = ${esc(num(ac + rj))}, but received is ${esc(num(q))} — they must be equal.`));
    },
    delivery(f) {
      const exp = Number(f.dataset.expected) || 0; const d = U.fromInputDate(val(f, 'actualDate'));
      const grace = Number(f.dataset.grace) || 0;
      const late = exp && d ? U.daysBetween(exp, d) - grace : 0;
      show(f, 'late', late > 0);
      out(f, 'late', late > 0 ? `<b>Late by ${esc(fmt.days(late))}</b> — expected ${esc(fmt.date(exp))}. Recorded as a late delivery in vendor performance (Rule R10).` : '');
    },
    posend(f) { const d = U.fromInputDate(val(f, 'date')); if (d) out(f, 'exp', esc(fmt.date(U.addDays(d, Number(f.dataset.days) || 0, false)))); },
    pr(f) {
      const state = PCT.store.get();
      const adv = (f.querySelector('[name="flags.advanceRequired"]') || {}).checked;
      show(f, 'adv', !!adv);
      const levels = E.approvalLevels(state, { estValue: nval(f, 'estValue'), categoryId: val(f, 'categoryId'), deptId: val(f, 'deptId') });
      out(f, 'chain', chainText(levels));
    },
    sourcing(f) {
      const n = f.querySelectorAll('input[name^="v."]:checked').length;
      const min = Number(f.dataset.min) || 1;
      const nv = f.querySelector('[name="newVendor.name"]');
      const nvOn = nv && !nv.closest('.af-hidden') && nv.value.trim();
      const total = n + (nvOn ? 1 : 0);
      out(f, 'selcount', `${total} selected`); out(f, 'selcount2', String(total));
      show(f, 'r03', f.dataset.single !== '1' && total < min);
      f.querySelectorAll('input[name^="v."]').forEach(cb => { const tr = cb.closest('tr'); if (tr) tr.classList.toggle('row-selected', cb.checked); });
    },
    compare(f) { const r = val(f, 'recommendedVendorId'); show(f, 'justreq', f.dataset.single === '1' || (f.dataset.l1 && r !== f.dataset.l1)); },
    select(f) {
      const c = f.querySelector('input[name="vendorId"]:checked');
      f.querySelectorAll('.af-vchoice .choice').forEach(l => l.classList.toggle('active', !!l.querySelector('input:checked')));
      show(f, 'r11', !!c && f.dataset.l1 && c.value !== f.dataset.l1);
    },
    tech(f) {
      const bad = Array.from(f.querySelectorAll('input[type=radio][value="0"]:checked')).map(r => { const row = r.closest('.af-crit'); const b = row && row.querySelector('b'); return b ? b.textContent : ''; });
      out(f, 'result', bad.length ? ui.alert('danger', `<b>Overall: not approved</b> — ${esc(bad.join(', '))}. Submitting returns the purchase to Quotation Comparison.`) : ui.alert('success', '<b>Overall: technically acceptable.</b> The purchase moves on to vendor selection.'));
    },
    rv(f) {
      const value = nval(f, 'value'); const total = value + Math.round(value * nval(f, 'taxPct') / 100);
      const exp = Number(f.dataset.expected) || 0;
      out(f, 'total', esc(fmt.inr(total)));
      out(f, 'verdict', verdict(total, exp, nval(f, 'qty'), f));
    },
    cn(f) {
      const iq = Number(f.dataset.invqty) || 0, iv = Number(f.dataset.invval) || 0;
      const nq = Math.max(0, iq - nval(f, 'cnQty')); const nvv = Math.max(0, iv - nval(f, 'cnValue'));
      const tax = Number(f.dataset.tax) || 0;
      const total = nvv + Math.round(nvv * tax / 100);
      out(f, 'netline', `${esc(num(nq))} units · ${esc(fmt.inr(nvv))} + GST`);
      out(f, 'total', esc(fmt.inr(total)));
      out(f, 'verdict', verdict(total, Number(f.dataset.expected) || 0, nq, f));
    }
  };
  function verdict(total, exp, qty, f) {
    const state = PCT.store.get();
    const tol = Number(E.ruleParam(state, 'R04', 'tolerancePct', 0.5)) || 0;
    const ok = Math.abs(total - exp) <= Math.max(1, Math.abs(exp) * tol / 100);
    return ok ? `<span class="af-mk ok">✓ Will match</span> <span class="af-note">— total equals the received value ${esc(fmt.inr(exp))}</span>` : `<span class="af-mk bad">✕ Still differs by ${esc(fmt.inr(total - exp))}</span> <span class="af-note">— received value is ${esc(fmt.inr(exp))}</span>`;
  }
  function runCalc(f, o) { const fn = CALC[f.dataset.calc]; if (fn) fn(f, o || {}); }

  function updateCount(box) {
    const cbs = box.querySelectorAll('input[type=checkbox]');
    let n = 0;
    cbs.forEach(cb => { if (cb.checked) n++; const l = cb.closest('.check'); if (l) l.classList.toggle('done', cb.checked); });
    const c = box.querySelector('[data-count]');
    if (c) { c.textContent = `${n}/${cbs.length} ticked`; c.classList.toggle('all', n === cbs.length); }
  }

  /** After any (re-)render: recompute derived figures from restored inputs. DOM-only. */
  let queued = false;
  function queueRefresh() {
    if (queued || typeof document === 'undefined') return;
    queued = true;
    setTimeout(() => {
      queued = false;
      document.querySelectorAll('.af [data-calc]').forEach(f => { try { runCalc(f, { passive: true }); } catch (e) { console.error(e); } });
      document.querySelectorAll('.af .file-drop').forEach(w => { const h = w.querySelector('input[type=hidden]'); const n = w.querySelector('.fname'); if (h && n && n.textContent !== h.value) n.textContent = h.value; });
      document.querySelectorAll('.af .af-checks').forEach(updateCount);
    }, 0);
  }

  /* =================================================================
     COMMIT HELPERS
     ================================================================= */
  function fail(msg) { return { ok: false, error: msg }; }
  /** Several engine ops in ONE atomic commit (e.g. save PR edits + submit). */
  function atomic(ctx, p, steps, okMsg) {
    const uid = ctx.user.id;
    const res = ctx.commit(s => {
      let r = { ok: true };
      for (const [op, aid, payload] of steps) { r = E.act(s, p.id, aid, op, payload || {}, uid); if (!r || !r.ok) return r || fail('Not saved'); }
      return r;
    });
    if (res && res.ok) ctx.toast(okMsg || (res.message && res.message !== 'Saved' ? res.message : afterMsg(p.id)), 'green');
    return res;
  }
  /**
   * Call the activity handler directly. Used ONLY where engine.act() would dispatch the op to the
   * purchase-level generic op of the same name (hold / resume / cancel) — see coreIssues — or for the
   * Finance variance approval on a blocked 3-way match. Same guards as act(): open purchase, current
   * activity id, permission.
   */
  function direct(ctx, p, a, op, payload, guard, okMsg) {
    const uid = ctx.user.id;
    const res = ctx.commit(s => {
      const P = E.purchase(s, p.id);
      if (!P) return fail('Purchase not found.');
      if (P.status !== 'Open') return fail(`Purchase is ${P.status}.`);
      const cur = E.currentActivity(P);
      if (!cur || cur.id !== a.id) return fail('This step has already moved on — refresh to see the latest status.');
      const u = E.user(s, uid);
      const ok = guard ? guard(s, u, P, cur) : E.canAct(s, u, P, cur);
      if (!ok) return fail(`Ball is with ${E.userName(s, cur.ownerUserId)} — only the owner can act on “${cur.name}”.`);
      const fn = E.handlers && E.handlers[cur.actionType] && E.handlers[cur.actionType][op];
      if (typeof fn !== 'function' || op.charAt(0) === '_') return fail(`Action “${op}” is not valid for “${cur.name}”.`);
      return fn({ state: s, p: P, a: cur, payload: payload || {}, userId: uid, u }) || { ok: true };
    });
    if (res && res.ok) ctx.toast(res.message && res.message !== 'Saved' ? res.message : (okMsg || afterMsg(p.id)), res.mismatch ? 'orange' : 'green');
    return res;
  }
  /** Same as ctx.act, but when the engine only says "Saved" the toast tells who has the ball next. */
  function run(ctx, pid, aid, op, payload, okMsg) {
    if (typeof ctx.commit !== 'function') return ctx.act(pid, aid, op, payload, okMsg);
    const uid = ctx.user.id;
    const res = ctx.commit(s => E.act(s, pid, aid, op, payload || {}, uid));
    if (res && res.ok) ctx.toast(res.message && res.message !== 'Saved' ? res.message : (okMsg || afterMsg(pid)), res.mismatch ? 'orange' : 'green');
    return res;
  }
  function afterMsg(pid) {
    const s = PCT.store.get(); const p = E.purchase(s, pid);
    if (!p) return 'Saved';
    const b = E.ball(s, p);
    return b.closed ? `${p.id} is ${String(p.status).toLowerCase()}` : `Done — next: ${b.activityName} (${b.ownerName})`;
  }
  /** True when engine.act() would hijack this op as a generic purchase-level op. */
  const collides = op => !!(E.generic && E.generic[op]);

  function grab(ctx, el) {
    const box = el.closest('[data-af]');
    if (!box) return null;
    const p = E.purchase(ctx.state, box.dataset.pid);
    if (!p) { ctx.toast('Purchase not found', 'red'); return null; }
    const a = (p.activities || []).find(x => x.id === box.dataset.aid) || E.currentActivity(p);
    const form = el.closest('.af-form') || box;
    return { p, a, box, form, v: ui.formValues(form), el };
  }
  function invalid(ctx, form, field, msg) {
    if (field && form) {
      const el = form.querySelector(`[name="${field}"]`);
      const wrapEl = el && (el.closest('.field') || el.closest('.check-row'));
      if (wrapEl) { wrapEl.classList.add('af-err'); wrapEl.addEventListener('click', () => wrapEl.classList.remove('af-err'), { once: true }); }
      if (el && el.type !== 'hidden') { try { el.focus(); } catch (e) { /* ignore */ } }
      else if (wrapEl) { const fb = wrapEl.querySelector('button, input[type=file]'); if (fb) fb.focus(); }
    }
    ctx.toast(msg, 'red', 'Check the form');
  }
  const need = (field, msg) => ({ error: msg, field });
  const T = s => String(s == null ? '' : s).trim();
  function unticked(form) {
    const box = form.querySelector('.af-checks[data-gate="1"]');
    if (!box) return [];
    return Array.from(box.querySelectorAll('input[type=checkbox]')).filter(cb => !cb.checked).map(cb => cb.name.replace(/^[^.]*\./, ''));
  }

  /* =================================================================
     PAYLOAD BUILDERS — (op, values, g, ctx, el) → spec
     spec: { payload, error, field, confirm, gate, generic, atomic, direct, guard, op, okMsg, onFail }
     ================================================================= */
  function prPayload(v, p) {
    const f = v.flags || {};
    const adv = !!f.advanceRequired;
    const req = v.requiredBy ? (p.requiredBy && U.toInputDate(v.requiredBy) === U.toInputDate(p.requiredBy) ? p.requiredBy : U.endOfBusiness(v.requiredBy)) : null;
    return {
      title: T(v.title), description: v.description || '', specification: v.specification || '',
      categoryId: v.categoryId || '', deptId: v.deptId || '', costCentreId: v.costCentreId || '',
      qty: Number(v.qty) || 0, uom: T(v.uom), estValue: Number(v.estValue) || 0, requiredBy: req,
      priority: v.priority || 'P3', justification: T(v.justification), budgetAvailable: !!v.budgetAvailable,
      flags: {
        advanceRequired: adv, advancePct: adv ? (Number(f.advancePct) || 0) : 0, advanceTypeId: adv ? (f.advanceTypeId || null) : null,
        singleSource: !!f.singleSource, emergency: !!f.emergency, agreementRequired: !!f.agreementRequired
      }
    };
  }
  function decide(op, v, g) {
    const t = T(v.remarks);
    if (op === 'approve') {
      const payload = { remarks: t };
      if (g.a.actionType === 'payment_approval') payload.acknowledgeAdvance = !!v.acknowledgeAdvance;
      return {
        gate: true, payload,
        onFail: res => { if (/R02/.test(res.error || '')) { const r = g.form.querySelector('.af-r02 .check'); if (r) { r.closest('.alert').classList.add('af-err'); r.scrollIntoView({ block: 'center', behavior: 'smooth' }); } } }
      };
    }
    if (op === 'clarify') return t ? { payload: { question: t } } : need('remarks', 'Type your question for the requestor in the Remarks box.');
    if (!t) return need('remarks', op === 'reject' ? 'Enter the reason for rejection.' : 'Enter the reason for return.');
    if (op === 'reject') {
      const adv = g.a.actionType === 'advance_approve';
      return {
        payload: { remarks: t },
        confirm: adv
          ? { title: 'Reject the advance request?', text: 'The advance is rejected and the purchase <b>continues without an advance</b> — the vendor is paid after delivery, invoice and 3-way match.', confirmLabel: 'Reject advance', tone: 'danger' }
          : { title: `Reject ${esc(g.p.id)}?`, text: `The purchase is <b>rejected and closed</b>; ${esc(E.userName(PCT.store.get(), g.p.requestorId))} (requestor) is notified. This cannot be undone.`, confirmLabel: 'Reject purchase', tone: 'danger' }
      };
    }
    return { payload: { remarks: t } };
  }

  const B = {
    requirement: (op, v) => ({ gate: true, payload: { remarks: T(v.remarks) } }),
    task: (op, v) => ({ gate: true, payload: { remarks: T(v.remarks) } }),

    pr_submit(op, v, g) {
      const payload = prPayload(v, g.p);
      if (payload.flags.advanceRequired && !(payload.flags.advancePct > 0 && payload.flags.advancePct <= 100)) return need('flags.advancePct', 'Enter the advance % (1–100).');
      if (op === 'edit') return { generic: true, payload, okMsg: 'PR changes saved' };
      const req = [['title', 'Requirement title'], ['categoryId', 'Category'], ['qty', 'Quantity'], ['estValue', 'Estimated value'], ['requiredBy', 'Required date'], ['deptId', 'Department'], ['costCentreId', 'Cost centre'], ['justification', 'Business justification']];
      const miss = req.filter(([k]) => !payload[k] || (typeof payload[k] === 'number' && !(payload[k] > 0)));
      if (miss.length) return need(miss[0][0], 'Complete the required fields: ' + miss.map(m => m[1]).join(', '));
      return { atomic: [['edit', null, payload], ['submit', g.a.id, {}]], okMsg: g.p.returned ? 'PR resubmitted — back to Procurement for review' : `PR submitted — ${g.p.id.replace('PUR', 'PR')}` };
    },

    review(op, v) {
      if (op === 'return') return T(v.remarks) ? { payload: { reason: T(v.remarks) } } : need('remarks', 'Enter the reason for return — the requestor will see it.');
      return { gate: true, payload: { remarks: T(v.remarks) || 'Requirement complete' } };
    },

    approval: decide, selection_approval: decide, po_approve: decide, advance_approve: decide, payment_approval: decide,

    sourcing(op, v, g, ctx) {
      const ids = Object.keys(v.v || {}).filter(k => v.v[k]);
      const nvOn = !!ctx.local['af_new_' + g.a.id];
      const nvRaw = (v.newVendor || {});
      const typed = Object.keys(nvRaw).some(k => T(nvRaw[k]));
      if (nvOn && typed && !T(nvRaw.name)) return need('newVendor.name', 'Enter the new vendor’s name (or close the “Add new vendor” section).');
      const nv = nvOn && T(nvRaw.name) ? { name: T(nvRaw.name), city: T(nvRaw.city), gstin: T(nvRaw.gstin).toUpperCase(), pan: T(nvRaw.pan).toUpperCase(), contact: T(nvRaw.contact) } : null;
      if (!ids.length && !nv) return need(null, 'Select at least one vendor (or add a new vendor).');
      const payload = { vendorIds: ids };
      if (nv) payload.newVendor = nv;
      const single = !!(g.p.flags && g.p.flags.singleSource);
      const min = E.rule(ctx.state, 'R03') ? (Number(E.ruleParam(ctx.state, 'R03', 'minQuotes', 3)) || 3) : 1;
      const n = ids.length + (nv ? 1 : 0);
      if (!single && n < min) return { payload, confirm: { title: 'Fewer vendors than Rule R03 needs', text: `Rule R03 needs <b>${min}</b> quotations before comparison; only <b>${n}</b> vendor${n === 1 ? ' is' : 's are'} shortlisted. Comparison will be blocked unless more quotations arrive. Continue anyway?`, confirmLabel: 'Shortlist anyway' } };
      return { payload, okMsg: `${n} vendor${n === 1 ? '' : 's'} shortlisted` };
    },

    rfq(op, v, g) {
      if (op === 'send') {
        const ids = Object.keys(v.v || {}).filter(k => v.v[k]);
        if (!ids.length) return need(null, 'Select at least one vendor.');
        if (!v.dueDate) return need('dueDate', 'Pick the response due date.');
        if (U.startOfDay(v.dueDate) < U.startOfDay(now())) return need('dueDate', 'The response due date cannot be in the past.');
        return { payload: { vendorIds: ids, dueDate: EOB(v.dueDate) } };
      }
      if (op === 'invite') {
        if (!v.inviteVendor) return need('inviteVendor', 'Select the vendor to invite.');
        return { op: 'send', payload: { vendorIds: [v.inviteVendor], dueDate: EOB(v.inviteDue) }, okMsg: 'RFQ sent' };
      }
      if (op === 'complete') {
        const pend = (g.p.rfqs || []).filter(r => r.status === 'Sent' || r.status === 'Waiting');
        if (pend.length) return { payload: {}, confirm: { title: 'Close the RFQ round?', text: `${pend.length} vendor${pend.length === 1 ? ' has' : 's have'} not responded. Their quotations will not be compared unless recorded later as a direct quotation.`, confirmLabel: 'Close round' } };
        return { payload: {} };
      }
      return { payload: {} };
    },

    quotation(op, v, g, ctx, el) {
      if (op === 'remove') return { payload: { quotationId: el.dataset.qid }, confirm: { title: 'Withdraw this quotation?', text: 'It is excluded from the comparison (kept in the audit trail).', confirmLabel: 'Withdraw', tone: 'danger' }, okMsg: 'Quotation withdrawn' };
      if (op === 'complete') {
        const n = validQuotes(g.p).length;
        const single = !!(g.p.flags && g.p.flags.singleSource);
        const min = single ? 1 : (E.rule(ctx.state, 'R03') ? Number(E.ruleParam(ctx.state, 'R03', 'minQuotes', 3)) || 3 : 1);
        if (n < min) return { payload: {}, confirm: { title: 'Fewer quotations than required', text: `Rule R03 needs <b>${min}</b> quotations; <b>${n}</b> recorded. The comparison step will be blocked. Complete anyway?`, confirmLabel: 'Complete anyway' } };
        return { payload: {} };
      }
      if (!(Number(v.amount) > 0)) return need('amount', 'Enter the quoted basic amount.');
      return { payload: { vendorId: v.vendorId, amount: Number(v.amount), taxPct: v.taxPct == null ? 18 : Number(v.taxPct), deliveryDays: Number(v.deliveryDays) || 0, validityDays: Number(v.validityDays) || 30, paymentTerms: T(v.paymentTerms), warranty: T(v.warranty), commercialTerms: T(v.commercialTerms), specCompliance: v.specCompliance || 'Yes', fileName: v.fileName || null } };
    },

    comparison(op, v, g, ctx) {
      const rank = ranked(g.p);
      const single = !!(g.p.flags && g.p.flags.singleSource);
      const min = single ? 1 : Number(E.ruleParam(ctx.state, 'R03', 'minQuotes', 1));
      const blocked = !!E.rule(ctx.state, 'R03') && rank.length < min;
      const payload = { recommendedVendorId: v.recommendedVendorId || (rank[0] || {}).vendorId, justification: T(v.justification) };
      if (!blocked && (single || (rank[0] && payload.recommendedVendorId !== rank[0].vendorId)) && !payload.justification) return need('justification', single ? 'Single-source purchase: enter the justification.' : 'The recommended vendor is not L1 — enter a justification.');
      return { payload };
    },

    tech_eval(op, v, g) {
      const c = v.c || {};
      const criteria = (g.a.checklist || []).map((name, i) => ({ name, ok: !c[i] || c[i].ok !== '0', remark: T(c[i] && c[i].remark) }));
      const bad = criteria.filter(x => !x.ok);
      const payload = { criteria, remarks: T(v.remarks) };
      if (bad.length) {
        if (bad.some(x => !x.remark) && !payload.remarks) return need('remarks', 'Explain why the offer is not approved (remark or evaluation remarks).');
        const back = (g.p.activities.find(x => x.actionType === 'comparison') || {}).ownerUserId;
        return { payload, confirm: { title: 'Offer not technically approved', text: `Not approved: <b>${esc(bad.map(x => x.name).join(', '))}</b>. The purchase returns to <b>Quotation Comparison</b> (${esc(E.userName(PCT.store.get(), back))}) for a new recommendation.`, confirmLabel: 'Send back to comparison', tone: 'danger' }, okMsg: 'Returned to comparison' };
      }
      return { payload, okMsg: 'Technically approved' };
    },

    selection(op, v, g, ctx) {
      const l1 = (ranked(g.p)[0] || {}).vendorId;
      if (!v.vendorId) return need('vendorId', 'Choose a vendor.');
      if (v.vendorId !== l1 && E.rule(ctx.state, 'R11') && !T(v.reason)) return need('reason', 'Rule R11 — the L1 vendor is not selected. Enter the selection justification.');
      return { payload: { vendorId: v.vendorId, reason: v.vendorId === l1 ? '' : T(v.reason) } };
    },

    po_create(op, v, g, ctx) {
      if (!(Number(v.qty) > 0)) return need('qty', 'Enter the PO quantity.');
      if (!(Number(v.unitPrice) > 0)) return need('unitPrice', 'Enter the unit price.');
      const agreement = !!E.context(ctx.state, g.p).agreementRequired;
      if (agreement && !docOk(doc(g.p, 'D09')) && !v.agreementFileName) return need('agreementFileName', 'This category needs a signed agreement — attach it (Rule R07).');
      return { gate: true, payload: { qty: Number(v.qty), unitPrice: Number(v.unitPrice), taxPct: v.taxPct == null ? 18 : Number(v.taxPct), deliveryDays: Number(v.deliveryDays) || 0, paymentTerms: T(v.paymentTerms), warranty: T(v.warranty), validityDays: Number(v.validityDays) || 30, agreementFileName: v.agreementFileName || null } };
    },

    po_send(op, v) {
      if (op === 'accept') return { payload: { date: dayOrNow(v.date) } };
      return { payload: {} };
    },

    advance_request(op, v, g) {
      const p2 = Number(v.pct);
      if (!(p2 > 0 && p2 <= 100)) return need('pct', 'Enter the advance % between 1 and 100.');
      if (v.amount != null && Number(v.amount) > (g.p.po ? g.p.po.total : Infinity)) return need('amount', 'The advance cannot exceed the PO total.');
      if (!T(v.justification)) return need('justification', 'Enter the business justification for the advance.');
      if (!docOk(doc(g.p, 'D12')) && !v.proformaFileName) return need('proformaFileName', 'Attach the vendor’s proforma invoice (mandatory — Rule R07).');
      const payload = { pct: p2, typeId: v.typeId, justification: T(v.justification), settlementDays: Number(v.settlementDays) || undefined, proformaFileName: v.proformaFileName || null };
      if (Number(v.amount) > 0) payload.amount = Math.round(Number(v.amount));
      return { payload };
    },

    advance_verify(op, v) {
      if (op === 'hold') return T(v.holdReason) ? { payload: { reason: T(v.holdReason) }, direct: collides('hold'), okMsg: 'Advance verification on hold' } : need('holdReason', 'Enter the reason for the hold.');
      if (op === 'resume') return { payload: {}, direct: collides('resume'), okMsg: 'Verification resumed' };
      return { payload: { checklist: v.checklist || {}, remarks: T(v.remarks) } };
    },

    advance_pay(op, v) {
      if (!T(v.utr)) return need('utr', 'Enter the UTR / bank reference.');
      return { payload: { mode: v.mode, bank: v.bank, utr: T(v.utr), date: dayOrNow(v.date) } };
    },

    delivery(op, v, g, ctx) {
      if (op === 'delay') {
        if (!T(v.delayReason)) return need('delayReason', 'Enter the delay reason.');
        return { payload: { reason: T(v.delayReason), newDate: EOB(v.newDate) } };
      }
      if (op === 'update') {
        if (!v.newDate) return need('newDate', 'Pick the revised expected date.');
        return { payload: { expectedDate: EOB(v.newDate) }, okMsg: 'Expected delivery date updated' };
      }
      const qty = Number(v.qty);
      if (!(qty > 0)) return need('qty', 'Enter the quantity delivered.');
      const svc = isSvc(ctx.state, g.p);
      if (!svc && !docOk(doc(g.p, 'D14')) && !v.fileName) return need('fileName', 'Attach the delivery challan (mandatory — Rule R07).');
      const rej = Number(v.rejection) || 0;
      if (rej > qty) return need('rejection', 'Rejected quantity cannot exceed the delivered quantity.');
      if (v.actualDate && U.startOfDay(v.actualDate) > U.startOfDay(now())) return need('actualDate', 'The delivery date cannot be in the future.');
      return { payload: { actualDate: dayOrNow(v.actualDate), qty, quality: v.quality || 'OK', specOk: v.specOk !== false, deliveryNote: T(v.deliveryNote), fileName: v.fileName || null, rejection: rej, partial: !!v.partial, remarks: T(v.remarks) } };
    },

    grn(op, v) {
      const q = Number(v.qty), ac = Number(v.acceptedQty), rj = Number(v.rejectedQty) || 0;
      if (!(q > 0)) return need('qty', 'Enter the received quantity.');
      if (ac + rj !== q) return need('acceptedQty', 'Accepted + rejected quantity must equal the received quantity.');
      return { payload: { receiptDate: dayOrNow(v.receiptDate), qty: q, acceptedQty: ac, rejectedQty: rj, remarks: T(v.remarks) } };
    },

    invoice(op, v, g) {
      if (!T(v.number)) return need('number', 'Enter the vendor invoice number.');
      if ((g.p.invoices || []).some(i => i.number === T(v.number))) return need('number', 'Duplicate invoice number — this invoice is already recorded (possible double billing).');
      if (!(Number(v.qty) > 0)) return need('qty', 'Enter the invoiced quantity.');
      if (!(Number(v.value) > 0)) return need('value', 'Enter the invoice basic value.');
      if (!docOk(doc(g.p, 'D17')) && !v.fileName) return need('fileName', 'Attach the invoice copy (mandatory — Rule R07).');
      return { payload: { number: T(v.number), date: dayOrNow(v.date), qty: Number(v.qty), value: Math.round(Number(v.value)), taxPct: v.taxPct == null ? undefined : Number(v.taxPct), dueDate: EOB(v.dueDate), receivedDate: dayOrNow(v.receivedDate), fileName: v.fileName || null, partial: !!v.partial } };
    },

    invoice_verify(op, v) {
      if (op === 'hold') return T(v.holdReason) ? { payload: { reason: T(v.holdReason), type: v.holdType }, direct: collides('hold'), okMsg: 'Invoice put on hold — exception raised' } : need('holdReason', 'Enter the reason for the hold.');
      if (op === 'resume') return { payload: {}, direct: collides('resume'), okMsg: 'Verification resumed' };
      return { payload: { checklist: v.checklist || {}, remarks: T(v.remarks) } };
    },

    match(op, v, g, ctx) {
      if (op === 'run') return { payload: {} };
      const res = v.resolution;
      const inv = (g.p.invoices || []).find(i => i.id === v.invoiceId) || (g.p.invoices || []).slice(-1)[0] || {};
      if (res === 'accept_variance') {
        if (!T(v.remarks)) return need('remarks', 'Enter the reason for accepting the variance.');
        const spec = { payload: { resolution: res, invoiceId: inv.id, remarks: T(v.remarks) }, confirm: { title: 'Accept the variance?', text: 'The invoice is accepted <b>as billed</b> and released for payment approval. Your approval is recorded in the audit trail.', confirmLabel: 'Accept variance', tone: 'danger' } };
        if (!E.canAct(ctx.state, ctx.user, g.p, g.a)) { spec.direct = true; spec.guard = (s, u, P, cur) => E.canAct(s, u, P, cur) || (u && u.roleId === 'finance' && cur.actionType === 'match' && cur.status === 'Blocked'); }
        return spec;
      }
      if (res === 'revised_invoice') {
        if (!T(v.number)) return need('number', 'Enter the revised invoice number.');
        if ((g.p.invoices || []).some(i => i.id !== inv.id && i.number === T(v.number))) return need('number', 'That invoice number is already used.');
        if (!(Number(v.qty) > 0) || !(Number(v.value) > 0)) return need('qty', 'Enter the revised quantity and value.');
        return { payload: { resolution: res, invoiceId: inv.id, number: T(v.number), qty: Number(v.qty), value: Math.round(Number(v.value)), taxPct: Number(v.taxPct), remarks: T(v.remarks) || 'Revised invoice received' } };
      }
      if (res === 'credit_note') {
        if (!T(v.ref)) return need('ref', 'Enter the credit note number.');
        const cq = Number(v.cnQty) || 0, cv = Number(v.cnValue) || 0;
        if (!(cv > 0)) return need('cnValue', 'Enter the credited value.');
        if (cq > (inv.qty || 0) || cv > (inv.value || 0)) return need('cnQty', 'The credit note cannot exceed the invoice.');
        return { payload: { resolution: res, invoiceId: inv.id, qty: (inv.qty || 0) - cq, value: Math.round((inv.value || 0) - cv), taxPct: inv.taxPct, remarks: `Credit note ${T(v.ref)}: −${cq} units / −${fmt.inr(cv)}${T(v.remarks) ? ' · ' + T(v.remarks) : ''}` } };
      }
      return need(null, 'Choose how to resolve the exception.');
    },

    payment(op, v, g, ctx, el) {
      if (op === 'pay') {
        const processing = el.dataset.variant === 'processing';
        if (!processing && !T(v.utr)) return need('utr', 'Enter the UTR / bank reference — or use “Send to bank” if it is not available yet.');
        const payload = { mode: v.mode, bank: v.bank, utr: T(v.utr), date: dayOrNow(v.date) };
        if (processing) payload.status = 'Processing';
        return { payload };
      }
      if (op === 'confirm') return T(v.cutr) ? { payload: { utr: T(v.cutr) } } : need('cutr', 'Enter the UTR returned by the bank.');
      if (op === 'fail') {
        if (!T(v.failReason)) return need('failReason', 'Enter the failure reason returned by the bank.');
        return { payload: { reason: T(v.failReason) }, confirm: { title: 'Mark the payment as failed?', text: 'The payment is marked <b>Failed</b>, a payment-failure exception is raised and this step stays blocked until the payment is re-processed.', confirmLabel: 'Mark failed', tone: 'danger' } };
      }
      if (op === 'recover') {
        const amt = Number(v.recAmount);
        const own = E.purchaseAdvanceOutstanding(ctx.state, g.p);
        if (!(amt > 0) || amt > own) return need('recAmount', `Recovery must be between ₹1 and ${fmt.inr(own)}.`);
        if (!T(v.recRef)) return need('recRef', 'Enter the receipt / credit note reference.');
        return { payload: { amount: Math.round(amt), ref: T(v.recRef), mode: v.recMode }, okMsg: 'Advance recovered' };
      }
      return { payload: {} };
    },

    adjustment(op, v, g, ctx) {
      if (op === 'complete') {
        const outAmt = E.purchaseAdvanceOutstanding(ctx.state, g.p);
        if (outAmt > 0) return { payload: {}, confirm: { title: 'Advance still outstanding', text: `<b>${esc(fmt.inr(outAmt))}</b> of advance stays outstanding. It must be recovered at Balance Payment, otherwise closure is blocked. Complete the adjustment step?`, confirmLabel: 'Complete adjustment' } };
        return { payload: {} };
      }
      const amt = Math.round(Number(v.amount) || 0);
      if (!(amt > 0)) return need('amount', 'Enter the amount to adjust.');
      const adv = E.advance(ctx.state, v.advanceId) || lastAdvance(ctx.state, g.p);
      const inv = (g.p.invoices || []).find(i => i.id === v.invoiceId);
      if (adv && amt > E.advanceOutstanding(adv)) return need('amount', `Cannot adjust more than the outstanding advance (${fmt.inr(E.advanceOutstanding(adv))}).`);
      if (inv && amt > inv.total - inv.paidAmount - inv.adjustedAmount) return need('amount', `Cannot adjust more than the invoice open balance (${fmt.inr(inv.total - inv.paidAmount - inv.adjustedAmount)}).`);
      return { payload: { advanceId: v.advanceId || undefined, invoiceId: v.invoiceId || undefined, amount: amt, remarks: T(v.remarks) } };
    },

    closure(op, v) { return { payload: { remarks: T(v.remarks) } }; }
  };
  B.balance_payment = B.payment;

  /* =================================================================
     ACTIONS (dispatched by the app for any data-act / data-act-change /
     data-act-input / data-submit starting with "af-")
     ================================================================= */
  const A = {
    /** Main action: data-op on a button inside the activity panel. */
    'af-op': async function (ctx, el) {
      if (el.disabled) return;
      const g = grab(ctx, el);
      if (!g || !g.a) return;
      const op = el.dataset.op;
      const build = B[g.a.actionType] || B.task;
      let spec;
      try { spec = build(op, g.v, g, ctx, el) || { payload: {} }; } catch (e) { console.error(e); ctx.toast(e.message, 'red', 'Error'); return; }
      if (spec.error) { invalid(ctx, g.form, spec.field, spec.error); return; }
      spec.payload = spec.payload || {};
      if (spec.gate) {
        const miss = unticked(g.form);
        if (miss.length) {
          const ok = await ui.confirm({ title: 'Checklist not complete', text: `${miss.length} item${miss.length === 1 ? ' is' : 's are'} not ticked: <b>${esc(miss.join(', '))}</b>. Continue anyway? This is recorded with your remarks.`, confirmLabel: 'Continue' });
          if (!ok) return;
          spec.payload.remarks = [spec.payload.remarks, `Checklist not ticked: ${miss.join(', ')}`].filter(Boolean).join(' · ');
        }
      }
      if (spec.confirm) { const ok = await ui.confirm(spec.confirm); if (!ok) return; }
      let res;
      if (spec.atomic) res = atomic(ctx, g.p, spec.atomic, spec.okMsg);
      else if (spec.direct) res = direct(ctx, g.p, g.a, spec.op || op, spec.payload, spec.guard, spec.okMsg);
      else res = run(ctx, g.p.id, spec.generic ? null : g.a.id, spec.op || op, spec.payload, spec.okMsg);
      if (res && !res.ok && spec.onFail) { try { spec.onFail(res, g); } catch (e) { /* ignore */ } }
    },

    /** Requestor answers a clarification (generic op). */
    'af-clarify'(ctx, el) {
      const g = grab(ctx, el); if (!g) return;
      const r = T(g.v.response);
      if (!r) { invalid(ctx, g.form, 'response', 'Write your answer to the question.'); return; }
      ctx.act(g.p.id, null, 'clarify_response', { response: r }, 'Answer sent — the approver can continue');
    },

    /** RFQ tracker row actions. */
    async 'af-rfq-row'(ctx, el) {
      const g = grab(ctx, el); if (!g) return;
      const op = el.dataset.op, rfqId = el.dataset.rfq;
      const r = (g.p.rfqs || []).find(x => x.id === rfqId);
      if (!r) return;
      const vn = vname(ctx.state, r.vendorId);
      if (op === 'followup' || op === 'received') {
        ui.modal.open({
          title: op === 'followup' ? `Follow up — ${esc(vn)}` : `Response received — ${esc(vn)}`,
          body: op === 'followup'
            ? `<p class="muted">${esc(r.id)} · sent ${esc(fmt.date(r.rfqDate))} · due ${esc(fmt.date(r.dueDate))} · ${(r.followUps || []).length} earlier follow-up(s)</p>${ui.field({ name: 'note', label: 'Follow-up note', type: 'textarea', rows: 3, value: 'Reminder sent by e-mail; vendor promised to respond.', full: true })}`
            : `<p class="muted">${esc(r.id)} · sent ${esc(fmt.date(r.rfqDate))}. Record the quotation details in the next step.</p>${ui.field({ name: 'date', label: 'Received on', type: 'date', value: now() })}`,
          actions: [{ label: 'Cancel', act: 'close' }, { label: op === 'followup' ? 'Log follow-up' : 'Mark received', act: 'ok', tone: 'primary' }],
          onAction: {
            ok: vals => {
              const payload = op === 'followup' ? { rfqId, note: T(vals.note) } : { rfqId, date: dayOrNow(vals.date) || now() };
              const res = ctx.act(g.p.id, g.a.id, op, payload);
              return res && res.ok ? undefined : false;
            }
          }
        });
        return;
      }
      const ok = await ui.confirm(op === 'expire'
        ? { title: `Expire RFQ for ${esc(vn)}?`, text: 'The vendor did not respond in time. The RFQ is marked <b>Expired</b> and excluded from this round.', confirmLabel: 'Expire RFQ' }
        : { title: `Cancel RFQ for ${esc(vn)}?`, text: 'The RFQ is withdrawn from this vendor (kept in the audit trail).', confirmLabel: 'Cancel RFQ', tone: 'danger' });
      if (!ok) return;
      if (op === 'cancel' && collides('cancel')) direct(ctx, g.p, g.a, 'cancel', { rfqId }, null, `RFQ to ${vn} cancelled`);
      else ctx.act(g.p.id, g.a.id, op, { rfqId }, op === 'expire' ? `RFQ to ${vn} expired` : `RFQ to ${vn} cancelled`);
    },

    /** Upload a missing mandatory document (closure). */
    'af-upload'(ctx, el) {
      const g = grab(ctx, el); if (!g) return;
      const docId = el.dataset.doc, name = el.dataset.name;
      ui.modal.open({
        title: `Upload — ${esc(name)}`,
        body: ui.field({ name: 'fileName', label: name, type: 'file', sample: `${String(name).replace(/[^A-Za-z0-9]+/g, '_')}_${g.p.id}.pdf`, full: true }),
        actions: [{ label: 'Cancel', act: 'close' }, { label: 'Upload', act: 'ok', tone: 'primary' }],
        onAction: { ok: vals => { if (!vals.fileName) { ui.toast('Choose a file or use the sample.', 'red'); return false; } const res = ctx.act(g.p.id, null, 'upload_doc', { docId, fileName: vals.fileName }); return res && res.ok ? undefined : false; } }
      });
    },

    /** Live totals: container has data-calc + data-act-input/change="af-calc". */
    'af-calc'(ctx, el, ev) {
      const f = el.closest('[data-calc]') || el;
      const t = ev && ev.target;
      if (t && t.closest) { const w = t.closest('.af-err'); if (w) w.classList.remove('af-err'); }
      runCalc(f, { target: t });
    },
    /** Checklist tick → style + counter (+ calc of the surrounding form). */
    'af-check'(ctx, el) {
      const l = el.closest('.check'); if (l) l.classList.toggle('done', el.checked);
      const c = el.closest('.af-checks'); if (c) updateCount(c);
      const f = el.closest('[data-calc]'); if (f) runCalc(f, { target: el });
    },
    /** Vendor picker tick → remember selection (survives sorting) + live count. */
    'af-vpick'(ctx, el) {
      const f = el.closest('[data-calc]'); if (!f) return;
      ctx.local[f.dataset.selkey] = Array.from(f.querySelectorAll('input[name^="v."]')).filter(i => i.checked).map(i => i.name.slice(2));
      runCalc(f, { target: el });
    },
    /** Show / hide a section without re-rendering (keeps typed values). */
    'af-toggle'(ctx, el) {
      const key = el.dataset.key;
      const on = !ctx.local[key];
      ctx.local[key] = on;
      const box = el.closest('[data-af]') || document;
      box.querySelectorAll(`[data-toggle="${key}"], .af-tg-${slug(key)}`).forEach(x => x.classList.toggle('af-hidden', x.dataset.invert ? on : !on));
      box.querySelectorAll(`[data-act="af-toggle"][data-key="${key}"]`).forEach(b => b.setAttribute('aria-expanded', on ? 'true' : 'false'));
      box.querySelectorAll('[data-calc]').forEach(f => runCalc(f, { passive: true }));
      if (on) { const first = box.querySelector(`[data-toggle="${key}"] input:not([type=hidden]):not([type=checkbox]), [data-toggle="${key}"] textarea`); if (first) setTimeout(() => first.focus(), 20); }
    },
    /** Choice cards (3-way match resolution). */
    'af-choice'(ctx, el) {
      const grp = el.closest('[data-choices]'); if (!grp) return;
      const key = grp.dataset.choices, v = el.dataset.value;
      ctx.local[key] = v;
      grp.querySelectorAll('.choice').forEach(c => c.classList.toggle('active', c === el));
      const box = el.closest('[data-af]') || document;
      box.querySelectorAll(`[data-panel-of="${key}"]`).forEach(pn => pn.classList.toggle('af-hidden', pn.dataset.panel !== v));
      box.querySelectorAll(`[data-panel-of="${key}"] [data-calc]`).forEach(f => runCalc(f, { passive: true }));
    }
  };

  PCT.actionForms = { render, available, actions: A, renderers: R };
})();
