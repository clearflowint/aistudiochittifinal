import fetch from "node-fetch";

const NOCODB_URL = "https://nocodbclearflow.duckdns.org";
const NOCODB_TOKEN = process.env.NOCODB_TOKEN || "nc_pat_OTvgsxsMrDRDZUAodsvzofhmo3sEXItrjhNEKEYj";
const BASE_ID = process.env.NOCODB_BASE_ID || "p4277q2gv93p704";

const headers = {
  "xc-token": NOCODB_TOKEN,
  "Content-Type": "application/json",
};

export async function checkNocoDBConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${NOCODB_URL}/api/v1/db/meta/projects/${BASE_ID}/tables`, { headers });
    const data = await res.json() as any;
    return !!data && Array.isArray(data.list);
  } catch (err) {
    console.error("NocoDB connection check failed:", err);
    return false;
  }
}

export async function getNocoDBTables() {
  try {
    const res = await fetch(`${NOCODB_URL}/api/v1/db/meta/projects/${BASE_ID}/tables`, { headers });
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

const tableIdCache = new Map<string, string>();

export async function getTableId(tableName: string): Promise<string | null> {
  if (tableIdCache.has(tableName)) {
    return tableIdCache.get(tableName)!;
  }
  await getNocoDBTables();
  if (tableIdCache.has(tableName)) {
    return tableIdCache.get(tableName)!;
  }
  return tableName; // Fallback
}

export async function insertRecord(tableName: string, record: any) {
  try {
    const tableId = await getTableId(tableName);
    const target = tableId || tableName;
    const res = await fetch(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}`, {
      method: "POST",
      headers,
      body: JSON.stringify(record),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`Error inserting record into NocoDB table ${tableName}:`, err);
    return null;
  }
}

export async function updateRecord(tableName: string, record: any) {
  try {
    const tableId = await getTableId(tableName);
    const target = tableId || tableName;
    // NocoDB update expects PATCH with record containing Id or primary key
    const res = await fetch(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(record),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`Error updating record in NocoDB table ${tableName}:`, err);
    return null;
  }
}

export async function deleteRecordsByChittiId(chittiId: string) {
  const tablesToCheck = ["chittis", "shares", "transactions", "chittiExpenses"];
  for (const tableName of tablesToCheck) {
    try {
      const tableId = await getTableId(tableName);
      const target = tableId || tableName;
      const res = await fetch(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}?where=(chitti_id,eq,${chittiId})`, { headers });
      const data = await res.json() as any;
      const records = data.list || [];
      for (const rec of records) {
        if (rec.Id) {
          await fetch(`${NOCODB_URL}/api/v1/db/data/v1/${BASE_ID}/${target}`, {
            method: "DELETE",
            headers,
            body: JSON.stringify({ Id: rec.Id }),
          });
        }
      }
    } catch (err) {
      console.error(`Error deleting NocoDB records for chitti ${chittiId} in table ${tableName}:`, err);
    }
  }
}

export async function ensureTableExists(tableName: string, columns: any[]) {

  try {
    const tables = await getNocoDBTables();
    let existing = tables.find((t: any) => t.table_name === tableName || t.title === tableName || t.table_name === `nc_m3mp___${tableName}` || t.table_name === `nc_${tableName}`);
    
    if (!existing) {
      console.log(`Creating table ${tableName} in NocoDB base ${BASE_ID}...`);
      const res = await fetch(`${NOCODB_URL}/api/v1/db/meta/projects/${BASE_ID}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          table_name: tableName,
          columns: columns,
        }),
      });
      const result = await res.json();
      console.log(`Table ${tableName} creation result:`, result);
      existing = result;
    } else {
      console.log(`Table ${tableName} exists. Ensuring all columns are present...`);
    }

    if (existing && existing.id) {
      tableIdCache.set(tableName, existing.id);
      if (existing.table_name) tableIdCache.set(existing.table_name, existing.id);
      const colRes = await fetch(`${NOCODB_URL}/api/v1/db/meta/tables/${existing.id}/columns`, { headers });
      const colData = await colRes.json() as any;
      const existingCols = colData.list || [];
      const existingColNames = new Set(existingCols.map((c: any) => c.column_name));

      for (const col of columns) {
        if (!existingColNames.has(col.column_name)) {
          console.log(`Adding missing column '${col.column_name}' (${col.uidt}) to table '${tableName}'...`);
          try {
            const addRes = await fetch(`${NOCODB_URL}/api/v1/db/meta/tables/${existing.id}/columns`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                column_name: col.column_name,
                uidt: col.uidt,
              }),
            });
            const addResult = await addRes.json();
            console.log(`Added column ${col.column_name} result:`, addResult);
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
  console.log("Initializing NocoDB tables and schema for base:", BASE_ID);

  await ensureTableExists("tenants", [
    { column_name: "tenant_id", uidt: "SingleLineText" },
    { column_name: "name", uidt: "SingleLineText" }
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
    { column_name: "payout_schedule", uidt: "LongText" }
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
    { column_name: "advance_amount", uidt: "Number" }
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

  console.log("NocoDB table initialization completed successfully.");
}
