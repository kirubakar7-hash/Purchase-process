/* =====================================================================
   APPROVALS — Approval Queue · My Approval History · High-value Purchases
   #/approvals[?tab=queue|history|high]           (perms: approve)

   Queue = S.myActions(state, user) limited to approval-type activities
   (PR L1/L2/L3, non-L1 vendor selection, PO, advance, payment, technical).
   Each item opens a review modal with the key facts and only the
   decisions the engine allows for that step:
     approval            → approve · return · clarify · reject
     selection_approval  → approve · return
     po_approve          → approve · return
     advance_approve     → approve · return · reject
     payment_approval    → approve (acknowledge outstanding advance, R02) · return
     tech_eval           → opens the purchase page (criteria checklist)
   Bulk approval is deliberately not offered (control).
   ===================================================================== */
(function () {
  const U = PCT.util;
  const fmt = U.fmt;
  const esc = U.esc;
  const I = (n, s) => PCT.icon(n, s);
  const E = PCT.engine;
  const S = PCT.sel;
  const ui = PCT.ui;

  const LIVE = ['Open', 'On Hold'];
  const HIGH_VALUE = 1000000;   // ₹10,00,000
  const DECISIONS = ['Approved', 'Returned', 'Rejected', 'Clarification'];
  /** Decision colours follow the Status Master (Completed / Rejected / Waiting); a return is rework → orange. */
  const decisionTone = (state, d) => d === 'Approved' ? S.statusTone(state, 'activity', 'Completed') : d === 'Rejected' ? S.statusTone(state, 'activity', 'Rejected') : d === 'Clarification' ? S.statusTone(state, 'activity', 'Waiting') : 'orange';

  const OPS = {
    approval: [
      { op: 'clarify', label: 'Ask clarification', tone: 'secondary', need: 'question' },
      { op: 'return', label: 'Return to requestor', tone: 'warn', need: 'remarks' },
      { op: 'reject', label: 'Reject', tone: 'outline-danger', need: 'remarks' },
      { op: 'approve', label: 'Approve', tone: 'success' }
    ],
    selection_approval: [
      { op: 'return', label: 'Return to buyer', tone: 'warn', need: 'remarks' },
      { op: 'approve', label: 'Approve selection', tone: 'success' }
    ],
    po_approve: [
      { op: 'return', label: 'Return PO', tone: 'warn', need: 'remarks' },
      { op: 'approve', label: 'Approve PO', tone: 'success' }
    ],
    advance_approve: [
      { op: 'return', label: 'Return', tone: 'warn', need: 'remarks' },
      { op: 'reject', label: 'Reject advance', tone: 'outline-danger', need: 'remarks' },
      { op: 'approve', label: 'Approve advance', tone: 'success' }
    ],
    payment_approval: [
      { op: 'return', label: 'Return', tone: 'warn', need: 'remarks' },
      { op: 'approve', label: 'Approve payment', tone: 'success' }
    ]
  };

  /* ---------------- helpers ---------------- */
  const nm = (state, id) => (!id || id === 'system') ? 'System' : E.userName(state, id);
  const dash = '<span class="muted">—</span>';
  const kv = rows => `<dl class="kv ap-kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? dash : v}</dd>`).join('')}</dl>`;
  const lastAdvance = (state, p) => (p.advanceIds || []).map(id => E.advance(state, id)).filter(a => a && a.status !== 'Rejected').pop() || null;
  const ranking = p => U.sortBy((p.quotations || []).filter(q => q.status !== 'Withdrawn'), q => Number(q.total) || 0);
  const pValue = p => p.po ? p.po.total : p.estValue;
  const pct = (a, b) => b ? Math.round((a - b) / b * 1000) / 10 : 0;

  /** What kind of approval is this, and what amount is being decided? */
  function info(state, p, a) {
    switch (a.actionType) {
      case 'approval': {
        const l = (p.approvals || []).find(x => x.level === a.approvalLevel) || {};
        return { type: `PR approval · L${a.approvalLevel}`, sub: `${l.label || ''} · level ${a.approvalLevel} of ${(p.approvals || []).length}`, amount: p.estValue, amountSub: 'Estimated value' };
      }
      case 'selection_approval': {
        const sel = p.selection || {};
        const q = (p.quotations || []).find(x => x.vendorId === sel.vendorId) || {};
        const l1 = ranking(p)[0] || {};
        const diff = (Number(q.total) || 0) - (Number(l1.total) || 0);
        return { type: 'Vendor selection', sub: 'Non-L1 vendor · Rule R11', amount: q.total || pValue(p), amountSub: `${S.vendorName(state, sel.vendorId)}${diff > 0 ? ` · +${fmt.inr(diff)} vs L1` : ''}` };
      }
      case 'po_approve':
        return { type: 'PO approval', sub: p.po ? p.po.number : 'Purchase order', amount: p.po ? p.po.total : p.estValue, amountSub: p.po ? `PO total · ${S.vendorName(state, p.po.vendorId)}` : 'Estimate' };
      case 'advance_approve': {
        const adv = lastAdvance(state, p) || {};
        const t = (U.byId(state.masters.advanceTypes, adv.typeId) || {}).name || 'Advance';
        return { type: 'Advance approval', sub: `${adv.pct || 0}% · ${t}`, amount: adv.amount || 0, amountSub: p.po ? `${adv.pct || 0}% of PO ${fmt.inr(p.po.total)}` : 'Advance' };
      }
      case 'payment_approval': {
        const it = E.invoiceTotals(p);
        const own = E.purchaseAdvanceOutstanding(state, p);
        const adj = Math.min(own, it.balance);
        return { type: 'Payment approval', sub: 'Payment proposal', amount: Math.max(0, it.balance - adj), amountSub: adj ? `Invoice ${fmt.inr(it.balance)} − advance ${fmt.inr(adj)}` : `Invoice balance · ${(p.invoices || []).length} invoice(s)` };
      }
      case 'tech_eval':
        return { type: 'Technical evaluation', sub: 'Specification & suitability', amount: pValue(p), amountSub: p.comparison ? `Recommended: ${S.vendorName(state, p.comparison.recommendedVendorId)}` : '' };
      default:
        return { type: a.name, sub: a.stageName, amount: pValue(p), amountSub: '' };
    }
  }

  /** L1 ✓ › L2 ● › L3 ○ — approval progress per level */
  function routeHtml(state, p, opts) {
    const levels = p.approvals || [];
    if (!levels.length) return dash;
    const cur = E.currentActivity(p);
    return `<div class="ap-route ${opts && opts.compact ? 'compact' : ''}">${levels.map(l => {
      const isCur = cur && cur.actionType === 'approval' && cur.approvalLevel === l.level;
      const st = l.status === 'Approved' ? 'done' : l.status === 'Rejected' ? 'rej' : isCur ? (E.isOverdue(state, cur) ? 'od' : 'cur') : 'todo';
      const mark = { done: '✓', rej: '✕', cur: '●', od: '●', todo: '○' }[st];
      const who = isCur ? nm(state, cur.ownerUserId) : nm(state, l.userId);
      const tip = `L${l.level} ${l.label} — ${who} — ${l.status === 'Pending' && isCur ? (st === 'od' ? 'Overdue' : 'In progress') : l.status}${l.at ? ' ' + fmt.date(l.at) : ''}`;
      return `<span class="ap-lv ap-${st}" title="${esc(tip)}"><b>L${l.level} ${mark}</b><small>${esc(who)}</small></span>`;
    }).join('<span class="ap-arrow">›</span>')}</div>`;
  }

  /* ---------------- data ---------------- */
  function queueRows(state, user) {
    return S.myActions(state, user).filter(r => r.activityObj.approval).map(r => {
      const inf = info(state, r.p, r.activityObj);
      return Object.assign(r, { type: inf.type, typeSub: inf.sub, amount: inf.amount, amountSub: inf.amountSub, startAt: r.activityObj.startAt, actionType: r.activityObj.actionType });
    });
  }
  function clarificationRows(state, user) {
    return S.visiblePurchases(state, user).filter(p => LIVE.includes(p.status)).map(p => ({ p, a: E.currentActivity(p) }))
      .filter(x => x.a && x.a.approval && x.a.ownerUserId === user.id && x.a.clarification && !x.a.clarification.response && x.p.requestorId !== user.id);
  }
  function upcomingRows(state, user) {
    const out = [];
    S.visiblePurchases(state, user).forEach(p => {
      if (!['Open', 'On Hold', 'Draft'].includes(p.status)) return;
      const cur = E.currentActivity(p);
      (p.activities || []).forEach(a => {
        if (a.actionType !== 'approval' || a.status !== 'Not Started' || a.ownerUserId !== user.id) return;
        if (cur && cur.id === a.id) return;
        out.push({ p, a, level: a.approvalLevel, cur });
      });
    });
    return U.sortBy(out, x => -pValue(x.p));
  }

  function typeOfActivity(p, a) {
    if (!a) return null;
    const l = a.approvalLevel ? (p.approvals || []).find(x => x.level === a.approvalLevel) : null;
    return ({ approval: `PR approval · L${a.approvalLevel}${l ? ' ' + l.label : ''}`, selection_approval: 'Vendor selection (non-L1)', po_approve: 'PO approval', advance_approve: 'Advance approval', payment_approval: 'Payment approval', tech_eval: 'Technical evaluation', review: 'Initial review' })[a.actionType] || a.name;
  }
  function levelText(state, e, p) {
    switch (e.entity) {
      case 'Approval': return `PR approval · ${e.field || ''}`.trim();
      case 'Payment Proposal': return 'Payment approval';
      case 'Technical Evaluation': return 'Technical evaluation';
      case 'Vendor Selection': return 'Vendor selection (non-L1)';
      case 'PO': return `PO approval · ${e.entityId}`;
      case 'Advance': return `Advance approval · ${e.entityId}`;
      case 'Activity': {
        const a = p && (p.activities || []).find(x => x.id === e.entityId);
        return typeOfActivity(p, a) || e.prev || 'Activity';
      }
      default: {
        const l = p && (p.approvals || []).find(x => x.status === 'Rejected' && x.userId === e.userId);
        return l ? `PR approval · L${l.level} ${l.label}` : 'Purchase';
      }
    }
  }
  function historyRows(state, user) {
    const vis = new Set(S.visiblePurchases(state, user).map(p => p.id));
    const out = [];
    state.audit.forEach(e => {
      if (e.userId !== user.id) return;
      let decision = null;
      if (e.action === 'Approved' || e.action === 'Rejected' || e.action === 'Returned') decision = e.action;
      else if (e.action === 'Clarification Requested') decision = 'Clarification';
      else if (e.action === 'Status Changed' && (e.entity === 'PO' || e.entity === 'Advance') && (e.next === 'Approved' || e.next === 'Rejected')) decision = e.next;
      if (!decision) return;
      if (e.purchaseId && !vis.has(e.purchaseId)) return;
      const p = e.purchaseId ? E.purchase(state, e.purchaseId) : null;
      out.push({ id: e.id, t: e.t, purchaseId: e.purchaseId, title: p ? p.title : '—', level: levelText(state, e, p), decision, remarks: e.note || '', value: p ? pValue(p) : 0, status: p ? p.status : '' });
    });
    return U.sortBy(out, r => -r.t);
  }
  function highValueRows(state, user) {
    return S.visiblePurchases(state, user).filter(p => LIVE.includes(p.status)).map(p => {
      const pending = (p.approvals || []).filter(l => l.status !== 'Approved').length;
      return Object.assign(S.row(state, p), { pendingLevels: pending, levels: (p.approvals || []).length, approvedLevels: (p.approvals || []).filter(l => l.status === 'Approved').length });
    }).filter(r => r.value > HIGH_VALUE || r.pendingLevels >= 2);
  }

  /* ---------------- review modal ---------------- */
  function specificFacts(state, p, a) {
    switch (a.actionType) {
      case 'approval': {
        const lv = (p.approvals || []).find(x => x.level === a.approvalLevel) || {};
        const m = lv.matrixId ? U.byId(state.masters.approvalMatrix, lv.matrixId) : null;
        const rev = (p.activities || []).find(x => x.actionType === 'review' && x.status === 'Completed');
        const f = p.flags || {};
        const flags = [f.advanceRequired ? `Advance ${f.advancePct}%` : null, f.singleSource ? 'Single source' : null, f.emergency ? 'Emergency' : null, f.agreementRequired ? 'Agreement' : null].filter(Boolean);
        return kv([
          ['Approval matrix', m ? `${esc(m.name)} <span class="muted">(${esc(m.id)})</span>` : 'Default'],
          ['This level', `L${a.approvalLevel} ${esc(lv.label || '')} of ${(p.approvals || []).length}`],
          ['Budget available', p.budgetAvailable ? ui.badge('Yes', 'green', { dot: false }) : ui.badge('Not confirmed', 'orange', { dot: false })],
          ['Initial review', rev ? `${esc(nm(state, rev.completedBy))} · ${esc(fmt.date(rev.completedAt))}${rev.remarks ? ` <span class="muted">— ${esc(rev.remarks)}</span>` : ''}` : dash],
          ['Conditions', flags.length ? flags.map(x => `<span class="tag">${esc(x)}</span>`).join(' ') : 'None']
        ]);
      }
      case 'selection_approval': {
        const sel = p.selection || {};
        const rank = ranking(p);
        const l1 = rank[0] || {};
        const q = (p.quotations || []).find(x => x.vendorId === sel.vendorId) || {};
        const diff = (Number(q.total) || 0) - (Number(l1.total) || 0);
        return kv([
          ['Selected vendor', `<b>${esc(S.vendorName(state, sel.vendorId))}</b> · ${esc(fmt.inr(q.total))}`],
          ['L1 (lowest)', `${esc(S.vendorName(state, l1.vendorId))} · ${esc(fmt.inr(l1.total))}`],
          ['Difference', diff > 0 ? `<span style="color:var(--red);font-weight:650">+${esc(fmt.inr(diff))} (${pct(q.total, l1.total)}%)</span>` : '—'],
          ['Quotations', `${rank.length} received · ${rank.map((x, i) => `L${i + 1} ${esc(S.vendorName(state, x.vendorId).split(' ')[0])}`).join(' · ')}`],
          ['Selection reason', esc(sel.reason || '—')],
          ['Delivery / warranty', q.deliveryDays ? `${q.deliveryDays} days · ${esc(q.warranty || '—')}` : dash]
        ]);
      }
      case 'po_approve': {
        const po = p.po || {};
        const varEst = (Number(po.total) || 0) - (Number(p.estValue) || 0);
        return kv([
          ['PO number', `<b class="mono">${esc(po.number || '—')}</b> · ${esc(po.status || '')}`],
          ['Vendor', esc(S.vendorName(state, po.vendorId))],
          ['Quantity × price', `${esc(fmt.num(po.qty))} ${esc(p.uom || '')} × ${esc(fmt.inr(po.unitPrice))}`],
          ['Basic + tax', `${esc(fmt.inr(po.basic))} + ${esc(fmt.inr(po.tax))} (${esc(String(po.taxPct))}%)`],
          ['PO total', `<b>${esc(fmt.inr(po.total))}</b> <span class="small ${varEst > 0 ? 'money-neg' : 'muted'}">${varEst ? `${varEst > 0 ? '+' : '−'}${esc(fmt.inr(Math.abs(varEst)))} vs estimate` : 'equals estimate'}</span>`],
          ['Terms', `${esc(String(po.deliveryDays || '—'))} days delivery · ${esc(po.paymentTerms || '—')} · warranty ${esc(po.warranty || '—')}`],
          ['Created by', `${esc(nm(state, po.createdBy))} · ${esc(fmt.date(po.createdAt))}`]
        ]);
      }
      case 'advance_approve': {
        const adv = lastAdvance(state, p) || {};
        const other = E.vendorOutstanding(state, adv.vendorId, p.id);
        const band = U.sortBy((state.masters.advanceApproval || []).filter(b => b.status === 'Active'), b => b.maxPct).find(b => (adv.pct || 0) <= b.maxPct);
        return kv([
          ['Advance', `<b class="mono">${esc(adv.id || '—')}</b> · ${esc((U.byId(state.masters.advanceTypes, adv.typeId) || {}).name || '')}`],
          ['Amount', `<b>${esc(fmt.inr(adv.amount))}</b> · ${esc(String(adv.pct || 0))}% of ${esc(p.po ? p.po.number : 'PO')} ${p.po ? esc(fmt.inr(p.po.total)) : ''}`],
          ['Vendor', esc(S.vendorName(state, adv.vendorId))],
          ['Other outstanding advances', other > 0 ? `<span style="color:var(--orange);font-weight:650">${esc(fmt.inr(other))}</span> with this vendor` : 'None'],
          ['Settlement', `${esc(String(adv.settlementDays || 30))} days after payment (Rule R09)`],
          ['Approval band', band ? `${esc(band.name)} → ${esc((E.role(state, band.approverRole) || {}).name || band.approverRole)}` : dash],
          ['Requested by', `${esc(nm(state, adv.requestedBy))} · ${esc(fmt.date(adv.requestedAt))}`]
        ]);
      }
      case 'payment_approval': {
        const it = E.invoiceTotals(p);
        const own = E.purchaseAdvanceOutstanding(state, p);
        const adj = Math.min(own, it.balance);
        const m = E.matchResult(state, p);
        return kv([
          ['Invoices', (p.invoices || []).map(i => `<span class="mono">${esc(i.number)}</span> ${esc(fmt.inr(i.total))} <span class="muted">due ${esc(fmt.date(i.dueDate))}</span>`).join('<br>') || dash],
          ['Invoice total', esc(fmt.inr(it.total))],
          ['Already paid / adjusted', `${esc(fmt.inr(it.paid))} / ${esc(fmt.inr(it.adjusted))}`],
          ['Advance to adjust', adj ? `− ${esc(fmt.inr(adj))} <span class="muted">(this purchase)</span>` : 'None on this purchase'],
          ['Proposed payment', `<b>${esc(fmt.inr(Math.max(0, it.balance - adj)))}</b>`],
          ['3-way match', p.match ? ui.badge(p.match.result, p.match.result === 'Matched' ? 'green' : 'red') + (m.accepted ? ' <span class="small muted">variance approved</span>' : '') : dash],
          ['Vendor', esc(S.vendorName(state, p.po && p.po.vendorId))]
        ]);
      }
      default: return '';
    }
  }

  function reviewBody(state, user, p, a) {
    const inf = info(state, p, a);
    const b = E.ball(state, p);
    const f = p.flags || {};
    const ver = p.processVersion ? `Process V${esc(p.processVersion)}` : '';
    const due = E.isOverdue(state, a)
      ? ui.alert('danger', `<b>${esc(fmt.days(E.overdueDays(state, a)))} overdue</b> — due ${esc(fmt.dateTime(a.dueAt))}. Waiting with you since ${esc(fmt.date(a.startAt))}.`)
      : ui.alert('info', `Due <b>${esc(fmt.due(a.dueAt))}</b> (${esc(fmt.dateTime(a.dueAt))}) · waiting with you ${esc(fmt.days(b.ageingDays))}.`);
    const core = kv([
      ['Requestor', ui.person(state, p.requestorId)],
      ['Department', esc(S.deptName(state, p.deptId))],
      ['Cost centre', esc(S.ccName(state, p.costCentreId))],
      ['Category', esc(S.catName(state, p.categoryId))],
      ['Quantity', `${esc(fmt.num(p.qty))} ${esc(p.uom || '')}`],
      ['Estimated value', esc(fmt.inr(p.estValue))],
      ['Required by', p.requiredBy ? `${esc(fmt.date(p.requiredBy))} <span class="muted">(${esc(fmt.due(p.requiredBy))})</span>` : dash],
      ['Priority', ui.priority(state, p.priority)]
    ]);
    let r02 = '';
    if (a.actionType === 'payment_approval' && p.po) {
      const out = E.vendorOutstanding(state, p.po.vendorId, null);
      if (out > 0 && E.rule(state, 'R02')) {
        r02 = `<div class="mt-12">${ui.alert('warn', `<b>Rule R02 — existing advance of ${esc(fmt.inr(out))}</b> is outstanding with ${esc(S.vendorName(state, p.po.vendorId))}. Consider adjusting it against this payment before paying in full.`)}
          <label class="check ap-ack mt-8"><input type="checkbox" name="acknowledgeAdvance"> I have reviewed the outstanding advance of ${esc(fmt.inr(out))} and approve this payment</label></div>`;
      }
    }
    const clar = a.clarification && a.clarification.response ? `<div class="mt-12">${ui.alert('success', `<b>Clarification answered</b> by ${esc(nm(state, p.requestorId))} on ${esc(fmt.date(a.clarification.respondedAt))}<br>Q: “${esc(a.clarification.question)}”<br>A: “${esc(a.clarification.response)}”`)}</div>` : '';
    const justification = a.actionType === 'selection_approval' ? '' : (p.justification ? `<div class="ap-just"><div class="overline">Business justification</div><p>${esc(p.justification)}</p>${p.specification ? `<div class="overline mt-8">Specification</div><p class="small">${esc(p.specification)}</p>` : ''}</div>` : '');
    const ops = OPS[a.actionType] || [];
    const needsText = ops.filter(o => o.need).map(o => o.op === 'clarify' ? 'ask a clarification' : o.op === 'reject' ? 'reject' : 'return').join(', ');
    return `<div class="ap-rv">
      <div class="ap-rv-top">
        <div class="grow">
          <div class="row wrap gap-4"><a class="mono strong" href="#/purchases/${esc(p.id)}" data-act="ap-open" data-id="${esc(p.id)}" title="Open the full purchase">${esc(p.id)} ${I('external', 12)}</a>${p.prNo ? `<span class="small muted mono">${esc(p.prNo)}</span>` : ''}${f.emergency ? ui.badge('Emergency', 'red') : ''}${ui.badge(inf.type, 'blue', { dot: false })}</div>
          <h3 class="mt-4">${esc(p.title)}</h3>
          <div class="small muted mt-4">${esc(inf.sub)} · ${esc(a.stageName)} · ${ver}</div>
        </div>
        <div class="ap-amt"><div class="overline">Amount for decision</div><div class="v">${esc(fmt.inr(inf.amount))}</div><div class="small muted">${esc(inf.amountSub || '')}</div></div>
      </div>
      ${due}
      ${p.approvals && p.approvals.length ? `<div class="ap-rv-route"><span class="overline">PR approval route</span>${routeHtml(state, p)}</div>` : ''}
      <div class="ap-rv-grid">
        <div>${core}</div>
        <div>${specificFacts(state, p, a)}</div>
      </div>
      ${justification}
      ${clar}
      ${r02}
      <div class="field mt-12"><label for="ap-remarks">Remarks${needsText ? ` <span class="muted" style="font-weight:500">— required to ${esc(needsText)}</span>` : ''}</label>
        <textarea id="ap-remarks" name="remarks" rows="3" placeholder="${a.actionType === 'approval' ? 'Your remarks — or the question you want the requestor to answer' : 'Your remarks'}"></textarea></div>
      <div id="ap-err" class="mt-8"></div>
      <p class="small muted mt-8">${I('lock', 12)} Your decision, remarks, name and time are written to the audit trail. Each purchase is reviewed individually — bulk approval is disabled by policy.</p>
    </div>`;
  }

  function openReview(ctx, pid, aid) {
    const state = PCT.store.get();
    const user = ctx.user;
    const p = E.purchase(state, pid);
    const a = p && E.currentActivity(p);
    if (!p || !a || (aid && a.id !== aid)) { ctx.toast('This step has already moved on — the list has been refreshed.', 'red'); ctx.rerender(); return; }
    if (p.status === 'On Hold') { ctx.toast(`${p.id} is on hold${a.blocker ? ` (${a.blocker.replace(/^On hold:\s*/, '')})` : ''} — it can be decided once it is resumed.`, 'orange'); return; }
    if (!E.canAct(state, user, p, a)) { ctx.toast(`Ball is with ${E.userName(state, a.ownerUserId)} — only the owner can decide.`, 'red'); return; }
    if (a.actionType === 'tech_eval' || !OPS[a.actionType]) { ctx.go(`#/purchases/${p.id}?tab=action`); return; }
    const ops = OPS[a.actionType];
    const handlers = {};
    ops.forEach(o => { handlers[o.op] = (v, form) => decide(ctx, p.id, a.id, a.actionType, o, v, form); });
    ctx.modal.open({
      title: `Review — ${esc(info(state, p, a).type)}`,
      size: 'lg ap-modal',
      body: reviewBody(state, user, p, a),
      actions: [{ label: 'Cancel', act: 'close' }].concat(ops.map(o => ({ label: o.label, act: o.op, tone: o.tone }))),
      onAction: handlers
    });
    // The kit focuses the first control (the remarks box at the bottom), which scrolls the facts away.
    // Keep the reviewer at the top of the facts; on phones do not pop the keyboard up front.
    setTimeout(() => {
      const bodyEl = document.querySelector('.modal.ap-modal .modal-body');
      if (!bodyEl) return;
      const small = window.innerWidth <= 560;
      const ta = document.getElementById('ap-remarks');
      if (small) { if (document.activeElement && bodyEl.contains(document.activeElement)) document.activeElement.blur(); }
      else if (ta) { try { ta.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      bodyEl.scrollTop = 0;
    }, 60);
  }

  function showErr(form, msg) {
    const box = (form && form.querySelector('#ap-err')) || document.getElementById('ap-err');
    if (box) box.innerHTML = ui.alert('danger', esc(msg));
    const ta = document.getElementById('ap-remarks');
    if (ta && /remark|reason|question|Enter/i.test(msg)) ta.focus();
  }

  function decide(ctx, pid, aid, kind, o, v, form) {
    const text = String(v.remarks || '').trim();
    if (o.need && !text) {
      showErr(form, o.need === 'question' ? 'Type the question for the requestor in the Remarks box.' : `Enter the reason in the Remarks box — it is mandatory to ${o.op === 'reject' ? 'reject' : 'return'} and is recorded in the audit trail.`);
      return false;
    }
    const payload = o.op === 'clarify' ? { question: text } : { remarks: text };
    if (kind === 'payment_approval' && o.op === 'approve') payload.acknowledgeAdvance = !!v.acknowledgeAdvance;
    const res = ctx.commit(s => E.act(s, pid, aid, o.op, payload, ctx.user.id));
    if (!res || res.ok === false) { showErr(form, (res && res.error) || 'The decision could not be saved.'); return false; }
    const st = PCT.store.get();
    const p = E.purchase(st, pid);
    const b = p ? E.ball(st, p) : null;
    let msg;
    if (o.op === 'reject') msg = kind === 'advance_approve' ? `Advance rejected — ${pid} continues without an advance.` : `${pid} rejected — ${E.userName(st, p.requestorId)} has been notified.`;
    else if (o.op === 'clarify') msg = `Question sent — the ball is with ${E.userName(st, p.requestorId)} until answered.`;
    else if (b && !b.closed) msg = `${pid}: ball moved to ${b.ownerName}${b.activityName ? ` — ${b.activityName}` : ''}.`;
    else msg = `${pid} updated.`;
    ctx.toast(msg, o.op === 'approve' ? 'green' : 'navy', { approve: 'Approved', reject: 'Rejected', return: 'Returned', clarify: 'Clarification requested' }[o.op]);
    return undefined;
  }

  /* ---------------- tabs ---------------- */
  function actionBtn(r) {
    if (r.clarification) return `<a class="btn btn-sm" href="#/purchases/${esc(r.id)}?tab=action">Answer</a>`;
    if (r.p.status === 'On Hold') return `<a class="btn btn-sm" href="#/purchases/${esc(r.id)}" title="${esc(r.activityObj.blocker || 'On hold')}">On hold ${I('arrowRight', 12)}</a>`;
    if (r.actionType === 'tech_eval') return `<a class="btn btn-sm" href="#/purchases/${esc(r.id)}?tab=action" title="Technical evaluation uses the criteria checklist on the purchase page">Open ${I('arrowRight', 12)}</a>`;
    return `<button type="button" class="btn btn-sm ${r.overdueDays ? 'btn-danger' : 'btn-primary'}" data-act="ap-review" data-id="${esc(r.id)}" data-aid="${esc(r.activityObj.id)}">Review</button>`;
  }

  function queueTab(ctx, q) {
    const { state, user } = ctx;
    const table = ui.table([
      { key: 'id', label: 'Purchase', render: r => `<a class="mono strong" href="#/purchases/${esc(r.id)}">${esc(r.id)}</a>${r.p.flags && r.p.flags.emergency ? ' ' + ui.badge('Emergency', 'red', { dot: false }) : ''}<span class="sub ap-title" title="${esc(r.title)}">${esc(r.title)}</span>` },
      { key: 'type', label: 'Approval', render: r => `<b class="nowrap">${esc(r.clarification ? 'Clarification asked of you' : r.type)}</b><span class="sub">${esc(r.clarification ? 'Answer on the purchase page' : r.p.status === 'On Hold' ? 'On hold — waiting to resume' : r.typeSub)}</span>` },
      { key: 'amount', label: 'Value', align: 'right', render: r => `${ui.money(r.amount)}<span class="sub">${esc(r.amountSub || '')}</span>` },
      { key: 'requestor', label: 'Requestor', hideOnMobile: true, render: r => ui.person(state, r.requestorId, { subText: r.dept }) },
      { key: 'startAt', label: 'Waiting since', hideOnMobile: true, render: r => r.startAt ? `${esc(fmt.date(r.startAt))}<span class="sub">${esc(fmt.days(r.ageingDays))} with you</span>` : dash },
      { key: 'dueAt', label: 'Due', render: r => ui.due(r.dueAt) },
      { key: 'displayStatus', label: 'Status', render: r => ui.status(state, 'activity', r.displayStatus) },
      { key: 'act', label: '', sort: false, render: actionBtn }
    ], q, { key: 'apq', sort: ctx.local.apqSort, rowClass: r => r.overdueDays ? 'row-red' : '', empty: 'Nothing is waiting for your approval.' });
    const cards = `<div class="ap-mlist">${q.map(r => `<div class="ap-mcard ${r.overdueDays ? 'tone-red' : ''}">
        <div class="ap-m1"><a class="mono strong" href="#/purchases/${esc(r.id)}">${esc(r.id)}</a>${ui.status(state, 'activity', r.displayStatus)}</div>
        <div class="ap-m2">${esc(r.title)}</div>
        <div class="ap-m3"><b>${esc(r.clarification ? 'Clarification asked of you' : r.type)}</b> · ${esc(r.requestor)}</div>
        <div class="ap-m4"><span>${ui.money(r.amount)}<small>${esc(r.amountSub || '')}</small></span><span class="ap-m5">${ui.due(r.dueAt)}${actionBtn(r)}</span></div>
      </div>`).join('')}</div>`;

    const queueCard = ui.card({
      title: 'Waiting for your decision', icon: 'approve',
      sub: 'Most urgent first. Review opens the facts and the allowed decisions. Each approval is reviewed individually — bulk approval is not available.',
      flush: true,
      body: q.length ? `<div class="ap-qtable">${table}</div>${cards}` : ui.empty('checkCircle', 'You are all caught up', 'No approval is waiting for you right now. New requests appear here — and in My Actions — the moment the ball reaches you.')
    });

    const clar = clarificationRows(state, user);
    const clarCard = clar.length ? ui.card({
      title: 'Waiting on the requestor', icon: 'pause', sub: 'You asked a clarification — the ball is with the requestor until they answer. The approval returns to you automatically.', flush: true,
      body: ui.table([
        { key: 'id', label: 'Purchase', render: x => `<a class="mono strong" href="#/purchases/${esc(x.p.id)}">${esc(x.p.id)}</a><span class="sub ap-title">${esc(x.p.title)}</span>` },
        { key: 'q', label: 'Your question', render: x => `“${esc(x.a.clarification.question)}”<span class="sub">Asked ${esc(fmt.ago(x.a.clarification.askedAt))}</span>` },
        { key: 'who', label: 'Ball with', render: x => ui.person(state, x.p.requestorId) },
        { key: 'due', label: 'Approval due', render: x => ui.due(x.a.dueAt) }
      ], clar, { dense: true })
    }) : '';

    const up = upcomingRows(state, user);
    const upCard = up.length ? ui.card({
      title: 'Coming your way', icon: 'arrowRight', sub: 'PR approvals where you are a later level — they reach you after the earlier steps complete.', flush: true,
      body: ui.table([
        { key: 'id', label: 'Purchase', render: x => `<a class="mono strong" href="#/purchases/${esc(x.p.id)}">${esc(x.p.id)}</a><span class="sub ap-title">${esc(x.p.title)}</span>` },
        { key: 'value', label: 'Value', align: 'right', render: x => ui.money(pValue(x.p)) },
        { key: 'level', label: 'Your level', render: x => { const l = (x.p.approvals || []).find(v => v.level === x.level) || {}; return `L${x.level} ${esc(l.label || '')}`; } },
        { key: 'route', label: 'Approval progress', render: x => routeHtml(state, x.p, { compact: true }) },
        { key: 'now', label: 'Now with', hideOnMobile: true, render: x => { const b = E.ball(state, x.p); return x.p.status === 'Draft' ? `<span class="muted">Draft — not submitted</span>` : `${esc(b.ownerName)}<span class="sub">${esc(b.stageName)}</span>`; } }
      ], up, { dense: true })
    }) : '';

    return `<div class="stack">${queueCard}${clarCard}${upCard}</div>`;
  }

  function historyTab(ctx, h) {
    const { state } = ctx;
    const filt = ctx.local.apHist || 'all';
    const counts = {};
    DECISIONS.forEach(d => { counts[d] = h.filter(r => r.decision === d).length; });
    const rows = filt === 'all' ? h : h.filter(r => r.decision === filt);
    const chips = [['all', 'All', h.length]].concat(DECISIONS.map(d => [d, d === 'Clarification' ? 'Clarifications' : d, counts[d]]))
      .map(([id, label, n]) => `<button type="button" class="chip ${filt === id ? 'active' : ''}" data-act="set" data-key="apHist" data-value="${esc(id)}">${esc(label)} <b>${n}</b></button>`).join('');
    const table = ui.table([
      { key: 't', label: 'Date', render: r => `<span class="nowrap">${esc(fmt.date(r.t))}</span><span class="sub">${esc(fmt.time(r.t))}</span>` },
      { key: 'purchaseId', label: 'Purchase', render: r => r.purchaseId ? `<a class="mono strong" href="#/purchases/${esc(r.purchaseId)}">${esc(r.purchaseId)}</a><span class="sub ap-title">${esc(r.title)}</span>` : dash },
      { key: 'level', label: 'Level / type', render: r => esc(r.level) },
      { key: 'decision', label: 'Decision', render: r => ui.badge(r.decision === 'Clarification' ? 'Clarification requested' : r.decision, decisionTone(state, r.decision)) },
      { key: 'remarks', label: 'Remarks', sort: false, render: r => r.remarks ? `<span class="ap-remark">${esc(r.remarks)}</span>` : '<span class="muted">—</span>' },
      { key: 'value', label: 'Value', align: 'right', hideOnMobile: true, render: r => ui.money(r.value) }
    ], rows, { key: 'aph', sort: ctx.local.aphSort || { col: 't', dir: 'desc' }, rowHref: r => r.purchaseId ? `#/purchases/${r.purchaseId}?tab=approvals` : null, empty: h.length ? 'No decisions of this type.' : 'You have not recorded any approval decision yet.' });
    return ui.card({ title: 'My approval history', icon: 'audit', sub: 'Every approval decision you recorded — taken from the audit trail (read-only).', actions: `<div class="row wrap">${chips}</div>`, flush: true, body: table });
  }

  function highTab(ctx, rows) {
    const { state } = ctx;
    const total = U.sum(rows, r => r.value);
    const table = ui.table([
      { key: 'id', label: 'Purchase', render: r => `<b class="mono">${esc(r.id)}</b><span class="sub ap-title" title="${esc(r.title)}">${esc(r.title)}</span><span class="sub ap-title">${esc(r.dept)} · ${esc(r.requestor)}</span>` },
      { key: 'value', label: 'Value', align: 'right', render: r => `${ui.money(r.value)}<span class="sub">${r.poNumber ? 'PO value' : 'Estimate'}</span>` },
      { key: 'approvedLevels', label: 'Approval progress', sort: r => r.approvedLevels / Math.max(1, r.levels), render: r => `${routeHtml(state, r.p, { compact: true })}<span class="sub">${r.approvedLevels} of ${r.levels} approved</span>` },
      { key: 'stage', label: 'Current stage', hideOnMobile: true, render: r => `<span class="nowrap">${esc(r.stage)}</span><span class="sub ap-1l" title="${esc(r.activity || '')}">${esc(r.activity || '')}</span>` },
      { key: 'owner', label: 'Ball with', render: r => r.ownerUserId ? ui.person(state, r.ownerUserId, { subText: r.withLabel }) : dash },
      { key: 'dueAt', label: 'Due', render: r => ui.due(r.dueAt) },
      { key: 'actStatus', label: 'Status', hideOnMobile: true, render: r => ui.status(state, r.status === 'On Hold' ? 'purchase' : 'activity', r.status === 'On Hold' ? 'On Hold' : r.actStatus) }
    ], rows, {
      key: 'aphv', sort: ctx.local.aphvSort || { col: 'value', dir: 'desc' }, rowHref: r => `#/purchases/${r.id}?tab=approvals`,
      rowClass: r => r.overdueDays ? 'row-red' : r.blocked ? 'row-orange' : '',
      empty: 'No open purchase above ₹10,00,000 or with two or more approval levels pending.',
      foot: rows.length ? `<tr><td>Total · ${rows.length}</td><td class="num">${ui.money(total)}</td><td></td><td class="hide-m"></td><td colspan="2"></td><td class="hide-m"></td></tr>` : ''
    });
    const legend = `<div class="pill-legend ap-legend"><span><i class="ap-dot ap-done"></i>Approved</span><span><i class="ap-dot ap-cur"></i>With approver now</span><span><i class="ap-dot ap-od"></i>Overdue</span><span><i class="ap-dot ap-todo"></i>Pending</span></div>`;
    return ui.card({ title: 'High-value purchases', icon: 'rupee', sub: `Open purchases above ${esc(fmt.inr(HIGH_VALUE))} or with two or more approval levels still pending.`, actions: legend, flush: true, body: table });
  }

  /* ---------------- page ---------------- */
  PCT.pages.register({
    route: 'approvals',
    title: 'Approvals',
    perms: ['approve'],
    // Users who own approval steps without the 'approve' permission (e.g. the Procurement Lead's PO approvals) still get the page
    allow: (state, user) => PCT.sel.myActions(state, user).some(r => r.activityObj.approval),
    render(ctx) {
      const { state, user } = ctx;
      css();
      if (ctx.query.tab && ctx.local.apTabQ !== ctx.query.tab) { ctx.local.apTabQ = ctx.query.tab; ctx.local.apTab = ctx.query.tab; }
      const tab = ['queue', 'history', 'high'].includes(ctx.local.apTab) ? ctx.local.apTab : 'queue';
      const q = queueRows(state, user);
      const decidable = q.filter(r => !r.clarification);
      const h = historyRows(state, user);
      const hv = highValueRows(state, user);
      const od = q.filter(r => r.overdueDays > 0).length;
      const value = U.sum(decidable, r => r.amount);
      const since = PCT.clock.now() - 30 * U.DAY;
      const recent = h.filter(r => r.t >= since);

      const head = ui.pageHead({
        title: 'Approvals', icon: 'approve',
        sub: q.length ? `<b>${q.length}</b> decision${q.length === 1 ? '' : 's'} waiting for you${od ? ` — <b style="color:var(--red)">${od} overdue</b>` : ''}. The ball is with you on these.` : 'Nothing is waiting for your decision right now.',
        actions: `<a class="btn" href="#/my-actions">${I('inbox', 16)} My Actions</a>`
      });
      const kpis = `<div class="kpis ap-kpis mb-16">
        ${ui.kpi({ label: 'Waiting for you', value: q.length, icon: 'inbox', tone: q.length ? 'blue' : 'none', sub: q.length ? `${decidable.length} to decide` : 'All caught up' })}
        ${ui.kpi({ label: 'Overdue', value: od, icon: 'alert', tone: od ? 'red' : 'green', sub: od ? 'Escalation running' : 'Within SLA' })}
        ${ui.kpi({ label: 'Value awaiting decision', value: ui.moneyShort(value), money: true, icon: 'rupee', sub: fmt.inr(value) })}
        ${ui.kpi({ label: 'Decided by you', value: recent.length, icon: 'audit', sub: 'Last 30 days' })}
        ${ui.kpi({ label: 'High-value open', value: hv.length, icon: 'target', tone: hv.length ? 'orange' : 'none', sub: `> ${fmt.inrShort(HIGH_VALUE)} or ≥ 2 levels pending` })}
      </div>`;
      const tabs = ui.tabs('apTab', [
        { id: 'queue', label: 'Approval queue', count: q.length, icon: 'inbox' },
        { id: 'history', label: 'My approval history', count: h.length, icon: 'audit' },
        { id: 'high', label: 'High-value purchases', count: hv.length, icon: 'rupee' }
      ], tab);
      const body = tab === 'history' ? historyTab(ctx, h) : tab === 'high' ? highTab(ctx, hv) : queueTab(ctx, q);
      return head + kpis + `<div class="mb-16">${tabs}</div>` + body;
    },
    actions: {
      'ap-review'(ctx, el) { openReview(ctx, el.dataset.id, el.dataset.aid); },
      'ap-open'(ctx, el) { ctx.modal.close(); ctx.go('#/purchases/' + el.dataset.id); }
    }
  });

  /* ---------------- page CSS ---------------- */
  function css() {
    ui.css('page-approvals', `
      .ap-title { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ap-remark { display: inline-block; max-width: 360px; white-space: normal; }
      .ap-mlist { display: none; }
      .ap-mcard { padding: 12px 14px; border-bottom: 1px solid var(--line-2); }
      .ap-mcard:last-child { border-bottom: 0; }
      .ap-mcard.tone-red { box-shadow: inset 3px 0 0 var(--red); }
      .ap-m1 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .ap-m2 { font-weight: 600; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ap-m3 { font-size: 12.5px; color: var(--ink-2); margin-top: 2px; }
      .ap-m4 { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; font-weight: 650; }
      .ap-m4 small { display: block; font-weight: 400; font-size: 11.5px; color: var(--muted); }
      .ap-m5 { display: inline-flex; align-items: center; gap: 10px; font-size: 12.5px; font-weight: 500; }
      .ap-1l { max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ap-route { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .ap-lv { display: inline-flex; flex-direction: column; align-items: flex-start; padding: 3px 8px; border-radius: 7px; border: 1px solid var(--line); background: #fff; line-height: 1.2; min-width: 64px; }
      .ap-lv b { font-size: 11.5px; font-weight: 700; }
      .ap-lv small { font-size: 10.5px; color: var(--muted); white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
      .ap-route.compact { flex-wrap: nowrap; }
      .ap-route.compact .ap-lv { min-width: 0; padding: 2px 7px; }
      .ap-route.compact .ap-lv small { max-width: 84px; }
      .ap-lv.ap-done { background: var(--green-bg); border-color: #BFE6D3; } .ap-lv.ap-done b { color: var(--green); }
      .ap-lv.ap-cur { background: #FFF7EC; border-color: #F6DDB3; } .ap-lv.ap-cur b { color: #B45309; }
      .ap-lv.ap-od { background: var(--red-bg); border-color: #F5C9C9; } .ap-lv.ap-od b { color: var(--red); }
      .ap-lv.ap-rej { background: var(--black-bg); } .ap-lv.ap-rej b { color: var(--black); }
      .ap-lv.ap-todo b { color: var(--faint); }
      .ap-arrow { color: var(--faint); }
      .ap-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; border: 1px solid var(--line); }
      .ap-dot.ap-done { background: var(--green-bg); border-color: #BFE6D3; } .ap-dot.ap-cur { background: #FFF7EC; border-color: #F6DDB3; } .ap-dot.ap-od { background: var(--red-bg); border-color: #F5C9C9; } .ap-dot.ap-todo { background: #fff; }
      .modal.ap-modal { max-width: 900px; }
      .modal.ap-modal .modal-foot { flex-wrap: wrap; flex: none; }
      /* kit's <form class="modal-form"> is not a flex child → long bodies overflow the 88vh box; scope a fix to this modal */
      .modal.ap-modal .modal-form { display: flex; flex-direction: column; min-height: 0; max-height: 88vh; }
      .modal.ap-modal .modal-head { flex: none; }
      .modal.ap-modal .modal-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
      .ap-rv { display: flex; flex-direction: column; gap: 12px; }
      .ap-rv-top { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; }
      .ap-rv-top h3 { font-size: 17px; }
      .ap-amt { text-align: right; flex: none; }
      .ap-amt .v { font-size: 24px; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
      .ap-rv-route { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .ap-rv-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; border-top: 1px solid var(--line-2); padding-top: 12px; }
      .ap-kv { grid-template-columns: 130px minmax(0, 1fr); }
      .ap-just { background: var(--bg); border: 1px solid var(--line-2); border-radius: 9px; padding: 10px 12px; }
      .ap-just p { margin: 4px 0 0; }
      .ap-ack { padding: 8px 10px; border: 1px solid #F6DDB3; border-radius: 8px; background: #FFFBF3; display: flex; }
      .ap-rv textarea { width: 100%; border: 1px solid #D5DCE6; border-radius: 8px; padding: 8px 10px; font: 13.5px var(--font); resize: vertical; }
      .ap-rv textarea:focus { outline: none; border-color: var(--blue-500); box-shadow: 0 0 0 3px var(--blue-100); }
      @media (max-width: 900px) { .ap-rv-grid { grid-template-columns: minmax(0, 1fr); } }
      @media (max-width: 560px) {
        .ap-rv-top { flex-direction: column; gap: 8px; }
        .ap-amt { text-align: left; }
        .modal.ap-modal .modal-foot .btn { flex: 1 1 calc(50% - 8px); }
        .ap-kv { grid-template-columns: 110px minmax(0, 1fr); }
        .ap-title { max-width: 160px; }
        .ap-legend { display: none; }
        .ap-kpis > :nth-child(n+4) { display: none; }
        .ap-qtable { display: none; }
        .ap-mlist { display: block; }
      }
    `);
  }

  PCT.approvalsPage = { queueRows, historyRows, highValueRows, info };
})();
