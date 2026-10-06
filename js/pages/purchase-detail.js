/* =====================================================================
   PURCHASE DETAIL — the single control page for one purchase.
   #/purchases/PUR-2026-00125[?tab=action|overview|activities|documents|
     approvals|vendor|po|delivery|payments|exceptions|comments|audit]

   Header (what / value / status) → WHO HAS THE BALL → process stepper →
   tabs. Every change goes through ctx.act (generic ops, activityId null)
   or ctx.commit(state => engine fn) so it is validated and audited.
   ===================================================================== */
(function () {
  const U = PCT.util;
  const fmt = U.fmt;
  const esc = U.esc;
  const I = (n, s) => PCT.icon(n, s);
  const E = PCT.engine;
  const S = PCT.sel;
  const ui = PCT.ui;

  const LIVE = ['Open', 'On Hold', 'Draft'];
  const PO_ISSUED = ['Sent', 'Vendor Accepted', 'Partially Completed', 'Completed'];
  const EXC_TYPES = ['Missing document', 'Approval overdue', 'Vendor delay', 'Price mismatch', 'Quantity mismatch', 'Tax mismatch', 'Invoice mismatch', 'Advance overdue', 'Payment failure', 'PO expired', 'Other'];
  const TAB_IDS = ['action', 'overview', 'activities', 'documents', 'approvals', 'vendor', 'po', 'delivery', 'payments', 'exceptions', 'comments', 'audit'];

  /* ---------------- small helpers ---------------- */
  const nm = (state, uid) => (!uid || uid === 'system') ? 'System' : E.userName(state, uid);
  const dt = t => t ? fmt.date(t) : '—';
  const dtt = t => t ? fmt.dateTime(t) : '—';
  const muted = t => `<span class="muted">${esc(t)}</span>`;
  const dash = '<span class="muted">—</span>';
  const mono = t => t ? `<span class="mono">${esc(t)}</span>` : dash;
  const num = v => fmt.num(v);
  const yesNo = (v, onTone) => v ? ui.badge('Yes', onTone || 'blue', { dot: false }) : ui.badge('No', 'grey', { dot: false });
  const when = (state, t, uid) => t ? `${esc(fmt.date(t))}${uid ? ` <span class="muted">· ${esc(nm(state, uid))}</span>` : ''}` : dash;
  /** Plain-language reason for a skipped activity / stage (conditions come from the process master). */
  function skipReason(a) {
    const r = (a && a.remarks) || '';
    if (/techEval/.test(r)) return 'Category does not require technical evaluation';
    if (/lowestSelected/.test(r)) return 'Lowest-price (L1) vendor selected — no extra approval needed';
    if (/advanceRequired/.test(r)) return 'Depends on whether a vendor advance is required';
    return r ? r.replace(/^Condition not met:\s*/, 'Condition not met: ') : 'Not required for this purchase';
  }
  function stageRule(cond) {
    if (!cond) return '';
    if (cond.field === 'flags.advanceRequired') return cond.op === 'truthy' ? 'applies only when a vendor advance is paid' : 'applies only when there is no vendor advance (advances settle through Advance Adjustment and Balance Payment)';
    return 'applies when ' + E.describeCond(cond);
  }
  const who = (state, uid) => (!uid || uid === 'system') ? '<span class="muted">System</span>' : ui.person(state, uid);
  const isOpenEx = e => e.status === 'Open' || e.status === 'In Progress';
  /** Definition list: rows [[label, html]] (null/'' → —; falsy row skipped) */
  const kv = (rows, cls) => `<dl class="kv ${cls || ''}">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? dash : v}</dd>`).join('')}</dl>`;
  /** Badge whose colour comes from the Status Master of another kind (approvals / documents are not in the master). */
  const toneBadge = (state, label, kind, as) => ui.badge(label, S.statusTone(state, kind, as || label));
  const vendorName = (state, id) => S.vendorName(state, id);
  const docTone = st => ({ Missing: 'red', Upcoming: 'grey', Received: 'blue', Verified: 'green', 'Not Required': 'grey' })[st] || 'grey';
  const sevTone = s => ({ High: 'red', Medium: 'orange', Low: 'grey' })[s] || 'grey';
  const days1 = ms => Math.round(ms / U.DAY * 10) / 10;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function getPurchase(ctx) {
    const state = PCT.store.get();
    const p = E.purchase(state, ctx.params[0]);
    if (!p || !ctx.user) return null;
    if (!S.visiblePurchases(state, ctx.user).some(x => x.id === p.id)) return null;
    return p;
  }

  /** What may this viewer do on this purchase? Mirrors the engine's own checks so buttons never lie. */
  function rights(ctx, p) {
    const { state, user } = ctx;
    const a = E.currentActivity(p);
    const live = LIVE.includes(p.status);
    const isHead = (E.dept(state, p.deptId) || {}).headUserId === user.id;
    const controller = ctx.can(['admin', 'procure', 'finance']) || isHead;
    const involved = p.requestorId === user.id || (p.activities || []).some(x => x.ownerUserId === user.id || x.completedBy === user.id);
    const poIssued = !!(p.po && PO_ISSUED.includes(p.po.status));
    return {
      hold: p.status === 'Open' && !!a && controller,
      resume: p.status === 'On Hold' && controller,
      reassign: (p.status === 'Open' || p.status === 'On Hold') && !!a && controller,
      cancel: live && !poIssued && (user.id === p.requestorId || ctx.can(['admin', 'procure'])),
      cancelBlockedByPo: live && poIssued && (user.id === p.requestorId || ctx.can(['admin', 'procure'])),
      upload: live && (involved || ctx.can(['procure', 'finance', 'receive', 'admin'])),
      verify: p.status !== 'Cancelled' && p.status !== 'Rejected' && ctx.can(['finance', 'procure', 'admin']),
      raise: p.status !== 'Cancelled' && (involved || ctx.can(['procure', 'finance', 'receive', 'admin', 'approve'])),
      comment: true
    };
  }

  /* =================================================================
     PAGE
     ================================================================= */
  PCT.pages.register({
    route: 'purchases/:id',
    match: path => /^purchases\/(PUR-[^/]+)$/.test(path),
    title: 'Purchase',
    render(ctx) {
      const { state, user } = ctx;
      const id = ctx.params[0];
      const p = E.purchase(state, id);
      if (!p) return notFound(id);
      if (!S.visiblePurchases(state, user).some(x => x.id === p.id)) return noAccess(ctx, id);

      const a = E.currentActivity(p);
      const canAct = !!a && E.canAct(state, user, p, a);
      const R = rights(ctx, p);
      const tabs = tabList(ctx, p, canAct);

      // Tab memory: ?tab= wins once per navigation; otherwise keep the user's choice; default = action if it is your turn.
      const qk = p.id + '|' + (ctx.query.tab || '');
      if (ctx.local.qk !== qk) { ctx.local.qk = qk; ctx.local.tab = TAB_IDS.includes(ctx.query.tab) ? ctx.query.tab : null; }
      if (!ctx.local.tab || !tabs.some(t => t.id === ctx.local.tab)) ctx.local.tab = canAct ? 'action' : 'overview';
      const tab = ctx.local.tab;

      const render = {
        action: tabAction, overview: tabOverview, activities: tabActivities, documents: tabDocuments, approvals: tabApprovals,
        vendor: tabVendor, po: tabPO, delivery: tabDelivery, payments: tabPayments, exceptions: tabExceptions,
        comments: tabComments, audit: tabAudit
      }[tab];

      return `<div class="pd">
        ${header(ctx, p, R)}
        ${banners(ctx, p)}
        <div class="mt-12">${ballSection(ctx, p, a, canAct, R)}</div>
        <div class="mt-12">${stepperCard(ctx, p)}</div>
        <div class="mt-16 pd-tabs">${ui.tabs('tab', tabs, tab)}</div>
        <div class="mt-16 pd-body">${render(ctx, p, a, canAct, R)}</div>
      </div>`;
    },

    /** Keep the current stage in view on narrow screens / long processes. */
    after(ctx, root) {
      const st = root.querySelector('.pd .stepper');
      const cur = st && st.querySelector('.step.current, .step.overdue, .step.blocked');
      if (st && cur && st.scrollWidth > st.clientWidth) {
        const x = cur.getBoundingClientRect().left - st.getBoundingClientRect().left + st.scrollLeft;
        st.scrollLeft = Math.max(0, x - st.clientWidth / 2 + cur.offsetWidth / 2);
      }
      const bar = root.querySelector('.pd-tabs .tabs');
      const at = bar && bar.querySelector('.tab.active');
      if (bar && at && bar.scrollWidth > bar.clientWidth) {
        const x = at.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;
        if (x < bar.scrollLeft || x + at.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = Math.max(0, x - 24);
      }
    },

    actions: {
      /* Demo: become the ball owner in THIS tab and stay on this purchase */
      'pd-switch-user'(ctx, el) {
        const st = PCT.store.get();
        const u = E.user(st, el.dataset.user);
        if (!u || u.status !== 'Active') return;
        PCT.store.session.setUser(u.id);
        if (location.search) history.replaceState(null, '', location.pathname + location.hash); // ?as= would override the session
        ctx.local.tab = null; // re-evaluate default tab (action when it is their turn)
        PCT.app.render();
        ui.toast(`Signed in as ${u.name} — this is their view of the purchase`, 'navy', 'Demo user switched');
      },
      'pd-hold'(ctx, el) {
        closeMenus(el);
        const p = getPurchase(ctx); if (!p) return;
        ui.modal.open({
          title: `Put ${esc(p.id)} on hold`,
          body: `${ui.alert('warn', 'The current activity is blocked and nobody can act until the purchase is resumed. SLA escalations keep running so the hold stays visible.')}
            <div class="form-grid cols-1 mt-12">${ui.field({ name: 'reason', label: 'Reason for hold', type: 'textarea', required: true, placeholder: 'e.g. Budget re-validation requested by Finance', full: true })}</div>`,
          actions: [{ label: 'Cancel', act: 'close' }, { label: 'Put on hold', act: 'save', tone: 'warn', icon: 'pause' }],
          onAction: {
            save: v => {
              if (!String(v.reason || '').trim()) { ui.toast('Enter the reason for the hold.', 'red', 'Required'); return false; }
              const r = ctx.act(p.id, null, 'hold', { reason: v.reason.trim() }, `${p.id} is on hold`);
              return r && r.ok ? undefined : false;
            }
          }
        });
      },
      'pd-resume'(ctx, el) {
        closeMenus(el);
        const p = getPurchase(ctx); if (!p) return;
        const a = E.currentActivity(p);
        ui.modal.open({
          title: `Resume ${esc(p.id)}`,
          body: `<p>Work continues with <b>${esc(a ? nm(ctx.state, a.ownerUserId) : '—')}</b> on <b>${esc(a ? a.name : '—')}</b>.</p>
            <div class="form-grid cols-1 mt-12">${ui.field({ name: 'reason', label: 'Reason / resolution of the hold', type: 'textarea', required: true, placeholder: 'e.g. Budget re-validated — ₹4.5L available', full: true })}</div>`,
          actions: [{ label: 'Cancel', act: 'close' }, { label: 'Resume purchase', act: 'save', tone: 'success', icon: 'play' }],
          onAction: {
            save: v => {
              const reason = String(v.reason || '').trim();
              if (!reason) { ui.toast('Enter the reason for resuming.', 'red', 'Required'); return false; }
              const uid = ctx.user.id;
              const r = ctx.commit(s => {
                const res = E.act(s, p.id, null, 'resume', { reason }, uid);
                if (!res.ok) return res;
                // Engine's resume does not record a reason — keep it in the audit trail (once).
                const last = s.audit.slice().reverse().find(x => x.purchaseId === p.id && x.field === 'status' && x.next === 'Open');
                if (!last || last.note !== reason) E.audit(s, { userId: uid, action: 'Resumed', entity: 'Purchase', entityId: p.id, purchaseId: p.id, field: 'hold resolution', prev: 'On Hold', next: 'Open', note: reason });
                return { ok: true };
              }, `${p.id} resumed`);
              return r && r.ok !== false ? undefined : false;
            }
          }
        });
      },
      'pd-reassign'(ctx, el) {
        closeMenus(el);
        const p = getPurchase(ctx); if (!p) return;
        const a = E.currentActivity(p); if (!a) return;
        const st = ctx.state;
        const roleName = id => (E.role(st, id) || {}).name || id;
        const opts = U.sortBy(st.masters.users.filter(u => u.status === 'Active' && u.id !== a.ownerUserId && !(a.approval && u.id === p.requestorId)), u => roleName(u.roleId) + u.name)
          .map(u => ({ value: u.id, label: `${u.name} — ${roleName(u.roleId)} · ${S.deptName(st, u.deptId)}` }));
        ui.modal.open({
          title: 'Reassign current activity',
          body: `<div class="kv mb-12"><dt>Activity</dt><dd>${esc(a.name)}</dd><dt>Current owner</dt><dd>${esc(nm(st, a.ownerUserId))}</dd><dt>Due</dt><dd>${ui.due(a.dueAt)}</dd></div>
            <div class="form-grid cols-1">
              ${ui.field({ name: 'userId', label: 'New owner', type: 'select', options: opts, required: true, placeholder: 'Select an active user', full: true, hint: a.approval ? 'Segregation of duties: the requestor cannot receive an approval.' : '' })}
              ${ui.field({ name: 'reason', label: 'Reason', type: 'textarea', required: true, placeholder: 'e.g. Owner on leave until Friday', full: true })}
            </div>`,
          actions: [{ label: 'Cancel', act: 'close' }, { label: 'Reassign', act: 'save', tone: 'primary', icon: 'users' }],
          onAction: {
            save: v => {
              if (!v.userId) { ui.toast('Select the new owner.', 'red', 'Required'); return false; }
              if (!String(v.reason || '').trim()) { ui.toast('Enter the reason for reassignment.', 'red', 'Required'); return false; }
              const r = ctx.act(p.id, null, 'reassign', { activityId: a.id, userId: v.userId, reason: v.reason.trim() });
              return r && r.ok ? undefined : false;
            }
          }
        });
      },
      'pd-cancel'(ctx, el) {
        closeMenus(el);
        const p = getPurchase(ctx); if (!p) return;
        ui.modal.open({
          title: `Cancel ${esc(p.id)}`,
          body: `${ui.alert('danger', '<b>This cannot be undone.</b> The purchase is closed as Cancelled, the current activity stops, and the cancellation is recorded in the audit trail.')}
            <div class="form-grid cols-1 mt-12">${ui.field({ name: 'reason', label: 'Cancellation reason', type: 'textarea', required: true, placeholder: 'e.g. Requirement no longer needed — project deferred', full: true })}</div>`,
          actions: [{ label: 'Keep purchase', act: 'close' }, { label: 'Cancel purchase', act: 'save', tone: 'danger', icon: 'ban' }],
          onAction: {
            save: v => {
              if (!String(v.reason || '').trim()) { ui.toast('Enter the cancellation reason.', 'red', 'Required'); return false; }
              const r = ctx.act(p.id, null, 'cancel', { reason: v.reason.trim() }, `${p.id} cancelled`);
              return r && r.ok ? undefined : false;
            }
          }
        });
      },
      'pd-print'(ctx, el) { closeMenus(el); setTimeout(() => window.print(), 50); },
      'pd-export-audit'(ctx, el) {
        closeMenus(el);
        const p = getPurchase(ctx); if (!p) return;
        const st = PCT.store.get();
        const rows = auditRows(st, p);
        const cols = [
          { key: 'iso', label: 'Timestamp (ISO)', value: r => new Date(r.t).toISOString() },
          { key: 'when', label: 'When', value: r => fmt.dateTime(r.t) + ' ' + new Date(r.t).getFullYear() },
          { key: 'user', label: 'User', value: r => nm(st, r.userId) },
          { key: 'userId', label: 'User ID', value: r => r.userId || 'system' },
          { key: 'action', label: 'Action' },
          { key: 'entity', label: 'Entity' },
          { key: 'entityId', label: 'Entity ID' },
          { key: 'field', label: 'Field' },
          { key: 'prev', label: 'Previous value' },
          { key: 'next', label: 'New value' },
          { key: 'note', label: 'Note' }
        ];
        U.download(`Audit_${p.id}.csv`, '﻿' + U.toCSV(rows, cols), 'text/csv;charset=utf-8');
        ui.toast(`${rows.length} audit entries exported`, 'green', `Audit_${p.id}.csv`);
      },
      'pd-upload'(ctx, el) {
        const p = getPurchase(ctx); if (!p) return;
        openUpload(ctx, p, el.dataset.doc || null);
      },
      'pd-verify'(ctx, el) {
        const p = getPurchase(ctx); if (!p) return;
        const d = (p.documents || []).find(x => x.docId === el.dataset.doc); if (!d) return;
        ui.modal.open({
          title: `Verify ${esc(d.name)}`,
          body: `<p>You confirm that <b>${esc(d.fileName || d.name)}</b> is complete, legible and matches the purchase ${esc(p.id)}.</p><p class="muted small">Verification is recorded with your name and time in the audit trail.</p>`,
          actions: [{ label: 'Cancel', act: 'close' }, { label: 'Mark verified', act: 'ok', tone: 'success', icon: 'checkCircle' }],
          onAction: { ok: () => { const r = ctx.act(p.id, null, 'verify_doc', { docId: d.docId }, `${d.name} verified`); return r && r.ok ? undefined : false; } }
        });
      },
      'pd-raise'(ctx) {
        const p = getPurchase(ctx); if (!p) return;
        openRaise(ctx, p);
      },
      'pd-comment'(ctx, form) {
        const p = getPurchase(ctx); if (!p) return;
        const v = ui.formValues(form);
        const text = String(v.text || '').trim();
        if (!text) { ui.toast('Write a comment first.', 'red', 'Not saved'); return; }
        ctx.act(p.id, null, 'comment', { text }, 'Comment posted');
      },
      'pd-clarify'(ctx, form) {
        const p = getPurchase(ctx); if (!p) return;
        const v = ui.formValues(form);
        const response = String(v.response || '').trim();
        if (!response) { ui.toast('Enter your response.', 'red', 'Not saved'); return; }
        ctx.act(p.id, null, 'clarify_response', { response }, 'Clarification sent — the ball is back with the approver');
      },
      'pd-audit-filter'(ctx, el) { ctx.local.auditEntity = el.value; ctx.rerender(); },
      'pd-goto'(ctx, el) { ctx.local.tab = el.dataset.tab; ctx.rerender(); window.scrollTo({ top: Math.max(0, (document.querySelector('.pd-tabs') || { offsetTop: 0 }).offsetTop - 70), behavior: 'smooth' }); }
    }
  });

  /* Close the "More" menu when clicking outside it (native <details>, no re-render needed). */
  function closeMenus(el) { const d = el && el.closest && el.closest('details'); if (d) d.removeAttribute('open'); }
  document.addEventListener('click', ev => {
    document.querySelectorAll('details.pd-more[open]').forEach(d => { if (!d.contains(ev.target)) d.removeAttribute('open'); });
  });

  /* =================================================================
     GUARDS
     ================================================================= */
  function notFound(id) {
    return crumbs(id) + ui.card({ body: ui.empty('search', 'Purchase not found', `No purchase with ID <b class="mono">${esc(id)}</b>. Check the ID or search for it from the top bar.`, '<a class="btn btn-primary mt-8" href="#/purchases">Go to purchases</a>') });
  }
  function noAccess(ctx, id) {
    return crumbs(id) + ui.card({
      body: ui.empty('lock', 'You do not have access to this purchase',
        `<b class="mono">${esc(id)}</b> is outside your visibility. You can see purchases you raised, purchases you work on${ctx.can('purchase.view_dept') ? ', and purchases of your department' : ''}. Signed in as ${esc(ctx.user.name)} (${esc((ctx.role || {}).name || '')}).`,
        '<a class="btn btn-primary mt-8" href="#/purchases">Go to purchases</a>')
    });
  }
  function crumbs(id) { return `<div class="crumbs"><a href="#/purchases">Purchases</a>${I('chevronRight', 12)}<span class="mono">${esc(id)}</span></div>`; }

  /* =================================================================
     HEADER
     ================================================================= */
  function header(ctx, p, R) {
    const { state } = ctx;
    const ver = E.version(state, p.processVersion, p.processId) || {};
    const value = p.po ? p.po.total : p.estValue;
    const verLabel = `Process V${p.processVersion}${ver.status && ver.status !== 'Active' ? ' · ' + ver.status : ''}`;
    const verTitle = ver.status === 'Retired' ? 'This purchase stays on the process version it started under (retired since ' + (ver.retiredDate || '—') + ').' : 'Process version this purchase follows';

    const more = [];
    more.push(`<button class="mi" data-act="pd-print">${I('file', 15)} Print purchase file</button>`);
    more.push(`<button class="mi" data-act="pd-export-audit">${I('download', 15)} Export audit (CSV)</button>`);
    if (R.cancel) more.push(`<hr><button class="mi" data-act="pd-cancel" style="color:var(--red)">${I('ban', 15)} Cancel purchase</button>`);
    else if (R.cancelBlockedByPo) more.push(`<hr><div class="mi muted" title="The PO has already been issued to the vendor">${I('ban', 15)} Cancel — PO already issued</div>`);

    const btns = [];
    if (R.hold) btns.push(`<button class="btn btn-sm btn-warn" data-act="pd-hold">${I('pause', 14)} Hold</button>`);
    if (R.resume) btns.push(`<button class="btn btn-sm btn-success" data-act="pd-resume">${I('play', 14)} Resume</button>`);
    if (R.reassign) btns.push(`<button class="btn btn-sm" data-act="pd-reassign">${I('users', 14)} Reassign</button>`);
    btns.push(`<details class="pd-more"><summary class="btn btn-sm" aria-label="More actions">${I('more', 14)} More</summary><div class="menu">${more.join('')}</div></details>`);

    const facts = [
      ['Value', `<span class="pd-value">${ui.money(value)}</span><small class="muted">${p.po ? `PO value${p.po.total !== p.estValue ? ` · est. ${esc(fmt.inr(p.estValue))}` : ''}` : 'Estimated value'}</small>`],
      ['PR number', p.prNo ? mono(p.prNo) : muted('Not submitted')],
      ['Category', esc(S.catName(state, p.categoryId))],
      ['Department', esc(S.deptName(state, p.deptId))],
      ['Cost centre', esc(S.ccName(state, p.costCentreId))],
      ['Requestor', esc(nm(state, p.requestorId))]
    ];

    return `<div class="crumbs pd-crumbs"><a href="#/purchases">Purchases</a>${I('chevronRight', 12)}<span class="mono">${esc(p.id)}</span></div>
      <section class="card pd-head">
        <div class="pd-top">
          <div class="grow">
            <div class="row wrap">
              <span class="pd-id" title="Purchase ID">${esc(p.id)}</span>
              ${ui.status(state, 'purchase', p.status)}
              ${ui.priority(state, p.priority)}
              <span class="tag" title="${esc(verTitle)}">${esc(verLabel)}</span>
              ${p.flags && p.flags.emergency ? ui.badge('Emergency', 'red') : ''}
            </div>
            <h1 class="pd-title">${esc(p.title || 'Untitled purchase')}</h1>
          </div>
          <div class="page-actions pd-actions">${btns.join('')}</div>
        </div>
        <div class="pd-facts">${facts.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>
      </section>`;
  }

  function banners(ctx, p) {
    const { state } = ctx;
    const out = [];
    if (p.status === 'Rejected') {
      const l = (p.approvals || []).find(x => x.status === 'Rejected');
      out.push(ui.alert('danger', `<b>Rejected${l ? ` at L${l.level} ${esc(l.label)} by ${esc(nm(state, l.userId))}` : ''}</b>${p.closedAt ? ` on ${esc(fmt.date(p.closedAt))}` : ''}${l && l.remarks ? ` — “${esc(l.remarks)}”` : ''}`));
    } else if (p.status === 'Cancelled') {
      const a = (p.activities || []).find(x => x.status === 'Rejected' && /^Cancelled:/.test(x.remarks || ''));
      const au = state.audit.slice().reverse().find(x => x.purchaseId === p.id && x.next === 'Cancelled');
      out.push(ui.alert('danger', `<b>Cancelled${au ? ` by ${esc(nm(state, au.userId))}` : ''}</b>${p.closedAt ? ` on ${esc(fmt.date(p.closedAt))}` : ''}${a ? ` — ${esc(a.remarks.replace(/^Cancelled:\s*/, ''))}` : au && au.note ? ` — ${esc(au.note)}` : ''}`));
    } else if (p.status === 'Draft') {
      out.push(ui.alert('info', `<b>Draft.</b> This purchase request has not been submitted yet — the requestor must submit it to start approvals.`));
    }
    if (p.returned && LIVE.includes(p.status)) {
      out.push(ui.alert('warn', `<b>Returned to requestor</b> at ${esc(p.returned.stage || '—')} by ${esc(nm(state, p.returned.by))} on ${esc(fmt.date(p.returned.at))} — “${esc(p.returned.reason || '')}”`));
    }
    return out.length ? `<div class="stack-sm mt-12">${out.join('')}</div>` : '';
  }

  /* =================================================================
     WHO HAS THE BALL + signals
     ================================================================= */
  function ballSection(ctx, p, a, canAct, R) {
    const { state, user } = ctx;
    const b = E.ball(state, p);
    let foot = '';
    if (!b.closed && a) {
      if (canAct) {
        const pool = b.ownerUserId !== user.id;
        foot = ctx.local.tab !== 'action'
          ? `<button class="btn btn-primary btn-sm" data-act="pd-goto" data-tab="action">${I('zap', 14)} Open your action</button>`
          : `<span class="small" style="color:var(--blue-600);font-weight:600">${I('arrowDown', 13)} ${pool ? 'You can pick this up for your team — ' : ''}Your action is below</span>`;
      } else if (p.status === 'On Hold') {
        foot = `<span class="small muted pd-ballnote">Work is paused while the purchase is on hold. ${R.resume ? 'Use <b>Resume</b> at the top once the hold reason is cleared.' : 'Procurement, Finance or the department head can resume it.'}</span>`;
      } else if (b.ownerUserId && b.ownerUserId !== user.id) {
        foot = `<span class="small muted pd-ballnote">The ball is with <b style="color:var(--ink)">${esc(b.ownerName)}</b>. You will see an action here when it is your turn.</span>
          <button class="btn btn-sm" data-act="pd-switch-user" data-user="${esc(b.ownerUserId)}" title="Demo only: view this purchase as the current owner">${I('user', 14)} Switch to ${esc(b.ownerName)} (demo)</button>`;
      } else {
        foot = `<span class="small muted pd-ballnote">${esc(b.nextAction || '')}</span>`;
      }
    }
    const card = ui.ballCard(state, p, { viewer: user, actions: foot || null });

    // What is blocking / needs attention — one click to the right tab
    const openEx = state.exceptions.filter(e => e.purchaseId === p.id && isOpenEx(e));
    const advOut = E.purchaseAdvanceOutstanding(state, p);
    const ds = S.documentSummary(state, p);
    const sig = [];
    const chip = (tone, icon, text, tab) => `<button class="chip pd-sig tone-${tone}" data-act="pd-goto" data-tab="${tab}">${I(icon, 13)} ${text}</button>`;
    if (openEx.length) sig.push(chip('red', 'alert', `${plural(openEx.length, 'open exception')}`, 'exceptions'));
    if (p.match && p.match.result === 'Exception' && !(p.match.acceptedVariance)) sig.push(chip('red', 'xCircle', '3-way match exception', 'delivery'));
    const toUpload = ds.docs.filter(d => d.mandatory && d.displayStatus === 'Missing' && !d.system).length;
    if (toUpload && LIVE.includes(p.status)) sig.push(chip('red', 'file', `${plural(toUpload, 'document')} to upload`, 'documents'));
    if (advOut > 0) {
      const overdue = (p.advanceIds || []).map(id => E.advance(state, id)).filter(Boolean).some(x => x.settlementDueDate && PCT.clock.now() > x.settlementDueDate && E.advanceOutstanding(x) > 0);
      sig.push(chip(overdue ? 'red' : 'orange', 'advance', `${esc(fmt.inr(advOut))} advance outstanding${overdue ? ' · overdue' : ''}`, 'po'));
    }
    const it = E.invoiceTotals(p);
    if (it.balance > 0 && LIVE.includes(p.status)) sig.push(chip('blue', 'payment', `${esc(fmt.inr(it.balance))} balance payable`, 'payments'));
    return card + (sig.length ? `<div class="pd-signals">${sig.join('')}</div>` : '');
  }

  /* =================================================================
     STEPPER
     ================================================================= */
  function stepperCard(ctx, p) {
    const { state } = ctx;
    const skipped = (p.stages || []).filter(s => s.status === 'Skipped').length;
    const show = !!ctx.local.showSkipped;
    const active = (p.stages || []).filter(s => s.status !== 'Skipped');
    const done = active.filter(s => s.status === 'Completed').length;
    const a = E.currentActivity(p);
    const pos = a ? (p.stages || []).findIndex(s => s.stageId === a.stageId) + 1 : 0;
    const sub = p.status === 'Closed' ? `All ${active.length} applicable stages complete` : `${done} of ${active.length} applicable stages complete${pos ? ` · current stage: <b>${esc(a.stageName)}</b>` : ''}`;
    const legend = `<div class="pill-legend"><span>✓ Done</span><span>● Current</span><span>○ Upcoming</span>${skipped ? '<span>◌ Not required</span>' : ''}</div>`;
    const toggle = skipped ? `<button class="btn btn-xs btn-ghost" data-act="toggle" data-key="showSkipped">${show ? 'Hide' : 'Show'} ${skipped} skipped</button>` : '';
    return ui.card({
      title: 'Process', icon: 'flow', sub,
      actions: legend + toggle,
      body: `<div class="progress tone-green mb-12" title="${done} of ${active.length} stages"><i style="width:${active.length ? Math.round(done / active.length * 100) : 0}%"></i></div>${ui.stepper(state, p, { showSkipped: show })}`
    });
  }

  /* =================================================================
     TABS
     ================================================================= */
  function tabList(ctx, p, canAct) {
    const { state } = ctx;
    const live = LIVE.includes(p.status);
    const acts = p.activities || [];
    const done = acts.filter(x => x.status === 'Completed' || x.status === 'Skipped').length;
    const ds = S.documentSummary(state, p);
    const openEx = state.exceptions.filter(e => e.purchaseId === p.id && isOpenEx(e)).length;
    const audits = state.audit.filter(x => x.purchaseId === p.id).length;
    const pays = (p.paymentIds || []).length;
    const list = [];
    if (live) list.push({ id: 'action', label: canAct ? 'Your action' : 'Action', icon: canAct ? 'zap' : null, count: canAct ? 1 : null });
    list.push(
      { id: 'overview', label: 'Overview' },
      { id: 'activities', label: 'Activities', count: `${done}/${acts.length}` },
      { id: 'documents', label: 'Documents', count: ds.required ? `${ds.received}/${ds.required}` : null },
      { id: 'approvals', label: 'Approvals', count: (p.approvals || []).length || null },
      { id: 'vendor', label: 'Vendor & Quotes', count: (p.quotations || []).filter(q => q.status !== 'Withdrawn').length || null },
      { id: 'po', label: 'PO & Advance', count: (p.advanceIds || []).length || null },
      { id: 'delivery', label: 'Delivery & Invoice', count: (p.invoices || []).length || null },
      { id: 'payments', label: 'Payments', count: pays || null },
      { id: 'exceptions', label: 'Exceptions', count: openEx || null },
      { id: 'comments', label: 'Comments', count: (p.comments || []).length || null },
      { id: 'audit', label: 'Audit Trail', count: audits || null }
    );
    return list;
  }

  /* ---------------- ACTION ---------------- */
  function tabAction(ctx, p, a, canAct) {
    const { state, user } = ctx;
    if (!a) {
      return ui.card({ body: ui.empty('inbox', 'No open activity', p.status === 'Draft' ? 'The PR is still a draft.' : 'There is nothing to do on this purchase right now.') });
    }
    const b = E.ball(state, p);
    const clar = a.clarification;
    const qa = clar ? `<div class="pd-qa mb-12">
        <div><b>${I('message', 13)} Clarification asked by ${esc(nm(state, clar.askedBy))}</b> <span class="muted small">${esc(fmt.dateTime(clar.askedAt))}</span></div>
        <div class="mt-4">“${esc(clar.question)}”</div>
        ${clar.response ? `<div class="mt-8"><b>Answer from ${esc(nm(state, p.requestorId))}</b> <span class="muted small">${esc(fmt.dateTime(clar.respondedAt))}</span><div class="mt-4">“${esc(clar.response)}”</div></div>` : `<div class="mt-8 small" style="color:var(--yellow)">Awaiting the requestor’s answer.</div>`}
      </div>` : '';
    let main;
    if (canAct) {
      let form = '';
      if (PCT.actionForms && typeof PCT.actionForms.render === 'function') {
        try { form = PCT.actionForms.render(ctx, p, a) || ''; } catch (e) { console.error(e); form = ui.alert('danger', `The action panel could not be shown: ${esc(e.message)}`); }
      } else {
        form = ui.alert('info', '<b>The action panel is loading.</b> It is provided by the action-forms module; refresh the page if it does not appear in a few seconds.')
          + (clar && !clar.response && user.id === p.requestorId ? `<form class="mt-12" data-submit="pd-clarify"><div class="form-grid cols-1">${ui.field({ name: 'response', label: 'Your answer to the clarification', type: 'textarea', required: true, full: true })}</div><div class="row end mt-12"><button class="btn btn-primary" type="submit">${I('send', 15)} Send answer</button></div></form>` : '');
      }
      main = ui.card({
        title: `Your action: ${esc(clar && !clar.response && user.id === p.requestorId ? 'Answer clarification' : a.name)}`, icon: 'zap', cls: 'accent-blue',
        sub: `${esc(a.stageName)} · due ${ui.due(a.dueAt)}${a.status === 'Blocked' && a.blocker ? ` · <span style="color:var(--red)">blocked: ${esc(a.blocker)}</span>` : ''}`,
        body: qa + form
      });
    } else {
      const onHold = p.status === 'On Hold';
      main = ui.card({
        title: `Current step: ${esc(a.name)}`, icon: 'clock',
        body: qa + (onHold
          ? ui.alert('warn', `<b>On hold.</b> ${esc((a.blocker || '').replace(/^On hold:\s*/, ''))} — nobody can act until the purchase is resumed.`)
          : `<p>The ball is with <b>${esc(b.ownerName)}</b> (${esc(b.withLabel)}). You will see an action here when it is your turn.</p>
             <p class="muted">Next action: ${esc(b.nextAction)} · due ${ui.due(b.dueAt)}</p>
             <div class="row wrap mt-12"><button class="btn btn-sm" data-act="pd-switch-user" data-user="${esc(b.ownerUserId)}">${I('user', 14)} Switch to ${esc(b.ownerName)} (demo)</button><button class="btn btn-sm btn-ghost" data-act="pd-goto" data-tab="activities">${I('flow', 14)} See full timeline</button></div>`)
      });
    }
    return `<div class="grid grid-main">${main}${stepInfo(ctx, p, a)}</div>`;
  }

  /** Side card: why this step, SLA, input → output, checklist and required documents. */
  function stepInfo(ctx, p, a) {
    const { state } = ctx;
    const sd = E.stageDef(state, p, a.stageId) || {};
    const ad = (sd.activities || []).find(x => x.id === a.masterId) || {};
    const why = [sd.description, ad.description || a.description].filter(Boolean).join(' ');
    const docs = (a.requiredDocs || []).map(id => (p.documents || []).find(d => d.docId === id)).filter(Boolean);
    const sla = a.slaFrom ? 'PO delivery days (calendar)' : `${a.slaDays || 0} working ${a.slaDays === 1 ? 'day' : 'days'}${p.priority && p.priority !== 'P3' ? ` × ${esc(S.priorityName(state, p.priority))} priority` : ''}`;
    const body = `
      ${why ? `<div class="overline">Why this step</div><p class="mt-4">${esc(why)}</p>` : ''}
      ${kv([
        ['Stage', `${esc(String(sd.seq || ''))}${sd.seq ? '. ' : ''}${esc(a.stageName)}`],
        ['Owner', who(state, a.ownerUserId)],
        ['Started', esc(dtt(a.startAt))],
        ['SLA', esc(sla)],
        ['Due', a.dueAt ? `${ui.due(a.dueAt)} <span class="muted small">${esc(fmt.date(a.dueAt))}</span>` : dash],
        (a.input || a.output) ? ['Input → output', `${esc(a.input || '—')} → <b>${esc(a.output || '—')}</b>`] : null
      ], 'mt-12')}
      ${(a.checklist || []).length ? `<div class="overline mt-16 mb-8">Checklist</div><ul class="list-plain pd-cl">${a.checklist.map(c => `<li>${I('check', 13)} ${esc(c)}</li>`).join('')}</ul>` : ''}
      ${docs.length ? `<div class="overline mt-16 mb-8">Documents for this step</div><ul class="list-plain">${docs.map(d => `<li class="row between"><span>${esc(d.name)}${d.mandatory ? ' <span class="req" style="color:var(--red)">*</span>' : ''}</span>${d.system && d.status === 'Missing' ? ui.badge('Generated on completion', 'grey', { dot: false }) : ui.badge(d.status, docTone(d.status))}</li>`).join('')}</ul>` : ''}`;
    return ui.card({ title: 'About this step', icon: 'info', body });
  }

  /* ---------------- OVERVIEW ---------------- */
  function tabOverview(ctx, p) {
    const { state } = ctx;
    const it = E.invoiceTotals(p);
    const advOut = E.purchaseAdvanceOutstanding(state, p);
    const cat = E.category(state, p.categoryId) || {};
    const c = E.context(state, p);
    const f = p.flags || {};
    const advType = f.advanceTypeId ? ((U.byId(state.masters.advanceTypes, f.advanceTypeId) || {}).name || f.advanceTypeId) : '';

    const tiles = `<div class="kpis mb-16">
      ${ui.kpi({ label: 'Estimated value', value: ui.moneyShort(p.estValue), money: true, icon: 'rupee', sub: esc(fmt.inr(p.estValue)) })}
      ${ui.kpi({ label: 'PO value', value: p.po ? ui.moneyShort(p.po.total) : '—', money: true, icon: 'po', sub: p.po ? esc(p.po.number) : 'No PO yet' })}
      ${ui.kpi({ label: 'Invoiced', value: ui.moneyShort(it.total), money: true, icon: 'invoice', sub: plural((p.invoices || []).length, 'invoice') })}
      ${ui.kpi({ label: 'Paid on invoices', value: ui.moneyShort(it.paid), money: true, icon: 'payment', tone: it.total && it.balance <= 0 ? 'green' : 'none' })}
      ${ui.kpi({ label: 'Advance outstanding', value: ui.moneyShort(advOut), money: true, icon: 'advance', tone: advOut > 0 ? 'orange' : 'none', sub: (p.advanceIds || []).length ? 'Until adjusted / recovered' : 'No advance' })}
      ${ui.kpi({ label: 'Balance payable', value: ui.moneyShort(it.balance), money: true, icon: 'clock', tone: it.balance > 0 ? 'blue' : 'none' })}
    </div>`;

    const req = ui.card({
      title: 'Requirement', icon: 'file',
      body: kv([
        ['Title', esc(p.title)],
        ['Description', p.description ? `<span class="pd-pre">${esc(p.description)}</span>` : ''],
        ['Specification', p.specification ? `<span class="pd-pre">${esc(p.specification)}</span>` : ''],
        ['Quantity', `${esc(num(p.qty))} ${esc(p.uom || '')}`],
        ['Required by', p.requiredBy ? `${esc(fmt.date(p.requiredBy))}${LIVE.includes(p.status) ? ` <span class="small">(${ui.due(p.requiredBy)})</span>` : ''}` : ''],
        ['Justification', p.justification ? `<span class="pd-pre">${esc(p.justification)}</span>` : ''],
        ['Budget available', p.budgetAvailable ? ui.badge('Yes', 'green') : ui.badge('No — needs budget approval', 'red')],
        ['Priority', ui.priority(state, p.priority)],
        ['Category', `${esc(cat.name || '—')}${(() => { const bits = []; const typ = c.categoryType === 'service' ? 'Service' : 'Material'; if (!String(cat.name || '').toLowerCase().startsWith(typ.toLowerCase())) bits.push(typ); if (cat.techEval) bits.push('technical evaluation'); return bits.length ? ` <span class="muted small">· ${esc(bits.join(' · '))}</span>` : ''; })()}`],
        ['Department', esc(S.deptName(state, p.deptId))],
        ['Cost centre', esc(S.ccName(state, p.costCentreId))],
        ['Requestor', who(state, p.requestorId)],
        ['Buyer', p.buyerId ? who(state, p.buyerId) : ''],
        ['Created', esc(dtt(p.createdAt))],
        ['Submitted', p.submittedAt ? esc(dtt(p.submittedAt)) : muted('Not yet')],
        p.closedAt ? [p.status === 'Closed' ? 'Closed' : p.status, esc(dtt(p.closedAt))] : null
      ])
    });

    const flags = ui.card({
      title: 'Purchase flags', icon: 'target',
      body: kv([
        ['Advance required', f.advanceRequired ? `${ui.badge('Yes', 'orange')} <span class="small">${esc(String(f.advancePct || 0))}%${advType ? ` · ${esc(advType)}` : ''}</span>` : yesNo(false)],
        ['Single source', f.singleSource ? `${ui.badge('Yes', 'orange')} <span class="small muted">justification required at comparison</span>` : yesNo(false)],
        ['Emergency', f.emergency ? ui.badge('Yes', 'red') : yesNo(false)],
        ['Agreement required', c.agreementRequired ? `${ui.badge('Yes', 'blue')}${!f.agreementRequired ? ' <span class="small muted">by category</span>' : ''}` : yesNo(false)]
      ])
    });

    const advs = (p.advanceIds || []).map(id => E.advance(state, id)).filter(Boolean);
    const pays = (p.paymentIds || []).map(id => state.payments.find(x => x.id === id)).filter(Boolean);
    const exAll = state.exceptions.filter(e => e.purchaseId === p.id);
    const list = arr => arr.length ? arr.join('<br>') : '';
    const refs = ui.card({
      title: 'Key references', icon: 'layers',
      body: kv([
        ['Purchase ID', mono(p.id)],
        ['PR number', p.prNo ? mono(p.prNo) : ''],
        ['RFQs', (p.rfqs || []).length ? `${(p.rfqs || []).map(r => mono(r.id)).join(', ')}` : ''],
        ['PO number', p.po ? `${mono(p.po.number)} ${ui.status(state, 'po', p.po.status)}` : ''],
        [c.categoryType === 'service' ? 'Service confirmations' : 'GRN numbers', list((p.grns || []).map(g => mono(g.number)))],
        ['Invoices', list((p.invoices || []).map(i => `${mono(i.number)} <span class="muted small">${esc(i.id)}</span>`))],
        ['Advances', list(advs.map(x => `<a class="mono" href="#/advances?id=${esc(x.id)}">${esc(x.id)}</a> ${ui.status(state, 'advance', x.status)}`))],
        ['Payments', list(pays.map(x => `<a class="mono" href="#/payments?id=${esc(x.id)}">${esc(x.id)}</a> <span class="muted small">${esc(x.type)} · ${esc(fmt.inr(x.amount))}</span>`))],
        ['Exceptions', exAll.length ? `${exAll.filter(isOpenEx).length} open · ${exAll.length} total` : '']
      ])
    });

    const checks = E.closureChecks(state, p);
    const passed = checks.filter(x => x.ok).length;
    const cur = E.currentActivity(p);
    const atClosure = !!(cur && cur.actionType === 'closure');
    const closure = ui.card({
      title: 'Closure checklist', icon: 'shield',
      sub: p.status === 'Closed' ? 'All closure controls passed — purchase closed.' : `${passed} of ${checks.length} controls passed. A purchase can be closed only when all ${checks.length} pass.`,
      actions: p.status === 'Closed' ? ui.badge('Closed', 'green') : passed === checks.length ? ui.badge('Ready to close', 'green') : ui.badge(`${checks.length - passed} pending`, atClosure ? 'red' : 'grey'),
      body: `<div class="pd-checks">${checks.map(x => `<div class="check-row ${x.ok ? 'ok' : atClosure ? 'bad' : ''}"><b style="color:var(--${x.ok ? 'green' : atClosure ? 'red' : 'faint'});width:16px;text-align:center">${x.ok ? '✓' : atClosure ? '✕' : '○'}</b><div class="grow">${esc(x.label)}<small>${esc(x.detail || '')}</small></div></div>`).join('')}</div>`
    });

    return tiles + `<div class="grid grid-2">${req}<div class="stack">${flags}${refs}</div></div><div class="mt-16">${closure}</div>`;
  }

  /* ---------------- ACTIVITIES ---------------- */
  function slaInfo(state, a) {
    if (a.status === 'Skipped') return null;
    if (a.status === 'Completed' || a.status === 'Rejected') {
      if (!a.dueAt || !a.completedAt) return null;
      if (a.completedAt <= a.dueAt) return ui.badge('SLA met', 'green');
      const late = U.daysBetween(a.dueAt, a.completedAt);
      return ui.badge(`SLA breached${late > 0 ? ` · ${fmt.days(late)} late` : ''}`, 'red');
    }
    if (E.OPEN_STATES.includes(a.status)) return E.isOverdue(state, a) ? ui.badge(`Overdue ${fmt.days(E.overdueDays(state, a))}`, 'red') : ui.badge('Within SLA', 'blue');
    return null;
  }

  function activityBlock(ctx, p, a, cur, detail) {
    const { state } = ctx;
    const future = a.status === 'Not Started';
    const skipped = a.status === 'Skipped';
    const escs = (a.escalations || []).map(id => U.byId(state.masters.escalations, id) || { id, name: id, level: 0 });
    // Summary view: finished steps collapse to one line (who + when + SLA); exceptions to the norm stay visible.
    if (!detail && (a.status === 'Completed' || skipped)) {
      const flags = [];
      if (a.clarification) flags.push(`<div class="pd-qa"><b>Q</b> ${esc(a.clarification.question)}${a.clarification.response ? `<br><b>A</b> ${esc(a.clarification.response)}` : ''}</div>`);
      const esc2 = escs.filter(e => e.level);
      if (esc2.length) flags.push(`<div class="row wrap mt-4 gap-4">${esc2.map(e => ui.badge(`Escalated L${e.level}: ${e.name}`, 'orange', { dot: false })).join('')}</div>`);
      return `<div class="pd-act mini ${skipped ? 'skip' : ''}"><div class="pd-act-head"><span class="pd-tick ${skipped ? 'sk' : ''}">${skipped ? '–' : '✓'}</span><b>${esc(a.name)}</b><span class="small muted">${skipped ? esc(skipReason(a)) : `${esc(fmt.dateTime(a.completedAt))}${a.completedBy ? ` · ${esc(nm(state, a.completedBy))}` : ''}`}</span><span class="grow"></span>${skipped ? '' : slaInfo(state, a) || ''}</div>${flags.join('')}</div>`;
    }
    const meta = [];
    if (!skipped) meta.push(`<span><em>Owner</em>${esc(nm(state, a.ownerUserId))}${a.reassigned ? ' <span class="tag">reassigned</span>' : ''}</span>`);
    if (a.startAt) meta.push(`<span><em>Started</em>${esc(dtt(a.startAt))}</span>`);
    if (a.dueAt && !skipped) meta.push(`<span><em>Due</em>${E.OPEN_STATES.includes(a.status) ? ui.due(a.dueAt) + ` <span class="muted">${esc(fmt.dateShort(a.dueAt))}</span>` : esc(dtt(a.dueAt))}</span>`);
    if (future) meta.push(`<span><em>SLA</em>${a.slaFrom ? 'PO delivery days' : esc(`${a.slaDays || 0} working ${a.slaDays === 1 ? 'day' : 'days'}`)}</span>`);
    if (a.completedAt && !skipped) meta.push(`<span><em>${a.status === 'Rejected' ? 'Closed' : 'Completed'}</em>${esc(dtt(a.completedAt))}${a.completedBy ? ` by ${esc(nm(state, a.completedBy))}` : ''}</span>`);
    const extra = [];
    if (skipped) extra.push(`<div class="small muted mt-4">Skipped — ${esc(skipReason(a))}</div>`);
    else if (a.remarks) extra.push(`<div class="small mt-4"><span class="muted">Remarks:</span> ${esc(a.remarks)}</div>`);
    if (a.returnedReason) extra.push(`<div class="small mt-4" style="color:var(--orange)">Returned here: ${esc(a.returnedReason)}</div>`);
    if (a.blocker && E.OPEN_STATES.includes(a.status)) extra.push(`<div class="small mt-4" style="color:var(--red)">${I('alert', 12)} ${esc(a.blocker)}</div>`);
    if (a.clarification) {
      const c = a.clarification;
      extra.push(`<div class="pd-qa"><b>Q</b> (${esc(nm(state, c.askedBy))}, ${esc(fmt.dateTime(c.askedAt))}): ${esc(c.question)}${c.response ? `<br><b>A</b> (${esc(nm(state, p.requestorId))}, ${esc(fmt.dateTime(c.respondedAt))}): ${esc(c.response)}` : '<br><span style="color:var(--yellow)">Awaiting answer from requestor</span>'}</div>`);
    }
    if (escs.length) extra.push(`<div class="row wrap mt-8 gap-4">${escs.map(e => ui.badge(e.level ? `Escalated L${e.level}: ${e.name}` : `Reminder: ${e.name}`, e.level ? 'orange' : 'grey', { dot: false })).join('')}</div>`);
    return `<div class="pd-act ${cur ? 'cur' : ''} ${future ? 'future' : ''} ${skipped ? 'skip' : ''}">
      <div class="pd-act-head"><b>${esc(a.name)}</b>${skipped ? ui.badge('Skipped', 'grey') : ui.actStatus(state, a)}${a.approval ? '<span class="tag">Approval</span>' : ''}<span class="grow"></span>${slaInfo(state, a) || ''}</div>
      ${meta.length ? `<div class="pd-act-meta">${meta.join('')}</div>` : ''}
      ${extra.join('')}
    </div>`;
  }

  function tabActivities(ctx, p, a) {
    const { state } = ctx;
    const sla = S.slaStats(state, [p]);
    const acts = p.activities || [];
    const escCount = acts.reduce((n, x) => n + (x.escalations || []).filter(id => id !== 'ESC-0').length, 0);
    const done = acts.filter(x => x.status === 'Completed').length;
    const skipped = acts.filter(x => x.status === 'Skipped').length;
    const tiles = `<div class="kpis mb-16">
      ${ui.kpi({ label: 'Activities completed', value: `${done}<span class="muted" style="font-size:15px"> / ${acts.length - skipped}</span>`, icon: 'checkCircle', sub: skipped ? `${skipped} skipped (not required)` : '' })}
      ${ui.kpi({ label: 'SLA met', value: sla.met, icon: 'clock', tone: 'green', sub: `${sla.achievementPct}% achievement` })}
      ${ui.kpi({ label: 'SLA breached', value: sla.breached, icon: 'alert', tone: sla.breached ? 'red' : 'none' })}
      ${ui.kpi({ label: 'Escalations fired', value: escCount, icon: 'escalate', tone: escCount ? 'orange' : 'none' })}
      ${ui.kpi({ label: 'Total cycle', value: fmt.days(U.ageDays(p.createdAt, p.closedAt || PCT.clock.now())), icon: 'calendar', sub: p.closedAt ? 'Created → closed' : 'Since creation' })}
    </div>`;
    const tl = S.timeline(state, p);
    const detail = ctx.local.actView === 'detail';
    const items = tl.map((s, i) => {
      const def = E.stageDef(state, p, s.stageId) || {};
      let cls = s.status === 'Completed' ? 'done' : s.status === 'Skipped' ? 'skipped' : s.status === 'Rejected' ? 'rejected' : '';
      if (s.current && a) cls = (a.status === 'Blocked' || p.status === 'On Hold') ? 'blocked' : E.isOverdue(state, a) ? 'overdue' : 'current';
      const mark = cls === 'done' ? '✓' : cls === 'rejected' ? '✕' : String(i + 1);
      const dates = [s.startedAt ? `started ${fmt.dateShort(s.startedAt)}` : '', s.completedAt && s.status === 'Completed' ? `completed ${fmt.dateShort(s.completedAt)}` : ''].filter(Boolean).join(' · ');
      const body = s.activities.length
        ? s.activities.map(x => activityBlock(ctx, p, x, a && x.id === a.id, detail)).join('')
        : `<div class="small muted mt-4">Not required for this purchase${def.activation ? ` — ${esc(stageRule(def.activation))}` : ''}.</div>`;
      return `<li class="${cls}"><div class="vd">${mark}</div><div class="vbody">
        <div class="row wrap"><b>${esc(s.name)}</b>${s.status !== 'Not Started' || s.current ? ui.status(state, 'activity', s.current && a ? E.displayStatus(state, a) : s.status) : ''}<span class="muted small">${esc(dates)}</span></div>
        ${def.description && s.status !== 'Skipped' ? `<div class="small muted">${esc(def.description)}</div>` : ''}
        ${body}
      </div></li>`;
    }).join('');
    return tiles + ui.card({
      title: 'Activity timeline', icon: 'flow', sub: 'Every stage and activity — owner, dates, SLA, remarks, escalations and clarifications.',
      actions: ui.seg('actView', [{ id: 'summary', label: 'Summary' }, { id: 'detail', label: 'Full detail' }], detail ? 'detail' : 'summary'),
      body: `<ul class="vsteps">${items}</ul>`
    });
  }

  /* ---------------- DOCUMENTS ---------------- */
  function tabDocuments(ctx, p, a, canAct, R) {
    const { state } = ctx;
    const ds = S.documentSummary(state, p);
    const stageName = id => (E.stageDef(state, p, id) || {}).name || id;
    const tiles = `<div class="kpis mb-16">
      ${ui.kpi({ label: 'Required', value: ds.required, icon: 'file', sub: 'Mandatory for this purchase' })}
      ${ui.kpi({ label: 'Received', value: ds.received, icon: 'checkCircle', tone: ds.required && ds.received === ds.required ? 'green' : 'blue' })}
      ${ui.kpi({ label: 'Missing', value: ds.missing, icon: 'alert', tone: ds.missing ? 'red' : 'none', sub: 'Due at or before the current stage' })}
      ${ui.kpi({ label: 'Upcoming', value: ds.upcoming, icon: 'clock', sub: 'Needed at later stages' })}
    </div>`;
    const uploadable = d => R.upload && (d.status === 'Missing' || d.status === 'Received');
    const table = ui.table([
      { key: 'name', label: 'Document', render: d => `<b>${esc(d.name)}</b><span class="sub">${esc(d.docId)}${d.system ? ' · system generated' : ''}${d.system && d.status === 'Missing' && d.displayStatus === 'Missing' ? ' — created automatically when the step completes' : ''}</span>` },
      { key: 'displayStatus', label: 'Status', render: d => ui.badge(d.displayStatus, docTone(d.displayStatus)) },
      { key: 'stage', label: 'Stage', sort: d => (E.stageDef(state, p, d.stages[0]) || {}).seq || 0, render: d => esc(d.stages.map(stageName).join(', ')) },
      { key: 'mandatory', label: 'Mandatory', render: d => d.mandatory ? 'Yes' : muted('No') },
      { key: 'fileName', label: 'File', render: d => d.fileName ? `<span class="mono small">${esc(d.fileName)}</span>` : dash },
      { key: 'uploadedAt', label: 'Uploaded', render: d => d.uploadedAt ? `${esc(fmt.date(d.uploadedAt))}<span class="sub">${esc(nm(state, d.uploadedBy))}</span>${d.verifiedAt ? `<span class="sub" style="color:var(--green)">Verified ${esc(fmt.dateShort(d.verifiedAt))} · ${esc(nm(state, d.verifiedBy))}</span>` : ''}` : dash },
      { key: 'act', label: '', sort: false, render: d => `<div class="row end nowrap" style="gap:4px">${R.verify && d.status === 'Received' ? `<button class="btn btn-xs" data-act="pd-verify" data-doc="${esc(d.docId)}" title="Mark ${esc(d.name)} as verified">${I('check', 12)} Verify</button>` : ''}${uploadable(d) ? (d.status === 'Missing' ? `<button class="btn btn-xs ${d.displayStatus === 'Missing' ? 'btn-primary' : ''}" data-act="pd-upload" data-doc="${esc(d.docId)}">${I('upload', 12)} Upload</button>` : `<button class="btn btn-xs btn-ghost btn-icon" style="width:26px" data-act="pd-upload" data-doc="${esc(d.docId)}" title="Replace file" aria-label="Replace ${esc(d.name)}">${I('upload', 13)}</button>`) : ''}</div>` }
    ], ds.docs, { key: 'docs', sort: ctx.local.docsSort, rowClass: d => d.displayStatus === 'Missing' ? 'row-red' : d.status === 'Verified' ? 'row-green' : '', empty: 'No documents apply to this purchase.' });
    return tiles + ui.card({
      title: 'Documents', icon: 'file', flush: true,
      sub: 'Rule R07: a stage cannot be completed while its mandatory document is missing.',
      actions: R.upload ? `<button class="btn btn-sm btn-primary" data-act="pd-upload">${I('upload', 14)} Upload document</button>` : '',
      body: table
    });
  }

  function openUpload(ctx, p, docId) {
    const docs = (p.documents || []).filter(d => d.status === 'Missing' || d.status === 'Received');
    if (!docs.length) { ui.toast('All documents are verified or not required.', 'navy'); return; }
    const d = docId ? docs.find(x => x.docId === docId) : null;
    if (docId && !d) { ui.toast('This document can no longer be uploaded.', 'red'); return; }
    const sample = x => `${x.name.replace(/[^A-Za-z0-9]+/g, '_')}_${p.id}.pdf`;
    const pick = d ? `${ui.field({ type: 'hidden', name: 'docId', value: d.docId })}<div class="kv mb-12"><dt>Document</dt><dd>${esc(d.name)} ${ui.badge(d.status, docTone(d.status))}</dd><dt>Purchase</dt><dd class="mono">${esc(p.id)}</dd></div>`
      : ui.field({ name: 'docId', label: 'Document', type: 'select', required: true, placeholder: 'Select document', options: docs.map(x => ({ value: x.docId, label: `${x.name} — ${x.status}${x.mandatory ? ' (mandatory)' : ''}` })), full: true });
    ui.modal.open({
      title: d ? (d.status === 'Missing' ? 'Upload document' : 'Replace document') : 'Upload document',
      body: `<div class="form-grid cols-1">${pick}${ui.field({ name: 'fileName', label: 'File', type: 'file', required: true, sample: d ? sample(d) : `Document_${p.id}.pdf`, full: true, hint: d && d.status === 'Received' ? 'Replacing keeps the previous upload in the audit trail.' : 'Demo: the file name is recorded; choose any file or use the sample.' })}</div>`,
      actions: [{ label: 'Cancel', act: 'close' }, { label: 'Upload', act: 'save', tone: 'primary', icon: 'upload' }],
      onAction: {
        save: v => {
          if (!v.docId) { ui.toast('Select the document type.', 'red', 'Required'); return false; }
          if (!v.fileName) { ui.toast('Choose a file or use the sample file.', 'red', 'Required'); return false; }
          const r = ctx.act(p.id, null, 'upload_doc', { docId: v.docId, fileName: v.fileName });
          return r && r.ok ? undefined : false;
        }
      }
    });
  }

  /* ---------------- APPROVALS ---------------- */
  function tabApprovals(ctx, p, a) {
    const { state } = ctx;
    const levels = p.approvals || [];
    const first = levels[0] || {};
    const mx = first.matrixId ? U.byId(state.masters.approvalMatrix, first.matrixId) : null;
    const matrixName = first.matrixName || (mx && mx.name) || 'Default (Department Head)';
    const actFor = l => (p.activities || []).find(x => x.approvalLevel === l.level);
    const lvlStatus = l => {
      const x = actFor(l);
      if (l.status === 'Pending' && x && E.OPEN_STATES.includes(x.status)) {
        const d = E.displayStatus(state, x);
        const label = x.clarification && !x.clarification.response ? 'Clarification asked' : d === 'Overdue' ? 'Overdue' : d === 'Blocked' ? 'Blocked' : 'Awaiting decision';
        return toneBadge(state, label, 'activity', d);
      }
      const map = { Approved: 'Completed', Rejected: 'Rejected', Returned: 'Blocked', Pending: 'Not Started' };
      return toneBadge(state, l.status, 'activity', map[l.status] || 'Not Started');
    };
    const lvlTable = ui.table([
      { key: 'level', label: 'Level', render: l => `<b>L${l.level}</b>` },
      { key: 'label', label: 'Role', render: l => esc(l.label) },
      { key: 'userId', label: 'Approver', sort: l => nm(state, l.userId), render: l => who(state, l.userId) },
      { key: 'status', label: 'Status', render: lvlStatus },
      { key: 'at', label: 'Date', render: l => { const x = actFor(l); return l.at ? esc(dtt(l.at)) : x && E.OPEN_STATES.includes(x.status) ? `Due ${ui.due(x.dueAt)}` : dash; } },
      { key: 'remarks', label: 'Remarks', sort: false, render: l => { const x = actFor(l); const c = x && x.clarification; return (l.remarks ? esc(l.remarks) : dash) + (c ? `<span class="sub">Q: ${esc(c.question)}${c.response ? ` · A: ${esc(c.response)}` : ''}</span>` : ''); } }
    ], levels, { key: 'lv', sort: ctx.local.lvSort, rowClass: l => l.status === 'Approved' ? 'row-green' : l.status === 'Rejected' ? 'row-red' : '', empty: 'No approval levels' });
    const matrixCard = ui.card({
      title: 'Purchase approval levels', icon: 'matrix', flush: true,
      sub: `Approval Matrix: <b>${esc(matrixName)}</b>${first.matrixId ? ` <span class="mono">(${esc(first.matrixId)})</span>` : ''} · value ${esc(fmt.inr(p.estValue))}`,
      body: lvlTable
    });

    // Other approval-type steps: technical evaluation, non-L1 selection, PO, advance, payment
    const others = (p.activities || []).filter(x => x.approval && !x.approvalLevel);
    const outcome = x => {
      if (x.status === 'Skipped') return muted(skipReason(x));
      if (x.status === 'Not Started') return muted('Not reached yet');
      switch (x.actionType) {
        case 'tech_eval': return p.techEval ? `${ui.badge(p.techEval.result, p.techEval.result === 'Approved' ? 'green' : 'red')}${p.techEval.remarks ? `<span class="sub">${esc(p.techEval.remarks)}</span>` : ''}` : dash;
        case 'selection_approval': return p.selection && p.selection.approverId ? `${ui.badge('Approved', 'green')}<span class="sub">Non-L1: ${esc(vendorName(state, p.selection.vendorId))}</span>` : dash;
        case 'po_approve': { const h = p.po && (p.po.history || []).filter(y => y.status === 'Approved').pop(); return h ? `${ui.badge('Approved', 'green')}<span class="sub">${esc(p.po.number)} · ${esc(fmt.inr(p.po.total))}</span>` : dash; }
        case 'advance_approve': {
          const adv = (p.advanceIds || []).map(id => E.advance(state, id)).filter(y => y && y.approval).pop();
          return adv ? `${ui.badge(adv.approval.status, adv.approval.status === 'Approved' ? 'green' : adv.approval.status === 'Rejected' ? 'black' : 'orange')}<span class="sub">${esc(adv.id)} · ${esc(fmt.inr(adv.amount))} (${esc(String(adv.pct))}%)${adv.approval.remarks ? ' · ' + esc(adv.approval.remarks) : ''}</span>` : dash;
        }
        case 'payment_approval': { const pa = p.paymentApproval; return pa ? `${ui.badge('Approved', 'green')}<span class="sub">Pay ${esc(fmt.inr(pa.proposedAmount))}${pa.adjustPlanned ? ` · adjust ${esc(fmt.inr(pa.adjustPlanned))}` : ''}${pa.advanceOutstanding ? ` · advance ${esc(fmt.inr(pa.advanceOutstanding))} acknowledged` : ''}</span>` : dash; }
        default: return x.remarks ? esc(x.remarks) : dash;
      }
    };
    const otherTable = ui.table([
      { key: 'name', label: 'Approval', render: x => `<b>${esc(x.name)}</b><span class="sub">${esc(x.stageName)}</span>` },
      { key: 'owner', label: 'Approver', sort: x => nm(state, x.completedBy || x.ownerUserId), render: x => x.status === 'Skipped' ? dash : who(state, x.completedBy || x.ownerUserId) },
      { key: 'status', label: 'Status', sort: x => x.status, render: x => x.status === 'Skipped' ? ui.badge('Not required', 'grey') : ui.actStatus(state, x) },
      { key: 'completedAt', label: 'Date', render: x => x.completedAt && x.status !== 'Skipped' ? esc(dtt(x.completedAt)) : E.OPEN_STATES.includes(x.status) ? `Due ${ui.due(x.dueAt)}` : dash },
      { key: 'outcome', label: 'Outcome', sort: false, render: outcome }
    ], others, { key: 'oth', sort: ctx.local.othSort, empty: 'No other approvals in this process.' });
    return matrixCard + `<div class="mt-16">${ui.card({ title: 'Other approvals', icon: 'approve', flush: true, sub: 'Technical evaluation, non-L1 vendor selection, PO, advance and payment approvals.', body: otherTable })}</div>`;
  }

  /* ---------------- VENDOR & QUOTES ---------------- */
  function tabVendor(ctx, p) {
    const { state } = ctx;
    if (!p.sourcing && !(p.rfqs || []).length && !(p.quotations || []).length) {
      return ui.card({ body: ui.empty('vendor', 'Vendor sourcing has not started', 'Vendors are shortlisted after the purchase is approved. RFQs, quotations and the comparison will appear here.') });
    }
    const out = [];
    if (p.sourcing) {
      const vs = (p.sourcing.vendorIds || []).map(id => E.vendor(state, id)).filter(Boolean);
      out.push(ui.card({
        title: 'Sourcing shortlist', icon: 'vendor', flush: true,
        sub: `${plural(vs.length, 'vendor')} shortlisted ${p.sourcing.at ? `on ${esc(fmt.date(p.sourcing.at))}` : ''}${p.sourcing.by ? ` by ${esc(nm(state, p.sourcing.by))}` : ''}`,
        body: ui.table([
          { key: 'name', label: 'Vendor', render: v => `<a href="#/vendors/${esc(v.id)}"><b>${esc(v.name)}</b></a><span class="sub">${esc(v.id)} · ${esc(v.city || '')}</span>` },
          { key: 'rating', label: 'Rating', align: 'right', render: v => v.rating ? `${esc(String(v.rating))} ★` : dash },
          { key: 'approved', label: 'Approved vendor', render: v => v.approved ? ui.badge('Approved', 'green') : ui.badge(v.onboarding || 'Not approved', 'orange') },
          { key: 'msme', label: 'MSME', render: v => v.msme ? 'Yes' : muted('No') },
          { key: 'gstin', label: 'GSTIN', render: v => mono(v.gstin) }
        ], vs, { key: 'src', sort: ctx.local.srcSort })
      }));
    }
    if ((p.rfqs || []).length) {
      out.push(ui.card({
        title: 'RFQs', icon: 'rfq', flush: true,
        sub: `${(p.rfqs || []).filter(r => r.status === 'Received').length} of ${p.rfqs.length} vendors responded`,
        body: ui.table([
          { key: 'id', label: 'RFQ', render: r => mono(r.id) },
          { key: 'vendor', label: 'Vendor', sort: r => vendorName(state, r.vendorId), render: r => esc(vendorName(state, r.vendorId)) },
          { key: 'rfqDate', label: 'RFQ date', render: r => esc(dt(r.rfqDate)) },
          { key: 'dueDate', label: 'Response due', render: r => r.responseDate ? esc(dt(r.dueDate)) : ['Sent', 'Waiting'].includes(r.status) ? ui.due(r.dueDate) : esc(dt(r.dueDate)) },
          { key: 'responseDate', label: 'Response date', render: r => esc(dt(r.responseDate)) },
          { key: 'rt', label: 'Response time', align: 'right', sort: r => r.responseDate ? r.responseDate - r.rfqDate : null, render: r => r.responseDate ? `${days1(r.responseDate - r.rfqDate)} days` : dash },
          { key: 'fu', label: 'Follow-ups', sort: r => (r.followUps || []).length, render: r => (r.followUps || []).length ? `${r.followUps.length}<span class="sub">Last ${esc(fmt.dateShort(r.followUps[r.followUps.length - 1].at))}${r.followUps[r.followUps.length - 1].note ? ' · ' + esc(r.followUps[r.followUps.length - 1].note) : ''}</span>` : muted('0') },
          { key: 'status', label: 'Status', render: r => ui.status(state, 'rfq', r.status) }
        ], p.rfqs, { key: 'rfq', sort: ctx.local.rfqSort })
      }));
    }
    const quotes = (p.quotations || []);
    if (quotes.length) {
      const ranked = U.sortBy(quotes.filter(q => q.status !== 'Withdrawn'), q => Number(q.total) || 0);
      const rank = q => { const i = ranked.indexOf(q); return i >= 0 ? 'L' + (i + 1) : '—'; };
      const rec = p.comparison && p.comparison.recommendedVendorId;
      const sel = p.selection && p.selection.vendorId;
      const specTone = s => s === 'Yes' ? 'green' : s === 'Partial' ? 'yellow' : 'red';
      out.push(ui.card({
        title: 'Quotation comparison', icon: 'report', flush: true,
        sub: `${ranked.length} valid quotation${ranked.length === 1 ? '' : 's'} · ranked by total incl. tax (L1 = lowest)`,
        body: ui.table([
          { key: 'rank', label: 'Rank', sort: q => { const i = ranked.indexOf(q); return i >= 0 ? i : 99; }, render: q => rank(q) === 'L1' ? ui.badge('L1', 'green', { solid: false }) : `<b>${rank(q)}</b>` },
          { key: 'vendor', label: 'Vendor', sort: q => vendorName(state, q.vendorId), render: q => `<b>${esc(vendorName(state, q.vendorId))}</b><span class="sub">${esc(q.id)}${q.vendorId === rec ? ' · <b style="color:var(--blue-600)">Recommended</b>' : ''}${q.vendorId === sel ? ' · <b style="color:var(--green)">Selected</b>' : ''}${q.status === 'Withdrawn' ? ' · Withdrawn' : ''}</span>` },
          { key: 'amount', label: 'Amount', align: 'right', render: q => ui.money(q.amount) },
          { key: 'tax', label: 'Tax', align: 'right', render: q => `${ui.money(q.tax)}<span class="sub">${esc(String(q.taxPct))}%</span>` },
          { key: 'total', label: 'Total', align: 'right', render: q => `<b>${ui.money(q.total)}</b>` },
          { key: 'deliveryDays', label: 'Delivery', align: 'right', render: q => `${esc(String(q.deliveryDays))} days` },
          { key: 'warranty', label: 'Warranty', render: q => esc(q.warranty || '—') },
          { key: 'paymentTerms', label: 'Payment terms', render: q => esc(q.paymentTerms || '—') },
          { key: 'specCompliance', label: 'Spec', render: q => ui.badge(q.specCompliance || '—', specTone(q.specCompliance)) },
          { key: 'validityDays', label: 'Valid', align: 'right', render: q => `${esc(String(q.validityDays || '—'))} d` }
        ], quotes, { key: 'qt', sort: ctx.local.qtSort || { col: 'rank', dir: 'asc' }, rowClass: q => q.status === 'Withdrawn' ? 'pd-withdrawn' : rank(q) === 'L1' ? 'row-green pd-l1' : '' })
      }));
    }
    const side = [];
    if (p.comparison) {
      const cmp = p.comparison;
      side.push(ui.card({
        title: 'Recommendation', icon: 'target',
        body: kv([
          ['Recommended', `<b>${esc(vendorName(state, cmp.recommendedVendorId))}</b> ${cmp.recommendedVendorId === cmp.l1VendorId ? ui.badge('L1', 'green') : ui.badge('Not L1', 'orange')}`],
          ['Lowest (L1)', esc(vendorName(state, cmp.l1VendorId))],
          ['Justification', cmp.justification ? `<span class="pd-pre">${esc(cmp.justification)}</span>` : muted(cmp.recommendedVendorId === cmp.l1VendorId ? 'Lowest price — no justification needed' : '—')],
          ['Prepared', when(state, cmp.at, cmp.by)]
        ])
      }));
    }
    const te = (p.activities || []).find(x => x.actionType === 'tech_eval');
    if (p.techEval || (te && te.status !== 'Not Started')) {
      side.push(ui.card({
        title: 'Technical evaluation', icon: 'shield',
        actions: p.techEval ? ui.badge(p.techEval.result, p.techEval.result === 'Approved' ? 'green' : 'red') : te.status === 'Skipped' ? ui.badge('Not required', 'grey') : ui.actStatus(state, te),
        body: p.techEval ? `<div class="stack-sm">${(p.techEval.criteria || []).map(c => `<div class="check-row ${c.ok ? 'ok' : 'bad'}"><b style="color:var(--${c.ok ? 'green' : 'red'})">${c.ok ? '✓' : '✕'}</b><div class="grow">${esc(c.name)}${c.remark ? `<small>${esc(c.remark)}</small>` : ''}</div></div>`).join('')}</div>
          ${kv([['Remarks', esc(p.techEval.remarks || '')], ['Evaluated', when(state, p.techEval.at, p.techEval.by)]], 'mt-12')}`
          : te.status === 'Skipped' ? `<p class="muted">Not required for this category.</p>` : `<p class="muted">With ${esc(nm(state, te.ownerUserId))} · due ${ui.due(te.dueAt)}</p>`
      }));
    }
    if (p.selection) {
      const s = p.selection;
      const apAct = (p.activities || []).find(x => x.actionType === 'selection_approval');
      side.push(ui.card({
        title: 'Vendor selection', icon: 'checkCircle',
        body: kv([
          ['Selected vendor', `<b>${esc(vendorName(state, s.vendorId))}</b> ${s.lowestSelected ? ui.badge('L1 — lowest', 'green') : ui.badge('Non-L1', 'orange')}`],
          ['Reason', `<span class="pd-pre">${esc(s.reason || '—')}</span>`],
          ['Selected', when(state, s.at, s.by)],
          ['Approver', s.lowestSelected ? muted('Not required (L1 selected)') : s.approverId ? `${esc(nm(state, s.approverId))} <span class="muted small">${esc(dt(s.approvedAt))}</span>` : apAct && E.OPEN_STATES.includes(apAct.status) ? `Pending with ${esc(nm(state, apAct.ownerUserId))}` : muted('Pending')]
        ])
      }));
    }
    return `<div class="stack">${out.join('')}${side.length ? `<div class="grid grid-${Math.min(3, side.length)}">${side.join('')}</div>` : ''}</div>`;
  }

  /* ---------------- PO & ADVANCE ---------------- */
  function tabPO(ctx, p) {
    const { state } = ctx;
    const parts = [];
    if (!p.po) {
      parts.push(ui.card({ body: ui.empty('po', 'No purchase order yet', 'The PO is created after the vendor is selected (stage PO / Agreement).') }));
    } else {
      const po = p.po;
      const body = `<div class="grid grid-main">
        <div>${kv([
          ['PO number', `<b class="mono">${esc(po.number)}</b> ${ui.status(state, 'po', po.status)}`],
          ['Vendor', `<a href="#/vendors/${esc(po.vendorId)}">${esc(vendorName(state, po.vendorId))}</a>`],
          ['Quantity', `${esc(num(po.qty))} ${esc(p.uom || '')}`],
          ['Unit price', ui.money(po.unitPrice)],
          ['Basic value', ui.money(po.basic)],
          ['Tax', `${ui.money(po.tax)} <span class="muted small">(${esc(String(po.taxPct))}%)</span>`],
          ['Total', `<b style="font-size:15px">${ui.money(po.total)}</b>`],
          ['Delivery', `${esc(String(po.deliveryDays))} days${po.expectedDelivery ? ` · expected <b>${esc(fmt.date(po.expectedDelivery))}</b>` : ' · from vendor acceptance'}`],
          ['Payment terms', esc(po.paymentTerms || '')],
          ['Warranty', esc(po.warranty || '')],
          ['Validity', `${esc(String(po.validityDays))} days${po.validUntil ? ` · until ${esc(fmt.date(po.validUntil))}` : ''}`],
          ['Agreement', po.agreement ? ui.badge('Required', 'blue') : muted('Not required')],
          ['Created', when(state, po.createdAt, po.createdBy)],
          ['Sent / accepted', `${esc(dt(po.sentAt))} / ${esc(dt(po.acceptedAt))}`]
        ])}</div>
        <div><div class="overline mb-8">Status history</div><ul class="feed">${(po.history || []).slice().reverse().map(h => `<li><span class="ft">${esc(fmt.dateTime(h.at))}</span><div class="fx">${ui.status(state, 'po', h.status)}<small>${esc(nm(state, h.by))}</small></div></li>`).join('')}</ul></div>
      </div>`;
      parts.push(ui.card({ title: 'Purchase order', icon: 'po', body }));
    }

    const advs = (p.advanceIds || []).map(id => E.advance(state, id)).filter(Boolean);
    const f = p.flags || {};
    if (!advs.length) {
      parts.push(ui.card({
        title: 'Vendor advance', icon: 'advance',
        body: f.advanceRequired
          ? ui.alert('info', `<b>Advance planned: ${esc(String(f.advancePct || 0))}% of PO</b>${f.advanceTypeId ? ` · ${esc((U.byId(state.masters.advanceTypes, f.advanceTypeId) || {}).name || f.advanceTypeId)}` : ''}. It is requested after the vendor accepts the PO, then approved, verified and paid. Once paid it stays outstanding until adjusted against invoices.`)
          : `<p class="muted">No vendor advance on this purchase.</p>`
      }));
    } else {
      advs.forEach(adv => parts.push(advanceCard(ctx, p, adv)));
    }
    return `<div class="stack">${parts.join('')}</div>`;
  }

  function advanceCard(ctx, p, adv) {
    const { state } = ctx;
    const out = E.advanceOutstanding(adv);
    const adj = E.advanceAdjusted(adv);
    const rec = E.advanceRecovered(adv);
    const ag = E.advanceAgeing(state, adv);
    const type = (U.byId(state.masters.advanceTypes, adv.typeId) || {}).name || adv.typeId;
    const paid = Number(adv.paidAmount) || 0;
    const tone = adv.status === 'Rejected' ? 'grey' : !paid ? 'blue' : out <= 0 ? 'green' : ag && ag.overdue ? 'red' : 'orange';
    const headline = adv.status === 'Rejected' ? 'Advance rejected — not paid'
      : !paid ? 'Not paid yet — nothing outstanding'
        : out <= 0 ? 'Fully settled' : `${fmt.inr(out)} outstanding`;
    const box = `<div class="pd-out tone-${tone}">
      <div class="overline">Outstanding advance</div>
      <div class="pd-out-v">${esc(headline)}</div>
      <div class="small mt-4">Paid ${esc(fmt.inr(paid))} − Adjusted ${esc(fmt.inr(adj))} − Recovered ${esc(fmt.inr(rec))} = <b>${esc(fmt.inr(out))}</b></div>
      <div class="small mt-8 pd-out-note">An advance stays outstanding until it is adjusted against an invoice or recovered from the vendor — it is never closed just because it was paid.</div>
      ${ag ? `<div class="row wrap mt-8">${ui.badge(`Ageing ${fmt.days(ag.days)} · ${ag.bucket}`, ag.overdue ? 'red' : 'grey', { dot: false })}${adv.settlementDueDate ? ui.badge(`Settle by ${fmt.date(adv.settlementDueDate)}${ag.overdue ? ' · overdue' : ''}`, ag.overdue ? 'red' : 'yellow', { dot: false }) : ''}</div>` : ''}
    </div>`;
    const facts = kv([
      ['Amount', `<b>${ui.money(adv.amount)}</b> <span class="muted small">${esc(String(adv.pct))}% of ${esc(adv.poNumber || 'PO')}</span>`],
      ['Type', esc(type)],
      ['Vendor', esc(vendorName(state, adv.vendorId))],
      ['Justification', `<span class="pd-pre">${esc(adv.justification || '')}</span>`],
      ['Requested', when(state, adv.requestedAt, adv.requestedBy)],
      ['Approval', adv.approval ? `${ui.badge(adv.approval.status, adv.approval.status === 'Approved' ? 'green' : 'orange')} <span class="small">${esc(nm(state, adv.approval.by))} · ${esc(dt(adv.approval.at))}</span>` : muted('Pending')],
      ['Verification', adv.verification ? `${esc(nm(state, adv.verification.by))} · ${esc(dt(adv.verification.at))}` : muted('Pending')],
      ['Payment', paid ? `${ui.money(paid)} · ${esc(dt(adv.paymentDate))}<br><span class="muted small">Ref ${esc(adv.paymentRef || '—')}${adv.paymentId ? ` · ${esc(adv.paymentId)}` : ''}</span>` : muted('Not paid')],
      ['Settlement due', adv.settlementDueDate ? `${esc(fmt.date(adv.settlementDueDate))}${out > 0 ? ` <span class="small">(${ui.due(adv.settlementDueDate)})</span>` : ''}` : muted(`${adv.settlementDays || 30} days after payment`)]
    ]);
    const adjTable = (adv.adjustments || []).length ? `<div class="overline mt-16 mb-8">Adjustment history</div>${ui.table([
      { key: 'invoiceNumber', label: 'Invoice', render: x => mono(x.invoiceNumber) },
      { key: 'amount', label: 'Amount adjusted', align: 'right', render: x => ui.money(x.amount) },
      { key: 'at', label: 'Date', render: x => esc(dt(x.at)) },
      { key: 'by', label: 'By', render: x => esc(nm(state, x.by)) },
      { key: 'remarks', label: 'Remarks', sort: false, render: x => esc(x.remarks || '') }
    ], adv.adjustments, { key: 'adj', sort: ctx.local.adjSort, dense: true, foot: `<tr><td>Total adjusted</td><td class="num">${ui.money(adj)}</td><td colspan="3"></td></tr>` })}` : '';
    const recTable = (adv.recoveries || []).length ? `<div class="overline mt-16 mb-8">Recoveries from vendor</div>${ui.table([
      { key: 'amount', label: 'Amount', align: 'right', render: x => ui.money(x.amount) },
      { key: 'ref', label: 'Reference', render: x => mono(x.ref) },
      { key: 'mode', label: 'Mode', render: x => esc(x.mode || '') },
      { key: 'at', label: 'Date', render: x => esc(dt(x.at)) },
      { key: 'by', label: 'By', render: x => esc(nm(state, x.by)) }
    ], adv.recoveries, { key: 'rec', sort: ctx.local.recSort, dense: true })}` : '';
    return ui.card({
      title: `Vendor advance <span class="mono">${esc(adv.id)}</span>`, icon: 'advance',
      actions: ui.status(state, 'advance', adv.status),
      body: `<div class="grid grid-2">${box}<div>${facts}</div></div>${adjTable}${recTable}`
    });
  }

  /* ---------------- DELIVERY & INVOICE ---------------- */
  function tabDelivery(ctx, p) {
    const { state } = ctx;
    const svc = E.context(state, p).categoryType === 'service';
    const parts = [];
    const dl = p.deliveries || [];
    parts.push(ui.card({
      title: svc ? 'Service delivery' : 'Deliveries', icon: 'truck', flush: true,
      sub: p.po && p.po.expectedDelivery ? `Expected ${esc(fmt.date(p.po.expectedDelivery))} · ${esc(num(U.sum(dl, d => d.qty)))} of ${esc(num(p.po.qty))} ${esc(p.uom || '')} received` : '',
      body: ui.table([
        { key: 'expectedDate', label: 'Expected', render: d => esc(dt(d.expectedDate)) },
        { key: 'date', label: 'Actual', render: d => esc(dt(d.date)) },
        { key: 'late', label: 'On time?', sort: d => d.delayDays || 0, render: d => d.late ? ui.badge(`Late · ${fmt.days(d.delayDays)}`, 'red') : ui.badge('On time', 'green') },
        { key: 'qty', label: 'Qty', align: 'right', render: d => esc(num(d.qty)) },
        { key: 'quality', label: 'Quality', render: d => `${esc(d.quality || '—')}${d.specOk === false ? ' <span class="small" style="color:var(--red)">· spec not met</span>' : ''}` },
        { key: 'shortage', label: 'Shortage', align: 'right', render: d => d.shortage ? `<span style="color:var(--orange)">${esc(num(d.shortage))}</span>` : muted('0') },
        { key: 'rejection', label: 'Rejected', align: 'right', render: d => d.rejection ? `<span style="color:var(--red)">${esc(num(d.rejection))}</span>` : muted('0') },
        { key: 'note', label: 'Note / DC', sort: false, render: d => `${esc(d.note || '')}${d.fileName ? `<span class="sub mono">${esc(d.fileName)}</span>` : ''}${d.remarks ? `<span class="sub">${esc(d.remarks)}</span>` : ''}` },
        { key: 'by', label: 'Recorded by', render: d => esc(nm(state, d.by)) }
      ], dl, { key: 'dl', sort: ctx.local.dlSort, rowClass: d => d.late ? 'row-red' : '', empty: p.po ? 'No delivery recorded yet.' : 'Delivery is tracked after the PO is accepted.' })
    }));
    const grns = p.grns || [];
    parts.push(ui.card({
      title: svc ? 'Service confirmations' : 'Goods receipt notes (GRN)', icon: 'package', flush: true,
      body: ui.table([
        { key: 'number', label: 'Number', render: g => `${mono(g.number)}<span class="sub">${esc(g.type)}</span>` },
        { key: 'poNumber', label: 'PO', render: g => mono(g.poNumber) },
        { key: 'receiptDate', label: 'Receipt date', render: g => esc(dt(g.receiptDate)) },
        { key: 'qty', label: 'Received', align: 'right', render: g => esc(num(g.qty)) },
        { key: 'acceptedQty', label: 'Accepted', align: 'right', render: g => `<b style="color:var(--green)">${esc(num(g.acceptedQty))}</b>` },
        { key: 'rejectedQty', label: 'Rejected', align: 'right', render: g => g.rejectedQty ? `<b style="color:var(--red)">${esc(num(g.rejectedQty))}</b>` : muted('0') },
        { key: 'remarks', label: 'Remarks', sort: false, render: g => esc(g.remarks || '') },
        { key: 'by', label: 'By', render: g => esc(nm(state, g.by)) }
      ], grns, { key: 'grn', sort: ctx.local.grnSort, rowClass: g => g.rejectedQty ? 'row-orange' : '', empty: svc ? 'No service confirmation yet.' : 'No GRN yet.' })
    }));
    const inv = p.invoices || [];
    const it = E.invoiceTotals(p);
    const bal = i => Math.max(0, (i.total || 0) - (i.paidAmount || 0) - (i.adjustedAmount || 0));
    const hist = [].concat(...inv.map(i => (i.history || []).map(h => Object.assign({ number: i.number }, h))));
    parts.push(ui.card({
      title: 'Invoices', icon: 'invoice', flush: true,
      body: ui.table([
        { key: 'number', label: 'Invoice', render: i => `<b class="mono">${esc(i.number)}</b><span class="sub">${esc(i.id)}</span>` },
        { key: 'date', label: 'Date', render: i => esc(dt(i.date)) },
        { key: 'qty', label: 'Qty', align: 'right', render: i => esc(num(i.qty)) },
        { key: 'value', label: 'Value', align: 'right', render: i => ui.money(i.value) },
        { key: 'tax', label: 'Tax', align: 'right', render: i => `${ui.money(i.tax)}<span class="sub">${esc(String(i.taxPct))}%</span>` },
        { key: 'total', label: 'Total', align: 'right', render: i => `<b>${ui.money(i.total)}</b>` },
        { key: 'dueDate', label: 'Due', render: i => bal(i) > 0 ? ui.due(i.dueDate) : esc(dt(i.dueDate)) },
        { key: 'status', label: 'Status', render: i => ui.status(state, 'invoice', i.status) },
        { key: 'paidAmount', label: 'Paid', align: 'right', render: i => ui.money(i.paidAmount) },
        { key: 'adjustedAmount', label: 'Adjusted', align: 'right', render: i => ui.money(i.adjustedAmount) },
        { key: 'balance', label: 'Balance', align: 'right', sort: bal, render: i => bal(i) > 0 ? `<b>${ui.money(bal(i))}</b>` : ui.money(0) }
      ], inv, {
        key: 'inv', sort: ctx.local.invSort, rowClass: i => i.status === 'Mismatch' ? 'row-red' : i.status === 'On Hold' ? 'row-orange' : '', empty: 'No invoice recorded yet.',
        foot: inv.length > 1 ? `<tr><td>Total</td><td></td><td class="num">${esc(num(it.qty))}</td><td class="num">${ui.money(it.basic)}</td><td class="num">${ui.money(it.tax)}</td><td class="num">${ui.money(it.total)}</td><td></td><td></td><td class="num">${ui.money(it.paid)}</td><td class="num">${ui.money(it.adjusted)}</td><td class="num">${ui.money(it.balance)}</td></tr>` : ''
      }) + (hist.length ? `<div class="card-body"><div class="overline mb-8">Invoice corrections</div><ul class="feed">${hist.map(h => `<li><span class="ft">${esc(fmt.dateTime(h.at))}</span><div class="fx"><b>${esc(h.number)}</b> — ${esc(h.type === 'credit_note' ? 'Credit note' : 'Revised invoice')} by ${esc(nm(state, h.by))}<small>Before: ${esc(h.before)}${h.note ? ' · ' + esc(h.note) : ''}</small></div></li>`).join('')}</ul></div>` : '')
    }));
    parts.push(matchPanel(ctx, p));
    return `<div class="stack">${parts.join('')}</div>`;
  }

  function matchPanel(ctx, p) {
    const { state } = ctx;
    if (!p.po) return ui.card({ title: '3-way match — PO ↔ GRN ↔ Invoice', icon: 'check', body: `<p class="muted">The match runs once the PO, GRN and invoice exist.</p>` });
    const m = E.matchResult(state, p);
    const inv = p.invoices || [];
    const grns = p.grns || [];
    const ready = inv.length && grns.length;
    const unit = p.uom || '';
    const cell = (l, v) => v == null || v === '' ? dash : l.money ? ui.money(v) : l.pct ? `${esc(String(v))}%` : typeof v === 'number' ? `${esc(num(v))}${l.key === 'quantity' ? ' ' + esc(unit) : ''}` : esc(v);
    const verdict = !ready ? ui.badge(inv.length ? 'Awaiting GRN' : 'Awaiting invoice', 'grey')
      : m.ok ? `<span class="pd-verdict ok">🟢 Matched${m.accepted ? ' (variance approved)' : ''}</span>` : `<span class="pd-verdict bad">🔴 Exception</span>`;
    const it = E.invoiceTotals(p);
    const grnQty = U.sum(grns, g => g.acceptedQty);
    const cards = `<div class="match-grid mb-16">
      <div class="match-card"><div class="overline">PO</div><b class="mono">${esc(p.po.number)}</b><div class="small muted mt-4">${esc(num(p.po.qty))} ${esc(unit)} × ${esc(fmt.inr(p.po.unitPrice))} + ${esc(String(p.po.taxPct))}% tax</div><div class="mt-4"><b>${ui.money(p.po.total)}</b></div></div>
      <div class="match-card"><div class="overline">GRN / confirmation</div><b class="mono">${grns.length ? esc(grns.map(g => g.number).join(', ')) : '—'}</b><div class="small muted mt-4">${esc(num(grnQty))} ${esc(unit)} accepted</div><div class="mt-4"><b>${ui.money(m.expected)}</b> <span class="small muted">received value</span></div></div>
      <div class="match-card"><div class="overline">Invoice</div><b class="mono">${inv.length ? esc(inv.map(i => i.number).join(', ')) : '—'}</b><div class="small muted mt-4">${esc(num(it.qty))} ${esc(unit)} invoiced</div><div class="mt-4"><b>${ui.money(it.total)}</b></div></div>
    </div>`;
    const lines = ready ? ui.table([
      { key: 'label', label: 'Check', render: l => `<b>${esc(l.label)}</b>` },
      { key: 'po', label: 'PO', align: 'right', sort: false, render: l => cell(l, l.po) },
      { key: 'grn', label: 'GRN', align: 'right', sort: false, render: l => cell(l, l.grn) },
      { key: 'invoice', label: 'Invoice', align: 'right', sort: false, render: l => cell(l, l.invoice) },
      { key: 'ok', label: 'Result', align: 'center', sort: false, render: l => l.ok ? '<b style="color:var(--green)">✓</b>' : '<b style="color:var(--red)">✕</b>' },
      { key: 'detail', label: 'Detail', sort: false, render: l => l.detail ? `<span style="color:var(--${l.ok ? 'ink-2' : 'red'})">${esc(l.detail)}</span>` : muted(l.ok ? 'Matches' : '') }
    ], m.lines, { rowClass: l => l.ok ? '' : 'row-red' }).replace('class="tbl ', 'class="tbl pd-match-tbl ') : `<p class="muted">The line-by-line comparison appears when both the GRN and the invoice are recorded.</p>`;
    const notes = [];
    notes.push(`Tolerance ±${esc(String(m.tolerancePct))}% (Rule R04). A mismatch raises an exception and blocks payment.`);
    if (p.match && p.match.at) notes.push(`Last run ${esc(fmt.dateTime(p.match.at))} by ${esc(nm(state, p.match.by))} — ${esc(p.match.result)}.`);
    if (m.accepted) notes.push(`Variance approved by ${esc(nm(state, m.accepted.by))} on ${esc(fmt.date(m.accepted.at))}: “${esc(m.accepted.remarks || '')}”.`);
    return ui.card({
      title: '3-way match — PO ↔ GRN ↔ Invoice', icon: 'check', actions: verdict,
      body: cards + lines + `<div class="small muted mt-12">${notes.join('<br>')}</div>`
    });
  }

  /* ---------------- PAYMENTS ---------------- */
  function tabPayments(ctx, p) {
    const { state } = ctx;
    const it = E.invoiceTotals(p);
    const advOut = E.purchaseAdvanceOutstanding(state, p);
    const pays = (p.paymentIds || []).map(id => state.payments.find(x => x.id === id)).filter(Boolean);
    const eq = `<div class="pd-eq">
      <div><span>Invoice value</span><b>${ui.money(it.total)}</b></div><i>−</i>
      <div><span>Advance adjusted</span><b>${ui.money(it.adjusted)}</b></div><i>−</i>
      <div><span>Paid</span><b>${ui.money(it.paid)}</b></div><i>=</i>
      <div class="res"><span>Balance payable</span><b>${ui.money(it.balance)}</b></div>
    </div>`;
    const notes = [];
    if (!it.total) notes.push(ui.alert('info', 'No invoice yet — the settlement is calculated once the vendor invoice is recorded.'));
    if (advOut > 0) notes.push(ui.alert('warn', `<b>${esc(fmt.inr(advOut))} advance still outstanding</b> with ${esc(vendorName(state, (p.po || {}).vendorId))}. It must be adjusted against an invoice or recovered before the purchase can close.`));
    pays.filter(x => x.status === 'Failed').forEach(x => notes.push(ui.alert('danger', `<b>${esc(x.id)} failed</b> (${esc(fmt.inr(x.amount))})${x.failureReason ? ` — ${esc(x.failureReason)}` : ''}. The amount is still payable; it is re-processed from the payment step.`)));
    pays.filter(x => x.status === 'Processing').forEach(x => notes.push(ui.alert('warn', `<b>${esc(x.id)} is processing at the bank</b> (${esc(fmt.inr(x.amount))}). It counts as paid only after the bank credit / UTR is confirmed.`)));
    if (it.total && it.balance <= 0 && advOut <= 0) notes.push(ui.alert('success', '<b>Fully settled.</b> Invoice value is covered by payments and advance adjustments.'));
    const pa = p.paymentApproval;
    const paBody = pa ? kv([
      ['Approved by', `${esc(nm(state, pa.by))} · ${esc(dtt(pa.at))}`],
      ['Invoice total', ui.money(pa.invoiceTotal)],
      ['Advance check', pa.advanceOutstanding ? `${ui.money(pa.advanceOutstanding)} outstanding with vendor at approval — acknowledged (Rule R02)` : muted('No outstanding advance')],
      ['Adjustment planned', `${ui.money(pa.adjustPlanned || 0)}${pa.adjustPlanned && it.adjusted !== pa.adjustPlanned ? ` <span class="muted small">· actually adjusted so far ${esc(fmt.inr(it.adjusted))}</span>` : ''}`],
      ['Proposed payment', `<b>${ui.money(pa.proposedAmount)}</b>`],
      ['Remarks', esc(pa.remarks || '')]
    ]) : '';
    const totalPaid = U.sum(pays.filter(x => x.status === 'Paid'), x => x.amount);
    const table = ui.table([
      { key: 'id', label: 'Payment', render: x => `<b class="mono">${esc(x.id)}</b>` },
      { key: 'type', label: 'Type', render: x => ui.badge(x.type, x.type === 'Advance' ? 'purple' : x.type === 'Balance' ? 'navy' : 'blue', { dot: false }) },
      { key: 'amount', label: 'Amount', align: 'right', render: x => `<b>${ui.money(x.amount)}</b>` },
      { key: 'date', label: 'Date', render: x => esc(dt(x.date)) },
      { key: 'mode', label: 'Mode', render: x => esc(x.mode || '—') },
      { key: 'bank', label: 'Bank', render: x => `<span class="small">${esc(x.bank || '—')}</span>` },
      { key: 'utr', label: 'UTR', render: x => x.utr ? mono(x.utr) : dash },
      { key: 'proof', label: 'Proof', sort: false, render: x => x.proof ? `<span class="mono small">${esc(x.proof)}</span>` : dash },
      { key: 'status', label: 'Status', render: x => `${ui.status(state, 'payment', x.status)}${x.failureReason ? `<span class="sub" style="color:var(--red)">${esc(x.failureReason)}</span>` : ''}` }
    ], pays, { key: 'pay', sort: ctx.local.paySort, rowClass: x => x.status === 'Failed' ? 'row-red' : x.status === 'Processing' ? 'row-orange' : '', empty: 'No payments yet.', foot: pays.length ? `<tr><td colspan="2">Total paid to vendor</td><td class="num">${ui.money(totalPaid)}</td><td colspan="6" class="muted small" style="font-weight:500">Advance + invoice + balance payments with status Paid</td></tr>` : '' });
    return ui.card({ title: 'Settlement', icon: 'rupee', sub: 'Invoice Value − Advance Adjusted − Paid = Balance Payable', body: eq + (notes.length ? `<div class="stack-sm mt-12">${notes.join('')}</div>` : '') })
      + (pa ? `<div class="mt-16">${ui.card({ title: 'Payment approval', icon: 'approve', body: paBody })}</div>` : '')
      + `<div class="mt-16">${ui.card({ title: 'Payments', icon: 'payment', flush: true, body: table })}</div>`;
  }

  /* ---------------- EXCEPTIONS ---------------- */
  function tabExceptions(ctx, p, a, canAct, R) {
    const { state } = ctx;
    const all = S.exceptionRows(state).filter(e => e.purchaseId === p.id);
    const view = ctx.local.excView || 'open';
    const rows = view === 'open' ? all.filter(isOpenEx) : all;
    const nOpen = all.filter(isOpenEx).length;
    const table = ui.table([
      { key: 'id', label: 'ID', render: e => `<b class="mono nowrap">${esc(e.id)}</b><span class="sub">${esc(e.source === 'system' || e.raisedBy === 'system' ? 'System' : nm(state, e.raisedBy))}</span>` },
      { key: 'type', label: 'Type', render: e => `<b>${esc(e.type)}</b><span class="sub">${esc(e.description || e.title || '')}</span>` },
      { key: 'severity', label: 'Severity', sort: e => ({ High: 0, Medium: 1, Low: 2 }[e.severity] || 1), render: e => ui.badge(e.severity, sevTone(e.severity)) },
      { key: 'owner', label: 'Owner', render: e => esc(e.owner) },
      { key: 'date', label: 'Raised', render: e => esc(dt(e.date)) },
      { key: 'dueDate', label: 'Due', render: e => isOpenEx(e) ? ui.due(e.dueDate) : esc(dt(e.dueDate)) },
      { key: 'status', label: 'Status', render: e => ui.status(state, 'exception', e.status) },
      { key: 'action', label: 'Action / resolution', sort: false, render: e => `${esc(e.action || '')}${e.resolution ? `<span class="sub" style="color:var(--green)">Resolved: ${esc(e.resolution)}${e.resolvedAt ? ` · ${esc(fmt.dateShort(e.resolvedAt))}` : ''}</span>` : ''}` }
    ], rows, { key: 'exc', sort: ctx.local.excSort, rowClass: e => isOpenEx(e) ? (e.overdue ? 'row-red' : e.severity === 'High' ? 'row-red' : 'row-orange') : '', empty: view === 'open' ? 'No open exceptions on this purchase.' : 'No exceptions recorded.' });
    return ui.card({
      title: 'Exceptions', icon: 'alert', flush: true,
      sub: `${nOpen} open · ${all.length} total. Open exceptions block closure.`,
      actions: ui.seg('excView', [{ id: 'open', label: `Open (${nOpen})` }, { id: 'all', label: `All (${all.length})` }], view) + (R.raise ? `<button class="btn btn-sm btn-outline-danger" data-act="pd-raise">${I('plus', 14)} Raise exception</button>` : ''),
      body: table
    });
  }

  function openRaise(ctx, p) {
    const st = ctx.state;
    const a = E.currentActivity(p);
    const roleName = id => (E.role(st, id) || {}).name || id;
    const owners = U.sortBy(st.masters.users.filter(u => u.status === 'Active'), u => u.name).map(u => ({ value: u.id, label: `${u.name} — ${roleName(u.roleId)}` }));
    const dflt = (a && a.ownerUserId) || p.buyerId || ctx.user.id;
    ui.modal.open({
      title: `Raise exception on ${esc(p.id)}`, size: 'lg',
      body: `<div class="form-grid">
        ${ui.field({ name: 'type', label: 'Exception type', type: 'select', options: EXC_TYPES, value: 'Other', required: true })}
        ${ui.field({ name: 'severity', label: 'Severity', type: 'select', options: ['High', 'Medium', 'Low'], value: 'Medium', required: true })}
        ${ui.field({ name: 'ownerUserId', label: 'Owner (who must resolve it)', type: 'select', options: owners, value: dflt, required: true })}
        ${ui.field({ name: 'dueDate', label: 'Due date', type: 'date', value: U.addDays(PCT.clock.now(), 2, true), min: PCT.clock.now(), required: true })}
        ${ui.field({ name: 'description', label: 'What is wrong?', type: 'textarea', required: true, full: true, placeholder: 'e.g. Delivery challan quantity does not match the PO schedule' })}
        ${ui.field({ name: 'action', label: 'Action required', type: 'text', required: true, full: true, placeholder: 'e.g. Obtain corrected challan from vendor' })}
      </div>`,
      actions: [{ label: 'Cancel', act: 'close' }, { label: 'Raise exception', act: 'save', tone: 'danger', icon: 'alert' }],
      onAction: {
        save: v => {
          const description = String(v.description || '').trim();
          const action = String(v.action || '').trim();
          if (!v.type || !v.severity || !v.ownerUserId) { ui.toast('Select type, severity and owner.', 'red', 'Required'); return false; }
          if (!description) { ui.toast('Describe what is wrong.', 'red', 'Required'); return false; }
          if (!action) { ui.toast('Enter the action required.', 'red', 'Required'); return false; }
          if (!v.dueDate) { ui.toast('Enter the due date.', 'red', 'Required'); return false; }
          const uid = ctx.user.id;
          const cur = E.currentActivity(p);
          const r = ctx.commit(s => {
            const rec = E.raiseException(s, {
              purchaseId: p.id, type: v.type, title: `${v.type} — ${p.id}`, description, ownerUserId: v.ownerUserId,
              severity: v.severity, action, dueDate: U.endOfBusiness(v.dueDate), activityId: cur ? cur.id : null
            }, uid);
            return rec ? { ok: true, id: rec.id } : { ok: false, error: 'A similar exception is already open.' };
          });
          if (r && r.ok) { ui.toast(`${r.id} raised and assigned to ${nm(PCT.store.get(), v.ownerUserId)}`, 'green', 'Exception raised'); ctx.local.excView = 'open'; return undefined; }
          return false;
        }
      }
    });
  }

  /* ---------------- COMMENTS ---------------- */
  function tabComments(ctx, p) {
    const { state, user } = ctx;
    const list = U.sortBy(p.comments || [], c => c.t);
    const thread = list.length ? `<ul class="pd-thread">${list.map(c => `<li class="${c.userId === user.id ? 'mine' : ''}">${ui.avatar(nm(state, c.userId), 'sm')}<div class="grow"><div class="row wrap gap-4"><b>${esc(nm(state, c.userId))}</b><span class="muted small">${esc((E.role(state, (E.user(state, c.userId) || {}).roleId) || {}).name || '')} · ${esc(fmt.dateTime(c.t))} · ${esc(fmt.ago(c.t))}</span></div><div class="pd-pre mt-4">${esc(c.text)}</div></div></li>`).join('')}</ul>`
      : ui.empty('message', 'No comments yet', 'Use comments to coordinate — every comment is time-stamped and kept in the audit trail.');
    const form = `<form data-submit="pd-comment" class="pd-cform">
      <div class="row-top gap-12">${ui.avatar(user.name, 'sm')}<div class="grow">${ui.field({ name: 'text', type: 'textarea', placeholder: `Write a comment as ${user.name}…`, rows: 3 })}</div></div>
      <div class="row end mt-8"><button class="btn btn-primary btn-sm" type="submit">${I('send', 14)} Post comment</button></div>
    </form>`;
    return ui.card({ title: 'Comments', icon: 'message', sub: `${plural(list.length, 'comment')} · visible to everyone who can see this purchase`, body: thread, foot: form });
  }

  /* ---------------- AUDIT ---------------- */
  function auditRows(state, p) {
    return U.sortBy(state.audit.filter(x => x.purchaseId === p.id), x => -x.t);
  }
  function tabAudit(ctx, p) {
    const { state } = ctx;
    const all = auditRows(state, p);
    const entities = U.uniq(all.map(x => x.entity || 'Purchase')).sort();
    const ent = ctx.local.auditEntity || '';
    const rows = ent ? all.filter(x => (x.entity || 'Purchase') === ent) : all;
    const filter = `<select class="input" style="width:auto;height:30px;font-size:12.5px" data-act-change="pd-audit-filter" aria-label="Filter by entity"><option value="">All entities (${all.length})</option>${entities.map(e => `<option value="${esc(e)}" ${e === ent ? 'selected' : ''}>${esc(e)} (${all.filter(x => (x.entity || 'Purchase') === e).length})</option>`).join('')}</select>`;
    const table = ui.table([
      { key: 't', label: 'When', render: x => `<span class="nowrap">${esc(fmt.date(x.t))}</span><span class="sub">${esc(fmt.time(x.t))}</span>` },
      { key: 'userId', label: 'Who', sort: x => nm(state, x.userId), render: x => x.userId === 'system' || !x.userId ? '<span class="muted">System</span>' : esc(nm(state, x.userId)) },
      { key: 'action', label: 'Action', render: x => `<b>${esc(x.action)}</b>` },
      { key: 'entity', label: 'Entity', render: x => `${esc(x.entity || 'Purchase')}${x.entityId ? `<span class="sub mono">${esc(x.entityId)}</span>` : ''}` },
      { key: 'field', label: 'Field', render: x => x.field ? esc(x.field) : dash },
      { key: 'change', label: 'Previous → New', sort: false, render: x => x.prev != null || x.next != null ? `<span class="muted">${esc(x.prev == null ? '—' : x.prev)}</span> → <b>${esc(x.next == null ? '—' : x.next)}</b>` : dash },
      { key: 'note', label: 'Note', sort: false, render: x => x.note ? `<span class="small">${esc(x.note)}</span>` : dash }
    ], rows, { key: 'audit', sort: ctx.local.auditSort || { col: 't', dir: 'desc' }, dense: true, empty: 'No audit entries.', limit: ctx.local.auditAll ? null : 30 });
    const more = rows.length > 30 ? `<div class="row end" style="padding:8px 14px;border-top:1px solid var(--line-2)"><button class="btn btn-xs btn-ghost" data-act="toggle" data-key="auditAll">${ctx.local.auditAll ? 'Show newest 30' : `Show all ${rows.length} entries`}</button></div>` : '';
    return ui.alert('info', '<b>Immutable record.</b> Audit entries are append-only — they cannot be edited or deleted. Every change shows who, when, what changed (previous → new) and why.', 'lock')
      + `<div class="mt-12">${ui.card({ title: 'Audit trail', icon: 'audit', flush: true, sub: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}${ent ? ` · ${esc(ent)}` : ''} · newest first`, actions: filter + `<button class="btn btn-sm" data-act="pd-export-audit">${I('download', 14)} Export CSV</button>`, body: table + more })}</div>`;
  }

  /* =================================================================
     PAGE CSS (scoped to .pd)
     ================================================================= */
  ui.css('purchase-detail', `
    .pd-crumbs { margin-bottom: 8px; }
    .pd-head { padding: 16px 18px; }
    .pd-top { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
    .pd-id { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--navy-700); background: var(--blue-50); border: 1px solid #D4E1FA; border-radius: 6px; padding: 2px 8px; letter-spacing: -.01em; }
    .pd-title { font-size: 21px; margin-top: 8px; overflow-wrap: anywhere; }
    .pd-actions { align-items: center; }
    .pd-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 20px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line-2); }
    .pd-facts > div > span { display: block; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
    .pd-facts > div > b { display: block; font-size: 13.5px; font-weight: 600; margin-top: 3px; overflow-wrap: anywhere; }
    .pd-facts .pd-value { display: block; font-size: 20px; font-weight: 750; letter-spacing: -.01em; }
    .pd-facts small { display: block; font-weight: 500; font-size: 11.5px; }
    .pd-more { position: relative; }
    .pd-more > summary { list-style: none; }
    .pd-more > summary::-webkit-details-marker { display: none; }
    .pd-more .menu { min-width: 230px; }
    .pd-more .menu div.mi { cursor: default; font-size: 12.5px; }
    .pd-signals { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .chip.pd-sig { font-weight: 600; }
    .chip.pd-sig.tone-red { background: var(--red-bg); border-color: #F5C9C9; color: var(--red); }
    .chip.pd-sig.tone-orange { background: var(--orange-bg); border-color: #F3C7AC; color: var(--orange); }
    .chip.pd-sig.tone-blue { background: var(--blue-50); border-color: #D4E1FA; color: var(--blue-600); }
    .pd-ballnote { max-width: 520px; }
    .pd .ball.tone-grey .ball-orb { background: var(--black); box-shadow: 0 0 0 4px rgba(31,41,55,.12); }
    /* kit ballCard puts an inline 'grid-column: span 6' on Next action → implicit columns + overlap below 1200px */
    .pd .ball-grid > div.wide[style] { grid-column: 1 / -1 !important; }
    .pd .ball-foot .row { align-items: center; }
    .pd-body .grid-main { grid-template-columns: minmax(0, 1fr) 360px; }
    .pd-cl li { display: flex; gap: 8px; align-items: center; padding: 5px 0; font-size: 13px; }
    .pd-cl li .ic { color: var(--green); }
    .pd-pre { white-space: pre-wrap; }
    .pd-qa { margin-top: 8px; padding: 9px 12px; border-radius: 8px; background: var(--blue-50); border: 1px solid #D4E1FA; font-size: 12.5px; color: #1B3F86; }
    .pd-act { border: 1px solid var(--line); border-radius: 9px; padding: 9px 12px; background: #fff; margin-top: 8px; }
    .pd-act.cur { border-color: #F3D3B5; background: #FFFBF5; box-shadow: inset 3px 0 0 #F59E0B; }
    .pd-act.future { background: #FAFBFD; }
    .pd-act.future .pd-act-head b { color: var(--ink-2); font-weight: 600; }
    .pd-act.skip { background: #FAFBFD; opacity: .75; }
    .pd-act.mini { padding: 6px 12px; margin-top: 6px; }
    .pd-act.mini .pd-act-head b { font-weight: 600; font-size: 13px; }
    .pd-tick { width: 16px; height: 16px; border-radius: 50%; background: var(--green-bg); color: var(--green); display: inline-grid; place-items: center; font-size: 10px; font-weight: 800; flex: none; }
    .pd-tick.sk { background: var(--grey-bg); color: var(--muted); }
    .pd-checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .pd-tabs .tab { padding: 10px 10px; }
    .pd-act-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pd-act-head b { font-size: 13.5px; }
    .pd-act-meta { display: flex; flex-wrap: wrap; gap: 3px 18px; font-size: 12.5px; color: var(--ink-2); margin-top: 5px; }
    .pd-act-meta em { font-style: normal; color: var(--muted); margin-right: 5px; }
    .pd .vsteps .vbody > .row b { font-size: 14px; }
    .pd-eq { display: flex; flex-wrap: wrap; align-items: stretch; gap: 10px; }
    .pd-eq > div { flex: 1 1 150px; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: #fff; }
    .pd-eq > div > span { display: block; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
    .pd-eq > div b { display: block; font-size: 20px; font-weight: 750; margin-top: 4px; letter-spacing: -.01em; }
    .pd-eq > i { align-self: center; font-style: normal; font-size: 22px; color: var(--muted); font-weight: 700; }
    .pd-eq > div.res { background: var(--navy-800); border-color: var(--navy-800); color: #fff; }
    .pd-eq > div.res > span { color: #A9BBD6; }
    .pd .tbl th.num { text-align: right; }
    .pd .tbl .mono { white-space: nowrap; }
    .pd-match-tbl td:last-child { min-width: 240px; }
    .pd-out { border-radius: 10px; padding: 14px 16px; border: 1px solid var(--line); background: #fff; }
    .pd-out .pd-out-v { font-size: 24px; font-weight: 800; letter-spacing: -.02em; margin-top: 2px; }
    .pd-out.tone-orange { background: var(--orange-bg); border-color: #F3C7AC; } .pd-out.tone-orange .pd-out-v { color: var(--orange); }
    .pd-out.tone-red { background: var(--red-bg); border-color: #F5C9C9; } .pd-out.tone-red .pd-out-v { color: var(--red); }
    .pd-out.tone-green { background: var(--green-bg); border-color: #BFE6D3; } .pd-out.tone-green .pd-out-v { color: var(--green); }
    .pd-out.tone-blue { background: var(--blue-50); border-color: #D4E1FA; } .pd-out.tone-blue .pd-out-v { color: var(--blue-600); font-size: 18px; }
    .pd-out.tone-grey .pd-out-v { color: var(--muted); font-size: 18px; }
    .pd-out-note { color: var(--ink-2); }
    .pd-out .badge { background: rgba(255,255,255,.85); }
    .pd-verdict { font-weight: 700; font-size: 13.5px; }
    .pd-verdict.ok { color: var(--green); } .pd-verdict.bad { color: var(--red); }
    .tbl tr.pd-l1 td { background: #F3FBF7; }
    .tbl tr.pd-withdrawn td { opacity: .5; text-decoration: line-through; }
    .pd-thread { list-style: none; margin: 0; padding: 0; }
    .pd-thread li { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line-2); font-size: 13.5px; }
    .pd-thread li:last-child { border-bottom: 0; }
    .pd-thread li.mine .grow > div:last-child { background: var(--blue-50); border-radius: 8px; padding: 6px 10px; }
    .pd-cform { width: 100%; }
    .pd .card-foot .pd-cform .field textarea { min-height: 64px; }
    @media (max-width: 1200px) { .pd-body .grid-main { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 900px) {
      .pd .grid-2, .pd .grid-3, .pd-checks { grid-template-columns: minmax(0, 1fr); }
      .pd .table-wrap > .tbl { min-width: 660px; }   /* scroll sideways instead of squeezing cells */
      .pd .table-wrap > .tbl:has(.table-empty) { min-width: 0; }
    }
    @media (max-width: 560px) {
      .pd-title { font-size: 18px; }
      .pd-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
      .pd-facts .pd-value { font-size: 18px; }
      .pd-eq > i { display: none; }
      .pd-eq > div { flex-basis: calc(50% - 5px); }
      .pd-eq > div b { font-size: 17px; }
      .pd-act-head .grow { display: none; }
      .pd .card-head .pill-legend { display: none; }
      .pd .ball-foot > .row { width: 100%; }
      .pd .kv { grid-template-columns: 110px minmax(0, 1fr); }
    }
    @media print {
      .pd-tabs, .pd-signals, .pd-more, .pd .ball-foot .row, .pd .card-foot { display: none !important; }
      .pd .card, .pd .ball { break-inside: avoid; }
    }
  `);
})();
