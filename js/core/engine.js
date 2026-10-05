/* =====================================================================
   WORKFLOW ENGINE
   ---------------------------------------------------------------------
   MASTER → PROCESS VERSION → STAGES → ACTIVITIES → OWNER → SLA → ACTION

   Every function takes the shared `state` and mutates it. UI code calls
   them inside PCT.store.commit(state => ...). Nothing here touches the
   DOM. All time comes from PCT.clock.now().

   Public API (see docs/ARCHITECTURE.md for payload reference):
     createPurchase(state, input, userId, {submit, id})  -> {ok, purchase}
     act(state, purchaseId, activityId, op, payload, userId) -> {ok, error?, message?}
     tick(state) -> boolean (SLA reminders, escalations, overdue advances…)
     ball(state, p), currentActivity(p), displayStatus(state, a), canAct(state, user, p, a)
     closureChecks(state, p), matchResult(state, p), advanceOutstanding(adv)
     raiseException / updateException / notify / audit / nextId
     admin: masterSave, masterSetStatus, createDraftVersion, updateVersion, publishVersion
   ===================================================================== */
window.PCT = window.PCT || {};

PCT.engine = (function () {
  const U = PCT.util;
  const now = () => PCT.clock.now();
  const OPEN_STATES = ['In Progress', 'Waiting', 'Blocked'];
  const DONE_STATES = ['Completed', 'Skipped'];

  /* =================================================================
     LOOKUPS
     ================================================================= */
  const M = state => state.masters;
  const user = (state, id) => U.byId(M(state).users, id);
  const role = (state, id) => U.byId(M(state).roles, id);
  const dept = (state, id) => U.byId(M(state).departments, id);
  const vendor = (state, id) => U.byId(M(state).vendors, id);
  const category = (state, id) => U.byId(M(state).categories, id);
  const purchase = (state, id) => state.purchases.find(p => p.id === id);
  const advance = (state, id) => state.advances.find(a => a.id === id);
  const rule = (state, id) => { const r = U.byId(M(state).rules, id); return r && r.active ? r : null; };
  const ruleParam = (state, id, key, dflt) => { const r = rule(state, id); return r && r.params && r.params[key] != null ? r.params[key] : dflt; };
  const slaPolicy = state => (M(state).sla || []).find(s => s.status === 'Active') || { workingDays: true, weekend: [0, 6], dueSoonDays: 1 };
  const firstUserOfRole = (state, roleId) => (M(state).users.find(u => u.roleId === roleId && u.status === 'Active') || {}).id || null;
  const userName = (state, id) => (user(state, id) || {}).name || (id === 'system' ? 'System' : id || '—');

  function process(state, processId) { return U.byId(M(state).processes, processId || 'PROC-PUR'); }
  function version(state, ver, processId) { const pr = process(state, processId); return pr && pr.versions.find(v => v.version === ver); }
  function activeVersion(state, processId) { const pr = process(state, processId); return pr && (pr.versions.find(v => v.version === pr.activeVersion) || pr.versions.find(v => v.status === 'Active')); }
  function stagesFor(state, p) { const v = version(state, p.processVersion, p.processId); return v ? v.stages : []; }
  function stageDef(state, p, stageId) { return stagesFor(state, p).find(s => s.id === stageId); }

  /* =================================================================
     IDS, AUDIT, NOTIFICATIONS, EXCEPTIONS
     ================================================================= */
  const ID_DIGITS = 5;
  function nextId(state, prefix) {
    const c = state.meta.counters;
    c[prefix] = (c[prefix] || 0) + 1;
    return `${prefix}-${new Date(now()).getFullYear()}-${U.pad(c[prefix], ID_DIGITS)}`;
  }

  /** Immutable audit trail: who + what + when + previous + new. */
  function audit(state, e) {
    state.audit.push({
      id: 'AUD-' + (state.audit.length + 1),
      t: now(),
      userId: e.userId || 'system',
      action: e.action,
      entity: e.entity || 'Purchase',
      entityId: e.entityId || e.purchaseId || null,
      purchaseId: e.purchaseId || null,
      field: e.field || null,
      prev: e.prev == null ? null : String(e.prev),
      next: e.next == null ? null : String(e.next),
      note: e.note || null
    });
  }

  function notify(state, userId, event, title, text, purchaseId, extra) {
    if (!userId) return;
    const nm = (M(state).notifications || []).find(n => n.event === event);
    if (nm && nm.status !== 'Active') return;
    state.notifications.push(Object.assign({
      id: U.uid('N'), userId, t: now(), event, title, text, purchaseId: purchaseId || null,
      channels: nm ? nm.channels : ['In-app'], read: false
    }, extra || {}));
  }

  function raiseException(state, ex, userId) {
    if (ex.key && state.exceptions.some(e => e.key === ex.key && (e.status === 'Open' || e.status === 'In Progress'))) return null;
    const rec = Object.assign({
      id: nextId(state, 'EXC'), purchaseId: null, type: 'Other', title: '', description: '', ownerUserId: null,
      date: now(), severity: 'Medium', action: '', dueDate: U.addDays(now(), 2, true), resolution: null,
      resolvedAt: null, closedAt: null, status: 'Open', key: null, source: userId ? 'user' : 'system', activityId: null, raisedBy: userId || 'system'
    }, ex);
    state.exceptions.push(rec);
    audit(state, { userId: userId || 'system', action: 'Exception Raised', entity: 'Exception', entityId: rec.id, purchaseId: rec.purchaseId, next: rec.type, note: rec.title || rec.description });
    if (rec.ownerUserId) notify(state, rec.ownerUserId, rec.type.indexOf('mismatch') >= 0 ? 'invoice_mismatch' : 'workflow_blocked', `Exception: ${rec.type}`, rec.title || rec.description, rec.purchaseId);
    return rec;
  }

  function updateException(state, id, changes, userId) {
    const ex = state.exceptions.find(e => e.id === id);
    if (!ex) return { ok: false, error: 'Exception not found' };
    if ((changes.status === 'Resolved' || changes.status === 'Closed') && !(changes.resolution || ex.resolution)) return { ok: false, error: 'Enter a resolution before resolving the exception.' };
    Object.keys(changes).forEach(k => {
      if (ex[k] !== changes[k]) {
        audit(state, { userId, action: k === 'status' ? 'Status Changed' : 'Edited', entity: 'Exception', entityId: ex.id, purchaseId: ex.purchaseId, field: k, prev: ex[k], next: changes[k] });
        ex[k] = changes[k];
      }
    });
    if (changes.status === 'Resolved' && !ex.resolvedAt) ex.resolvedAt = now();
    if (changes.status === 'Closed' && !ex.closedAt) { ex.closedAt = now(); if (!ex.resolvedAt) ex.resolvedAt = now(); }
    return { ok: true };
  }

  function resolveExceptionsByKey(state, keyPrefix, resolution, userId) {
    state.exceptions.forEach(e => {
      if (e.key && e.key.indexOf(keyPrefix) === 0 && (e.status === 'Open' || e.status === 'In Progress')) {
        updateException(state, e.id, { status: 'Resolved', resolution }, userId || 'system');
      }
    });
  }

  /* =================================================================
     CONDITIONS & CONTEXT
     ================================================================= */
  function context(state, p) {
    const cat = category(state, p.categoryId) || {};
    const quotes = p.quotations || [];
    return {
      estValue: Number(p.estValue) || 0,
      value: Number(p.estValue) || 0,
      qty: Number(p.qty) || 0,
      categoryId: p.categoryId,
      categoryType: cat.type || 'material',
      techEval: !!cat.techEval,
      agreementRequired: !!(cat.agreementRequired || (p.flags && p.flags.agreementRequired)),
      deptId: p.deptId,
      costCentreId: p.costCentreId,
      priority: p.priority,
      flags: p.flags || {},
      singleSource: !!(p.flags && p.flags.singleSource),
      quoteCount: quotes.length,
      lowestSelected: p.selection ? !!p.selection.lowestSelected : null,
      advancePct: (p.flags && p.flags.advancePct) || 0
    };
  }

  function evalCond(cond, ctx) {
    if (!cond) return true;
    if (cond.all) return cond.all.every(c => evalCond(c, ctx));
    if (cond.any) return cond.any.some(c => evalCond(c, ctx));
    const v = U.get(ctx, cond.field);
    const x = cond.value;
    switch (cond.op) {
      case 'eq': return v == x; // eslint-disable-line eqeqeq
      case 'neq': return v != x; // eslint-disable-line eqeqeq
      case 'gt': return Number(v) > Number(x);
      case 'gte': return Number(v) >= Number(x);
      case 'lt': return Number(v) < Number(x);
      case 'lte': return Number(v) <= Number(x);
      case 'in': return (x || []).includes(v);
      case 'nin': return !(x || []).includes(v);
      case 'truthy': return !!v;
      case 'falsy': return !v;
      default: return true;
    }
  }
  function describeCond(cond) {
    if (!cond) return 'Always';
    if (cond.all) return cond.all.map(describeCond).join(' AND ');
    if (cond.any) return cond.any.map(describeCond).join(' OR ');
    const ops = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'in', nin: 'not in', truthy: 'is Yes', falsy: 'is No' };
    return `${cond.field} ${ops[cond.op] || cond.op}${cond.op === 'truthy' || cond.op === 'falsy' ? '' : ' ' + JSON.stringify(cond.value)}`;
  }

  /* =================================================================
     OWNERS, APPROVALS, SLA
     ================================================================= */
  function deptHeadFor(state, deptId, avoidUserId) {
    const d = dept(state, deptId);
    let head = d && d.headUserId;
    if (head && head === avoidUserId) head = (user(state, head) || {}).managerId || firstUserOfRole(state, 'management');
    return head || firstUserOfRole(state, 'management');
  }

  function resolveOwner(state, p, roleId) {
    const ctx = context(state, p);
    let id = null;
    switch (roleId) {
      case 'requestor': id = p.requestorId; break;
      case 'dept_head': id = deptHeadFor(state, p.deptId, p.requestorId); break;
      case 'procurement': id = p.buyerId || firstUserOfRole(state, 'procurement'); break;
      case 'procurement_lead': {
        id = deptHeadFor(state, 'DPT-PRC');
        if (id === p.buyerId) id = firstUserOfRole(state, 'management');
        break;
      }
      case 'receiver': id = ctx.categoryType === 'service' ? p.requestorId : firstUserOfRole(state, 'stores'); break;
      case 'advance_approver': {
        const adv = (p.advanceIds || []).map(x => advance(state, x)).filter(Boolean).pop();
        const pct = adv ? adv.pct : (p.flags.advancePct || 0);
        const band = U.sortBy((M(state).advanceApproval || []).filter(b => b.status === 'Active'), b => b.maxPct).find(b => pct <= b.maxPct);
        id = resolveOwner(state, p, band ? band.approverRole : 'finance');
        break;
      }
      default: id = firstUserOfRole(state, roleId);
    }
    if (roleId !== 'requestor' && roleId !== 'receiver' && id === p.requestorId) id = (user(state, id) || {}).managerId || id; // segregation of duties
    return id;
  }

  /** Approval levels from the Approval Matrix (value band + optional category / department filters). */
  function approvalLevels(state, p) {
    const v = Number(p.estValue) || 0;
    const rows = (M(state).approvalMatrix || []).filter(r => r.status === 'Active'
      && v >= (Number(r.minValue) || 0) && (r.maxValue == null || r.maxValue === '' || v <= Number(r.maxValue))
      && (!r.categoryIds || !r.categoryIds.length || r.categoryIds.includes(p.categoryId))
      && (!r.deptIds || !r.deptIds.length || r.deptIds.includes(p.deptId)));
    const specific = rows.filter(r => (r.categoryIds && r.categoryIds.length) || (r.deptIds && r.deptIds.length));
    const chosen = specific.length ? specific[0] : rows[0];
    if (!chosen) return [{ level: 1, roleId: 'dept_head', label: 'Department Head', matrixId: null }];
    return chosen.levels.map(l => ({ level: l.level, roleId: l.roleId, label: l.label, matrixId: chosen.id, matrixName: chosen.name }));
  }

  function priorityFactor(state, pid) { const pr = U.byId(M(state).priorities, pid); return pr ? Number(pr.slaFactor) || 1 : 1; }

  function dueFor(state, p, a, start) {
    const pol = slaPolicy(state);
    let days = Number(a.slaDays) || 0;
    let working = pol.workingDays !== false;
    if (a.slaFrom) {
      const v = U.get(p, a.slaFrom);
      if (v != null) { days = Number(v) || 0; working = false; }
    } else {
      days = Math.ceil(days * priorityFactor(state, p.priority));
    }
    return U.addDays(start, days, working, pol.weekend);
  }

  /* =================================================================
     PLAN: stages + activities + documents from the process version
     ================================================================= */
  function buildActivities(state, p) {
    const ctx = context(state, p);
    const list = [];
    stagesFor(state, p).filter(s => s.status !== 'Inactive').forEach(s => {
      if (!evalCond(s.activation, ctx)) return;
      U.sortBy(s.activities.filter(x => x.status !== 'Inactive'), x => x.seq).forEach(a => {
        const base = {
          masterId: a.id, purchaseId: p.id, stageId: s.id, stageName: s.name, group: s.group,
          actionType: a.actionType || 'task', slaDays: a.slaDays, slaFrom: a.slaFrom || null, condition: a.condition || null,
          checklist: (a.checklist || []).slice(), requiredDocs: (a.requiredDocs || []).slice(), approval: !!a.approval,
          escalationId: a.escalationId || null, input: a.input || '', output: a.output || '', description: a.description || '',
          status: 'Not Started', startAt: null, dueAt: null, completedAt: null, completedBy: null, priority: p.priority,
          blocker: null, waitingOn: null, nextAction: null, remarks: null, escalations: [], clarification: null, reassigned: false
        };
        if (a.perApprovalLevel) {
          (p.approvals || []).forEach(l => list.push(Object.assign({}, base, {
            id: `${p.id}-${a.id}-L${l.level}`, name: `${a.name} — L${l.level} ${l.label}`, ownerRole: l.roleId, approvalLevel: l.level
          })));
        } else {
          list.push(Object.assign({}, base, { id: `${p.id}-${a.id}`, name: a.name, ownerRole: a.ownerRole }));
        }
      });
    });
    list.forEach((a, i) => {
      a.seq = i + 1;
      a.dependsOn = i ? list[i - 1].id : null;
      a.ownerUserId = a.approvalLevel ? resolveApprover(state, p, a.ownerRole) : resolveOwner(state, p, a.ownerRole);
    });
    return list;
  }
  function resolveApprover(state, p, roleId) { return resolveOwner(state, p, roleId); }

  function buildStages(state, p) {
    const ctx = context(state, p);
    return stagesFor(state, p).filter(s => s.status !== 'Inactive').map(s => {
      const active = evalCond(s.activation, ctx);
      return { stageId: s.id, name: s.name, seq: s.seq, group: s.group, active, status: active ? 'Not Started' : 'Skipped', startedAt: null, completedAt: null };
    });
  }

  function buildDocuments(state, p, previous) {
    const ctx = context(state, p);
    const activeStages = (p.stages || []).filter(s => s.active).map(s => s.stageId);
    return (M(state).documents || []).filter(d => d.status !== 'Inactive' && d.stages.some(s => activeStages.includes(s)) && evalCond(d.appliesTo, ctx)).map(d => {
      const old = (previous || []).find(x => x.docId === d.id);
      return old || { docId: d.id, name: d.name, stages: d.stages.filter(s => activeStages.includes(s)), mandatory: !!d.mandatory, system: !!d.system, status: 'Missing', fileName: null, uploadedAt: null, uploadedBy: null, verifiedAt: null, verifiedBy: null };
    });
  }

  function plan(state, p) {
    p.approvals = approvalLevels(state, p).map(l => Object.assign({ status: 'Pending', userId: null, at: null, remarks: null }, l));
    p.stages = buildStages(state, p);
    p.activities = buildActivities(state, p);
    p.approvals.forEach(l => { const a = p.activities.find(x => x.approvalLevel === l.level); l.userId = a ? a.ownerUserId : null; });
    p.documents = buildDocuments(state, p, p.documents);
  }

  /** Re-evaluate stage activation for stages that have not started (flags/value changed). */
  function replan(state, p) {
    const fresh = Object.assign({}, p, { documents: [] });
    fresh.approvals = approvalLevels(state, p).map(l => {
      const old = (p.approvals || []).find(x => x.level === l.level && x.roleId === l.roleId);
      return old || Object.assign({ status: 'Pending', userId: null, at: null, remarks: null }, l);
    });
    const newStages = buildStages(state, fresh);
    const startedStage = id => (p.activities || []).some(a => a.stageId === id && a.status !== 'Not Started');
    p.stages = newStages.map(ns => { const old = p.stages.find(s => s.stageId === ns.stageId); return old && startedStage(ns.stageId) ? old : ns; });
    fresh.stages = p.stages;
    fresh.approvals = fresh.approvals;
    const newActs = buildActivities(state, fresh);
    const merged = newActs.map(na => {
      const old = p.activities.find(o => o.id === na.id);
      return old && old.status !== 'Not Started' ? old : na;
    });
    // keep started activities whose stage is no longer planned (history must never disappear)
    p.activities.filter(o => o.status !== 'Not Started' && !merged.some(m => m.id === o.id)).forEach(o => merged.push(o));
    p.activities = U.sortBy(merged, a => (stageSeq(state, p, a.stageId) * 100) + (a.approvalLevel || 0) + (U.byId(stageDef(state, p, a.stageId) ? stageDef(state, p, a.stageId).activities : [], a.masterId) || { seq: 0 }).seq * 10);
    p.activities.forEach((a, i) => { a.seq = i + 1; a.dependsOn = i ? p.activities[i - 1].id : null; });
    p.approvals = fresh.approvals;
    p.approvals.forEach(l => { const a = p.activities.find(x => x.approvalLevel === l.level); l.userId = a ? a.ownerUserId : l.userId; });
    p.documents = buildDocuments(state, p, p.documents);
  }
  function stageSeq(state, p, stageId) { const s = stageDef(state, p, stageId); return s ? s.seq : 99; }

  /* =================================================================
     RUNTIME: current activity, ball, statuses
     ================================================================= */
  function currentActivity(p) { return (p.activities || []).find(a => OPEN_STATES.includes(a.status)) || null; }
  function isOverdue(state, a) { return !!(a && a.dueAt && OPEN_STATES.includes(a.status) && now() > a.dueAt); }
  function displayStatus(state, a) {
    if (!a) return '—';
    if ((a.status === 'In Progress' || a.status === 'Waiting') && isOverdue(state, a)) return 'Overdue';
    return a.status;
  }
  function overdueDays(state, a) { return isOverdue(state, a) ? Math.max(1, U.daysBetween(a.dueAt, now())) : 0; }

  function currentStage(state, p) { const a = currentActivity(p); return a ? p.stages.find(s => s.stageId === a.stageId) : null; }

  function nextActionText(state, p, a) {
    if (!a) return p.status === 'Closed' ? 'None — purchase closed' : p.status === 'Rejected' ? 'None — rejected' : p.status === 'Draft' ? 'Submit purchase request' : '—';
    if (a.clarification && !a.clarification.response) return `Answer clarification: “${a.clarification.question}”`;
    if (a.status === 'Blocked') return `Resolve: ${a.blocker || 'blocker'}`;
    if (a.nextAction) return a.nextAction;
    const v = id => (vendor(state, id) || {}).name || 'vendor';
    switch (a.actionType) {
      case 'requirement': return 'Capture requirement details';
      case 'pr_submit': return p.returned ? `Revise and resubmit PR (returned: ${p.returned.reason})` : 'Submit purchase request';
      case 'review': return 'Review PR completeness';
      case 'approval': return `Approve PR (L${a.approvalLevel})`;
      case 'sourcing': return 'Shortlist vendors from approved list';
      case 'rfq': {
        const pend = (p.rfqs || []).filter(r => r.status === 'Sent' || r.status === 'Waiting');
        if (!(p.rfqs || []).length) return 'Send RFQs to shortlisted vendors';
        return pend.length ? `Follow up with ${v(pend[0].vendorId)}${pend.length > 1 ? ` (+${pend.length - 1} pending)` : ''}` : 'Close RFQ round';
      }
      case 'quotation': return 'Record quotations received';
      case 'comparison': return 'Compare quotations and recommend vendor';
      case 'tech_eval': return 'Complete technical evaluation';
      case 'selection': return 'Select vendor';
      case 'selection_approval': return 'Approve non-L1 vendor selection';
      case 'po_create': return 'Create PO / agreement';
      case 'po_approve': return 'Approve PO';
      case 'po_send': return p.po && p.po.status === 'Sent' ? `Obtain acceptance from ${v(p.po.vendorId)}` : 'Send PO to vendor';
      case 'advance_request': return 'Raise advance request';
      case 'advance_approve': return 'Approve vendor advance';
      case 'advance_verify': return 'Verify advance documents';
      case 'advance_pay': return 'Release advance payment';
      case 'delivery': return p.po && p.po.expectedDelivery ? `Confirm delivery (expected ${U.fmt.dateShort(p.po.expectedDelivery)})` : 'Record delivery';
      case 'grn': return context(state, p).categoryType === 'service' ? 'Confirm service completion' : 'Create GRN';
      case 'invoice': return 'Record vendor invoice';
      case 'invoice_verify': return 'Verify invoice';
      case 'match': return 'Run PO ↔ GRN ↔ Invoice match';
      case 'payment_approval': return 'Approve payment proposal';
      case 'payment': return 'Release payment';
      case 'adjustment': return 'Adjust advance against invoice';
      case 'balance_payment': return 'Pay balance amount';
      case 'closure': return 'Verify closure checklist and close';
      default: return a.name;
    }
  }

  /** WHO HAS THE BALL? — one owner, one activity, one next action, one due date. */
  function ball(state, p) {
    const base = { purchaseId: p.id, closed: false };
    if (p.status === 'Closed' || p.status === 'Rejected' || p.status === 'Cancelled') {
      return Object.assign(base, { closed: true, status: p.status, stageName: p.status, activityName: '—', ownerUserId: null, ownerName: '—', withLabel: '—', nextAction: nextActionText(state, p, null), dueAt: null, ageingDays: 0, overdueDays: 0 });
    }
    const a = currentActivity(p);
    if (!a) return Object.assign(base, { status: p.status, stageName: '—', activityName: '—', ownerUserId: null, ownerName: '—', withLabel: '—', nextAction: '—', dueAt: null, ageingDays: 0, overdueDays: 0 });
    const clar = a.clarification && !a.clarification.response;
    const ownerId = clar ? p.requestorId : a.ownerUserId;
    const ou = user(state, ownerId) || {};
    const r = role(state, ou.roleId) || {};
    const d = dept(state, ou.deptId) || {};
    return Object.assign(base, {
      activity: a, activityId: a.id, activityName: a.name, stageId: a.stageId, stageName: a.stageName, group: a.group,
      ownerUserId: ownerId, ownerName: ou.name || '—', roleId: ou.roleId, roleName: r.name || '', deptName: d.name || '',
      withLabel: d.name || r.name || '—',
      waitingOn: clar ? 'requestor' : a.waitingOn,
      nextAction: nextActionText(state, p, a), dueAt: a.dueAt, startAt: a.startAt,
      ageingDays: U.ageDays(a.startAt), overdueDays: overdueDays(state, a),
      status: displayStatus(state, a), blocker: a.blocker, onHold: p.status === 'On Hold'
    });
  }

  function canAct(state, u, p, a) {
    if (!u || !p || !a || !OPEN_STATES.includes(a.status)) return false;
    if (p.status === 'On Hold' && a.status === 'Blocked' && a.blocker && a.blocker.indexOf('On hold') === 0) return false;
    if (a.clarification && !a.clarification.response) return u.id === p.requestorId;
    if (u.id === a.ownerUserId) return true;
    // Pool roles: any active user holding the same functional role may pick up the task (not approvals).
    const pool = ['procurement', 'ap', 'finance', 'stores', 'technical'];
    if (!a.approval && pool.includes(a.ownerRole) && u.roleId === a.ownerRole) return true;
    if (a.ownerRole === 'receiver' && u.roleId === 'stores' && context(state, p).categoryType !== 'service') return true;
    return false;
  }

  /* =================================================================
     ACTIVITY LIFECYCLE
     ================================================================= */
  function startActivity(state, p, a) {
    const ctx = context(state, p);
    if (a.condition && !evalCond(a.condition, ctx)) {
      a.status = 'Skipped'; a.completedAt = now(); a.remarks = 'Condition not met: ' + describeCond(a.condition);
      return false;
    }
    if (!a.reassigned) a.ownerUserId = resolveOwner(state, p, a.ownerRole);
    if (a.approvalLevel) { const l = p.approvals.find(x => x.level === a.approvalLevel); if (l) l.userId = a.ownerUserId; }
    a.status = 'In Progress'; a.startAt = now(); a.dueAt = dueFor(state, p, a, a.startAt);
    a.waitingOn = null; a.blocker = null; a.nextAction = null;
    const st = p.stages.find(s => s.stageId === a.stageId);
    if (st && st.status !== 'In Progress') { st.status = 'In Progress'; st.startedAt = st.startedAt || now(); }
    audit(state, { userId: 'system', action: 'Assigned', entity: 'Activity', entityId: a.id, purchaseId: p.id, field: 'owner', next: userName(state, a.ownerUserId), note: a.name });
    notify(state, a.ownerUserId, a.approval ? 'approval_required' : 'activity_assigned', a.approval ? 'Approval required' : 'New activity',
      `${a.name} — ${p.id} · ${p.title} (${U.fmt.inr(p.estValue)})`, p.id);
    return true;
  }

  function activateNext(state, p) {
    if (p.status !== 'Open') return;
    if (currentActivity(p)) return;
    for (const a of p.activities) {
      if (DONE_STATES.includes(a.status)) continue;
      if (a.status === 'Rejected') return;
      if (a.status === 'Not Started') { if (startActivity(state, p, a)) return; continue; }
    }
    refreshStages(state, p);
  }

  function refreshStages(state, p) {
    p.stages.forEach(s => {
      if (!s.active && !p.activities.some(a => a.stageId === s.stageId)) { s.status = 'Skipped'; return; }
      const acts = p.activities.filter(a => a.stageId === s.stageId);
      if (!acts.length) { s.status = s.active ? 'Not Started' : 'Skipped'; return; }
      if (acts.every(a => DONE_STATES.includes(a.status))) {
        s.status = acts.every(a => a.status === 'Skipped') ? 'Skipped' : 'Completed';
        s.completedAt = s.completedAt || U.sortBy(acts, a => a.completedAt || 0).pop().completedAt;
      } else if (acts.some(a => a.status === 'Rejected')) s.status = 'Rejected';
      else if (acts.some(a => a.status !== 'Not Started')) { s.status = 'In Progress'; s.startedAt = s.startedAt || now(); }
      else s.status = 'Not Started';
    });
  }

  function missingDocsForStage(state, p, stageId) {
    if (!rule(state, 'R07')) return [];
    return (p.documents || []).filter(d => d.mandatory && d.status === 'Missing' && d.stages.includes(stageId));
  }

  /** Complete the current activity → next activity starts automatically. */
  function completeActivity(state, p, a, userId, remarks) {
    const rest = p.activities.filter(x => x.stageId === a.stageId && x.id !== a.id && !DONE_STATES.includes(x.status));
    // Rule R07: last open activity of the stage → mandatory documents must be present
    const pendingInStage = rest.filter(x => !(x.condition && !evalCond(x.condition, context(state, p))));
    if (!pendingInStage.length) {
      const missing = missingDocsForStage(state, p, a.stageId);
      if (missing.length) {
        missing.forEach(d => notify(state, a.ownerUserId, 'missing_document', 'Missing document', `${d.name} is mandatory for ${a.stageName} — ${p.id}`, p.id));
        return { ok: false, error: `Rule R07 — mandatory document missing: ${missing.map(d => d.name).join(', ')}. Upload it to complete “${a.stageName}”.` };
      }
    }
    a.status = 'Completed'; a.completedAt = now(); a.completedBy = userId; a.blocker = null; a.waitingOn = null;
    if (remarks) a.remarks = remarks;
    audit(state, { userId, action: 'Status Changed', entity: 'Activity', entityId: a.id, purchaseId: p.id, field: 'status', prev: 'In Progress', next: 'Completed', note: a.name });
    refreshStages(state, p);
    activateNext(state, p);
    refreshStages(state, p);
    return { ok: true };
  }

  function setWaiting(state, p, a, waitingOn, nextAction) { a.status = 'Waiting'; a.waitingOn = waitingOn; a.nextAction = nextAction || null; }
  function block(state, p, a, reason, userId) {
    const prev = a.status;
    a.status = 'Blocked'; a.blocker = reason;
    audit(state, { userId: userId || 'system', action: 'Status Changed', entity: 'Activity', entityId: a.id, purchaseId: p.id, field: 'status', prev, next: 'Blocked', note: reason });
    notify(state, a.ownerUserId, 'workflow_blocked', 'Workflow blocked', `${p.id}: ${reason}`, p.id);
  }
  function unblock(state, p, a, userId) {
    if (a.status !== 'Blocked') return;
    a.status = 'In Progress'; a.blocker = null;
    audit(state, { userId: userId || 'system', action: 'Status Changed', entity: 'Activity', entityId: a.id, purchaseId: p.id, field: 'status', prev: 'Blocked', next: 'In Progress' });
  }

  /** Send the workflow back to an earlier activity (return / rework). */
  function sendBack(state, p, fromAct, targetMasterId, reason, userId) {
    const idx = p.activities.findIndex(x => x.masterId === targetMasterId);
    const cur = p.activities.indexOf(fromAct);
    if (idx < 0 || idx > cur) return { ok: false, error: 'Cannot return to that step.' };
    for (let i = idx; i <= cur; i++) {
      const x = p.activities[i];
      if (x.status === 'Skipped') { x.status = 'Not Started'; x.completedAt = null; x.remarks = null; }
      if (x.status === 'Not Started') continue;
      x.status = 'Not Started'; x.startAt = null; x.dueAt = null; x.completedAt = null; x.completedBy = null; x.blocker = null; x.waitingOn = null; x.escalations = []; x.clarification = null;
      if (x.approvalLevel) { const l = p.approvals.find(a => a.level === x.approvalLevel); if (l && l.status === 'Approved') { l.status = 'Pending'; l.at = null; } }
    }
    const target = p.activities[idx];
    refreshStages(state, p);
    startActivity(state, p, target);
    target.returnedReason = reason;
    refreshStages(state, p);
    audit(state, { userId, action: 'Returned', entity: 'Activity', entityId: fromAct.id, purchaseId: p.id, field: 'step', prev: fromAct.name, next: target.name, note: reason });
    notify(state, target.ownerUserId, 'returned', 'Returned to you', `${p.id}: ${reason}`, p.id);
    return { ok: true };
  }

  /* =================================================================
     DOCUMENTS
     ================================================================= */
  function registerDoc(state, p, docId, fileName, userId, status) {
    const d = (p.documents || []).find(x => x.docId === docId);
    if (!d) return null;
    const prev = d.status;
    d.status = status || 'Received';
    if (d.status !== 'Not Required') { d.fileName = fileName || d.fileName || `${d.name.replace(/[^A-Za-z0-9]+/g, '_')}_${p.id}.pdf`; d.uploadedAt = now(); d.uploadedBy = userId; }
    audit(state, { userId, action: 'Document Uploaded', entity: 'Document', entityId: docId, purchaseId: p.id, field: d.name, prev, next: d.status, note: d.fileName });
    return d;
  }

  /* =================================================================
     ADVANCE LEDGER
     ================================================================= */
  function advanceAdjusted(adv) { return U.sum(adv.adjustments || [], x => x.amount); }
  function advanceRecovered(adv) { return U.sum(adv.recoveries || [], x => x.amount); }
  function advanceOutstanding(adv) { return Math.max(0, (Number(adv.paidAmount) || 0) - advanceAdjusted(adv) - advanceRecovered(adv)); }
  function advanceAgeing(state, adv) {
    if (!adv.paymentDate || advanceOutstanding(adv) <= 0) return null;
    const days = U.ageDays(adv.paymentDate);
    const b = (M(state).ageingBuckets || []).find(x => days >= x.min && (x.max == null || days <= x.max));
    return { days, bucket: b ? b.label : '' , overdue: !!(adv.settlementDueDate && now() > adv.settlementDueDate) };
  }
  function refreshAdvanceStatus(adv) {
    if (adv.status === 'Rejected' || !adv.paidAmount) return;
    const out = advanceOutstanding(adv);
    if (out <= 0) adv.status = advanceRecovered(adv) > 0 && advanceAdjusted(adv) === 0 ? 'Recovered' : 'Adjusted';
    else adv.status = advanceAdjusted(adv) > 0 || advanceRecovered(adv) > 0 ? 'Partially Adjusted' : 'Outstanding';
  }
  function vendorOutstanding(state, vendorId, exceptPurchaseId) {
    return U.sum(state.advances.filter(a => a.vendorId === vendorId && a.purchaseId !== exceptPurchaseId), advanceOutstanding);
  }
  function purchaseAdvanceOutstanding(state, p) { return U.sum((p.advanceIds || []).map(id => advance(state, id)).filter(Boolean), advanceOutstanding); }

  /* =================================================================
     INVOICES & 3-WAY MATCH
     ================================================================= */
  function invoiceTotals(p) {
    const inv = p.invoices || [];
    const total = U.sum(inv, i => i.total);
    const paid = U.sum(inv, i => i.paidAmount);
    const adjusted = U.sum(inv, i => i.adjustedAmount);
    return { total, paid, adjusted, balance: Math.max(0, total - paid - adjusted), qty: U.sum(inv, i => i.qty), basic: U.sum(inv, i => i.value), tax: U.sum(inv, i => i.tax) };
  }

  /** PO ↔ GRN ↔ INVOICE: returns line-by-line comparison with mismatch detail. */
  function matchResult(state, p) {
    const po = p.po || {};
    const tol = Number(ruleParam(state, 'R04', 'tolerancePct', 0.5)) || 0;
    const inv = p.invoices || [];
    const it = invoiceTotals(p);
    const grnQty = U.sum(p.grns || [], g => g.acceptedQty);
    const unitPrice = Number(po.unitPrice) || 0;
    const invUnit = it.qty ? it.basic / it.qty : 0;
    const invTaxPct = it.basic ? it.tax / it.basic * 100 : 0;
    const expected = Math.round(grnQty * unitPrice * (1 + (Number(po.taxPct) || 0) / 100));
    const within = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * tol / 100);
    const unit = (context(state, p).categoryType === 'service') ? 'units' : ((category(state, p.categoryId) || {}).uom || 'units');
    const lines = [
      { key: 'vendor', label: 'Vendor', po: (vendor(state, po.vendorId) || {}).name, grn: (vendor(state, po.vendorId) || {}).name, invoice: inv.length ? (vendor(state, inv[0].vendorId) || {}).name : '—', ok: inv.every(i => i.vendorId === po.vendorId), detail: '' },
      { key: 'quantity', label: 'Quantity', po: po.qty, grn: grnQty, invoice: it.qty, ok: it.qty === grnQty && grnQty <= po.qty, detail: it.qty !== grnQty ? `Invoice quantity = ${it.qty} · GRN quantity = ${grnQty} · Mismatch = ${Math.abs(it.qty - grnQty)} ${unit}` : (grnQty > po.qty ? `GRN exceeds PO by ${grnQty - po.qty} ${unit}` : '') },
      { key: 'price', label: 'Unit price', po: unitPrice, grn: unitPrice, invoice: Math.round(invUnit * 100) / 100, money: true, ok: within(invUnit, unitPrice), detail: within(invUnit, unitPrice) ? '' : `Invoice price ${U.fmt.inr(invUnit)} vs PO ${U.fmt.inr(unitPrice)} · Difference ${U.fmt.inr(invUnit - unitPrice)} per unit` },
      { key: 'tax', label: 'Tax %', po: Number(po.taxPct) || 0, grn: Number(po.taxPct) || 0, invoice: Math.round(invTaxPct * 100) / 100, pct: true, ok: Math.abs(invTaxPct - (Number(po.taxPct) || 0)) < 0.05, detail: Math.abs(invTaxPct - (Number(po.taxPct) || 0)) < 0.05 ? '' : `Invoice tax ${invTaxPct.toFixed(2)}% vs PO ${po.taxPct}%` },
      { key: 'total', label: 'Total value', po: po.total, grn: expected, invoice: it.total, money: true, ok: within(it.total, expected), detail: within(it.total, expected) ? '' : `Invoice ${U.fmt.inr(it.total)} vs received value ${U.fmt.inr(expected)} · Variance ${U.fmt.inr(it.total - expected)}` }
    ];
    const accepted = p.match && p.match.acceptedVariance;
    const ok = lines.every(l => l.ok) || !!accepted;
    return { ok, lines, tolerancePct: tol, expected, invoiceTotal: it.total, accepted: accepted || null };
  }

  /* =================================================================
     CLOSURE CONTROL
     ================================================================= */
  function closureChecks(state, p) {
    const acts = p.activities.filter(a => a.actionType !== 'closure');
    const approvalsOk = (p.approvals || []).every(l => l.status === 'Approved');
    const docs = (p.documents || []).filter(d => d.mandatory && d.status !== 'Not Required');
    const missing = docs.filter(d => d.status === 'Missing');
    const ctx = context(state, p);
    const grnOk = (p.grns || []).length > 0;
    const it = invoiceTotals(p);
    const invOk = (p.invoices || []).length > 0 && (p.invoices || []).every(i => ['Verified', 'Matched', 'Paid'].includes(i.status));
    const payOk = it.total > 0 && it.balance <= 0;
    const advOut = purchaseAdvanceOutstanding(state, p);
    const openEx = state.exceptions.filter(e => e.purchaseId === p.id && (e.status === 'Open' || e.status === 'In Progress'));
    return [
      { key: 'activities', label: 'Required activities completed', ok: acts.every(a => DONE_STATES.includes(a.status)), detail: `${acts.filter(a => DONE_STATES.includes(a.status)).length}/${acts.length}` },
      { key: 'approvals', label: 'Required approvals completed', ok: approvalsOk, detail: (p.approvals || []).map(l => `L${l.level} ${l.status}`).join(' · ') },
      { key: 'documents', label: 'Required documents available', ok: !missing.length, detail: missing.length ? 'Missing: ' + missing.map(d => d.name).join(', ') : `${docs.length} of ${docs.length}` },
      { key: 'delivery', label: ctx.categoryType === 'service' ? 'Service completed' : 'Delivery completed', ok: grnOk, detail: grnOk ? (p.grns || []).map(g => g.number).join(', ') : 'No GRN / confirmation' },
      { key: 'invoice', label: 'Invoice verified', ok: invOk, detail: (p.invoices || []).map(i => `${i.number} ${i.status}`).join(' · ') || 'No invoice' },
      { key: 'payment', label: 'Payment completed', ok: payOk, detail: payOk ? `${U.fmt.inr(it.paid)} paid · ${U.fmt.inr(it.adjusted)} adjusted` : `Balance ${U.fmt.inr(it.balance)}` },
      { key: 'advance', label: 'Advance fully adjusted / recovered', ok: advOut <= 0, detail: advOut > 0 ? `Outstanding ${U.fmt.inr(advOut)}` : ((p.advanceIds || []).length ? 'Settled' : 'No advance') },
      { key: 'issues', label: 'Outstanding issues resolved', ok: !openEx.length, detail: openEx.length ? `${openEx.length} open exception(s)` : 'None open' }
    ];
  }

  /* =================================================================
     CREATE / SUBMIT
     ================================================================= */
  function assignBuyer(state) {
    const buyers = M(state).users.filter(u => u.roleId === 'procurement' && u.status === 'Active' && u.id !== deptHeadFor(state, 'DPT-PRC'));
    return (buyers[0] || M(state).users.find(u => u.roleId === 'procurement') || {}).id || null;
  }

  function validatePR(state, p) {
    const req = [['title', 'Requirement title'], ['categoryId', 'Category'], ['deptId', 'Department'], ['costCentreId', 'Cost centre'], ['justification', 'Business justification'], ['requiredBy', 'Required date']];
    const miss = req.filter(([k]) => !p[k]).map(([, l]) => l);
    if (!(Number(p.estValue) > 0)) miss.push('Estimated value');
    if (!(Number(p.qty) > 0)) miss.push('Quantity');
    return miss;
  }

  /**
   * input: { title, description, specification, categoryId, deptId, costCentreId, qty, uom, estValue,
   *          requiredBy (ms), priority, justification, budgetAvailable, attachments:[fileName],
   *          flags: { advanceRequired, advancePct, advanceTypeId, singleSource, emergency, agreementRequired },
   *          requestorId?, buyerId? }
   * opts:  { submit: boolean, id?: string }
   */
  function createPurchase(state, input, userId, opts) {
    opts = opts || {};
    const ver = activeVersion(state, input.processId);
    const id = opts.id || nextId(state, 'PUR');
    if (opts.id) { const n = Number(String(opts.id).split('-').pop()); if (n > (state.meta.counters.PUR || 0)) state.meta.counters.PUR = n; }
    const u = user(state, input.requestorId || userId) || {};
    const p = {
      id, prNo: null, processId: input.processId || 'PROC-PUR', processVersion: input.processVersion || ver.version,
      title: input.title || '', description: input.description || '', specification: input.specification || '',
      categoryId: input.categoryId, deptId: input.deptId || u.deptId, costCentreId: input.costCentreId,
      qty: Number(input.qty) || 1, uom: input.uom || ((category(state, input.categoryId) || {}).uom) || 'Nos',
      estValue: Number(input.estValue) || 0, requiredBy: input.requiredBy || null, priority: input.priority || 'P3',
      justification: input.justification || '', budgetAvailable: input.budgetAvailable !== false,
      flags: Object.assign({ advanceRequired: false, advancePct: 0, advanceTypeId: null, singleSource: false, emergency: false, agreementRequired: false }, input.flags || {}),
      status: 'Draft', createdAt: now(), createdBy: userId, requestorId: input.requestorId || userId, buyerId: input.buyerId || assignBuyer(state),
      submittedAt: null, closedAt: null, returned: null,
      stages: [], activities: [], approvals: [], documents: [],
      sourcing: null, rfqs: [], quotations: [], comparison: null, techEval: null, selection: null, po: null,
      advanceIds: [], deliveries: [], grns: [], invoices: [], paymentIds: [], match: null, paymentApproval: null,
      comments: [], tags: input.tags || []
    };
    plan(state, p);
    state.purchases.push(p);
    audit(state, { userId, action: 'Created', purchaseId: p.id, entityId: p.id, note: `${p.title} · ${U.fmt.inr(p.estValue)} · Process V${p.processVersion}` });
    (input.attachments || []).forEach(f => registerDoc(state, p, 'D01', f, userId));
    // Requirement captured in the same form → complete it; PR submission becomes the current step.
    p.status = 'Open';
    activateNext(state, p);
    const a1 = currentActivity(p);
    if (a1 && a1.actionType === 'requirement') completeActivity(state, p, a1, userId, 'Captured in PR form');
    if (opts.submit) {
      const r = act(state, p.id, null, 'submit', {}, userId);
      if (!r.ok) return { ok: false, error: r.error, purchase: p };
    } else {
      p.status = 'Draft';
    }
    return { ok: true, purchase: p };
  }

  /* =================================================================
     ACTION HANDLERS — keyed by activity.actionType → op
     Each handler: (x) => result, where x = { state, p, a, payload, userId, u }
     ================================================================= */
  const done = (x, remarks) => completeActivity(x.state, x.p, x.a, x.userId, remarks);
  const fail = msg => ({ ok: false, error: msg });
  const req = (v, msg) => (v == null || v === '' ? msg : null);
  const vname = (state, id) => (vendor(state, id) || {}).name || id;
  const selectedQuote = p => (p.quotations || []).find(q => p.selection && q.vendorId === p.selection.vendorId);
  const ranking = p => U.sortBy((p.quotations || []).filter(q => q.status !== 'Withdrawn'), q => Number(q.total) || 0).map((q, i) => ({ vendorId: q.vendorId, total: q.total, rank: 'L' + (i + 1) }));

  const H = {
    requirement: {
      complete: x => done(x, x.payload.remarks)
    },

    pr_submit: {
      submit: x => {
        const { state, p, userId } = x;
        const miss = validatePR(state, p);
        if (miss.length) return fail('Complete the required fields: ' + miss.join(', '));
        const resub = !!p.returned;
        p.status = 'Open';
        p.prNo = p.prNo || p.id.replace('PUR', 'PR');
        p.submittedAt = p.submittedAt || now();
        registerDoc(state, p, 'D02', `${p.prNo}.pdf`, userId);
        audit(state, { userId, action: 'Submitted', purchaseId: p.id, entityId: p.id, field: 'status', prev: resub ? 'Returned' : 'Draft', next: 'Open', note: resub ? 'Resubmitted after return' : p.prNo });
        if (resub) { p.returned = Object.assign({}, p.returned, { resolvedAt: now() }); resolveExceptionsByKey(state, `return:${p.id}`, 'Resubmitted by requestor', userId); p.returned = null; }
        return done(x, resub ? 'Resubmitted' : 'Submitted');
      }
    },

    review: {
      complete: x => done(x, x.payload.remarks || 'Requirement complete'),
      return: x => {
        const r = req(x.payload.reason, 'Enter the reason for return.'); if (r) return fail(r);
        x.p.returned = { by: x.userId, at: now(), reason: x.payload.reason, stage: x.a.stageName };
        return sendBack(x.state, x.p, x.a, 'A0201', x.payload.reason, x.userId);
      }
    },

    approval: {
      approve: x => {
        const { state, p, a, userId } = x;
        if (userId === p.requestorId) return fail('Segregation of duties: the requestor cannot approve their own purchase.');
        const l = p.approvals.find(v => v.level === a.approvalLevel);
        if (l) { audit(state, { userId, action: 'Approved', purchaseId: p.id, entity: 'Approval', entityId: a.id, field: `L${l.level} ${l.label}`, prev: l.status, next: 'Approved', note: x.payload.remarks }); Object.assign(l, { status: 'Approved', userId, at: now(), remarks: x.payload.remarks || null }); }
        if (p.approvals.every(v => v.status === 'Approved')) registerDoc(state, p, 'D03', `Approval_Record_${p.id}.pdf`, 'system');
        return done(x, x.payload.remarks);
      },
      reject: x => {
        const { state, p, a, userId } = x;
        const r = req(x.payload.remarks, 'Enter the reason for rejection.'); if (r) return fail(r);
        const l = p.approvals.find(v => v.level === a.approvalLevel);
        if (l) Object.assign(l, { status: 'Rejected', userId, at: now(), remarks: x.payload.remarks });
        a.status = 'Rejected'; a.completedAt = now(); a.completedBy = userId; a.remarks = x.payload.remarks;
        p.status = 'Rejected'; p.closedAt = now();
        refreshStages(state, p);
        audit(state, { userId, action: 'Rejected', purchaseId: p.id, entityId: p.id, field: 'status', prev: 'Open', next: 'Rejected', note: x.payload.remarks });
        notify(state, p.requestorId, 'returned', 'Purchase rejected', `${p.id} rejected: ${x.payload.remarks}`, p.id);
        return { ok: true, message: 'Purchase rejected' };
      },
      return: x => {
        const r = req(x.payload.remarks, 'Enter the reason for return.'); if (r) return fail(r);
        const l = x.p.approvals.find(v => v.level === x.a.approvalLevel);
        if (l) Object.assign(l, { status: 'Returned', userId: x.userId, at: now(), remarks: x.payload.remarks });
        x.p.returned = { by: x.userId, at: now(), reason: x.payload.remarks, stage: x.a.stageName };
        raiseException(x.state, { purchaseId: x.p.id, type: 'Returned to requestor', title: `Returned at ${x.a.name}`, description: x.payload.remarks, ownerUserId: x.p.requestorId, severity: 'Low', action: 'Revise and resubmit PR', key: `return:${x.p.id}` }, x.userId);
        const res = sendBack(x.state, x.p, x.a, 'A0201', x.payload.remarks, x.userId);
        x.p.approvals.forEach(v => { if (v.status === 'Returned') v.status = 'Pending'; });
        return res;
      },
      clarify: x => {
        const r = req(x.payload.question, 'Enter your question for the requestor.'); if (r) return fail(r);
        x.a.clarification = { question: x.payload.question, askedBy: x.userId, askedAt: now(), response: null, respondedAt: null };
        setWaiting(x.state, x.p, x.a, 'requestor');
        audit(x.state, { userId: x.userId, action: 'Clarification Requested', purchaseId: x.p.id, entity: 'Activity', entityId: x.a.id, note: x.payload.question });
        notify(x.state, x.p.requestorId, 'returned', 'Clarification requested', `${x.p.id}: ${x.payload.question}`, x.p.id);
        return { ok: true, message: 'Clarification requested from requestor' };
      }
    },

    sourcing: {
      complete: x => {
        const { state, p, userId, payload } = x;
        const ids = (payload.vendorIds || []).slice();
        if (payload.newVendor && payload.newVendor.name) {
          const nv = Object.assign({ id: 'V' + U.pad(M(state).vendors.length + 1, 3), categoryIds: [p.categoryId], city: '', gstin: '', pan: '', bank: '', msme: false, approved: false, rating: 0, contact: '', status: 'Active', onboarding: 'Pending KYC' }, payload.newVendor);
          M(state).vendors.push(nv);
          ids.push(nv.id);
          audit(state, { userId, action: 'Created', entity: 'Vendor', entityId: nv.id, purchaseId: p.id, note: `New vendor added during sourcing: ${nv.name}` });
        }
        if (!ids.length) return fail('Select at least one vendor.');
        p.sourcing = { vendorIds: U.uniq(ids), at: now(), by: userId };
        return done(x, `${ids.length} vendor(s) shortlisted`);
      }
    },

    rfq: {
      send: x => {
        const { state, p, a, userId, payload } = x;
        const ids = payload.vendorIds && payload.vendorIds.length ? payload.vendorIds : (p.sourcing ? p.sourcing.vendorIds : []);
        if (!ids.length) return fail('No vendors to send RFQ to.');
        const due = payload.dueDate || U.addDays(now(), 3, true);
        ids.forEach(vid => {
          if (p.rfqs.some(r => r.vendorId === vid && r.status !== 'Cancelled')) return;
          const r = { id: nextId(state, 'RFQ'), purchaseId: p.id, vendorId: vid, rfqDate: now(), dueDate: due, responseDate: null, status: 'Sent', followUps: [], docs: [`RFQ_${p.id}_${vid}.pdf`] };
          p.rfqs.push(r);
          audit(state, { userId, action: 'Created', entity: 'RFQ', entityId: r.id, purchaseId: p.id, note: `RFQ sent to ${vname(state, vid)}` });
        });
        registerDoc(state, p, 'D04', `RFQ_${p.id}.pdf`, userId);
        setWaiting(state, p, a, 'vendor');
        return { ok: true, message: `RFQ sent to ${ids.length} vendor(s)` };
      },
      followup: x => {
        const r = x.p.rfqs.find(v => v.id === x.payload.rfqId); if (!r) return fail('RFQ not found');
        r.followUps.push({ at: now(), by: x.userId, note: x.payload.note || '' });
        if (r.status === 'Sent') r.status = 'Waiting';
        audit(x.state, { userId: x.userId, action: 'Edited', entity: 'RFQ', entityId: r.id, purchaseId: x.p.id, field: 'follow-up', next: `Follow-up #${r.followUps.length}`, note: vname(x.state, r.vendorId) });
        return { ok: true, message: `Follow-up logged with ${vname(x.state, r.vendorId)}` };
      },
      received: x => {
        const r = x.p.rfqs.find(v => v.id === x.payload.rfqId); if (!r) return fail('RFQ not found');
        const prev = r.status; r.status = 'Received'; r.responseDate = x.payload.date || now();
        audit(x.state, { userId: x.userId, action: 'Status Changed', entity: 'RFQ', entityId: r.id, purchaseId: x.p.id, field: 'status', prev, next: 'Received', note: vname(x.state, r.vendorId) });
        if (x.p.rfqs.every(v => ['Received', 'Expired', 'Cancelled'].includes(v.status)) && x.a.status === 'Waiting') { x.a.status = 'In Progress'; x.a.waitingOn = null; }
        return { ok: true, message: `Response received from ${vname(x.state, r.vendorId)}` };
      },
      expire: x => H.rfq._status(x, 'Expired'),
      cancel: x => H.rfq._status(x, 'Cancelled'),
      _status: (x, st) => {
        const r = x.p.rfqs.find(v => v.id === x.payload.rfqId); if (!r) return fail('RFQ not found');
        const prev = r.status; r.status = st;
        audit(x.state, { userId: x.userId, action: 'Status Changed', entity: 'RFQ', entityId: r.id, purchaseId: x.p.id, field: 'status', prev, next: st });
        if (x.p.rfqs.every(v => ['Received', 'Expired', 'Cancelled'].includes(v.status)) && x.a.status === 'Waiting') { x.a.status = 'In Progress'; x.a.waitingOn = null; }
        return { ok: true };
      },
      complete: x => {
        if (!x.p.rfqs.some(r => r.status === 'Received')) return fail('At least one vendor response must be received before closing the RFQ round.');
        return done(x, `${x.p.rfqs.filter(r => r.status === 'Received').length} response(s) received`);
      }
    },

    quotation: {
      save: x => {
        const { state, p, userId, payload: q } = x;
        const e = req(q.vendorId, 'Select vendor') || (Number(q.amount) > 0 ? null : 'Enter quotation amount'); if (e) return fail(e);
        const amount = Number(q.amount), taxPct = Number(q.taxPct != null ? q.taxPct : 18);
        const tax = Math.round(amount * taxPct / 100);
        let rec = p.quotations.find(v => v.vendorId === q.vendorId);
        const fresh = !rec;
        if (!rec) { rec = { id: nextId(state, 'QTN'), purchaseId: p.id, vendorId: q.vendorId }; p.quotations.push(rec); }
        Object.assign(rec, {
          rfqId: (p.rfqs.find(r => r.vendorId === q.vendorId) || {}).id || null,
          date: q.date || now(), validityDays: Number(q.validityDays) || 30, amount, taxPct, tax, total: amount + tax,
          deliveryDays: Number(q.deliveryDays) || 0, paymentTerms: q.paymentTerms || '', warranty: q.warranty || '', commercialTerms: q.commercialTerms || '',
          specCompliance: q.specCompliance || 'Yes', fileName: q.fileName || null, status: 'Valid', recordedBy: userId, recordedAt: now()
        });
        const r = p.rfqs.find(v => v.vendorId === q.vendorId);
        if (r && r.status !== 'Received') { r.status = 'Received'; r.responseDate = r.responseDate || now(); }
        if (q.fileName) registerDoc(state, p, 'D05', q.fileName, userId);
        audit(state, { userId, action: fresh ? 'Created' : 'Edited', entity: 'Quotation', entityId: rec.id, purchaseId: p.id, field: 'total', next: U.fmt.inr(rec.total), note: vname(state, q.vendorId) });
        return { ok: true, message: `Quotation saved — ${vname(state, q.vendorId)} ${U.fmt.inr(rec.total)}` };
      },
      remove: x => {
        const i = x.p.quotations.findIndex(q => q.id === x.payload.quotationId); if (i < 0) return fail('Quotation not found');
        const q = x.p.quotations[i]; q.status = 'Withdrawn';
        audit(x.state, { userId: x.userId, action: 'Status Changed', entity: 'Quotation', entityId: q.id, purchaseId: x.p.id, field: 'status', prev: 'Valid', next: 'Withdrawn' });
        return { ok: true };
      },
      complete: x => {
        if (!x.p.quotations.some(q => q.status !== 'Withdrawn')) return fail('Record at least one quotation.');
        return done(x, `${x.p.quotations.filter(q => q.status !== 'Withdrawn').length} quotation(s) recorded`);
      }
    },

    comparison: {
      complete: x => {
        const { state, p, userId, payload } = x;
        const valid = p.quotations.filter(q => q.status !== 'Withdrawn');
        const single = !!p.flags.singleSource;
        const min = single ? 1 : Number(ruleParam(state, 'R03', 'minQuotes', 1));
        if (rule(state, 'R03') && valid.length < min) return fail(`Rule R03 — ${min} quotations required, ${valid.length} received. Comparison is blocked.`);
        if (single && !payload.justification) return fail('Single-source purchase: enter the single-source justification.');
        const rank = ranking(p);
        const rec = payload.recommendedVendorId || (rank[0] || {}).vendorId;
        if (rec !== (rank[0] || {}).vendorId && !payload.justification) return fail('The recommended vendor is not L1 — enter a justification.');
        p.comparison = { recommendedVendorId: rec, l1VendorId: (rank[0] || {}).vendorId, ranking: rank, justification: payload.justification || '', at: now(), by: userId };
        registerDoc(state, p, 'D06', `Comparison_${p.id}.pdf`, userId);
        audit(state, { userId, action: 'Edited', purchaseId: p.id, entity: 'Comparison', entityId: p.id, field: 'recommendation', next: vname(state, rec) });
        return done(x, `Recommended ${vname(state, rec)}`);
      }
    },

    tech_eval: {
      complete: x => {
        const { state, p, userId, payload } = x;
        const crit = payload.criteria || x.a.checklist.map(c => ({ name: c, ok: true, remark: '' }));
        const okAll = crit.every(c => c.ok);
        p.techEval = { criteria: crit, result: okAll ? 'Approved' : 'Not Approved', remarks: payload.remarks || '', at: now(), by: userId, vendorId: p.comparison && p.comparison.recommendedVendorId };
        audit(state, { userId, action: okAll ? 'Approved' : 'Rejected', purchaseId: p.id, entity: 'Technical Evaluation', entityId: x.a.id, next: p.techEval.result, note: payload.remarks });
        if (!okAll) return sendBack(state, p, x.a, 'A0801', 'Technical evaluation not approved: ' + crit.filter(c => !c.ok).map(c => c.name).join(', '), userId);
        return done(x, payload.remarks || 'Technically acceptable');
      }
    },

    selection: {
      complete: x => {
        const { state, p, userId, payload } = x;
        const vid = payload.vendorId || (p.comparison || {}).recommendedVendorId;
        if (!vid) return fail('Select a vendor.');
        const l1 = (ranking(p)[0] || {}).vendorId;
        const lowest = vid === l1;
        if (!lowest && rule(state, 'R11') && !payload.reason) return fail('Rule R11 — the lowest-price vendor is not selected. Enter the selection justification.');
        p.selection = { vendorId: vid, reason: payload.reason || (lowest ? 'Lowest evaluated price (L1)' : ''), lowestSelected: lowest, at: now(), by: userId, approverId: null, approvedAt: null };
        registerDoc(state, p, 'D07', `Vendor_Selection_${p.id}.pdf`, userId);
        audit(state, { userId, action: 'Edited', purchaseId: p.id, entity: 'Vendor Selection', entityId: p.id, field: 'vendor', next: vname(state, vid), note: lowest ? 'L1 selected' : 'Non-L1: ' + payload.reason });
        return done(x, `${vname(state, vid)} selected`);
      }
    },

    selection_approval: {
      approve: x => {
        x.p.selection.approverId = x.userId; x.p.selection.approvedAt = now();
        audit(x.state, { userId: x.userId, action: 'Approved', purchaseId: x.p.id, entity: 'Vendor Selection', entityId: x.p.id, note: x.payload.remarks });
        return done(x, x.payload.remarks);
      },
      return: x => {
        const r = req(x.payload.remarks, 'Enter the reason.'); if (r) return fail(r);
        return sendBack(x.state, x.p, x.a, 'A0901', x.payload.remarks, x.userId);
      }
    },

    po_create: {
      create: x => {
        const { state, p, userId, payload } = x;
        const q = selectedQuote(p) || {};
        const vid = (p.selection || {}).vendorId || q.vendorId;
        if (!vid) return fail('No vendor selected.');
        const qty = Number(payload.qty || p.qty) || 1;
        const unitPrice = Number(payload.unitPrice || (q.amount ? q.amount / (p.qty || 1) : p.estValue / qty));
        const taxPct = Number(payload.taxPct != null ? payload.taxPct : (q.taxPct != null ? q.taxPct : 18));
        const basic = Math.round(qty * unitPrice);
        const tax = Math.round(basic * taxPct / 100);
        const prevPo = p.po;
        p.po = {
          number: prevPo ? prevPo.number : nextId(state, 'PO'), vendorId: vid, qty, unitPrice, basic, taxPct, tax, total: basic + tax,
          deliveryDays: Number(payload.deliveryDays || q.deliveryDays || 15), paymentTerms: payload.paymentTerms || q.paymentTerms || '30 days from invoice',
          warranty: payload.warranty || q.warranty || '', validityDays: Number(payload.validityDays || 30), validUntil: U.addDays(now(), Number(payload.validityDays || 30), false),
          agreement: !!context(state, p).agreementRequired, status: 'Approval Pending', createdAt: prevPo ? prevPo.createdAt : now(), createdBy: userId,
          expectedDelivery: null, sentAt: null, acceptedAt: null, history: (prevPo ? prevPo.history : []).concat([{ status: 'Approval Pending', at: now(), by: userId }])
        };
        registerDoc(state, p, 'D08', `${p.po.number}.pdf`, userId);
        if (payload.agreementFileName) registerDoc(state, p, 'D09', payload.agreementFileName, userId);
        audit(state, { userId, action: prevPo ? 'Edited' : 'Created', entity: 'PO', entityId: p.po.number, purchaseId: p.id, field: 'total', prev: prevPo ? U.fmt.inr(prevPo.total) : null, next: U.fmt.inr(p.po.total), note: vname(state, vid) });
        return done(x, `${p.po.number} created`);
      }
    },

    po_approve: {
      approve: x => {
        const { state, p, userId } = x;
        if (p.po.createdBy === userId) return fail('Segregation of duties: the PO creator cannot approve the same PO.');
        poStatus(state, p, 'Approved', userId);
        return done(x, x.payload.remarks);
      },
      return: x => {
        const r = req(x.payload.remarks, 'Enter the reason.'); if (r) return fail(r);
        poStatus(x.state, x.p, 'Draft', x.userId);
        return sendBack(x.state, x.p, x.a, 'A1001', x.payload.remarks, x.userId);
      }
    },

    po_send: {
      send: x => {
        poStatus(x.state, x.p, 'Sent', x.userId); x.p.po.sentAt = now();
        setWaiting(x.state, x.p, x.a, 'vendor');
        return { ok: true, message: `${x.p.po.number} sent to ${vname(x.state, x.p.po.vendorId)}` };
      },
      accept: x => {
        if (x.p.po.status !== 'Sent') return fail('Send the PO before recording vendor acceptance.');
        poStatus(x.state, x.p, 'Vendor Accepted', x.userId); x.p.po.acceptedAt = x.payload.date || now();
        x.p.po.expectedDelivery = U.addDays(x.p.po.acceptedAt, x.p.po.deliveryDays, false);
        return done(x, 'Vendor accepted PO');
      }
    },

    advance_request: {
      submit: x => {
        const { state, p, userId, payload } = x;
        const pct = Number(payload.pct || p.flags.advancePct || 0);
        if (!(pct > 0 && pct <= 100)) return fail('Enter advance % between 1 and 100.');
        const r = req(payload.justification, 'Enter the business justification for the advance.'); if (r) return fail(r);
        const amount = Math.round(Number(payload.amount) || p.po.total * pct / 100);
        const settleDays = Number(payload.settlementDays || U.get(U.byId(M(state).settlementRules, 'SR-1') || {}, 'params.settlementDays', 30));
        const adv = {
          id: nextId(state, 'ADV'), purchaseId: p.id, poNumber: p.po.number, vendorId: p.po.vendorId, typeId: payload.typeId || p.flags.advanceTypeId || 'ADT-PART',
          pct, amount, justification: payload.justification, requestedBy: userId, requestedAt: now(),
          approval: null, verification: null, paidAmount: 0, paymentDate: null, paymentRef: null, paymentId: null,
          settlementDays: settleDays, settlementDueDate: null, adjustments: [], recoveries: [], ownerUserId: firstUserOfRole(state, 'finance'), status: 'Requested', overdueFlagged: false
        };
        state.advances.push(adv);
        p.advanceIds.push(adv.id);
        p.flags.advancePct = pct;
        registerDoc(state, p, 'D10', `Advance_Request_${adv.id}.pdf`, userId);
        if (payload.proformaFileName) registerDoc(state, p, 'D12', payload.proformaFileName, userId);
        audit(state, { userId, action: 'Created', entity: 'Advance', entityId: adv.id, purchaseId: p.id, field: 'amount', next: U.fmt.inr(amount), note: `${pct}% of ${p.po.number}` });
        return done(x, `${adv.id} requested`);
      }
    },

    advance_approve: {
      approve: x => {
        const adv = lastAdvance(x.state, x.p); if (!adv) return fail('No advance request.');
        if (adv.requestedBy === x.userId) return fail('Segregation of duties: the requester cannot approve the advance.');
        adv.approval = { status: 'Approved', by: x.userId, at: now(), remarks: x.payload.remarks || '' };
        advStatus(x.state, x.p, adv, 'Approved', x.userId);
        registerDoc(x.state, x.p, 'D11', `Advance_Approval_${adv.id}.pdf`, x.userId);
        return done(x, x.payload.remarks);
      },
      reject: x => {
        const { state, p, a, userId } = x;
        const r = req(x.payload.remarks, 'Enter the reason.'); if (r) return fail(r);
        const adv = lastAdvance(state, p); if (!adv) return fail('No advance request.');
        adv.approval = { status: 'Rejected', by: userId, at: now(), remarks: x.payload.remarks };
        advStatus(state, p, adv, 'Rejected', userId);
        // Advance not allowed → continue as a normal purchase (re-plan: direct Payment stage instead of advance stages)
        p.activities.filter(v => v.stageId === a.stageId && !DONE_STATES.includes(v.status)).forEach(v => { v.status = 'Skipped'; v.completedAt = now(); v.remarks = 'Advance rejected'; });
        a.status = 'Completed'; a.completedBy = userId; a.remarks = 'Advance rejected: ' + x.payload.remarks;
        p.documents.filter(d => d.stages.includes(a.stageId) && d.status === 'Missing').forEach(d => { d.status = 'Not Required'; });
        p.flags.advanceRequired = false;
        replan(state, p);
        refreshStages(state, p);
        activateNext(state, p);
        return { ok: true, message: 'Advance rejected — purchase continues without advance' };
      },
      return: x => {
        const r = req(x.payload.remarks, 'Enter the reason.'); if (r) return fail(r);
        const adv = lastAdvance(x.state, x.p);
        if (adv) { adv.status = 'Rejected'; adv.approval = { status: 'Returned', by: x.userId, at: now(), remarks: x.payload.remarks }; }
        return sendBack(x.state, x.p, x.a, 'A1101', x.payload.remarks, x.userId);
      }
    },

    advance_verify: {
      verify: x => {
        const adv = lastAdvance(x.state, x.p); if (!adv) return fail('No advance.');
        const ck = x.payload.checklist || {};
        const items = x.a.checklist;
        const missing = items.filter(c => ck[c] === false);
        if (missing.length) return fail('Verification incomplete: ' + missing.join(', '));
        adv.verification = { by: x.userId, at: now(), checklist: ck, remarks: x.payload.remarks || '' };
        advStatus(x.state, x.p, adv, 'Verified', x.userId);
        return done(x, 'Advance verified');
      },
      hold: x => { block(x.state, x.p, x.a, x.payload.reason || 'Advance verification on hold', x.userId); return { ok: true }; },
      resume: x => { unblock(x.state, x.p, x.a, x.userId); return { ok: true }; }
    },

    advance_pay: {
      pay: x => {
        const { state, p, userId, payload } = x;
        const adv = lastAdvance(state, p); if (!adv) return fail('No advance.');
        const e = req(payload.utr, 'Enter the UTR / payment reference.'); if (e) return fail(e);
        const date = payload.date || now();
        const pay = newPayment(state, p, { type: 'Advance', advanceId: adv.id, amount: adv.amount, date, mode: payload.mode, bank: payload.bank, utr: payload.utr, status: 'Paid' }, userId);
        adv.paidAmount = adv.amount; adv.paymentDate = date; adv.paymentRef = payload.utr; adv.paymentId = pay.id;
        adv.settlementDueDate = U.addDays(date, adv.settlementDays, false);
        advStatus(state, p, adv, 'Outstanding', userId);
        registerDoc(state, p, 'D13', `Advance_Payment_${pay.id}.pdf`, userId);
        return done(x, `${U.fmt.inr(adv.amount)} advance paid — outstanding until adjusted`);
      }
    },

    delivery: {
      update: x => {
        const prev = x.p.po.expectedDelivery; x.p.po.expectedDelivery = x.payload.expectedDate;
        audit(x.state, { userId: x.userId, action: 'Edited', entity: 'PO', entityId: x.p.po.number, purchaseId: x.p.id, field: 'expected delivery', prev: U.fmt.date(prev), next: U.fmt.date(x.payload.expectedDate) });
        return { ok: true };
      },
      delay: x => {
        const { state, p, a, userId, payload } = x;
        const r = req(payload.reason, 'Enter the delay reason.'); if (r) return fail(r);
        const prev = p.po.expectedDelivery;
        if (payload.newDate) p.po.expectedDelivery = payload.newDate;
        raiseException(state, { purchaseId: p.id, type: 'Vendor delay', title: `Delivery delayed — ${vname(state, p.po.vendorId)}`, description: payload.reason, ownerUserId: p.buyerId, severity: 'Medium', action: 'Follow up with vendor on revised date', key: `delay:${p.id}`, activityId: a.id }, userId);
        audit(state, { userId, action: 'Edited', entity: 'PO', entityId: p.po.number, purchaseId: p.id, field: 'expected delivery', prev: U.fmt.date(prev), next: U.fmt.date(p.po.expectedDelivery), note: payload.reason });
        if (payload.newDate) a.dueAt = U.endOfBusiness(payload.newDate);
        setWaiting(state, p, a, 'vendor', `Follow up revised delivery (${U.fmt.dateShort(p.po.expectedDelivery)})`);
        return { ok: true, message: 'Delay recorded and exception raised' };
      },
      record: x => {
        const { state, p, a, userId, payload } = x;
        const isSvc = context(state, p).categoryType === 'service';
        const qty = Number(payload.qty != null ? payload.qty : p.po.qty);
        const date = payload.actualDate || now();
        const expected = p.po.expectedDelivery || date;
        const grace = Number(ruleParam(state, 'R10', 'graceDays', 0));
        const delayDays = Math.max(0, U.daysBetween(expected, date) - grace);
        const prior = U.sum(p.deliveries, d => d.qty);
        const cumulative = prior + qty;
        const shortage = Math.max(0, p.po.qty - cumulative);
        const rejection = Number(payload.rejection) || 0;
        const dl = {
          id: U.uid('DLV'), date, expectedDate: expected, qty, quality: payload.quality || 'OK', specOk: payload.specOk !== false,
          note: payload.deliveryNote || '', fileName: payload.fileName || null, rejection, shortage: payload.partial ? 0 : shortage,
          late: delayDays > 0, delayDays, remarks: payload.remarks || '', by: userId, service: isSvc
        };
        p.deliveries.push(dl);
        if (payload.fileName) registerDoc(state, p, 'D14', payload.fileName, userId);
        audit(state, { userId, action: 'Created', entity: 'Delivery', entityId: dl.id, purchaseId: p.id, field: 'quantity', next: `${qty}`, note: dl.late ? `Late by ${delayDays} day(s)` : 'On time' });
        if (dl.late && rule(state, 'R10')) {
          const ex = raiseException(state, { purchaseId: p.id, type: 'Vendor delay', title: `Delivered ${delayDays} day(s) late — ${vname(state, p.po.vendorId)}`, description: 'Rule R10 late delivery', ownerUserId: p.buyerId, severity: 'Low', action: 'Record in vendor performance', key: `late:${p.id}:${dl.id}` }, 'system');
          if (ex) updateException(state, ex.id, { status: 'Resolved', resolution: 'Material received late; captured in vendor performance' }, 'system');
        }
        resolveExceptionsByKey(state, `delay:${p.id}`, 'Material delivered', userId);
        resolveExceptionsByKey(state, `latedue:${p.id}`, 'Material delivered', userId);
        if (rejection > 0 || !dl.specOk) raiseException(state, { purchaseId: p.id, type: 'Quantity mismatch', title: `${rejection} rejected at receipt`, description: payload.remarks || 'Quality / specification issue', ownerUserId: p.buyerId, severity: 'Medium', action: 'Arrange replacement or debit note', key: `reject:${p.id}:${dl.id}` }, userId);
        if (payload.partial && cumulative < p.po.qty) {
          poStatus(state, p, 'Partially Completed', userId);
          setWaiting(state, p, a, 'vendor', `Awaiting balance ${p.po.qty - cumulative} ${p.uom}`);
          return { ok: true, message: `Partial delivery recorded — balance ${p.po.qty - cumulative} pending` };
        }
        return done(x, dl.late ? `Delivered late by ${delayDays} day(s)` : 'Delivered on time');
      }
    },

    grn: {
      create: x => {
        const { state, p, userId, payload } = x;
        const isSvc = context(state, p).categoryType === 'service';
        const delivered = U.sum(p.deliveries, d => d.qty) || p.po.qty;
        const qty = Number(payload.qty != null ? payload.qty : delivered);
        const rejectedQty = Number(payload.rejectedQty) || 0;
        const acceptedQty = Number(payload.acceptedQty != null ? payload.acceptedQty : qty - rejectedQty);
        if (acceptedQty + rejectedQty !== qty) return fail('Accepted + rejected quantity must equal received quantity.');
        const g = { id: U.uid('GRN'), number: nextId(state, isSvc ? 'SC' : 'GRN'), type: isSvc ? 'Service Confirmation' : 'GRN', poNumber: p.po.number, receiptDate: payload.receiptDate || now(), qty, acceptedQty, rejectedQty, remarks: payload.remarks || '', fileName: payload.fileName || null, by: userId };
        p.grns.push(g);
        registerDoc(state, p, isSvc ? 'D16' : 'D15', `${g.number}.pdf`, userId);
        poStatus(state, p, U.sum(p.grns, v => v.acceptedQty) >= p.po.qty ? 'Completed' : 'Partially Completed', userId);
        audit(state, { userId, action: 'Created', entity: g.type, entityId: g.number, purchaseId: p.id, field: 'accepted qty', next: `${acceptedQty}/${qty}` });
        return done(x, `${g.number} created`);
      }
    },

    invoice: {
      record: x => {
        const { state, p, userId, payload } = x;
        const e = req(payload.number, 'Enter the vendor invoice number.'); if (e) return fail(e);
        if (p.invoices.some(i => i.number === payload.number)) return fail('Duplicate invoice number for this vendor — possible double billing.');
        const qty = Number(payload.qty != null ? payload.qty : U.sum(p.grns, g => g.acceptedQty));
        const value = Number(payload.value != null ? payload.value : Math.round(qty * p.po.unitPrice));
        const taxPct = Number(payload.taxPct != null ? payload.taxPct : p.po.taxPct);
        const tax = Number(payload.tax != null ? payload.tax : Math.round(value * taxPct / 100));
        const inv = {
          id: nextId(state, 'INV'), number: payload.number, date: payload.date || now(), vendorId: p.po.vendorId, poNumber: p.po.number,
          qty, value, taxPct, tax, total: value + tax, dueDate: payload.dueDate || U.addDays(payload.date || now(), 30, false), receivedDate: payload.receivedDate || now(),
          status: 'Received', fileName: payload.fileName || null, paidAmount: 0, adjustedAmount: 0, verification: null, history: []
        };
        p.invoices.push(inv);
        if (payload.fileName) registerDoc(state, p, 'D17', payload.fileName, userId);
        audit(state, { userId, action: 'Created', entity: 'Invoice', entityId: inv.id, purchaseId: p.id, field: 'total', next: U.fmt.inr(inv.total), note: inv.number });
        if (payload.partial) return { ok: true, message: `${inv.number} recorded — more invoices expected` };
        return done(x, `${p.invoices.length} invoice(s) recorded`);
      }
    },

    invoice_verify: {
      verify: x => {
        const ck = x.payload.checklist || {};
        const missing = x.a.checklist.filter(c => ck[c] === false);
        if (missing.length) return fail('Verification failed: ' + missing.join(', ') + '. Put the invoice on hold instead.');
        x.p.invoices.forEach(i => { if (i.status === 'Received' || i.status === 'On Hold') { invStatus(x.state, x.p, i, 'Verified', x.userId); i.verification = { by: x.userId, at: now(), checklist: ck, remarks: x.payload.remarks || '' }; } });
        resolveExceptionsByKey(x.state, `invhold:${x.p.id}`, 'Invoice verified', x.userId);
        return done(x, 'Invoice verified');
      },
      hold: x => {
        const r = req(x.payload.reason, 'Enter the hold reason.'); if (r) return fail(r);
        x.p.invoices.forEach(i => { if (i.status === 'Received') invStatus(x.state, x.p, i, 'On Hold', x.userId); });
        raiseException(x.state, { purchaseId: x.p.id, type: x.payload.type || 'Invoice mismatch', title: 'Invoice on hold', description: x.payload.reason, ownerUserId: x.p.buyerId, severity: 'Medium', action: 'Obtain corrected invoice / documents from vendor', key: `invhold:${x.p.id}`, activityId: x.a.id }, x.userId);
        block(x.state, x.p, x.a, 'Invoice on hold: ' + x.payload.reason, x.userId);
        return { ok: true, message: 'Invoice put on hold — exception raised' };
      },
      resume: x => { unblock(x.state, x.p, x.a, x.userId); return { ok: true }; }
    },

    match: {
      run: x => {
        const { state, p, a, userId } = x;
        const m = matchResult(state, p);
        p.match = Object.assign({}, p.match || {}, { result: m.ok ? 'Matched' : 'Exception', lines: m.lines, at: now(), by: userId, tolerancePct: m.tolerancePct });
        audit(state, { userId, action: 'Status Changed', entity: '3-Way Match', entityId: p.id, purchaseId: p.id, field: 'result', next: p.match.result });
        if (m.ok) {
          p.invoices.forEach(i => invStatus(state, p, i, 'Matched', userId));
          resolveExceptionsByKey(state, `match:${p.id}`, 'Re-match passed', userId);
          return done(x, m.accepted ? 'Matched with approved variance' : 'PO ↔ GRN ↔ Invoice matched');
        }
        p.invoices.forEach(i => invStatus(state, p, i, 'Mismatch', userId));
        if (rule(state, 'R04')) {
          m.lines.filter(l => !l.ok).forEach(l => {
            const type = l.key === 'quantity' ? 'Quantity mismatch' : l.key === 'price' ? 'Price mismatch' : l.key === 'tax' ? 'Tax mismatch' : 'Invoice mismatch';
            raiseException(state, { purchaseId: p.id, type, title: `${type} — ${p.id}`, description: l.detail, ownerUserId: a.ownerUserId, severity: 'High', action: 'Obtain credit note / revised invoice, or approve variance', key: `match:${p.id}:${l.key}`, activityId: a.id }, 'system');
          });
        }
        block(state, p, a, '3-way match exception: ' + m.lines.filter(l => !l.ok).map(l => l.label).join(', '), 'system');
        return { ok: true, message: '3-way match failed — exception created, payment blocked', mismatch: true };
      },
      resolve: x => {
        const { state, p, a, userId, payload } = x;
        const inv = p.invoices.find(i => i.id === payload.invoiceId) || p.invoices[p.invoices.length - 1];
        if (!inv) return fail('No invoice.');
        if (payload.resolution === 'accept_variance') {
          const r = req(payload.remarks, 'Enter the reason for accepting the variance.'); if (r) return fail(r);
          if (u(state, userId).roleId !== 'finance') return fail('Only Finance can approve a 3-way match variance.');
          p.match = Object.assign({}, p.match, { acceptedVariance: { by: userId, at: now(), remarks: payload.remarks } });
        } else {
          const before = `${inv.qty} × ${U.fmt.inr(inv.value)} + ${U.fmt.inr(inv.tax)}`;
          if (payload.qty != null) inv.qty = Number(payload.qty);
          if (payload.value != null) inv.value = Number(payload.value);
          if (payload.taxPct != null) inv.taxPct = Number(payload.taxPct);
          inv.tax = Math.round(inv.value * inv.taxPct / 100);
          inv.total = inv.value + inv.tax;
          if (payload.resolution === 'revised_invoice' && payload.number) inv.number = payload.number;
          inv.history.push({ at: now(), by: userId, type: payload.resolution, before, note: payload.remarks || '' });
          audit(state, { userId, action: 'Edited', entity: 'Invoice', entityId: inv.id, purchaseId: p.id, field: payload.resolution === 'credit_note' ? 'credit note' : 'revised invoice', prev: before, next: `${inv.qty} × ${U.fmt.inr(inv.value)} + ${U.fmt.inr(inv.tax)}`, note: payload.remarks });
        }
        unblock(state, p, a, userId);
        return H.match.run(x);
      }
    },

    payment_approval: {
      approve: x => {
        const { state, p, userId, payload } = x;
        const out = vendorOutstanding(state, p.po.vendorId, null);
        if (rule(state, 'R02') && out > 0 && !payload.acknowledgeAdvance) return fail(`Rule R02 — existing advance of ${U.fmt.inr(out)} outstanding with ${vname(state, p.po.vendorId)}. Acknowledge it before approving.`);
        const it = invoiceTotals(p);
        const ownAdv = purchaseAdvanceOutstanding(state, p);
        const proposed = Math.max(0, it.balance - Math.min(ownAdv, it.balance));
        p.paymentApproval = { by: userId, at: now(), invoiceTotal: it.total, advanceOutstanding: out, adjustPlanned: Math.min(ownAdv, it.balance), proposedAmount: proposed, remarks: payload.remarks || '' };
        audit(state, { userId, action: 'Approved', purchaseId: p.id, entity: 'Payment Proposal', entityId: p.id, field: 'amount', next: U.fmt.inr(proposed), note: out > 0 ? `Advance outstanding ${U.fmt.inr(out)} acknowledged` : '' });
        return done(x, `Payment of ${U.fmt.inr(proposed)} approved`);
      },
      return: x => {
        const r = req(x.payload.remarks, 'Enter the reason.'); if (r) return fail(r);
        return sendBack(x.state, x.p, x.a, 'A1501', x.payload.remarks, x.userId);
      }
    },

    payment: {
      pay: x => payInvoices(x, 'Invoice'),
      confirm: x => confirmPayment(x),
      fail: x => failPayment(x)
    },

    adjustment: {
      adjust: x => {
        const { state, p, userId, payload } = x;
        const adv = advance(state, payload.advanceId) || lastAdvance(state, p); if (!adv) return fail('No advance to adjust.');
        const inv = p.invoices.find(i => i.id === payload.invoiceId) || p.invoices.find(i => i.total - i.paidAmount - i.adjustedAmount > 0);
        if (!inv) return fail('No invoice with an open balance.');
        const out = advanceOutstanding(adv);
        const open = inv.total - inv.paidAmount - inv.adjustedAmount;
        const amt = Math.round(Number(payload.amount != null ? payload.amount : Math.min(out, open)));
        if (!(amt > 0)) return fail('Adjustment amount must be greater than zero.');
        if (amt > out) return fail(`Cannot adjust more than the outstanding advance (${U.fmt.inr(out)}).`);
        if (amt > open) return fail(`Cannot adjust more than the invoice open balance (${U.fmt.inr(open)}).`);
        adv.adjustments.push({ id: U.uid('ADJ'), invoiceId: inv.id, invoiceNumber: inv.number, purchaseId: p.id, amount: amt, at: now(), by: userId, remarks: payload.remarks || '' });
        inv.adjustedAmount += amt;
        const prevStatus = adv.status;
        refreshAdvanceStatus(adv);
        registerDoc(state, p, 'D19', `Adjustment_${adv.id}_${inv.number.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`, userId);
        audit(state, { userId, action: 'Advance Adjusted', entity: 'Advance', entityId: adv.id, purchaseId: p.id, field: 'outstanding', prev: U.fmt.inr(out), next: U.fmt.inr(advanceOutstanding(adv)), note: `${U.fmt.inr(amt)} against ${inv.number}` });
        if (prevStatus !== adv.status) audit(state, { userId, action: 'Status Changed', entity: 'Advance', entityId: adv.id, purchaseId: p.id, field: 'status', prev: prevStatus, next: adv.status });
        if (advanceOutstanding(adv) <= 0) resolveExceptionsByKey(state, `advdue:${adv.id}`, 'Advance fully adjusted', userId);
        return { ok: true, message: `${U.fmt.inr(amt)} adjusted against ${inv.number}. Outstanding advance: ${U.fmt.inr(advanceOutstanding(adv))}` };
      },
      complete: x => {
        const adj = (x.p.advanceIds || []).map(id => advance(x.state, id)).filter(Boolean).some(a => (a.adjustments || []).some(j => j.purchaseId === x.p.id));
        const anyOut = purchaseAdvanceOutstanding(x.state, x.p) > 0;
        if (!adj && anyOut && invoiceTotals(x.p).balance > 0) return fail('Adjust the advance against the invoice first.');
        return done(x, 'Advance adjustment completed');
      }
    },

    balance_payment: {
      pay: x => payInvoices(x, 'Balance'),
      confirm: x => confirmPayment(x),
      fail: x => failPayment(x),
      recover: x => {
        const { state, p, userId, payload } = x;
        const adv = lastAdvance(state, p); if (!adv) return fail('No advance.');
        const out = advanceOutstanding(adv);
        const amt = Math.round(Number(payload.amount != null ? payload.amount : out));
        if (!(amt > 0) || amt > out) return fail(`Recovery must be between ₹1 and ${U.fmt.inr(out)}.`);
        const ref = payload.ref || ''; if (!ref) return fail('Enter the recovery reference (receipt / credit note).');
        adv.recoveries.push({ id: U.uid('REC'), amount: amt, at: now(), by: userId, mode: payload.mode || 'Bank receipt', ref, remarks: payload.remarks || '' });
        const prevStatus = adv.status;
        refreshAdvanceStatus(adv);
        audit(state, { userId, action: 'Advance Adjusted', entity: 'Advance', entityId: adv.id, purchaseId: p.id, field: 'recovered', prev: U.fmt.inr(out), next: U.fmt.inr(advanceOutstanding(adv)), note: `Recovered ${U.fmt.inr(amt)} (${ref})` });
        if (prevStatus !== adv.status) audit(state, { userId, action: 'Status Changed', entity: 'Advance', entityId: adv.id, purchaseId: p.id, field: 'status', prev: prevStatus, next: adv.status });
        if (advanceOutstanding(adv) <= 0) resolveExceptionsByKey(state, `advdue:${adv.id}`, 'Advance recovered', userId);
        return { ok: true, message: `${U.fmt.inr(amt)} recovered from vendor` };
      },
      complete: x => {
        const it = invoiceTotals(x.p);
        if (it.balance > 0) return fail(`Balance of ${U.fmt.inr(it.balance)} is still payable.`);
        if (!x.p.paymentIds.some(id => { const py = x.state.payments.find(v => v.id === id); return py && py.type === 'Balance' && py.status === 'Paid'; })) {
          registerDoc(x.state, x.p, 'D18', null, x.userId, 'Not Required');
        }
        return done(x, purchaseAdvanceOutstanding(x.state, x.p) > 0 ? 'No balance payable — excess advance outstanding' : 'Settled — no balance payable');
      }
    },

    closure: {
      close: x => {
        const { state, p, userId } = x;
        const checks = closureChecks(state, p);
        const bad = checks.filter(c => !c.ok);
        if (bad.length) return fail('Cannot close: ' + bad.map(c => `${c.label} (${c.detail})`).join('; '));
        const r = done(x, x.payload.remarks || 'Closed');
        if (!r.ok) return r;
        p.status = 'Closed'; p.closedAt = now();
        if (p.po) poStatus(state, p, 'Completed', userId);
        (p.advanceIds || []).map(id => advance(state, id)).filter(Boolean).forEach(adv => { if (advanceOutstanding(adv) <= 0 && adv.status !== 'Rejected') advStatus(state, p, adv, 'Closed', userId); });
        audit(state, { userId, action: 'Closed', purchaseId: p.id, entityId: p.id, field: 'status', prev: 'Open', next: 'Closed' });
        notify(state, p.requestorId, 'completion', 'Purchase closed', `${p.id} · ${p.title} is closed`, p.id);
        return { ok: true, message: `${p.id} closed` };
      }
    },

    task: {
      complete: x => done(x, x.payload.remarks)
    }
  };

  const u = (state, id) => user(state, id) || {};
  function lastAdvance(state, p) { return (p.advanceIds || []).map(id => advance(state, id)).filter(a => a && a.status !== 'Rejected').pop() || null; }
  function poStatus(state, p, st, userId) {
    if (!p.po || p.po.status === st) return;
    const prev = p.po.status; p.po.status = st; p.po.history.push({ status: st, at: now(), by: userId });
    audit(state, { userId, action: 'Status Changed', entity: 'PO', entityId: p.po.number, purchaseId: p.id, field: 'status', prev, next: st });
  }
  function advStatus(state, p, adv, st, userId) {
    const prev = adv.status; adv.status = st;
    audit(state, { userId, action: 'Status Changed', entity: 'Advance', entityId: adv.id, purchaseId: p.id, field: 'status', prev, next: st });
  }
  function invStatus(state, p, inv, st, userId) {
    if (inv.status === st) return;
    const prev = inv.status; inv.status = st;
    audit(state, { userId, action: 'Status Changed', entity: 'Invoice', entityId: inv.id, purchaseId: p.id, field: 'status', prev, next: st, note: inv.number });
  }
  function newPayment(state, p, o, userId) {
    const pay = Object.assign({ id: nextId(state, 'PAY'), purchaseId: p.id, poNumber: p.po ? p.po.number : null, invoiceIds: [], advanceId: null, vendorId: p.po ? p.po.vendorId : null, date: now(), bank: 'HDFC Bank — Current A/c ••••0021', mode: 'NEFT', utr: '', proof: null, status: 'Paid', createdBy: userId, history: [] }, o);
    pay.proof = pay.proof || `Payment_Advice_${pay.id}.pdf`;
    pay.history.push({ status: pay.status, at: now(), by: userId });
    state.payments.push(pay);
    p.paymentIds.push(pay.id);
    audit(state, { userId, action: 'Payment Made', entity: 'Payment', entityId: pay.id, purchaseId: p.id, field: pay.type, next: `${U.fmt.inr(pay.amount)} · ${pay.status}`, note: pay.utr });
    return pay;
  }
  function payInvoices(x, type) {
    const { state, p, a, userId, payload } = x;
    const it = invoiceTotals(p);
    if (it.balance <= 0) return fail('Nothing payable — invoice balance is zero.');
    const status = payload.status === 'Processing' ? 'Processing' : 'Paid';
    if (status === 'Paid' && !payload.utr) return fail('Enter the UTR / bank reference.');
    let pay = p.paymentIds.map(id => state.payments.find(v => v.id === id)).find(v => v && v.type === type && (v.status === 'Failed' || v.status === 'Processing'));
    if (pay) {
      const prev = pay.status; pay.status = status; pay.utr = payload.utr || pay.utr; pay.date = payload.date || now(); pay.mode = payload.mode || pay.mode; pay.history.push({ status, at: now(), by: userId });
      audit(state, { userId, action: 'Status Changed', entity: 'Payment', entityId: pay.id, purchaseId: p.id, field: 'status', prev, next: status });
    } else {
      pay = newPayment(state, p, { type, amount: it.balance, invoiceIds: p.invoices.map(i => i.id), date: payload.date || now(), mode: payload.mode || 'NEFT', bank: payload.bank, utr: payload.utr || '', status }, userId);
    }
    resolveExceptionsByKey(state, `payfail:${p.id}`, 'Payment re-processed', userId);
    unblock(state, p, a, userId);
    if (status === 'Processing') { setWaiting(state, p, a, 'bank', 'Confirm bank credit / UTR'); return { ok: true, message: 'Payment sent to bank — processing' }; }
    return settle(x, pay);
  }
  function settle(x, pay) {
    const { state, p, userId } = x;
    let left = pay.amount;
    p.invoices.forEach(i => { const open = i.total - i.paidAmount - i.adjustedAmount; const take = Math.min(open, left); if (take > 0) { i.paidAmount += take; left -= take; } if (i.total - i.paidAmount - i.adjustedAmount <= 0) invStatus(state, p, i, 'Paid', userId); });
    registerDoc(state, p, 'D18', pay.proof, userId);
    return done(x, `${U.fmt.inr(pay.amount)} paid · ${pay.utr}`);
  }
  function confirmPayment(x) {
    const pay = x.p.paymentIds.map(id => x.state.payments.find(v => v.id === id)).find(v => v && v.status === 'Processing');
    if (!pay) return fail('No payment in processing.');
    const e = req(x.payload.utr || pay.utr, 'Enter the UTR.'); if (e) return fail(e);
    pay.utr = x.payload.utr || pay.utr; pay.status = 'Paid'; pay.history.push({ status: 'Paid', at: now(), by: x.userId });
    audit(x.state, { userId: x.userId, action: 'Status Changed', entity: 'Payment', entityId: pay.id, purchaseId: x.p.id, field: 'status', prev: 'Processing', next: 'Paid', note: pay.utr });
    x.a.status = 'In Progress'; x.a.waitingOn = null;
    return settle(x, pay);
  }
  function failPayment(x) {
    const { state, p, a, userId, payload } = x;
    const r = req(payload.reason, 'Enter the failure reason.'); if (r) return fail(r);
    let pay = p.paymentIds.map(id => state.payments.find(v => v.id === id)).find(v => v && v.status === 'Processing');
    if (!pay) pay = newPayment(state, p, { type: a.actionType === 'balance_payment' ? 'Balance' : 'Invoice', amount: invoiceTotals(p).balance, invoiceIds: p.invoices.map(i => i.id), status: 'Failed', utr: '' }, userId);
    else { pay.status = 'Failed'; pay.history.push({ status: 'Failed', at: now(), by: userId }); }
    pay.failureReason = payload.reason;
    raiseException(state, { purchaseId: p.id, type: 'Payment failure', title: `Payment ${pay.id} failed`, description: payload.reason, ownerUserId: a.ownerUserId, severity: 'High', action: 'Correct bank details and re-process', key: `payfail:${p.id}` }, userId);
    block(state, p, a, 'Payment failed: ' + payload.reason, userId);
    return { ok: true, message: 'Payment marked failed — exception raised' };
  }

  /* =================================================================
     GENERIC PURCHASE-LEVEL OPS (not tied to the current step type)
     ================================================================= */
  const G = {
    comment: x => {
      const t = (x.payload.text || '').trim(); if (!t) return fail('Write a comment.');
      x.p.comments.push({ id: U.uid('C'), userId: x.userId, t: now(), text: t });
      audit(x.state, { userId: x.userId, action: 'Commented', purchaseId: x.p.id, entityId: x.p.id, note: t.slice(0, 120) });
      return { ok: true };
    },
    upload_doc: x => {
      const d = registerDoc(x.state, x.p, x.payload.docId, x.payload.fileName, x.userId);
      return d ? { ok: true, message: `${d.name} uploaded` } : fail('Document not applicable to this purchase.');
    },
    verify_doc: x => {
      const d = x.p.documents.find(v => v.docId === x.payload.docId);
      if (!d || d.status === 'Missing') return fail('Upload the document first.');
      const prev = d.status; d.status = 'Verified'; d.verifiedAt = now(); d.verifiedBy = x.userId;
      audit(x.state, { userId: x.userId, action: 'Status Changed', entity: 'Document', entityId: d.docId, purchaseId: x.p.id, field: d.name, prev, next: 'Verified' });
      return { ok: true };
    },
    reassign: x => {
      const a = x.p.activities.find(v => v.id === x.payload.activityId) || currentActivity(x.p);
      const to = user(x.state, x.payload.userId);
      if (!a || !to) return fail('Select a user.');
      if (a.approval && to.id === x.p.requestorId) return fail('Segregation of duties: cannot assign an approval to the requestor.');
      const prev = a.ownerUserId; a.ownerUserId = to.id; a.reassigned = true;
      audit(x.state, { userId: x.userId, action: 'Reassigned', entity: 'Activity', entityId: a.id, purchaseId: x.p.id, field: 'owner', prev: userName(x.state, prev), next: to.name, note: x.payload.reason });
      notify(x.state, to.id, 'activity_assigned', 'Activity reassigned to you', `${a.name} — ${x.p.id}`, x.p.id);
      return { ok: true, message: `Reassigned to ${to.name}` };
    },
    hold: x => {
      const r = req(x.payload.reason, 'Enter the hold reason.'); if (r) return fail(r);
      const a = currentActivity(x.p); x.p.status = 'On Hold';
      if (a) block(x.state, x.p, a, 'On hold: ' + x.payload.reason, x.userId);
      audit(x.state, { userId: x.userId, action: 'Status Changed', purchaseId: x.p.id, entityId: x.p.id, field: 'status', prev: 'Open', next: 'On Hold', note: x.payload.reason });
      return { ok: true };
    },
    resume: x => {
      if (x.p.status !== 'On Hold') return fail('Purchase is not on hold.');
      x.p.status = 'Open'; const a = currentActivity(x.p); if (a) unblock(x.state, x.p, a, x.userId);
      audit(x.state, { userId: x.userId, action: 'Status Changed', purchaseId: x.p.id, entityId: x.p.id, field: 'status', prev: 'On Hold', next: 'Open' });
      return { ok: true };
    },
    cancel: x => {
      const r = req(x.payload.reason, 'Enter the cancellation reason.'); if (r) return fail(r);
      if (x.p.po && ['Sent', 'Vendor Accepted', 'Partially Completed', 'Completed'].includes(x.p.po.status)) return fail('PO already issued — cancel the PO with the vendor first.');
      const prev = x.p.status; x.p.status = 'Cancelled'; x.p.closedAt = now();
      const a = currentActivity(x.p); if (a) { a.status = 'Rejected'; a.remarks = 'Cancelled: ' + x.payload.reason; }
      audit(x.state, { userId: x.userId, action: 'Status Changed', purchaseId: x.p.id, entityId: x.p.id, field: 'status', prev, next: 'Cancelled', note: x.payload.reason });
      return { ok: true };
    },
    clarify_response: x => {
      const a = currentActivity(x.p);
      if (!a || !a.clarification || a.clarification.response) return fail('No open clarification.');
      const r = req(x.payload.response, 'Enter your response.'); if (r) return fail(r);
      a.clarification.response = x.payload.response; a.clarification.respondedAt = now();
      a.status = 'In Progress'; a.waitingOn = null;
      audit(x.state, { userId: x.userId, action: 'Clarification Provided', purchaseId: x.p.id, entity: 'Activity', entityId: a.id, note: x.payload.response });
      notify(x.state, a.ownerUserId, 'activity_assigned', 'Clarification answered', `${x.p.id}: ${x.payload.response}`, x.p.id);
      return { ok: true };
    },
    /** Edit PR fields while the PR is with the requestor (draft / returned). Re-plans approvals and stages. */
    edit: x => {
      const a = currentActivity(x.p);
      if (x.userId !== x.p.requestorId && !hasPerm(x.state, x.u, ['admin'])) return fail('Only the requestor can edit the PR.');
      if (!(x.p.status === 'Draft' || (a && a.actionType === 'pr_submit'))) return fail('The PR can be edited only while it is with the requestor.');
      const fields = ['title', 'description', 'specification', 'categoryId', 'deptId', 'costCentreId', 'qty', 'uom', 'estValue', 'requiredBy', 'priority', 'justification', 'budgetAvailable'];
      fields.forEach(k => {
        if (x.payload[k] === undefined) return;
        const nv = ['qty', 'estValue'].includes(k) ? Number(x.payload[k]) : x.payload[k];
        if (x.p[k] !== nv) { audit(x.state, { userId: x.userId, action: 'Edited', purchaseId: x.p.id, entityId: x.p.id, field: k, prev: x.p[k], next: nv }); x.p[k] = nv; }
      });
      if (x.payload.flags) Object.keys(x.payload.flags).forEach(k => {
        if (x.p.flags[k] !== x.payload.flags[k]) { audit(x.state, { userId: x.userId, action: 'Edited', purchaseId: x.p.id, entityId: x.p.id, field: 'flags.' + k, prev: x.p.flags[k], next: x.payload.flags[k] }); x.p.flags[k] = x.payload.flags[k]; }
      });
      replan(x.state, x.p);
      return { ok: true, message: 'PR updated' };
    }
  };

  /**
   * act(state, purchaseId, activityId, op, payload, userId)
   * - Generic ops (G): comment, upload_doc, verify_doc, reassign, hold, resume, cancel, clarify_response, edit
   * - 'submit': submits a Draft / returned PR
   * - Otherwise op is dispatched to the handler of the CURRENT activity's actionType.
   *   Pass activityId to guard against acting on a stale screen.
   */
  function act(state, purchaseId, activityId, op, payload, userId) {
    const p = purchase(state, purchaseId);
    if (!p) return fail('Purchase not found.');
    const usr = user(state, userId);
    if (!usr) return fail('Unknown user.');
    const x = { state, p, a: null, payload: payload || {}, userId, u: usr };
    if (G[op]) {
      if (['hold', 'resume', 'reassign'].includes(op) && !hasPerm(state, usr, ['admin', 'procure', 'finance']) && usr.id !== deptHeadFor(state, p.deptId)) return fail('You do not have permission for this action.');
      if (op === 'cancel' && usr.id !== p.requestorId && !hasPerm(state, usr, ['admin', 'procure'])) return fail('Only the requestor, Procurement or Admin can cancel.');
      return G[op](x);
    }
    const wasDraft = op === 'submit' && p.status === 'Draft';
    if (wasDraft) p.status = 'Open';
    if (p.status !== 'Open') return fail(`Purchase is ${p.status}.`);
    const revert = r => { if (wasDraft && !r.ok) p.status = 'Draft'; return r; };
    const a = currentActivity(p);
    if (!a) return revert(fail('No open activity.'));
    if (activityId && a.id !== activityId) return revert(fail('This step has already moved on — refresh to see the latest status.'));
    if (!canAct(state, usr, p, a)) return revert(fail(`Ball is with ${userName(state, a.ownerUserId)} — only the owner can act on “${a.name}”.`));
    if (a.status === 'Waiting' && a.clarification && !a.clarification.response) return fail('Waiting for clarification from requestor.');
    const h = H[a.actionType] || H.task;
    const fn = h[op];
    if (!fn || op.charAt(0) === '_') return revert(fail(`Action “${op}” is not valid for “${a.name}”.`));
    x.a = a;
    const res = revert(fn(x) || { ok: true });
    if (res.ok && !res.message) res.message = 'Saved';
    return res;
  }

  function hasPerm(state, usr, perms) { const r = role(state, usr.roleId); return !!(r && r.permissions && perms.some(pp => r.permissions.includes(pp))); }
  function can(state, usr, perm) { return !!usr && hasPerm(state, usr, [perm]); }

  /* =================================================================
     ESCALATION ENGINE (tick) — idempotent; returns true if anything fired
     ================================================================= */
  function tick(state) {
    let changed = false;
    const t = now();
    const pol = slaPolicy(state);
    const escal = U.sortBy((M(state).escalations || []).filter(e => e.status === 'Active'), e => e.level);
    const r06 = rule(state, 'R06');
    state.purchases.forEach(p => {
      if (p.status !== 'Open' && p.status !== 'On Hold') return;
      const a = currentActivity(p);
      if (a && a.dueAt && r06) {
        escal.forEach(e => {
          if (a.escalations.includes(e.id)) return;
          let fire = false;
          if (e.trigger === 'due_in_days') fire = t <= a.dueAt && U.daysBetween(t, a.dueAt) <= e.days && a.status !== 'Blocked' && (a.startAt < U.startOfDay(t) || U.daysBetween(t, a.dueAt) === 0);
          else if (e.trigger === 'overdue_days') fire = t > a.dueAt && U.daysBetween(a.dueAt, t) >= e.days;
          if (!fire) return;
          a.escalations.push(e.id); changed = true;
          if (e.trigger === 'due_in_days') { notify(state, a.ownerUserId, 'due_tomorrow', U.daysBetween(t, a.dueAt) === 0 ? 'Due today' : 'Due tomorrow', `${a.name} — ${p.id}`, p.id); return; }
          const target = e.notify === 'owner' ? a.ownerUserId : e.notify === 'dept_head' ? deptHeadFor(state, (user(state, a.ownerUserId) || {}).deptId || p.deptId, a.ownerUserId) : e.notify === 'finance' ? firstUserOfRole(state, 'finance') : firstUserOfRole(state, 'management');
          const days = U.daysBetween(a.dueAt, t);
          notify(state, target, e.level === 1 ? 'overdue' : 'escalation', e.level === 1 ? 'Overdue' : `Escalation L${e.level}`, `${a.name} on ${p.id} is ${U.fmt.days(days)} overdue (owner: ${userName(state, a.ownerUserId)})`, p.id, { escalationLevel: e.level });
          audit(state, { userId: 'system', action: 'Escalated', entity: 'Activity', entityId: a.id, purchaseId: p.id, field: 'escalation', next: `L${e.level} → ${userName(state, target)}`, note: `${a.name} ${U.fmt.days(days)} overdue` });
          if (e.createException) raiseException(state, { purchaseId: p.id, type: a.approval ? 'Approval overdue' : 'SLA breach', title: `${a.name} overdue`, description: `Due ${U.fmt.date(a.dueAt)} · owner ${userName(state, a.ownerUserId)}`, ownerUserId: a.ownerUserId, severity: a.approval ? 'High' : 'Medium', action: 'Complete the activity or reassign', key: `sla:${a.id}`, activityId: a.id }, null);
        });
      }
      // RFQ responses past due → Waiting + reminder
      (p.rfqs || []).forEach(r => {
        if (r.status === 'Sent' && r.dueDate && t > r.dueDate) {
          r.status = 'Waiting'; changed = true;
          notify(state, p.buyerId, 'vendor_response', 'Vendor response pending', `${vname(state, r.vendorId)} has not responded to ${r.id} (${p.id})`, p.id);
        }
      });
      // PO validity expired before vendor acceptance
      if (p.po && ['Approved', 'Sent'].includes(p.po.status) && p.po.validUntil && t > p.po.validUntil && !p.po.expiryFlagged) {
        p.po.expiryFlagged = true; changed = true;
        raiseException(state, { purchaseId: p.id, type: 'PO expired', title: `${p.po.number} validity expired`, description: 'Vendor has not accepted the PO within its validity', ownerUserId: p.buyerId, severity: 'Medium', action: 'Extend validity or re-issue PO', key: `poexp:${p.id}` }, null);
      }
      // Delivery past expected date (R10)
      if (a && a.actionType === 'delivery' && p.po && p.po.expectedDelivery && t > p.po.expectedDelivery && rule(state, 'R10') && !p.po.lateFlagged) {
        p.po.lateFlagged = true; changed = true;
        raiseException(state, { purchaseId: p.id, type: 'Vendor delay', title: `Delivery overdue — ${vname(state, p.po.vendorId)}`, description: `Expected ${U.fmt.date(p.po.expectedDelivery)}`, ownerUserId: p.buyerId, severity: 'Medium', action: 'Follow up with vendor; update expected date', key: `latedue:${p.id}` }, null);
      }
    });
    // Advance settlement overdue (R09)
    if (rule(state, 'R09')) state.advances.forEach(adv => {
      if (adv.overdueFlagged || !adv.settlementDueDate || advanceOutstanding(adv) <= 0 || t <= adv.settlementDueDate) return;
      adv.overdueFlagged = true; changed = true;
      raiseException(state, { purchaseId: adv.purchaseId, type: 'Advance overdue', title: `${adv.id} overdue for settlement`, description: `${U.fmt.inr(advanceOutstanding(adv))} outstanding with ${vname(state, adv.vendorId)} since ${U.fmt.date(adv.paymentDate)}`, ownerUserId: adv.ownerUserId, severity: 'High', action: 'Adjust against invoice or initiate recovery', key: `advdue:${adv.id}` }, null);
      notify(state, firstUserOfRole(state, 'finance'), 'advance_overdue', 'Advance overdue', `${adv.id} · ${U.fmt.inr(advanceOutstanding(adv))} outstanding`, adv.purchaseId);
      notify(state, firstUserOfRole(state, 'management'), 'escalation', 'Advance overdue — escalation', `${adv.id} · ${vname(state, adv.vendorId)} · ${U.fmt.inr(advanceOutstanding(adv))}`, adv.purchaseId);
    });
    void pol;
    return changed;
  }

  /* =================================================================
     ADMINISTRATION — masters & process versions (all audited)
     ================================================================= */
  function masterSave(state, key, record, userId, idField) {
    const list = M(state)[key];
    if (!Array.isArray(list)) return fail('Unknown master: ' + key);
    const idf = idField || 'id';
    const i = list.findIndex(r => r[idf] === record[idf]);
    if (i >= 0) {
      const old = list[i];
      Object.keys(record).forEach(k => {
        if (JSON.stringify(old[k]) !== JSON.stringify(record[k])) audit(state, { userId, action: 'Edited', entity: `Master: ${key}`, entityId: record[idf], field: k, prev: typeof old[k] === 'object' ? JSON.stringify(old[k]) : old[k], next: typeof record[k] === 'object' ? JSON.stringify(record[k]) : record[k] });
      });
      list[i] = Object.assign({}, old, record);
    } else {
      list.push(record);
      audit(state, { userId, action: 'Created', entity: `Master: ${key}`, entityId: record[idf], note: record.name || '' });
    }
    return { ok: true };
  }
  function masterSetStatus(state, key, id, status, userId) {
    const r = (M(state)[key] || []).find(x => x.id === id);
    if (!r) return fail('Record not found');
    const prev = r.status; r.status = status;
    audit(state, { userId, action: 'Status Changed', entity: `Master: ${key}`, entityId: id, field: 'status', prev, next: status });
    return { ok: true };
  }
  /** Copy a version into a new Draft version (e.g. 1.0 → 2.0). */
  function createDraftVersion(state, processId, fromVersion, newVersion, userId) {
    const pr = process(state, processId);
    if (pr.versions.some(v => v.status === 'Draft')) return fail('A draft version already exists — publish or discard it first.');
    if (pr.versions.some(v => v.version === newVersion)) return fail('Version already exists.');
    const src = version(state, fromVersion, processId);
    pr.versions.push({ version: newVersion, status: 'Draft', effectiveDate: null, retiredDate: null, createdBy: userId, createdAt: now(), notes: '', stages: U.clone(src.stages) });
    audit(state, { userId, action: 'Created', entity: 'Process Version', entityId: `${processId} V${newVersion}`, note: `Draft created from V${fromVersion}` });
    return { ok: true };
  }
  /** Mutate a Draft version: fn(versionObject). Active/retired versions are read-only (history protection). */
  function updateVersion(state, processId, ver, fn, userId, note) {
    const v = version(state, ver, processId);
    if (!v) return fail('Version not found');
    if (v.status !== 'Draft') return fail(`V${ver} is ${v.status} and read-only. Create a new draft version to change the process.`);
    fn(v);
    v.stages.forEach((s, i) => { s.seq = i + 1; (s.activities || []).forEach((a, j) => { a.seq = j + 1; a.stageId = s.id; }); });
    audit(state, { userId, action: 'Configuration Changed', entity: 'Process Version', entityId: `${processId} V${ver}`, note: note || 'Draft updated' });
    return { ok: true };
  }
  function discardDraft(state, processId, ver, userId) {
    const pr = process(state, processId);
    const i = pr.versions.findIndex(v => v.version === ver && v.status === 'Draft');
    if (i < 0) return fail('Only a draft can be discarded.');
    pr.versions.splice(i, 1);
    audit(state, { userId, action: 'Status Changed', entity: 'Process Version', entityId: `${processId} V${ver}`, prev: 'Draft', next: 'Discarded' });
    return { ok: true };
  }
  function publishVersion(state, processId, ver, effectiveDate, userId) {
    const pr = process(state, processId);
    const v = version(state, ver, processId);
    if (!v || v.status !== 'Draft') return fail('Only a draft version can be published.');
    pr.versions.forEach(o => { if (o.status === 'Active') { o.status = 'Retired'; o.retiredDate = U.toInputDate(now()); } });
    v.status = 'Active'; v.effectiveDate = effectiveDate || U.toInputDate(now()); v.publishedBy = userId; v.publishedAt = now();
    pr.activeVersion = ver;
    audit(state, { userId, action: 'Version Published', entity: 'Process Version', entityId: `${processId} V${ver}`, prev: 'Draft', next: 'Active', note: 'Existing purchases stay on their original version; new purchases use V' + ver });
    return { ok: true };
  }

  /* =================================================================
     EXPORTS
     ================================================================= */
  return {
    // lookups
    user, role, dept, vendor, category, purchase, advance, rule, ruleParam, process, version, activeVersion, stagesFor, stageDef, userName,
    // ids / audit / notifications / exceptions
    nextId, audit, notify, raiseException, updateException,
    // conditions
    context, evalCond, describeCond,
    // planning
    approvalLevels, resolveOwner, plan, replan, dueFor,
    // runtime
    currentActivity, currentStage, isOverdue, displayStatus, overdueDays, nextActionText, ball, canAct, can, hasPerm,
    // actions
    createPurchase, act, validatePR, registerDoc, missingDocsForStage,
    // finance
    advanceOutstanding, advanceAdjusted, advanceRecovered, advanceAgeing, refreshAdvanceStatus, vendorOutstanding, purchaseAdvanceOutstanding, invoiceTotals, matchResult,
    // control
    closureChecks, tick,
    // admin
    masterSave, masterSetStatus, createDraftVersion, updateVersion, discardDraft, publishVersion,
    // constants
    OPEN_STATES, DONE_STATES, handlers: H, generic: G
  };
})();
