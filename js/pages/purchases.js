/* =====================================================================
   PURCHASES — the single purchase register (replaces Excel trackers).

   #/purchases?status=open|draft|overdue|blocked|waiting-vendor|pending-approval|completed|rejected
              &group=PAYMENT&stage=S04&dept=DPT-IT&owner=U09&vendor=V001
              &category=CAT-ITH&priority=P1&q=text&mine=1

   One row per purchase (S.rows over S.visiblePurchases): where it is,
   who has the ball, what is next, when it is due, money status.
   Filters live in ctx.local (per tab) and are initialised from the URL
   query whenever the query changes, so dashboard tiles drill straight in.
   Saved filters are stored in state.savedFilters (built-ins have
   ownerUserId null; personal ones carry the user's id).
   ===================================================================== */
(function () {
  const U = PCT.util;
  const fmt = U.fmt;
  const esc = U.esc;
  const I = (n, s) => PCT.icon(n, s);
  const E = PCT.engine;
  const S = PCT.sel;
  const ui = PCT.ui;

  /* ---------------- vocabulary ---------------- */
  const VIEWS = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'mine', label: 'My' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'blocked', label: 'Blocked' },
    { id: 'waiting-vendor', label: 'Waiting vendor' },
    { id: 'pending-approval', label: 'Pending approval' },
    { id: 'draft', label: 'Draft', optional: true },
    { id: 'completed', label: 'Completed' },
    { id: 'rejected', label: 'Rejected' }
  ];
  const VIEW_IDS = VIEWS.map(v => v.id);
  const STATUS_OPTS = ['In Progress', 'Waiting', 'Overdue', 'Blocked', 'On Hold', 'Draft', 'Closed', 'Rejected', 'Cancelled'];
  const PURCHASE_KIND = ['Draft', 'On Hold', 'Closed', 'Rejected', 'Cancelled'];
  const DUE_OPTS = [{ value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Due today' }, { value: 'week', label: 'Due within 7 days' }];
  const ADV_OPTS = ['Planned', 'Requested', 'Approved', 'Verified', 'Outstanding', 'Partially Adjusted', 'Adjusted', 'Recovered', 'Closed', 'Rejected', 'None'];
  const PAY_OPTS = ['Pending', 'Processing', 'Paid', 'Failed', 'None'];
  /** Flat filter keys (same vocabulary as the URL contract + advanced panel). */
  const F_KEYS = ['q', 'dept', 'owner', 'stage', 'group', 'actStatus', 'vendor', 'category', 'priority', 'ageingMin', 'due', 'valueMin', 'valueMax', 'advance', 'payment', 'mine', 'ownerRole', 'advanceAgeingMin'];
  const NUM_KEYS = ['ageingMin', 'valueMin', 'valueMax', 'advanceAgeingMin'];
  const LIVE = ['Open', 'On Hold'];

  /* ---------------- filter model ---------------- */
  const blank = v => v == null || v === '' || v === false || (typeof v === 'number' && isNaN(v));
  const truthy = v => v === true || v === 1 || v === '1' || v === 'true' || v === 'yes';

  /** Any flat object (URL query, saved filter) → { view, f } */
  function normalize(src) {
    src = src || {};
    const f = {};
    let view = 'all';
    const st = src.status != null ? String(src.status) : '';
    if (VIEW_IDS.includes(st)) view = st;
    if (truthy(src.overdue)) { if (view === 'all') view = 'overdue'; else f.due = 'overdue'; }
    F_KEYS.forEach(k => {
      if (k === 'mine') return;
      let v = src[k];
      if (blank(v)) return;
      if (NUM_KEYS.includes(k)) { v = Number(v); if (isNaN(v)) return; }
      else v = String(v);
      f[k] = v;
    });
    // stage=S04 · group=PAYMENT — also accept "G:PAYMENT" / "S:S04" forms
    if (f.stage && /^G:/.test(f.stage)) { f.group = f.stage.slice(2); delete f.stage; }
    if (f.stage && /^S:/.test(f.stage)) f.stage = f.stage.slice(2);
    if (truthy(src.mine)) { if (view === 'all') view = 'mine'; else f.mine = true; }
    return { view, f };
  }
  /** { view, f } → flat object (saved-filter format; same keys as the URL contract) */
  function serialize(view, f) {
    const out = {};
    if (view === 'mine') out.mine = true;
    else if (view && view !== 'all') out.status = view;
    F_KEYS.forEach(k => { if (!blank(f[k])) out[k] = f[k]; });
    return out;
  }
  const canon = (view, f) => JSON.stringify(Object.entries(serialize(view, f)).sort((a, b) => a[0] < b[0] ? -1 : 1));
  const activeCount = f => F_KEYS.filter(k => k !== 'q' && !blank(f[k])).length;

  /** Initialise filters from the URL query whenever it changes (dashboard / tower drill-downs). */
  function syncFromQuery(ctx) {
    const key = JSON.stringify(ctx.query || {});
    if (ctx.local.qsKey === key && ctx.local.f) return;
    const n = normalize(ctx.query);
    ctx.local.qsKey = key;
    ctx.local.f = n.f;
    ctx.local.view = n.view;
  }

  /* ---------------- row helpers ---------------- */
  function statusName(r) {
    if (r.status === 'Draft' || r.status === 'On Hold' || r.status === 'Closed' || r.status === 'Rejected' || r.status === 'Cancelled') return r.status;
    return r.actStatus || '—';
  }
  function statusBadge(state, r) {
    const n = r.statusName;
    if (n === '—') return '<span class="muted">—</span>';
    return ui.status(state, PURCHASE_KIND.includes(n) ? 'purchase' : 'activity', n);
  }
  const isOpen = r => LIVE.includes(r.status);
  const isMine = (r, user) => r.ownerUserId === user.id || r.requestorId === user.id;

  /** Enrich selector rows with the few extra fields this register filters on. */
  function buildRows(state, user) {
    const list = S.visiblePurchases(state, user);
    return S.rows(state, list).map(r => {
      const a = E.currentActivity(r.p);
      const advAges = (r.p.advanceIds || []).map(id => E.advance(state, id)).filter(Boolean).map(adv => E.advanceAgeing(state, adv)).filter(Boolean);
      return Object.assign(r, {
        statusName: statusName(r),
        isApproval: !!(a && a.approval && isOpen(r)),
        actOwnerRole: a ? a.ownerRole : null,
        actOwnerRoleId: a ? ((E.user(state, a.ownerUserId) || {}).roleId || null) : null,
        advMaxAge: advAges.length ? Math.max(...advAges.map(x => x.days)) : null,
        advanceKey: r.advanceStatus === '—' ? 'None' : r.advanceStatus,
        paymentKey: r.paymentStatus === '—' ? 'None' : r.paymentStatus
      });
    });
  }

  function viewMatch(r, view, user) {
    const open = isOpen(r);
    switch (view) {
      case 'open': return open;
      case 'draft': return r.status === 'Draft';
      case 'mine': return isMine(r, user);
      case 'overdue': return open && r.overdueDays > 0;
      case 'blocked': return open && r.blocked;
      case 'waiting-vendor': return open && r.waitingOn === 'vendor';
      case 'pending-approval': return r.isApproval;
      case 'completed': return r.status === 'Closed';
      case 'rejected': return r.status === 'Rejected' || r.status === 'Cancelled';
      default: return true;
    }
  }

  function filterMatch(r, f, user) {
    const now = PCT.clock.now();
    if (f.q) {
      const q = String(f.q).trim().toLowerCase();
      if (q && ![r.id, r.prNo, r.poNumber, r.title, r.vendor === '—' ? '' : r.vendor, r.requestor, r.owner === '—' ? '' : r.owner].some(v => v && String(v).toLowerCase().indexOf(q) >= 0)) return false;
    }
    if (f.dept && r.deptId !== f.dept) return false;
    if (f.owner && r.ownerUserId !== f.owner) return false;
    if (f.stage && r.stageId !== f.stage) return false;
    if (f.group && r.group !== f.group) return false;
    if (f.actStatus && r.statusName !== f.actStatus) return false;
    if (f.vendor && r.vendorId !== f.vendor) return false;
    if (f.category && r.categoryId !== f.category) return false;
    if (f.priority && r.priority !== f.priority) return false;
    if (!blank(f.ageingMin) && !(r.ageingDays >= f.ageingMin && r.activityId)) return false;
    if (f.due) {
      if (!r.dueAt || (!isOpen(r) && r.status !== 'Draft')) return false;
      const d = U.daysBetween(now, r.dueAt);
      if (f.due === 'overdue' && !(r.overdueDays > 0)) return false;
      if (f.due === 'today' && d !== 0) return false;
      if (f.due === 'week' && !(d >= 0 && d <= 7 && now <= r.dueAt)) return false;
    }
    if (!blank(f.valueMin) && !((Number(r.value) || 0) >= f.valueMin)) return false;
    if (!blank(f.valueMax) && !((Number(r.value) || 0) <= f.valueMax)) return false;
    if (f.advance && r.advanceKey !== f.advance) return false;
    if (f.payment && r.paymentKey !== f.payment) return false;
    if (f.mine && !isMine(r, user)) return false;
    if (f.ownerRole && !(isOpen(r) && (r.actOwnerRole === f.ownerRole || r.actOwnerRoleId === f.ownerRole))) return false;
    if (!blank(f.advanceAgeingMin) && !(r.advMaxAge != null && r.advMaxAge >= f.advanceAgeingMin)) return false;
    return true;
  }

  /* ---------------- labels for chips ---------------- */
  function chipLabel(state, k, v) {
    const role = id => (E.role(state, id) || {}).name || id;
    const stageName = id => { const s = (E.activeVersion(state).stages || []).find(x => x.id === id); return s ? s.name : id; };
    const groupName = id => (U.byId(state.masters.towerGroups, id) || {}).label || id;
    switch (k) {
      case 'q': return `Search: “${v}”`;
      case 'dept': return `Department: ${S.deptName(state, v)}`;
      case 'owner': return `Ball with: ${E.userName(state, v)}`;
      case 'stage': return `Stage: ${stageName(v)}`;
      case 'group': return `Stage group: ${groupName(v)}`;
      case 'actStatus': return `Status: ${v}`;
      case 'vendor': return `Vendor: ${S.vendorName(state, v)}`;
      case 'category': return `Category: ${S.catName(state, v)}`;
      case 'priority': return `Priority: ${S.priorityName(state, v)}`;
      case 'ageingMin': return `Ageing ≥ ${fmt.days(v)}`;
      case 'due': return `Due: ${(DUE_OPTS.find(o => o.value === v) || { label: v }).label}`;
      case 'valueMin': return `Value ≥ ${fmt.inrShort(v)}`;
      case 'valueMax': return `Value ≤ ${fmt.inrShort(v)}`;
      case 'advance': return `Advance: ${v}`;
      case 'payment': return `Payment: ${v}`;
      case 'mine': return 'Mine (ball with me or raised by me)';
      case 'ownerRole': return `Pending with: ${role(v)}`;
      case 'advanceAgeingMin': return `Advance outstanding ≥ ${fmt.days(v)}`;
      default: return `${k}: ${v}`;
    }
  }

  /* ---------------- columns (table + export share one definition) ---------------- */
  function columns(state) {
    const dash = '<span class="muted">—</span>';
    return [
      { key: 'id', label: 'Purchase ID', cls: 'pl-c-id', render: r => `<b class="mono">${esc(r.id)}</b><span class="sub mono">${r.prNo ? esc(r.prNo) : 'No PR no. yet'}</span>` },
      { key: 'title', label: 'Title', cls: 'pl-c-title', render: r => `<span class="pl-title" title="${esc(r.title)}">${esc(r.title)}</span>${r.openExceptions ? `<span class="sub" style="color:var(--red)">${I('alert', 11)} ${r.openExceptions} open exception${r.openExceptions === 1 ? '' : 's'}</span>` : `<span class="sub">${esc(r.requestor)}</span>`}` },
      { key: 'category', label: 'Category', hideOnMobile: true, render: r => `<span class="pl-wrap2">${esc(r.category)}</span>` },
      { key: 'dept', label: 'Department', hideOnMobile: true },
      { key: 'value', label: 'Value', align: 'right', render: r => `${ui.money(r.value)}<span class="sub">${r.poNumber ? 'PO value' : 'Estimate'}</span>` },
      { key: 'stage', label: 'Stage', sort: r => r.stageId || ('Z' + r.stage), render: r => `<span class="nowrap">${esc(r.stage)}</span>${r.stageId ? `<span class="sub">${esc(stageNo(state, r))}</span>` : ''}` },
      { key: 'owner', label: 'Ball with', sort: r => r.ownerUserId ? r.owner : '~', render: r => r.ownerUserId ? ui.person(state, r.ownerUserId, { subText: r.withLabel }) : dash },
      { key: 'activity', label: 'Current activity', hideOnMobile: true, cls: 'pl-c-act', sort: r => r.activityId ? r.activity : '~', render: r => r.activityId ? `<span class="pl-1l" title="${esc(r.activity)}">${esc(r.activity)}</span><span class="sub pl-1l" title="Next: ${esc(r.nextAction)}">Next: ${esc(r.nextAction)}${r.waitingOn ? ` · waiting on ${esc(r.waitingOn)}` : ''}</span>` : dash },
      { key: 'dueAt', label: 'Due', render: r => r.dueAt ? ui.due(r.dueAt, { date: true }) : dash },
      { key: 'ageingDays', label: 'Ageing', align: 'right', sort: r => r.activityId ? r.ageingDays : -1, render: r => r.activityId ? `${ui.ageing(r.ageingDays)}<span class="sub" title="Age since created">${esc(fmt.days(r.ageDays))} total</span>` : `<span class="muted">${esc(fmt.days(r.ageDays))} total</span>` },
      { key: 'statusName', label: 'Status', render: r => statusBadge(state, r) },
      { key: 'priority', label: 'Priority', hideOnMobile: true, render: r => ui.priority(state, r.priority) },
      { key: 'vendor', label: 'Vendor', hideOnMobile: true, sort: r => r.vendorId ? r.vendor : '~', render: r => r.vendorId ? `<span class="pl-wrap2">${esc(r.vendor)}</span>${r.poNumber ? `<span class="sub mono">${esc(r.poNumber)}</span>` : ''}` : dash },
      { key: 'advanceStatus', label: 'Advance', hideOnMobile: true, sort: r => r.advanceKey === 'None' ? '~' : r.advanceKey, render: r => advBadge(state, r) },
      { key: 'paymentStatus', label: 'Payment', hideOnMobile: true, sort: r => r.paymentKey === 'None' ? '~' : r.paymentKey, render: r => payBadge(state, r) }
    ];
  }
  function stageNo(state, r) {
    const i = (r.p.stages || []).findIndex(s => s.stageId === r.stageId);
    return i >= 0 ? `Stage ${i + 1} of ${r.p.stages.length}` : '';
  }
  function advBadge(state, r) {
    if (r.advanceKey === 'None') return '<span class="muted">—</span>';
    if (r.advanceKey === 'Planned') return `${ui.badge('Planned', 'grey')}<span class="sub">${esc(String(r.p.flags.advancePct || 0))}% after PO</span>`;
    return `${ui.status(state, 'advance', r.advanceStatus)}${r.advanceOutstanding > 0 ? `<span class="sub">${esc(fmt.inr(r.advanceOutstanding))} outstanding</span>` : ''}`;
  }
  function payBadge(state, r) {
    if (r.paymentKey === 'None') return '<span class="muted">—</span>';
    return `${ui.status(state, 'payment', r.paymentStatus)}${r.pendingPayment > 0 ? `<span class="sub">${esc(fmt.inr(r.pendingPayment))} pending</span>` : ''}`;
  }

  /** Phone layout: one card per purchase answering what / where / who has the ball / when / how much. */
  function mobileList(state, rows, emptyMsg) {
    if (!rows.length) return `<div class="pl-mlist"><div class="table-empty">${esc(emptyMsg)}</div></div>`;
    const total = U.sum(rows, r => r.value);
    return `<div class="pl-mlist">${rows.map(r => {
      const tone = r.overdueDays > 0 && isOpen(r) ? 'red' : r.blocked && isOpen(r) ? 'orange' : '';
      return `<a class="pl-mcard ${tone ? 'tone-' + tone : ''}" href="#/purchases/${esc(r.id)}">
        <div class="pl-m1"><b class="mono">${esc(r.id)}</b>${statusBadge(state, r)}</div>
        <div class="pl-m2">${esc(r.title)}</div>
        <div class="pl-m3">${esc(r.stage)}${r.ownerUserId ? ` · Ball with <b>${esc(r.owner)}</b>` : ''}</div>
        <div class="pl-m4"><span>${r.dueAt ? ui.due(r.dueAt) : '<span class="muted">—</span>'}</span><b>${ui.money(r.value)}</b></div>
      </a>`;
    }).join('')}<div class="pl-mtotal"><span>Total · ${rows.length} purchase${rows.length === 1 ? '' : 's'}</span><b>${esc(fmt.inr(total))}</b></div></div>`;
  }

  /** Export columns: plain values (numbers stay numbers for Excel). */
  function exportColumns(state) {
    const d = t => t ? fmt.date(t) : '';
    return [
      { key: 'id', label: 'Purchase ID' },
      { key: 'prNo', label: 'PR No', value: r => r.prNo || '' },
      { key: 'title', label: 'Title' },
      { key: 'category', label: 'Category' },
      { key: 'dept', label: 'Department' },
      { key: 'requestor', label: 'Requestor' },
      { key: 'value', label: 'Value (INR)', value: r => Math.round(Number(r.value) || 0) },
      { key: 'valueBasis', label: 'Value basis', value: r => r.poNumber ? 'PO value' : 'Estimate' },
      { key: 'stage', label: 'Stage' },
      { key: 'owner', label: 'Ball with', value: r => r.ownerUserId ? r.owner : '' },
      { key: 'withLabel', label: 'Ball with (department)', value: r => r.ownerUserId ? r.withLabel : '' },
      { key: 'activity', label: 'Current activity', value: r => r.activityId ? r.activity : '' },
      { key: 'nextAction', label: 'Next action', value: r => r.activityId ? r.nextAction : '' },
      { key: 'dueAt', label: 'Due date', value: r => d(r.dueAt) },
      { key: 'overdueDays', label: 'Overdue days', value: r => r.overdueDays || 0 },
      { key: 'ageingDays', label: 'Ageing with owner (days)', value: r => r.activityId ? r.ageingDays : '' },
      { key: 'ageDays', label: 'Age since created (days)', value: r => r.ageDays },
      { key: 'statusName', label: 'Status' },
      { key: 'priority', label: 'Priority', value: r => `${r.priority} ${r.priorityName}` },
      { key: 'vendor', label: 'Vendor', value: r => r.vendorId ? r.vendor : '' },
      { key: 'poNumber', label: 'PO number', value: r => r.poNumber || '' },
      { key: 'advanceStatus', label: 'Advance status', value: r => r.advanceKey === 'None' ? '' : r.advanceStatus },
      { key: 'advanceOutstanding', label: 'Advance outstanding (INR)', value: r => Math.round(r.advanceOutstanding || 0) },
      { key: 'paymentStatus', label: 'Payment status', value: r => r.paymentKey === 'None' ? '' : r.paymentStatus },
      { key: 'pendingPayment', label: 'Pending payment (INR)', value: r => Math.round(r.pendingPayment || 0) },
      { key: 'openExceptions', label: 'Open exceptions' },
      { key: 'processVersion', label: 'Process version', value: r => 'V' + r.processVersion },
      { key: 'createdAt', label: 'Created', value: r => d(r.createdAt) }
    ];
  }

  /* ---------------- computing the screen ---------------- */
  function compute(ctx) {
    const { state, user } = ctx;
    syncFromQuery(ctx);
    const f = ctx.local.f || {};
    const view = VIEW_IDS.includes(ctx.local.view) ? ctx.local.view : 'all';
    const all = buildRows(state, user);
    const base = all.filter(r => filterMatch(r, f, user));
    const counts = {};
    VIEWS.forEach(v => { counts[v.id] = base.filter(r => viewMatch(r, v.id, user)).length; });
    const shown = base.filter(r => viewMatch(r, view, user));
    const sort = ctx.local.plSort || { col: 'id', dir: 'desc' };
    return { all, base, shown, counts, f, view, sort };
  }

  /** Same ordering the table uses, so the export is exactly what is on screen. */
  function sortRows(rows, cols, sort) {
    const col = cols.find(c => c.key === sort.col);
    if (!col) return rows;
    const fn = typeof col.sort === 'function' ? col.sort : (r => r[col.key]);
    return U.sortBy(rows, r => { const v = fn(r); return v == null ? (sort.dir === 'desc' ? -Infinity : Infinity) : (typeof v === 'string' ? v.toLowerCase() : v); }, sort.dir);
  }

  /* ---------------- render pieces ---------------- */
  function selectField(key, label, options, value, opts) {
    opts = opts || {};
    const optHtml = list => list.map(o => { const x = typeof o === 'object' ? o : { value: o, label: o }; return `<option value="${esc(x.value)}" ${String(x.value) === String(value == null ? '' : value) ? 'selected' : ''}>${esc(x.label)}</option>`; }).join('');
    const body = opts.groups ? opts.groups.map(g => `<optgroup label="${esc(g.label)}">${optHtml(g.options)}</optgroup>`).join('') : optHtml(options);
    return `<div class="field"><label for="pl-f-${key}">${esc(label)}</label><select id="pl-f-${key}" data-act-change="pl-set" data-key="${esc(opts.key || key)}"><option value="">${esc(opts.any || 'Any')}</option>${body}</select></div>`;
  }
  function numberField(key, label, value, placeholder) {
    return `<input type="number" min="0" step="any" id="pl-f-${key}" data-act-change="pl-set" data-key="${key}" value="${blank(value) ? '' : esc(value)}" placeholder="${esc(placeholder || '')}" aria-label="${esc(label)}">`;
  }

  function advancedPanel(ctx, m) {
    const { state } = ctx;
    const f = m.f;
    const ver = E.activeVersion(state);
    const ownerIds = U.uniq(m.all.map(r => r.ownerUserId).filter(Boolean).concat(f.owner ? [f.owner] : []));
    const owners = U.sortBy(ownerIds.map(id => ({ value: id, label: E.userName(state, id) })), o => o.label);
    const vendorIds = U.uniq(m.all.map(r => r.vendorId).filter(Boolean).concat(f.vendor ? [f.vendor] : []));
    const vendors = U.sortBy(vendorIds.map(id => ({ value: id, label: S.vendorName(state, id) })), o => o.label);
    const stageValue = f.group ? 'G:' + f.group : f.stage ? 'S:' + f.stage : '';
    const roleOpts = state.masters.roles.map(r => ({ value: r.id, label: r.name }));
    return `<div class="pl-adv" id="pl-adv">
      ${selectField('dept', 'Department', state.masters.departments.map(d => ({ value: d.id, label: d.name })), f.dept)}
      ${selectField('owner', 'Ball with (owner)', owners, f.owner, { any: 'Anyone' })}
      ${selectField('stage', 'Stage', [], stageValue, { groups: [
        { label: 'Stage group', options: state.masters.towerGroups.map(g => ({ value: 'G:' + g.id, label: g.label })) },
        { label: `Stage (Process V${ver.version})`, options: ver.stages.map(s => ({ value: 'S:' + s.id, label: `${s.seq}. ${s.name}` })) }
      ] })}
      ${selectField('actStatus', 'Status', STATUS_OPTS, f.actStatus)}
      ${selectField('vendor', 'Vendor', vendors, f.vendor)}
      ${selectField('category', 'Category', state.masters.categories.map(c => ({ value: c.id, label: c.name })), f.category)}
      ${selectField('priority', 'Priority', state.masters.priorities.map(p => ({ value: p.id, label: `${p.id} · ${p.name}` })), f.priority)}
      ${selectField('due', 'Due date', DUE_OPTS, f.due)}
      <div class="field"><label for="pl-f-ageingMin">Ageing with owner (min days)</label>${numberField('ageingMin', 'Ageing minimum days', f.ageingMin, 'e.g. 3')}</div>
      <div class="field"><label for="pl-f-valueMin">Value (₹ min – max)</label><div class="pl-range">${numberField('valueMin', 'Minimum value', f.valueMin, 'Min')}<span class="muted">–</span>${numberField('valueMax', 'Maximum value', f.valueMax, 'Max')}</div></div>
      ${selectField('advance', 'Advance status', ADV_OPTS, f.advance)}
      ${selectField('payment', 'Payment status', PAY_OPTS, f.payment)}
      ${selectField('ownerRole', 'Pending with role', roleOpts, f.ownerRole)}
      <div class="field"><label for="pl-f-advanceAgeingMin">Advance outstanding (min days)</label>${numberField('advanceAgeingMin', 'Advance outstanding minimum days', f.advanceAgeingMin, 'e.g. 31')}</div>
      <div class="field pl-adv-foot"><label class="check"><input type="checkbox" data-act-change="pl-set" data-key="mine" ${f.mine ? 'checked' : ''}> Only mine (ball with me or raised by me)</label></div>
    </div>`;
  }

  function savedBar(ctx, m) {
    const { state, user } = ctx;
    const list = (state.savedFilters || []).filter(sf => !sf.ownerUserId || sf.ownerUserId === user.id);
    const cur = canon(m.view, m.f);
    const hasAny = m.view !== 'all' || Object.keys(serialize('all', m.f)).length > 0;
    const chips = list.map(sf => {
      const n = normalize(sf.filters);
      const on = canon(n.view, n.f) === cur;
      const own = sf.ownerUserId === user.id;
      return `<span class="chip pl-chip ${on ? 'active' : ''}" title="${own ? 'Your saved filter' : 'Standard filter'}"><button type="button" data-act="pl-saved" data-id="${esc(sf.id)}">${own ? I('user', 12) : I('filter', 12)} ${esc(sf.name)}</button>${own ? `<button type="button" class="x" data-act="pl-saved-del" data-id="${esc(sf.id)}" aria-label="Delete saved filter ${esc(sf.name)}" title="Delete">${I('x', 12)}</button>` : ''}</span>`;
    }).join('');
    return `<div class="pl-saved"><span class="overline">Saved filters</span>${chips}<button type="button" class="btn btn-xs btn-ghost" data-act="pl-save" ${hasAny ? '' : 'disabled title="Set a filter first"'}>${I('plus', 12)} Save current filter</button></div>`;
  }

  function activeChips(ctx, m) {
    const { state } = ctx;
    const keys = F_KEYS.filter(k => !blank(m.f[k]));
    if (!keys.length) return '';
    return `<div class="pl-active"><span class="small muted">Filtered by</span>${keys.map(k => `<button type="button" class="chip" data-act="pl-clear" data-key="${k}" title="Remove this filter">${esc(chipLabel(state, k, m.f[k]))} <span class="x">${I('x', 12)}</span></button>`).join('')}<button type="button" class="btn btn-xs btn-ghost" data-act="pl-clear-all">Clear all</button></div>`;
  }

  function footRow(cols, m) {
    const rows = m.shown;
    const total = U.sum(rows, r => r.value);
    const live = rows.filter(r => r.status !== 'Rejected' && r.status !== 'Cancelled');
    const liveTotal = U.sum(live, r => r.value);
    const excl = live.length !== rows.length;
    const od = rows.filter(r => r.overdueDays > 0).length;
    return `<tr>${cols.map((c, i) => {
      const cls = `${c.align === 'right' ? 'num' : ''} ${c.cls || ''} ${c.hideOnMobile ? 'hide-m' : ''}`;
      if (i === 0) return `<td class="${cls}">Total · ${rows.length} purchase${rows.length === 1 ? '' : 's'}${od ? `<span class="sub" style="color:var(--red)">${od} overdue</span>` : ''}</td>`;
      if (c.key === 'value') return `<td class="${cls}" id="pl-total">${ui.money(total)}${excl ? `<span class="sub" title="Rejected / cancelled purchases excluded">${esc(fmt.inr(liveTotal))} excl. rejected</span>` : ''}</td>`;
      return `<td class="${cls}"></td>`;
    }).join('')}</tr>`;
  }

  /* ---------------- page ---------------- */
  PCT.pages.register({
    route: 'purchases',
    title: 'Purchases',
    render(ctx) {
      const { state, user } = ctx;
      css();
      const m = compute(ctx);
      const cols = columns(state);
      const advN = activeCount(m.f);
      const views = VIEWS.filter(v => !v.optional || m.counts[v.id] || m.view === v.id);
      const canCreate = ctx.can('purchase.create');

      const head = ui.pageHead({
        title: 'Purchases', icon: 'cart',
        sub: `The purchase register — every purchase, where it is, who has the ball and what happens next. ${m.all.length === state.purchases.length ? '' : `<span class="tag">${m.all.length} visible to you</span>`}`,
        actions: `<button type="button" class="btn" data-act="pl-export" ${m.shown.length ? '' : 'disabled'}>${I('download', 16)} Export to Excel</button>${canCreate ? `<a class="btn btn-primary" href="#/purchases/new">${I('plus', 16)} Create PR</a>` : ''}`
      });

      const toolbar = `<div class="pl-toolbar">
        <div class="pl-search">${I('search', 15)}<input type="search" id="pl-q" autocomplete="off" placeholder="Search Purchase ID, PR, PO, title, vendor, requestor…" value="${esc(m.f.q || '')}" data-act-input="pl-q" aria-label="Search purchases"></div>
        <button type="button" class="btn ${ctx.local.showAdv ? 'btn-primary' : ''}" data-act="pl-adv" aria-expanded="${ctx.local.showAdv ? 'true' : 'false'}">${I('filter', 15)} Filters${advN ? ` <span class="pl-count">${advN}</span>` : ''}</button>
      </div>`;

      const tabs = ui.tabs('view', views.map(v => ({ id: v.id, label: v.label, count: m.counts[v.id] })), m.view);

      const sorted = sortRows(m.shown, cols, m.sort);
      const emptyMsg = m.all.length ? 'No purchases match these filters. Remove a filter chip or clear all.' : 'No purchases yet.';
      const table = ui.table(cols, sorted, {
        key: 'pl', sort: m.sort, dense: true,
        rowHref: r => `#/purchases/${r.id}`,
        rowClass: r => r.overdueDays > 0 && isOpen(r) ? 'row-red' : r.blocked && isOpen(r) ? 'row-orange' : '',
        empty: emptyMsg,
        foot: m.shown.length ? footRow(cols, m) : ''
      });

      const value = U.sum(m.shown, r => r.value);
      const od = m.shown.filter(r => r.overdueDays > 0 && isOpen(r)).length;
      const sub = `${m.shown.length} purchase${m.shown.length === 1 ? '' : 's'} · ${esc(fmt.inr(value))}${od ? ` · <span style="color:var(--red);font-weight:600">${od} overdue</span>` : ''} · click a row to open it`;

      return head
        + `<section class="card mb-16 pl-controls">
            <div class="card-body">
              ${toolbar}
              ${ctx.local.showAdv ? advancedPanel(ctx, m) : ''}
              ${savedBar(ctx, m)}
              ${activeChips(ctx, m)}
            </div>
          </section>`
        + `<section class="card pl-card"><div class="pl-tabs">${tabs}</div>
            <div class="pl-sum small muted">${sub}</div>
            <div class="pl-tablewrap">${table}</div>
            ${mobileList(state, sorted, emptyMsg)}
          </section>`;
    },

    after(ctx) {
      const fq = ctx.local._focusQ;
      if (fq) {
        ctx.local._focusQ = null;
        const el = document.getElementById('pl-q');
        if (el) { el.focus(); try { el.setSelectionRange(fq.s, fq.e); } catch (e) { /* ignore */ } }
      }
      const ff = ctx.local._focusF;
      if (ff) { ctx.local._focusF = null; const el = document.getElementById(ff); if (el) el.focus(); }
    },

    actions: {
      'pl-q'(ctx, el) {
        ctx.local.f = ctx.local.f || {};
        ctx.local.f.q = el.value;
        clearTimeout(qTimer);
        qTimer = setTimeout(() => {
          const cur = document.getElementById('pl-q');
          ctx.local._focusQ = cur && document.activeElement === cur ? { s: cur.selectionStart, e: cur.selectionEnd } : null;
          ctx.rerender();
        }, 180);
      },
      'pl-adv'(ctx) { ctx.local.showAdv = !ctx.local.showAdv; ctx.rerender(); },
      'pl-set'(ctx, el) {
        const k = el.dataset.key;
        ctx.local.f = ctx.local.f || {};
        const f = ctx.local.f;
        if (k === 'stage') {
          delete f.stage; delete f.group;
          const v = el.value;
          if (/^G:/.test(v)) f.group = v.slice(2);
          else if (/^S:/.test(v)) f.stage = v.slice(2);
        } else if (k === 'mine') {
          if (el.checked) f.mine = true; else delete f.mine;
        } else if (NUM_KEYS.includes(k)) {
          const v = el.value === '' ? null : Number(el.value);
          if (v == null || isNaN(v) || v < 0) delete f[k]; else f[k] = v;
        } else if (el.value) f[k] = el.value;
        else delete f[k];
        ctx.local._focusF = el.id || null;
        ctx.rerender();
      },
      'pl-clear'(ctx, el) {
        const f = ctx.local.f || {};
        delete f[el.dataset.key];
        ctx.rerender();
      },
      'pl-clear-all'(ctx) {
        ctx.local.f = {};
        ctx.local.view = 'all';
        ctx.rerender();
      },
      'pl-saved'(ctx, el) {
        const sf = (ctx.state.savedFilters || []).find(x => x.id === el.dataset.id);
        if (!sf) return;
        const n = normalize(sf.filters);
        ctx.local.f = n.f;
        ctx.local.view = n.view;
        ctx.rerender();
      },
      'pl-save'(ctx) {
        const m = compute(ctx);
        const summary = [m.view !== 'all' ? `View: ${(VIEWS.find(v => v.id === m.view) || {}).label}` : null].concat(F_KEYS.filter(k => !blank(m.f[k])).map(k => chipLabel(ctx.state, k, m.f[k]))).filter(Boolean);
        ctx.modal.open({
          title: 'Save current filter',
          body: `${ui.field({ name: 'name', id: 'pl-sf-name', label: 'Name', required: true, placeholder: 'e.g. IT purchases over ₹5 lakh' })}
            <div class="mt-12 small muted">This filter will be saved for you (${esc(ctx.user.name)}) and appear under Saved filters:</div>
            <div class="row wrap mt-8">${summary.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
            <div id="pl-sf-err" class="mt-8"></div>`,
          actions: [{ label: 'Cancel', act: 'close' }, { label: 'Save filter', act: 'save', tone: 'primary' }],
          onAction: {
            save: v => {
              const name = String(v.name || '').trim();
              const err = document.getElementById('pl-sf-err');
              if (!name) { if (err) err.innerHTML = ui.alert('danger', 'Enter a name for the filter.'); return false; }
              const dup = (ctx.state.savedFilters || []).some(sf => (sf.ownerUserId === ctx.user.id || !sf.ownerUserId) && String(sf.name).toLowerCase() === name.toLowerCase());
              if (dup) { if (err) err.innerHTML = ui.alert('danger', 'A saved filter with this name already exists.'); return false; }
              const rec = { id: 'SF-' + U.uid(), name, ownerUserId: ctx.user.id, filters: serialize(m.view, m.f), createdAt: PCT.clock.now() };
              const res = ctx.commit(s => { s.savedFilters = s.savedFilters || []; s.savedFilters.push(rec); }, `Saved filter “${name}”`);
              return res && res.ok === false ? false : undefined;
            }
          }
        });
      },
      'pl-saved-del'(ctx, el) {
        const sf = (ctx.state.savedFilters || []).find(x => x.id === el.dataset.id);
        if (!sf || sf.ownerUserId !== ctx.user.id) { ctx.toast('You can delete only your own saved filters.', 'red'); return; }
        ctx.confirm({ title: 'Delete saved filter?', text: `“${esc(sf.name)}” will be removed from your saved filters.`, confirmLabel: 'Delete', tone: 'danger' }).then(ok => {
          if (!ok) return;
          ctx.commit(s => {
            const i = (s.savedFilters || []).findIndex(x => x.id === sf.id && x.ownerUserId === ctx.user.id);
            if (i < 0) return { ok: false, error: 'Saved filter not found.' };
            s.savedFilters.splice(i, 1);
          }, `Deleted “${sf.name}”`);
        });
      },
      'pl-export'(ctx) {
        const m = compute(ctx);
        const rows = sortRows(m.shown, columns(ctx.state), m.sort);
        if (!rows.length) { ctx.toast('Nothing to export — no purchases match the filters.', 'red'); return; }
        const cols = exportColumns(ctx.state);
        const stamp = U.toInputDate(PCT.clock.now());
        try {
          if (PCT.excel && typeof PCT.excel.exportWorkbook === 'function') {
            PCT.excel.exportWorkbook('Purchase_Tracker.xlsx', [{ name: 'Purchases', columns: cols, rows }]);
            ctx.toast(`Exported ${rows.length} purchase${rows.length === 1 ? '' : 's'} to Purchase_Tracker.xlsx`, 'green');
          } else {
            U.download(`Purchase_Tracker_${stamp}.csv`, '\ufeff' + U.toCSV(rows, cols), 'text/csv;charset=utf-8');
            ctx.toast(`Exported ${rows.length} purchase${rows.length === 1 ? '' : 's'} as CSV (Excel module not loaded)`, 'green');
          }
        } catch (e) {
          console.error(e);
          ctx.toast('Export failed: ' + e.message, 'red');
        }
      }
    }
  });
  let qTimer = null;

  /* ---------------- page CSS ---------------- */
  function css() {
    ui.css('page-purchases', `
      .pl-controls .card-body { display: flex; flex-direction: column; gap: 12px; }
      .pl-toolbar { display: flex; gap: 8px; align-items: center; }
      .pl-search { position: relative; flex: 1; max-width: 560px; }
      .pl-search .ic { position: absolute; left: 11px; top: 11px; color: var(--faint); }
      .pl-search input { width: 100%; height: 36px; border: 1px solid #D5DCE6; border-radius: 8px; padding: 0 10px 0 34px; font: 13.5px var(--font); color: var(--ink); background: #fff; }
      .pl-search input:focus { outline: none; border-color: var(--blue-500); box-shadow: 0 0 0 3px var(--blue-100); }
      .pl-count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--blue-600); color: #fff; font-size: 11px; }
      .btn-primary .pl-count { background: #fff; color: var(--navy-700); }
      .pl-adv { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 14px; padding: 14px; border: 1px solid var(--line-2); border-radius: 9px; background: #FAFBFD; }
      .pl-adv .field input[type=number] { width: 100%; height: 36px; border: 1px solid #D5DCE6; border-radius: 8px; padding: 0 10px; font: 13.5px var(--font); background: #fff; }
      .pl-adv .field input[type=number]:focus { outline: none; border-color: var(--blue-500); box-shadow: 0 0 0 3px var(--blue-100); }
      .pl-range { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px; align-items: center; }
      .pl-adv-foot { justify-content: flex-end; padding-bottom: 8px; }
      .pl-saved, .pl-active { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .pl-saved .overline, .pl-active > .small { margin-right: 4px; }
      .pl-chip { padding: 0; gap: 0; }
      .pl-chip button { border: 0; background: none; font: inherit; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 16px; }
      .pl-chip button.x { padding: 4px 8px 4px 2px; opacity: .65; }
      .pl-chip button.x:hover { opacity: 1; color: var(--red); }
      .pl-chip.active button.x:hover { color: #fff; }
      .pl-card .pl-tabs { padding: 0 8px; }
      .pl-sum { padding: 8px 14px; border-bottom: 1px solid var(--line-2); }
      .pl-tablewrap .table-wrap { max-height: calc(100vh - 150px); overflow: auto; }
      .pl-tablewrap .tbl th { z-index: 2; }
      .pl-tablewrap .tbl td.pl-c-id, .pl-tablewrap .tbl th.pl-c-id { position: sticky; left: 0; background: #fff; z-index: 1; box-shadow: inset -1px 0 0 var(--line-2); }
      .pl-tablewrap .tbl th.pl-c-id { background: #F8FAFC; z-index: 3; }
      .pl-tablewrap .tbl tfoot td.pl-c-id { background: #F8FAFC; }
      .pl-tablewrap .tbl tbody tr.clickable:hover td.pl-c-id { background: #F8FAFF; }
      .pl-tablewrap .tbl tr.row-red td.pl-c-id { box-shadow: inset 3px 0 0 var(--red), inset -1px 0 0 var(--line-2); }
      .pl-tablewrap .tbl tr.row-orange td.pl-c-id { box-shadow: inset 3px 0 0 var(--orange), inset -1px 0 0 var(--line-2); }
      .pl-tablewrap .tbl tfoot td { position: sticky; bottom: 0; z-index: 2; }
      .pl-tablewrap .tbl tfoot td.pl-c-id { z-index: 3; }
      .pl-tablewrap .tbl td.pl-c-id { white-space: nowrap; }
      .pl-1l { display: block; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pl-title { display: block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
      .pl-c-act { min-width: 200px; }
      .pl-wrap2 { display: inline-block; min-width: 110px; max-width: 170px; }
      .pl-tablewrap .person .ellipsis { max-width: 150px; }
      @media (max-width: 1200px) { .pl-adv { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      @media (max-width: 900px) { .pl-adv { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 10px; } .pl-tablewrap .table-wrap { max-height: none; } }
      .pl-mlist { display: none; }
      .pl-mcard { display: block; padding: 11px 14px; border-bottom: 1px solid var(--line-2); color: var(--ink); text-decoration: none !important; }
      .pl-mcard:active { background: #F8FAFF; }
      .pl-mcard.tone-red { box-shadow: inset 3px 0 0 var(--red); }
      .pl-mcard.tone-orange { box-shadow: inset 3px 0 0 var(--orange); }
      .pl-m1 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .pl-m2 { font-weight: 600; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pl-m3 { font-size: 12.5px; color: var(--ink-2); margin-top: 2px; }
      .pl-m4 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12.5px; margin-top: 4px; }
      .pl-mtotal { display: flex; justify-content: space-between; padding: 11px 14px; background: #F8FAFC; font-weight: 650; font-size: 13px; border-radius: 0 0 var(--radius) var(--radius); }
      @media (max-width: 560px) {
        .pl-tablewrap { display: none; }
        .pl-mlist { display: block; }
        .pl-toolbar { flex-wrap: wrap; }
        .pl-search { flex-basis: 100%; max-width: none; }
        .pl-toolbar .btn { flex: 1; }
        .pl-title { max-width: 150px; }
        .pl-adv-foot { grid-column: 1 / -1; }
      }
    `);
  }

  // expose helpers for other modules / tests (read-only)
  PCT.purchasesList = { normalize, serialize, viewMatch, filterMatch, buildRows };
})();
