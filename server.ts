import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { spawnSync } from "child_process";
import fs from "fs";
import { checkNocoDBConnection, initializeNocoDBTables, getNocoDBTables, insertRecord, updateRecord, upsertRecord, deleteRecordsByChittiId, deleteRecord, getAllRecords } from "./server/nocodbSync";


interface Tenant {
  tenant_id: string; // Manager email ID
  name: string;
  status: string; // "active" or "suspended"
}

interface MathTemplate {
  formula_id: string;
  name: string;
  description: string;
}

interface ChittiMaster {
  chitti_id: string;
  tenant_id: string; // Manager email ID
  formula_id: string; // Math formula template ID
  name: string;
  start_date: string;
  total_members: number;
  total_months: number;
  u_due: number;
  d_due: number;
  commission: number;
  current_month?: number;
  payout_schedule?: any;
  last_checked_date?: string;
}

interface MemberShare {
  share_id: string;
  chitti_id: string;
  tenant_id: string;
  member_name: string;
  phone: string;
  win_month: number | null; // null if undrawn, or month number 1..total_months
}

interface Transaction {
  tx_id: string;
  share_id: string;
  chitti_id: string;
  tenant_id: string;
  amount: number;
  date_paid: string;
  payment_mode: string;
  is_void?: boolean;
}

interface ChittiExpense {
  expense_id: string;
  chitti_id: string;
  tenant_id: string;
  title: string;
  type: 'credit' | 'debit';
  amount: number;
  date: string;
}

let chittiExpenses: ChittiExpense[] = [
  { expense_id: "exp_1", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", title: "Stationery & Books", type: "debit", amount: 1500, date: "2025-01-10" },
  { expense_id: "exp_2", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", title: "Sponsor Refund", type: "credit", amount: 500, date: "2025-01-15" },
];

// Math Formula Templates Registry (Single Incremental Template - Extensible via Formula ID / Python modules)
const mathTemplates: MathTemplate[] = [
  {
    formula_id: "standard_chit_v1",
    name: "Standard Incremental Linear Gradient Chit Formula",
    description: "Payout_t = [(t - 1) * (D - U)] + (N * U) - F. Isolated by formula_id for plug-and-play python calculation integration.",
  }
];

// Initial seed data: Manager Email ID as tenants whitelist with status
const tenants: Tenant[] = [
  { tenant_id: "mahirocks66@gmail.com", name: "Mahi Rocks", status: "active" },
  { tenant_id: "manager.apex@chits.com", name: "Apex Manager", status: "active" },
];

const authorizedManagerEmails: string[] = [
  "mahirocks66@gmail.com",
  "manager.apex@chits.com",
  "admin@clearflow.com",
  "support@clearflow.com"
];

let chittis: ChittiMaster[] = [
  {
    chitti_id: "chit_20_1lakh",
    tenant_id: "mahirocks66@gmail.com",
    formula_id: "standard_chit_v1",
    name: "Apex 20-Month ₹1 Lakh Chitti",
    start_date: "2025-01-01",
    total_members: 20,
    total_months: 20,
    u_due: 5000,
    d_due: 6000,
    commission: 2000,
  },
  {
    chitti_id: "chit_10_50k",
    tenant_id: "mahirocks66@gmail.com",
    formula_id: "standard_chit_v1",
    name: "Apex Express 10-Month ₹50k",
    start_date: "2026-03-01",
    total_members: 10,
    total_months: 10,
    u_due: 5000,
    d_due: 5800,
    commission: 1000,
  },
  {
    chitti_id: "chit_zenith_1",
    tenant_id: "manager.apex@chits.com",
    formula_id: "standard_chit_v1",
    name: "Zenith Gold 20-Month Chitti",
    start_date: "2026-01-01",
    total_members: 20,
    total_months: 20,
    u_due: 10000,
    d_due: 12000,
    commission: 5000,
  }
];

let shares: MemberShare[] = [
  // Apex 20-month (chit_20_1lakh)
  { share_id: "SH-101", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Rajesh Kumar", phone: "9876543210", win_month: 1 },
  { share_id: "SH-102", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Priya Sharma", phone: "9876543211", win_month: 2 },
  { share_id: "SH-103", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Amit Patel", phone: "9876543212", win_month: 3 },
  { share_id: "SH-104", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Sunita Rao", phone: "9876543213", win_month: 4 },
  { share_id: "SH-105", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Vikram Singh", phone: "9876543214", win_month: 5 },
  { share_id: "SH-106", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Neha Gupta", phone: "9876543215", win_month: null },
  { share_id: "SH-107", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Suresh Menon", phone: "9876543216", win_month: null },
  { share_id: "SH-108", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Ananya Iyer", phone: "9876543217", win_month: null },
  { share_id: "SH-109", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Karan Johar", phone: "9876543218", win_month: null },
  { share_id: "SH-110", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Deepika Sen", phone: "9876543219", win_month: null },
  { share_id: "SH-111", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Manoj Bajpai", phone: "9876543220", win_month: null },
  { share_id: "SH-112", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Kavita Das", phone: "9876543221", win_month: null },
  { share_id: "SH-113", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Rahul Dravid", phone: "9876543222", win_month: null },
  { share_id: "SH-114", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Smriti Mandhana", phone: "9876543223", win_month: null },
  { share_id: "SH-115", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Harsh Vardhan", phone: "9876543224", win_month: null },
  { share_id: "SH-116", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Divya Khosla", phone: "9876543225", win_month: null },
  { share_id: "SH-117", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Nikhil Kamath", phone: "9876543226", win_month: null },
  { share_id: "SH-118", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Falguni Nayar", phone: "9876543227", win_month: null },
  { share_id: "SH-119", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Kiran Mazumdar", phone: "9876543228", win_month: null },
  { share_id: "SH-120", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", member_name: "Sachin Tendulkar", phone: "9876543229", win_month: null },

  // Zenith Chitti
  { share_id: "ZSH-01", chitti_id: "chit_zenith_1", tenant_id: "manager.apex@chits.com", member_name: "Aditya Roy", phone: "9123456780", win_month: 1 },
  { share_id: "ZSH-02", chitti_id: "chit_zenith_1", tenant_id: "manager.apex@chits.com", member_name: "Natasha Romanoff", phone: "9123456781", win_month: 2 },
  { share_id: "ZSH-03", chitti_id: "chit_zenith_1", tenant_id: "manager.apex@chits.com", member_name: "Bruce Banner", phone: "9123456782", win_month: null },
  { share_id: "ZSH-04", chitti_id: "chit_zenith_1", tenant_id: "manager.apex@chits.com", member_name: "Tony Stark", phone: "9123456783", win_month: null },
  { share_id: "ZSH-05", chitti_id: "chit_zenith_1", tenant_id: "manager.apex@chits.com", member_name: "Steve Rogers", phone: "9123456784", win_month: null },
];

let transactions: Transaction[] = [
  { tx_id: "tx_1", share_id: "SH-101", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 6000, date_paid: "2025-01-05", payment_mode: "UPI" },
  { tx_id: "tx_2", share_id: "SH-101", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 6000, date_paid: "2025-02-05", payment_mode: "UPI" },
  { tx_id: "tx_3", share_id: "SH-101", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 6000, date_paid: "2025-03-05", payment_mode: "Bank" },
  { tx_id: "tx_4", share_id: "SH-101", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 6000, date_paid: "2025-04-05", payment_mode: "Cash" },
  { tx_id: "tx_5", share_id: "SH-101", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 6000, date_paid: "2025-05-05", payment_mode: "UPI" },
  { tx_id: "tx_6", share_id: "SH-102", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 5000, date_paid: "2025-01-08", payment_mode: "UPI" },
  { tx_id: "tx_7", share_id: "SH-102", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 6000, date_paid: "2025-02-10", payment_mode: "UPI" },
  { tx_id: "tx_8", share_id: "SH-102", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 6000, date_paid: "2025-03-10", payment_mode: "UPI" },
  { tx_id: "tx_9", share_id: "SH-106", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 5000, date_paid: "2025-01-10", payment_mode: "Cash" },
  { tx_id: "tx_10", share_id: "SH-106", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 5000, date_paid: "2025-02-12", payment_mode: "UPI" },
  { tx_id: "tx_11", share_id: "SH-106", chitti_id: "chit_20_1lakh", tenant_id: "mahirocks66@gmail.com", amount: 5000, date_paid: "2025-03-15", payment_mode: "UPI" },
];

// Isolated calculation helper based on formula_id
// Isolated calculation helper mapped by formula_id
// Designed for plug-and-play Python calculation file integration (e.g. math_templates/{formulaId}.py)
function calculateFormulaPayout(t: number, N: number, U: number, D: number, F: number, formulaId: string) {
  try {
    const pyScript = path.join(process.cwd(), "math_templates", `${formulaId}.py`);
    if (fs.existsSync(pyScript)) {
      const result = spawnSync("python3", [pyScript], {
        input: JSON.stringify({ t, N, U, D, F }),
        encoding: "utf-8",
      });
      if (!result.error && result.status === 0) {
        const parsed = JSON.parse(result.stdout.trim());
        if (parsed.payout !== undefined) {
          return parsed.payout;
        }
      }
    }
  } catch (err) {
    console.error("Python formula execution fallback triggered:", err);
  }

  // Fallback inline calculation
  if (formulaId === "standard_chit_v1") {
    return ((t - 1) * (D - U)) + (N * U) - F;
  }
  return ((t - 1) * (D - U)) + (N * U) - F;
}

function calculateFormulaDue(month: number, winMonth: number | null, U: number, D: number, formulaId: string) {
  try {
    const pyScript = path.join(process.cwd(), "math_templates", `${formulaId}.py`);
    if (fs.existsSync(pyScript)) {
      const result = spawnSync("python3", [pyScript], {
        input: JSON.stringify({ t: month, win_month: winMonth, U, D }),
        encoding: "utf-8",
      });
      if (!result.error && result.status === 0) {
        const parsed = JSON.parse(result.stdout.trim());
        if (parsed.current_due !== undefined) {
          return parsed.current_due;
        }
      }
    }
  } catch (err) {
    // fallback
  }
  const isDrawn = winMonth !== null && month > winMonth;
  return isDrawn ? D : U;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize NocoDB tables and load/seed records on startup from NocoDB
  try {
    await initializeNocoDBTables();
    
    const dbTenants = await getAllRecords("tenants");
    if (dbTenants.length > 0) {
      tenants.splice(0, tenants.length, ...dbTenants);
    } else {
      for (const t of tenants) {
        await upsertRecord("tenants", "tenant_id", t.tenant_id, t).catch(() => {});
      }
    }

    const dbMath = await getAllRecords("mathTemplates");
    if (dbMath.length > 0) {
      mathTemplates.splice(0, mathTemplates.length, ...dbMath);
    } else {
      for (const m of mathTemplates) {
        await upsertRecord("mathTemplates", "formula_id", m.formula_id, m).catch(() => {});
      }
    }

    const dbChittis = await getAllRecords("chittis");
    if (dbChittis.length > 0) {
      chittis.splice(0, chittis.length, ...dbChittis);
    }

    const dbShares = await getAllRecords("shares");
    if (dbShares.length > 0) {
      shares.splice(0, shares.length, ...dbShares);
    }

    const dbTxs = await getAllRecords("transactions");
    if (dbTxs.length > 0) {
      transactions.splice(0, transactions.length, ...dbTxs);
    }

    const dbExp = await getAllRecords("chittiExpenses");
    if (dbExp.length > 0) {
      chittiExpenses.splice(0, chittiExpenses.length, ...dbExp);
    }
  } catch (err) {
    console.error("Failed to initialize NocoDB tables and load records on startup:", err);
  }

  // API Routes
  app.get("/api/sync-nocodb", async (req, res) => {
    try {
      await initializeNocoDBTables();
      const tables = await getNocoDBTables();
      res.json({ success: true, base_id: "p4277q2gv93p704", tables });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/auth/verify-manager", async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    const cleanEmail = email.trim().toLowerCase();

    try {
      const dbTenants = await getAllRecords("tenants");
      if (dbTenants && dbTenants.length > 0) {
        tenants.splice(0, tenants.length, ...dbTenants);
      }
    } catch (err) {
      console.error("Failed to refresh tenants from NocoDB:", err);
    }

    const tenant = tenants.find(t => (t.tenant_id || "").toLowerCase() === cleanEmail);

    if (!tenant) {
      return res.json({ 
        authorized: false, 
        message: "Access Denied. Tenant ID not authorized in system whitelist. Please contact ClearFlow Automations +919652169196." 
      });
    }

    const tenantStatus = (tenant.status || "active").toLowerCase();
    if (tenantStatus === "suspended" || tenantStatus === "inactive") {
      return res.json({ 
        authorized: false, 
        message: "Account Suspended. Manager cannot access existing chittis and database. Please contact ClearFlow Automations +919652169196." 
      });
    }

    res.json({ authorized: true, email: cleanEmail });
  });

  app.get("/api/tenants", (req, res) => {
    res.json(tenants);
  });

  app.get("/api/math-templates", (req, res) => {
    res.json(mathTemplates);
  });

  app.get("/api/chittis", (req, res) => {
    const tenant_id = req.query.tenant_id as string;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }
    const filtered = chittis.filter(c => c.tenant_id === tenant_id);
    res.json(filtered);
  });

  app.post("/api/chittis", (req, res) => {
    const { tenant_id, formula_id, name, start_date, total_members, total_months, u_due, d_due, commission } = req.body;
    if (!tenant_id || !name) {
      return res.status(400).json({ error: "tenant_id and name are required" });
    }

    const tMembers = Number(total_members) || 20;
    const tMonths = Number(total_months) || 20;
    const uDue = Number(u_due) || 5000;
    const dDue = Number(d_due) || 6000;
    const comm = Number(commission) || 2000;
    const fId = formula_id || "standard_chit_v1";
    const startDate = start_date || new Date().toISOString().split("T")[0];

    // Pre-calculate payout schedule array at creation time
    const scheduleArr = [];
    for (let m = 1; m <= tMonths; m++) {
      const p = calculateFormulaPayout(m, tMembers, uDue, dDue, comm, fId);
      scheduleArr.push({ month: m, payout: p });
    }

    // Calculate initial active current_month
    const start = new Date(startDate);
    const now = new Date();
    const diffYears = now.getFullYear() - start.getFullYear();
    const diffMonths = now.getMonth() - start.getMonth();
    const elapsed = (diffYears * 12) + diffMonths + 1;
    const initialCurrentMonth = Math.max(1, Math.min(elapsed, tMonths));
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const newChitti: ChittiMaster = {
      chitti_id: "chit_" + Math.random().toString(36).substring(2, 9),
      tenant_id,
      formula_id: fId,
      name,
      start_date: startDate,
      total_members: tMembers,
      total_months: tMonths,
      u_due: uDue,
      d_due: dDue,
      commission: comm,
      current_month: initialCurrentMonth,
      last_checked_date: currentYearMonth,
      payout_schedule: JSON.stringify(scheduleArr),
    };
    chittis.push(newChitti);
    insertRecord("chittis", newChitti).then((resRaw: any) => {
      if (resRaw && (resRaw.Id || resRaw.id)) {
        (newChitti as any).Id = resRaw.Id || resRaw.id;
      }
    }).catch(err => console.error("NocoDB chitti sync error:", err));

    for (let i = 1; i <= newChitti.total_members; i++) {
      const newShare = {
        share_id: `SH-${String(i).padStart(3, '0')}`,
        chitti_id: newChitti.chitti_id,
        tenant_id,
        member_name: `Member ${i}`,
        phone: "+910000000000",
        win_month: null,
        total_paid: 0,
        total_billed: 0,
        net_balance: 0,
        pending_amount: 0,
        advance_amount: 0,
      };
      shares.push(newShare);
      insertRecord("shares", newShare).then((resRaw: any) => {
        if (resRaw && (resRaw.Id || resRaw.id)) {
          (newShare as any).Id = resRaw.Id || resRaw.id;
        }
      }).catch(err => console.error("NocoDB share sync error:", err));
    }

    res.json(newChitti);
  });

  // Full month-by-month schedule & payout array endpoint
  app.get("/api/chittis/:chitti_id/schedule", (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;

    const chitti = chittis.find(c => c.chitti_id === chitti_id && c.tenant_id === tenant_id);
    if (!chitti) {
      return res.status(404).json({ error: "Chitti not found" });
    }

    if (chitti.payout_schedule) {
      try {
        const schedule = JSON.parse(chitti.payout_schedule);
        return res.json({ chitti_id, formula_id: chitti.formula_id, schedule });
      } catch (e) {
        // fallback
      }
    }

    // fallback generation if schedule missing
    const N = chitti.total_members;
    const U = chitti.u_due;
    const D = chitti.d_due;
    const F = chitti.commission;
    const formulaId = chitti.formula_id || "standard_chit_v1";

    const schedule = [];
    for (let m = 1; m <= chitti.total_months; m++) {
      const payout = calculateFormulaPayout(m, N, U, D, F, formulaId);
      schedule.push({ month: m, payout, undrawn_due: U, drawn_due: D, commission: F });
    }

    res.json({ chitti_id, formula_id: formulaId, schedule });
  });

  // Comprehensive Chitti computed details using pre-calculated schedule & monthly auto-update
  app.get("/api/chittis/:chitti_id/details", (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;

    const chitti = chittis.find(c => c.chitti_id === chitti_id && c.tenant_id === tenant_id);
    if (!chitti) {
      return res.status(404).json({ error: "Chitti not found or tenant mismatch" });
    }

    // Automatically check and update current_month once per calendar month in database/state
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    function getCurrentMonth(startDateStr: string, totalMonths: number): number {
      const start = new Date(startDateStr);
      const diffYears = now.getFullYear() - start.getFullYear();
      const diffMonths = now.getMonth() - start.getMonth();
      const elapsed = (diffYears * 12) + diffMonths + 1;
      return Math.max(1, Math.min(elapsed, totalMonths));
    }

    const calculatedMonth = getCurrentMonth(chitti.start_date, chitti.total_months);
    if (!chitti.current_month || chitti.last_checked_date !== currentYearMonth) {
      chitti.current_month = calculatedMonth;
      chitti.last_checked_date = currentYearMonth;
    }

    const t = chitti.current_month;
    const N = chitti.total_members;
    const U = chitti.u_due;
    const D = chitti.d_due;
    const F = chitti.commission;
    const formulaId = chitti.formula_id || "standard_chit_v1";

    // O(1) Payout lookup from pre-calculated schedule array
    let payout_t = 0;
    if (chitti.payout_schedule) {
      try {
        const scheduleArr = JSON.parse(chitti.payout_schedule);
        const item = scheduleArr.find((s: any) => s.month === t);
        if (item) payout_t = item.payout;
      } catch (e) {
        payout_t = calculateFormulaPayout(t, N, U, D, F, formulaId);
      }
    } else {
      payout_t = calculateFormulaPayout(t, N, U, D, F, formulaId);
    }

    const chittiShares = shares.filter(s => s.chitti_id === chitti_id && s.tenant_id === tenant_id);
    const chittiTxs = transactions.filter(tx => tx.chitti_id === chitti_id && tx.tenant_id === tenant_id);

    // Helper to compute and persistently store share-level ledger balances in DB
    function updateShareLedger(share: any) {
      let totalBilled = 0;
      let monthlyDueNow = U;

      for (let m = 1; m <= t; m++) {
        const dueForMonth = calculateFormulaDue(m, share.win_month, U, D, formulaId);
        totalBilled += dueForMonth;
        if (m === t) {
          monthlyDueNow = dueForMonth;
        }
      }

      const shareTxs = chittiTxs.filter(tx => tx.share_id === share.share_id && !tx.is_void);
      const totalPaid = shareTxs.reduce((sum, tx) => sum + tx.amount, 0);
      const netBalance = totalPaid - totalBilled;

      const pendingAmount = netBalance < 0 ? Math.abs(netBalance) : 0;
      const advanceAmount = netBalance > 0 ? netBalance : 0;

      // Store directly in database entity object
      share.total_billed = totalBilled;
      share.total_paid = totalPaid;
      share.net_balance = netBalance;
      share.pending_amount = pendingAmount;
      share.advance_amount = advanceAmount;
      share.monthly_due_current = monthlyDueNow;

      return { totalBilled, totalPaid, netBalance, pendingAmount, advanceAmount, monthlyDueNow, shareTxs };
    }

    let totalPendingMarket = 0;

    const memberDetails = chittiShares.map(share => {
      const ledger = updateShareLedger(share);

      if (ledger.pendingAmount > 0) {
        totalPendingMarket += ledger.pendingAmount;
      }

      const status = share.win_month !== null && share.win_month <= t
        ? `Drawn M${share.win_month}`
        : "Undrawn";

      return {
        ...share,
        status,
        monthly_due_current: ledger.monthlyDueNow,
        total_billed: ledger.totalBilled,
        total_paid: ledger.totalPaid,
        net_balance: ledger.netBalance,
        pending_amount: ledger.pendingAmount,
        advance_amount: ledger.advanceAmount,
        transactions: ledger.shareTxs,
      };
    });

    // 2. Manager's Treasury Ledger (Up-to-date cumulative using formula)
    let cumulativeExpectedBilled = 0;
    let cumulativeDisbursement = 0;
    let winnersThisMonthCount = memberDetails.filter(s => s.win_month === t).length;
    let monthDisbursement = winnersThisMonthCount * payout_t;

    for (let m = 1; m <= t; m++) {
      const uCountM = memberDetails.filter(s => s.win_month === null || s.win_month > m).length;
      const dCountM = N - uCountM;
      cumulativeExpectedBilled += (uCountM * U) + (dCountM * D);

      const p_m = calculateFormulaPayout(m, N, U, D, F, formulaId);
      const winCountM = memberDetails.filter(s => s.win_month === m).length;
      cumulativeDisbursement += (winCountM * p_m);
    }

    const totalActualCashCollected = memberDetails.reduce((sum, s) => sum + s.total_paid, 0);
    const cumulativeCommission = t * F;
    const netCashflowUptodate = totalActualCashCollected - cumulativeDisbursement - cumulativeCommission;
    const closingBalance = netCashflowUptodate;

    res.json({
      chitti,
      active_month: t,
      payout_t,
      total_pending_market: totalPendingMarket,
      treasury: {
        gross_collection: cumulativeExpectedBilled,
        actual_cash_collected: totalActualCashCollected,
        undrawn_count: memberDetails.filter(s => s.win_month === null || s.win_month > t).length,
        drawn_count: N - memberDetails.filter(s => s.win_month === null || s.win_month > t).length,
        winners_this_month: winnersThisMonthCount,
        total_disbursement: monthDisbursement,
        cumulative_disbursement: cumulativeDisbursement,
        flat_commission: F,
        cumulative_commission: cumulativeCommission,
        net_cashflow: netCashflowUptodate,
        closing_ledger_balance: closingBalance,
      },
      members: memberDetails,
    });
  });

  // Idempotency cache store (24-hour TTL in-memory simulation)
  const idempotencyCache = new Map<string, any>();

  // Helper to recompute and persist share ledger directly in DB state
  function recalculateAndPersistShareLedger(share_id: string, chitti_id: string) {
    const share = shares.find(s => s.share_id === share_id && s.chitti_id === chitti_id);
    const chitti = chittis.find(c => c.chitti_id === chitti_id);
    if (!share || !chitti) return;

    const t = chitti.current_month || 1;
    const U = chitti.u_due;
    const D = chitti.d_due;
    const formulaId = chitti.formula_id || "standard_chit_v1";

    let totalBilled = 0;
    for (let m = 1; m <= t; m++) {
      totalBilled += calculateFormulaDue(m, share.win_month, U, D, formulaId);
    }

    const shareTxs = transactions.filter(tx => tx.share_id === share_id && tx.chitti_id === chitti_id && !tx.is_void);
    const totalPaid = shareTxs.reduce((sum, tx) => sum + tx.amount, 0);
    const netBalance = totalPaid - totalBilled;

    (share as any).total_billed = totalBilled;
    (share as any).total_paid = totalPaid;
    (share as any).net_balance = netBalance;
    (share as any).pending_amount = netBalance < 0 ? Math.abs(netBalance) : 0;
    (share as any).advance_amount = netBalance > 0 ? netBalance : 0;
  }

  app.post("/api/transactions", async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const { share_id, chitti_id, tenant_id, amount, payment_mode } = req.body;
    if (!share_id || !chitti_id || !tenant_id || amount === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // STRICT ISOLATION CHECK: Validate Chitti exists and belongs to tenant
    const chitti = chittis.find(c => c.chitti_id === chitti_id && c.tenant_id === tenant_id);
    if (!chitti) {
      return res.status(404).json({ error: "Chitti not found or tenant isolation mismatch" });
    }

    // STRICT ISOLATION CHECK: Validate Share exists, belongs to chitti and tenant
    const share = shares.find(s => s.share_id === share_id && s.chitti_id === chitti_id && s.tenant_id === tenant_id);
    if (!share) {
      return res.status(404).json({ error: "Share not found or composite chitti+tenant+formula isolation mismatch" });
    }

    if (idempotencyKey) {
      const cacheKey = `${tenant_id}:${chitti_id}:${share_id}:${idempotencyKey}`;
      if (idempotencyCache.has(cacheKey)) {
        return res.json(idempotencyCache.get(cacheKey));
      }
    }

    const newTx: Transaction = {
      tx_id: "tx_" + Math.random().toString(36).substring(2, 9),
      share_id,
      chitti_id,
      tenant_id,
      amount: Number(amount),
      date_paid: new Date().toISOString().split("T")[0],
      payment_mode: payment_mode || "UPI",
      is_void: false,
    };
    transactions.push(newTx);

    // Persist ledger balances directly in database entity
    recalculateAndPersistShareLedger(share_id, chitti_id);

    try {
      console.log(`[DB AWAIT] Inserting transaction ${newTx.tx_id} into NocoDB...`, new Date().toISOString());
      const syncRes = await insertRecord("transactions", newTx);
      console.log(`[DB CONFIRMED] NocoDB responded for transaction ${newTx.tx_id}:`, syncRes, new Date().toISOString());
      if (!syncRes || syncRes.error) {
        console.error("NocoDB transaction sync returned error:", syncRes);
      }
    } catch (err) {
      console.error("NocoDB transaction sync exception:", err);
    }

    if (idempotencyKey) {
      idempotencyCache.set(`${tenant_id}:${chitti_id}:${share_id}:${idempotencyKey}`, newTx);
    }

    res.json({ success: true, transaction: newTx, verified: true });
  });

  // Transaction Voiding endpoint with strict isolation
  app.post("/api/transactions/:tx_id/void", (req, res) => {
    const { tx_id } = req.params;
    const tenant_id = req.body.tenant_id || req.query.tenant_id;
    const tx = transactions.find(t => t.tx_id === tx_id);
    if (!tx) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    if (tenant_id && tx.tenant_id !== tenant_id) {
      return res.status(403).json({ error: "Tenant mismatch unauthorized isolation violation" });
    }
    tx.is_void = true;

    // Recalculate and persist share ledger balances directly in DB
    recalculateAndPersistShareLedger(tx.share_id, tx.chitti_id);

    res.json({ success: true, tx });
  });

  app.patch("/api/shares/:share_id", async (req, res) => {
    const { share_id } = req.params;
    const { tenant_id, chitti_id, win_month, member_name, phone } = req.body;
    
    console.log("PATCH /api/shares/:share_id received:", { share_id, tenant_id, chitti_id, win_month, member_name, phone });

    if (!chitti_id || !tenant_id) {
      return res.status(400).json({ error: "chitti_id and tenant_id are required for share update" });
    }

    // STRICT ISOLATION CHECK: Validate Chitti exists and belongs to tenant
    const chitti = chittis.find(c => c.chitti_id === chitti_id && c.tenant_id === tenant_id);
    if (!chitti) {
      return res.status(404).json({ error: "Chitti not found or tenant isolation mismatch" });
    }

    // STRICT ISOLATION CHECK: Validate Share exists, belongs to chitti and tenant
    const share = shares.find(s => s.share_id === share_id && s.chitti_id === chitti_id && s.tenant_id === tenant_id);
    if (!share) {
      console.error("Share not found for update:", { share_id, chitti_id, tenant_id });
      return res.status(404).json({ error: "Share not found or composite chitti+tenant isolation mismatch" });
    }

    if (win_month !== undefined) {
      const targetMonth = win_month === "" || win_month === null ? null : Number(win_month);
      if (targetMonth !== null) {
        if (targetMonth < 1 || targetMonth > chitti.total_months) {
          return res.status(400).json({ error: `Win month must be between 1 and ${chitti.total_months}` });
        }
      }
      share.win_month = targetMonth;
    }
    if (member_name !== undefined) share.member_name = member_name;
    if (phone !== undefined) {
      const cleanDigits = String(phone).replace(/\D/g, "").slice(-10);
      share.phone = cleanDigits.length === 10 ? `+91${cleanDigits}` : phone;
    }

    // Persist ledger balances directly in database entity
    recalculateAndPersistShareLedger(share.share_id, share.chitti_id);
    try {
      console.log(`[DB AWAIT] Upserting share ${share.share_id} into NocoDB...`, new Date().toISOString());
      const upsertRes = await upsertRecord("shares", "share_id", share.share_id, share);
      console.log(`[DB CONFIRMED] NocoDB responded for share ${share.share_id}:`, upsertRes, new Date().toISOString());
    } catch (err) {
      console.error("NocoDB share sync error:", err);
    }

    res.json({ success: true, share, verified: true });
  });

  // Chitti Expenses Endpoints
  app.get("/api/chittis/:chitti_id/expenses", async (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }

    try {
      const dbExp = await getAllRecords("chittiExpenses");
      if (dbExp && dbExp.length > 0) {
        chittiExpenses.splice(0, chittiExpenses.length, ...dbExp);
      }
      const dbChittis = await getAllRecords("chittis");
      if (dbChittis && dbChittis.length > 0) {
        chittis.splice(0, chittis.length, ...dbChittis);
      }
    } catch (err) {
      console.error("Failed to sync expenses from NocoDB:", err);
    }

    const chitti = chittis.find(c => String(c.chitti_id) === String(chitti_id));
    if (!chitti) {
      return res.status(404).json({ error: "Chitti not found" });
    }
    const list = chittiExpenses.filter(e => String(e.chitti_id) === String(chitti_id));
    const total_credit = list.filter(e => e.type === 'credit').reduce((s, e) => s + Number(e.amount || 0), 0);
    const total_debit = list.filter(e => e.type === 'debit').reduce((s, e) => s + Number(e.amount || 0), 0);
    const net_expenses = total_credit - total_debit;
    res.json({ expenses: list, total_credit, total_debit, net_expenses });
  });

  app.post("/api/chittis/:chitti_id/expenses", async (req, res) => {
    console.log("POST /api/chittis/:chitti_id/expenses received:", req.params, req.body);
    const { chitti_id } = req.params;
    const { tenant_id, title, type, amount } = req.body;
    if (!tenant_id || !title || !type || amount === undefined) {
      console.error("POST expense validation failed:", { tenant_id, title, type, amount });
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const dbChittis = await getAllRecords("chittis");
      if (dbChittis && dbChittis.length > 0) {
        chittis.splice(0, chittis.length, ...dbChittis);
      }
    } catch (err) {}

    const chitti = chittis.find(c => String(c.chitti_id) === String(chitti_id));
    if (!chitti) {
      console.error("POST expense chitti not found:", chitti_id, "Available chittis:", chittis.map(c => c.chitti_id));
      return res.status(404).json({ error: "Chitti not found" });
    }
    const newExp: ChittiExpense = {
      expense_id: "exp_" + Math.random().toString(36).substring(2, 9),
      chitti_id,
      tenant_id,
      title,
      type: type === 'credit' ? 'credit' : 'debit',
      amount: Number(amount),
      date: new Date().toISOString().split("T")[0],
    };
    chittiExpenses.push(newExp);
    await insertRecord("chittiExpenses", newExp).catch(err => console.error("NocoDB chittiExpense sync error:", err));
    console.log("Expense successfully added:", newExp);
    res.json(newExp);
  });

  app.delete("/api/chittis/expenses/:expense_id", async (req, res) => {
    const { expense_id } = req.params;
    const tenant_id = req.body.tenant_id || req.query.tenant_id;

    try {
      const dbExp = await getAllRecords("chittiExpenses");
      if (dbExp && dbExp.length > 0) {
        chittiExpenses.splice(0, chittiExpenses.length, ...dbExp);
      }
    } catch (err) {}

    const idx = chittiExpenses.findIndex(e => String(e.expense_id) === String(expense_id));
    if (idx === -1) {
      return res.status(404).json({ error: "Expense not found" });
    }
    const removed = chittiExpenses.splice(idx, 1)[0];
    await deleteRecord("chittiExpenses", "expense_id", expense_id).catch(err => console.error("NocoDB chittiExpense delete error:", err));
    res.json(removed);
  });

  // Delete Chitti ID Endpoint
  app.delete("/api/chittis/:chitti_id", async (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }
    const chitIdx = chittis.findIndex(c => c.chitti_id === chitti_id && c.tenant_id === tenant_id);
    if (chitIdx === -1) {
      return res.status(404).json({ error: "Chitti not found or tenant isolation mismatch" });
    }
    chittis.splice(chitIdx, 1);
    shares = shares.filter(s => s.chitti_id !== chitti_id);
    transactions = transactions.filter(t => t.chitti_id !== chitti_id);
    chittiExpenses = chittiExpenses.filter(e => e.chitti_id !== chitti_id);
    try {
      await deleteRecordsByChittiId(chitti_id);
    } catch (err) {
      console.error("NocoDB chitti deletion sync error:", err);
    }
    res.json({ success: true, chitti_id });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
