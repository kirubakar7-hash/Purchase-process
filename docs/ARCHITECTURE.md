# Procurement Control Tower — Architecture & Developer Contract

> One Purchase ID · one current stage · one current owner · one next action · one due date · one status · one complete audit trail.

## 1. Shape of the system

```
MASTER DATA (js/data/masters.js)           ← editable in Administration
   ↓
PROCESS VERSION (stages → activities)      ← Process Builder (draft → publish; history protected)
   ↓
RULE ENGINE (conditions + Decision Rules)  ← stage activation, approvals, blocks, exceptions
   ↓
WORKFLOW ENGINE (js/core/engine.js)        ← create, act, SLA, escalation, advance ledger, match, closure
   ↓
STATE (js/core/store.js)                   ← single source of truth, shared live across tabs
   ↓
SELECTORS (js/core/selectors.js)           ← every KPI / table / analytic computed one way
   ↓
UI KIT + PAGES (js/ui/kit.js, js/pages/*)  ← render(ctx) → HTML; actions → engine
```

No build step, no external libraries. Classic `<script>` files attach to the global `PCT` namespace in the order
listed in `index.html`, so the app runs from `file://` or any static host. Production swap points are the store
(REST + websocket instead of localStorage) and the session (SSO instead of the demo user picker).

## 2. Files

| File | Responsibility |
|---|---|
| `js/core/util.js` | `PCT.clock` (demo time travel), `PCT.util` (ids, dates, working-day SLA maths, formatting `fmt.inr/inrShort/date/due/ago`, CSV, download) |
| `js/core/icons.js` | `PCT.icon(name, size)` — see `PCT.icon.names` |
| `js/data/masters.js` | All 21 masters + Process V0.9 (retired) and V1.0 (active, 21 stages) |
| `js/core/engine.js` | `PCT.engine` — workflow engine (see §5) |
| `js/core/selectors.js` | `PCT.sel` — derived data (see §6) |
| `js/data/seed.js` | Demo data built by driving the real engine (30 purchases) |
| `js/core/store.js` | `PCT.store` — `get()`, `commit(fn)`, `reset()`, `session` |
| `js/ui/kit.js` | `PCT.ui` — HTML components, modal, toast, formValues (see §7) |
| `js/app.js` | Page registry, router, shell (sidebar, search, notifications, user switch), events |
| `js/pages/*.js` | One module per feature; each calls `PCT.pages.register(...)` |
| `css/app.css` | Design system. Page-specific CSS → `PCT.ui.css('page-id', '...')` |

## 3. State shape (`PCT.store.get()`)

```js
{
  meta: { schema, version, runId, clockOffsetDays, counters: { PUR, PO, GRN, SC, RFQ, QTN, INV, ADV, PAY, EXC } },
  masters: { processes, roles, ownerResolvers, users, departments, costCentres, categories, vendors, approvalMatrix,
             documents, statuses, priorities, sla, escalations, rules, notifications,
             advanceTypes, advanceApproval, ageingBuckets, settlementRules, towerGroups },
  purchases: [Purchase], advances: [Advance], payments: [Payment], exceptions: [Exception],
  notifications: [Notification], audit: [AuditEntry], savedFilters: [SavedFilter], imports: []
}
```

**Purchase** (`PUR-2026-00125`): `id, prNo, processId, processVersion, title, description, specification, categoryId,
deptId, costCentreId, qty, uom, estValue, requiredBy, priority (P1–P4), justification, budgetAvailable,
flags{advanceRequired, advancePct, advanceTypeId, singleSource, emergency, agreementRequired}, status
(Draft|Open|On Hold|Rejected|Closed|Cancelled), requestorId, buyerId, createdAt, submittedAt, closedAt, returned,
stages[{stageId,name,seq,group,active,status,startedAt,completedAt}],
activities[{id, masterId, stageId, stageName, group, name, actionType, ownerRole, ownerUserId, approval, approvalLevel,
  status (Not Started|In Progress|Waiting|Blocked|Completed|Skipped|Rejected), startAt, dueAt, completedAt, completedBy,
  slaDays, checklist[], requiredDocs[], blocker, waitingOn (vendor|requestor|bank), nextAction, remarks, escalations[],
  clarification{question,askedBy,askedAt,response,respondedAt}, dependsOn}],
approvals[{level, roleId, label, matrixId, userId, status, at, remarks}],
documents[{docId, name, stages[], mandatory, system, status (Missing|Received|Verified|Not Required), fileName, uploadedAt, uploadedBy}],
sourcing{vendorIds}, rfqs[{id, vendorId, rfqDate, dueDate, responseDate, status, followUps[]}],
quotations[{id, vendorId, rfqId, date, validityDays, amount, taxPct, tax, total, deliveryDays, paymentTerms, warranty, commercialTerms, specCompliance, fileName, status}],
comparison{recommendedVendorId, l1VendorId, ranking[], justification}, techEval{criteria[], result},
selection{vendorId, reason, lowestSelected, approverId}, po{number, vendorId, qty, unitPrice, basic, taxPct, tax, total,
deliveryDays, paymentTerms, warranty, validityDays, validUntil, status, expectedDelivery, sentAt, acceptedAt, history[]},
advanceIds[], deliveries[{id, date, expectedDate, qty, quality, specOk, note, fileName, rejection, shortage, late, delayDays}],
grns[{number, type (GRN|Service Confirmation), poNumber, receiptDate, qty, acceptedQty, rejectedQty, remarks}],
invoices[{id, number, date, vendorId, poNumber, qty, value, taxPct, tax, total, dueDate, receivedDate, status, paidAmount, adjustedAmount, history[]}],
paymentIds[], match{result, lines[], acceptedVariance}, paymentApproval{...}, comments[{id,userId,t,text}] }`

**Advance** (`ADV-2026-00025`): `purchaseId, poNumber, vendorId, typeId, pct, amount, justification, approval, verification,
paidAmount, paymentDate, paymentRef, settlementDays, settlementDueDate, adjustments[{invoiceId, invoiceNumber, amount, at, by}],
recoveries[{amount, ref, at}], status (Requested|Approved|Verified|Outstanding|Partially Adjusted|Adjusted|Recovered|Closed|Rejected)`.
Outstanding = paid − adjusted − recovered — **an advance is never closed just because it was paid.**

**Payment** (`PAY-…`): `purchaseId, poNumber, invoiceIds, advanceId, vendorId, type (Advance|Invoice|Balance), amount, date, bank, mode, utr, proof, status (Pending|Approved|Processing|Paid|Failed|Reversed), history[]`.

**Exception** (`EXC-…`): `purchaseId, type, title, description, ownerUserId, date, severity (High|Medium|Low), action, dueDate, resolution, resolvedAt, closedAt, status (Open|In Progress|Resolved|Closed), key, source`.

**AuditEntry**: `t, userId, action, entity, entityId, purchaseId, field, prev, next, note` — append-only; there is no delete API.

## 4. Process V1.0 (21 stages)

`S01 Requirement · S02 Purchase Request · S03 Initial Review · S04 Approval (levels from Approval Matrix) · S05 Vendor Sourcing ·
S06 RFQ · S07 Quotation · S08 Quotation Comparison (+ technical evaluation if category requires) · S09 Vendor Selection
(+ non-L1 approval) · S10 PO / Agreement (create → approve → send/accept) · S11 Vendor Advance (if advance: request → approve →
verify → pay) · S12 Delivery / Service · S13 GRN / Service Confirmation · S14 Invoice Receipt · S15 Invoice Verification ·
S16 3-Way Match · S17 Payment Approval · S18 Payment (no advance) · S19 Advance Adjustment (advance) · S20 Balance Payment (advance) · S21 Closure`

Stages activate by `activation` conditions; activities can carry a runtime `condition` (evaluated when the activity
becomes current — e.g. non-L1 approval is skipped automatically when L1 is selected).

## 5. Engine API (`PCT.engine`, aliased `ctx.E`)

**Always change state through `ctx.act(...)` or `ctx.commit(fn)`** — never mutate `ctx.state` directly in render code.

```js
ctx.act(purchaseId, activityId, op, payload)   // → {ok, error?, message?}; toasts automatically; commits + re-renders
E.createPurchase(state, input, userId, {submit}) // → {ok, purchase}  (use inside ctx.commit)
E.ball(state, p)            // {ownerUserId, ownerName, withLabel (dept), roleName, activity, activityName, stageName,
                            //  nextAction, dueAt, ageingDays, overdueDays, status (display), waitingOn, blocker, closed}
E.currentActivity(p)        // the ONE open activity (In Progress | Waiting | Blocked) or null
E.displayStatus(state, a)   // adds 'Overdue' when past due
E.canAct(state, user, p, a) // owner, pool role, or requestor answering clarification
E.closureChecks(state, p)   // [{key,label,ok,detail}] — 8 closure controls
E.matchResult(state, p)     // {ok, lines:[{key,label,po,grn,invoice,ok,detail,money,pct}], tolerancePct, expected}
E.invoiceTotals(p)          // {total, paid, adjusted, balance, qty, basic, tax}
E.advanceOutstanding(adv), E.advanceAgeing(state, adv), E.vendorOutstanding(state, vendorId), E.purchaseAdvanceOutstanding(state, p)
E.approvalLevels(state, pLike), E.plan(state, pLike)   // preview: works on a temporary object without touching state
E.context(state, p), E.evalCond(cond, ctx), E.describeCond(cond)
E.user/role/dept/vendor/category/purchase/advance(state, id), E.userName(state, id), E.rule(state, 'R03'), E.ruleParam(state, id, key, dflt)
E.activeVersion(state), E.version(state, ver), E.process(state), E.stagesFor(state, p), E.stageDef(state, p, stageId)
E.raiseException(state, {...}, userId), E.updateException(state, id, {status, resolution, ownerUserId}, userId)
E.audit(state, {userId, action, entity, entityId, purchaseId, field, prev, next, note}), E.notify(...), E.nextId(state, 'PUR')
// Admin (all audited; use inside ctx.commit):
E.masterSave(state, key, record, userId), E.masterSetStatus(state, key, id, status, userId)
E.createDraftVersion(state, 'PROC-PUR', fromVer, newVer, userId), E.updateVersion(state, 'PROC-PUR', ver, v => {...}, userId, note)
E.discardDraft(state, 'PROC-PUR', ver, userId), E.publishVersion(state, 'PROC-PUR', ver, 'YYYY-MM-DD', userId)
E.tick(state)               // escalation engine (app runs it every minute)
```

### Operations by `activity.actionType` (pass `op` + `payload` to `ctx.act`)

| actionType | op → payload |
|---|---|
| `requirement` | `complete {remarks}` |
| `pr_submit` | `submit {}` (validates mandatory PR fields). Edit first with generic `edit` while returned/draft |
| `review` | `complete {remarks}` · `return {reason}` |
| `approval` | `approve {remarks}` · `reject {remarks}` · `return {remarks}` · `clarify {question}` |
| `sourcing` | `complete {vendorIds[], newVendor?{name, city, gstin, pan, contact}}` |
| `rfq` | `send {vendorIds?, dueDate?}` · `followup {rfqId, note}` · `received {rfqId, date?}` · `expire {rfqId}` · `cancel {rfqId}` · `complete {}` |
| `quotation` | `save {vendorId, amount, taxPct, deliveryDays, validityDays, paymentTerms, warranty, commercialTerms, specCompliance (Yes/Partial/No), fileName}` · `remove {quotationId}` · `complete {}` |
| `comparison` | `complete {recommendedVendorId?, justification?}` — Rule R03 blocks if too few quotes; non-L1 / single-source need justification |
| `tech_eval` | `complete {criteria:[{name, ok, remark}], remarks}` — any `ok:false` returns to comparison |
| `selection` | `complete {vendorId, reason}` — reason mandatory if not L1 (R11) |
| `selection_approval` | `approve {remarks}` · `return {remarks}` |
| `po_create` | `create {qty?, unitPrice?, taxPct?, deliveryDays?, paymentTerms?, warranty?, validityDays?, agreementFileName?}` |
| `po_approve` | `approve {remarks}` · `return {remarks}` (creator cannot approve) |
| `po_send` | `send {}` (→ Waiting vendor) · `accept {date?}` |
| `advance_request` | `submit {pct, amount?, typeId, justification, settlementDays?, proformaFileName}` |
| `advance_approve` | `approve {remarks}` · `reject {remarks}` (purchase continues without advance) · `return {remarks}` |
| `advance_verify` | `verify {checklist:{item:bool}}` · `hold {reason}` · `resume {}` |
| `advance_pay` | `pay {date?, mode, bank?, utr}` → advance becomes **Outstanding** |
| `delivery` | `record {actualDate?, qty, quality, specOk, deliveryNote, fileName, rejection, partial, remarks}` · `delay {reason, newDate}` · `update {expectedDate}` |
| `grn` | `create {receiptDate?, qty, acceptedQty, rejectedQty, remarks}` |
| `invoice` | `record {number, date?, qty, value?, taxPct?, dueDate?, receivedDate?, fileName, partial?}` |
| `invoice_verify` | `verify {checklist}` · `hold {reason, type}` · `resume {}` |
| `match` | `run {}` (mismatch → exceptions + Blocked) · `resolve {resolution: revised_invoice|credit_note|accept_variance, invoiceId, qty?, value?, taxPct?, number?, remarks}` |
| `payment_approval` | `approve {acknowledgeAdvance, remarks}` (R02: required when vendor has outstanding advance) · `return {remarks}` |
| `payment` / `balance_payment` | `pay {mode, bank?, utr, date?, status?:'Processing'}` · `confirm {utr}` · `fail {reason}`; balance also `recover {amount, ref, mode}` · `complete {}` (when balance is 0) |
| `adjustment` | `adjust {advanceId?, invoiceId?, amount?, remarks}` (repeatable — multiple invoices / partial) · `complete {}` |
| `closure` | `close {remarks}` — refused with reasons unless all 8 closure checks pass |

**Generic ops** (activityId `null`): `comment {text}`, `upload_doc {docId, fileName}`, `verify_doc {docId}`,
`reassign {activityId, userId, reason}`, `hold {reason}`, `resume {}`, `cancel {reason}`, `clarify_response {response}`,
`edit {title, estValue, qty, …, flags}` (requestor, while PR is with them).

## 6. Selectors (`PCT.sel`, aliased `ctx.S`)

`row(state, p)` (flattened row: stage, owner, actStatus, dueAt, ageingDays, overdueDays, vendor, poNumber, advanceOutstanding,
pendingPayment, paymentStatus, openExceptions …) · `rows(state, list)` · `visiblePurchases(state, user)` · `myActions(state, user)` ·
`kpis(state, user, list?)` · `tower(state, list?)` (per stage group: open, completed, overdue, blocked, value, purchases) ·
`tower(state, list?)` · `bottlenecks(state, list?)` · `slaStats(state, list?)` · `cycleTimes(state, list?)` · `vendorPerformance(state)` · `financial(state, list?)` ·
`advanceRows(state)` · `ageingSummary(state)` · `exceptionRows(state, list?)` · `documentSummary(state, p)` · `timeline(state, p)` ·
`notificationsFor(state, userId)` · `search(state, q, user)` · `statusTone(state, kind, name)` · `deptName/vendorName/catName/ccName`.

**Visibility:** on user-facing pages always pass `S.visiblePurchases(state, user)` as `list` (and filter advances/payments/exceptions
by those purchase ids) so restricted users never see company-wide figures. `documentSummary` marks system-generated documents of the
stage in progress as `Pending (auto)` (not Missing). Table columns accept `cls` (applied to th and td) and `hideOnMobile: true`.

## 7. UI kit (`PCT.ui`, aliased `ctx.ui`)

`pageHead({title, sub, icon, crumbs, actions, badge})`, `card({title, sub, icon, actions, body, foot, flush, cls})`,
`kpi({label, value, sub, tone, href, icon, money})`, `table(columns, rows, {key, sort: ctx.local[key+'Sort'], rowHref, rowClass, empty, dense, limit, foot})`,
`tabs(key, [{id,label,count}], active)` / `seg(...)` (active tab kept in `ctx.local[key]`), `badge(text, tone)`, `status(state, kind, name)`,
`actStatus(state, a)`, `money(v)`, `moneyShort(v)`, `due(t)`, `ageing(days)`, `person(state, userId)`, `avatar(name)`, `priority(state, id)`,
`field({name, label, type: text|number|money|date|select|textarea|checkbox|file|hidden, value, options, required, hint, full})`,
`checklist(name, items, checked)`, `formValues(el)` (dates → ms, numbers → Number, `a.b` → nested), `stepper(state, p)`,
`ballCard(state, p, {viewer, compact, actions})`, `alert(tone, html)`, `empty(icon, title, text, action)`, `progress(pct, tone)`,
`hbars([{label, value, display, tone, href}])`, `modal.open({title, body, size, actions:[{label, act, tone}], onAction:{act: values => false|void}})`,
`confirm({title, text, confirmLabel, tone}) → Promise`, `toast(msg, tone, title)`, `css(id, text)`.

Tones: `grey blue yellow orange green red black purple navy`. Buttons: `btn btn-primary|btn-blue|btn-success|btn-danger|btn-warn|btn-outline-danger|btn-ghost` + `btn-sm|btn-xs|btn-lg`.

## 8. Page contract

```js
PCT.pages.register({
  route: 'vendors',                // #/vendors and #/vendors/V001 (ctx.params = ['V001'])
  title: 'Vendors',
  perms: ['procure', 'vendor.manage', 'finance', 'analytics', 'admin'],   // any-of; omit = all users
  render(ctx) { return html },     // pure function of ctx.state + ctx.local + ctx.query
  after(ctx, root) {},             // optional DOM work
  actions: { 'vendor-save'(ctx, el, ev) {} }   // data-act="vendor-save"
});
```

Custom routes: add `match: path => /^purchases\/PUR-/.test(path)` to claim a path pattern (params = segments after the first).

Events: `data-act="name"` (click), `data-act-change`, `data-act-input`, `<form data-submit="name">`, `data-href` on rows.
Global actions available everywhere: `tab` (data-key, data-tab), `sort`, `toggle` (data-key), `set` (data-key, data-value), `nav` (data-to).
Action forms (`js/pages/action-forms.js`) expose `PCT.actionForms.render(ctx, p, a)` and handlers named `af-*`, which the app
dispatches on every page — so My Actions, Approvals or the Purchase page can all embed the same action panel.

Permissions (role master): `purchase.create, purchase.view_own, purchase.view_dept, purchase.view_all, approve, procure,
vendor.manage, receive, finance, reports, analytics, admin`. Visibility of purchases: `S.visiblePurchases(state, user)`.

### Shared module contracts

* `PCT.actionForms` (`js/pages/action-forms.js`): `render(ctx, p, a) → html` for the current activity; handlers `af-*`.
* `PCT.excel` (`js/core/excel.js`): `exportWorkbook(filename, [{name, columns:[{key,label,value?(row)}], rows}])` downloads a real .xlsx;
  `readFile(File) → Promise<{sheets:[{name, rows:[{header: value}]}]}>` reads .xlsx or .csv; `toCSV`/`downloadCSV` helpers.
  Callers must fall back to CSV (`PCT.util.toCSV` + `PCT.util.download`) if `PCT.excel` is missing.
* `PCT.assistant` (`js/core/assistant.js`): `answer(state, question, user) → {text, links:[{label, href}]}` — used by global search.
* `PCT.seed.defaultOps(state, p, a)` → the typical `[op, payload]` list for the current activity (presenter auto-complete).
* Purchases list query contract (links from dashboards / tower): `#/purchases?status=open|draft|overdue|blocked|waiting-vendor|pending-approval|completed|rejected&group=PAYMENT&stage=S04&dept=DPT-IT&owner=U09&vendor=V001&category=CAT-ITH&priority=P1&q=text&mine=1`.

## 9. Conventions

* Escape every user-provided string with `esc()`. Format money with `ui.money` / `fmt.inr` (Indian grouping ₹2,50,000).
* Keep screens simple: tables, cards, badges, one primary action. Status colour = meaning (green done, blue in progress,
  yellow waiting, orange blocked, red overdue, black rejected).
* Every screen answers: what is it, where is it, who has the ball, what must they do, when is it due, what blocks it, what next.
* Mobile ≤ 900px: sidebar collapses; tables scroll inside `.table-wrap`; grids stack.
* Never delete audit history. Masters are deactivated, not deleted, once referenced.

## 10. Demo data highlights (seeded)

| Purchase | Situation |
|---|---|
| PUR-2026-00125 Laptop Purchase ₹2,50,000 | At Approval L1 with **Sudhakar R** (IT head), ageing 1 day, due today |
| PUR-2026-00126 Air compressor ₹14.5L | L2 Finance approval 3 days overdue → escalated |
| PUR-2026-00127 Brand video | Management asked a clarification → ball with requestor Deepa |
| PUR-2026-00128 Server rack | RFQ: 1 of 3 vendors responded; follow-ups pending |
| PUR-2026-00129 CNC spares | Only 2 quotations → Rule R03 blocks comparison |
| PUR-2026-00130 Machine / Equipment ₹2.5L | Technical evaluation with Meena Rao (advance 50% later) |
| PUR-2026-00131 Electrical cabling | Non-L1 vendor selected → Dept Head approval pending |
| PUR-2026-00132 CAD licences (single source) | PO approval with Suresh Iyer, overdue |
| PUR-2026-00133 Fork-lift | Advance 40% awaiting Finance approval |
| PUR-2026-00134 Solar lights | PO sent — waiting vendor acceptance |
| PUR-2026-00135 Packaging machine | Advance ₹2,00,000 outstanding 34 days (overdue) + vendor delay |
| PUR-2026-00136 Trolleys | 3-way match exception: invoice 100 vs GRN 80 → mismatch 20 units |
| PUR-2026-00137 Housekeeping (BlueLine) | Payment approval — **existing advance ₹75,000** warning (R02) |
| PUR-2026-00138 Facility overhaul (BlueLine) | Advance ₹2,00,000 · adjusted ₹1,25,000 · **outstanding ₹75,000** · balance payment pending |
| PUR-2026-00139 Digital campaign | Payment processing at bank |
| PUR-2026-00140 Pallet racking | On hold (blocked) — budget re-validation |
| PUR-2026-00141 Laptops for joiners | Payment failed → exception |
| PUR-2026-00142 Fire extinguisher refill | Ready for closure |
| PUR-2026-00101/102 | Closed under retired Process V0.9 |
| PUR-2026-00106/109/111/113 | Closed — full adjustment, service, 100% advance, multi-invoice adjustment |
| PUR-2026-00115/117 | Rejected |
| PUR-2026-00118 | Draft · PUR-2026-00119 returned to requestor · PUR-2026-00120 initial review |

Users: Ravi Kumar U01 (requestor), Anita Sharma U02 (Projects head), Rajeshwari M U03 (buyer), Suresh Iyer U04 (procurement lead),
Meena Rao U05 (technical), Karthik S U06 (stores), Priya Nair U07 (finance controller), Arun Das U08 (AP), Sudhakar R U09 (IT head),
Rajesh Menon U10 (CO. CEO), Kavya Reddy U11 (admin), Deepa U12, Vikram U13, Lakshmi U14, Farhan U15, Nisha U16, Gopal U17, Anjali U18.
Open any user in a new window with `index.html?as=U09#/my-actions`.
