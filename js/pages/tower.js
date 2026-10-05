/* =====================================================================
   PROCESS CONTROL TOWER — the whole pipeline on one screen.
   REQUIREMENT → PR → APPROVAL → RFQ → QUOTE → PO → ADVANCE → DELIVERY
   → INVOICE → PAYMENT → CLOSURE (state.masters.towerGroups, S.tower).
   Under each stage: open, completed, overdue, value. Click a stage to
   drill down; every row shows who has the ball and what happens next.
   Filters (department, owner, priority, overdue-only) live in ctx.local
   and can be deep-linked: #/tower?stage=APPROVAL&dept=DPT-IT&owner=U09
   &priority=P1&overdue=1&present=1
   ===================================================================== */
(function () {
  const { esc, I } = PCT.ui;
  const U = PCT.util;
  const E = PCT.engine;
  const fmt = U.fmt;

  const FILTER_KEYS = ['stage', 'dept', 'owner', 'priority', 'overdue'];
  const DEFAULTS = { stage: 'ALL', dept: '', owner: '', priority: '', overdue: false };
  const LEGEND = ['Not Started', 'In Progress', 'Waiting', 'Blocked', 'Completed', 'Overdue', 'Rejected'];

  PCT.ui.css('page-tower', `
    .tw-filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px; }
    .tw-filters label { font-size:12px; font-weight:600; color:var(--muted); display:inline-flex; align-items:center; gap:6px; }
    .tw-filters select.input { height:32px; width:auto; min-width:150px; max-width:230px; font-size:13px; }
    .tw-summary { display:flex; flex-wrap:wrap; gap:6px 18px; font-size:12.5px; color:var(--muted); }
    .tw-summary b { color:var(--ink); font-size:14px; font-variant-numeric:tabular-nums; }
    .tw-summary .od b { color:var(--red); } .tw-summary .bl b { color:var(--orange); } .tw-summary .wt b { color:var(--yellow); }
    .tw-root .pipeline { grid-template-columns: repeat(11, minmax(84px, 1fr)); }
    .tw-root .pipe { display:flex; flex-direction:column; min-width:0; }
    .tw-root .pipe .popen small { font-size:11px; font-weight:600; color:var(--muted); margin-left:3px; letter-spacing:0; }
    .tw-root .pipe.zero .popen { color:var(--faint); }
    .tw-root .pipe .pmeta .bl { color:var(--orange); font-weight:600; }
    .tw-root .pipe .pmeta .val { color:var(--ink-2); font-weight:650; margin-top:2px; }
    .tw-root .pipe .pname { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tw-id { white-space:nowrap; }
    .tw-m-only { display:none; }
    .tw-m-card { flex-direction:column; gap:5px; margin-top:6px; font-size:12.5px; }
    .tw-legend { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:12px; color:var(--muted); margin-top:12px; padding-top:10px; border-top:1px solid var(--line-2); }
    .tw-legend span { display:inline-flex; align-items:center; gap:6px; }
    .tw-legend b { color:var(--ink); font-variant-numeric:tabular-nums; }
    .tw-next { min-width:170px; max-width:280px; white-space:normal; }
    .tw-active-filters { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
    .tw-present-head { display:none; }
    /* Presentation view: hide the shell, enlarge the pipeline */
    body:has(.tw-present) .sidebar, body:has(.tw-present) .topbar { display:none !important; }
    body:has(.tw-present) .main { margin-left:0; }
    body:has(.tw-present) .view { max-width:none; padding:18px 28px 40px; }
    .tw-present .tw-hide-present { display:none !important; }
    .tw-present .tw-present-head { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:14px; }
    .tw-present .tw-present-head h1 { font-size:26px; display:flex; align-items:center; gap:10px; }
    .tw-present .pipeline { gap:12px; }
    .tw-present .pipe { padding:16px 14px; }
    .tw-present .pipe .pname { font-size:13px; }
    .tw-present .pipe .popen { font-size:42px; margin:6px 0 4px; }
    .tw-present .pipe .pmeta { font-size:13.5px; gap:2px; }
    .tw-present .tw-summary { font-size:14px; } .tw-present .tw-summary b { font-size:20px; }
    @media (max-width: 1320px) {
      .tw-root:not(.tw-present) .pipeline { grid-template-columns: repeat(6, minmax(0, 1fr)); }
      .tw-root:not(.tw-present) .pipe::after { display:none; }
    }
    @media (max-width: 1100px) {
      .tw-present .pipeline { grid-template-columns: repeat(6, minmax(0, 1fr)); }
      .tw-present .pipe::after { display:none; }
    }
    @media (max-width: 900px) {
      .tw-root .pipeline { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
      .tw-filters { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items:end; }
      .tw-filters label { flex-direction:column; align-items:stretch; gap:4px; min-width:0; }
      .tw-filters select.input { min-width:0; max-width:none; width:100%; }
      .tw-filters .chip { justify-content:center; height:32px; }
      body:has(.tw-present) .view { padding:12px 12px 32px; }
    }
    @media (max-width: 560px) {
      .tw-root .pipeline { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap:6px; }
      .tw-root .pipe { padding:8px; }
      .tw-root .pipe .popen { font-size:20px; }
      .tw-present .pipe .popen { font-size:28px; }
      #tw-drill thead th:not(:first-child), #tw-drill tbody td:not(:first-child), #tw-drill tfoot,
      #tw-owners thead th:nth-child(2), #tw-owners tbody td:nth-child(2), #tw-owners thead th:nth-child(5), #tw-owners tbody td:nth-child(5),
      #tw-owners thead th:nth-child(6), #tw-owners tbody td:nth-child(6), #tw-owners tfoot { display:none; }
      .tw-m-only { display:block; }
      .tw-m-only.tw-m-card { display:flex; }
      .tw-focus-txt { display:none; }
      #tw-owners .tbl td, #tw-owners .tbl th { padding-left:8px; padding-right:8px; }
      .tw-root .pipe .pname { font-size:10.5px; letter-spacing:.02em; }
    }
  `);

  const isOpen = p => p.status === 'Open' || p.status === 'On Hold';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  /** Deep links: a fresh navigation carrying filter keys resets the filters and applies the query. */
  function syncQuery(ctx) {
    const L = ctx.local;
    const q = ctx.query || {};
    const qk = JSON.stringify(q);
    const onPage = !!document.querySelector('#view .tw-root');
    if (onPage && L._q === qk) return;
    L._q = qk;
    if (q.present != null) L.present = q.present === '1' || q.present === 'true';
    if (!FILTER_KEYS.some(k => q[k] != null)) return;
    const st = ctx.state;
    Object.assign(L, DEFAULTS);
    if (q.stage && st.masters.towerGroups.some(g => g.id === String(q.stage).toUpperCase())) L.stage = String(q.stage).toUpperCase();
    if (q.dept && E.dept(st, q.dept)) L.dept = q.dept;
    if (q.owner && E.user(st, q.owner)) L.owner = q.owner;
    if (q.priority && U.byId(st.masters.priorities, q.priority)) L.priority = q.priority;
    if (q.overdue != null) L.overdue = q.overdue === '1' || q.overdue === 'true';
  }

  function ensureDefaults(L) { Object.keys(DEFAULTS).forEach(k => { if (L[k] == null) L[k] = DEFAULTS[k]; }); }

  /** Who holds the ball on the given open rows, grouped by person. */
  function ballHolders(state, S, openRows) {
    const g = U.groupBy(openRows.filter(r => r.ownerUserId), 'ownerUserId');
    return Object.keys(g).map(uid => {
      const rs = g[uid];
      const u = E.user(state, uid) || {};
      const role = E.role(state, u.roleId) || {};
      return {
        id: uid, name: u.name || uid, roleName: role.name || '', dept: S.deptName(state, u.deptId),
        count: rs.length, overdue: rs.filter(r => r.overdueDays > 0).length, blocked: rs.filter(r => r.blocked).length,
        waiting: rs.filter(r => r.actStatus === 'Waiting').length,
        oldest: Math.max(0, ...rs.map(r => r.ageingDays || 0)), value: U.sum(rs, r => r.value)
      };
    }).sort((a, b) => (b.overdue - a.overdue) || (b.count - a.count) || (b.value - a.value));
  }

  function model(ctx) {
    const { state, user, S } = ctx;
    const L = ctx.local;
    const vis = S.visiblePurchases(state, user);
    // List-level filters (department, priority) apply to everything incl. completed throughput
    const base = vis.filter(p => (!L.dept || p.deptId === L.dept) && (!L.priority || p.priority === L.priority));
    const openBase = base.filter(isOpen);
    const rowById = new Map(S.rows(state, openBase).map(r => [r.id, r]));
    const passOverdue = p => !L.overdue || rowById.get(p.id).overdueDays > 0;
    const passOwner = p => !L.owner || rowById.get(p.id).ownerUserId === L.owner;
    const openF = openBase.filter(p => passOverdue(p) && passOwner(p));
    const towerBase = S.tower(state, base);
    const towerF = S.tower(state, openF);
    const pipe = towerF.map((g, i) => Object.assign({}, g, { completed: (towerBase[i] || {}).completed || 0 }));
    const stage = pipe.some(g => g.id === L.stage) ? L.stage : 'ALL';
    const sel = stage === 'ALL' ? null : pipe.find(g => g.id === stage);
    const drillRows = (sel ? sel.purchases : openF).map(p => rowById.get(p.id))
      .sort((a, b) => (b.overdueDays - a.overdueDays) || ((a.dueAt || Infinity) - (b.dueAt || Infinity)));
    // Owners: all open purchases under the list-level + overdue filters (not the owner/stage selection)
    const ownerRows = openBase.filter(passOverdue).map(p => rowById.get(p.id));
    const openRowsF = openF.map(p => rowById.get(p.id));
    // Live legend: every activity of the filtered open purchases, by display status
    const legend = {};
    openF.forEach(p => (p.activities || []).forEach(a => { const d = E.displayStatus(state, a); legend[d] = (legend[d] || 0) + 1; }));
    return { vis, base, openBase, openF, rowById, pipe, stage, sel, drillRows, ownerRows, openRowsF, legend, holders: ballHolders(state, S, ownerRows), allHolders: ballHolders(state, S, [...rowById.values()]) };
  }

  /* ---------------- pieces ---------------- */
  function summary(m) {
    const rs = m.openRowsF;
    const od = rs.filter(r => r.overdueDays > 0).length;
    const bl = rs.filter(r => r.blocked).length;
    const wt = rs.filter(r => r.actStatus === 'Waiting').length;
    return `<div class="tw-summary">
      <span><b>${rs.length}</b> open</span>
      <span><b>${esc(fmt.inrShort(U.sum(rs, r => r.value)))}</b> value</span>
      <span class="od"><b>${od}</b> overdue</span>
      <span class="bl"><b>${bl}</b> blocked</span>
      <span class="wt"><b>${wt}</b> waiting</span>
    </div>`;
  }

  function filters(ctx, m) {
    const { state } = ctx;
    const L = ctx.local;
    const deptIds = U.uniq(m.vis.map(p => p.deptId));
    const depts = state.masters.departments.filter(d => deptIds.includes(d.id) || d.id === L.dept);
    const owners = m.allHolders.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (L.owner && !owners.some(o => o.id === L.owner)) owners.unshift({ id: L.owner, name: E.userName(state, L.owner), count: 0 });
    const prios = state.masters.priorities.filter(p => p.status !== 'Inactive' || p.id === L.priority);
    const sel = (name, label, opts, val) => `<label>${esc(label)}<select class="input" data-act-change="tw-filter" data-key="${name}" aria-label="${esc(label)}">${opts.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(val || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    const odCount = [...m.rowById.values()].filter(r => r.overdueDays > 0 && (!L.owner || r.ownerUserId === L.owner)).length;
    const active = !!(L.dept || L.owner || L.priority || L.overdue || m.stage !== 'ALL');
    return `<div class="tw-filters">
      ${sel('dept', 'Department', [{ value: '', label: 'All departments' }].concat(depts.map(d => ({ value: d.id, label: d.name }))), L.dept)}
      ${sel('owner', 'Ball with', [{ value: '', label: 'Everyone' }].concat(owners.map(o => ({ value: o.id, label: `${o.name}${o.count ? ` (${o.count})` : ''}` }))), L.owner)}
      ${sel('priority', 'Priority', [{ value: '', label: 'All priorities' }].concat(prios.map(p => ({ value: p.id, label: p.name }))), L.priority)}
      <button type="button" class="chip ${L.overdue ? 'active' : ''}" data-act="tw-overdue" aria-pressed="${L.overdue ? 'true' : 'false'}">${I('alert', 13)} Overdue only <b>${odCount}</b></button>
      ${active ? `<button type="button" class="btn btn-sm btn-ghost" data-act="tw-clear">${I('x', 14)} Clear filters</button>` : ''}
    </div>`;
  }

  function activeFilterChips(ctx, m) {
    const { state } = ctx;
    const L = ctx.local;
    const out = [];
    if (m.stage !== 'ALL') out.push(`Stage: ${(m.sel || {}).label || m.stage}`);
    if (L.dept) out.push(`Department: ${ctx.S.deptName(state, L.dept)}`);
    if (L.owner) out.push(`Ball with: ${E.userName(state, L.owner)}`);
    if (L.priority) out.push(`Priority: ${ctx.S.priorityName(state, L.priority)}`);
    if (L.overdue) out.push('Overdue only');
    return out.length ? `<div class="tw-active-filters">${out.map(t => `<span class="tag">${esc(t)}</span>`).join('')}<button type="button" class="btn btn-xs btn-ghost" data-act="tw-clear">${I('x', 12)} Clear</button></div>` : '';
  }

  function pipeline(ctx, m) {
    const { state, ui } = ctx;
    const pipes = m.pipe.map((g, i) => {
      const act = m.stage === g.id;
      return `<button type="button" class="pipe ${act ? 'active' : ''} ${g.overdue ? 'has-overdue' : ''} ${g.open ? '' : 'zero'}" data-act="tw-stage" data-id="${esc(g.id)}" aria-pressed="${act ? 'true' : 'false'}" title="${esc(g.label)}: ${g.open} open · ${g.completed} completed · ${g.overdue} overdue · ${fmt.inr(g.value)}">
        <span class="pname">${esc(g.label)}</span>
        <span class="popen">${g.open}<small>open</small></span>
        <span class="pmeta">
          <span>${g.completed} completed</span>
          <span class="${g.overdue ? 'od' : ''}">${g.overdue} overdue</span>
          ${g.blocked ? `<span class="bl">${g.blocked} blocked</span>` : ''}
          <span class="val">${g.open ? esc(fmt.inrShort(g.value)) : '—'}</span>
        </span>
      </button>`;
    }).join('');
    const statuses = LEGEND.map(n => state.masters.statuses.find(s => s.kind === 'activity' && s.name === n)).filter(Boolean);
    const legend = `<div class="tw-legend" aria-label="Activity status legend">${statuses.map(s => `<span title="${esc(s.name)}">${ui.dot(s.tone)}${esc(s.name)} <b>${m.legend[s.name] || 0}</b></span>`).join('')}<span class="muted">· activities in the ${plural(m.openF.length, 'open purchase')} shown</span></div>`;
    return ui.card({
      title: 'Pipeline — where every open purchase is now', icon: 'flow',
      sub: 'Click a stage to drill down · red top border = overdue at that stage',
      body: `<div class="mb-12">${summary(m)}</div><div class="pipeline" role="group" aria-label="Process stages">${pipes}</div>${legend}`
    });
  }

  function drill(ctx, m) {
    const { state, ui } = ctx;
    const rows = m.drillRows;
    const total = U.sum(rows, r => r.value);
    const od = rows.filter(r => r.overdueDays > 0).length;
    const bl = rows.filter(r => r.blocked).length;
    const people = U.uniq(rows.map(r => r.ownerUserId).filter(Boolean)).length;
    const label = m.sel ? m.sel.label : 'All stages';
    const table = ui.table([
      { key: 'id', label: 'Purchase', render: r => `<b class="mono tw-id">${esc(r.id)}</b>${r.priority === 'P1' || r.priority === 'P2' ? ' ' + ui.priority(state, r.priority) : ''}<span class="sub">${esc(r.title)}</span>
          <span class="tw-m-only tw-m-card"><span><span class="muted">Now:</span> ${esc(r.activity)}</span><span><span class="muted">Next:</span> <b>${esc(r.nextAction)}</b></span>${r.ownerUserId ? `<span class="row" style="gap:6px"><span class="muted">Ball with</span> ${ui.person(state, r.ownerUserId, { subText: r.withLabel })}</span>` : ''}<span class="row wrap" style="gap:8px">${ui.status(state, 'activity', r.actStatus)}${ui.due(r.dueAt)}<span class="strong">${ui.money(r.value)}</span></span></span>` },
      { key: 'activity', label: 'Current activity', render: r => `${esc(r.activity)}<span class="sub">${esc(r.stage)}</span>` },
      { key: 'owner', label: 'Ball with', render: r => r.ownerUserId ? ui.person(state, r.ownerUserId, { subText: r.withLabel }) : '<span class="muted">—</span>' },
      { key: 'nextAction', label: 'Next action', cls: 'tw-next', render: r => `${esc(r.nextAction)}${r.waitingOn ? `<span class="sub">Waiting on ${esc(r.waitingOn)}</span>` : ''}` },
      { key: 'dueAt', label: 'Due', sort: r => r.dueAt || Infinity, render: r => ui.due(r.dueAt) },
      { key: 'ageingDays', label: 'Ageing', align: 'right', render: r => ui.ageing(r.ageingDays) },
      { key: 'actStatus', label: 'Status', render: r => ui.status(state, 'activity', r.actStatus) },
      { key: 'value', label: 'Value', align: 'right', render: r => ui.money(r.value) }
    ], rows, {
      key: 'twDrill', sort: ctx.local.twDrillSort, rowHref: r => `#/purchases/${r.id}`,
      rowClass: r => r.overdueDays > 0 ? 'row-red' : r.blocked ? 'row-orange' : '',
      empty: m.openF.length ? `No open purchases at ${label} with these filters.` : 'No open purchases match these filters.',
      foot: rows.length ? `<tr><td colspan="7">Total · ${plural(rows.length, 'purchase')}</td><td class="num">${ui.money(total)}</td></tr>` : ''
    });
    const listHref = `#/purchases?status=open${m.sel ? `&group=${encodeURIComponent(m.sel.id)}` : ''}${ctx.local.dept ? `&dept=${encodeURIComponent(ctx.local.dept)}` : ''}${ctx.local.owner ? `&owner=${encodeURIComponent(ctx.local.owner)}` : ''}${ctx.local.priority ? `&priority=${encodeURIComponent(ctx.local.priority)}` : ''}`;
    return ui.card({
      id: 'tw-drill',
      title: `${esc(label)} <span class="badge tone-blue" style="margin-left:4px">${rows.length} open</span>`, icon: m.sel ? 'target' : 'layers',
      sub: `${esc(fmt.inr(total))} · ${od ? `<span style="color:var(--red);font-weight:600">${od} overdue</span>` : '0 overdue'} · ${bl ? `<span style="color:var(--orange);font-weight:600">${bl} blocked</span>` : '0 blocked'} · ball with ${plural(people, 'person', 'people')}`,
      actions: `${m.sel ? `<button type="button" class="btn btn-sm" data-act="tw-stage" data-id="ALL">${I('layers', 14)} All stages</button>` : ''}<a class="btn btn-sm btn-ghost tw-hide-present" href="${listHref}">Open in Purchases ${I('arrowRight', 13)}</a>`,
      flush: true, body: table
    });
  }

  function owners(ctx, m) {
    const { ui } = ctx;
    const L = ctx.local;
    const list = m.holders;
    const table = ui.table([
      { key: 'name', label: 'Person', render: r => `<span class="person">${ui.avatar(r.name, 'sm')}<span class="ellipsis"><span class="nm">${esc(r.name)}</span><small>${esc(r.dept)}</small></span></span>` },
      { key: 'roleName', label: 'Role' },
      { key: 'count', label: 'Open', align: 'right', render: r => `<b>${r.count}</b>` },
      { key: 'overdue', label: 'Overdue', align: 'right', render: r => r.overdue ? `<b style="color:var(--red)">${r.overdue}</b>` : '<span class="muted">0</span>' },
      { key: 'oldest', label: 'Oldest ageing', align: 'right', render: r => ui.ageing(r.oldest) },
      { key: 'value', label: 'Value', align: 'right', render: r => ui.money(r.value) },
      { key: 'focus', label: '', sort: false, render: r => `<button type="button" class="btn btn-xs ${L.owner === r.id ? 'btn-primary' : 'btn-ghost'}" data-act="tw-owner" data-id="${esc(r.id)}" title="${L.owner === r.id ? 'Show everyone' : 'Show only this person in the pipeline'}">${I('filter', 12)}<span class="tw-focus-txt"> ${L.owner === r.id ? 'Focused' : 'Focus'}</span></button>` }
    ], list, {
      key: 'twOwners', sort: L.twOwnersSort, rowHref: r => `#/purchases?owner=${encodeURIComponent(r.id)}`,
      rowClass: r => (L.owner === r.id ? 'row-selected ' : '') + (r.overdue ? 'row-red' : ''),
      empty: 'Nobody is holding an open purchase.',
      foot: list.length ? `<tr><td colspan="2">${plural(list.length, 'person', 'people')}</td><td class="num">${U.sum(list, r => r.count)}</td><td class="num">${U.sum(list, r => r.overdue)}</td><td></td><td class="num">${ui.money(U.sum(list, r => r.value))}</td><td></td></tr>` : ''
    });
    return ui.card({
      id: 'tw-owners',
      title: 'Who has the ball — all open purchases', icon: 'users',
      sub: `Grouped by the person who must act next${L.dept || L.priority || L.overdue ? ' · department / priority / overdue filters applied' : ''} · click a row for their purchases`,
      flush: true, body: table
    });
  }

  PCT.pages.register({
    route: 'tower',
    title: 'Process Control Tower',
    render(ctx) {
      const { state, ui } = ctx;
      syncQuery(ctx);
      ensureDefaults(ctx.local);
      const m = model(ctx);
      const present = !!ctx.local.present;
      const groups = state.masters.towerGroups.map(g => g.label.toUpperCase()).join(' → ');
      let scope = '';
      if (!ctx.can('purchase.view_all')) scope = ctx.can('purchase.view_dept') ? `${ctx.S.deptName(state, ctx.user.deptId)} department + purchases you are involved in` : 'purchases you raised or worked on';
      const pr = E.activeVersion(state) || {};
      const now = PCT.clock.now();
      const head = ui.pageHead({
        title: 'Process Control Tower', icon: 'tower',
        sub: `<span class="small">${esc(groups)}</span><br>Live · ${esc(fmt.date(now))} · Process V${esc(pr.version || '—')}${scope ? ` · <span class="tag">${I('eye', 11)} ${esc(scope)}</span>` : ''}`,
        actions: `<button type="button" class="btn btn-sm" data-act="tw-present">${I('play', 14)} Presentation view</button>`
      });
      const presentHead = `<div class="tw-present-head">
        <div><h1>${I('tower', 26)} Process Control Tower</h1><div class="muted">${esc(fmt.dateTime(now))} · Process V${esc(pr.version || '—')} · live${scope ? ` · ${esc(scope)}` : ''}</div></div>
        <div class="row wrap">${activeFilterChips(ctx, m)}<button type="button" class="btn btn-sm" data-act="tw-present">${I('x', 14)} Exit presentation</button></div>
      </div>`;
      const body = m.vis.length
        ? `${ui.card({ cls: 'mb-16 tw-hide-present', body: filters(ctx, m) })}
           <div class="mb-16">${pipeline(ctx, m)}</div>
           <div class="mb-16">${drill(ctx, m)}</div>
           ${owners(ctx, m)}`
        : ui.card({ body: ui.empty('tower', 'No purchases to show', 'Purchases you raise, approve or work on will appear in the pipeline.') });
      return `<div class="tw-root ${present ? 'tw-present' : ''}">
        <div class="tw-hide-present">${head}</div>
        ${presentHead}
        ${body}
      </div>`;
    },
    actions: {
      'tw-stage'(ctx, el) {
        const id = el.dataset.id;
        ctx.local.stage = !id || id === 'ALL' || ctx.local.stage === id ? 'ALL' : id;
        ctx.rerender();
      },
      'tw-filter'(ctx, el) {
        const k = el.dataset.key;
        if (!['dept', 'owner', 'priority'].includes(k)) return;
        ctx.local[k] = el.value || '';
        ctx.rerender();
      },
      'tw-overdue'(ctx) { ctx.local.overdue = !ctx.local.overdue; ctx.rerender(); },
      'tw-owner'(ctx, el) {
        ctx.local.owner = ctx.local.owner === el.dataset.id ? '' : el.dataset.id;
        ctx.rerender();
        const root = document.querySelector('.tw-root .pipeline');
        if (root && root.scrollIntoView) root.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      'tw-clear'(ctx) { Object.assign(ctx.local, DEFAULTS); ctx.rerender(); },
      'tw-present'(ctx) { ctx.local.present = !ctx.local.present; ctx.rerender(); window.scrollTo(0, 0); }
    }
  });

  // Escape leaves presentation view
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || !document.querySelector('.tw-present')) return;
    if (document.querySelector('#modal-root .modal')) return;
    const L = PCT.app && PCT.app.locals && PCT.app.locals.tower;
    if (L) { L.present = false; PCT.app.render(); }
  });
})();
