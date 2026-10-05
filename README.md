# Procurement Control Tower

**One Purchase ID · one current stage · one current owner · one next action · one due date · one status · one complete audit trail.**

A master-driven procurement process application that covers the full lifecycle. It replaces scattered Excel trackers with one live control tower.

```
Requirement → PR → Initial Review → Approval → Vendor Sourcing → RFQ → Quotation → Comparison → Vendor Selection
→ PO / Agreement → Vendor Advance → Delivery / Service → GRN / Service Confirmation → Invoice → Invoice Verification
→ 3-Way Match → Payment Approval → Payment → Advance Adjustment → Balance Payment → Closure → Analytics
```

At any moment every screen answers seven questions:

1. What is this purchase?
2. Where is it now?
3. Who has the ball?
4. What needs to be done?
5. When is it due?
6. What is blocking it?
7. What happens next?

---

## Run it

No installation, build or internet connection is required (it uses Google Fonts when online and falls back to system fonts).

| Option | How |
|---|---|
| Double-click | Open `index.html` in Chrome or Edge |
| Local server (recommended for multi-window demos) | `python3 -m http.server 8000` in this folder, then open http://localhost:8000 |
| Share with a team | Enable **GitHub Pages** on the repository (root folder), or copy the folder to any static web host or SharePoint site |

Sign in by choosing a demo user. To open a specific user directly, use `index.html?as=U09#/my-actions`.

Demo data is generated on first load: 30 purchases, 14 vendors, 8 departments and 18 users. Each record is produced by **driving the real workflow engine**, so statuses, SLA, exceptions and audit history are all consistent. **Live Demo → Reset demo data** restores the starting point.

---

## Presenter script (≈ 10 minutes)

1. **The 30-second test.** Sign in as **Rajesh Menon (CO. CEO)** and open **Dashboard**. It shows:
   - what is happening and where the purchases are;
   - what is delayed and who has the ball;
   - the top 5 exceptions;
   - financial exposure: open value + outstanding advance + pending payment.
2. **Control Tower.** Click any stage of the pipeline (for example *Approval*) to drill down to the purchases in it, each with its owner, due date and ageing.
3. **One purchase, one page.** Search `PUR-2026-00125`, or ask the search box *"Where is PUR-2026-00125?"*. The page shows:
   - who has the ball: Sudhakar R, approval, due today, 1 day ageing;
   - the stage map;
   - documents, approvals, vendor and quotations, PO, advance, invoices, payments, exceptions, comments and the audit trail.
4. **Live hand-off across windows.** Open **Live Demo**, then open the role windows side by side.
   - Click **Start guided demo** to raise *Machine / Equipment ₹2,50,000 with 50% advance*.
   - Each window updates live as the ball moves: Requestor → Procurement → Dept Head → Management → Procurement (RFQ, quotes, technical evaluation, PO) → Finance (advance) → Stores (delivery, GRN) → Accounts Payable (invoice, 3-way match) → Finance (payment approval, advance adjustment) → Balance payment → Closure.
5. **Controls that bite.** Each of these is enforced by the engine:
   - `PUR-2026-00129`: comparison is blocked by **Rule R03** (only 2 of 3 quotations).
   - `PUR-2026-00136`: the **3-way match** fails (*Invoice qty 100 · GRN qty 80 · Mismatch 20 units*), raises an exception and blocks payment.
   - `PUR-2026-00137`: payment approval warns *"Existing advance ₹75,000 with BlueLine"* (**Rule R02**).
   - `PUR-2026-00138`: the advance stays **outstanding (₹75,000)** after payment, and closure is refused until it is adjusted or recovered.
   - `PUR-2026-00135`: the advance is overdue (31–60 day bucket) and escalated, and the vendor delay is logged.
6. **Configurable without code.** Sign in as **Kavya Reddy (Admin)**.
   - Change a rule parameter, an approval band or an SLA.
   - Or create **Process V2.0**: add a stage, then publish.
   - Existing purchases stay on their original version; new ones use the new version.
7. **Time travel.** Use **Live Demo → +1 day** to show SLA reminders, overdue status and escalations (owner → department head → management) firing automatically.

---

## What is in it

| Area | Highlights |
|---|---|
| **Master Data Center** | All 21 masters: process, stage, activity, role, user, department, cost centre, category, vendor, approval matrix, document, status, priority, SLA, escalation, decision rules, notification, vendor advance types, advance approval, advance ageing buckets, settlement rules |
| **Process Builder** | Draft, then edit stages and activities (owner, SLA, approval, activation conditions, required documents), then publish. Versions are kept (V0.9 retired, V1.0 active), each version shows how many purchases are linked to it, and versions can be compared |
| **Workflow engine** | Stages and activities are generated from the version. Owners are resolved automatically (department head, assigned buyer, receiver by category type, advance approver by %). Only one open activity exists at a time |
| **Rule engine** | R01 high-value approval · R02 advance warning before payment · R03 minimum quotations · R04 invoice ≠ GRN raises an exception · R05 vendor exposure · R06 SLA escalation · R07 mandatory documents · R08 advance workflow · R09 advance overdue · R10 late delivery · R11 non-L1 selection needs approval |
| **SLA & escalation** | Due date = start date + SLA (working days) × priority factor. Reminder → 1 day overdue → owner → 2 days → department head → 3 days → management |
| **Vendor advance** | Request → justification → approval (band by %) → finance verification → payment → **outstanding** → adjustment (full, partial or multi-invoice) → balance payment or recovery → closed. Ageing buckets and overdue escalation included |
| **3-way match** | PO ↔ GRN ↔ Invoice on vendor, quantity, price, tax and total, within a configurable tolerance. A mismatch raises an exception and blocks payment. It can be resolved by revised invoice, credit note or an approved variance |
| **Closure control** | 8 checks: activities, approvals, documents, delivery, invoice, payment, advance fully settled, no open issues |
| **Visibility** | Dashboard (30-second test), Process Control Tower with drill-down, My Actions, Approvals, purchase detail, global search plus a rule-based assistant, saved filters |
| **Registers** | Purchases, vendors (with performance), RFQ & quotations, POs, advances (ledger + ageing), delivery / GRN, invoices, payments, exceptions, documents |
| **Reports** | Cycle times, SLA achievement, bottlenecks, vendor performance, financial control, and Excel exports (Purchase Tracker, Activity Tracker, Pending Approvals, Vendor, Advance, Payment, Overdue, Management Report) |
| **Excel** | Real `.xlsx` import and export with no dependencies. Excel is used for import and export only, never as the source of truth |
| **Audit trail** | Append-only record of who, what, when, previous value and new value. No delete exists anywhere |

---

## Internal controls built in

| Control | Where enforced |
|---|---|
| Segregation of duties | A requestor cannot approve their own purchase. A PO creator cannot approve it. An advance requester cannot approve the advance. Approvals cannot be reassigned to the requestor |
| Delegation of authority | The Approval Matrix (value bands, plus optional category and department rules) generates the approval levels per purchase |
| Competitive sourcing | R03 minimum quotations. A single source requires justification. A non-L1 selection requires a reason plus department head approval (R11) |
| Commitment control | A PO is released only after approvals, then PO approval, then vendor acceptance. PO expiry is flagged |
| Advance control | Approval band by %, a finance verification checklist, settlement due date, ageing, an overdue exception and escalation. Closure is blocked while any advance is outstanding |
| Pay only for what was received | 3-way match with tolerance. A mismatch puts a payment block in place until it is resolved, and a duplicate invoice number is rejected |
| Evidence | Mandatory documents per stage (R07) and an immutable audit log |

---

## ERP / SAP mapping (for the production roadmap)

| Control Tower step | SAP MM / FI equivalent |
|---|---|
| Purchase Request | ME51N (Purchase Requisition) |
| Approval (matrix) | ME54N / release strategy |
| RFQ / Quotation | ME41 / ME47 |
| Quotation comparison | ME49 (price comparison) |
| PO create / approve | ME21N / ME29N (release) |
| Vendor advance | F-47 (down payment request) / F-48 (down payment) |
| GRN / Service confirmation | MIGO (101) / ML81N (service entry sheet) |
| Invoice + 3-way match | MIRO with tolerance keys and payment block |
| Advance adjustment | F-54 (clear down payment) |
| Payment | F110 (payment run) / F-53 |

---

## Architecture

The app is vanilla JavaScript with no build step and no dependencies, so it runs from `file://` or any static host. The data flow is:

```
masters.js → process version → engine.js (rules · SLA · escalation · advance ledger · match · closure)
          → store.js (single source of truth, live sync across browser windows)
          → selectors.js (every KPI computed one way) → kit.js + pages/*
```

`docs/ARCHITECTURE.md` documents the developer contract: the state model, engine operations and payloads, selectors, the UI kit and the page contract.

The data model is AI-ready. Every purchase, activity, owner, due date and audit event is structured, so the rule-based assistant in global search can be swapped for an LLM later.

### Path to production

1. **Backend & database.** Replace `store.js` (localStorage) with a REST API plus websocket. The masters become tables, and the engine runs server-side.
2. **Identity.** Replace the demo user picker with SSO (Azure AD / Okta) and the employee master.
3. **Documents.** Move attachments to SharePoint / S3 with access control.
4. **Notifications.** The notification master already defines channels. Add email and Teams delivery.
5. **ERP integration.** Push PO, GRN, invoice and payment to SAP / Oracle / Tally, and pull the vendor master and budgets.
6. **Analytics.** Connect Power BI to the same tables for spend analysis, vendor performance and SLA trends.

### Demo limitations

- Data lives in the browser's localStorage, shared across windows on the same machine.
- Uploaded files keep their names only, not their content.
- Sign-in is a demo picker, not authentication.
