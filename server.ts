import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { spawnSync } from "child_process";
import fs from "fs";
import { calculateChittiMonth } from "./src/chittiMonthUtils";
import {
  checkNocoDBConnection,
  initializeNocoDBTables,
  getNocoDBTables,
  insertRecord,
  insertBulkRecords,
  updateRecord,
  upsertRecord,
  deleteRecordsByChittiId,
  deleteRecord,
  getAllRecords,
} from "./server/nocodbSync";

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
  total_paid?: number;
  total_billed?: number;
  net_balance?: number;
  pending_amount?: number;
  advance_amount?: number;
  monthly_due_current?: number;
  Id?: any;
  id?: any;
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
  type: "credit" | "debit";
  amount: number;
  date: string;
}

// Math Formula Templates Registry
const defaultMathTemplates: MathTemplate[] = [
  {
    formula_id: "standard_chit_v1",
    name: "Standard Incremental Linear Gradient Chit Formula",
    description: "Payout_t = [(t - 1) * (D - U)] + (N * U) - F. Isolated by formula_id for plug-and-play python calculation integration.",
  },
];

// Fallback seed tenants
const defaultTenants: Tenant[] = [
  { tenant_id: "mahirocks66@gmail.com", name: "Mahi Rocks", status: "active" },
  { tenant_id: "manager.apex@chits.com", name: "Apex Manager", status: "active" },
  { tenant_id: "clearflowint@gmail.com", name: "ClearFlow International", status: "active" },
];

// Calculation helper based on formula_id
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
  return ((t - 1) * (D - U)) + (N * U) - F;
}

function calculateFormulaDue(month: number, winMonth: number | null, U: number, D: number, N: number, F: number, formulaId: string) {
  try {
    const pyScript = path.join(process.cwd(), "math_templates", `${formulaId}.py`);
    if (fs.existsSync(pyScript)) {
      const result = spawnSync("python3", [pyScript], {
        input: JSON.stringify({ t: month, win_month: winMonth, U, D, N, F }),
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

// Stateless helper to compute and persist share ledger balances directly in NocoDB
async function computeAndPersistShareLedgerStateless(
  share: MemberShare,
  chitti: ChittiMaster,
  chittiTxs: Transaction[]
) {
  const t = chitti.current_month || 1;
  const N = Number(chitti.total_members) || 20;
  const U = Number(chitti.u_due) || 5000;
  const D = Number(chitti.d_due) || 6000;
  const F = Number(chitti.commission) || 2000;
  const formulaId = chitti.formula_id || "standard_chit_v1";

  let totalBilled = 0;
  let monthlyDueNow = U;
  for (let m = 1; m <= t; m++) {
    const dueForMonth = calculateFormulaDue(m, share.win_month, U, D, N, F, formulaId);
    totalBilled += dueForMonth;
    if (m === t) {
      monthlyDueNow = dueForMonth;
    }
  }

  const shareTxs = chittiTxs.filter(
    (tx) => String(tx.share_id) === String(share.share_id) && !tx.is_void
  );
  const totalPaid = shareTxs.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const netBalance = totalPaid - totalBilled;

  share.total_billed = totalBilled;
  share.total_paid = totalPaid;
  share.net_balance = netBalance;
  share.pending_amount = netBalance < 0 ? Math.abs(netBalance) : 0;
  share.advance_amount = netBalance > 0 ? netBalance : 0;
  share.monthly_due_current = monthlyDueNow;

  try {
    await upsertRecord("shares", "share_id", share.share_id, share);
  } catch (err) {
    console.error(`Failed to persist ledger for share ${share.share_id} in NocoDB:`, err);
  }

  return { totalBilled, totalPaid, netBalance, monthlyDueNow, shareTxs };
}

async function recalculateAndPersistChittiSummary(chittiId: string, updatedShareId?: string, updatedShareLedger?: any) {
  try {
    const dbChittis = await getAllRecords("chittis");
    const dbShares = await getAllRecords("shares");
    const dbTxs = await getAllRecords("transactions");

    const chitti = (dbChittis || []).find((c: any) => String(c.chitti_id) === String(chittiId));
    if (!chitti) return;

    const t = chitti.current_month || 1;
    const N = Number(chitti.total_members) || 20;
    const U = Number(chitti.u_due) || 5000;
    const D = Number(chitti.d_due) || 6000;
    const F = Number(chitti.commission) || 2000;
    const formulaId = chitti.formula_id || "standard_chit_v1";

    const chittiShares = (dbShares || []).filter((s: any) => String(s.chitti_id) === String(chittiId));
    const chittiTxs = (dbTxs || []).filter((tx: any) => String(tx.chitti_id) === String(chittiId) && !tx.is_void);

    let totalArrears = 0;
    for (const share of chittiShares) {
      if (updatedShareId && String(share.share_id) === String(updatedShareId) && updatedShareLedger) {
        if (updatedShareLedger.netBalance < 0) {
          totalArrears += Math.abs(updatedShareLedger.netBalance);
        }
      } else {
        // If not the updated share, compute or read its net balance efficiently
        const shareTxs = chittiTxs.filter((tx: any) => String(tx.share_id) === String(share.share_id));
        let totalBilled = 0;
        for (let m = 1; m <= t; m++) {
          totalBilled += calculateFormulaDue(m, share.win_month, U, D, N, F, formulaId);
        }
        const totalPaid = shareTxs.reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
        const netB = totalPaid - totalBilled;
        if (netB < 0) {
          totalArrears += Math.abs(netB);
        }
      }
    }

    let scheduleArr = [];
    try {
      scheduleArr = chitti.payout_schedule ? JSON.parse(chitti.payout_schedule) : [];
    } catch (e) {}

    if (scheduleArr.length === 0 || scheduleArr.length !== Number(chitti.total_months)) {
      scheduleArr = [];
      for (let m = 1; m <= Number(chitti.total_months || 20); m++) {
        const p = calculateFormulaPayout(m, N, U, D, F, formulaId);
        scheduleArr.push({ month: m, payout: p });
      }
    }

    let cumulativeDisbursement = 0;
    for (let m = 1; m <= t; m++) {
      const p_item = scheduleArr.find((s: any) => s.month === m);
      const p_m = p_item ? p_item.payout : calculateFormulaPayout(m, N, U, D, F, formulaId);
      const countWinnersM = chittiShares.filter((s: any) => s.win_month === m).length;
      cumulativeDisbursement += countWinnersM * p_m;
    }

    const totalCashCollected = chittiTxs.reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
    const cumulativeCommission = t * F;
    const netBalance = totalCashCollected - cumulativeDisbursement - cumulativeCommission;

    chitti.total_arrears = totalArrears;
    chitti.cumulative_commission = cumulativeCommission;
    chitti.total_disbursed = cumulativeDisbursement;
    chitti.total_cash_collected = totalCashCollected;
    chitti.net_balance = netBalance;
    chitti.payout_schedule = JSON.stringify(scheduleArr);

    await upsertRecord("chittis", "chitti_id", chitti.chitti_id, chitti);
  } catch (err) {
    console.error(`Failed to recalculate chitti summary for ${chittiId}:`, err);
  }
}

// Background routine to calculate and populate all newly created columns for existing chittis and shares
async function recalculateAndPopulateAllExistingChittisAndShares() {
  console.log("[MIGRATION] Starting recalculate and populate for all existing chittis and shares...");
  try {
    const dbChittis = await getAllRecords("chittis");
    const dbShares = await getAllRecords("shares");
    const dbTxs = await getAllRecords("transactions");

    if (!dbChittis || dbChittis.length === 0) {
      console.log("[MIGRATION] No chittis found to migrate.");
      return { chittisUpdated: 0, sharesUpdated: 0 };
    }

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let chittisUpdatedCount = 0;
    let sharesUpdatedCount = 0;

    for (const chitti of dbChittis) {
      const chittiId = chitti.chitti_id;
      if (!chittiId) continue;

      const N = Number(chitti.total_members) || 20;
      const totalMonths = Number(chitti.total_months) || 20;
      const U = Number(chitti.u_due) || 5000;
      const D = Number(chitti.d_due) || 6000;
      const F = Number(chitti.commission) || 2000;
      const formulaId = chitti.formula_id || "standard_chit_v1";

      // Compute calendar current month based on exact cycle crossing
      const t = calculateChittiMonth(chitti.start_date, totalMonths, now);

      // Compute/validate payout schedule
      let scheduleArr = [];
      try {
        scheduleArr = chitti.payout_schedule ? JSON.parse(chitti.payout_schedule) : [];
      } catch (e) {}

      if (scheduleArr.length === 0 || scheduleArr.length !== totalMonths) {
        scheduleArr = [];
        for (let m = 1; m <= totalMonths; m++) {
          const p = calculateFormulaPayout(m, N, U, D, F, formulaId);
          scheduleArr.push({ month: m, payout: p });
        }
      }

      const chittiShares = (dbShares || []).filter((s: any) => String(s.chitti_id) === String(chittiId));
      const chittiTxs = (dbTxs || []).filter((tx: any) => String(tx.chitti_id) === String(chittiId) && !tx.is_void);

      let totalArrears = 0;

      // Update all member shares for this chitti
      for (const share of chittiShares) {
        let totalBilled = 0;
        let monthlyDueNow = U;
        for (let m = 1; m <= t; m++) {
          const dueForMonth = calculateFormulaDue(m, share.win_month, U, D, N, F, formulaId);
          totalBilled += dueForMonth;
          if (m === t) {
            monthlyDueNow = dueForMonth;
          }
        }

        const shareTxs = chittiTxs.filter((tx: any) => String(tx.share_id) === String(share.share_id));
        const totalPaid = shareTxs.reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
        const netBalance = totalPaid - totalBilled;
        const pending = netBalance < 0 ? Math.abs(netBalance) : 0;
        const advance = netBalance > 0 ? netBalance : 0;

        if (pending > 0) {
          totalArrears += pending;
        }

        share.total_billed = totalBilled;
        share.total_paid = totalPaid;
        share.net_balance = netBalance;
        share.pending_amount = pending;
        share.advance_amount = advance;
        share.monthly_due_current = monthlyDueNow;

        try {
          await upsertRecord("shares", "share_id", share.share_id, share);
          sharesUpdatedCount++;
        } catch (e) {
          console.error(`Failed to update share ${share.share_id} in migration:`, e);
        }
      }

      // Calculate cumulative disbursement
      let cumulativeDisbursement = 0;
      for (let m = 1; m <= t; m++) {
        const p_item = scheduleArr.find((s: any) => s.month === m);
        const p_m = p_item ? p_item.payout : calculateFormulaPayout(m, N, U, D, F, formulaId);
        const countWinnersM = chittiShares.filter((s: any) => s.win_month === m).length;
        cumulativeDisbursement += countWinnersM * p_m;
      }

      const totalCashCollected = chittiTxs.reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
      const cumulativeCommission = t * F;
      const netBalance = totalCashCollected - cumulativeDisbursement - cumulativeCommission;

      chitti.current_month = t;
      chitti.last_checked_date = currentYearMonth;
      chitti.payout_schedule = JSON.stringify(scheduleArr);
      chitti.total_arrears = totalArrears;
      chitti.cumulative_commission = cumulativeCommission;
      chitti.total_disbursed = cumulativeDisbursement;
      chitti.total_cash_collected = totalCashCollected;
      chitti.net_balance = netBalance;

      try {
        await upsertRecord("chittis", "chitti_id", chitti.chitti_id, chitti);
        chittisUpdatedCount++;
      } catch (e) {
        console.error(`Failed to update chitti ${chitti.chitti_id} in migration:`, e);
      }
    }

    console.log(`[MIGRATION COMPLETED] Successfully populated ${chittisUpdatedCount} chittis and ${sharesUpdatedCount} shares.`);
    return { chittisUpdated: chittisUpdatedCount, sharesUpdated: sharesUpdatedCount };
  } catch (err) {
    console.error("[MIGRATION ERROR] Failed to populate existing records:", err);
    return { error: String(err) };
  }
}

// 24-hour in-flight Idempotency cache (pure request deduplication, zero entity caching)
const idempotencyCache = new Map<string, any>();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Verify NocoDB connection and ensure tables exist on startup
  try {
    await initializeNocoDBTables();
    console.log("[ZERO CACHE] Server booted in pure stateless mode. NocoDB is the single source of truth.");
    // Populate newly created columns for all existing chittis and shares asynchronously
    recalculateAndPopulateAllExistingChittisAndShares().catch((err) => {
      console.error("Auto-population of existing chittis/shares failed:", err);
    });
  } catch (err) {
    console.error("NocoDB table initialization check failed on startup:", err);
  }

  // API Routes
  app.post("/api/admin/repopulate-all-columns", async (req, res) => {
    try {
      const result = await recalculateAndPopulateAllExistingChittisAndShares();
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.get("/api/sync-nocodb", async (req, res) => {
    try {
      await initializeNocoDBTables();
      const tables = await getNocoDBTables();
      res.json({ success: true, base_id: "71164a52-14f4-4eae-b1b0-2dff495e3e09", tables });
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
    } catch (err) {
      console.error("Failed to fetch tenants from NocoDB table:", err);
    }

    let tenant = dbTenants.find((t) => {
      const tid = (t.tenant_id || t.tenantId || t["Tenant ID"] || t["Tenant Id"] || t.email || "").trim().toLowerCase();
      return tid === cleanEmail;
    });

    if (tenant) {
      const status = (tenant.status || "").trim().toLowerCase();
      if (status === "suspended" || status === "inactive") {
        return res.json({
          authorized: false,
          message: "Account Suspended. Manager cannot access existing chittis and database. Please contact ClearFlow Automations +919652169196.",
        });
      }
    } else {
      const newTenant = {
        tenant_id: cleanEmail,
        name: cleanEmail.split("@")[0],
        status: "active",
      };
      try {
        await upsertRecord("tenants", "tenant_id", cleanEmail, newTenant);
        tenant = newTenant;
      } catch (err) {
        console.error("Tenant auto-upsert error to NocoDB table:", err);
      }
    }

    res.json({ authorized: true, email: cleanEmail });
  });

  app.get("/api/health", async (_req, res) => {
    try {
      const isOnline = await checkNocoDBConnection();
      if (!isOnline) {
        return res.status(503).json({
          status: "degraded",
          db_online: false,
          message: "Database is currently offline or unreachable",
        });
      }
      return res.json({
        status: "ok",
        db_online: true,
        message: "Database connection active and synchronized",
      });
    } catch (err: any) {
      return res.status(503).json({
        status: "down",
        db_online: false,
        message: "Database connection failed",
        error: String(err),
      });
    }
  });

  app.get("/api/tenants", async (req, res) => {
    try {
      const dbTenants = await getAllRecords("tenants");
      res.json(dbTenants.length > 0 ? dbTenants : defaultTenants);
    } catch (err) {
      res.json(defaultTenants);
    }
  });

  app.get("/api/math-templates", async (req, res) => {
    try {
      const dbMath = await getAllRecords("mathTemplates");
      res.json(dbMath.length > 0 ? dbMath : defaultMathTemplates);
    } catch (err) {
      res.json(defaultMathTemplates);
    }
  });

  // Pure Stateless GET /api/chittis
  app.get("/api/chittis", async (req, res) => {
    const tenant_id = req.query.tenant_id as string;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }
    const cleanReq = tenant_id.trim().toLowerCase();

    try {
      const dbChittis = await getAllRecords("chittis");
      const filtered = (dbChittis || []).filter((c: any) => {
        const cTenant = String(c.tenant_id || c.tenantId || c.email || "").trim().toLowerCase();
        return cTenant === cleanReq;
      });
      return res.json(filtered);
    } catch (err: any) {
      console.error("Failed to fetch chittis live from NocoDB:", err);
      return res.status(503).json({
        error: "database_offline",
        message: "Database is currently offline or unreachable",
      });
    }
  });

  // Pure Stateless POST /api/chittis
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

    const scheduleArr = [];
    for (let m = 1; m <= tMonths; m++) {
      const p = calculateFormulaPayout(m, tMembers, uDue, dDue, comm, fId);
      scheduleArr.push({ month: m, payout: p });
    }

    const now = new Date();
    const initialCurrentMonth = calculateChittiMonth(startDate, tMonths, now);
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

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

    try {
      const resRaw: any = await insertRecord("chittis", newChitti);
      if (!resRaw || resRaw.error) {
        return res.status(500).json({ success: false, error: "NocoDB database rejected chitti insertion", details: resRaw });
      }
      if (resRaw && (resRaw.Id || resRaw.id)) {
        (newChitti as any).Id = resRaw.Id || resRaw.id;
      }
    } catch (err) {
      console.error("NocoDB chitti sync error:", err);
      return res.status(500).json({ success: false, error: "Database network error during chitti creation", details: String(err) });
    }

    let initialBilledPerUndrawnShare = 0;
    for (let m = 1; m <= initialCurrentMonth; m++) {
      initialBilledPerUndrawnShare += calculateFormulaDue(m, null, uDue, dDue, tMembers, comm, fId);
    }

    const newSharesList: any[] = [];
    for (let i = 1; i <= newChitti.total_members; i++) {
      const newShare = {
        share_id: `SH-${String(i).padStart(3, "0")}`,
        chitti_id: newChitti.chitti_id,
        tenant_id: cleanTenantId,
        member_name: `Member ${i}`,
        phone: "+910000000000",
        win_month: null,
        total_paid: 0,
        total_billed: initialBilledPerUndrawnShare,
        net_balance: -initialBilledPerUndrawnShare,
        pending_amount: initialBilledPerUndrawnShare,
        advance_amount: 0,
        monthly_due_current: uDue,
      };
      newSharesList.push(newShare);
    }

    try {
      const bulkRes: any = await insertBulkRecords("shares", newSharesList);
      if (bulkRes && bulkRes.error) {
        return res.status(500).json({ success: false, error: "NocoDB database rejected bulk shares insertion", details: bulkRes });
      }
    } catch (err) {
      console.error("NocoDB bulk shares sync error:", err);
      return res.status(500).json({ success: false, error: "Database network error during shares creation", details: String(err) });
    }

    await recalculateAndPersistChittiSummary(newChitti.chitti_id);

    res.json({ success: true, chitti: newChitti, verified: true });
  });

  // Pure Stateless Schedule Endpoint
  app.get("/api/chittis/:chitti_id/schedule", async (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;

    const dbChittis = await getAllRecords("chittis");
    const chitti = (dbChittis || []).find(
      (c: any) =>
        String(c.chitti_id) === String(chitti_id) &&
        (!tenant_id || String(c.tenant_id || "").trim().toLowerCase() === String(tenant_id).trim().toLowerCase())
    );

    if (!chitti) {
      return res.status(404).json({ error: "Chitti not found" });
    }

    if (chitti.payout_schedule) {
      try {
        const schedule = JSON.parse(chitti.payout_schedule);
        return res.json({ chitti_id, formula_id: chitti.formula_id, schedule });
      } catch (e) {}
    }

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

  // Pure Stateless Chitti Computed Details Endpoint (Live from NocoDB)
  app.get("/api/chittis/:chitti_id/details", async (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;

    try {
      const dbChittis = await getAllRecords("chittis");
      const dbShares = await getAllRecords("shares");
      const dbTxs = await getAllRecords("transactions");

      const chitti = (dbChittis || []).find(
        (c: any) =>
          String(c.chitti_id) === String(chitti_id) &&
          String(c.tenant_id || "").trim().toLowerCase() === String(tenant_id || "").trim().toLowerCase()
      );
      if (!chitti) {
        return res.status(404).json({ error: "Chitti not found or tenant mismatch" });
      }

      // Calculate current active month based on exact cycle crossing (spawns only when start day of month is crossed)
      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const calculatedMonth = calculateChittiMonth(chitti.start_date, chitti.total_months, now);

      if (chitti.current_month !== calculatedMonth || chitti.last_checked_date !== currentYearMonth) {
        chitti.current_month = calculatedMonth;
        chitti.last_checked_date = currentYearMonth;
        await updateRecord("chittis", {
          chitti_id: chitti.chitti_id,
          current_month: calculatedMonth,
          last_checked_date: currentYearMonth,
        }).catch(() => {});
      }

      const t = chitti.current_month || calculatedMonth || 1;
      const N = Number(chitti.total_members) || 20;
      const U = Number(chitti.u_due) || 5000;
      const D = Number(chitti.d_due) || 6000;
      const F = Number(chitti.commission) || 2000;
      const formulaId = chitti.formula_id || "standard_chit_v1";

      // Read payout schedule directly from database record with zero runtime calculations
      let scheduleArr = [];
      try {
        scheduleArr = chitti.payout_schedule ? JSON.parse(chitti.payout_schedule) : [];
      } catch (e) {}

      let payout_t = 0;
      const currentScheduleItem = scheduleArr.find((s: any) => s.month === t);
      if (currentScheduleItem && currentScheduleItem.payout) {
        payout_t = currentScheduleItem.payout;
      }

      const chittiShares = (dbShares || []).filter((s: any) => String(s.chitti_id) === String(chitti_id));
      const chittiTxs = (dbTxs || []).filter((tx: any) => String(tx.chitti_id) === String(chitti_id));

      let liveCalculatedArrears = 0;

      // Member share details with automatic billing sync when month t advances
      const memberDetails = chittiShares.map((share: any) => {
        let expectedTotalBilled = 0;
        let expectedMonthlyDue = U;
        for (let m = 1; m <= t; m++) {
          const dueForM = calculateFormulaDue(m, share.win_month, U, D, N, F, formulaId);
          expectedTotalBilled += dueForM;
          if (m === t) expectedMonthlyDue = dueForM;
        }

        const shareTxs = chittiTxs.filter((tx: any) => String(tx.share_id) === String(share.share_id) && !tx.is_void);
        const totalPaid = shareTxs.reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
        const netBalance = totalPaid - expectedTotalBilled;
        const pendingAmount = netBalance < 0 ? Math.abs(netBalance) : 0;
        const advanceAmount = netBalance > 0 ? netBalance : 0;

        if (pendingAmount > 0) {
          liveCalculatedArrears += pendingAmount;
        }

        const isDrawn = share.win_month !== null && t > Number(share.win_month);
        const status =
          share.win_month !== null && Number(share.win_month) <= t ? `Drawn M${share.win_month}` : "Undrawn";

        // Auto-heal database record if total_billed or monthly_due_current is out of sync with active month t
        if (
          Number(share.total_billed) !== expectedTotalBilled ||
          Number(share.monthly_due_current) !== expectedMonthlyDue ||
          Number(share.net_balance) !== netBalance
        ) {
          share.total_billed = expectedTotalBilled;
          share.monthly_due_current = expectedMonthlyDue;
          share.total_paid = totalPaid;
          share.net_balance = netBalance;
          share.pending_amount = pendingAmount;
          share.advance_amount = advanceAmount;
          updateRecord("shares", {
            share_id: share.share_id,
            total_billed: expectedTotalBilled,
            monthly_due_current: expectedMonthlyDue,
            total_paid: totalPaid,
            net_balance: netBalance,
            pending_amount: pendingAmount,
            advance_amount: advanceAmount,
          }).catch((err) => console.error(`Error auto-syncing share ${share.share_id} bill:`, err));
        }

        return {
          ...share,
          status,
          monthly_due_current: expectedMonthlyDue,
          total_billed: expectedTotalBilled,
          total_paid: totalPaid,
          net_balance: netBalance,
          pending_amount: pendingAmount,
          advance_amount: advanceAmount,
          transactions: shareTxs,
        };
      });

      // Chitti Treasury & Arrears
      const totalArrears = liveCalculatedArrears;
      if (Number(chitti.total_arrears) !== liveCalculatedArrears) {
        chitti.total_arrears = liveCalculatedArrears;
        updateRecord("chittis", {
          chitti_id: chitti.chitti_id,
          total_arrears: liveCalculatedArrears,
        }).catch(() => {});
      }
      const cumulativeCommission = Number(chitti.cumulative_commission) || (t * F);
      const totalDisbursed = Number(chitti.total_disbursed) || 0;
      const totalCashCollected = Number(chitti.total_cash_collected) || 0;
      const netCashflow = Number(chitti.net_balance) || 0;

      res.json({
        chitti,
        active_month: t,
        payout_t: payout_t,
        total_pending_market: totalArrears,
        treasury: {
          total_arrears: totalArrears,
          cumulative_commission: cumulativeCommission,
          cumulative_disbursement: totalDisbursed,
          actual_cash_collected: totalCashCollected,
          net_cashflow: netCashflow,
          closing_ledger_balance: netCashflow,
          flat_commission: F,
          current_payout_t: payout_t,
          total_pending_in_market: totalArrears,
        },
        members: memberDetails,
      });
    } catch (err: any) {
      console.error("Error fetching live chitti details from NocoDB:", err);
      return res.status(503).json({
        error: "database_offline",
        message: "Database is currently offline or unreachable",
      });
    }
  });

  // Pure Stateless POST /api/transactions
  app.post("/api/transactions", async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const { share_id, chitti_id, tenant_id, amount, payment_mode } = req.body;
    if (!share_id || !chitti_id || amount === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const dbChittis = await getAllRecords("chittis");
      const chitti = (dbChittis || []).find((c: any) => String(c.chitti_id) === String(chitti_id));
      if (!chitti) {
        return res.status(404).json({ error: "Chitti not found" });
      }

      const effectiveTenantId = tenant_id || chitti.tenant_id;
      if (tenant_id && chitti.tenant_id && chitti.tenant_id.trim().toLowerCase() !== tenant_id.trim().toLowerCase()) {
        return res.status(403).json({ error: "Tenant isolation mismatch: Chitti belongs to another manager" });
      }

      const dbShares = await getAllRecords("shares");
      const share = (dbShares || []).find(
        (s: any) => String(s.share_id) === String(share_id) && String(s.chitti_id) === String(chitti_id)
      );
      if (!share) {
        return res.status(404).json({ error: `Share ${share_id} not found in Chitti ${chitti_id}` });
      }
      share.tenant_id = chitti.tenant_id || effectiveTenantId;

      if (idempotencyKey) {
        const cacheKey = `${effectiveTenantId}:${chitti_id}:${share_id}:${idempotencyKey}`;
        if (idempotencyCache.has(cacheKey)) {
          return res.json(idempotencyCache.get(cacheKey));
        }
      }

      const newTx: Transaction = {
        tx_id: "tx_" + Math.random().toString(36).substring(2, 9),
        share_id,
        chitti_id,
        tenant_id: chitti.tenant_id || effectiveTenantId,
        amount: Number(amount),
        date_paid: new Date().toISOString().split("T")[0],
        payment_mode: payment_mode || "UPI",
        is_void: false,
      };

      const syncRes: any = await insertRecord("transactions", newTx);
      if (!syncRes || syncRes.error) {
        return res.status(500).json({ success: false, error: "NocoDB database rejected transaction write", details: syncRes });
      }

      // Recompute and persist ledger directly in NocoDB with optimized single-share upsert
      const dbTxs = await getAllRecords("transactions");
      const chittiTxs = (dbTxs || []).filter((tx: any) => String(tx.chitti_id) === String(chitti_id));
      const shareLedger = await computeAndPersistShareLedgerStateless(share, chitti, chittiTxs);
      await recalculateAndPersistChittiSummary(chitti_id, share_id, shareLedger);

      if (idempotencyKey) {
        idempotencyCache.set(`${effectiveTenantId}:${chitti_id}:${share_id}:${idempotencyKey}`, newTx);
      }

      res.json({ success: true, transaction: newTx, verified: true });
    } catch (err) {
      console.error("Stateless transaction exception:", err);
      return res.status(500).json({ success: false, error: "Database error during transaction processing", details: String(err) });
    }
  });

  // Pure Stateless Transaction Voiding Endpoint
  app.post("/api/transactions/:tx_id/void", async (req, res) => {
    const { tx_id } = req.params;
    const tenant_id = req.body.tenant_id || req.query.tenant_id;

    try {
      const dbTxs = await getAllRecords("transactions");
      const tx = (dbTxs || []).find((t: any) => String(t.tx_id) === String(tx_id));
      if (!tx) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      if (tenant_id && String(tx.tenant_id).toLowerCase() !== String(tenant_id).toLowerCase()) {
        return res.status(403).json({ error: "Tenant mismatch unauthorized isolation violation" });
      }

      tx.is_void = true;
      await updateRecord("transactions", { tx_id: tx.tx_id, Id: tx.Id || tx.id, is_void: true });

      const dbChittis = await getAllRecords("chittis");
      const chitti = (dbChittis || []).find((c: any) => String(c.chitti_id) === String(tx.chitti_id));
      const dbShares = await getAllRecords("shares");
      const share = (dbShares || []).find(
        (s: any) => String(s.share_id) === String(tx.share_id) && String(s.chitti_id) === String(tx.chitti_id)
      );

      if (share && chitti) {
        const freshTxs = await getAllRecords("transactions");
        const chittiTxs = freshTxs.filter((t: any) => String(t.chitti_id) === String(tx.chitti_id));
        await computeAndPersistShareLedgerStateless(share, chitti, chittiTxs);
        await recalculateAndPersistChittiSummary(tx.chitti_id);
      }

      res.json({ success: true, tx });
    } catch (err) {
      console.error("Stateless transaction void exception:", err);
      res.status(500).json({ error: "Failed to void transaction in database" });
    }
  });

  // Pure Stateless PATCH /api/shares/:share_id
  app.patch("/api/shares/:share_id", async (req, res) => {
    const { share_id } = req.params;
    const { tenant_id, chitti_id, win_month, member_name, phone } = req.body;

    console.log("PATCH /api/shares/:share_id received:", { share_id, tenant_id, chitti_id, win_month, member_name, phone });

    if (!chitti_id) {
      return res.status(400).json({ error: "chitti_id is required for share update" });
    }

    try {
      // Find Chitti directly from NocoDB
      const dbChittis = await getAllRecords("chittis");
      const chitti = (dbChittis || []).find((c: any) => String(c.chitti_id) === String(chitti_id));
      if (!chitti) {
        return res.status(404).json({ error: "Chitti not found" });
      }

      const effectiveTenantId = tenant_id || chitti.tenant_id;
      if (tenant_id && chitti.tenant_id && chitti.tenant_id.trim().toLowerCase() !== tenant_id.trim().toLowerCase()) {
        return res.status(403).json({ error: "Tenant isolation mismatch: Chitti belongs to another manager" });
      }

      // Find Share directly from NocoDB with strict composite share_id + chitti_id matching
      const dbShares = await getAllRecords("shares");
      const share = (dbShares || []).find(
        (s: any) => String(s.share_id) === String(share_id) && String(s.chitti_id) === String(chitti_id)
      );
      if (!share) {
        console.error("Share not found for update in NocoDB:", { share_id, chitti_id, effectiveTenantId });
        return res.status(404).json({ error: `Share ${share_id} not found in Chitti ${chitti_id}` });
      }
      share.tenant_id = chitti.tenant_id || effectiveTenantId;

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

      // Recompute ledger and persist directly to NocoDB
      const dbTxs = await getAllRecords("transactions");
      const chittiTxs = (dbTxs || []).filter((tx: any) => String(tx.chitti_id) === String(chitti_id));
      await computeAndPersistShareLedgerStateless(share, chitti, chittiTxs);
      await recalculateAndPersistChittiSummary(chitti_id);

      const upsertRes = await upsertRecord("shares", "share_id", share.share_id, share);
      if (!upsertRes) {
        return res.status(500).json({ error: "Failed to persist member info to database" });
      }

      res.json({ success: true, share, verified: true });
    } catch (err) {
      console.error("Stateless share patch error:", err);
      return res.status(500).json({ error: "Database error during share update" });
    }
  });

  // Pure Stateless Chitti Expenses Endpoints
  app.get("/api/chittis/:chitti_id/expenses", async (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }

    try {
      const dbChittis = await getAllRecords("chittis");
      const chitti = (dbChittis || []).find((c: any) => String(c.chitti_id) === String(chitti_id));
      if (!chitti) {
        return res.status(404).json({ error: "Chitti not found" });
      }

      const dbExp = await getAllRecords("chittiExpenses");
      const list = (dbExp || []).filter((e: any) => String(e.chitti_id) === String(chitti_id));
      const total_credit = list.filter((e: any) => e.type === "credit").reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
      const total_debit = list.filter((e: any) => e.type === "debit").reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
      const net_expenses = total_credit - total_debit;

      res.json({ expenses: list, total_credit, total_debit, net_expenses });
    } catch (err) {
      console.error("Failed to fetch expenses from NocoDB:", err);
      res.status(500).json({ error: "Failed to fetch expenses" });
    }
  });

  app.post("/api/chittis/:chitti_id/expenses", async (req, res) => {
    const { chitti_id } = req.params;
    const { tenant_id, title, type, amount } = req.body;
    if (!tenant_id || !title || !type || amount === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const dbChittis = await getAllRecords("chittis");
      const chitti = (dbChittis || []).find((c: any) => String(c.chitti_id) === String(chitti_id));
      if (!chitti) {
        return res.status(404).json({ error: "Chitti not found" });
      }

      const newExp: ChittiExpense = {
        expense_id: "exp_" + Math.random().toString(36).substring(2, 9),
        chitti_id,
        tenant_id,
        title,
        type: type === "credit" ? "credit" : "debit",
        amount: Number(amount),
        date: new Date().toISOString().split("T")[0],
      };

      const syncRes: any = await insertRecord("chittiExpenses", newExp);
      if (!syncRes || syncRes.error) {
        return res.status(500).json({ success: false, error: "NocoDB database rejected expense write", details: syncRes });
      }

      res.json({ success: true, expense: newExp, verified: true });
    } catch (err) {
      console.error("NocoDB chittiExpense sync error:", err);
      return res.status(500).json({ success: false, error: "Database network error during expense insert", details: String(err) });
    }
  });

  app.delete("/api/chittis/expenses/:expense_id", async (req, res) => {
    const { expense_id } = req.params;

    try {
      await deleteRecord("chittiExpenses", "expense_id", expense_id);
      res.json({ success: true, expense_id });
    } catch (err) {
      console.error("NocoDB chittiExpense delete error:", err);
      res.status(500).json({ error: "Failed to delete expense" });
    }
  });

  // Pure Stateless Delete Chitti ID Endpoint
  app.delete("/api/chittis/:chitti_id", async (req, res) => {
    const { chitti_id } = req.params;
    const tenant_id = req.query.tenant_id as string;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }

    try {
      const dbChittis = await getAllRecords("chittis");
      const chitti = (dbChittis || []).find(
        (c: any) =>
          String(c.chitti_id) === String(chitti_id) &&
          String(c.tenant_id).toLowerCase() === String(tenant_id).toLowerCase()
      );
      if (!chitti) {
        return res.status(404).json({ error: "Chitti not found or tenant isolation mismatch" });
      }

      await deleteRecordsByChittiId(chitti_id);
      res.json({ success: true, chitti_id });
    } catch (err) {
      console.error("NocoDB chitti deletion error:", err);
      res.status(500).json({ error: "Failed to delete chitti from database" });
    }
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
    console.log(`Server running on http://localhost:${PORT} in Zero-Server-Cache mode`);
  });
}

startServer();
