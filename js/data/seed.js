/* =====================================================================
   DEMO DATA — built by DRIVING THE REAL ENGINE, not by hand-writing
   records. Each scenario creates a purchase and performs the same
   actions a user would, with the clock back-dated, so every record,
   audit entry, SLA and exception is internally consistent.
   Seeding therefore doubles as an end-to-end test of the engine.
   ===================================================================== */
window.PCT = window.PCT || {};

PCT.seed = (function () {
  const U = PCT.util;
  const H = 36e5;
  const D = U.DAY;

  /* Hours each default action takes in the simulation */
  const GAP = {
    'requirement:complete': 2, 'pr_submit:submit': 3, 'review:complete': 20, 'review:return': 20,
    'approval:approve': 22, 'approval:reject': 30, 'approval:clarify': 20,
    'sourcing:complete': 26, 'rfq:send': 5, 'rfq:received': 22, 'rfq:complete': 4,
    'quotation:save': 3, 'quotation:complete': 4, 'comparison:complete': 18, 'tech_eval:complete': 20,
    'selection:complete': 6, 'selection_approval:approve': 18, 'po_create:create': 10, 'po_approve:approve': 16,
    'po_send:send': 4, 'po_send:accept': 24, 'advance_request:submit': 8, 'advance_approve:approve': 18,
    'advance_verify:verify': 16, 'advance_pay:pay': 10, 'grn:create': 8, 'invoice:record': 28,
    'invoice_verify:verify': 22, 'match:run': 4, 'payment_approval:approve': 26, 'payment:pay': 18,
    'adjustment:adjust': 5, 'adjustment:complete': 2, 'balance_payment:pay': 18, 'balance_payment:complete': 4,
    'closure:close': 22
  };

  function emptyState() {
    return {
      meta: { schema: 0, version: 1, runId: U.uid('RUN'), seededAt: Date.now(), clockOffsetDays: 0, counters: { PUR: 100, PO: 430, GRN: 870, SC: 110, RFQ: 300, QTN: 620, INV: 200, ADV: 20, PAY: 400, EXC: 10 } },
      masters: PCT.masters.build(),
      purchases: [], advances: [], payments: [], exceptions: [], notifications: [], audit: [],
      savedFilters: [
        { id: 'SF-1', name: 'My Overdue', ownerUserId: null, filters: { mine: true, overdue: true } },
        { id: 'SF-2', name: 'Management Approval Pending', ownerUserId: null, filters: { stage: 'S04', ownerRole: 'management' } },
        { id: 'SF-3', name: 'Vendor Advances >30 Days', ownerUserId: null, filters: { advanceAgeingMin: 31 } },
        { id: 'SF-4', name: 'Payment Pending', ownerUserId: null, filters: { group: 'PAYMENT' } }
      ],
      imports: []
    };
  }

  /* Vendors invited for a category (scenario may override) */
  const vendorsFor = (state, catId) => state.masters.vendors.filter(v => v.categoryIds.includes(catId)).slice(0, 3).map(v => v.id);
  const short = (state, vid) => (U.byId(state.masters.vendors, vid) || { name: vid }).name.split(' ')[0];

  /* Default ops a user performs for each activity type */
  function defaultOps(state, p, a, sc) {
    const E = PCT.engine;
    const o = (sc.ops && sc.ops[a.masterId]) || (sc.ops && sc.ops[a.actionType]);
    if (o) return typeof o === 'function' ? o(state, p, a) : o;
    switch (a.actionType) {
      case 'requirement': return [['complete', {}]];
      case 'pr_submit': return [['submit', {}]];
      case 'review': return [['complete', { remarks: 'Requirement complete; budget available' }]];
      case 'approval': return [['approve', { remarks: 'Approved' }]];
      case 'sourcing': return [['complete', { vendorIds: sc.vendors || vendorsFor(state, p.categoryId) }]];
      case 'rfq': {
        const ops = [['send', {}]];
        return ops.concat([['__rfq_receive_all']], [['complete', {}]]);
      }
      case 'quotation': {
        const f = sc.quoteFactors || [1, 1.06, 1.12];
        const ops = [];
        p.rfqs.filter(r => r.status === 'Received').forEach((r, i) => {
          ops.push(['save', {
            vendorId: r.vendorId, amount: Math.round(p.estValue * (f[i] || 1.15) / 100) * 100, taxPct: 18,
            deliveryDays: (sc.deliveryDays || 14) + i * 3, validityDays: 30,
            paymentTerms: p.flags.advanceRequired ? `${p.flags.advancePct}% advance, balance 30 days` : '30 days from invoice',
            warranty: p.categoryId === 'CAT-SRV' || p.categoryId === 'CAT-FAC' ? 'Workmanship 6 months' : '12 months', specCompliance: 'Yes',
            commercialTerms: 'Freight inclusive; GST extra', fileName: `Quotation_${short(state, r.vendorId)}_${p.id}.pdf`
          }]);
        });
        return ops.concat([['complete', {}]]);
      }
      case 'comparison': return [['complete', p.flags.singleSource ? { justification: 'OEM-authorised single source — proprietary licence; price benchmarked against last renewal (+4%)' } : {}]];
      case 'tech_eval': return [['complete', { remarks: 'Meets specification and quality requirements' }]];
      case 'selection': return [['complete', {}]];
      case 'selection_approval': return [['approve', { remarks: 'Justification accepted' }]];
      case 'po_create': return [['create', { agreementFileName: E.context(state, p).agreementRequired ? `Agreement_${p.id}.pdf` : null }]];
      case 'po_approve': return [['approve', { remarks: 'PO terms verified' }]];
      case 'po_send': return [['send', {}], ['accept', {}]];
      case 'advance_request': return [['submit', { pct: p.flags.advancePct, typeId: p.flags.advanceTypeId, justification: 'Vendor requires advance to procure material / mobilise', proformaFileName: `Proforma_${p.id}.pdf` }]];
      case 'advance_approve': return [['approve', { remarks: 'Advance approved as per policy' }]];
      case 'advance_verify': return [['verify', { checklist: {} }]];
      case 'advance_pay': return [['pay', { mode: 'RTGS', utr: 'UTR' + p.id.slice(-5) + 'A' }]];
      case 'delivery': return [['record', { fileName: E.context(state, p).categoryType === 'material' ? `DC_${p.id}.pdf` : null, deliveryNote: 'DC-' + p.id.slice(-5) }]];
      case 'grn': return [['create', { remarks: 'Received in good condition' }]];
      case 'invoice': return [['record', { number: `${short(state, p.po.vendorId).toUpperCase().slice(0, 4)}/INV/26-27/${p.id.slice(-4)}`, fileName: `Invoice_${p.id}.pdf` }]];
      case 'invoice_verify': return [['verify', { checklist: {} }]];
      case 'match': return [['run', {}]];
      case 'payment_approval': return [['approve', { acknowledgeAdvance: true, remarks: 'Proposal approved' }]];
      case 'payment': return [['pay', { mode: 'NEFT', utr: 'UTR' + p.id.slice(-5) + 'P' }]];
      case 'adjustment': return [['adjust', {}], ['complete', {}]];
      case 'balance_payment': return E.invoiceTotals(p).balance > 0 ? [['pay', { mode: 'NEFT', utr: 'UTR' + p.id.slice(-5) + 'B' }]] : [['complete', {}]];
      case 'closure': return [['close', {}]];
      default: return [['complete', {}]];
    }
  }

  /** Run one scenario from `start`; returns elapsed ms. Throws on engine errors (seed = test). */
  function drive(state, sc, start) {
    const E = PCT.engine;
    let t = start;
    PCT.clock.set(t);
    const input = Object.assign({}, sc.input, { requiredBy: sc.input.requiredBy || U.endOfBusiness(t + 30 * D), flags: Object.assign({}, sc.input.flags) });
    const res = E.createPurchase(state, input, input.requestorId, { submit: !sc.draft, id: sc.id });
    if (!res.ok) throw new Error(`${sc.id}: create failed — ${res.error}`);
    const p = res.purchase;
    if (sc.draft) return 0;
    let guard = 0;
    while (guard++ < 200) {
      const a = E.currentActivity(p);
      if (!a || p.status !== 'Open') break;
      if (sc.stop && sc.stop(p, a)) {
        (sc.atStop || []).forEach(([op, payload, hours, actor]) => {
          t += (hours || 6) * H; PCT.clock.set(t);
          const cur = E.currentActivity(p);
          const who = actor === 'requestor' ? p.requestorId : actor || (cur ? cur.ownerUserId : p.buyerId);
          const r = E.act(state, p.id, null, op, (typeof payload === 'function' ? payload(p) : payload) || {}, who);
          if (!r.ok) throw new Error(`${sc.id}: stop-op ${op} failed — ${r.error}`);
        });
        break;
      }
      const ops = defaultOps(state, p, a, sc);
      for (const [op, payload] of ops) {
        if (op === '__rfq_receive_all') {
          const keep = sc.rfqReceive != null ? sc.rfqReceive : p.rfqs.length;
          p.rfqs.slice(0, keep).forEach(r => { t += GAP['rfq:received'] * H; PCT.clock.set(t); const rr = E.act(state, p.id, null, 'received', { rfqId: r.id }, a.ownerUserId); if (!rr.ok) throw new Error(rr.error); });
          p.rfqs.slice(keep).forEach(r => { t += 2 * H; PCT.clock.set(t); E.act(state, p.id, null, 'expire', { rfqId: r.id }, a.ownerUserId); });
          continue;
        }
        let gap = GAP[`${a.actionType}:${op}`] || 8;
        if (a.actionType === 'delivery') gap = ((p.po.deliveryDays || 10) + (sc.lateDays || 0)) * 24 - 30;
        t += gap * H; PCT.clock.set(t);
        const cur = E.currentActivity(p);
        const who = cur ? cur.ownerUserId : a.ownerUserId;
        const r = E.act(state, p.id, null, op, payload, who);
        if (!r.ok) throw new Error(`${sc.id}: ${a.name} / ${op} failed — ${r.error}`);
      }
    }
    return t - start;
  }

  /* -------------------------------------------------------------------
     Scenarios. `doneAgo` = days ago the last action happened.
     ------------------------------------------------------------------- */
  const at = (m, ...lv) => (p, a) => a.masterId === m && (!lv.length || lv.includes(a.approvalLevel));
  const base = o => Object.assign({ qty: 1, priority: 'P3', budgetAvailable: true, requiredBy: null, description: '', specification: '', justification: 'Required for business operations', flags: {} }, o);

  function scenarios() {
    return [
      /* ---------------- CLOSED ---------------- */
      { id: 'PUR-2026-00101', doneAgo: 150, v09: true, input: base({ title: 'Safety helmets & shoes (60 sets)', categoryId: 'CAT-CON', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 60, estValue: 84000, justification: 'PPE replacement for plant staff', specification: 'ISI marked helmets, steel-toe shoes sizes 6–11' }), vendors: ['V010', 'V007', 'V011'] },
      { id: 'PUR-2026-00102', doneAgo: 140, v09: true, input: base({ title: 'Office stationery (Q1)', categoryId: 'CAT-CON', deptId: 'DPT-MKT', costCentreId: 'CC-MKT-401', requestorId: 'U12', qty: 1, estValue: 38500, justification: 'Quarterly stationery replenishment' }), vendors: ['V007', 'V010', 'V011'] },
      { id: 'PUR-2026-00106', doneAgo: 38, input: base({ title: 'Plant LED lighting retrofit', categoryId: 'CAT-MAT', deptId: 'DPT-OPS', costCentreId: 'CC-OPS-301', requestorId: 'U13', qty: 120, estValue: 420000, justification: 'Energy saving — 40% lower lighting load', flags: { advanceRequired: true, advancePct: 30, advanceTypeId: 'ADT-PART' } }), vendors: ['V011', 'V001', 'V014'], deliveryDays: 12 },
      { id: 'PUR-2026-00109', doneAgo: 26, input: base({ title: 'HVAC annual maintenance contract', categoryId: 'CAT-SRV', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 1, estValue: 180000, justification: 'Statutory upkeep of office HVAC' }), vendors: ['V009', 'V008', 'V013'], deliveryDays: 7 },
      { id: 'PUR-2026-00111', doneAgo: 21, input: base({ title: 'CRM subscription renewal (50 users)', categoryId: 'CAT-SW', deptId: 'DPT-IT', costCentreId: 'CC-IT-120', requestorId: 'U16', qty: 50, estValue: 340000, justification: 'Annual renewal; licences expire this month', flags: { advanceRequired: true, advancePct: 100, advanceTypeId: 'ADT-FULL' } }), vendors: ['V006'], ops: {}, single: true, deliveryDays: 2 },
      { id: 'PUR-2026-00113', doneAgo: 12, input: base({ title: 'Steel plates for fabrication (10 T)', categoryId: 'CAT-MAT', deptId: 'DPT-PRJ', costCentreId: 'CC-PRJ-204', requestorId: 'U01', qty: 10, uom: 'T', estValue: 680000, justification: 'Fabrication of skids for Line-3 project', flags: { advanceRequired: true, advancePct: 25, advanceTypeId: 'ADT-PART' } }), vendors: ['V014', 'V011', 'V002'], deliveryDays: 10, multiInvoice: true },

      /* ---------------- REJECTED ---------------- */
      { id: 'PUR-2026-00115', input: base({ title: 'Premium conference room furniture', categoryId: 'CAT-MAT', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 1, estValue: 295000, justification: 'Board room upgrade' }), stop: at('A0401', 2), atStop: [['reject', { remarks: 'Not budgeted this year — revisit in Q1' }, 30]], doneAgo: 9 },
      { id: 'PUR-2026-00117', input: base({ title: 'Promotional merchandise', categoryId: 'CAT-MAT', deptId: 'DPT-MKT', costCentreId: 'CC-MKT-401', requestorId: 'U12', qty: 500, estValue: 65000, justification: 'Trade-show giveaways' }), stop: at('A0401', 1), atStop: [['reject', { remarks: 'Event cancelled — requirement no longer valid' }, 26]], doneAgo: 16 },

      /* ---------------- OPEN — early stages ---------------- */
      { id: 'PUR-2026-00118', draft: true, doneAgo: 0.2, input: base({ title: 'Workstation chairs (12 Nos)', categoryId: 'CAT-MAT', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 12, estValue: 96000, justification: 'New seating for finance bay' }) },
      { id: 'PUR-2026-00119', input: base({ title: 'Network switches (24-port, 6 Nos)', categoryId: 'CAT-ITH', deptId: 'DPT-IT', costCentreId: 'CC-IT-110', requestorId: 'U16', qty: 6, estValue: 210000, justification: 'Floor-2 network expansion' }), stop: at('A0301'), atStop: [['return', { reason: 'Specification incomplete — confirm PoE budget and uplink type' }, 18]], doneAgo: 1, fix: { startAgo: 1, dueIn: 0 } },
      { id: 'PUR-2026-00120', input: base({ title: 'Third-party inspection services', categoryId: 'CAT-SRV', deptId: 'DPT-PRJ', costCentreId: 'CC-PRJ-204', requestorId: 'U01', qty: 1, estValue: 72000, justification: 'Client-mandated inspection for skid fabrication' }), stop: at('A0301'), doneAgo: 0.1, fix: { startAgo: 0, dueIn: 1 } },
      { id: 'PUR-2026-00125', input: base({ title: 'Laptop Purchase', categoryId: 'CAT-ITH', deptId: 'DPT-IT', costCentreId: 'CC-IT-110', requestorId: 'U16', qty: 5, estValue: 250000, priority: 'P2', justification: 'Replacement of 5 end-of-life laptops for IT support team', specification: 'i7 / 16 GB / 512 GB SSD, 3-year onsite warranty' }), stop: at('A0401', 1), doneAgo: 1, fix: { startAgo: 1, dueIn: 0 } },
      { id: 'PUR-2026-00126', input: base({ title: 'Industrial air compressor', categoryId: 'CAT-CAP', deptId: 'DPT-OPS', costCentreId: 'CC-OPS-301', requestorId: 'U13', qty: 1, estValue: 1450000, priority: 'P2', justification: 'Capacity addition for Line-2; existing compressor at 95% load' }), stop: at('A0401', 2), doneAgo: 5, fix: { startAgo: 5, dueIn: -3 } },
      { id: 'PUR-2026-00127', input: base({ title: 'Brand video production', categoryId: 'CAT-SRV', deptId: 'DPT-MKT', costCentreId: 'CC-MKT-401', requestorId: 'U12', qty: 1, estValue: 480000, justification: 'Corporate film for 25-year anniversary' }), stop: at('A0401', 2), atStop: [['clarify', { question: 'Is the anniversary event budget already approved? Share the agency comparison.' }, 20]], doneAgo: 2, fix: { startAgo: 3, dueIn: -1 } },

      /* ---------------- OPEN — sourcing & quotation ---------------- */
      { id: 'PUR-2026-00128', input: base({ title: 'Server rack & UPS', categoryId: 'CAT-ITH', deptId: 'DPT-IT', costCentreId: 'CC-IT-110', requestorId: 'U16', qty: 1, estValue: 620000, justification: 'Data-room consolidation' }), vendors: ['V004', 'V005', 'V003'], stop: at('A0601'), atStop: [['send', { dueDate: null }, 4], ['received', p => ({ rfqId: p.rfqs[0].id }), 30]], doneAgo: 0.5, fix: { startAgo: 2, dueIn: 0, rfqDueAgo: 1 } },
      { id: 'PUR-2026-00129', input: base({ title: 'CNC machine spares', categoryId: 'CAT-MAT', deptId: 'DPT-OPS', costCentreId: 'CC-OPS-305', requestorId: 'U13', qty: 1, estValue: 135000, justification: 'Critical spares for CNC-04 breakdown prevention' }), vendors: ['V002', 'V001', 'V011'], rfqReceive: 2, stop: at('A0801'), doneAgo: 3, fix: { startAgo: 3, dueIn: -2 } },
      { id: 'PUR-2026-00130', input: base({ title: 'Machine / Equipment for project execution', categoryId: 'CAT-CAP', deptId: 'DPT-PRJ', costCentreId: 'CC-PRJ-204', requestorId: 'U01', qty: 1, estValue: 250000, justification: 'Machine required for project execution', flags: { advanceRequired: true, advancePct: 50, advanceTypeId: 'ADT-PART' } }), vendors: ['V001', 'V002', 'V003'], deliveryDays: 20, stop: at('A0802'), doneAgo: 0.6, fix: { startAgo: 0, dueIn: 1 } },
      { id: 'PUR-2026-00131', input: base({ title: 'Electrical cabling & panels', categoryId: 'CAT-MAT', deptId: 'DPT-PRJ', costCentreId: 'CC-PRJ-204', requestorId: 'U01', qty: 1, estValue: 360000, justification: 'Site electrification for Line-3' }), vendors: ['V011', 'V014', 'V002'],
        ops: { A0901: (s, p) => [['complete', { vendorId: p.rfqs[1].vendorId, reason: 'L1 vendor failed previous site audit; L2 has 7-day faster delivery' }]] }, stop: at('A0902'), doneAgo: 1, fix: { startAgo: 1, dueIn: 0 } },

      /* ---------------- OPEN — PO & advance ---------------- */
      { id: 'PUR-2026-00132', input: base({ title: 'Annual CAD software licences', categoryId: 'CAT-SW', deptId: 'DPT-PRJ', costCentreId: 'CC-PRJ-210', requestorId: 'U01', qty: 8, estValue: 540000, justification: 'Design team licence renewal' }), vendors: ['V006'], single: true, stop: at('A1002'), doneAgo: 3, fix: { startAgo: 3, dueIn: -2 } },
      { id: 'PUR-2026-00133', input: base({ title: 'Fork-lift (2.5 T)', categoryId: 'CAT-CAP', deptId: 'DPT-OPS', costCentreId: 'CC-OPS-301', requestorId: 'U13', qty: 1, estValue: 980000, justification: 'Warehouse material handling', flags: { advanceRequired: true, advancePct: 40, advanceTypeId: 'ADT-PART' } }), vendors: ['V002', 'V001', 'V003'], stop: at('A1102'), doneAgo: 1, fix: { startAgo: 1, dueIn: 0 } },
      { id: 'PUR-2026-00134', input: base({ title: 'Solar street lights (40 Nos)', categoryId: 'CAT-MAT', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 40, estValue: 320000, justification: 'Campus perimeter lighting', flags: { advanceRequired: true, advancePct: 20, advanceTypeId: 'ADT-PART' } }), vendors: ['V011', 'V010', 'V007'], stop: at('A1003'), atStop: [['send', {}, 4]], doneAgo: 2, fix: { startAgo: 2, dueIn: 0 } },
      { id: 'PUR-2026-00140', input: base({ title: 'Pallet racking system', categoryId: 'CAT-MAT', deptId: 'DPT-OPS', costCentreId: 'CC-OPS-301', requestorId: 'U13', qty: 1, estValue: 450000, justification: 'Warehouse storage expansion' }), vendors: ['V014', 'V002', 'V011'], stop: at('A1001'), atStop: [['hold', { reason: 'Budget re-validation requested by Finance' }, 6, 'U03']], doneAgo: 4, fix: { startAgo: 4, dueIn: -3 } },

      /* ---------------- OPEN — delivery, GRN, invoice ---------------- */
      { id: 'PUR-2026-00135', input: base({ title: 'Packaging machine', categoryId: 'CAT-CAP', deptId: 'DPT-OPS', costCentreId: 'CC-OPS-301', requestorId: 'U13', qty: 1, estValue: 800000, justification: 'Automate end-of-line packing', flags: { advanceRequired: true, advancePct: 25, advanceTypeId: 'ADT-PART' } }), vendors: ['V003', 'V001', 'V002'], deliveryDays: 30,
        ops: { advance_request: (s, p) => [['submit', { pct: 25, amount: 200000, typeId: 'ADT-PART', justification: 'Vendor requires advance to procure imported components', proformaFileName: `Proforma_${p.id}.pdf` }]] },
        stop: at('A1201'), atStop: [['delay', { reason: 'Imported servo motors held at customs', newDate: 'IN:5' }, 768]], doneAgo: 2 },
      { id: 'PUR-2026-00136', input: base({ title: 'Material handling trolleys (100 Nos)', categoryId: 'CAT-MAT', deptId: 'DPT-OPS', costCentreId: 'CC-OPS-305', requestorId: 'U13', qty: 100, estValue: 110000, justification: 'Replace damaged shop-floor trolleys' }), vendors: ['V007', 'V011', 'V014'], deliveryDays: 8,
        ops: { grn: [['create', { qty: 100, acceptedQty: 80, rejectedQty: 20, remarks: '20 trolleys with weld cracks rejected' }]], invoice: (s, p) => [['record', { number: 'METR/INV/26-27/0841', qty: 100, fileName: `Invoice_${p.id}.pdf` }]] },
        stop: (p, a) => a.masterId === 'A1601' && a.status === 'Blocked', doneAgo: 1, fix: { startAgo: 2, dueIn: -1 } },
      { id: 'PUR-2026-00143', input: base({ title: 'UPS batteries replacement', categoryId: 'CAT-MAT', deptId: 'DPT-IT', costCentreId: 'CC-IT-110', requestorId: 'U16', qty: 32, estValue: 68000, justification: 'Battery backup below 5 minutes' }), vendors: ['V011', 'V004', 'V005'], deliveryDays: 6, stop: at('A1401'), doneAgo: 1, fix: { startAgo: 1, dueIn: 1 } },

      /* ---------------- OPEN — payment & settlement ---------------- */
      { id: 'PUR-2026-00137', input: base({ title: 'Housekeeping services (H2)', categoryId: 'CAT-SRV', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 1, estValue: 240000, justification: 'Outsourced housekeeping — Oct to Mar' }), vendors: ['V008', 'V009', 'V013'], deliveryDays: 5, stop: at('A1701'), doneAgo: 1, fix: { startAgo: 1, dueIn: 1 } },
      { id: 'PUR-2026-00138', input: base({ title: 'Facility electrical overhaul', categoryId: 'CAT-FAC', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 1, estValue: 250000, justification: 'Rewiring of admin block', flags: { advanceRequired: true, advancePct: 68, advanceTypeId: 'ADT-MOB' } }), vendors: ['V008', 'V009', 'V013'], deliveryDays: 10,
        ops: { advance_request: (s, p) => [['submit', { pct: 68, amount: 200000, typeId: 'ADT-MOB', justification: 'Mobilisation advance for crew and materials', proformaFileName: `Proforma_${p.id}.pdf` }]],
          adjustment: (s, p) => [['adjust', { amount: 125000, remarks: 'Milestone-1 adjustment as per contract' }], ['complete', {}]] },
        stop: at('A2001'), doneAgo: 1, fix: { startAgo: 1, dueIn: 1 } },
      { id: 'PUR-2026-00139', input: base({ title: 'Digital marketing campaign', categoryId: 'CAT-SRV', deptId: 'DPT-MKT', costCentreId: 'CC-MKT-401', requestorId: 'U12', qty: 1, estValue: 240000, justification: 'Festive season lead generation' }), vendors: ['V012', 'V013', 'V008'], deliveryDays: 10, stop: at('A1801'), atStop: [['pay', { status: 'Processing', mode: 'NEFT' }, 4]], doneAgo: 1, fix: { startAgo: 1, dueIn: 0 } },
      { id: 'PUR-2026-00141', input: base({ title: 'Laptops for new joiners (3 Nos)', categoryId: 'CAT-ITH', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 3, estValue: 190000, justification: 'Onboarding of 3 new hires' }), vendors: ['V005', 'V004', 'V003'], deliveryDays: 5, stop: at('A1801'), atStop: [['fail', { reason: 'Beneficiary account name mismatch — bank returned NEFT' }, 6]], doneAgo: 2, fix: { startAgo: 2, dueIn: -1 } },
      { id: 'PUR-2026-00142', input: base({ title: 'Fire extinguisher refill', categoryId: 'CAT-SRV', deptId: 'DPT-HRA', costCentreId: 'CC-HRA-501', requestorId: 'U18', qty: 1, estValue: 28000, justification: 'Annual statutory refill' }), vendors: ['V008', 'V009', 'V013'], deliveryDays: 3, stop: at('A2101'), doneAgo: 0.3, fix: { startAgo: 0, dueIn: 1 } }
    ];
  }

  function applyFix(state, p, fix, nowT) {
    if (!fix) return;
    const E = PCT.engine;
    const a = E.currentActivity(p);
    if (a && fix.startAgo != null) a.startAt = nowT - fix.startAgo * D - 2 * H;
    if (a && fix.dueIn != null) a.dueAt = U.endOfBusiness(nowT + fix.dueIn * D);
    if (fix.rfqDueAgo != null) p.rfqs.forEach(r => { if (r.status === 'Sent') r.dueDate = nowT - fix.rfqDueAgo * D; });
    if (fix.advancePaidAgo != null) (p.advanceIds || []).forEach(id => {
      const adv = E.advance(state, id);
      if (adv && adv.paymentDate) { adv.paymentDate = nowT - fix.advancePaidAgo * D; adv.settlementDueDate = adv.paymentDate + adv.settlementDays * D; }
    });
  }

  function build() {
    const realNow = Date.now();
    const state = emptyState();
    const list = scenarios();
    const v09Start = Math.min(new Date(2026, 1, 9).getTime(), realNow - 200 * D);

    list.forEach(sc => {
      if (sc.single) sc.input.flags = Object.assign({}, sc.input.flags, { singleSource: true });
      if (sc.v09) sc.input.processVersion = '0.9';
      if (sc.multiInvoice) {
        sc.ops = Object.assign({}, sc.ops, {
          delivery: (s, p) => [['record', { qty: 6, partial: true, fileName: `DC1_${p.id}.pdf`, deliveryNote: 'DC-1' }], ['record', { qty: 4, fileName: `DC2_${p.id}.pdf`, deliveryNote: 'DC-2' }]],
          invoice: (s, p) => [['record', { number: 'KAVE/INV/26-27/0311', qty: 6, partial: true, fileName: `Invoice1_${p.id}.pdf` }], ['record', { number: 'KAVE/INV/26-27/0356', qty: 4, fileName: `Invoice2_${p.id}.pdf` }]],
          adjustment: (s, p) => [['adjust', { invoiceId: p.invoices[0].id, amount: 120000, remarks: 'Against first lot' }], ['adjust', { invoiceId: p.invoices[1].id, remarks: 'Balance advance against second lot' }], ['complete', {}]]
        });
      }
      if (sc.atStop) sc.atStop.forEach(s => { if (s[1] && s[1].newDate === 'IN:5') s[1].newDate = U.endOfBusiness(realNow + 5 * D); });
      // dry run to measure elapsed time, then place the scenario so it ends `doneAgo` days ago
      const elapsed = drive(emptyState(), sc, realNow - 400 * D);
      const start = sc.v09 ? v09Start : realNow - (sc.doneAgo || 0) * D - elapsed;
      drive(state, sc, start);
      PCT.clock.release();
      applyFix(state, PCT.engine.purchase(state, sc.id), sc.fix, realNow);
    });

    // Matching rule for the R04 example and the 3-way-match exception must stay open; R09/R10/SLA fire now.
    PCT.clock.release();
    PCT.engine.tick(state);

    // Keep notifications relevant: last 21 days; older than 2 days marked read.
    state.notifications = state.notifications.filter(n => realNow - n.t < 21 * D);
    state.notifications.forEach(n => { if (realNow - n.t > 2 * D) n.read = true; });
    state.meta.seededAt = realNow;
    return state;
  }

  /** defaultOps(state, p, a, scenario?) → [[op, payload], …] a typical user would perform for the current activity (used by the presenter's auto-complete). '__rfq_receive_all' is a pseudo-op: mark every RFQ received. */
  return { build, scenarios, emptyState, defaultOps: (state, p, a, sc) => defaultOps(state, p, a, sc || {}) };
})();
