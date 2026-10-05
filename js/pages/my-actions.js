/* =====================================================================
   MY ACTIONS — personal action dashboard (spec §41). Reference page:
   other pages follow this pattern (register → render(ctx) → actions).
   Mobile-first: My Actions → open → act.
   ===================================================================== */
(function () {
  const { esc, I } = PCT.ui;

  PCT.pages.register({
    route: 'my-actions',
    title: 'My Actions',
    render(ctx) {
      const { state, user, ui, S, U } = ctx;
      const rows = S.myActions(state, user);
      const filter = ctx.local.filter || 'all';
      const shown = rows.filter(r => filter === 'all' ? true : filter === 'overdue' ? r.overdueDays > 0 : filter === 'today' ? r.dueAt && U.daysBetween(PCT.clock.now(), r.dueAt) <= 0 : filter === 'approvals' ? r.activityObj.approval : filter === 'waiting' ? r.displayStatus === 'Waiting' : true);
      const overdue = rows.filter(r => r.overdueDays > 0).length;
      const today = rows.filter(r => r.dueAt && U.daysBetween(PCT.clock.now(), r.dueAt) <= 0).length;
      const approvals = rows.filter(r => r.activityObj.approval).length;
      const waiting = rows.filter(r => r.displayStatus === 'Waiting').length;
      const mineRequests = state.purchases.filter(p => p.requestorId === user.id && p.status !== 'Closed' && p.status !== 'Rejected' && p.status !== 'Cancelled');

      const head = ui.pageHead({
        title: `Good ${greeting()}, ${user.name.split(' ')[0]}`,
        sub: rows.length ? `You have <b>${rows.length}</b> action${rows.length === 1 ? '' : 's'} waiting${overdue ? ` — <b style="color:var(--red)">${overdue} overdue</b>` : ''}. The ball is with you on these purchases.` : 'Nothing is waiting for you right now.',
        actions: (ctx.can('purchase.create') ? `<a class="btn btn-primary" href="#/purchases/new">${I('plus', 16)} Create PR</a>` : '') + `<a class="btn" href="#/purchases">${I('cart', 16)} All purchases</a>`
      });

      const kpis = `<div class="kpis mb-16">
        ${ui.kpi({ label: 'My actions', value: rows.length, icon: 'inbox', tone: 'blue' })}
        ${ui.kpi({ label: 'Overdue', value: overdue, icon: 'alert', tone: overdue ? 'red' : 'green' })}
        ${ui.kpi({ label: 'Due today', value: today, icon: 'clock', tone: today ? 'orange' : 'none' })}
        ${ui.kpi({ label: 'Approvals', value: approvals, icon: 'approve' })}
        ${ui.kpi({ label: 'Waiting on others', value: waiting, icon: 'pause', sub: 'Vendor / requestor / bank' })}
      </div>`;

      const chips = [['all', 'All', rows.length], ['overdue', 'Overdue', overdue], ['today', 'Due today', today], ['approvals', 'Approvals', approvals], ['waiting', 'Waiting', waiting]]
        .map(([id, label, n]) => `<button class="chip ${filter === id ? 'active' : ''}" data-act="set" data-key="filter" data-value="${id}">${label} <b>${n}</b></button>`).join('');

      const prio = r => r.tone === 'red' ? '🔴' : r.tone === 'orange' ? '🟠' : r.tone === 'yellow' ? '🟡' : '🟢';
      const table = ui.table([
        { key: 'tone', label: 'Priority', sort: r => r.sortKey, render: r => `<span title="${esc(r.displayStatus)}">${prio(r)}</span> ${ui.priority(state, r.priority)}` },
        { key: 'id', label: 'Purchase', render: r => `<b class="mono">${esc(r.id)}</b><span class="sub">${esc(r.title)}</span>` },
        { key: 'activity', label: 'Activity', render: r => `${esc(r.activity)}<span class="sub">${esc(r.clarification ? 'Answer clarification' : r.nextAction)}</span>` },
        { key: 'value', label: 'Value', align: 'right', render: r => ui.money(r.value) },
        { key: 'dueAt', label: 'Due', render: r => ui.due(r.dueAt) },
        { key: 'ageingDays', label: 'Ageing', align: 'right', render: r => ui.ageing(r.ageingDays) },
        { key: 'displayStatus', label: 'Status', render: r => ui.status(state, 'activity', r.displayStatus) },
        { key: 'open', label: 'Action', sort: false, render: r => `<a class="btn btn-sm ${r.overdueDays ? 'btn-danger' : 'btn-primary'}" href="#/purchases/${esc(r.id)}?tab=action">${r.activityObj.approval ? 'Review' : r.displayStatus === 'Waiting' ? 'Follow up' : 'Open'}</a>` }
      ], shown, { key: 'my', sort: ctx.local.mySort, rowHref: r => `#/purchases/${r.id}?tab=action`, rowClass: r => r.overdueDays ? 'row-red' : '', empty: 'No actions in this view.' });

      const tracking = mineRequests.length ? ui.card({
        title: 'My requests — where are they now?', icon: 'cart', sub: 'You raised these. The ball is with the person shown.', flush: true,
        body: ui.table([
          { key: 'id', label: 'Purchase', render: r => `<b class="mono">${esc(r.id)}</b><span class="sub">${esc(r.title)}</span>` },
          { key: 'stage', label: 'Stage' },
          { key: 'owner', label: 'Ball with', render: r => r.ownerUserId ? ui.person(state, r.ownerUserId) : '—' },
          { key: 'dueAt', label: 'Due', render: r => ui.due(r.dueAt) },
          { key: 'actStatus', label: 'Status', render: r => ui.status(state, 'activity', r.actStatus) }
        ], mineRequests.map(p => S.row(state, p)), { key: 'req', sort: ctx.local.reqSort, rowHref: r => `#/purchases/${r.id}` })
      }) : '';

      return head + kpis + ui.card({ title: 'Action queue', icon: 'inbox', actions: `<div class="row wrap">${chips}</div>`, flush: true, body: table }) + (tracking ? `<div class="mt-16">${tracking}</div>` : '');
    }
  });

  function greeting() { const h = new Date(PCT.clock.now()).getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }
})();
