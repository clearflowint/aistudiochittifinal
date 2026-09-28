import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { spawnSync } from "child_process";
import fs from "fs";
import { checkNocoDBConnection, initializeNocoDBTables, getNocoDBTables, insertRecord, insertBulkRecords, updateRecord, upsertRecord, deleteRecordsByChittiId, deleteRecord, getAllRecords } from "./server/nocodbSync";


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

let chittiExpenses: ChittiExpense[] = [];

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
  { tenant_id: "clearflowint@gmail.com", name: "ClearFlow International", status: "active" },
];

const authorizedManagerEmails: string[] = [
  "mahirocks66@gmail.com",
  "manager.apex@chits.com",
  "admin@clearflow.com",
  "support@clearflow.com",
  "clearflowint@gmail.com"
];

let chittis: ChittiMaster[] = [];
let shares: MemberShare[] = [];
let transactions: Transaction[] = [];

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
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    const cleanEmail = email.trim().toLowerCase();

    let dbTenants: any[] = [];
    try {
      dbTenants = await getAllRecords("tenants");
      console.log("tenant rows fetched from table:", dbTenants.length);
    } catch (err) {
      console.error("Failed to fetch tenants from NocoDB table:", err);
    }

    let tenant = dbTenants.find(t => {
      const tid = (t.tenant_id || t.tenantId || t["Tenant ID"] || t["Tenant Id"] || t.email || "").trim().toLowerCase();
      return tid === cleanEmail;
    });

    // Check if account in NocoDB table is explicitly suspended or inactive
    if (tenant) {
      const status = (tenant.status || "").trim().toLowerCase();
      if (status === "suspended" || status === "inactive") {
        return res.json({ 
          authorized: false, 
          message: "Account Suspended. Manager cannot access existing chittis and database. Please contact ClearFlow Automations +919652169196." 
        });
      }
    } else {
      // If not in table yet, auto-register as active tenant in NocoDB table
      const newTenant = {
        tenant_id: cleanEmail,
        name: cleanEmail.split("@")[0],
        status: "active"
      };
      try {
        await upsertRecord("tenants", "tenant_id", cleanEmail, newTenant);
        dbTenants.push(newTenant);
        tenant = newTenant;
      } catch (err) {
        console.error("Tenant auto-upsert error to NocoDB table:", err);
      }
    }

    res.json({ authorized: true, email: cleanEmail });
  });

  app.get("/api/tenants", (req, res) => {
    res.json(tenants);
  });

  app.get("/api/math-templates", (req, res) => {
    res.json(mathTemplates);
  });

  app.get("/api/chittis", async (req, res) => {
    const tenant_id = req.query.tenant_id as string;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }
    const cleanReq = tenant_id.trim().toLowerCase();

    try {
      const dbChittis = await getAllRecords("chittis");
      const filtered = (dbChittis || []).filter((c: any) => (c.tenant_id || "").trim().toLowerCase() === cleanReq);
      return res.json(filtered);
    } catch (err) {
      console.error("Failed to fetch chittis live from NocoDB:", err);
      return res.json([]);
    }
  });

  app.post("/api/chittis", async (req, res) => {
    const { tenant_id, formula_id, name, start_date, total_members, total_months, u_due, d_due, commission } = req.body;
    if (!tenant_id || !name) {
      return res.status(400).json({ error: "tenant_id and name are required" });
    }

    const cleanTenantId = String(tenant_id).trim().toLowerCase();
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
      tenant_id: cleanTenantId,
      formula_id: fId,
      name: String(name).trim(),
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

    try {
      const resRaw: any = await insertRecord("chittis", newChitti);
      console.log(`NocoDB chitti insert result for ${newChitti.chitti_id}:`, resRaw);
      if (resRaw && (resRaw.Id || resRaw.id)) {
        (newChitti as any).Id = resRaw.Id || resRaw.id;
      }
    } catch (err) {
      console.error("NocoDB chitti sync error:", err);
    }

    const newSharesList: any[] = [];
    for (let i = 1; i <= newChitti.total_members; i++) {
      const newShare = {
        share_id: `SH-${String(i).padStart(3, '0')}`,
        chitti_id: newChitti.chitti_id,
        tenant_id: cleanTenantId,
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
      newSharesList.push(newShare);
    }

    // Fast single bulk insert for all shares instead of 20 sequential calls
    try {
      await insertBulkRecords("shares", newSharesList);
      console.log(`Successfully bulk-inserted ${newSharesList.length} shares into NocoDB for ${newChitti.chitti_id}`);
    } catch (err) {
      console.error("NocoDB bulk shares sync error:", err);
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

  // Comprehensive Chitti computed details fetched live from NocoDB on every request (Zero Server Cache)
  app.get("/api/chittis/:chitti_id/details", async (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;

    try {
      const dbChittis = await getAllRecords("chittis");
      const dbShares = await getAllRecords("shares");
      const dbTxs = await getAllRecords("transactions");

      const chitti = (dbChittis || []).find((c: any) => String(c.chitti_id) === String(chitti_id) && String(c.tenant_id || "").trim().toLowerCase() === String(tenant_id || "").trim().toLowerCase());
      if (!chitti) {
        return res.status(404).json({ error: "Chitti not found or tenant mismatch" });
      }

      // Automatically check and update current_month once per calendar month
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
        await updateRecord("chittis", { chitti_id: chitti.chitti_id, current_month: calculatedMonth, last_checked_date: currentYearMonth }).catch(() => {});
      }

      const t = chitti.current_month || 1;
      const N = Number(chitti.total_members) || 20;
      const U = Number(chitti.u_due) || 5000;
      const D = Number(chitti.d_due) || 6000;
      const F = Number(chitti.commission) || 2000;
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

      const chittiShares = (dbShares || []).filter((s: any) => String(s.chitti_id) === String(chitti_id));
      const chittiTxs = (dbTxs || []).filter((tx: any) => String(tx.chitti_id) === String(chitti_id));

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

        const shareTxs = chittiTxs.filter((tx: any) => String(tx.share_id) === String(share.share_id) && !tx.is_void);
        const totalPaid = shareTxs.reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
        const netBalance = totalPaid - totalBilled;

        const pendingAmount = netBalance < 0 ? Math.abs(netBalance) : 0;
        const advanceAmount = netBalance > 0 ? netBalance : 0;

        share.total_billed = totalBilled;
        share.total_paid = totalPaid;
        share.net_balance = netBalance;
        share.pending_amount = pendingAmount;
        share.advance_amount = advanceAmount;
        share.monthly_due_current = monthlyDueNow;

        return { totalBilled, totalPaid, netBalance, pendingAmount, advanceAmount, monthlyDueNow, shareTxs };
      }

      let totalPendingMarket = 0;

      const memberDetails = chittiShares.map((share: any) => {
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

      // Manager's Treasury Ledger
      let cumulativeExpectedBilled = 0;
      let cumulativeDisbursement = 0;
      let winnersThisMonthCount = memberDetails.filter((s: any) => s.win_month === t).length;
      let monthDisbursement = winnersThisMonthCount * payout_t;

      for (let m = 1; m <= t; m++) {
        const uCountM = memberDetails.filter((s: any) => s.win_month === null || s.win_month > m).length;
        const dCountM = N - uCountM;
        cumulativeExpectedBilled += (uCountM * U) + (dCountM * D);

        const p_m = calculateFormulaPayout(m, N, U, D, F, formulaId);
        const winCountM = memberDetails.filter((s: any) => s.win_month === m).length;
        cumulativeDisbursement += (winCountM * p_m);
      }

      const totalActualCashCollected = memberDetails.reduce((sum: number, s: any) => sum + s.total_paid, 0);
      const cumulativeCommission = t * F;
      const netCashflowUptodate = totalActualCashCollected - cumulativeDisbursement - cumulativeCommission;
      const closingBalance = netCashflowUptodate;

      return res.json({
        chitti,
        active_month: t,
        payout_t,
        total_pending_market: totalPendingMarket,
        treasury: {
          gross_collection: cumulativeExpectedBilled,
          actual_cash_collected: totalActualCashCollected,
          undrawn_count: memberDetails.filter((s: any) => s.win_month === null || s.win_month > t).length,
          drawn_count: N - memberDetails.filter((s: any) => s.win_month === null || s.win_month > t).length,
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
    } catch (err) {
      console.error("Error fetching live chitti details from NocoDB:", err);
      return res.status(500).json({ error: "Failed to fetch live chitti details from database" });
    }
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
      if (!syncRes || (syncRes as any).error) {
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
