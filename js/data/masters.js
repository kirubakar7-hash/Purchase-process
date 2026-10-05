/* =====================================================================
   MASTER DATA — the seed configuration of the Control Tower.
   Nothing in the engine is hard-coded: stages, activities, owners, SLA,
   approvals, documents, rules, escalations and notifications all come
   from here and are editable in Administration (Masters / Process
   Builder). In production these become database tables.

   Condition format (used by stage activation, activity conditions,
   document applicability):
     { field: 'flags.advanceRequired', op: 'truthy' }
     { field: 'estValue', op: 'gt', value: 100000 }
     { all: [cond, cond] } | { any: [cond, cond] } | null (= always)
   Fields available: see PCT.engine.context(state, purchase).
   ===================================================================== */
window.PCT = window.PCT || {};

PCT.masters = (function () {

  /* ---------------- 4.4 Role Master ---------------- */
  const roles = [
    { id: 'requestor',   name: 'Requestor',          description: 'Raises requirements and purchase requests; confirms services.', permissions: ['purchase.create', 'purchase.view_own'], status: 'Active' },
    { id: 'dept_head',   name: 'Department Head',    description: 'Approves departmental purchases; first approval level.', permissions: ['purchase.create', 'purchase.view_dept', 'approve'], status: 'Active' },
    { id: 'procurement', name: 'Procurement',        description: 'Reviews PRs, sources vendors, RFQ, quotations, PO, vendor monitoring.', permissions: ['purchase.view_all', 'procure', 'vendor.manage', 'reports'], status: 'Active' },
    { id: 'technical',   name: 'Technical Evaluator', description: 'Evaluates specification, quality and suitability of offers.', permissions: ['purchase.view_all'], status: 'Active' },
    { id: 'stores',      name: 'Stores / Receiver',  description: 'Receives material, records delivery and creates GRN.', permissions: ['purchase.view_all', 'receive'], status: 'Active' },
    { id: 'finance',     name: 'Finance',            description: 'Advance verification, payment approval, advance adjustment.', permissions: ['purchase.view_all', 'finance', 'approve', 'reports', 'analytics'], status: 'Active' },
    { id: 'ap',          name: 'Accounts Payable',   description: 'Invoice receipt, verification, 3-way match and payment release.', permissions: ['purchase.view_all', 'finance', 'reports'], status: 'Active' },
    { id: 'management',  name: 'Management',         description: 'High-value approvals, control tower, bottlenecks and exposure.', permissions: ['purchase.view_all', 'approve', 'reports', 'analytics'], status: 'Active' },
    { id: 'admin',       name: 'Administrator',      description: 'Masters, process builder, rules, users, SLA and audit.', permissions: ['purchase.view_all', 'admin', 'reports', 'analytics', 'vendor.manage'], status: 'Active' }
  ];

  /* Owner resolvers: how an activity's owner role becomes a person */
  const ownerResolvers = [
    { id: 'requestor',        name: 'Requestor of the purchase' },
    { id: 'dept_head',        name: 'Head of the requesting department' },
    { id: 'procurement',      name: 'Assigned buyer (Procurement)' },
    { id: 'procurement_lead', name: 'Head of Procurement department' },
    { id: 'approver',         name: 'Approver from Approval Matrix (per level)' },
    { id: 'advance_approver', name: 'Approver from Advance Approval Master (by advance %)' },
    { id: 'receiver',         name: 'Stores for material · Requestor for services' },
    { id: 'technical',        name: 'Technical Evaluator' },
    { id: 'finance',          name: 'Finance Controller' },
    { id: 'ap',               name: 'Accounts Payable' },
    { id: 'management',       name: 'Management (CO. CEO)' }
  ];

  /* ---------------- 4.6 Department Master ---------------- */
  const departments = [
    { id: 'DPT-PRJ', name: 'Projects',        headUserId: 'U02', status: 'Active' },
    { id: 'DPT-IT',  name: 'IT',              headUserId: 'U09', status: 'Active' },
    { id: 'DPT-OPS', name: 'Operations',      headUserId: 'U14', status: 'Active' },
    { id: 'DPT-MKT', name: 'Marketing',       headUserId: 'U15', status: 'Active' },
    { id: 'DPT-HRA', name: 'HR & Admin',      headUserId: 'U17', status: 'Active' },
    { id: 'DPT-FIN', name: 'Finance',         headUserId: 'U07', status: 'Active' },
    { id: 'DPT-PRC', name: 'Procurement',     headUserId: 'U04', status: 'Active' },
    { id: 'DPT-MGT', name: 'Management',      headUserId: 'U10', status: 'Active' }
  ];

  /* ---------------- 4.5 User Master ---------------- */
  const users = [
    { id: 'U01', name: 'Ravi Kumar',         roleId: 'requestor',   deptId: 'DPT-PRJ', managerId: 'U02', email: 'ravi.kumar@company.demo',        title: 'Project Engineer',        status: 'Active' },
    { id: 'U02', name: 'Anita Sharma',       roleId: 'dept_head',   deptId: 'DPT-PRJ', managerId: 'U10', email: 'anita.sharma@company.demo',      title: 'Head of Projects',        status: 'Active' },
    { id: 'U03', name: 'Rajeshwari M',       roleId: 'procurement', deptId: 'DPT-PRC', managerId: 'U04', email: 'rajeshwari.m@company.demo',      title: 'Senior Buyer',            status: 'Active' },
    { id: 'U04', name: 'Suresh Iyer',        roleId: 'procurement', deptId: 'DPT-PRC', managerId: 'U10', email: 'suresh.iyer@company.demo',       title: 'Procurement Lead',        status: 'Active' },
    { id: 'U05', name: 'Meena Rao',          roleId: 'technical',   deptId: 'DPT-PRJ', managerId: 'U02', email: 'meena.rao@company.demo',         title: 'Technical Lead',          status: 'Active' },
    { id: 'U06', name: 'Karthik S',          roleId: 'stores',      deptId: 'DPT-HRA', managerId: 'U17', email: 'karthik.s@company.demo',         title: 'Stores In-charge',        status: 'Active' },
    { id: 'U07', name: 'Priya Nair',         roleId: 'finance',     deptId: 'DPT-FIN', managerId: 'U10', email: 'priya.nair@company.demo',        title: 'Finance Controller',      status: 'Active' },
    { id: 'U08', name: 'Arun Das',           roleId: 'ap',          deptId: 'DPT-FIN', managerId: 'U07', email: 'arun.das@company.demo',          title: 'Accounts Payable Lead',   status: 'Active' },
    { id: 'U09', name: 'Sudhakar R',         roleId: 'dept_head',   deptId: 'DPT-IT',  managerId: 'U10', email: 'sudhakar.r@company.demo',        title: 'Head of IT',              status: 'Active' },
    { id: 'U10', name: 'Rajesh Menon',       roleId: 'management',  deptId: 'DPT-MGT', managerId: null,  email: 'rajesh.menon@company.demo',      title: 'CO. CEO',                 status: 'Active' },
    { id: 'U11', name: 'Kavya Reddy',        roleId: 'admin',       deptId: 'DPT-IT',  managerId: 'U09', email: 'kavya.reddy@company.demo',       title: 'Process Administrator',   status: 'Active' },
    { id: 'U12', name: 'Deepa Krishnan',     roleId: 'requestor',   deptId: 'DPT-MKT', managerId: 'U15', email: 'deepa.krishnan@company.demo',    title: 'Marketing Executive',     status: 'Active' },
    { id: 'U13', name: 'Vikram Singh',       roleId: 'requestor',   deptId: 'DPT-OPS', managerId: 'U14', email: 'vikram.singh@company.demo',      title: 'Plant Engineer',          status: 'Active' },
    { id: 'U14', name: 'Lakshmi Narayanan',  roleId: 'dept_head',   deptId: 'DPT-OPS', managerId: 'U10', email: 'lakshmi.n@company.demo',         title: 'Head of Operations',      status: 'Active' },
    { id: 'U15', name: 'Farhan Ali',         roleId: 'dept_head',   deptId: 'DPT-MKT', managerId: 'U10', email: 'farhan.ali@company.demo',        title: 'Head of Marketing',       status: 'Active' },
    { id: 'U16', name: 'Nisha Thomas',       roleId: 'requestor',   deptId: 'DPT-IT',  managerId: 'U09', email: 'nisha.thomas@company.demo',      title: 'IT Support Engineer',     status: 'Active' },
    { id: 'U17', name: 'Gopal Rao',          roleId: 'dept_head',   deptId: 'DPT-HRA', managerId: 'U10', email: 'gopal.rao@company.demo',         title: 'Head of HR & Admin',      status: 'Active' },
    { id: 'U18', name: 'Anjali Menon',       roleId: 'requestor',   deptId: 'DPT-HRA', managerId: 'U17', email: 'anjali.menon@company.demo',      title: 'Admin Executive',         status: 'Active' }
  ];

  /* ---------------- 4.7 Cost Centre Master ---------------- */
  const costCentres = [
    { id: 'CC-PRJ-204', name: 'Projects Execution',  deptId: 'DPT-PRJ', budget: 6000000, status: 'Active' },
    { id: 'CC-PRJ-210', name: 'Projects Tools',      deptId: 'DPT-PRJ', budget: 1500000, status: 'Active' },
    { id: 'CC-IT-110',  name: 'IT Infrastructure',   deptId: 'DPT-IT',  budget: 4000000, status: 'Active' },
    { id: 'CC-IT-120',  name: 'IT Software',         deptId: 'DPT-IT',  budget: 2500000, status: 'Active' },
    { id: 'CC-OPS-301', name: 'Plant Operations',    deptId: 'DPT-OPS', budget: 5000000, status: 'Active' },
    { id: 'CC-OPS-305', name: 'Maintenance',         deptId: 'DPT-OPS', budget: 2000000, status: 'Active' },
    { id: 'CC-MKT-401', name: 'Marketing Campaigns', deptId: 'DPT-MKT', budget: 3000000, status: 'Active' },
    { id: 'CC-HRA-501', name: 'Admin & Facilities',  deptId: 'DPT-HRA', budget: 1800000, status: 'Active' },
    { id: 'CC-FIN-601', name: 'Finance Operations',  deptId: 'DPT-FIN', budget: 500000,  status: 'Active' }
  ];

  /* ---------------- 4.8 Purchase Category Master ---------------- */
  const categories = [
    { id: 'CAT-MAT', name: 'Material',                  type: 'material', techEval: false, agreementRequired: false, uom: 'Nos',  status: 'Active' },
    { id: 'CAT-CAP', name: 'Machine / Equipment (CAPEX)', type: 'material', techEval: true,  agreementRequired: false, uom: 'Nos',  status: 'Active' },
    { id: 'CAT-ITH', name: 'IT Hardware',               type: 'material', techEval: true,  agreementRequired: false, uom: 'Nos',  status: 'Active' },
    { id: 'CAT-SW',  name: 'Software / Subscription',   type: 'service',  techEval: true,  agreementRequired: true,  uom: 'Licence', status: 'Active' },
    { id: 'CAT-SRV', name: 'Services',                  type: 'service',  techEval: false, agreementRequired: true,  uom: 'Job',  status: 'Active' },
    { id: 'CAT-CON', name: 'Consumables',               type: 'material', techEval: false, agreementRequired: false, uom: 'Nos',  status: 'Active' },
    { id: 'CAT-FAC', name: 'Facility / Civil Works',    type: 'service',  techEval: false, agreementRequired: true,  uom: 'Job',  status: 'Active' }
  ];

  /* ---------------- 4.9 Vendor Master ---------------- */
  const vendors = [
    { id: 'V001', name: 'ABC Machines Pvt Ltd',       categoryIds: ['CAT-CAP', 'CAT-MAT'], city: 'Coimbatore', gstin: '33AABCA1234F1Z5', pan: 'AABCA1234F', bank: 'HDFC Bank ••••4521', msme: true,  approved: true, rating: 4.4, contact: 'sales@abcmachines.demo',   status: 'Active' },
    { id: 'V002', name: 'XYZ Engineering Works',      categoryIds: ['CAT-CAP', 'CAT-MAT'], city: 'Chennai',    gstin: '33AACFX5678K1Z2', pan: 'AACFX5678K', bank: 'ICICI Bank ••••7788', msme: false, approved: true, rating: 4.1, contact: 'bids@xyzeng.demo',          status: 'Active' },
    { id: 'V003', name: 'PQR Systems',                categoryIds: ['CAT-CAP', 'CAT-ITH'], city: 'Pune',       gstin: '27AAGCP9012L1Z9', pan: 'AAGCP9012L', bank: 'Axis Bank ••••1290',  msme: false, approved: true, rating: 3.9, contact: 'quotes@pqrsys.demo',        status: 'Active' },
    { id: 'V004', name: 'Zenith IT Solutions',        categoryIds: ['CAT-ITH'],            city: 'Bengaluru',  gstin: '29AAECZ3456M1Z1', pan: 'AAECZ3456M', bank: 'SBI ••••3345',        msme: false, approved: true, rating: 4.5, contact: 'enterprise@zenithit.demo',  status: 'Active' },
    { id: 'V005', name: 'Orion Computers',            categoryIds: ['CAT-ITH'],            city: 'Chennai',    gstin: '33AAFCO7890N1Z4', pan: 'AAFCO7890N', bank: 'HDFC Bank ••••6610', msme: true,  approved: true, rating: 4.0, contact: 'sales@orioncomp.demo',      status: 'Active' },
    { id: 'V006', name: 'Apex Software Labs',         categoryIds: ['CAT-SW'],             city: 'Hyderabad',  gstin: '36AAHCA2345P1Z7', pan: 'AAHCA2345P', bank: 'Kotak Bank ••••9081', msme: false, approved: true, rating: 4.2, contact: 'licensing@apexsoft.demo',   status: 'Active' },
    { id: 'V007', name: 'Metro Office Supplies',      categoryIds: ['CAT-CON', 'CAT-MAT'], city: 'Chennai',    gstin: '33AAJFM6789Q1Z3', pan: 'AAJFM6789Q', bank: 'Canara Bank ••••4410', msme: true, approved: true, rating: 3.8, contact: 'orders@metrooffice.demo',   status: 'Active' },
    { id: 'V008', name: 'BlueLine Facility Services', categoryIds: ['CAT-SRV', 'CAT-FAC'], city: 'Chennai',    gstin: '33AAKCB1122R1Z8', pan: 'AAKCB1122R', bank: 'ICICI Bank ••••5521', msme: true,  approved: true, rating: 4.0, contact: 'ops@blueline.demo',         status: 'Active' },
    { id: 'V009', name: 'Galaxy HVAC Services',       categoryIds: ['CAT-SRV', 'CAT-FAC'], city: 'Bengaluru',  gstin: '29AALCG3344S1Z6', pan: 'AALCG3344S', bank: 'Axis Bank ••••8812',  msme: false, approved: true, rating: 3.6, contact: 'service@galaxyhvac.demo',   status: 'Active' },
    { id: 'V010', name: 'Prime Safety Gear',          categoryIds: ['CAT-CON', 'CAT-MAT'], city: 'Mumbai',     gstin: '27AAMFP5566T1Z2', pan: 'AAMFP5566T', bank: 'SBI ••••7734',        msme: true,  approved: true, rating: 4.3, contact: 'b2b@primesafety.demo',      status: 'Active' },
    { id: 'V011', name: 'Vertex Electricals',         categoryIds: ['CAT-MAT', 'CAT-CON'], city: 'Coimbatore', gstin: '33AANCV7788U1Z5', pan: 'AANCV7788U', bank: 'Indian Bank ••••2209', msme: true, approved: true, rating: 3.7, contact: 'sales@vertexelec.demo',     status: 'Active' },
    { id: 'V012', name: 'Nova Print & Media',         categoryIds: ['CAT-SRV'],            city: 'Chennai',    gstin: '33AAPFN9900V1Z1', pan: 'AAPFN9900V', bank: 'HDFC Bank ••••3318', msme: true,  approved: true, rating: 3.9, contact: 'hello@novaprint.demo',      status: 'Active' },
    { id: 'V013', name: 'Sunrise Logistics',          categoryIds: ['CAT-SRV'],            city: 'Chennai',    gstin: '33AAQCS1212W1Z9', pan: 'AAQCS1212W', bank: 'Yes Bank ••••6650',  msme: false, approved: true, rating: 3.5, contact: 'ops@sunriselog.demo',       status: 'Active' },
    { id: 'V014', name: 'Kaveri Steel Traders',       categoryIds: ['CAT-MAT'],            city: 'Salem',      gstin: '33AARFK3434X1Z4', pan: 'AARFK3434X', bank: 'Karur Vysya ••••1187', msme: true, approved: true, rating: 4.1, contact: 'sales@kaveristeel.demo',    status: 'Active' }
  ];

  /* ---------------- 4.10 Approval Matrix ---------------- */
  const approvalMatrix = [
    { id: 'AM-01', name: 'Up to ₹1 lakh',       minValue: 0,        maxValue: 100000,  categoryIds: [], deptIds: [], levels: [{ level: 1, roleId: 'dept_head', label: 'Department Head' }], status: 'Active' },
    { id: 'AM-02', name: '₹1 lakh – ₹10 lakh',  minValue: 100001,   maxValue: 1000000, categoryIds: [], deptIds: [], levels: [{ level: 1, roleId: 'dept_head', label: 'Department Head' }, { level: 2, roleId: 'management', label: 'Management (CO. CEO)' }], status: 'Active' },
    { id: 'AM-03', name: 'Above ₹10 lakh',      minValue: 1000001,  maxValue: null,    categoryIds: [], deptIds: [], levels: [{ level: 1, roleId: 'dept_head', label: 'Department Head' }, { level: 2, roleId: 'finance', label: 'Finance Controller' }, { level: 3, roleId: 'management', label: 'Management (CO. CEO)' }], status: 'Active' }
  ];

  /* ---------------- 4.11 Document Master ---------------- */
  const documents = [
    { id: 'D01', name: 'Requirement Note',        stages: ['S01'],        mandatory: false, system: false, appliesTo: null, status: 'Active' },
    { id: 'D02', name: 'Purchase Request',        stages: ['S02'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D03', name: 'Approval Record',         stages: ['S04'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D04', name: 'RFQ',                     stages: ['S06'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D05', name: 'Vendor Quotations',       stages: ['S07'],        mandatory: true,  system: false, appliesTo: null, status: 'Active' },
    { id: 'D06', name: 'Comparison Statement',    stages: ['S08'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D07', name: 'Vendor Selection Note',   stages: ['S09'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D08', name: 'Purchase Order',          stages: ['S10'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D09', name: 'Agreement / Contract',    stages: ['S10'],        mandatory: true,  system: false, appliesTo: { field: 'agreementRequired', op: 'truthy' }, status: 'Active' },
    { id: 'D10', name: 'Advance Request',         stages: ['S11'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D11', name: 'Advance Approval',        stages: ['S11'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D12', name: 'Proforma Invoice',        stages: ['S11'],        mandatory: true,  system: false, appliesTo: null, status: 'Active' },
    { id: 'D13', name: 'Advance Payment Proof',   stages: ['S11'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D14', name: 'Delivery Note / Challan', stages: ['S12'],        mandatory: true,  system: false, appliesTo: { field: 'categoryType', op: 'eq', value: 'material' }, status: 'Active' },
    { id: 'D15', name: 'GRN',                     stages: ['S13'],        mandatory: true,  system: true,  appliesTo: { field: 'categoryType', op: 'eq', value: 'material' }, status: 'Active' },
    { id: 'D16', name: 'Service Confirmation',    stages: ['S13'],        mandatory: true,  system: true,  appliesTo: { field: 'categoryType', op: 'eq', value: 'service' }, status: 'Active' },
    { id: 'D17', name: 'Vendor Invoice',          stages: ['S14'],        mandatory: true,  system: false, appliesTo: null, status: 'Active' },
    { id: 'D18', name: 'Payment Proof',           stages: ['S18', 'S20'], mandatory: true,  system: true,  appliesTo: null, status: 'Active' },
    { id: 'D19', name: 'Advance Adjustment Note', stages: ['S19'],        mandatory: true,  system: true,  appliesTo: null, status: 'Active' }
  ];

  /* ---------------- 4.12 Status Master ---------------- */
  const S = (kind, list) => list.map(([name, tone, dot]) => ({ id: `${kind}:${name}`, kind, name, tone, dot }));
  const statuses = [].concat(
    S('purchase', [['Draft', 'grey', '⚪'], ['Open', 'blue', '🔵'], ['On Hold', 'orange', '🟠'], ['Rejected', 'black', '⚫'], ['Closed', 'green', '🟢'], ['Cancelled', 'black', '⚫']]),
    S('activity', [['Not Started', 'grey', '⚪'], ['In Progress', 'blue', '🔵'], ['Waiting', 'yellow', '🟡'], ['Blocked', 'orange', '🟠'], ['Completed', 'green', '🟢'], ['Overdue', 'red', '🔴'], ['Rejected', 'black', '⚫'], ['Skipped', 'grey', '◌']]),
    S('rfq', [['Draft', 'grey', '⚪'], ['Sent', 'blue', '🔵'], ['Waiting', 'yellow', '🟡'], ['Received', 'green', '🟢'], ['Expired', 'red', '🔴'], ['Cancelled', 'black', '⚫']]),
    S('po', [['Draft', 'grey', '⚪'], ['Approval Pending', 'yellow', '🟡'], ['Approved', 'blue', '🔵'], ['Sent', 'blue', '🔵'], ['Vendor Accepted', 'green', '🟢'], ['Partially Completed', 'yellow', '🟡'], ['Completed', 'green', '🟢'], ['Cancelled', 'black', '⚫']]),
    S('advance', [['Requested', 'grey', '⚪'], ['Approved', 'blue', '🔵'], ['Verified', 'blue', '🔵'], ['Outstanding', 'orange', '🟠'], ['Partially Adjusted', 'yellow', '🟡'], ['Adjusted', 'green', '🟢'], ['Recovered', 'green', '🟢'], ['Closed', 'green', '🟢'], ['Rejected', 'black', '⚫']]),
    S('payment', [['Pending', 'grey', '⚪'], ['Approved', 'blue', '🔵'], ['Processing', 'yellow', '🟡'], ['Paid', 'green', '🟢'], ['Failed', 'red', '🔴'], ['Reversed', 'black', '⚫']]),
    S('invoice', [['Received', 'blue', '🔵'], ['Verified', 'blue', '🔵'], ['On Hold', 'orange', '🟠'], ['Matched', 'green', '🟢'], ['Mismatch', 'red', '🔴'], ['Paid', 'green', '🟢']]),
    S('exception', [['Open', 'red', '🔴'], ['In Progress', 'orange', '🟠'], ['Resolved', 'green', '🟢'], ['Closed', 'grey', '⚪']])
  );

  /* ---------------- 4.13 Priority Master ---------------- */
  const priorities = [
    { id: 'P1', name: 'Critical', slaFactor: 0.5,  tone: 'red',    status: 'Active' },
    { id: 'P2', name: 'High',     slaFactor: 0.75, tone: 'orange', status: 'Active' },
    { id: 'P3', name: 'Normal',   slaFactor: 1,    tone: 'blue',   status: 'Active' },
    { id: 'P4', name: 'Low',      slaFactor: 1.5,  tone: 'grey',   status: 'Active' }
  ];

  /* ---------------- 4.14 SLA Master ---------------- */
  const sla = [
    { id: 'SLA-STD', name: 'Standard working-day SLA', workingDays: true, weekend: [0, 6], dueSoonDays: 1, businessEndHour: 18, description: 'Due Date = Start Date + SLA working days × priority factor. Weekends excluded.', status: 'Active' }
  ];

  /* ---------------- 4.15 Escalation Master ---------------- */
  const escalations = [
    { id: 'ESC-0', level: 0, name: 'Due-date reminder',       trigger: 'due_in_days',  days: 1, notify: 'owner',      createException: false, status: 'Active' },
    { id: 'ESC-1', level: 1, name: '1 day overdue → Owner',   trigger: 'overdue_days', days: 1, notify: 'owner',      createException: true,  status: 'Active' },
    { id: 'ESC-2', level: 2, name: '2 days overdue → Department Head', trigger: 'overdue_days', days: 2, notify: 'dept_head', createException: false, status: 'Active' },
    { id: 'ESC-3', level: 3, name: '3 days overdue → Management', trigger: 'overdue_days', days: 3, notify: 'management', createException: false, status: 'Active' }
  ];

  /* ---------------- 4.16 Decision Rule Master ---------------- */
  const rules = [
    { id: 'R01', name: 'High-value additional approval', trigger: 'creation', description: 'If purchase value exceeds the threshold, the Approval Matrix adds Management (and above ₹10 lakh, Finance) approval levels.', params: { threshold: 100000 }, effect: 'Additional approval', active: true },
    { id: 'R02', name: 'Advance warning before payment', trigger: 'payment_approval', description: 'If the vendor / PO has an outstanding advance, show a warning and suggest adjustment before payment.', params: {}, effect: 'Warning', active: true },
    { id: 'R03', name: 'Minimum quotations', trigger: 'comparison', description: 'Block quotation comparison until the required number of quotations is received (single-source purchases need 1 + justification).', params: { minQuotes: 3 }, effect: 'Block', active: true },
    { id: 'R04', name: 'Invoice ≠ GRN creates exception', trigger: 'match', description: 'If invoice quantity, price, tax or total does not match PO / GRN beyond tolerance, create an exception and block payment.', params: { tolerancePct: 0.5 }, effect: 'Exception', active: true },
    { id: 'R05', name: 'Vendor financial exposure', trigger: 'always', description: 'Highlight vendors with outstanding advances above the threshold.', params: { exposureThreshold: 0 }, effect: 'Highlight', active: true },
    { id: 'R06', name: 'SLA escalation', trigger: 'sla', description: 'If an activity exceeds its SLA, escalate as per the Escalation Master.', params: {}, effect: 'Escalate', active: true },
    { id: 'R07', name: 'Mandatory documents', trigger: 'stage_complete', description: 'A stage cannot be completed while a mandatory document for it is missing.', params: {}, effect: 'Block', active: true },
    { id: 'R08', name: 'Advance activates advance workflow', trigger: 'creation', description: 'If advance is required, activate Vendor Advance, Advance Adjustment and Balance Payment stages (and skip direct Payment).', params: {}, effect: 'Activate stages', active: true },
    { id: 'R09', name: 'Advance overdue', trigger: 'advance', description: 'If an advance is outstanding beyond its settlement due date, raise an exception and escalate to Finance.', params: {}, effect: 'Exception + escalate', active: true },
    { id: 'R10', name: 'Late delivery', trigger: 'delivery', description: 'If delivery is past the expected date, mark the delivery late and raise a vendor delay exception.', params: { graceDays: 0 }, effect: 'Exception', active: true },
    { id: 'R11', name: 'Non-L1 vendor needs approval', trigger: 'selection', description: 'If the lowest-price vendor is not selected, a justification and Department Head approval are required.', params: {}, effect: 'Additional approval', active: true }
  ];

  /* ---------------- 4.17 Notification Master ---------------- */
  const notifications = [
    { id: 'N01', event: 'activity_assigned',   name: 'New activity',             recipients: 'owner',      channels: ['In-app', 'Email'], template: '{activity} assigned to you for {purchase}', status: 'Active' },
    { id: 'N02', event: 'approval_required',   name: 'Approval required',        recipients: 'owner',      channels: ['In-app', 'Email'], template: 'Approval required: {purchase} ({value})', status: 'Active' },
    { id: 'N03', event: 'due_tomorrow',        name: 'Due tomorrow',             recipients: 'owner',      channels: ['In-app'],          template: '{activity} for {purchase} is due tomorrow', status: 'Active' },
    { id: 'N04', event: 'overdue',             name: 'Overdue',                  recipients: 'owner',      channels: ['In-app', 'Email'], template: '{activity} for {purchase} is overdue', status: 'Active' },
    { id: 'N05', event: 'vendor_response',     name: 'Vendor response pending',  recipients: 'owner',      channels: ['In-app'],          template: 'RFQ response pending from {vendor}', status: 'Active' },
    { id: 'N06', event: 'missing_document',    name: 'Missing document',         recipients: 'owner',      channels: ['In-app'],          template: '{document} missing for {purchase}', status: 'Active' },
    { id: 'N07', event: 'workflow_blocked',    name: 'Workflow blocked',         recipients: 'owner',      channels: ['In-app', 'Email'], template: '{purchase} is blocked: {reason}', status: 'Active' },
    { id: 'N08', event: 'advance_overdue',     name: 'Advance overdue',          recipients: 'finance',    channels: ['In-app', 'Email'], template: 'Advance {advance} overdue for settlement', status: 'Active' },
    { id: 'N09', event: 'invoice_mismatch',    name: 'Invoice mismatch',         recipients: 'owner',      channels: ['In-app', 'Email'], template: 'Invoice mismatch on {purchase}', status: 'Active' },
    { id: 'N10', event: 'payment_pending',     name: 'Payment pending',          recipients: 'owner',      channels: ['In-app'],          template: 'Payment pending for {purchase}', status: 'Active' },
    { id: 'N11', event: 'escalation',          name: 'Escalation',               recipients: 'escalation', channels: ['In-app', 'Email'], template: 'Escalated: {activity} on {purchase} is {days} overdue', status: 'Active' },
    { id: 'N12', event: 'completion',          name: 'Completion',               recipients: 'requestor',  channels: ['In-app', 'Email'], template: '{purchase} is closed', status: 'Active' },
    { id: 'N13', event: 'returned',            name: 'Returned / clarification', recipients: 'owner',      channels: ['In-app', 'Email'], template: '{purchase} returned: {reason}', status: 'Active' }
  ];

  /* ---------------- 4.18 – 4.21 Advance masters ---------------- */
  const advanceTypes = [
    { id: 'ADT-FULL', name: 'Full Advance',        status: 'Active' },
    { id: 'ADT-PART', name: 'Partial Advance',     status: 'Active' },
    { id: 'ADT-MILE', name: 'Milestone Advance',   status: 'Active' },
    { id: 'ADT-MOB',  name: 'Mobilization Advance', status: 'Active' },
    { id: 'ADT-DEP',  name: 'Deposit',             status: 'Active' },
    { id: 'ADT-RET',  name: 'Retainer',            status: 'Active' },
    { id: 'ADT-OTH',  name: 'Other',               status: 'Active' }
  ];
  const advanceApproval = [
    { id: 'AAP-1', name: 'Up to 25% of PO',  maxPct: 25,  approverRole: 'dept_head',  status: 'Active' },
    { id: 'AAP-2', name: '25% – 50% of PO',  maxPct: 50,  approverRole: 'finance',    status: 'Active' },
    { id: 'AAP-3', name: 'Above 50% of PO',  maxPct: 100, approverRole: 'management', status: 'Active' }
  ];
  const ageingBuckets = [
    { id: 'AG-1', label: '0–7 Days',   min: 0,  max: 7 },
    { id: 'AG-2', label: '8–15 Days',  min: 8,  max: 15 },
    { id: 'AG-3', label: '16–30 Days', min: 16, max: 30 },
    { id: 'AG-4', label: '31–60 Days', min: 31, max: 60 },
    { id: 'AG-5', label: '>60 Days',   min: 61, max: null }
  ];
  const settlementRules = [
    { id: 'SR-1', name: 'Settlement period',         description: 'Advance must be adjusted within N days of payment.', params: { settlementDays: 30 }, status: 'Active' },
    { id: 'SR-2', name: 'Auto-suggest adjustment',   description: 'Suggest adjusting the lower of outstanding advance and invoice value.', params: {}, status: 'Active' },
    { id: 'SR-3', name: 'Partial adjustment allowed', description: 'An advance may be adjusted partially; the remainder stays outstanding.', params: {}, status: 'Active' },
    { id: 'SR-4', name: 'Multiple invoice adjustment', description: 'One advance can be adjusted against multiple invoices of the same PO / vendor.', params: {}, status: 'Active' },
    { id: 'SR-5', name: 'Recovery after ageing',     description: 'If unadjusted beyond N days, initiate recovery from the vendor.', params: { recoveryAfterDays: 60 }, status: 'Active' }
  ];

  /* ---------------- Control Tower stage groups ---------------- */
  const towerGroups = [
    { id: 'REQUIREMENT', label: 'Requirement' },
    { id: 'PR',          label: 'PR' },
    { id: 'APPROVAL',    label: 'Approval' },
    { id: 'RFQ',         label: 'RFQ' },
    { id: 'QUOTE',       label: 'Quote' },
    { id: 'PO',          label: 'PO' },
    { id: 'ADVANCE',     label: 'Advance' },
    { id: 'DELIVERY',    label: 'Delivery' },
    { id: 'INVOICE',     label: 'Invoice' },
    { id: 'PAYMENT',     label: 'Payment' },
    { id: 'CLOSURE',     label: 'Closure' }
  ];

  /* ---------------- 4.2 / 4.3 Stage & Activity Master (Process V1.0) ---------------- */
  const ADV = { field: 'flags.advanceRequired', op: 'truthy' };
  const NO_ADV = { field: 'flags.advanceRequired', op: 'falsy' };
  const st = (id, seq, name, group, ownerRole, slaDays, approval, activation, description, activities) =>
    ({ id, seq, name, group, ownerRole, slaDays, approval: !!approval, activation: activation || null, description, status: 'Active', activities });
  const ac = (id, stageId, seq, o) => Object.assign({ id, stageId, seq, description: '', input: '', output: '', checklist: [], requiredDocs: [], approval: false, condition: null, escalationId: 'ESC-1', status: 'Active' }, o);

  const stagesV1 = [
    st('S01', 1, 'Requirement', 'REQUIREMENT', 'requestor', 2, false, null, 'Identify and document the business requirement.', [
      ac('A0101', 'S01', 1, { name: 'Capture requirement', ownerRole: 'requestor', slaDays: 2, actionType: 'requirement', input: 'Business need', output: 'Purchase Requirement',
        checklist: ['Identify requirement', 'Define requirement', 'Define specification', 'Define quantity', 'Define required date', 'Business justification', 'Estimated value', 'Identify budget', 'Select department', 'Select cost centre', 'Attach supporting documents'], requiredDocs: ['D01'] })]),
    st('S02', 2, 'Purchase Request', 'PR', 'requestor', 1, false, null, 'Create and submit the PR; system generates the Purchase ID.', [
      ac('A0201', 'S02', 1, { name: 'Create and submit Purchase Request', ownerRole: 'requestor', slaDays: 1, actionType: 'pr_submit', input: 'Purchase Requirement', output: 'Submitted PR + Purchase ID',
        checklist: ['Create PR', 'Item / service details', 'Select category', 'Select cost centre', 'Estimated amount', 'Attach documents', 'Submit PR', 'Generate Purchase ID / PR number'], requiredDocs: ['D02'] })]),
    st('S03', 3, 'Initial Review', 'PR', 'procurement', 1, false, null, 'Procurement verifies completeness before approval.', [
      ac('A0301', 'S03', 1, { name: 'Review requirement completeness', ownerRole: 'procurement', slaDays: 1, actionType: 'review', input: 'Submitted PR', output: 'Reviewed PR (or returned with reason)',
        checklist: ['Requirement completeness', 'Quantity', 'Specification', 'Budget', 'Cost centre', 'Existing contract', 'Existing vendor', 'Required documents', 'Purchase category'] })]),
    st('S04', 4, 'Approval', 'APPROVAL', 'approver', 2, true, null, 'Approval levels determined by the Approval Matrix.', [
      ac('A0401', 'S04', 1, { name: 'Approve purchase', ownerRole: 'approver', slaDays: 2, actionType: 'approval', perApprovalLevel: true, approval: true, input: 'Reviewed PR', output: 'Approved PR', requiredDocs: ['D03'] })]),
    st('S05', 5, 'Vendor Sourcing', 'RFQ', 'procurement', 2, false, null, 'Identify vendors from the approved vendor list.', [
      ac('A0501', 'S05', 1, { name: 'Identify vendors', ownerRole: 'procurement', slaDays: 2, actionType: 'sourcing', input: 'Approved PR', output: 'Vendor shortlist',
        checklist: ['Identify vendors', 'Check approved vendor list', 'Add new vendor if required'] })]),
    st('S06', 6, 'RFQ', 'RFQ', 'procurement', 3, false, null, 'Send RFQs and track vendor responses.', [
      ac('A0601', 'S06', 1, { name: 'Send RFQ and track responses', ownerRole: 'procurement', slaDays: 3, actionType: 'rfq', input: 'Vendor shortlist', output: 'Vendor responses',
        checklist: ['Send RFQ', 'Track RFQ date', 'Track vendor response', 'Follow up', 'Receive quotations'], requiredDocs: ['D04'] })]),
    st('S07', 7, 'Quotation', 'QUOTE', 'procurement', 2, false, null, 'Record each quotation separately.', [
      ac('A0701', 'S07', 1, { name: 'Record vendor quotations', ownerRole: 'procurement', slaDays: 2, actionType: 'quotation', input: 'Vendor responses', output: 'Quotation register', requiredDocs: ['D05'] })]),
    st('S08', 8, 'Quotation Comparison', 'QUOTE', 'procurement', 2, false, null, 'Compare price, tax, delivery, warranty and terms; recommend a vendor.', [
      ac('A0801', 'S08', 1, { name: 'Compare quotations and recommend', ownerRole: 'procurement', slaDays: 1, actionType: 'comparison', input: 'Quotation register', output: 'Comparison + recommendation', requiredDocs: ['D06'] }),
      ac('A0802', 'S08', 2, { name: 'Technical evaluation', ownerRole: 'technical', slaDays: 1, actionType: 'tech_eval', approval: true, condition: { field: 'techEval', op: 'truthy' }, input: 'Recommended offer', output: 'Technical acceptance',
        checklist: ['Specification compliance', 'Capacity', 'Quality', 'Warranty', 'Delivery capability', 'Technical suitability'] })]),
    st('S09', 9, 'Vendor Selection', 'QUOTE', 'procurement', 1, false, null, 'Select the vendor; non-L1 selection needs justification and approval.', [
      ac('A0901', 'S09', 1, { name: 'Select vendor', ownerRole: 'procurement', slaDays: 1, actionType: 'selection', input: 'Comparison', output: 'Selected vendor', requiredDocs: ['D07'] }),
      ac('A0902', 'S09', 2, { name: 'Approve non-L1 vendor selection', ownerRole: 'dept_head', slaDays: 1, actionType: 'selection_approval', approval: true, condition: { field: 'lowestSelected', op: 'falsy' }, input: 'Selection justification', output: 'Approved selection' })]),
    st('S10', 10, 'PO / Agreement', 'PO', 'procurement', 3, false, null, 'Create, approve and send the PO / agreement.', [
      ac('A1001', 'S10', 1, { name: 'Create PO / Agreement', ownerRole: 'procurement', slaDays: 1, actionType: 'po_create', input: 'Selected vendor', output: 'Draft PO',
        checklist: ['Vendor', 'Quantity', 'Price', 'Tax', 'Delivery', 'Payment terms', 'Warranty', 'Validity', 'Agreement requirements'], requiredDocs: ['D08', 'D09'] }),
      ac('A1002', 'S10', 2, { name: 'Approve PO', ownerRole: 'procurement_lead', slaDays: 1, actionType: 'po_approve', approval: true, input: 'Draft PO', output: 'Approved PO' }),
      ac('A1003', 'S10', 3, { name: 'Send PO and obtain vendor acceptance', ownerRole: 'procurement', slaDays: 2, actionType: 'po_send', input: 'Approved PO', output: 'Vendor-accepted PO' })]),
    st('S11', 11, 'Vendor Advance', 'ADVANCE', 'finance', 4, true, ADV, 'Controlled advance workflow linked to the PO.', [
      ac('A1101', 'S11', 1, { name: 'Raise advance request', ownerRole: 'procurement', slaDays: 1, actionType: 'advance_request', input: 'Accepted PO + proforma', output: 'Advance request', requiredDocs: ['D10', 'D12'] }),
      ac('A1102', 'S11', 2, { name: 'Approve advance', ownerRole: 'advance_approver', slaDays: 1, actionType: 'advance_approve', approval: true, input: 'Advance request', output: 'Approved advance', requiredDocs: ['D11'] }),
      ac('A1103', 'S11', 3, { name: 'Finance verification of advance', ownerRole: 'finance', slaDays: 1, actionType: 'advance_verify', input: 'Approved advance', output: 'Verified advance',
        checklist: ['PO approved', 'Vendor validated', 'Proforma invoice', 'Bank details verified', 'Approval completed'] }),
      ac('A1104', 'S11', 4, { name: 'Release advance payment', ownerRole: 'ap', slaDays: 1, actionType: 'advance_pay', input: 'Verified advance', output: 'Advance paid (outstanding)', requiredDocs: ['D13'] })]),
    st('S12', 12, 'Delivery / Service', 'DELIVERY', 'receiver', 0, false, null, 'Track delivery or service performance against the PO.', [
      ac('A1201', 'S12', 1, { name: 'Track and record delivery / service', ownerRole: 'receiver', slaDays: 0, slaFrom: 'po.deliveryDays', actionType: 'delivery', input: 'Accepted PO', output: 'Delivery record', requiredDocs: ['D14'] })]),
    st('S13', 13, 'GRN / Service Confirmation', 'DELIVERY', 'receiver', 1, false, null, 'Confirm receipt — quantity accepted / rejected.', [
      ac('A1301', 'S13', 1, { name: 'Create GRN / service confirmation', ownerRole: 'receiver', slaDays: 1, actionType: 'grn', input: 'Delivery record', output: 'GRN / Service confirmation', requiredDocs: ['D15', 'D16'] })]),
    st('S14', 14, 'Invoice Receipt', 'INVOICE', 'ap', 2, false, null, 'Receive and record the vendor invoice.', [
      ac('A1401', 'S14', 1, { name: 'Record vendor invoice', ownerRole: 'ap', slaDays: 2, actionType: 'invoice', input: 'Vendor invoice', output: 'Invoice record', requiredDocs: ['D17'] })]),
    st('S15', 15, 'Invoice Verification', 'INVOICE', 'ap', 2, false, null, 'Verify vendor, tax, amount, bank and documents.', [
      ac('A1501', 'S15', 1, { name: 'Verify invoice', ownerRole: 'ap', slaDays: 2, actionType: 'invoice_verify', input: 'Invoice record', output: 'Verified invoice',
        checklist: ['Vendor', 'Invoice', 'PO', 'Tax', 'Amount', 'Bank details', 'Supporting documents', 'Approval'] })]),
    st('S16', 16, '3-Way Match', 'INVOICE', 'ap', 1, false, null, 'PO ↔ GRN ↔ Invoice.', [
      ac('A1601', 'S16', 1, { name: 'PO ↔ GRN ↔ Invoice match', ownerRole: 'ap', slaDays: 1, actionType: 'match', input: 'PO, GRN, verified invoice', output: 'Matched / exception' })]),
    st('S17', 17, 'Payment Approval', 'PAYMENT', 'finance', 2, true, null, 'Payment proposal with advance check.', [
      ac('A1701', 'S17', 1, { name: 'Approve payment proposal', ownerRole: 'finance', slaDays: 2, actionType: 'payment_approval', approval: true, input: 'Matched invoice', output: 'Approved payment',
        checklist: ['Prepare payment proposal', 'Verify invoice', 'Verify due date', 'Check advance outstanding', 'Check bank details', 'Obtain approval', 'Initiate payment'] })]),
    st('S18', 18, 'Payment', 'PAYMENT', 'ap', 1, false, NO_ADV, 'Release payment to the vendor.', [
      ac('A1801', 'S18', 1, { name: 'Release payment', ownerRole: 'ap', slaDays: 1, actionType: 'payment', input: 'Approved payment', output: 'Payment (UTR)', requiredDocs: ['D18'] })]),
    st('S19', 19, 'Advance Adjustment', 'PAYMENT', 'finance', 1, false, ADV, 'Invoice Value − Advance Adjusted = Balance Payable.', [
      ac('A1901', 'S19', 1, { name: 'Adjust advance against invoice', ownerRole: 'finance', slaDays: 1, actionType: 'adjustment', input: 'Invoice + outstanding advance', output: 'Adjustment note', requiredDocs: ['D19'] })]),
    st('S20', 20, 'Balance Payment', 'PAYMENT', 'ap', 2, false, ADV, 'Pay the balance or recover excess advance.', [
      ac('A2001', 'S20', 1, { name: 'Pay balance / recover excess advance', ownerRole: 'ap', slaDays: 2, actionType: 'balance_payment', input: 'Adjustment note', output: 'Balance paid', requiredDocs: ['D18'] })]),
    st('S21', 21, 'Closure', 'CLOSURE', 'procurement', 1, false, null, 'Close only when every closure check passes.', [
      ac('A2101', 'S21', 1, { name: 'Verify closure checklist and close', ownerRole: 'procurement', slaDays: 1, actionType: 'closure', input: 'Complete purchase file', output: 'Purchase closed' })])
  ];

  /* Process V0.9 (retired) — no Initial Review or Payment Approval stage.
     Kept so historical purchases stay linked to the version they used. */
  const stagesV09 = JSON.parse(JSON.stringify(stagesV1)).filter(s => s.id !== 'S03' && s.id !== 'S17');

  /* ---------------- 4.1 Process Master ---------------- */
  const processes = [{
    id: 'PROC-PUR',
    name: 'Procurement / Purchase',
    ownerUserId: 'U04',
    status: 'Active',
    activeVersion: '1.0',
    versions: [
      { version: '0.9', status: 'Retired', effectiveDate: '2026-01-01', retiredDate: '2026-03-31', createdBy: 'U11', notes: 'Initial rollout — no initial review or separate payment approval.', stages: stagesV09 },
      { version: '1.0', status: 'Active',  effectiveDate: '2026-04-01', retiredDate: null,         createdBy: 'U11', notes: 'Added Initial Review (S03) and Payment Approval (S17) controls.', stages: stagesV1 }
    ]
  }];

  function build() {
    return JSON.parse(JSON.stringify({
      processes, roles, ownerResolvers, users, departments, costCentres, categories, vendors, approvalMatrix,
      documents, statuses, priorities, sla, escalations, rules, notifications,
      advanceTypes, advanceApproval, ageingBuckets, settlementRules, towerGroups
    }));
  }

  return { build };
})();
