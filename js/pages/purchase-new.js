/* =====================================================================
   CREATE PURCHASE REQUEST — requirement + PR in one simple form.
   #/purchases/new

   Left: what / how much / when / who pays / why / special conditions /
   attachments. Right: the live SYSTEM PLAN — approval route, stages that
   will run or be skipped (with the rule that decided it), documents,
   SLA timeline and rules — built by running the real engine planner
   (E.approvalLevels / E.plan) on a temporary object. Nothing touches the
   store until "Save draft" or "Submit PR" (E.createPurchase in commit).
   Typing only refreshes the plan panel, so the form is never interrupted.
   ===================================================================== */
(function () {
  const U = PCT.util;
  const fmt = U.fmt;
  const esc = U.esc;
  const I = (n, s) => PCT.icon(n, s);
  const E = PCT.engine;
  const S = PCT.sel;
  const ui = PCT.ui;

  const DEFAULT_DELIVERY_DAYS = 15;   // matches the PO default used by the engine (po_create)
  const FIELD_OF = {
    'Requirement title': 'title', Category: 'categoryId', Department: 'deptId', 'Cost centre': 'costCentreId',
    'Business justification': 'justification', 'Required date': 'requiredBy', 'Estimated value': 'estValue', Quantity: 'qty'
  };
  const MSG = {
    title: 'Enter a short title for what you need.',
    categoryId: 'Select the purchase category.',
    deptId: 'Select the department.',
    costCentreId: 'Select the cost centre that pays.',
    justification: 'Explain why this purchase is needed.',
    requiredBy: 'Pick the date you need it by.',
    estValue: 'Enter the estimated total value (more than ₹0).',
    qty: 'Enter the quantity (more than 0).'
  };
  const LABEL = {
    title: 'Title', categoryId: 'Category', deptId: 'Department', costCentreId: 'Cost centre', justification: 'Business justification',
    requiredBy: 'Required by', estValue: 'Estimated value', qty: 'Quantity', advancePct: 'Advance %', advanceTypeId: 'Advance type', priority: 'Priority'
  };
  const RUNTIME_FIELDS = ['lowestSelected', 'quoteCount'];   // only known later in the process

  /* ---------------- draft model ---------------- */
  const activeCats = state => state.masters.categories.filter(c => c.status !== 'Inactive');
  const ccsFor = (state, deptId) => state.masters.costCentres.filter(c => c.status !== 'Inactive' && c.deptId === deptId);

  function defaults(state, user) {
    const cc = ccsFor(state, user.deptId)[0];
    return {
      title: '', categoryId: '', description: '', specification: '',
      qty: 1, uom: '', estValue: null, requiredBy: null, priority: 'P3',
      deptId: user.deptId, costCentreId: cc ? cc.id : '', budgetAvailable: true, justification: '',
      flags: { advanceRequired: false, advancePct: 30, advanceTypeId: 'ADT-PART', singleSource: false, emergency: false, agreementRequired: false },
      attachment: ''
    };
  }
  function draftOf(ctx) {
    if (!ctx.local.draft || ctx.local.draftUser !== ctx.user.id) { ctx.local.draft = defaults(ctx.state, ctx.user); ctx.local.draftUser = ctx.user.id; ctx.local.errors = null; }
    return ctx.local.draft;
  }
  function readForm(ctx, form) {
    const prev = draftOf(ctx);
    const v = ui.formValues(form);
    const d = Object.assign({}, prev, v);
    d.flags = Object.assign({}, prev.flags, v.flags || {});
    return d;
  }

  /** Draft → createPurchase input */
  function toInput(state, d) {
    const cat = E.category(state, d.categoryId) || {};
    const adv = !!d.flags.advanceRequired;
    return {
      title: String(d.title || '').trim(), description: String(d.description || '').trim(), specification: String(d.specification || '').trim(),
      categoryId: d.categoryId || null, deptId: d.deptId || null, costCentreId: d.costCentreId || null,
      qty: Number(d.qty) || 0, uom: String(d.uom || '').trim() || cat.uom || 'Nos', estValue: Number(d.estValue) || 0,
      requiredBy: d.requiredBy || null, priority: d.priority || 'P3', justification: String(d.justification || '').trim(),
      budgetAvailable: !!d.budgetAvailable,
      attachments: d.attachment ? [d.attachment] : [],
      flags: {
        advanceRequired: adv, advancePct: adv ? Number(d.flags.advancePct) || 0 : 0, advanceTypeId: adv ? (d.flags.advanceTypeId || 'ADT-PART') : null,
        singleSource: !!d.flags.singleSource, emergency: !!d.flags.emergency, agreementRequired: !!(cat.agreementRequired || d.flags.agreementRequired)
      }
    };
  }

  /** Inline validation. submit=true → engine validatePR rules; draft only needs a title. */
  function validate(state, d, submit) {
    const input = toInput(state, d);
    const errs = {};
    if (submit) {
      E.validatePR(state, input).forEach(label => { const k = FIELD_OF[label]; if (k) errs[k] = MSG[k]; else errs._other = (errs._other ? errs._other + ', ' : '') + label; });
    } else if (!input.title) errs.title = 'Give the draft a title so you can find it later.';
    if (input.requiredBy && input.requiredBy < U.startOfDay(PCT.clock.now())) errs.requiredBy = 'The required date cannot be in the past.';
    if (input.qty < 0 || (d.qty != null && d.qty !== '' && !(Number(d.qty) > 0))) errs.qty = MSG.qty;
    if (d.estValue != null && d.estValue !== '' && Number(d.estValue) < 0) errs.estValue = MSG.estValue;
    if (input.costCentreId && input.deptId && !ccsFor(state, input.deptId).some(c => c.id === input.costCentreId)) errs.costCentreId = 'This cost centre does not belong to the selected department.';
    if (input.flags.advanceRequired) {
      const pct = Number(d.flags.advancePct);
      if (!(pct >= 1 && pct <= 100)) errs.advancePct = 'Advance % must be between 1 and 100.';
      if (!d.flags.advanceTypeId) errs.advanceTypeId = 'Select the advance type.';
    }
    return errs;
  }

  /* ---------------- planning (never touches the real state) ---------------- */
  /** Read-only planning sandbox: masters are only read by the planner; every collection it could write to is a fresh array. */
  function sandbox(state) {
    return { masters: state.masters, meta: { counters: {}, clockOffsetDays: state.meta.clockOffsetDays || 0 }, purchases: [], advances: [], payments: [], exceptions: [], notifications: [], audit: [], savedFilters: [], imports: [] };
  }
  function previewPurchase(state, d, user) {
    const input = toInput(state, d);
    const ver = E.activeVersion(state);
    const tmp = Object.assign({
      id: 'PUR-PREVIEW', prNo: null, processId: 'PROC-PUR', processVersion: ver.version,
      requestorId: user.id, buyerId: null, status: 'Draft', createdAt: PCT.clock.now(),
      stages: [], activities: [], approvals: [], documents: [], sourcing: null, rfqs: [], quotations: [], comparison: null,
      techEval: null, selection: null, po: null, advanceIds: [], deliveries: [], grns: [], invoices: [], paymentIds: [], match: null, comments: []
    }, input, { flags: U.clone(input.flags) });
    tmp.uom = input.uom;
    const sb = sandbox(state);
    E.plan(sb, tmp);
    return { tmp, sb, input };
  }
  const usesRuntime = c => !!c && (c.all ? c.all.some(usesRuntime) : c.any ? c.any.some(usesRuntime) : RUNTIME_FIELDS.includes(c.field));

  /** Expected dates: chain each activity's SLA (working days × priority factor) from today. */
  function timeline(sb, tmp) {
    const ctxC = E.context(sb, tmp);
    const pDel = Object.assign({}, tmp, { po: { deliveryDays: DEFAULT_DELIVERY_DAYS } });
    let cursor = PCT.clock.now();
    const stageEnd = {};
    const runs = {};
    tmp.activities.forEach(a => {
      if (a.actionType === 'requirement' || a.actionType === 'pr_submit') { runs[a.id] = 'done'; return; }
      if (a.condition) {
        if (usesRuntime(a.condition)) { runs[a.id] = 'conditional'; return; }
        if (!E.evalCond(a.condition, ctxC)) { runs[a.id] = 'skip'; return; }
      }
      runs[a.id] = 'run';
      cursor = E.dueFor(sb, pDel, a, cursor);
      a._due = cursor;
      stageEnd[a.stageId] = cursor;
    });
    return { stageEnd, runs, closure: cursor };
  }

  function budgetInfo(state, ccId, estValue) {
    const cc = U.byId(state.masters.costCentres, ccId);
    if (!cc) return null;
    const used = state.purchases.filter(p => p.costCentreId === cc.id && !['Rejected', 'Cancelled', 'Draft'].includes(p.status));
    const committed = U.sum(used, p => p.po ? p.po.total : p.estValue);
    const available = (Number(cc.budget) || 0) - committed;
    return { cc, committed, count: used.length, available, after: available - (Number(estValue) || 0) };
  }

  /* ---------------- render: form ---------------- */
  function withErr(html, errs, key) {
    const msg = errs && errs[key];
    if (!msg) return html;
    return html.replace('<div class="field', '<div class="field has-err').replace(/<\/div>\s*$/, `<span class="err" id="pn-err-${key}">${esc(msg)}</span></div>`);
  }

  function priorityPicker(state, value, errs) {
    const list = state.masters.priorities.filter(p => p.status !== 'Inactive');
    return withErr(`<div class="field full"><label>When is it needed — priority <span class="req">*</span></label>
      <div class="choice-cards pn-prio">${list.map(p => {
        const f = Number(p.slaFactor) || 1;
        const what = f < 1 ? 'faster SLAs' : f > 1 ? 'relaxed SLAs' : 'standard SLAs';
        return `<label class="choice ${p.id === value ? 'active' : ''}"><input class="sr-only" type="radio" name="priority" id="pn-prio-${esc(p.id)}" value="${esc(p.id)}" ${p.id === value ? 'checked' : ''}>
          <b>${ui.badge(`${p.id} · ${p.name}`, p.tone)}</b><small>SLA × ${esc(String(f))} — ${what}</small></label>`;
      }).join('')}</div>
      <span class="hint">Every step's SLA (working days) is multiplied by this factor. Use P1 / P2 only for genuine business urgency.</span></div>`, errs, 'priority');
  }

  function budgetHint(state, d) {
    const b = budgetInfo(state, d.costCentreId, d.estValue);
    if (!b) return '<span class="muted">Select a cost centre to see its budget.</span>';
    const v = Number(d.estValue) || 0;
    const line = `${esc(b.cc.id)} · ${esc(b.cc.name)} — budget ${esc(fmt.inr(b.cc.budget))} · committed ${esc(fmt.inr(b.committed))} (${b.count} purchase${b.count === 1 ? '' : 's'}) · <b>available ${esc(fmt.inr(b.available))}</b>`;
    if (!v) return line;
    return line + (b.after < 0
      ? `<br><span style="color:var(--red);font-weight:600">${I('alert', 12)} This request (${esc(fmt.inr(v))}) exceeds the available budget by ${esc(fmt.inr(-b.after))}.</span>`
      : `<br><span style="color:var(--green)">This request uses ${esc(fmt.inr(v))} — ${esc(fmt.inr(b.after))} would remain.</span>`);
  }
  function unitHint(d) {
    const q = Number(d.qty) || 0, v = Number(d.estValue) || 0;
    if (!(q > 0 && v > 0)) return 'Total for the full quantity, including taxes.';
    return `Total for the full quantity, including taxes · ≈ ${esc(fmt.inr(v / q))} per ${esc(d.uom || 'unit')}`;
  }

  function formHtml(ctx, d) {
    const { state, user } = ctx;
    const errs = ctx.local.errors || {};
    const cats = activeCats(state);
    const cat = E.category(state, d.categoryId);
    const depts = state.masters.departments.filter(x => x.status !== 'Inactive');
    const ccs = ccsFor(state, d.deptId);
    const advTypes = state.masters.advanceTypes.filter(x => x.status !== 'Inactive');
    const f = d.flags || {};
    const F = o => withErr(ui.field(o), errs, o.name);
    const errList = Object.keys(errs).filter(k => errs[k]);
    const top = errList.length ? `<div class="mb-16" id="pn-errors">${ui.alert('danger', `<b>Please check ${errList.length === 1 ? 'one field' : errList.length + ' fields'} before continuing:</b> ${esc(errList.map(k => k === '_other' ? errs._other : LABEL[k] || k).join(' · '))}`)}</div>` : '';
    const agreeLocked = !!(cat && cat.agreementRequired);

    return `<form class="card" id="pn-form" data-act-input="pn-input" data-act-change="pn-change" onsubmit="return false" novalidate>
      <div class="card-body">
        ${top}
        <div class="pn-who small muted mb-8">${ui.avatar(user.name, 'sm')} Requested by <b style="color:var(--ink)">${esc(user.name)}</b> · ${esc(user.title || '')} · ${esc(S.deptName(state, user.deptId))}</div>
        <div class="form-grid">
          <div class="form-section">1 · What do you need?</div>
          ${F({ name: 'title', id: 'pn-title', label: 'Requirement title', required: true, value: d.title, placeholder: 'e.g. Laptops for new project engineers', full: true })}
          ${F({ name: 'categoryId', id: 'pn-categoryId', label: 'Category', type: 'select', required: true, value: d.categoryId, placeholder: 'Select category…', options: cats.map(c => ({ value: c.id, label: c.name })), hint: cat ? esc(`${cat.type === 'service' ? 'Service' : 'Material'} · ${cat.techEval ? 'technical evaluation required' : 'no technical evaluation'}${cat.agreementRequired ? ' · agreement required' : ''}`) : 'Decides technical evaluation, agreement and documents.' })}
          <div class="field pn-spacer"></div>
          ${F({ name: 'description', id: 'pn-description', label: 'Description', type: 'textarea', rows: 2, value: d.description, placeholder: 'What is it for? Where will it be used?', full: true })}
          ${F({ name: 'specification', id: 'pn-specification', label: 'Specification', type: 'textarea', rows: 3, value: d.specification, placeholder: 'Make / model / size / capacity / standards / scope of work…', full: true })}

          <div class="form-section">2 · How much?</div>
          ${F({ name: 'qty', id: 'pn-qty', label: 'Quantity', type: 'number', required: true, min: 0, value: d.qty })}
          ${F({ name: 'uom', id: 'pn-uom', label: 'Unit of measure', value: d.uom || (cat && cat.uom) || '', placeholder: (cat && cat.uom) || 'Nos', hint: cat ? `Default for ${esc(cat.name)}: ${esc(cat.uom)}` : 'Defaults from the category' })}
          ${F({ name: 'estValue', id: 'pn-estValue', label: 'Estimated total value', type: 'money', required: true, value: d.estValue == null ? '' : d.estValue, placeholder: '0', hint: `<span id="pn-unit">${unitHint(d)}</span>` })}
          <div class="field pn-spacer"></div>

          <div class="form-section">3 · When?</div>
          ${F({ name: 'requiredBy', id: 'pn-requiredBy', label: 'Required by', type: 'date', required: true, value: d.requiredBy || '', min: PCT.clock.now(), hint: 'The date the material / service must be available.' })}
          <div class="field pn-spacer"></div>
          ${priorityPicker(state, d.priority, errs)}

          <div class="form-section">4 · Who pays?</div>
          ${F({ name: 'deptId', id: 'pn-deptId', label: 'Department', type: 'select', required: true, value: d.deptId, placeholder: 'Select department…', options: depts.map(x => ({ value: x.id, label: x.name })) })}
          ${F({ name: 'costCentreId', id: 'pn-costCentreId', label: 'Cost centre', type: 'select', required: true, value: d.costCentreId, placeholder: ccs.length ? 'Select cost centre…' : 'No cost centre for this department', options: ccs.map(c => ({ value: c.id, label: `${c.id} · ${c.name}` })) })}
          <div class="field full"><label class="check"><input type="checkbox" name="budgetAvailable" id="pn-budgetAvailable" ${d.budgetAvailable ? 'checked' : ''}> Budget is available in this cost centre</label><span class="hint" id="pn-budget">${budgetHint(state, d)}</span></div>

          <div class="form-section">5 · Why?</div>
          ${F({ name: 'justification', id: 'pn-justification', label: 'Business justification', type: 'textarea', rows: 3, required: true, value: d.justification, placeholder: 'Business need, impact if not purchased, alternatives considered…', full: true })}

          <div class="form-section">6 · Special conditions</div>
          <div class="field full pn-cond">
            <label class="check"><input type="checkbox" name="flags.advanceRequired" id="pn-adv" ${f.advanceRequired ? 'checked' : ''}> Vendor advance required</label>
            <span class="hint">Activates the controlled advance workflow — request → approval → finance verification → payment → adjustment (Rule R08).</span>
          </div>
          ${f.advanceRequired ? `
            ${withErr(ui.field({ name: 'flags.advancePct', id: 'pn-advancePct', label: 'Advance % of PO value', type: 'number', min: 1, max: 100, step: 1, required: true, value: f.advancePct, hint: advBandHint(state, f.advancePct) }), errs, 'advancePct')}
            ${withErr(ui.field({ name: 'flags.advanceTypeId', id: 'pn-advanceTypeId', label: 'Advance type', type: 'select', required: true, value: f.advanceTypeId, options: advTypes.map(t => ({ value: t.id, label: t.name })) }), errs, 'advanceTypeId')}` : ''}
          <div class="field full pn-cond">
            <label class="check"><input type="checkbox" name="flags.singleSource" id="pn-single" ${f.singleSource ? 'checked' : ''}> Single source (only one capable vendor)</label>
            <span class="hint">Rule R03 then needs 1 quotation plus a single-source justification instead of ${esc(String(E.ruleParam(state, 'R03', 'minQuotes', 3)))}.</span>
          </div>
          <div class="field full pn-cond">
            <label class="check"><input type="checkbox" name="flags.emergency" id="pn-emerg" ${f.emergency ? 'checked' : ''}> Emergency purchase</label>
            <span class="hint">Highlighted to every reviewer and approver. Combine with priority P1 to shorten SLAs.</span>
          </div>
          <div class="field full pn-cond">
            <label class="check"><input type="checkbox" name="flags.agreementRequired" id="pn-agree" ${agreeLocked || f.agreementRequired ? 'checked' : ''} ${agreeLocked ? 'disabled' : ''}> Agreement / contract required</label>
            <span class="hint">${agreeLocked ? `Always required for ${esc(cat.name)} (category master).` : 'Adds the Agreement / Contract document to the PO stage.'}</span>
          </div>

          <div class="form-section">7 · Attachments</div>
          ${ui.field({ name: 'attachment', id: 'pn-attachment', label: 'Requirement note / supporting document', type: 'file', value: d.attachment || '', sample: 'Requirement_Note.pdf', full: true, hint: 'Filed as the Requirement Note (D01). More documents can be added on the purchase page.' })}
        </div>
      </div>
      <div class="card-foot pn-foot">
        <a class="btn btn-ghost" href="#/purchases">Cancel</a>
        <span class="grow"></span>
        <button type="button" class="btn" data-act="pn-draft">${I('file', 15)} Save draft</button>
        <button type="button" class="btn btn-primary" data-act="pn-submit">${I('send', 15)} Submit PR</button>
      </div>
    </form>`;
  }

  function advBandHint(state, pct) {
    const bands = U.sortBy((state.masters.advanceApproval || []).filter(b => b.status === 'Active'), b => b.maxPct);
    const p = Number(pct) || 0;
    const band = bands.find(b => p <= b.maxPct);
    if (!band) return 'Advance approval band from the Advance Approval master.';
    return `${esc(band.name)} → approved by ${esc((E.role(state, band.approverRole) || {}).name || band.approverRole)}`;
  }

  /* ---------------- render: SYSTEM PLAN ---------------- */
  function stageReason(state, tmp, st, def) {
    const c = def && def.activation;
    if (!c) return '';
    if (c.field === 'flags.advanceRequired') {
      if (c.op === 'truthy') return st.active ? 'Activated because a vendor advance is required (Rule R08)' : 'Not required — no vendor advance (Rule R08)';
      return st.active ? 'Direct payment — no advance to adjust' : 'Skipped — with an advance the invoice is settled through Advance Adjustment + Balance Payment (Rule R08)';
    }
    return (st.active ? 'Applies: ' : 'Skipped — condition not met: ') + E.describeCond(c);
  }

  function planHtml(state, d, user) {
    let pv;
    try { pv = previewPurchase(state, d, user); } catch (e) { console.error(e); return ui.card({ title: 'System plan', body: ui.alert('warn', 'The plan cannot be calculated yet — complete the category, department and value.') }); }
    const { tmp, sb, input } = pv;
    const tl = timeline(sb, tmp);
    const now = PCT.clock.now();
    const cat = E.category(state, input.categoryId);
    const ver = E.activeVersion(state);
    const nm = id => E.userName(state, id);
    const firstAfterSubmit = tmp.activities.find(a => tl.runs[a.id] === 'run');
    const levels = tmp.approvals || [];
    const matrix = levels.length && levels[0].matrixId ? U.byId(state.masters.approvalMatrix, levels[0].matrixId) : null;
    const adv = !!input.flags.advanceRequired;
    const stageDefs = E.stagesFor(sb, tmp);
    const running = tmp.stages.filter(s => s.active);
    const skipped = tmp.stages.filter(s => !s.active);
    const inDays = t => { const n = U.daysBetween(now, t); return n <= 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`; };

    // ---- headline: where the ball goes on submit
    const pr = U.byId(state.masters.priorities, input.priority) || {};
    const head = firstAfterSubmit
      ? `<div class="pn-first">${I('arrowRight', 14)}<div>On submit the ball moves to <b>${esc(nm(firstAfterSubmit.ownerUserId))}</b> (${esc((E.role(state, (E.user(state, firstAfterSubmit.ownerUserId) || {}).roleId) || {}).name || '')}) for <b>${esc(firstAfterSubmit.stageName)}</b> — due ${esc(fmt.date(firstAfterSubmit._due))}.</div></div>`
      : '';

    // ---- warnings
    const warns = [];
    const b = budgetInfo(state, input.costCentreId, input.estValue);
    if (!input.budgetAvailable) warns.push(ui.alert('warn', '<b>Budget not confirmed.</b> Initial Review may return the PR for budget re-validation.'));
    else if (b && input.estValue && b.after < 0) warns.push(ui.alert('warn', `<b>Over budget.</b> ${esc(fmt.inr(input.estValue))} exceeds the ${esc(b.cc.id)} available budget (${esc(fmt.inr(b.available))}).`));
    if (input.flags.emergency) warns.push(ui.alert('info', `<b>Emergency purchase.</b> Flagged to all reviewers and approvers${input.priority !== 'P1' ? ' — consider priority P1 to halve SLAs' : ''}.`));
    const deliveryBy = tl.stageEnd.S12 || tl.stageEnd.S13;
    if (input.requiredBy && deliveryBy) {
      if (U.startOfDay(input.requiredBy) < U.startOfDay(deliveryBy)) warns.push(ui.alert('warn', `<b>Required by ${esc(fmt.date(input.requiredBy))}</b>, but the standard cycle delivers around <b>${esc(fmt.date(deliveryBy))}</b> (${U.daysBetween(input.requiredBy, deliveryBy)} days later). Raise the priority or plan earlier.`));
      else warns.push(ui.alert('success', `Fits your required date (${esc(fmt.date(input.requiredBy))}) — expected delivery ${esc(fmt.date(deliveryBy))}, ${U.daysBetween(deliveryBy, input.requiredBy)} day(s) to spare.`));
    }

    // ---- approval route
    const route = levels.length ? `<ol class="pn-route">${levels.map(l => `<li><span class="pn-lv">L${l.level}</span><span class="grow">${l.userId ? ui.person(state, l.userId, { subText: l.label }) : `<b>${esc(l.label)}</b>`}</span>${tl.stageEnd.S04 && l.level === levels.length ? `<span class="small muted nowrap">by ${esc(fmt.dateShort(tl.stageEnd.S04))}</span>` : ''}</li>`).join('')}</ol>` : '<p class="muted">No approval levels found.</p>';
    const routeSub = matrix ? `${esc(matrix.name)} (${esc(matrix.id)})` : 'Default route';

    // ---- milestones
    const ms = [
      ['Approval complete', tl.stageEnd.S04],
      ['PO issued & accepted', tl.stageEnd.S10],
      adv ? ['Advance paid', tl.stageEnd.S11] : null,
      [cat && cat.type === 'service' ? 'Service delivered' : 'Material delivered', tl.stageEnd.S12],
      [cat && cat.type === 'service' ? 'Service confirmed' : 'GRN', tl.stageEnd.S13],
      ['Vendor paid', adv ? tl.stageEnd.S20 : tl.stageEnd.S18],
      ['Expected closure', tl.closure]
    ].filter(x => x && x[1]);
    const msHtml = `<div class="pn-ms">${ms.map(([k, t], i) => `<div class="pn-ms-row ${i === ms.length - 1 ? 'last' : ''}"><span>${esc(k)}</span><b>${esc(fmt.date(t))}</b><small>${esc(inDays(t))}</small></div>`).join('')}</div>
      <div class="hint small muted mt-4">Working-day SLAs × ${esc(String(pr.slaFactor || 1))} (${esc(pr.name || input.priority)}) · vendor delivery assumed ${DEFAULT_DELIVERY_DAYS} days (PO default).</div>`;

    // ---- stages
    const stagesHtml = `<ul class="vsteps pn-stages">${tmp.stages.map((st, i) => {
      const def = stageDefs.find(x => x.id === st.stageId) || {};
      const acts = tmp.activities.filter(a => a.stageId === st.stageId);
      if (!st.active) return `<li class="skipped"><span class="vd">–</span><div class="vbody"><b>${esc(st.name)}</b><small>${esc(stageReason(state, tmp, st, def))}</small></div></li>`;
      const isDone = acts.length && acts.every(a => tl.runs[a.id] === 'done');
      const isFirst = firstAfterSubmit && firstAfterSubmit.stageId === st.stageId;
      const notes = [];
      if (st.stageId === 'S01') notes.push('Captured in this form');
      if (st.stageId === 'S02') notes.push('Submitted with this form — PR number generated');
      const reason = stageReason(state, tmp, st, def);
      if (reason) notes.push(reason);
      acts.forEach(a => {
        if (tl.runs[a.id] === 'conditional') notes.push(a.actionType === 'selection_approval' ? `${a.name} — only if a non-L1 vendor is selected (Rule R11)` : `${a.name} — decided during the process (${E.describeCond(a.condition)})`);
        else if (tl.runs[a.id] === 'skip') notes.push(a.actionType === 'tech_eval' ? `Technical evaluation not required${cat ? ` for ${cat.name}` : ''}` : `${a.name} not required`);
        else if (tl.runs[a.id] === 'run' && a.actionType === 'tech_eval') notes.push(`Technical evaluation by ${nm(a.ownerUserId)}${cat ? ` — ${cat.name} requires it` : ''}`);
        else if (tl.runs[a.id] === 'run' && a.actionType === 'advance_approve') notes.push(`Advance ${input.flags.advancePct}% approved by ${nm(a.ownerUserId)}`);
      });
      if (st.stageId === 'S10' && input.flags.agreementRequired) notes.push('Agreement / contract required');
      const runActs = acts.filter(a => tl.runs[a.id] === 'run');
      const owners = U.uniq(runActs.map(a => a.ownerUserId)).map(nm);
      const ownerTxt = st.stageId === 'S04' ? levels.map(l => `L${l.level} ${nm(l.userId)}`).join(' → ') : owners.join(', ');
      const due = tl.stageEnd[st.stageId];
      return `<li class="${isDone ? 'done' : isFirst ? 'current' : ''}"><span class="vd">${isDone ? '✓' : i + 1}</span><div class="vbody"><div class="row between gap-4"><b>${esc(st.name)}</b>${due ? `<span class="small muted nowrap">${esc(fmt.dateShort(due))}</span>` : ''}</div>${ownerTxt && !isDone ? `<small>${esc(ownerTxt)}</small>` : ''}${notes.map(n => `<small class="pn-note">${esc(n)}</small>`).join('')}</div></li>`;
    }).join('')}</ul>`;

    // ---- documents
    const docs = (tmp.documents || []);
    const userDocs = docs.filter(x => x.mandatory && !x.system);
    const sysDocs = docs.filter(x => x.mandatory && x.system);
    const stName = id => (stageDefs.find(s => s.id === id) || {}).name || id;
    const docsHtml = `<div class="stack-sm">
      <div class="pn-doc ${d.attachment ? 'ok' : ''}">${I(d.attachment ? 'checkCircle' : 'file', 14)}<span class="grow">Requirement note <span class="muted">(optional)</span></span><small>${d.attachment ? esc(d.attachment) : 'not attached'}</small></div>
      ${userDocs.map(x => `<div class="pn-doc">${I('upload', 14)}<span class="grow">${esc(x.name)}</span><small>${esc(x.stages.map(stName).join(', '))}</small></div>`).join('')}
      <div class="small muted">${I('sparkle', 12)} System-generated (${sysDocs.length}): ${esc(sysDocs.map(x => x.name).join(', '))}</div>
    </div>`;

    // ---- rules
    const rules = [];
    const addRule = (id, on, text) => { if (E.rule(state, id)) rules.push({ id, on, text, name: E.rule(state, id).name }); };
    const thr = Number(E.ruleParam(state, 'R01', 'threshold', 100000));
    addRule('R01', input.estValue > thr, input.estValue > thr ? `Value ${fmt.inr(input.estValue)} is above ${fmt.inr(thr)} — ${levels.length} approval levels: ${levels.map(l => l.label).join(' → ')}` : `Within ${fmt.inr(thr)} — Department Head approval only`);
    const minQ = Number(E.ruleParam(state, 'R03', 'minQuotes', 3));
    addRule('R03', true, input.flags.singleSource ? 'Single source — 1 quotation plus a single-source justification' : `${minQ} quotations required before comparison`);
    addRule('R08', adv, adv ? 'Advance required — Vendor Advance, Advance Adjustment and Balance Payment activated; direct Payment skipped' : 'No advance — standard payment route');
    if (adv) {
      const sd = Number(U.get(U.byId(state.masters.settlementRules, 'SR-1') || {}, 'params.settlementDays', 30));
      addRule('R09', true, `Advance must be adjusted within ${sd} days of payment — otherwise exception + escalation to Finance`);
      addRule('R02', true, 'Payment approval warns about the vendor\'s outstanding advance before paying');
    }
    addRule('R11', true, 'If the lowest-price (L1) vendor is not selected: justification + Department Head approval');
    addRule('R07', true, 'A stage cannot complete while its mandatory document is missing');
    const rulesHtml = `<ul class="pn-rules">${rules.map(r => `<li class="${r.on ? 'on' : ''}"><span class="tag">${esc(r.id)}</span><span class="grow"><b>${esc(r.name)}</b><small>${esc(r.text)}</small></span>${r.on ? ui.badge('Applies', 'blue') : ui.badge('Not triggered', 'grey', { dot: false })}</li>`).join('')}</ul>`;

    const sec = (title, sub, body) => `<div class="pn-sec"><div class="pn-sec-h"><span class="overline">${title}</span>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>${body}</div>`;

    return `<section class="card pn-plan" id="pn-plan-card">
      <div class="card-head"><div class="grow"><div class="overline" style="color:var(--blue-600)">${I('zap', 12)} System plan · live</div><div class="card-title">What happens when you submit</div><div class="card-sub">Calculated from Process V${esc(ver.version)}, the Approval Matrix and Decision Rules. Nothing is saved until you click Save draft or Submit PR.</div></div></div>
      <div class="card-body stack">
        ${head}
        ${warns.join('')}
        ${sec('Approval route', routeSub, route)}
        ${sec('Expected timeline', input.requiredBy ? `need by ${esc(fmt.dateShort(input.requiredBy))}` : '', msHtml)}
        ${sec(`Stages · ${running.length} run · ${skipped.length} skipped`, '', stagesHtml)}
        ${sec('Documents', `${userDocs.length} to upload during the process`, docsHtml)}
        ${sec('Rules', '', rulesHtml)}
      </div>
    </section>`;
  }

  /* ---------------- partial refresh while typing ---------------- */
  let planTimer = null;
  function refreshPlan(ctx, delay) {
    clearTimeout(planTimer);
    planTimer = setTimeout(() => {
      const box = document.getElementById('pn-plan');
      if (!box || !ctx.local.draft) return;
      const state = PCT.store.get();
      box.innerHTML = planHtml(state, ctx.local.draft, ctx.user);
      const bh = document.getElementById('pn-budget'); if (bh) bh.innerHTML = budgetHint(state, ctx.local.draft);
      const uh = document.getElementById('pn-unit'); if (uh) uh.innerHTML = unitHint(ctx.local.draft);
    }, delay == null ? 140 : delay);
  }
  function clearFieldErr(ctx, name) {
    const key = { 'flags.advancePct': 'advancePct', 'flags.advanceTypeId': 'advanceTypeId' }[name] || name;
    if (!ctx.local.errors || !ctx.local.errors[key]) return;
    delete ctx.local.errors[key];
    const e = document.getElementById('pn-err-' + key);
    if (e) { const fld = e.closest('.field'); if (fld) fld.classList.remove('has-err'); e.remove(); }
  }

  /* ---------------- save / submit ---------------- */
  function save(ctx, submit) {
    const form = document.getElementById('pn-form');
    if (!form) return;
    const d = readForm(ctx, form);
    ctx.local.draft = d;
    const state = PCT.store.get();
    const errs = validate(state, d, submit);
    if (Object.keys(errs).length) {
      ctx.local.errors = errs;
      ctx.local._scrollErr = true;
      ctx.rerender();
      ctx.toast(submit ? 'Complete the highlighted fields to submit the PR.' : 'Complete the highlighted fields to save the draft.', 'red', 'Not saved');
      return;
    }
    ctx.local.errors = null;
    const input = toInput(state, d);
    let newId = null;
    const res = ctx.commit(s => {
      const r = E.createPurchase(s, input, ctx.user.id, { submit: !!submit });
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Could not create the purchase.' };
      newId = r.purchase.id;
      return { ok: true, id: newId };
    });
    if (!res || res.ok === false || !newId) return;
    const st = PCT.store.get();
    const p = E.purchase(st, newId);
    const b = p ? E.ball(st, p) : null;
    ctx.local.draft = null;
    ctx.local.errors = null;
    if (submit) ctx.toast(`${newId} created — ball moved to ${b && b.ownerName ? b.ownerName : 'the next owner'}${b && b.roleName ? ` (${b.roleName})` : ''}`, 'green', 'Purchase request submitted');
    else ctx.toast(`${newId} saved as draft — the ball stays with you until you submit.`, 'green', 'Draft saved');
    ctx.go('#/purchases/' + newId);
  }

  /* ---------------- page ---------------- */
  PCT.pages.register({
    route: 'purchases/new',
    title: 'Create Purchase Request',
    render(ctx) {
      css();
      const head = ui.pageHead({
        title: 'Create Purchase Request', icon: 'plus',
        crumbs: [{ label: 'Purchases', href: '#/purchases' }, { label: 'New purchase request' }],
        sub: 'Requirement and purchase request in one simple form. The system plan on the right updates as you type.'
      });
      if (!ctx.can('purchase.create')) {
        return head + ui.card({ body: ui.empty('lock', 'You cannot raise purchase requests', `Signed in as ${esc(ctx.user.name)} (${esc((ctx.role || {}).name || '')}). Your role does not include “Create purchase request”. Ask a requestor or department head to raise it, or contact the administrator.`, '<a class="btn btn-primary mt-8" href="#/purchases">Go to Purchases</a>') });
      }
      const d = draftOf(ctx);
      return head + `<div class="grid grid-main pn-grid">
        <div>${formHtml(ctx, d)}</div>
        <aside class="pn-aside"><div id="pn-plan">${planHtml(ctx.state, d, ctx.user)}</div></aside>
      </div>`;
    },
    after(ctx) {
      if (ctx.local._focus) {
        const el = document.getElementById(ctx.local._focus);
        ctx.local._focus = null;
        if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
      }
      if (ctx.local._scrollErr) {
        ctx.local._scrollErr = false;
        const el = document.getElementById('pn-errors');
        if (el) el.scrollIntoView({ block: 'center' });
      }
    },
    actions: {
      'pn-input'(ctx, form, ev) {
        ctx.local.draft = readForm(ctx, form);
        if (ev && ev.target && ev.target.name) clearFieldErr(ctx, ev.target.name);
        refreshPlan(ctx);
      },
      'pn-change'(ctx, form, ev) {
        const t = ev && ev.target;
        if (!t || !t.name && t.type !== 'file') return;
        const prev = draftOf(ctx);
        const d = readForm(ctx, form);
        const state = PCT.store.get();
        if (t.name === 'categoryId') {
          const oldCat = E.category(state, prev.categoryId);
          const newCat = E.category(state, d.categoryId);
          if (newCat && (!String(d.uom || '').trim() || (oldCat && d.uom === oldCat.uom))) d.uom = newCat.uom;
          if (newCat && newCat.agreementRequired) d.flags.agreementRequired = true;
        }
        if (t.name === 'deptId' && !ccsFor(state, d.deptId).some(c => c.id === d.costCentreId)) {
          const cc = ccsFor(state, d.deptId)[0];
          d.costCentreId = cc ? cc.id : '';
        }
        ctx.local.draft = d;
        if (t.name) clearFieldErr(ctx, t.name);
        const structural = t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'radio';
        if (structural) { ctx.local._focus = t.id || null; ctx.rerender(); }
        else refreshPlan(ctx, 0);
      },
      'pn-draft'(ctx) { save(ctx, false); },
      'pn-submit'(ctx) { save(ctx, true); }
    }
  });

  /* ---------------- page CSS ---------------- */
  function css() {
    ui.css('page-purchase-new', `
      .pn-grid { grid-template-columns: minmax(0, 1fr) 400px; }
      .pn-aside { position: sticky; top: calc(var(--topbar-h) + 12px); max-height: calc(100vh - var(--topbar-h) - 24px); overflow-y: auto; border-radius: var(--radius); }
      .pn-who { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .pn-spacer { visibility: hidden; }
      .field.has-err input, .field.has-err select, .field.has-err textarea { border-color: var(--red) !important; }
      .field.has-err > label { color: var(--red); }
      .pn-prio { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .pn-prio .choice { display: flex; flex-direction: column; gap: 4px; }
      .pn-prio .choice:focus-within { box-shadow: 0 0 0 3px var(--blue-100); }
      .pn-cond { gap: 2px; }
      .pn-cond .hint { padding-left: 24px; }
      #pn-form .file-drop { flex-wrap: wrap; }
      #pn-form .file-drop input[type=file] { min-width: 0; max-width: 100%; }
      .pn-foot { position: sticky; bottom: 0; background: #fff; border-radius: 0 0 var(--radius) var(--radius); z-index: 5; align-items: center; }
      .pn-plan .card-body { gap: 16px; }
      .pn-first { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 9px; background: #FFF7EC; border: 1px solid #F6DDB3; font-size: 13px; }
      .pn-first .ic { color: #B45309; margin-top: 2px; }
      .pn-sec-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line-2); }
      .pn-route { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .pn-route li { display: flex; align-items: center; gap: 10px; }
      .pn-lv { display: inline-grid; place-items: center; width: 28px; height: 22px; border-radius: 6px; background: var(--navy-700); color: #fff; font-size: 11px; font-weight: 700; flex: none; }
      .pn-ms { display: flex; flex-direction: column; }
      .pn-ms-row { display: grid; grid-template-columns: minmax(0, 1fr) auto 64px; gap: 8px; padding: 5px 0; border-bottom: 1px dashed var(--line-2); font-size: 13px; align-items: baseline; }
      .pn-ms-row span { color: var(--ink-2); }
      .pn-ms-row small { color: var(--muted); text-align: right; font-size: 11.5px; }
      .pn-ms-row.last { border-bottom: 0; }
      .pn-ms-row.last b { color: var(--navy-700); }
      .pn-stages li { padding-bottom: 10px; }
      .pn-stages .vbody b { font-size: 13px; }
      .pn-stages .vbody small { display: block; color: var(--muted); font-size: 11.5px; line-height: 1.35; }
      .pn-stages .vbody small.pn-note { color: var(--blue-600); }
      .pn-stages li.skipped .vbody small { color: var(--muted); }
      .pn-doc { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 6px 8px; border: 1px solid var(--line-2); border-radius: 7px; }
      .pn-doc small { color: var(--muted); font-size: 11px; text-align: right; }
      .pn-doc.ok { background: var(--green-bg); border-color: #BFE6D3; }
      .pn-doc.ok .ic { color: var(--green); }
      .pn-rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .pn-rules li { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; }
      .pn-rules li small { display: block; color: var(--muted); font-size: 11.5px; }
      .pn-rules li:not(.on) b { color: var(--ink-2); font-weight: 600; }
      @media (max-width: 1200px) { .pn-grid { grid-template-columns: minmax(0, 1fr); } .pn-aside { position: static; max-height: none; overflow: visible; } }
      @media (max-width: 900px) { .pn-spacer { display: none; } .pn-prio { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 560px) { .pn-foot .btn { flex: 1; } .pn-foot .grow, .pn-foot .btn-ghost { display: none; } .pn-ms-row { grid-template-columns: minmax(0, 1fr) auto; } .pn-ms-row small { display: none; } }
    `);
  }

  // test / reuse hooks (read-only helpers)
  PCT.purchaseNew = { previewPurchase, timeline, toInput, validate, budgetInfo };
})();
