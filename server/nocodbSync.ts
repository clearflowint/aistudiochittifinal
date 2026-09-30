const NOCODB_URL = process.env.NOCODB_URL || "https://nocodbclearflow.duckdns.org";
const NOCODB_TOKEN = process.env.NOCODB_TOKEN || "nc_pat_UNZlmQBfV7PlVv3aNm75bo1gW67aVvd2lC6Xv1VR";
const BASE_ID = process.env.NOCODB_BASE_ID || "71164a52-14f4-4eae-b1b0-2dff495e3e09";

const headers = {
  "xc-token": NOCODB_TOKEN,
  "Content-Type": "application/json",
};

const tableColumnsMap: Record<string, string[]> = {
  tenants: ["tenant_id", "name", "status", "Id", "id"],
  mathTemplates: ["formula_id", "name", "description", "Id", "id"],
  chittis: ["chitti_id", "tenant_id", "formula_id", "name", "start_date", "total_members", "total_months", "u_due", "d_due", "commission", "current_month", "last_checked_date", "payout_schedule", "total_arrears", "cumulative_commission", "total_disbursed", "total_cash_collected", "net_balance", "Id", "id"],
  shares: ["share_id", "chitti_id", "tenant_id", "member_name", "phone", "win_month", "total_paid", "total_billed", "net_balance", "pending_amount", "advance_amount", "monthly_due_current", "Id", "id"],
  transactions: ["tx_id", "share_id", "chitti_id", "tenant_id", "amount", "date_paid", "payment_mode", "is_void", "Id", "id"],
  chittiExpenses: ["expense_id", "chitti_id", "tenant_id", "title", "type", "amount", "date", "Id", "id"]
};

function cleanRecord(tableName: string, record: any) {
  const allowed = tableColumnsMap[tableName];
  if (!allowed) return record;
  const cleaned: any = {};
  for (const key of allowed) {
    if (record[key] !== undefined) {
      cleaned[key] = record[key];
    }
  }
  return cleaned;
}

export async function checkNocoDBConnection(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/meta/projects/${BASE_ID}/tables`, { headers }, 4000);
    if (!res.ok) return false;
    const data = await res.json() as any;
    return !!data && Array.isArray(data.list);
  } catch (err) {
    console.error("NocoDB connection check failed:", err);
    return false;
  }
}

// Verified NocoDB Table IDs with environment variable overrides
export const DEFAULT_TABLE_IDS: Record<string, string> = {
  chittis: process.env.NOCODB_TABLE_CHITTIS || "mtmdpck1f4w2adx",
  shares: process.env.NOCODB_TABLE_SHARES || "m46pk64wr8nzeyg",
  transactions: process.env.NOCODB_TABLE_TRANSACTIONS || "m8hhgaoq4esfbkr",
  chittiExpenses: process.env.NOCODB_TABLE_EXPENSES || "m6qj4g8mwrpsls9",
  tenants: process.env.NOCODB_TABLE_TENANTS || "m4ctl4al3q2pbm2",
  mathTemplates: process.env.NOCODB_TABLE_TEMPLATES || "mm17ll57nphw70c",
};

const tableIdCache = new Map<string, string>(Object.entries(DEFAULT_TABLE_IDS));

export async function getNocoDBTables() {
  try {
    const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/meta/projects/${BASE_ID}/tables`, { headers });
    const data = await res.json() as any;
    const tables = data.list || [];
    for (const t of tables) {
      if (t.table_name) {
        tableIdCache.set(t.table_name, t.id);
        const cleanName = t.table_name.replace(/^nc_[^_]*___/, "");
        tableIdCache.set(cleanName, t.id);
      }
      if (t.title) {
        tableIdCache.set(t.title, t.id);
      }
    }
    return tables;
  } catch (err) {
    console.error("Error fetching NocoDB tables:", err);
    return [];
  }
}

async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export async function getTableId(tableName: string): Promise<string> {
  if (tableIdCache.has(tableName)) {
    return tableIdCache.get(tableName)!;
  }
  if (DEFAULT_TABLE_IDS[tableName]) {
    return DEFAULT_TABLE_IDS[tableName];
  }
  await getNocoDBTables();
  if (tableIdCache.has(tableName)) {
    return tableIdCache.get(tableName)!;
  }
  return DEFAULT_TABLE_IDS[tableName] || tableName;
}

function normalizeRecord(tableName: string, r: any) {
  if (!r) return r;
  const getProp = (...names: string[]) => {
    for (const n of names) {
      if (r[n] !== undefined && r[n] !== null) return r[n];
      const foundKey = Object.keys(r).find(k => k.toLowerCase() === n.toLowerCase());
      if (foundKey && r[foundKey] !== undefined && r[foundKey] !== null) return r[foundKey];
    }
    return undefined;
  };

  if (tableName === "tenants") {
    const tenant_id = getProp("tenant_id", "tenantId", "email", "id");
    const name = getProp("name", "fullName") || tenant_id;
    const status = getProp("status") || "active";
    return { ...r, tenant_id, name, status };
  }
  if (tableName === "chittis") {
    const chitti_id = getProp("chitti_id", "chittiId", "id");
    const tenant_id = getProp("tenant_id", "tenantId");
    const formula_id = getProp("formula_id", "formulaId") || "standard_chit_v1";
    const name = getProp("name", "chittiname", "title") || "Chitti Group";
    const start_date = getProp("start_date", "startDate") || "2025-01-01";
    const total_members = Number(getProp("total_members", "totalMembers")) || 20;
    const total_months = Number(getProp("total_months", "totalMonths")) || 20;
    const u_due = Number(getProp("u_due", "uDue")) || 5000;
    const d_due = Number(getProp("d_due", "dDue")) || 6000;
    const commission = Number(getProp("commission")) || 2000;
    const current_month = Number(getProp("current_month", "currentMonth")) || 1;
    const payout_schedule = getProp("payout_schedule", "payoutSchedule");
    const last_checked_date = getProp("last_checked_date", "lastCheckedDate");
    const total_arrears = Number(getProp("total_arrears", "totalArrears")) || 0;
    const cumulative_commission = Number(getProp("cumulative_commission", "cumulativeCommission")) || 0;
    const total_disbursed = Number(getProp("total_disbursed", "totalDisbursed")) || 0;
    const total_cash_collected = Number(getProp("total_cash_collected", "totalCashCollected")) || 0;
    const net_balance = Number(getProp("net_balance", "netBalance")) || 0;
    return { ...r, chitti_id, tenant_id, formula_id, name, start_date, total_members, total_months, u_due, d_due, commission, current_month, payout_schedule, last_checked_date, total_arrears, cumulative_commission, total_disbursed, total_cash_collected, net_balance };
  }
  if (tableName === "shares") {
    const share_id = getProp("share_id", "shareId", "id");
    const chitti_id = getProp("chitti_id", "chittiId");
    const tenant_id = getProp("tenant_id", "tenantId");
    const member_name = getProp("member_name", "memberName", "name") || "Member";
    const phone = getProp("phone") || "";
    const win_month = getProp("win_month", "winMonth");
    const total_paid = Number(getProp("total_paid", "totalPaid")) || 0;
    const total_billed = Number(getProp("total_billed", "totalBilled")) || 0;
    const net_balance = Number(getProp("net_balance", "netBalance")) || 0;
    const pending_amount = Number(getProp("pending_amount", "pendingAmount")) || 0;
    const advance_amount = Number(getProp("advance_amount", "advanceAmount")) || 0;
    const monthly_due_current = Number(getProp("monthly_due_current", "monthlyDueCurrent")) || 0;
    return { ...r, share_id, chitti_id, tenant_id, member_name, phone, win_month: win_month !== undefined && win_month !== "" && win_month !== null ? Number(win_month) : null, total_paid, total_billed, net_balance, pending_amount, advance_amount, monthly_due_current };
  }
  if (tableName === "transactions") {
    const tx_id = getProp("tx_id", "txId", "id");
    const share_id = getProp("share_id", "shareId");
    const chitti_id = getProp("chitti_id", "chittiId");
    const tenant_id = getProp("tenant_id", "tenantId");
    const amount = Number(getProp("amount")) || 0;
    const date_paid = getProp("date_paid", "datePaid") || new Date().toISOString().split("T")[0];
    const payment_mode = getProp("payment_mode", "paymentMode") || "UPI";
    const is_void = getProp("is_void", "isVoid");
    return { ...r, tx_id, share_id, chitti_id, tenant_id, amount, date_paid, payment_mode, is_void };
  }
  if (tableName === "chittiExpenses") {
    const expense_id = getProp("expense_id", "expenseId", "id");
    const chitti_id = getProp("chitti_id", "chittiId");
    const tenant_id = getProp("tenant_id", "tenantId");
    const title = getProp("title") || "Expense";
    const type = getProp("type") || "debit";
    const amount = Number(getProp("amount")) || 0;
    const date = getProp("date") || new Date().toISOString().split("T")[0];
    return { ...r, expense_id, chitti_id, tenant_id, title, type, amount, date };
  }
  return r;
}

export async function getAllRecords(tableName: string) {
  try {
    const tableId = await getTableId(tableName);
    const target = tableId || tableName;
    const url = `${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}?limit=1000`;
    console.log(`[NocoDB FETCH] GET ${url}`);
    const res = await fetchWithTimeout(url, { headers }, 8000);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`NocoDB ${tableName} fetch failed (${res.status}) [url: ${url}]:`, errText);
      const dbErr: any = new Error(`NocoDB ${tableName} fetch failed (${res.status})`);
      dbErr.status = res.status;
      dbErr.isDbOffline = true;
      throw dbErr;
    }
    const data = await res.json() as any;
    const list = data.list || [];
    console.log(`[NocoDB FETCH SUCCESS] ${tableName}: retrieved ${list.length} records`);
    return list.map((r: any) => normalizeRecord(tableName, r));
  } catch (err: any) {
    console.error(`Error fetching records from ${tableName}:`, err);
    throw err;
  }
}

export async function insertRecord(tableName: string, record: any) {
  try {
    const tableId = await getTableId(tableName);
    const target = tableId || tableName;
    const cleaned = cleanRecord(tableName, record);
    delete cleaned.Id;
    delete cleaned.id;
    const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}`, {
      method: "POST",
      headers,
      body: JSON.stringify(cleaned),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Error inserting into NocoDB ${tableName} (${res.status}):`, errText);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`Error inserting record into NocoDB table ${tableName}:`, err);
    return null;
  }
}

export async function insertBulkRecords(tableName: string, records: any[]) {
  if (!records || records.length === 0) return [];
  try {
    const tableId = await getTableId(tableName);
    const target = tableId || tableName;
    const cleaned = records.map(r => {
      const c = cleanRecord(tableName, r);
      delete c.Id;
      delete c.id;
      return c;
    });
    const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/bulk/v1/${BASE_ID}/${target}`, {
      method: "POST",
      headers,
      body: JSON.stringify(cleaned),
    }, 15000);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Error bulk inserting into NocoDB ${tableName} (${res.status}):`, errText);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`Error bulk inserting into NocoDB table ${tableName}:`, err);
    return null;
  }
}

export async function upsertRecord(tableName: string, uniqueField: string, uniqueValue: any, record: any) {
  try {
    const tableId = await getTableId(tableName);
    const target = tableId || tableName;
    const cleaned = cleanRecord(tableName, record);

    let rowId = record.Id || record.id || record.ID || cleaned.Id || cleaned.id;

    if (!rowId) {
      const allRecs = await getAllRecords(tableName);
      const found = allRecs.find((r: any) => {
        if (tableName === "shares" && record.chitti_id) {
          return String(r[uniqueField]) === String(uniqueValue) && String(r.chitti_id) === String(record.chitti_id);
        }
        return String(r[uniqueField]) === String(uniqueValue);
      });
      if (found) {
        rowId = found.Id || found.id || found.ID || found.row_id;
        record.Id = rowId;
        record.id = rowId;
      }
    }

    if (rowId) {
      delete cleaned.Id;
      delete cleaned.id;
      delete cleaned.ID;

      const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}/${rowId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(cleaned),
      });
      const data = (await res.json()) as any;
      console.log(`NocoDB PATCH ${tableName} (rowId=${rowId}) result:`, data);
      if (data && !data.error && data.msg !== 'Cannot PATCH ...') {
        record.Id = rowId;
        record.id = rowId;
        return data;
      }
    }

    const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}`, {
      method: "POST",
      headers,
      body: JSON.stringify(cleaned),
    });
    const data = (await res.json()) as any;
    console.log(`NocoDB POST ${tableName} (${uniqueField}=${uniqueValue}) result:`, data);
    if (data && (data.Id || data.id)) {
      record.Id = data.Id || data.id;
      record.id = data.id || data.Id;
    }
    return data;
  } catch (err) {
    console.error(`Error upserting record in NocoDB table ${tableName}:`, err);
    return null;
  }
}

export async function updateRecord(tableName: string, record: any) {
  try {
    const tableId = await getTableId(tableName);
    const target = tableId || tableName;
    const cleaned = cleanRecord(tableName, record);
    const rowId = cleaned.Id || cleaned.id || record.Id || record.id;
    if (rowId) {
      delete cleaned.Id;
      delete cleaned.id;
      const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}/${rowId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(cleaned),
      });
      const data = await res.json();
      return data;
    }
    const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(cleaned),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`Error updating record in NocoDB table ${tableName}:`, err);
    return null;
  }
}

export async function deleteRecordsByChittiId(chittiId: string) {
  const tablesToCheck = ["transactions", "chittiExpenses", "shares", "chittis"];
  for (const tableName of tablesToCheck) {
    try {
      const records = await getAllRecords(tableName);
      const matching = records.filter((rec: any) => String(rec.chitti_id) === String(chittiId));
      if (matching.length === 0) continue;

      const tableId = await getTableId(tableName);
      const target = tableId || tableName;

      const idsToDelete: any[] = [];
      for (const rec of matching) {
        const rowId = rec.Id || rec.id || rec.ID || rec.row_id;
        if (rowId !== undefined && rowId !== null) {
          idsToDelete.push(rowId);
        }
      }

      if (idsToDelete.length > 0) {
        // Attempt NocoDB bulk delete first
        let bulkSuccess = false;
        try {
          const bulkPayload = idsToDelete.map((id) => ({ Id: id, id }));
          const bulkRes = await fetchWithTimeout(
            `${NOCODB_URL}/api/v1/db/data/bulk/v1/${BASE_ID}/${target}`,
            {
              method: "DELETE",
              headers,
              body: JSON.stringify(bulkPayload),
            },
            10000
          );
          if (bulkRes.ok) {
            console.log(`[NocoDB Bulk DELETE] Removed ${idsToDelete.length} records from ${tableName} for chitti ${chittiId}`);
            bulkSuccess = true;
          }
        } catch (e) {
          console.warn(`Bulk delete failed for ${tableName}, falling back to parallel individual deletes:`, e);
        }

        // Parallel fallback using Promise.all
        if (!bulkSuccess) {
          await Promise.all(
            idsToDelete.map(async (rowId) => {
              try {
                await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}/${rowId}`, {
                  method: "DELETE",
                  headers,
                });
              } catch (e) {
                try {
                  await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}`, {
                    method: "DELETE",
                    headers,
                    body: JSON.stringify({ Id: rowId, id: rowId }),
                  });
                } catch (err2) {}
              }
            })
          );
          console.log(`[NocoDB Parallel DELETE] Removed ${idsToDelete.length} records from ${tableName} for chitti ${chittiId}`);
        }
      }
    } catch (err) {
      console.error(`Error deleting NocoDB records for chitti ${chittiId} in table ${tableName}:`, err);
    }
  }
}

export async function deleteRecord(tableName: string, uniqueField: string, uniqueValue: any) {
  try {
    const records = await getAllRecords(tableName);
    const rec = records.find((r: any) => String(r[uniqueField]) === String(uniqueValue));
    if (rec) {
      const resolvedId = rec.Id || rec.id || rec.ID || rec.row_id;
      if (resolvedId) {
        const tableId = await getTableId(tableName);
        const target = tableId || tableName;
        await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}/${resolvedId}`, {
          method: "DELETE",
          headers,
        });
      }
    }
  } catch (err) {
    console.error(`Error deleting record from ${tableName}:`, err);
  }
}

export async function ensureTableExists(tableName: string, columns: any[]) {
  try {
    const tables = await getNocoDBTables();
    let existing = tables.find((t: any) => t.table_name === tableName || t.title === tableName || t.table_name === `nc_m3mp___${tableName}` || t.table_name === `nc_${tableName}`);
    
    if (!existing) {
      console.log(`Creating table ${tableName} in NocoDB base ${BASE_ID}...`);
      const res = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/meta/projects/${BASE_ID}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          table_name: tableName,
          columns: columns,
        }),
      });
      const result = await res.json();
      existing = result;
    } else {
      console.log(`Table ${tableName} exists.`);
    }

    if (existing && existing.id) {
      tableIdCache.set(tableName, existing.id);
      if (existing.table_name) tableIdCache.set(existing.table_name, existing.id);
      const colRes = await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/meta/tables/${existing.id}/columns`, { headers });
      const colData = await colRes.json() as any;
      const existingCols = colData.list || [];
      const existingColNames = new Set(existingCols.map((c: any) => c.column_name));

      for (const col of columns) {
        if (!existingColNames.has(col.column_name)) {
          console.log(`Adding missing column '${col.column_name}' to table '${tableName}'...`);
          try {
            await fetchWithTimeout(`${NOCODB_URL}/api/v1/db/meta/tables/${existing.id}/columns`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                column_name: col.column_name,
                uidt: col.uidt,
              }),
            });
          } catch (colErr) {
            console.error(`Failed to add column ${col.column_name}:`, colErr);
          }
        }
      }
    }

    return existing;
  } catch (err) {
    console.error(`Error ensuring table ${tableName} exists:`, err);
    return null;
  }
}

export async function initializeNocoDBTables() {
  await ensureTableExists("tenants", [
    { column_name: "tenant_id", uidt: "SingleLineText" },
    { column_name: "name", uidt: "SingleLineText" },
    { column_name: "status", uidt: "SingleLineText" }
  ]);

  await ensureTableExists("mathTemplates", [
    { column_name: "formula_id", uidt: "SingleLineText" },
    { column_name: "name", uidt: "SingleLineText" },
    { column_name: "description", uidt: "LongText" }
  ]);

  await ensureTableExists("chittis", [
    { column_name: "chitti_id", uidt: "SingleLineText" },
    { column_name: "tenant_id", uidt: "SingleLineText" },
    { column_name: "formula_id", uidt: "SingleLineText" },
    { column_name: "name", uidt: "SingleLineText" },
    { column_name: "start_date", uidt: "SingleLineText" },
    { column_name: "total_members", uidt: "Number" },
    { column_name: "total_months", uidt: "Number" },
    { column_name: "u_due", uidt: "Number" },
    { column_name: "d_due", uidt: "Number" },
    { column_name: "commission", uidt: "Number" },
    { column_name: "current_month", uidt: "Number" },
    { column_name: "last_checked_date", uidt: "SingleLineText" },
    { column_name: "payout_schedule", uidt: "LongText" },
    { column_name: "total_arrears", uidt: "Number" },
    { column_name: "cumulative_commission", uidt: "Number" },
    { column_name: "total_disbursed", uidt: "Number" },
    { column_name: "total_cash_collected", uidt: "Number" },
    { column_name: "net_balance", uidt: "Number" }
  ]);

  await ensureTableExists("shares", [
    { column_name: "share_id", uidt: "SingleLineText" },
    { column_name: "chitti_id", uidt: "SingleLineText" },
    { column_name: "tenant_id", uidt: "SingleLineText" },
    { column_name: "member_name", uidt: "SingleLineText" },
    { column_name: "phone", uidt: "SingleLineText" },
    { column_name: "win_month", uidt: "Number" },
    { column_name: "total_paid", uidt: "Number" },
    { column_name: "total_billed", uidt: "Number" },
    { column_name: "net_balance", uidt: "Number" },
    { column_name: "pending_amount", uidt: "Number" },
    { column_name: "advance_amount", uidt: "Number" },
    { column_name: "monthly_due_current", uidt: "Number" }
  ]);

  await ensureTableExists("transactions", [
    { column_name: "tx_id", uidt: "SingleLineText" },
    { column_name: "share_id", uidt: "SingleLineText" },
    { column_name: "chitti_id", uidt: "SingleLineText" },
    { column_name: "tenant_id", uidt: "SingleLineText" },
    { column_name: "amount", uidt: "Number" },
    { column_name: "date_paid", uidt: "SingleLineText" },
    { column_name: "payment_mode", uidt: "SingleLineText" },
    { column_name: "is_void", uidt: "Checkbox" }
  ]);

  await ensureTableExists("chittiExpenses", [
    { column_name: "expense_id", uidt: "SingleLineText" },
    { column_name: "chitti_id", uidt: "SingleLineText" },
    { column_name: "tenant_id", uidt: "SingleLineText" },
    { column_name: "title", uidt: "SingleLineText" },
    { column_name: "type", uidt: "SingleLineText" },
    { column_name: "amount", uidt: "Number" },
    { column_name: "date", uidt: "SingleLineText" },
  ]);
}
