/* =====================================================================
   SELECTORS — read-only, derived views over the state.
   Dashboards, control tower, analytics, search and tables all read
   through here so numbers are computed one way, everywhere.
   ===================================================================== */
window.PCT = window.PCT || {};

PCT.sel = (function () {
  const U = PCT.util;
  const E = () => PCT.engine;
  const now = () => PCT.clock.now();
  const ACTIVE = ['Open', 'On Hold', 'Draft'];

  /* ---------------- lookups ---------------- */
  const statusTone = (state, kind, name) => { const s = state.masters.statuses.find(x => x.kind === kind && x.name === name); return s ? s.tone : 'grey'; };
  const statusDot = (state, kind, name) => { const s = state.masters.statuses.find(x => x.kind === kind && x.name === name); return s ? s.dot : '⚪'; };
  const deptName = (state, id) => (E().dept(state, id) || {}).name || '—';
  const vendorName = (state, id) => (E().vendor(state, id) || {}).name || '—';
  const catName = (state, id) => (E().category(state, id) || {}).name || '—';
  const ccName = (state, id) => { const c = U.byId(state.masters.costCentres, id); return c ? `${c.id} · ${c.name}` : '—'; };
  const priorityName = (state, id) => (U.byId(state.masters.priorities, id) || {}).name || id;

  /* ---------------- visibility ---------------- */
  function visiblePurchases(state, user) {
    if (!user) return [];
    const r = E().role(state, user.roleId) || { permissions: [] };
    if (r.permissions.includes('purchase.view_all')) return state.purchases;
    if (r.permissions.includes('purchase.view_dept')) return state.purchases.filter(p => p.deptId === user.deptId || p.requestorId === user.id || involved(p, user.id));
    return state.purchases.filter(p => p.requestorId === user.id || involved(p, user.id));
  }
  const involved = (p, uid) => (p.activities || []).some(a => a.ownerUserId === uid || a.completedBy === uid);

  /* ---------------- one flattened row per purchase ---------------- */
  function row(state, p) {
    const b = E().ball(state, p);
    const a = b.activity;
    const advs = (p.advanceIds || []).map(id => E().advance(state, id)).filter(Boolean);
    const advOut = U.sum(advs, E().advanceOutstanding);
    const it = E().invoiceTotals(p);
    const pays = (p.paymentIds || []).map(id => state.payments.find(x => x.id === id)).filter(Boolean);
    const vid = p.po ? p.po.vendorId : p.selection ? p.selection.vendorId : null;
    const openEx = state.exceptions.filter(e => e.purchaseId === p.id && (e.status === 'Open' || e.status === 'In Progress'));
    return {
      id: p.id, prNo: p.prNo, title: p.title, p,
      categoryId: p.categoryId, category: catName(state, p.categoryId), deptId: p.deptId, dept: deptName(state, p.deptId), costCentreId: p.costCentreId,
      requestorId: p.requestorId, requestor: E().userName(state, p.requestorId),
      value: p.po ? p.po.total : p.estValue, estValue: p.estValue, priority: p.priority, priorityName: priorityName(state, p.priority),
      status: p.status, processVersion: p.processVersion,
      stageId: b.stageId || null, stage: b.closed ? p.status : (b.stageName || '—'), group: b.group || (p.status === 'Closed' ? 'CLOSURE' : null),
      activityId: b.activityId || null, activity: b.activityName, ownerUserId: b.ownerUserId, owner: b.ownerName, withLabel: b.withLabel,
      actStatus: b.closed ? p.status : (p.status === 'On Hold' ? 'Blocked' : b.status), nextAction: b.nextAction, dueAt: b.dueAt, ageingDays: b.ageingDays, overdueDays: b.overdueDays,
      waitingOn: b.waitingOn || null, blocked: p.status === 'On Hold' || (a && a.status === 'Blocked'),
      vendorId: vid, vendor: vid ? vendorName(state, vid) : '—', poNumber: p.po ? p.po.number : null, poStatus: p.po ? p.po.status : null,
      advanceOutstanding: advOut, advanceStatus: advs.length ? advs[advs.length - 1].status : (p.flags.advanceRequired ? 'Planned' : '—'),
      invoiceTotal: it.total, paid: it.paid, pendingPayment: it.balance,
      paymentStatus: pays.length ? pays[pays.length - 1].status : (it.total ? 'Pending' : '—'),
      openExceptions: openEx.length, createdAt: p.createdAt, closedAt: p.closedAt, ageDays: U.ageDays(p.createdAt, p.closedAt || now())
    };
  }
  const rows = (state, list) => (list || state.purchases).map(p => row(state, p));

  /* ---------------- my actions ---------------- */
  function myActions(state, user) {
    if (!user) return [];
    const out = [];
    state.purchases.forEach(p => {
      if (!['Open', 'Draft', 'On Hold'].includes(p.status)) return;
      const a = E().currentActivity(p);
      if (!a) return;
      const clar = a.clarification && !a.clarification.response;
      const mine = clar ? p.requestorId === user.id : E().canAct(state, user, p, a) || (p.status === 'On Hold' && a.ownerUserId === user.id);
      if (!mine) return;
      const r = row(state, p);
      const disp = clar ? 'Waiting' : r.actStatus;
      const tone = r.overdueDays > 0 ? 'red' : disp === 'Waiting' ? 'yellow' : disp === 'Blocked' ? 'orange' : (a.dueAt && U.daysBetween(now(), a.dueAt) <= 0) ? 'orange' : 'green';
      out.push(Object.assign(r, { activityObj: a, clarification: clar, displayStatus: disp, tone, sortKey: (r.overdueDays ? -1000 - r.overdueDays : 0) + (a.dueAt ? U.daysBetween(now(), a.dueAt) : 99) }));
    });
    return U.sortBy(out, r => r.sortKey);
  }

  /* ---------------- KPIs (section 39) ---------------- */
  function kpis(state, user, list) {
    const ps = list || state.purchases;
    const rs = ps.map(p => row(state, p));
    const open = rs.filter(r => r.status === 'Open' || r.status === 'On Hold');
    const live = rs.filter(r => r.status !== 'Rejected' && r.status !== 'Cancelled');
    const ids = new Set(ps.map(p => p.id));
    return {
      total: rs.length,
      open: open.length,
      draft: rs.filter(r => r.status === 'Draft').length,
      myActions: user ? myActions(state, user).length : 0,
      pendingApproval: open.filter(r => r.activityId && E().currentActivity(r.p).approval).length,
      waitingVendor: open.filter(r => r.waitingOn === 'vendor').length,
      overdue: open.filter(r => r.overdueDays > 0).length,
      blocked: open.filter(r => r.blocked).length,
      completed: rs.filter(r => r.status === 'Closed').length,
      rejected: rs.filter(r => r.status === 'Rejected' || r.status === 'Cancelled').length,
      totalValue: U.sum(live, r => r.value),
      openValue: U.sum(open, r => r.value),
      advanceOutstanding: U.sum(state.advances.filter(a => ids.has(a.purchaseId)), E().advanceOutstanding),
      pendingPayments: U.sum(open, r => r.pendingPayment),
      openExceptions: state.exceptions.filter(e => ids.has(e.purchaseId) && (e.status === 'Open' || e.status === 'In Progress')).length
    };
  }

  /* ---------------- control tower by stage group (section 40) ---------------- */
  function tower(state, list) {
    const ps = list || state.purchases;
    return state.masters.towerGroups.map(g => {
      const inGroup = ps.filter(p => (p.status === 'Open' || p.status === 'On Hold') && (E().currentActivity(p) || {}).group === g.id);
      const completedThrough = ps.filter(p => (p.stages || []).some(s => s.group === g.id && s.status === 'Completed'));
      return {
        id: g.id, label: g.label,
        open: inGroup.length,
        completed: completedThrough.length,
        overdue: inGroup.filter(p => E().isOverdue(state, E().currentActivity(p))).length,
        blocked: inGroup.filter(p => p.status === 'On Hold' || (E().currentActivity(p) || {}).status === 'Blocked').length,
        value: U.sum(inGroup, p => p.po ? p.po.total : p.estValue),
        purchases: inGroup
      };
    });
  }

  /* ---------------- bottlenecks (section 45) ---------------- */
  function bottlenecks(state, list) {
    const open = (list || state.purchases).filter(p => p.status === 'Open' || p.status === 'On Hold');
    const g = U.groupBy(open.filter(p => E().currentActivity(p)), p => {
      const a = E().currentActivity(p);
      return a.approval && a.actionType === 'approval' ? 'Approval' : a.stageName;
    });
    return U.sortBy(Object.keys(g).map(k => {
      const ps = g[k];
      const acts = ps.map(p => E().currentActivity(p));
      const owners = U.uniq(ps.map(p => E().ball(state, p).ownerName));
      return {
        name: k, cases: ps.length,
        avgAgeing: Math.round(U.avg(acts, a => U.ageDays(a.startAt)) * 10) / 10,
        value: U.sum(ps, p => p.po ? p.po.total : p.estValue),
        owners, slaBreachPct: Math.round(acts.filter(a => E().isOverdue(state, a)).length / acts.length * 100),
        purchases: ps.map(p => p.id)
      };
    }), b => -(b.cases * 1000 + b.avgAgeing));
  }

  /* ---------------- SLA achievement ---------------- */
  function slaStats(state, list) {
    const acts = [];
    (list || state.purchases).forEach(p => (p.activities || []).forEach(a => { if (a.status === 'Completed' && a.dueAt && a.completedAt) acts.push(a); }));
    const met = acts.filter(a => a.completedAt <= a.dueAt).length;
    return { completed: acts.length, met, breached: acts.length - met, achievementPct: acts.length ? Math.round(met / acts.length * 100) : 100 };
  }

  /* ---------------- cycle times (section 46) ---------------- */
  function cycleTimes(state, list) {
    const ps = list || state.purchases;
    const st = (p, id) => (p.stages || []).find(s => s.stageId === id) || {};
    const d = (a, b) => (a && b && b >= a) ? (b - a) / U.DAY : null;
    const metric = (label, fn) => { const vals = ps.map(fn).filter(v => v != null); return { label, avgDays: vals.length ? Math.round(U.avg(vals) * 10) / 10 : null, samples: vals.length }; };
    const lastPay = p => { const pays = (p.paymentIds || []).map(id => state.payments.find(x => x.id === id)).filter(x => x && x.status === 'Paid' && x.type !== 'Advance'); return pays.length ? Math.max(...pays.map(x => x.date)) : null; };
    return [
      metric('PR processing (submit → reviewed)', p => d(p.submittedAt, st(p, 'S03').completedAt || st(p, 'S04').startedAt)),
      metric('Approval cycle', p => d(st(p, 'S04').startedAt, st(p, 'S04').completedAt)),
      metric('Vendor response time', p => { const r = (p.rfqs || []).filter(x => x.responseDate); return r.length ? U.avg(r, x => (x.responseDate - x.rfqDate) / U.DAY) : null; }),
      metric('Quotation cycle (sourcing → selection)', p => d(st(p, 'S05').startedAt, st(p, 'S09').completedAt)),
      metric('PO cycle', p => d(st(p, 'S10').startedAt, st(p, 'S10').completedAt)),
      metric('Delivery cycle (PO accepted → GRN)', p => d(p.po && p.po.acceptedAt, (p.grns || []).length ? Math.max(...p.grns.map(g => g.receiptDate)) : null)),
      metric('Invoice processing (receipt → match)', p => d(st(p, 'S14').startedAt, st(p, 'S16').completedAt)),
      metric('Payment cycle (approval → paid)', p => d(st(p, 'S17').startedAt || st(p, 'S16').completedAt, lastPay(p))),
      metric('Total procurement cycle', p => p.status === 'Closed' ? d(p.createdAt, p.closedAt) : null)
    ];
  }

  /* ---------------- vendor performance (section 47) ---------------- */
  function vendorPerformance(state) {
    return state.masters.vendors.map(v => {
      const ps = state.purchases.filter(p => p.po && p.po.vendorId === v.id);
      const rfqs = [].concat(...state.purchases.map(p => (p.rfqs || []).filter(r => r.vendorId === v.id)));
      const resp = rfqs.filter(r => r.responseDate);
      const dels = [].concat(...ps.map(p => p.deliveries || []));
      const late = dels.filter(d => d.late);
      const invIssues = state.exceptions.filter(e => ps.some(p => p.id === e.purchaseId) && /mismatch|Invoice/i.test(e.type)).length;
      const advs = state.advances.filter(a => a.vendorId === v.id);
      const out = U.sum(advs, E().advanceOutstanding);
      const ages = advs.map(a => E().advanceAgeing(state, a)).filter(Boolean);
      const pays = state.payments.filter(x => x.vendorId === v.id && x.status === 'Paid');
      return {
        id: v.id, name: v.name, city: v.city, rating: v.rating, approved: v.approved, status: v.status, categoryIds: v.categoryIds,
        totalValue: U.sum(ps, p => p.po.total), poCount: ps.length,
        rfqCount: rfqs.length, responseRate: rfqs.length ? Math.round(resp.length / rfqs.length * 100) : null,
        avgResponseDays: resp.length ? Math.round(U.avg(resp, r => (r.responseDate - r.rfqDate) / U.DAY) * 10) / 10 : null,
        deliveries: dels.length, onTimePct: dels.length ? Math.round((dels.length - late.length) / dels.length * 100) : null, delayed: late.length,
        invoiceIssues: invIssues, advanceOutstanding: out, maxAdvanceAgeing: ages.length ? Math.max(...ages.map(a => a.days)) : 0,
        exposure: out > Number(E().ruleParam(state, 'R05', 'exposureThreshold', 0)) && !!E().rule(state, 'R05'),
        paidValue: U.sum(pays, x => x.amount), payments: pays.length
      };
    });
  }

  /* ---------------- financial control (section 48) ---------------- */
  function financial(state, list) {
    const ps = (list || state.purchases).filter(p => p.status !== 'Rejected' && p.status !== 'Cancelled' && p.status !== 'Draft');
    const ids = new Set(ps.map(p => p.id));
    const allIds = new Set((list || state.purchases).map(p => p.id)); // a paid advance on a cancelled purchase is still owed back
    const invs = [].concat(...ps.map(p => p.invoices || []));
    const pays = state.payments.filter(x => allIds.has(x.purchaseId));
    const advs = state.advances.filter(a => allIds.has(a.purchaseId) && a.status !== 'Rejected');
    const t = now();
    const pendingInv = invs.filter(i => i.total - i.paidAmount - i.adjustedAmount > 0);
    const openBal = i => i.total - i.paidAmount - i.adjustedAmount;
    return {
      prValue: U.sum(ps, p => p.estValue),
      poValue: U.sum(ps.filter(p => p.po), p => p.po.total),
      invoiceValue: U.sum(invs, i => i.total),
      paidValue: U.sum(pays.filter(x => x.status === 'Paid' && x.type !== 'Advance'), x => x.amount),
      pendingValue: U.sum(pendingInv, openBal),
      advancePaid: U.sum(advs, a => a.paidAmount),
      advanceAdjusted: U.sum(advs, E().advanceAdjusted),
      advanceRecovered: U.sum(advs, E().advanceRecovered),
      advanceOutstanding: U.sum(advs, E().advanceOutstanding),
      advanceOverdue: U.sum(advs.filter(a => a.settlementDueDate && t > a.settlementDueDate), E().advanceOutstanding),
      paymentPending: U.sum(pendingInv, openBal),
      paymentDue: U.sum(pendingInv.filter(i => i.dueDate && U.daysBetween(t, i.dueDate) <= 7), openBal),
      paymentCompleted: U.sum(pays.filter(x => x.status === 'Paid'), x => x.amount),
      paymentFailed: U.sum(pays.filter(x => x.status === 'Failed'), x => x.amount)
    };
  }

  /* ---------------- advances ---------------- */
  function advanceRows(state) {
    return state.advances.map(a => {
      const p = E().purchase(state, a.purchaseId) || {};
      const ag = E().advanceAgeing(state, a);
      const out = E().advanceOutstanding(a);
      let next = '—';
      if (a.status === 'Requested') next = 'Approve advance';
      else if (a.status === 'Approved') next = 'Finance verification';
      else if (a.status === 'Verified') next = 'Release payment';
      else if (out > 0) next = ag && ag.overdue ? 'Recover or adjust — overdue' : 'Adjust against invoice';
      const cur = p.activities ? E().currentActivity(p) : null;
      return {
        id: a.id, a, purchaseId: a.purchaseId, purchaseTitle: p.title, poNumber: a.poNumber, vendorId: a.vendorId, vendor: vendorName(state, a.vendorId),
        type: (U.byId(state.masters.advanceTypes, a.typeId) || {}).name || a.typeId, pct: a.pct, amount: a.amount,
        approval: a.approval ? a.approval.status : 'Pending', approver: a.approval ? E().userName(state, a.approval.by) : '—',
        paymentDate: a.paymentDate, paymentRef: a.paymentRef, paid: a.paidAmount, adjusted: E().advanceAdjusted(a), recovered: E().advanceRecovered(a), outstanding: out,
        settlementDueDate: a.settlementDueDate, ageingDays: ag ? ag.days : 0, bucket: ag ? ag.bucket : '—', overdue: !!(ag && ag.overdue),
        owner: cur && cur.stageId === 'S11' ? E().userName(state, cur.ownerUserId) : E().userName(state, a.ownerUserId), nextAction: next, status: a.status
      };
    });
  }
  function ageingSummary(state) {
    const rs = advanceRows(state).filter(r => r.outstanding > 0);
    return state.masters.ageingBuckets.map(b => {
      const inB = rs.filter(r => r.ageingDays >= b.min && (b.max == null || r.ageingDays <= b.max));
      return { id: b.id, label: b.label, count: inB.length, amount: U.sum(inB, r => r.outstanding) };
    });
  }

  /* ---------------- exceptions ---------------- */
  /** exceptionRows(state, list?) — pass S.visiblePurchases(state, user) on user-facing pages */
  function exceptionRows(state, list) {
    const ids = list ? new Set(list.map(p => p.id)) : null;
    return U.sortBy(state.exceptions.filter(e => !ids || ids.has(e.purchaseId)).map(e => {
      const p = E().purchase(state, e.purchaseId) || {};
      return Object.assign({}, e, { purchaseTitle: p.title || '—', owner: E().userName(state, e.ownerUserId), ageDays: U.ageDays(e.date, e.closedAt || e.resolvedAt || now()), overdue: (e.status === 'Open' || e.status === 'In Progress') && e.dueDate && now() > e.dueDate });
    }), e => (e.status === 'Open' ? 0 : e.status === 'In Progress' ? 1 : 2) * 1e13 + ({ High: 0, Medium: 1, Low: 2 }[e.severity] || 1) * 1e12 - e.date);
  }

  /* ---------------- documents summary ---------------- */
  function documentSummary(state, p) {
    const curSeq = (() => { const a = E().currentActivity(p); const s = a && E().stageDef(state, p, a.stageId); return p.status === 'Closed' ? 99 : s ? s.seq : 0; })();
    const curStage = (E().currentActivity(p) || {}).stageId;
    const docs = (p.documents || []).map(d => {
      const seqs = d.stages.map(id => (E().stageDef(state, p, id) || {}).seq || 0);
      const due = Math.min(...seqs) <= curSeq;
      // system-generated documents of the stage in progress are created automatically when the step completes
      const disp = d.status !== 'Missing' ? d.status : !due ? 'Upcoming' : (d.system && d.stages.includes(curStage)) ? 'Pending (auto)' : 'Missing';
      return Object.assign({}, d, { due, displayStatus: disp });
    });
    const required = docs.filter(d => d.mandatory && d.status !== 'Not Required');
    return {
      docs,
      required: required.length,
      received: required.filter(d => d.status === 'Received' || d.status === 'Verified').length,
      missing: required.filter(d => d.displayStatus === 'Missing').length,
      upcoming: required.filter(d => d.displayStatus === 'Upcoming' || d.displayStatus === 'Pending (auto)').length
    };
  }

  /* ---------------- timeline (purchase detail) ---------------- */
  function timeline(state, p) {
    return (p.stages || []).map(s => {
      const acts = p.activities.filter(a => a.stageId === s.stageId);
      return Object.assign({}, s, { activities: acts, current: acts.some(a => E().OPEN_STATES.includes(a.status)) });
    });
  }

  /* ---------------- notifications ---------------- */
  function notificationsFor(state, userId, limit) {
    return U.sortBy(state.notifications.filter(n => n.userId === userId), n => -n.t).slice(0, limit || 50);
  }
  const unreadCount = (state, userId) => state.notifications.filter(n => n.userId === userId && !n.read).length;

  /* ---------------- global search (section 43) ---------------- */
  function search(state, q, user) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) return [];
    const has = s => s && String(s).toLowerCase().indexOf(q) >= 0;
    const vis = new Set(visiblePurchases(state, user).map(p => p.id));
    const out = [];
    const push = (type, id, label, sub, href) => out.push({ type, id, label, sub, href });
    state.purchases.filter(p => vis.has(p.id)).forEach(p => {
      if (has(p.id) || has(p.prNo) || has(p.title)) push('Purchase', p.id, `${p.id} · ${p.title}`, `${p.prNo || 'Draft'} · ${U.fmt.inr(p.estValue)} · ${p.status}`, `#/purchases/${p.id}`);
      if (p.po && has(p.po.number)) push('PO', p.po.number, `${p.po.number} · ${vendorName(state, p.po.vendorId)}`, `${p.id} · ${U.fmt.inr(p.po.total)} · ${p.po.status}`, `#/purchases/${p.id}`);
      (p.invoices || []).forEach(i => { if (has(i.number) || has(i.id)) push('Invoice', i.id, `${i.number} · ${U.fmt.inr(i.total)}`, `${p.id} · ${i.status}`, `#/purchases/${p.id}`); });
      (p.rfqs || []).forEach(r => { if (has(r.id)) push('RFQ', r.id, `${r.id} · ${vendorName(state, r.vendorId)}`, `${p.id} · ${r.status}`, `#/purchases/${p.id}`); });
      (p.grns || []).forEach(g => { if (has(g.number)) push('GRN', g.number, `${g.number}`, `${p.id} · ${g.acceptedQty}/${g.qty} accepted`, `#/purchases/${p.id}`); });
      (p.activities || []).forEach(a => { if (E().OPEN_STATES.includes(a.status) && has(a.name)) push('Activity', a.id, `${a.name}`, `${p.id} · ${E().userName(state, a.ownerUserId)}`, `#/purchases/${p.id}`); });
    });
    state.advances.filter(a => vis.has(a.purchaseId)).forEach(a => { if (has(a.id)) push('Advance', a.id, `${a.id} · ${vendorName(state, a.vendorId)}`, `${U.fmt.inr(a.amount)} · ${a.status}`, `#/advances?id=${a.id}`); });
    state.payments.filter(x => vis.has(x.purchaseId)).forEach(x => { if (has(x.id) || has(x.utr)) push('Payment', x.id, `${x.id} · ${U.fmt.inr(x.amount)}`, `${x.type} · ${x.status} · ${x.utr || ''}`, `#/payments?id=${x.id}`); });
    state.masters.vendors.forEach(v => { if (has(v.name) || has(v.id) || has(v.gstin)) push('Vendor', v.id, v.name, `${v.city} · ${v.gstin}`, `#/vendors/${v.id}`); });
    state.masters.users.forEach(u => { if (has(u.name) || has(u.email)) push('Employee', u.id, u.name, `${(E().role(state, u.roleId) || {}).name} · ${deptName(state, u.deptId)}`, `#/purchases?owner=${u.id}`); });
    state.masters.departments.forEach(d => { if (has(d.name)) push('Department', d.id, d.name, `Head: ${E().userName(state, d.headUserId)}`, `#/purchases?dept=${d.id}`); });
    return out.slice(0, 40);
  }

  return {
    statusTone, statusDot, deptName, vendorName, catName, ccName, priorityName,
    visiblePurchases, row, rows, myActions, kpis, tower, bottlenecks, slaStats, cycleTimes, vendorPerformance, financial,
    advanceRows, ageingSummary, exceptionRows, documentSummary, timeline, notificationsFor, unreadCount, search, ACTIVE
  };
})();
