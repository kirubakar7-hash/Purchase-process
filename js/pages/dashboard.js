/* =====================================================================
   DASHBOARD — management dashboard that passes "the 30-second test".
   Every block answers one plain question:
     What is happening? · Where are the purchases? · What is delayed?
     Who has the ball? · What needs management attention?
     What is the financial exposure? · Where are the bottlenecks?
   Data is always limited to S.visiblePurchases(state, user) and every
   number is computed through PCT.sel / PCT.engine so it reconciles with
   the rest of the product.
   ===================================================================== */
(function () {
  const { esc, I } = PCT.ui;
  const U = PCT.util;
  const E = PCT.engine;
  const fmt = U.fmt;

  const PERIODS = [{ id: '7', label: '7d' }, { id: '30', label: '30d' }, { id: '90', label: '90d' }];
  const SEV_RANK = { High: 0, Medium: 1, Low: 2 };
  const SEV_TONE = { High: 'red', Medium: 'orange', Low: 'grey' };
  const TONE_FILL = { blue: 'var(--blue-500)', orange: 'var(--orange)', grey: 'var(--faint)', green: 'var(--green)', black: 'var(--black)', yellow: '#EAB308', red: 'var(--red)', navy: 'var(--navy-600)', purple: 'var(--purple)' };

  PCT.ui.css('page-dashboard', `
    .db-meta { display:flex; align-items:center; gap:6px 14px; flex-wrap:wrap; font-size:12.5px; color:var(--muted); }
    .db-meta > span { display:inline-flex; align-items:center; gap:6px; }
    .db-live i { width:7px; height:7px; border-radius:50%; background:#22C55E; display:inline-block; }
    .db-scope { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-2); background:var(--grey-bg); border-radius:12px; padding:2px 10px; margin-top:8px; }
    .db-root .page-head > .grow { flex:1 1 420px; }
    .kpis.db-k8 { grid-template-columns: repeat(8, minmax(0, 1fr)); }
    .kpis.db-k4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .db-k8 .kpi, .db-k4 .kpi { display:flex; flex-direction:column; }
    .db-k8 .kpi { padding:12px 12px 12px 14px; }
    .db-k8 .kpi .label, .db-k4 .kpi .label { align-items:flex-start; line-height:1.3; }
    .db-k8 .kpi .value, .db-k4 .kpi .value { margin-top:auto; padding-top:6px; }
    .db-k8 .kpi .sub, .db-k4 .kpi .sub { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .db-id { white-space:nowrap; }
    .db-mix { display:flex; height:10px; border-radius:5px; overflow:hidden; background:var(--grey-bg); gap:2px; }
    .db-mix i { display:block; height:100%; min-width:3px; }
    .db-flow { list-style:none; margin:12px 0 0; padding:0; }
    .db-flow li { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line-2); font-size:13px; }
    .db-flow li:last-child { border-bottom:0; }
    .db-flow li .ic { color:var(--muted); }
    .db-flow li b { font-size:15px; font-variant-numeric:tabular-nums; min-width:28px; text-align:right; }
    .db-flow li .amt { color:var(--muted); font-size:12px; min-width:70px; text-align:right; }
    .db-exp { display:grid; gap:12px; }
    .db-exp-item { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 12px; padding:12px 14px; border:1px solid var(--line); border-radius:9px; color:inherit; text-decoration:none !important; position:relative; }
    a.db-exp-item:hover { border-color:#C9D6EA; box-shadow:var(--shadow); }
    .db-exp-item::before { content:''; position:absolute; left:0; top:8px; bottom:8px; width:3px; border-radius:3px; background:var(--navy-600); }
    .db-exp-item.tone-orange::before { background:var(--orange); }
    .db-exp-item.tone-red::before { background:var(--red); }
    .db-exp-item .lbl { font-size:12.5px; font-weight:600; color:var(--ink-2); }
    .db-exp-item .amt { font-size:20px; font-weight:700; letter-spacing:-.01em; text-align:right; grid-row:span 2; align-self:center; font-variant-numeric:tabular-nums; }
    .db-exp-item .det { font-size:12px; color:var(--muted); }
    .db-exp-item .det .warn { color:var(--orange); font-weight:600; }
    .db-exp-item .det .bad { color:var(--red); font-weight:600; }
    .db-recon { font-size:12px; color:var(--muted); line-height:1.6; }
    .db-recon b { color:var(--ink-2); font-weight:650; }
    .db-sla-big { font-size:40px; font-weight:750; letter-spacing:-.02em; line-height:1; font-variant-numeric:tabular-nums; }
    .db-sla-big.tone-green { color:var(--green); } .db-sla-big.tone-orange { color:var(--orange); } .db-sla-big.tone-red { color:var(--red); }
    .db-bn-bar { display:flex; align-items:center; gap:8px; min-width:110px; }
    .db-bn-bar .progress { flex:1; min-width:50px; }
    .db-od { color:var(--red); font-weight:650; }
    .db-m-only { display:none; color:var(--ink-2) !important; }
    .db-legend { display:flex; gap:12px; flex-wrap:wrap; font-size:11.5px; color:var(--muted); margin-top:10px; }
    .db-legend span { display:inline-flex; align-items:center; gap:5px; }
    @media (max-width: 1280px) {
      .kpis.db-k8 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    @media (max-width: 900px) {
      .kpis.db-k4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .kpis.db-k8 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      #db-late thead th:nth-child(3), #db-late tbody td:nth-child(3),
      #db-ball thead th:nth-child(4), #db-ball tbody td:nth-child(4), #db-ball thead th:nth-child(5), #db-ball tbody td:nth-child(5),
      #db-exc thead th:nth-child(4), #db-exc tbody td:nth-child(4), #db-exc thead th:nth-child(5), #db-exc tbody td:nth-child(5),
      #db-bn thead th:nth-child(3), #db-bn tbody td:nth-child(3), #db-bn thead th:nth-child(4), #db-bn tbody td:nth-child(4), #db-bn thead th:nth-child(5), #db-bn tbody td:nth-child(5) { display:none; }
      #db-ball td:first-child .ellipsis { max-width:125px; }
      #db-ball .tbl td, #db-ball .tbl th { padding-left:8px; padding-right:8px; }
      .db-bn-bar { min-width:90px; }
      .db-m-only { display:block !important; }
      .db-sla-big { font-size:32px; }
      .db-exp-item .amt { font-size:17px; }
    }
  `);

  const isOpen = p => p.status === 'Open' || p.status === 'On Hold';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const tone3 = (pct, good, ok) => pct >= good ? 'green' : pct >= ok ? 'orange' : 'red';

  function greeting() { const h = new Date(PCT.clock.now()).getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }

  /** Who holds the ball on open purchases: [{id, name, role, dept, count, overdue, blocked, oldest, value}] */
  function ballHolders(state, S, openRows) {
    const g = U.groupBy(openRows.filter(r => r.ownerUserId), 'ownerUserId');
    const out = Object.keys(g).map(uid => {
      const rs = g[uid];
      const u = E.user(state, uid) || {};
      const role = E.role(state, u.roleId) || {};
      return {
        id: uid, name: u.name || uid, role: role.name || '', dept: S.deptName(state, u.deptId),
        count: rs.length, overdue: rs.filter(r => r.overdueDays > 0).length, blocked: rs.filter(r => r.blocked).length,
        oldest: Math.max(0, ...rs.map(r => r.ageingDays || 0)), value: U.sum(rs, r => r.value)
      };
    });
    return out.sort((a, b) => (b.overdue - a.overdue) || (b.count - a.count) || (b.value - a.value));
  }

  /** Everything the dashboard shows, scoped to what this user may see. */
  function model(ctx) {
    const { state, user, S } = ctx;
    const now = PCT.clock.now();
    const list = S.visiblePurchases(state, user);
    const ids = new Set(list.map(p => p.id));
    const rows = S.rows(state, list);
    const openRows = rows.filter(r => r.status === 'Open' || r.status === 'On Hold');
    const k = S.kpis(state, user, list);
    const f = S.financial(state, list);
    // Advances / exceptions scoped to visible purchases (S.kpis counts these across all purchases)
    const advs = state.advances.filter(a => ids.has(a.purchaseId) && a.status !== 'Rejected');
    const advOutList = advs.filter(a => E.advanceOutstanding(a) > 0);
    const advOut = U.sum(advOutList, E.advanceOutstanding);
    const advOverdueList = advOutList.filter(a => a.settlementDueDate && now > a.settlementDueDate);
    const advOverdue = U.sum(advOverdueList, E.advanceOutstanding);
    const exc = S.exceptionRows(state).filter(e => ids.has(e.purchaseId) && (e.status === 'Open' || e.status === 'In Progress'));
    const myRows = S.myActions(state, user);
    return {
      now, list, ids, rows, openRows, k, f, advOut, advOverdue, advOutCount: advOutList.length, advOverdueCount: advOverdueList.length, exc,
      my: myRows.length, myOverdue: myRows.filter(r => r.overdueDays > 0).length,
      tower: S.tower(state, list),
      bottlenecks: S.bottlenecks(state, list),
      sla: S.slaStats(state, list),
      holders: ballHolders(state, S, openRows),
      committed: U.sum(openRows.filter(r => r.p.po), r => r.p.po.total),
      failedPays: state.payments.filter(x => ids.has(x.purchaseId) && x.status === 'Failed')
    };
  }

  /* ---------------- header ---------------- */
  function header(ctx, m) {
    const { state, user, ui } = ctx;
    const k = m.k;
    const pr = E.activeVersion(state) || {};
    const proc = E.process(state) || {};
    const dateTxt = new Date(m.now).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const bn = m.bottlenecks[0];
    const roleId = user.roleId;

    let scope;
    if (ctx.can('purchase.view_all')) scope = 'Company-wide view · all purchases';
    else if (ctx.can('purchase.view_dept')) scope = `${ctx.S.deptName(state, user.deptId)} department + purchases you are involved in`;
    else scope = 'Purchases you raised or worked on';

    // Headline: the 30-second answer
    let line = k.open
      ? `<b>${k.open}</b> ${k.open === 1 ? 'purchase is' : 'purchases are'} in flight worth <b>${fmt.inrShort(k.openValue)}</b>${k.overdue || k.blocked ? ` — ${k.overdue ? `<b style="color:var(--red)">${k.overdue} overdue</b>` : ''}${k.overdue && k.blocked ? ', ' : ''}${k.blocked ? `<b style="color:var(--orange)">${k.blocked} blocked</b>` : ''}` : ' — all on track'}.`
      : 'No purchases are in flight right now.';
    // Role-aware focus sentence
    let focus = '';
    if (roleId === 'finance' || roleId === 'ap') focus = `${fmt.inrShort(k.pendingPayments)} pending vendor payments · ${fmt.inrShort(m.advOut)} advances outstanding${m.advOverdue ? ` (${fmt.inrShort(m.advOverdue)} overdue)` : ''}.`;
    else if (roleId === 'procurement') {
      const t = id => (m.tower.find(g => g.id === id) || { open: 0 }).open;
      focus = `${t('RFQ') + t('QUOTE')} in sourcing · ${t('PO')} at PO · ${k.waitingVendor} waiting on vendors.`;
    } else if (roleId === 'stores') {
      const t = (m.tower.find(g => g.id === 'DELIVERY') || { open: 0 }).open;
      focus = `${plural(t, 'purchase')} awaiting delivery / GRN.`;
    } else if (roleId === 'dept_head') focus = `${k.pendingApproval} awaiting approval across all levels.`;
    else if (roleId === 'requestor') {
      const withOthers = m.openRows.filter(r => r.ownerUserId && r.ownerUserId !== user.id).length;
      focus = withOthers ? `The ball is with others on ${plural(withOthers, 'purchase')} — see who below.` : '';
    } else if (bn) focus = `Biggest bottleneck: <b>${esc(bn.name)}</b> (${plural(bn.cases, 'case')}, ${bn.slaBreachPct}% past SLA).`;
    const mine = m.my ? ` <a href="#/my-actions">${m.my === 1 ? '1 action is' : `${m.my} actions are`} waiting for you${m.myOverdue ? ` (${m.myOverdue} overdue)` : ''} ${I('arrowRight', 12)}</a>` : '';

    return ui.pageHead({
      title: `Good ${greeting()}, ${user.name.split(' ')[0]}`,
      icon: 'dashboard',
      sub: `<div>${line} ${focus}${mine}</div>
        <div class="db-meta mt-8"><span>${I('calendar', 13)}${esc(dateTxt)}</span><span>${I('flow', 13)}${esc(proc.name || 'Process')} V${esc(pr.version || '—')}</span><span class="db-live"><i></i>Live</span><span class="db-scope" style="margin-top:0">${I('eye', 12)}${esc(scope)}</span></div>`,
      actions: `<a class="btn btn-sm" href="#/tower">${I('tower', 15)} Control Tower</a>${ctx.can('purchase.create') ? `<a class="btn btn-sm btn-primary" href="#/purchases/new">${I('plus', 15)} Create PR</a>` : ''}`
    });
  }

  /* ---------------- KPI tiles ---------------- */
  function kpiTiles(ctx, m) {
    const { ui } = ctx;
    const k = m.k;
    const canAdv = ctx.can(['finance', 'procure', 'analytics', 'admin']);
    const canPay = ctx.can(['finance', 'analytics', 'admin']);
    const counts = [
      ui.kpi({ label: 'Total purchases', value: k.total, icon: 'cart', href: '#/purchases', sub: `${k.rejected} rejected · ${k.draft} draft`, title: `${k.total} purchases in your view: ${k.open} open, ${k.draft} draft, ${k.completed} closed, ${k.rejected} rejected / cancelled` }),
      ui.kpi({ label: 'Open', value: k.open, icon: 'layers', tone: 'blue', href: '#/purchases?status=open', sub: `${fmt.inrShort(k.openValue)} value`, title: `Open + on hold purchases · ${fmt.inr(k.openValue)}` }),
      ui.kpi({ label: 'My actions', value: m.my, icon: 'inbox', tone: m.myOverdue ? 'red' : m.my ? 'blue' : 'none', href: '#/my-actions', sub: m.myOverdue ? `${m.myOverdue} overdue` : m.my ? 'Ball is with you' : 'Nothing waiting' }),
      ui.kpi({ label: 'Pending approval', value: k.pendingApproval, icon: 'approve', href: '#/purchases?status=pending-approval', sub: 'All levels', title: 'PR, vendor selection, PO, advance and payment approvals' }),
      ui.kpi({ label: 'Waiting vendor', value: k.waitingVendor, icon: 'vendor', tone: k.waitingVendor ? 'yellow' : 'none', href: '#/purchases?status=waiting-vendor', sub: 'Vendor to act', title: 'Quotation, PO acceptance or delivery pending from the vendor' }),
      ui.kpi({ label: 'Overdue', value: k.overdue, icon: 'alert', tone: k.overdue ? 'red' : 'green', href: '#/purchases?status=overdue', sub: k.overdue ? 'Past SLA due' : 'All within SLA' }),
      ui.kpi({ label: 'Blocked', value: k.blocked, icon: 'ban', tone: k.blocked ? 'orange' : 'none', href: '#/purchases?status=blocked', sub: 'Hold / exception', title: 'On hold, mismatch or payment failure — needs resolution' }),
      ui.kpi({ label: 'Completed', value: k.completed, icon: 'checkCircle', tone: 'green', href: '#/purchases?status=completed', sub: 'Closed' })
    ].join('');
    const slaTone = tone3(m.sla.achievementPct, 90, 75);
    const money = [
      ui.kpi({ label: 'Total purchase value', value: ui.moneyShort(k.totalValue), money: true, icon: 'rupee', tone: 'navy', href: '#/purchases', sub: fmt.inr(k.totalValue), title: `${fmt.inr(k.totalValue)} — PO value where a PO exists, otherwise estimated value; excludes rejected / cancelled` }),
      ui.kpi({ label: 'Outstanding vendor advances', value: ui.moneyShort(m.advOut), money: true, icon: 'advance', tone: m.advOverdue ? 'orange' : 'none', href: canAdv ? '#/advances' : null, sub: m.advOut ? (m.advOverdue ? `${fmt.inr(m.advOverdue)} overdue` : fmt.inr(m.advOut)) : 'Nothing outstanding', title: `${fmt.inr(m.advOut)} paid to vendors, not yet adjusted or recovered${m.advOverdue ? ` · ${fmt.inr(m.advOverdue)} past settlement due date` : ''}` }),
      ui.kpi({ label: 'Pending payments', value: ui.moneyShort(k.pendingPayments), money: true, icon: 'payment', tone: k.pendingPayments ? 'blue' : 'none', href: canPay ? '#/payments' : '#/purchases?status=open&group=PAYMENT', sub: k.pendingPayments ? fmt.inr(k.pendingPayments) : 'No unpaid invoices', title: `${fmt.inr(k.pendingPayments)} — invoices received, not yet paid or adjusted` }),
      ui.kpi({ label: 'SLA achievement', value: `${m.sla.achievementPct}%`, icon: 'target', tone: slaTone, sub: m.sla.completed ? `${m.sla.met} / ${m.sla.completed} on time` : 'No data yet', title: `${m.sla.met} of ${m.sla.completed} completed activities finished within SLA` })
    ].join('');
    return `<div class="kpis db-k8 mb-12">${counts}</div><div class="kpis db-k4 mb-16">${money}</div>`;
  }

  /* ---------------- WHAT IS HAPPENING? ---------------- */
  function happening(ctx, m) {
    const { state, ui } = ctx;
    const period = PERIODS.some(p => p.id === ctx.local.period) ? ctx.local.period : '30';
    const since = m.now - Number(period) * U.DAY;
    const inP = t => !!t && t >= since && t <= m.now;
    const L = m.list;
    const pays = state.payments.filter(x => m.ids.has(x.purchaseId) && x.status === 'Paid' && inP(x.date));
    const flows = [
      { icon: 'cart', label: 'Purchase requests submitted', n: L.filter(p => inP(p.submittedAt)).length, href: '#/purchases' },
      { icon: 'approve', label: 'Approvals given', n: U.sum(L, p => (p.approvals || []).filter(a => a.status === 'Approved' && inP(a.at)).length) },
      { icon: 'po', label: 'POs sent to vendors', n: L.filter(p => p.po && inP(p.po.sentAt)).length },
      { icon: 'truck', label: 'Goods / services received (GRN)', n: U.sum(L, p => (p.grns || []).filter(g => inP(g.receiptDate)).length) },
      { icon: 'invoice', label: 'Invoices received', n: U.sum(L, p => (p.invoices || []).filter(i => inP(i.receivedDate)).length) },
      { icon: 'payment', label: 'Payments released', n: pays.length, amt: U.sum(pays, x => x.amount) },
      { icon: 'checkCircle', label: 'Purchases closed', n: L.filter(p => inP(p.closedAt)).length }
    ];
    // Status mix of every purchase in scope (colours from the Status Master)
    const order = ['Open', 'On Hold', 'Draft', 'Closed', 'Rejected', 'Cancelled'];
    const total = L.length || 1;
    const mix = order.map(st => ({ st, n: L.filter(p => p.status === st).length, tone: ctx.S.statusTone(state, 'purchase', st) })).filter(x => x.n);
    const bar = `<div class="db-mix" role="img" aria-label="Purchase status mix">${mix.map(x => `<i style="width:${x.n / total * 100}%;background:${TONE_FILL[x.tone] || 'var(--faint)'}" title="${esc(x.st)}: ${x.n}"></i>`).join('')}</div>
      <div class="db-legend">${mix.map(x => `<span>${ui.dot(x.tone)}${esc(x.st)} <b style="color:var(--ink)">${x.n}</b></span>`).join('')}</div>`;
    const body = `${bar}<ul class="db-flow">${flows.map(f => `<li>${I(f.icon, 15)}<span class="grow">${esc(f.label)}</span>${f.amt != null ? `<span class="amt">${f.amt ? ui.moneyShort(f.amt) : ''}</span>` : ''}<b>${f.n}</b></li>`).join('')}</ul>`;
    return ui.card({
      title: 'What is happening?', icon: 'zap', sub: `Status of all ${plural(L.length, 'purchase')} · movement in the last ${period} days`,
      actions: ui.seg('period', PERIODS, period), body
    });
  }

  /* ---------------- WHERE ARE THE PURCHASES? ---------------- */
  function where(ctx, m) {
    const { ui } = ctx;
    const items = m.tower.map(g => ({
      label: g.label, value: g.open, href: `#/tower?stage=${encodeURIComponent(g.id)}`,
      tone: g.overdue ? 'red' : g.blocked ? 'orange' : 'navy',
      display: `<b>${g.open}</b>${g.open ? ` · ${ui.moneyShort(g.value)}` : ''}`
    }));
    const busiest = m.tower.filter(g => g.open).sort((a, b) => b.open - a.open || b.value - a.value).slice(0, 4);
    const strip = busiest.length ? `<div class="small muted mb-12">${busiest.map(g => `<a href="#/tower?stage=${encodeURIComponent(g.id)}"><b>${esc(g.label)}</b> ${g.open}</a>`).join(' · ')}</div>` : '';
    return ui.card({
      title: 'Where are the purchases?', icon: 'tower', sub: 'Open purchases at each stage now · click a stage to drill down',
      actions: `<a class="btn btn-sm btn-ghost" href="#/tower">Control Tower ${I('arrowRight', 13)}</a>`,
      body: m.openRows.length ? `${strip}${ui.hbars(items)}<div class="db-legend"><span>${ui.dot('red')}Has overdue</span><span>${ui.dot('orange')}Has blocked</span><span>${ui.dot('navy')}On track</span></div>` : ui.empty('tower', 'No open purchases', 'Nothing is moving through the process right now.')
    });
  }

  /* ---------------- WHAT IS DELAYED? ---------------- */
  function delayed(ctx, m) {
    const { state, ui } = ctx;
    const late = m.openRows.filter(r => r.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays || b.value - a.value);
    const table = ui.table([
      { key: 'id', label: 'Purchase', render: r => `<b class="mono db-id">${esc(r.id)}</b><span class="sub">${esc(r.title)}</span><span class="sub db-m-only">${esc(r.activity)}</span>` },
      { key: 'overdueDays', label: 'Overdue', align: 'right', render: r => `<span class="db-od">${esc(fmt.days(r.overdueDays))}</span>` },
      { key: 'activity', label: 'Activity', render: r => `${esc(r.activity)}<span class="sub">${esc(r.stage)}${r.blocked ? ' · blocked' : ''}</span>` },
      { key: 'owner', label: 'Ball with', render: r => r.ownerUserId ? ui.person(state, r.ownerUserId, { subText: r.withLabel }) : '—' }
    ], late, { key: 'dbLate', sort: ctx.local.dbLateSort, rowHref: r => `#/purchases/${r.id}`, rowClass: r => r.blocked ? 'row-orange' : 'row-red', empty: 'Nothing is overdue — every open activity is within SLA.', limit: 6, moreHref: '#/purchases?status=overdue', dense: true });
    return ui.card({
      id: 'db-late',
      title: `What is delayed?${late.length ? ` <span class="badge tone-red">${late.length}</span>` : ''}`, icon: 'clock',
      sub: 'Open activities past their SLA due date, longest first', flush: true, body: table
    });
  }

  /* ---------------- WHO HAS THE BALL? ---------------- */
  function whoHasBall(ctx, m) {
    const { ui } = ctx;
    const table = ui.table([
      { key: 'name', label: 'Person', render: r => `<span class="person">${ui.avatar(r.name, 'sm')}<span class="ellipsis"><span class="nm">${esc(r.name)}</span><small>${esc(r.role)}${r.dept && r.dept !== '—' && r.dept !== r.role ? ' · ' + esc(r.dept) : ''}</small></span></span>` },
      { key: 'count', label: 'Holding', align: 'right', render: r => `<b>${r.count}</b>` },
      { key: 'overdue', label: 'Overdue', align: 'right', render: r => r.overdue ? `<span class="db-od">${r.overdue}</span>` : '<span class="muted">0</span>' },
      { key: 'oldest', label: 'Oldest', align: 'right', render: r => ui.ageing(r.oldest) },
      { key: 'value', label: 'Value', align: 'right', render: r => ui.moneyShort(r.value) }
    ], m.holders, { key: 'dbBall', sort: ctx.local.dbBallSort, rowHref: r => `#/purchases?owner=${encodeURIComponent(r.id)}`, rowClass: r => r.overdue ? 'row-red' : '', empty: 'Nobody is holding an open purchase.', limit: 6, moreHref: '#/tower', dense: true });
    return ui.card({
      id: 'db-ball',
      title: 'Who has the ball?', icon: 'users', sub: `${plural(m.holders.length, 'person', 'people')} currently hold ${plural(m.openRows.length, 'open purchase')}`, flush: true, body: table
    });
  }

  /* ---------------- WHAT NEEDS MANAGEMENT ATTENTION? ---------------- */
  function attention(ctx, m) {
    const { state, ui } = ctx;
    const top = m.exc.slice().sort((a, b) => ((SEV_RANK[a.severity] ?? 1) - (SEV_RANK[b.severity] ?? 1)) || ((b.overdue ? 1 : 0) - (a.overdue ? 1 : 0)) || (b.ageDays - a.ageDays) || (a.date - b.date)).slice(0, 5);
    const table = ui.table([
      { key: 'severity', label: 'Severity', sort: r => SEV_RANK[r.severity] ?? 1, render: r => ui.badge(r.severity, SEV_TONE[r.severity] || 'grey') },
      { key: 'title', label: 'Exception', render: r => `${esc(r.title)}<span class="sub"><span class="mono">${esc(r.purchaseId)}</span> · ${esc(r.type)}</span>` },
      { key: 'owner', label: 'Owner', render: r => r.ownerUserId ? ui.person(state, r.ownerUserId, { sub: false }) : '—' },
      { key: 'ageDays', label: 'Age', align: 'right', render: r => `${ui.ageing(r.ageDays)}${r.overdue ? '<span class="sub db-od">action overdue</span>' : ''}` },
      { key: 'status', label: 'Status', render: r => ui.status(state, 'exception', r.status) }
    ], top, { key: 'dbExc', sort: ctx.local.dbExcSort, rowHref: r => `#/purchases/${r.purchaseId}`, rowClass: r => r.severity === 'High' ? 'row-red' : r.severity === 'Medium' ? 'row-orange' : '', empty: 'No open exceptions. Nothing needs management attention.', dense: true });
    const high = m.exc.filter(e => e.severity === 'High').length;
    return ui.card({
      id: 'db-exc',
      title: `What needs management attention?${m.exc.length ? ` <span class="badge tone-${high ? 'red' : 'orange'}">${m.exc.length} open</span>` : ''}`, icon: 'alert',
      sub: `Top ${Math.min(5, m.exc.length) || 5} open exceptions by severity and age${high ? ` · ${high} high severity` : ''}`, flush: true, body: table,
      actions: `<a class="btn btn-sm btn-ghost" href="#/exceptions">All exceptions ${I('arrowRight', 13)}</a>`
    });
  }

  /* ---------------- WHAT IS THE FINANCIAL EXPOSURE? ---------------- */
  function exposure(ctx, m) {
    const { ui } = ctx;
    const k = m.k, f = m.f;
    const canAdv = ctx.can(['finance', 'procure', 'analytics', 'admin']);
    const canPay = ctx.can(['finance', 'analytics', 'admin']);
    const notOrdered = Math.max(0, k.openValue - m.committed);
    const failed = U.sum(m.failedPays, x => x.amount);
    const item = (o) => `<${o.href ? 'a' : 'div'} class="db-exp-item tone-${o.tone || 'navy'}"${o.href ? ` href="${o.href}"` : ''}>
        <span class="lbl">${esc(o.label)}</span><span class="amt" title="${esc(fmt.inr(o.value))}">${ui.money(o.value)}</span><span class="det">${o.detail}</span></${o.href ? 'a' : 'div'}>`;
    const body = `<div class="db-exp">
      ${item({ label: `Open purchase value · ${plural(k.open, 'purchase')}`, value: k.openValue, href: '#/purchases?status=open', detail: `${fmt.inrShort(m.committed)} committed on PO · ${fmt.inrShort(notOrdered)} not yet ordered` })}
      ${item({ label: `Outstanding vendor advances · ${plural(m.advOutCount, 'advance')}`, value: m.advOut, tone: m.advOverdue ? 'orange' : 'navy', href: canAdv ? '#/advances' : null, detail: m.advOut ? (m.advOverdue ? `<span class="warn">${fmt.inr(m.advOverdue)} overdue for settlement</span> · paid but not yet adjusted` : 'Paid to vendors, not yet adjusted or recovered') : 'No advance is outstanding' })}
      ${item({ label: 'Pending vendor payments', value: k.pendingPayments, tone: failed ? 'red' : 'navy', href: canPay ? '#/payments' : null, detail: `Invoices received, not yet paid${f.paymentDue ? ` · ${fmt.inrShort(f.paymentDue)} due within 7 days` : ''}${failed ? ` · <span class="bad">${fmt.inrShort(failed)} payment failed</span>` : ''}` })}
    </div>`;
    const recon = f.invoiceValue ? `<div class="db-recon">Invoiced <b>${fmt.inr(f.invoiceValue)}</b> = paid <b>${fmt.inr(f.paidValue)}</b> + adjusted from advances <b>${fmt.inr(f.advanceAdjusted)}</b> + pending <b>${fmt.inr(f.pendingValue)}</b></div>` : '';
    return ui.card({
      title: 'What is the financial exposure?', icon: 'rupee', sub: 'Money committed, paid ahead and still owed — shown separately, never double-counted',
      body, foot: recon ? `<div class="grow">${recon}</div>` : ''
    });
  }

  /* ---------------- TOP BOTTLENECKS + SLA ---------------- */
  function bottlenecks(ctx, m) {
    const { ui } = ctx;
    const rows = m.bottlenecks.slice(0, 5).map(b => {
      const p = E.purchase(ctx.state, b.purchases[0]);
      const a = p && E.currentActivity(p);
      return Object.assign({}, b, { stageId: a ? a.stageId : null, ownersTxt: b.owners.join(', ') });
    });
    const table = ui.table([
      { key: 'name', label: 'Stage', render: r => `<b>${esc(r.name)}</b>` },
      { key: 'cases', label: 'Cases', align: 'right' },
      { key: 'avgAgeing', label: 'Avg ageing', align: 'right', render: r => `${esc(r.avgAgeing)} d` },
      { key: 'value', label: 'Value', align: 'right', render: r => ui.money(r.value) },
      { key: 'ownersTxt', label: 'Owner(s)', render: r => `<span class="small">${esc(r.owners.slice(0, 3).join(', '))}${r.owners.length > 3 ? ` +${r.owners.length - 3}` : ''}</span>` },
      { key: 'slaBreachPct', label: 'SLA breach', render: r => `<div class="db-bn-bar">${ui.progress(r.slaBreachPct, r.slaBreachPct >= 50 ? 'red' : r.slaBreachPct > 0 ? 'orange' : 'green')}<b class="nowrap" style="min-width:36px;text-align:right">${r.slaBreachPct}%</b></div>` }
    ], rows, { key: 'dbBn', sort: ctx.local.dbBnSort, rowHref: r => r.stageId ? `#/purchases?stage=${encodeURIComponent(r.stageId)}&status=open` : null, empty: 'No bottlenecks — nothing is open.', dense: true });
    return ui.card({ id: 'db-bn', title: 'Top bottlenecks', icon: 'filter', sub: 'Where open purchases are piling up · ranked by cases, then ageing', flush: true, body: table });
  }

  function slaCard(ctx, m) {
    const { ui } = ctx;
    const s = m.sla;
    const tone = tone3(s.achievementPct, 90, 75);
    const openLate = m.openRows.filter(r => r.overdueDays > 0).length;
    const onTrack = m.openRows.length - openLate;
    const openPct = m.openRows.length ? Math.round(onTrack / m.openRows.length * 100) : 100;
    const body = `<div class="row" style="align-items:flex-end;gap:12px"><div class="db-sla-big tone-${tone}">${s.achievementPct}%</div><div class="muted small" style="padding-bottom:4px">completed activities<br>finished within SLA</div></div>
      <div class="mt-12">${ui.progress(s.achievementPct, tone)}</div>
      <dl class="kv mt-16" style="grid-template-columns:minmax(0,1fr) auto">
        <dt>Completed on time</dt><dd class="num">${s.met}</dd>
        <dt>Completed late</dt><dd class="num" style="color:${s.breached ? 'var(--red)' : 'inherit'}">${s.breached}</dd>
        <dt>Open activities on track</dt><dd class="num">${onTrack} of ${m.openRows.length} (${openPct}%)</dd>
        <dt>Open activities overdue</dt><dd class="num" style="color:${openLate ? 'var(--red)' : 'inherit'}">${openLate}</dd>
      </dl>`;
    return ui.card({ title: 'SLA achievement', icon: 'target', sub: 'Due date = start + SLA working days × priority factor', body });
  }

  PCT.pages.register({
    route: 'dashboard',
    title: 'Dashboard',
    render(ctx) {
      const m = model(ctx);
      if (!m.list.length) {
        return header(ctx, m) + ctx.ui.card({ body: ctx.ui.empty('dashboard', 'No purchases to show yet', 'Purchases you raise, approve or work on will appear here.', ctx.can('purchase.create') ? '<a class="btn btn-primary mt-8" href="#/purchases/new">Create PR</a>' : '') });
      }
      return `<div class="db-root">
        ${header(ctx, m)}
        ${kpiTiles(ctx, m)}
        <div class="grid grid-2 mb-16">${where(ctx, m)}${happening(ctx, m)}</div>
        <div class="grid grid-2 mb-16">${delayed(ctx, m)}${whoHasBall(ctx, m)}</div>
        <div class="grid grid-2 mb-16">${attention(ctx, m)}${exposure(ctx, m)}</div>
        <div class="grid grid-main">${bottlenecks(ctx, m)}${slaCard(ctx, m)}</div>
      </div>`;
    }
  });
})();
