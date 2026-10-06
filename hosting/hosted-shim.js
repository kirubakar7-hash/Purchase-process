/* =====================================================================
   HOSTED-PREVIEW SHIM — loaded only by the claude.ai artifact build.
   The hosted viewer blocks file downloads, new windows and printing,
   so this swaps those for in-page equivalents. The repo version
   (index.html) never loads this file.
   ===================================================================== */
(function () {
  window.PCT_ENV = 'hosted';
  const U = PCT.util;
  const esc = U.esc;

  /* ---- copy helper (clipboard works inside a click handler) ---- */
  function copyText(text, okMsg) {
    const done = () => PCT.ui.toast(okMsg || 'Copied — paste into Excel', 'green');
    const fallback = () => {
      const ta = document.getElementById('hosted-copy-area');
      if (ta) { ta.hidden = false; ta.value = text; ta.focus(); ta.select(); }
      PCT.ui.toast('Press Ctrl+C / Cmd+C to copy the selected text', 'navy');
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }
  const tsv = (cols, rows) => [cols.map(c => c.label).join('\t')].concat(rows.map(r => cols.map(c => {
    const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
    return v == null ? '' : String(v).replace(/[\t\n\r]+/g, ' ');
  }).join('\t'))).join('\n');

  function showSheets(filename, sheets) {
    let current = 0;
    const body = () => `
      <p class="muted">This hosted preview cannot download files. Copy a sheet and paste it into Excel — or open the app from the repository to download <b>${esc(filename)}</b> directly.</p>
      ${sheets.length > 1 ? `<div class="row wrap mb-12">${sheets.map((s, i) => `<button type="button" class="chip ${i === current ? 'active' : ''}" data-hosted-sheet="${i}">${esc(s.name)} <b>${s.rows.length}</b></button>`).join('')}</div>` : ''}
      <div class="table-wrap" style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:8px">
        <table class="tbl dense"><thead><tr>${sheets[current].columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${sheets[current].rows.slice(0, 50).map(r => `<tr>${sheets[current].columns.map(c => { const v = typeof c.value === 'function' ? c.value(r) : r[c.key]; return `<td>${esc(v == null ? '' : v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
      </div>
      ${sheets[current].rows.length > 50 ? `<div class="small muted mt-8">Preview shows 50 of ${sheets[current].rows.length} rows — Copy includes all rows.</div>` : ''}
      <textarea id="hosted-copy-area" class="input mt-8" rows="3" hidden></textarea>`;
    const open = () => PCT.ui.modal.open({
      title: `Export · ${esc(filename)}`, size: 'xl', body: body(),
      actions: [{ label: 'Close', act: 'close' }, { label: `Copy “${sheets[current].name}” for Excel`, act: 'copy', tone: 'primary', icon: 'copy' }],
      onAction: { copy: () => { copyText(tsv(sheets[current].columns, sheets[current].rows), `${sheets[current].rows.length} rows copied — paste into Excel`); return false; } }
    });
    open();
    document.getElementById('modal-root').addEventListener('click', ev => {
      const b = ev.target.closest('[data-hosted-sheet]');
      if (b) { current = Number(b.dataset.hostedSheet); open(); }
    });
  }

  /* ---- downloads → copy ---- */
  U.download = function (filename, content) {
    if (typeof content === 'string') {
      const rows = content.replace(/^﻿/, '');
      PCT.ui.modal.open({
        title: `Export · ${esc(filename)}`, size: 'lg',
        body: `<p class="muted">This hosted preview cannot download files. Copy the data and paste it into Excel, or open the app from the repository to download it.</p><textarea id="hosted-copy-area" class="input" rows="10" readonly>${esc(rows.slice(0, 200000))}</textarea>`,
        actions: [{ label: 'Close', act: 'close' }, { label: 'Copy for Excel', act: 'copy', tone: 'primary', icon: 'copy' }],
        onAction: { copy: () => { copyText(/\.csv$/i.test(filename) ? csvToTsv(rows) : rows); return false; } }
      });
    } else {
      PCT.ui.toast(`Downloads are disabled in the hosted preview. Open the app from the repository to download ${filename}.`, 'navy', 'Download not available here');
    }
  };
  function csvToTsv(csv) {
    const out = []; let row = [], cell = '', q = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      if (q) { if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); out.push(row.join('\t')); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); out.push(row.join('\t')); }
    return out.join('\n');
  }

  if (PCT.excel) {
    PCT.excel.exportWorkbook = function (filename, sheets) { showSheets(filename, (sheets || []).filter(s => s && s.columns && s.rows)); };
    if (PCT.excel.downloadCSV) PCT.excel.downloadCSV = function (filename, columns, rows) { showSheets(filename, [{ name: 'Data', columns, rows }]); };
  }

  /* ---- new windows → explain the multi-tab way ---- */
  const origOpen = window.open;
  window.open = function () {
    let w = null;
    try { w = origOpen.apply(window, arguments); } catch (e) { w = null; }
    if (!w) {
      const m = String(arguments[0] || '').match(/[?&]as=([^&#]+)/);
      const u = m && PCT.engine.user(PCT.store.get(), decodeURIComponent(m[1]));
      PCT.ui.toast(`Open this artifact link in another browser tab${u ? ` and sign in as ${u.name}` : ''}. Every tab updates live.`, 'navy', 'New windows are blocked here');
    }
    return w;
  };

  /* ---- printing is not available in the viewer ---- */
  window.print = function () { PCT.ui.toast('Printing is not available in the hosted preview. Open the app from the repository to print.', 'navy'); };
})();
