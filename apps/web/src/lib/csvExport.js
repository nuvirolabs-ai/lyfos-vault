// Balance-sheet CSV export. Produces one row per monthly snapshot,
// one column per account. Header row labels each column with the
// account name + "(asset)" or "(liability)" so the file is readable
// without further context.
//
// Cleared on every export: removed accounts (no longer in vault.accounts)
// still get included if any snapshot ever held a value for them, so the
// history isn't silently truncated.

export function buildSnapshotsCsv(balanceSheet) {
  const accounts = balanceSheet?.accounts ?? [];
  const snapshots = [...(balanceSheet?.snapshots ?? [])].sort((a, b) => a.month.localeCompare(b.month));

  // Discover every account_id that ever held a value, even if no longer
  // in `accounts` (renamed/removed in v1, we still want full history).
  const knownIds = new Set(accounts.map((a) => a.id));
  for (const s of snapshots) {
    for (const id of Object.keys(s.values ?? {})) knownIds.add(id);
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const orderedIds = Array.from(knownIds);

  // Header — escape the whole column label so commas / quotes in the
  // account name don't break the column count.
  const header = ["month"];
  for (const id of orderedIds) {
    const a = accountById.get(id);
    const label = a ? `${a.name} (${a.kind})` : `${id} (removed)`;
    header.push(escapeCsv(label));
  }
  header.push("assets_total", "liabilities_total", "net_worth");

  const rows = [header.join(",")];
  for (const snap of snapshots) {
    const row = [snap.month];
    let assets = 0, liabilities = 0;
    for (const id of orderedIds) {
      const v = Number(snap.values?.[id] ?? 0) || 0;
      row.push(v === 0 ? "" : String(v));
      const a = accountById.get(id);
      if (a) {
        if (a.kind === "liability") liabilities += v;
        else assets += v;
      } else {
        // Removed account — count as asset by default (historical data).
        assets += v;
      }
    }
    row.push(String(assets), String(liabilities), String(assets - liabilities));
    rows.push(row.join(","));
  }

  return rows.join("\n") + "\n";
}

function escapeCsv(s) {
  if (s == null) return "";
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function suggestedCsvFilename() {
  const now = new Date().toISOString().slice(0, 10);
  return `lyfos-balance-sheet-${now}.csv`;
}
