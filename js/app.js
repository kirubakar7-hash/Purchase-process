/* =====================================================================
   APP — page registry, router, render loop, event delegation, shell.
   ---------------------------------------------------------------------
   Pages register themselves (js/pages/*.js):

   PCT.pages.register({
     route: 'purchases',              // matches #/purchases, #/purchases/PUR-2026-00125 (params = ['PUR-…'])
     title: 'Purchases',
     perms: ['procure', 'admin'],     // optional — any one grants access; omit = everyone signed in
     render(ctx) { return '<html>' }, // pure: build HTML from ctx.state
     after(ctx, root) {},             // optional: DOM work after render (focus, canvas, etc.)
     actions: {                       // optional: data-act="name" handlers for this page
       name(ctx, el, ev) {}
     }
   });

   ctx = { state, user, role, route, params, query, local, can(perm), go(hash), rerender(),
           act(purchaseId, activityId, op, payload) → result (commits + toasts),
           commit(fn, successMsg) → result, toast, modal, confirm, E, S, U, ui }
   ctx.local is per-page, per-tab UI state (tabs, filters, sort) that survives re-renders.
   ===================================================================== */
window.PCT = window.PCT || {};

PCT.pages = (function () {
  const list = [];
  return {
    list,
    register(def) {
      const i = list.findIndex(p => p.route === def.route);
      if (i >= 0) list.splice(i, 1);
      list.push(def);
      list.sort((a, b) => b.route.length - a.route.length); // longest route first
      if (PCT.app && PCT.app.started) PCT.app.render();
    },
    match(path) {
      return list.find(p => path === p.route || path.indexOf(p.route + '/') === 0);
    }
  };
})();

PCT.app = (function () {
  const U = PCT.util;
  const esc = U.esc;
  const I = (n, s) => PCT.icon(n, s);
  const locals = {};
  let lastRoute = null;
  let localCommit = false;
  let seenNotifs = null;
  let menus = { notif: false, user: false };

  /* ---------------- navigation model (spec §60) ---------------- */
  const NAV = [
    { section: 'Overview' },
    { route: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { route: 'tower', label: 'Process Control Tower', icon: 'tower' },
    { route: 'my-actions', label: 'My Actions', icon: 'inbox', count: (s, u) => PCT.sel.myActions(s, u).length },
    { section: 'Procurement' },
    { route: 'purchases', label: 'Purchases', icon: 'cart' },
    { route: 'approvals', label: 'Approvals', icon: 'approve', perms: ['approve'], count: (s, u) => PCT.sel.myActions(s, u).filter(r => r.activityObj.approval).length },
    { route: 'vendors', label: 'Vendors', icon: 'vendor', perms: ['procure', 'vendor.manage', 'finance', 'analytics', 'admin'] },
    { route: 'rfq', label: 'RFQ & Quotations', icon: 'rfq', perms: ['procure', 'analytics', 'admin'] },
    { route: 'po', label: 'Purchase Orders', icon: 'po', perms: ['procure', 'finance', 'analytics', 'admin', 'receive'] },
    { section: 'Finance & Fulfilment' },
    { route: 'advances', label: 'Vendor Advances', icon: 'advance', perms: ['finance', 'procure', 'analytics', 'admin'], alert: s => s.advances.filter(a => a.settlementDueDate && PCT.clock.now() > a.settlementDueDate && PCT.engine.advanceOutstanding(a) > 0).length },
    { route: 'delivery', label: 'Delivery / GRN', icon: 'truck', perms: ['receive', 'procure', 'analytics', 'admin'] },
    { route: 'invoices', label: 'Invoices', icon: 'invoice', perms: ['finance', 'procure', 'analytics', 'admin'] },
    { route: 'payments', label: 'Payments', icon: 'payment', perms: ['finance', 'analytics', 'admin'] },
    { section: 'Control' },
    { route: 'exceptions', label: 'Exceptions', icon: 'alert', alert: (s, u) => visibleOpenExceptions(s, u) },
    { route: 'documents', label: 'Documents', icon: 'file' },
    { route: 'reports', label: 'Reports', icon: 'report', perms: ['reports', 'analytics', 'admin'] },
    { section: 'Administration', perms: ['admin', 'analytics'] },
    { route: 'admin/masters', label: 'Masters', icon: 'database', perms: ['admin'] },
    { route: 'admin/process', label: 'Process Builder', icon: 'flow', perms: ['admin'] },
    { route: 'admin/rules', label: 'Workflow Rules', icon: 'rules', perms: ['admin'] },
    { route: 'admin/approval-matrix', label: 'Approval Matrix', icon: 'matrix', perms: ['admin'] },
    { route: 'admin/sla', label: 'SLA', icon: 'clock', perms: ['admin'] },
    { route: 'admin/escalation', label: 'Escalation', icon: 'escalate', perms: ['admin'] },
    { route: 'admin/users', label: 'Users & Roles', icon: 'users', perms: ['admin'] },
    { route: 'admin/audit', label: 'Audit Logs', icon: 'audit', perms: ['admin', 'analytics'] },
    { route: 'admin/excel', label: 'Excel Import / Export', icon: 'download', perms: ['admin'] },
    { section: 'Presenter' },
    { route: 'demo', label: 'Live Demo', icon: 'mic' }
  ];
  function visibleOpenExceptions(s, u) {
    const vis = new Set(PCT.sel.visiblePurchases(s, u).map(p => p.id));
    return s.exceptions.filter(e => (e.status === 'Open' || e.status === 'In Progress') && vis.has(e.purchaseId)).length;
  }

  const LANDING = { management: 'dashboard', admin: 'dashboard', finance: 'my-actions', ap: 'my-actions', procurement: 'my-actions', dept_head: 'my-actions', requestor: 'my-actions', technical: 'my-actions', stores: 'my-actions' };

  /* ---------------- session helpers ---------------- */
  function currentUser(state) {
    const id = PCT.store.session.userId();
    const u = id && PCT.engine.user(state, id);
    return u && u.status === 'Active' ? u : null;
  }
  function can(state, user, perms) {
    if (!perms || !perms.length) return true;
    const r = PCT.engine.role(state, user.roleId);
    return !!(r && perms.some(p => (r.permissions || []).includes(p)));
  }

  /* ---------------- routing ---------------- */
  function parseHash() {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const query = {};
    new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
    return { path: path.replace(/\/+$/, ''), query };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  /* ---------------- context ---------------- */
  function makeCtx(state, user, page, path, query) {
    const route = page ? page.route : path;
    const params = page ? path.slice(page.route.length).split('/').filter(Boolean).map(decodeURIComponent) : [];
    if (!locals[route]) locals[route] = {};
    const ctx = {
      state, user, role: user ? PCT.engine.role(state, user.roleId) : null, route, params, query, path,
      local: locals[route],
      can: perm => !!user && can(state, user, Array.isArray(perm) ? perm : [perm]),
      go, rerender: () => render(),
      E: PCT.engine, S: PCT.sel, U, ui: PCT.ui, fmt: U.fmt,
      toast: PCT.ui.toast, modal: PCT.ui.modal, confirm: PCT.ui.confirm,
      /** Commit an engine action as the current user; shows toast; returns result. */
      act(purchaseId, activityId, op, payload, okMsg) {
        const res = commit(s => PCT.engine.act(s, purchaseId, activityId, op, payload || {}, user.id));
        if (res && res.ok) PCT.ui.toast(okMsg || res.message || 'Saved', res.mismatch ? 'orange' : 'green');
        else PCT.ui.toast((res && res.error) || 'Action failed', 'red', 'Not saved');
        return res;
      },
      /** Commit any state change; fn(state) may return {ok:false,error} to abort. */
      commit(fn, okMsg) {
        const res = commit(fn);
        if (res && res.ok === false) PCT.ui.toast(res.error || 'Not saved', 'red', 'Not saved');
        else if (okMsg) PCT.ui.toast(okMsg, 'green');
        return res;
      }
    };
    return ctx;
  }
  function commit(fn) {
    localCommit = true;
    try { return PCT.store.commit(fn); } finally { localCommit = false; }
  }

  /* ---------------- shell ---------------- */
  function mountShell() {
    document.getElementById('root').innerHTML = `
      <div class="app" id="app">
        <aside class="sidebar">
          <a class="brand" href="#/">
            <span class="brand-mark">${I('tower', 18)}</span>
            <span><b>Procurement Control Tower</b><span>One owner · one action · full visibility</span></span>
          </a>
          <nav class="nav" id="nav"></nav>
          <div class="sidebar-foot" id="side-foot"></div>
        </aside>
        <div class="main">
          <header class="topbar">
            <button class="icon-btn menu-btn" data-act="nav-toggle" aria-label="Menu">${I('menu', 18)}</button>
            <div class="gsearch" id="gsearch">
              ${I('search', 16)}
              <input id="gsearch-input" type="search" autocomplete="off" placeholder="Search purchase, PR, PO, vendor, invoice, advance… or ask “where is PUR-2026-00125?”" aria-label="Global search">
              <kbd>/</kbd>
              <div class="dropdown hide" id="gsearch-dd"></div>
            </div>
            <div class="top-right" id="top-right"></div>
          </header>
          <main class="view" id="view"></main>
        </div>
      </div>`;
  }

  function renderNav(state, user, path) {
    let html = '';
    let sectionOk = true;
    NAV.forEach(n => {
      if (n.section) { sectionOk = can(state, user, n.perms); if (sectionOk) html += `<div class="nav-section">${esc(n.section)}</div>`; return; }
      if (!sectionOk || !can(state, user, n.perms)) return;
      const active = path === n.route || path.indexOf(n.route + '/') === 0 || (n.route === 'purchases' && path === 'purchases/new');
      const c = n.count ? n.count(state, user) : 0;
      const al = n.alert ? n.alert(state, user) : 0;
      html += `<a href="#/${n.route}" class="${active ? 'active' : ''}">${I(n.icon, 17)}<span>${esc(n.label)}</span>${al ? `<span class="count alert">${al}</span>` : c ? `<span class="count">${c}</span>` : ''}</a>`;
    });
    document.getElementById('nav').innerHTML = html;
    const pr = PCT.engine.activeVersion(state);
    document.getElementById('side-foot').innerHTML = `Process <b style="color:#fff">${esc(PCT.engine.process(state).name)} V${esc(pr.version)}</b><br>Effective ${esc(pr.effectiveDate)} · <a href="#/admin/process">versions</a>`;
  }

  function renderTop(state, user) {
    const unread = PCT.sel.unreadCount(state, user.id);
    const role = PCT.engine.role(state, user.roleId) || {};
    const off = state.meta.clockOffsetDays || 0;
    const notifs = PCT.sel.notificationsFor(state, user.id, 30);
    document.getElementById('top-right').innerHTML = `
      ${off ? `<span class="clock-chip" title="Demo time travel is active">${I('clock', 12)} Demo clock +${off}d</span>` : ''}
      <span class="live" title="Changes in other windows appear here instantly"><i></i>Live</span>
      <div style="position:relative">
        <button class="icon-btn" data-act="menu" data-menu="notif" aria-label="Notifications">${I('bell', 18)}${unread ? `<span class="dot">${unread > 99 ? '99+' : unread}</span>` : ''}</button>
        ${menus.notif ? `<div class="menu" style="width:380px">
          <div class="row between" style="padding:6px 10px"><b>Notifications</b>${unread ? `<button class="btn btn-xs btn-ghost" data-act="notif-read-all">Mark all read</button>` : ''}</div>
          ${notifs.length ? notifs.map(n => `<div class="notif ${n.read ? '' : 'unread'}" data-act="notif-open" data-id="${esc(n.id)}" data-pid="${esc(n.purchaseId || '')}">
            ${I(n.event === 'escalation' || n.event === 'overdue' ? 'escalate' : n.event === 'approval_required' ? 'approve' : n.event === 'invoice_mismatch' || n.event === 'workflow_blocked' ? 'alert' : 'bell', 16)}
            <div class="grow"><div class="nt">${esc(n.title)}</div><div class="nx">${esc(n.text)}</div><small>${U.fmt.ago(n.t)}${n.channels && n.channels.includes('Email') ? ' · email sent' : ''}</small></div></div>`).join('') : '<div class="dd-empty">No notifications</div>'}
        </div>` : ''}
      </div>
      <div style="position:relative">
        <button class="user-btn" data-act="menu" data-menu="user">${PCT.ui.avatar(user.name, 'sm')}<span class="who"><b>${esc(user.name)}</b><span>${esc(role.name || '')}</span></span>${I('chevronDown', 14)}</button>
        ${menus.user ? userMenu(state, user) : ''}
      </div>`;
  }

  function userMenu(state, user) {
    const byRole = U.groupBy(state.masters.users.filter(u => u.status === 'Active'), 'roleId');
    return `<div class="menu" style="width:300px">
      <div class="mh">Signed in as</div>
      <div class="mi">${PCT.ui.avatar(user.name, 'sm')}<div><b>${esc(user.name)}</b><br><small class="muted">${esc(user.title || '')} · ${esc(PCT.sel.deptName(state, user.deptId))}</small></div></div>
      <hr>
      <div class="mh">Switch user (demo)</div>
      ${state.masters.roles.map(r => (byRole[r.id] || []).map(u => `<div class="row" style="gap:0"><button class="mi ${u.id === user.id ? 'active' : ''}" data-act="switch-user" data-user="${esc(u.id)}">${PCT.ui.avatar(u.name, 'sm')}<span class="grow ellipsis">${esc(u.name)}<br><small class="muted">${esc(r.name)}</small></span></button><button class="btn btn-ghost btn-icon btn-sm" title="Open as ${esc(u.name)} in a new window" data-act="open-window" data-user="${esc(u.id)}">${I('external', 14)}</button></div>`).join('')).join('')}
      <hr>
      <button class="mi" data-act="logout">${I('logout', 16)} Sign out</button>
    </div>`;
  }

  /* ---------------- login (demo authentication) ---------------- */
  function renderLogin(state) {
    const byRole = U.groupBy(state.masters.users.filter(u => u.status === 'Active'), 'roleId');
    document.getElementById('root').innerHTML = `
      <div class="login">
        <div class="login-hero">
          <div>
            <div class="row" style="gap:12px"><span class="brand-mark" style="width:42px;height:42px">${I('tower', 22)}</span><div class="overline" style="color:#8FA3C2">Procurement / Purchase Process</div></div>
            <h1 style="margin-top:28px">Procurement<br>Control Tower</h1>
            <div class="tagline">From requirement to payment, settlement and closure — every purchase, one owner at a time.</div>
            <div class="golden">
              ${['One Purchase ID', 'One current stage', 'One current owner', 'One next action', 'One due date', 'One status', 'One complete audit trail'].map((t, i) => `<div><i>${i + 1}</i>${t}</div>`).join('')}
            </div>
          </div>
          <div class="small" style="color:#8FA3C2">Demo sign-in. Production: SSO with the employee master and role-based access.</div>
        </div>
        <div class="login-panel">
          <h2>Sign in</h2>
          <p class="muted">Choose a user. Tip: open several users in separate windows (${I('external', 12)}) to watch the ball move between them live.</p>
          ${state.masters.roles.map(r => (byRole[r.id] || []).length ? `<div class="overline mt-16">${esc(r.name)}</div><div class="login-roles">${byRole[r.id].map(u => `
            <button class="login-user" data-act="switch-user" data-user="${esc(u.id)}">${PCT.ui.avatar(u.name)}<span class="grow"><b>${esc(u.name)}</b><small>${esc(u.title)} · ${esc(PCT.sel.deptName(state, u.deptId))}</small></span><span class="ext" data-act="open-window" data-user="${esc(u.id)}" title="Open in new window">${I('external', 15)}</span></button>`).join('')}</div>` : '').join('')}
        </div>
      </div>`;
  }

  /* ---------------- render ---------------- */
  function snapshotForm() {
    const view = document.getElementById('view');
    if (!view) return null;
    const snap = {};
    view.querySelectorAll('input[name], select[name], textarea[name]').forEach((el, i) => {
      const key = (el.closest('[id]') ? el.closest('[id]').id : '') + '|' + el.name + '|' + i;
      snap[key] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    });
    const a = document.activeElement;
    return { snap, focus: a && a.id && view.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null, scroll: window.scrollY };
  }
  function restoreForm(saved) {
    if (!saved) return;
    const view = document.getElementById('view');
    view.querySelectorAll('input[name], select[name], textarea[name]').forEach((el, i) => {
      const key = (el.closest('[id]') ? el.closest('[id]').id : '') + '|' + el.name + '|' + i;
      if (!(key in saved.snap) || el.type === 'file') return;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = saved.snap[key];
      else el.value = saved.snap[key];
    });
    if (saved.focus) { const f = document.getElementById(saved.focus.id); if (f) { f.focus(); try { f.setSelectionRange(saved.focus.s, saved.focus.e); } catch (e) { /* not text */ } } }
  }

  function render(opts) {
    opts = opts || {};
    const state = PCT.store.get();
    const user = currentUser(state);
    const { path, query } = parseHash();
    if (!user || path === 'login') {
      document.body.dataset.mode = 'login';
      renderLogin(state);
      lastRoute = 'login';
      return;
    }
    if (document.body.dataset.mode !== 'app' || !document.getElementById('view')) { mountShell(); document.body.dataset.mode = 'app'; }
    if (!path) { go('#/' + (LANDING[user.roleId] || 'my-actions')); return; }

    const page = PCT.pages.match(path);
    const navItem = NAV.find(n => n.route && (path === n.route || path.indexOf(n.route + '/') === 0));
    const allowed = page ? can(state, user, page.perms) : true;
    const sameRoute = lastRoute === location.hash;
    const saved = opts.preserve && sameRoute ? snapshotForm() : null;

    renderNav(state, user, path);
    renderTop(state, user);
    const ctx = makeCtx(state, user, page, path, query);
    let html;
    try {
      if (!page) html = PCT.ui.pageHead({ title: navItem ? navItem.label : 'Not found', sub: navItem ? 'This module is being prepared.' : `No page at #/${esc(path)}` }) + PCT.ui.card({ body: PCT.ui.empty(navItem ? navItem.icon : 'info', navItem ? 'Coming soon' : 'Page not found', '', '<a class="btn btn-primary mt-8" href="#/">Go to start</a>') });
      else if (!allowed) html = PCT.ui.pageHead({ title: page.title || 'Restricted' }) + PCT.ui.card({ body: PCT.ui.empty('lock', 'You do not have access to this module', `Signed in as ${esc(user.name)} (${esc(ctx.role.name)}). Role-based access is controlled in Users & Roles.`) });
      else html = page.render(ctx);
    } catch (e) {
      console.error(e);
      html = PCT.ui.alert('danger', `<b>Something went wrong rendering this page.</b> ${esc(e.message)}`);
    }
    const view = document.getElementById('view');
    view.innerHTML = html;
    document.title = `${page && page.title ? page.title + ' · ' : ''}Procurement Control Tower`;
    if (!sameRoute) { window.scrollTo(0, 0); menus = { notif: false, user: false }; document.getElementById('app').classList.remove('nav-open'); }
    lastRoute = location.hash;
    if (page && page.after && allowed) { try { page.after(ctx, view); } catch (e) { console.error(e); } }
    if (saved) { restoreForm(saved); window.scrollTo(0, saved.scroll); }
    announceNotifications(state, user);
  }

  /* New notifications for the signed-in user (e.g. arriving from another window) → toast */
  function announceNotifications(state, user) {
    const mine = state.notifications.filter(n => n.userId === user.id);
    const key = user.id + ':' + state.meta.runId;
    if (!seenNotifs || seenNotifs.key !== key) { seenNotifs = { key, ids: new Set(mine.map(n => n.id)) }; return; }
    const fresh = mine.filter(n => !seenNotifs.ids.has(n.id));
    fresh.forEach(n => seenNotifs.ids.add(n.id));
    if (fresh.length && !localCommit) {
      fresh.slice(-3).forEach(n => PCT.ui.toast(n.text, n.event === 'escalation' || n.event === 'overdue' ? 'red' : 'navy', n.title));
      flashTitle(fresh.length);
    }
  }
  let flashTimer = null;
  function flashTitle(n) {
    clearInterval(flashTimer);
    const base = document.title; let on = false; let k = 0;
    flashTimer = setInterval(() => { document.title = on ? base : `(${n}) New action · Control Tower`; on = !on; if (++k > 9 || document.hasFocus()) { clearInterval(flashTimer); document.title = base; } }, 900);
  }

  /* ---------------- global actions ---------------- */
  const GLOBAL = {
    tab(ctx, el) { ctx.local[el.dataset.key] = el.dataset.tab; render(); },
    sort(ctx, el) {
      const k = el.dataset.key + 'Sort';
      const cur = ctx.local[k];
      ctx.local[k] = cur && cur.col === el.dataset.col ? { col: el.dataset.col, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { col: el.dataset.col, dir: 'asc' };
      render();
    },
    toggle(ctx, el) { ctx.local[el.dataset.key] = !ctx.local[el.dataset.key]; render(); },
    set(ctx, el) { ctx.local[el.dataset.key] = el.dataset.value; render(); },
    nav(ctx, el) { go(el.dataset.to); },
    'nav-toggle'() { document.getElementById('app').classList.toggle('nav-open'); },
    menu(ctx, el) { const m = el.dataset.menu; menus = { notif: m === 'notif' ? !menus.notif : false, user: m === 'user' ? !menus.user : false }; renderTop(PCT.store.get(), ctx.user); },
    'switch-user'(ctx, el) {
      PCT.store.session.setUser(el.dataset.user);
      if (location.search) history.replaceState(null, '', location.pathname + location.hash);
      menus = { notif: false, user: false };
      seenNotifs = null;
      const st = PCT.store.get();
      const u = PCT.engine.user(st, el.dataset.user);
      location.hash = '#/' + (LANDING[u.roleId] || 'my-actions');
      render();
      PCT.ui.toast(`Signed in as ${u.name}`, 'navy');
    },
    'open-window'(ctx, el, ev) { ev.stopPropagation(); window.open(`${location.pathname}?as=${encodeURIComponent(el.dataset.user)}#/`, '_blank'); },
    logout() { PCT.store.session.clear(); if (location.search) history.replaceState(null, '', location.pathname + '#/'); location.hash = '#/login'; render(); },
    'notif-open'(ctx, el) {
      commit(s => { const n = s.notifications.find(x => x.id === el.dataset.id); if (n) n.read = true; });
      menus.notif = false;
      if (el.dataset.pid) go('#/purchases/' + el.dataset.pid); else render();
    },
    'notif-read-all'(ctx) { commit(s => { s.notifications.forEach(n => { if (n.userId === ctx.user.id) n.read = true; }); }); renderTop(PCT.store.get(), ctx.user); },
    'sample-file'(ctx, el) {
      const wrap = el.closest('.file-drop');
      wrap.querySelector(`input[type=hidden]`).value = el.dataset.sample;
      wrap.querySelector('.fname').textContent = el.dataset.sample;
    },
    'open-purchase'(ctx, el) { go('#/purchases/' + el.dataset.id); }
  };
  const GLOBAL_CHANGE = {
    checkstyle(ctx, el) { const l = el.closest('.check'); if (l) l.classList.toggle('done', el.checked); }
  };

  function currentCtx() {
    const state = PCT.store.get();
    const user = currentUser(state);
    const { path, query } = parseHash();
    const page = PCT.pages.match(path);
    return { ctx: makeCtx(state, user, page, path, query), page };
  }

  function bindEvents() {
    document.addEventListener('click', ev => {
      const modalAct = ev.target.closest('[data-modal-act]');
      if (modalAct) { ev.preventDefault(); PCT.ui.modal.handle(modalAct.dataset.modalAct, modalAct); return; }
      if (ev.target.matches('[data-modal-backdrop]')) { PCT.ui.modal.close(); return; }
      const el = ev.target.closest('[data-act]');
      if (el) {
        const name = el.dataset.act;
        const { ctx, page } = currentCtx();
        const h = (page && page.actions && page.actions[name]) || (name.indexOf('af-') === 0 && PCT.actionForms && PCT.actionForms.actions[name]) || GLOBAL[name];
        if (h) {
          if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
          try { h(ctx, el, ev); } catch (e) { console.error(e); PCT.ui.toast(e.message, 'red', 'Error'); }
          return;
        }
      }
      const row = ev.target.closest('[data-href]');
      if (row && !ev.target.closest('a, button, input, select, textarea, label')) { go(row.dataset.href); return; }
      if (!ev.target.closest('.menu') && !ev.target.closest('[data-act="menu"]') && (menus.notif || menus.user)) {
        menus = { notif: false, user: false };
        const s = PCT.store.get(); const u = currentUser(s); if (u && document.getElementById('top-right')) renderTop(s, u);
      }
      if (!ev.target.closest('#gsearch')) hideSearch();
    });
    document.addEventListener('change', ev => {
      const f = ev.target.closest('input[type=file][data-file-for]');
      if (f) {
        const wrap = f.closest('.file-drop');
        const name = f.files && f.files[0] ? f.files[0].name : '';
        wrap.querySelector('input[type=hidden]').value = name;
        wrap.querySelector('.fname').textContent = name;
      }
      const el = ev.target.closest('[data-act-change]');
      if (!el) return;
      const { ctx, page } = currentCtx();
      const nm = el.dataset.actChange;
      const h = (page && page.actions && page.actions[nm]) || (nm.indexOf('af-') === 0 && PCT.actionForms && PCT.actionForms.actions[nm]) || GLOBAL_CHANGE[nm];
      if (h) h(ctx, el, ev);
    });
    document.addEventListener('input', ev => {
      const el = ev.target.closest('[data-act-input]');
      if (!el) return;
      const { ctx, page } = currentCtx();
      const nm = el.dataset.actInput;
      const h = (page && page.actions && page.actions[nm]) || (nm.indexOf('af-') === 0 && PCT.actionForms && PCT.actionForms.actions[nm]);
      if (h) h(ctx, el, ev);
    });
    document.addEventListener('submit', ev => {
      const form = ev.target.closest('form[data-submit]');
      if (!form) return;
      ev.preventDefault();
      const { ctx, page } = currentCtx();
      const nm = form.dataset.submit;
      const h = (page && page.actions && page.actions[nm]) || (nm.indexOf('af-') === 0 && PCT.actionForms && PCT.actionForms.actions[nm]);
      if (h) h(ctx, form, ev);
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { if (PCT.ui.modal.isOpen()) PCT.ui.modal.close(); hideSearch(); }
      if (ev.key === '/' && !ev.target.closest('input, textarea, select') && document.getElementById('gsearch-input')) { ev.preventDefault(); document.getElementById('gsearch-input').focus(); }
    });
    // global search (updates only its dropdown so typing is never interrupted)
    document.addEventListener('input', U.debounce(ev => { if (ev.target.id === 'gsearch-input') showSearch(ev.target.value); }, 120));
    document.addEventListener('focusin', ev => { if (ev.target.id === 'gsearch-input' && ev.target.value) showSearch(ev.target.value); });
    document.addEventListener('keydown', ev => {
      if (ev.target.id !== 'gsearch-input') return;
      const items = Array.from(document.querySelectorAll('#gsearch-dd .dd-item'));
      if (!items.length) return;
      let i = items.findIndex(x => x.classList.contains('active'));
      if (ev.key === 'ArrowDown') { ev.preventDefault(); i = Math.min(items.length - 1, i + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); i = Math.max(0, i - 1); }
      else if (ev.key === 'Enter') { ev.preventDefault(); const t = items[Math.max(0, i)]; if (t) { hideSearch(); go(t.getAttribute('href')); } return; }
      else return;
      items.forEach(x => x.classList.remove('active'));
      items[i].classList.add('active');
    });
    window.addEventListener('hashchange', () => render());
  }

  const QUESTION = /^(where|why|what|which|who|how|show|list|tell|give)\b|\?$/i;
  function showSearch(q) {
    const dd = document.getElementById('gsearch-dd');
    if (!dd) return;
    q = (q || '').trim();
    if (q.length < 2) { hideSearch(); return; }
    const state = PCT.store.get();
    const user = currentUser(state);
    let html = '';
    if (QUESTION.test(q) && PCT.assistant && PCT.assistant.answer) {
      try {
        const a = PCT.assistant.answer(state, q, user);
        if (a && a.text) html += `<div class="assistant"><b>${I('sparkle', 14)} Control Tower assistant</b><div>${esc(a.text)}</div>${(a.links || []).length ? `<div class="row wrap mt-8">${a.links.map(l => `<a class="chip" href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}</div>` : ''}</div>`;
      } catch (e) { console.error(e); }
    }
    const res = PCT.sel.search(state, q, user);
    const groups = U.groupBy(res, 'type');
    html += Object.keys(groups).map(g => `<div class="dd-group">${esc(g)}</div>` + groups[g].map(r => `<a class="dd-item" href="${esc(r.href)}">${I(({ Purchase: 'cart', PO: 'po', Invoice: 'invoice', Vendor: 'vendor', Advance: 'advance', Payment: 'payment', Employee: 'user', Department: 'users', RFQ: 'rfq', GRN: 'truck', Activity: 'inbox' })[g] || 'file', 15)}<span class="grow"><span class="ellipsis" style="display:block">${esc(r.label)}</span><small>${esc(r.sub)}</small></span></a>`).join('')).join('');
    if (!html) html = '<div class="dd-empty">No matches. Try a Purchase ID, PO number, vendor or person.</div>';
    dd.innerHTML = html;
    dd.classList.remove('hide');
    dd.querySelectorAll('a.dd-item').forEach(a => a.addEventListener('click', () => { hideSearch(); }));
  }
  function hideSearch() { const dd = document.getElementById('gsearch-dd'); if (dd) dd.classList.add('hide'); }

  /* ---------------- boot ---------------- */
  function start() {
    PCT.store.init();
    PCT.store.subscribe(() => render({ preserve: !localCommit }));
    bindEvents();
    // Escalation engine: run now and every minute (idempotent)
    const runTick = () => { const s = PCT.store.get(); const probe = JSON.parse(JSON.stringify(s)); if (PCT.engine.tick(probe)) PCT.store.commit(st => { PCT.engine.tick(st); }); };
    try { runTick(); } catch (e) { console.error(e); }
    setInterval(() => { try { runTick(); } catch (e) { console.error(e); } }, 60000);
    PCT.app.started = true;
    render();
  }

  return { start, render, go, NAV, LANDING, currentUser, locals, started: false };
})();
