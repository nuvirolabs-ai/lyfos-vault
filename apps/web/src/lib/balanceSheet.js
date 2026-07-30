function totalsFor(accounts, values = {}) {
  return accounts.reduce((totals, account) => {
    const value = Number(values[account.id]) || 0;
    if (account.kind === "liability") totals.liabilities += value;
    else totals.assets += value;
    return totals;
  }, { assets: 0, liabilities: 0 });
}

export function getBalanceSheetSummary(balanceSheet = {}) {
  const accounts = Array.isArray(balanceSheet.accounts) ? balanceSheet.accounts : [];
  const snapshots = [...(balanceSheet.snapshots ?? [])].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const current = snapshots.at(-1);
  const previous = snapshots.at(-2);
  const currentTotals = totalsFor(accounts, current?.values);
  const previousTotals = previous ? totalsFor(accounts, previous.values) : null;
  const netWorth = currentTotals.assets - currentTotals.liabilities;
  let direction = "neutral";
  if (netWorth < 0) direction = "watch";
  else if (previousTotals) {
    const netImproved = netWorth >= (previousTotals.assets - previousTotals.liabilities);
    const liabilitiesStable = currentTotals.liabilities <= previousTotals.liabilities;
    direction = netImproved && liabilitiesStable ? "positive" : "watch";
  }
  return {
    assets: currentTotals.assets,
    liabilities: currentTotals.liabilities,
    netWorth,
    direction,
    accountCount: accounts.length,
    hasHistory: Boolean(current)
  };
}
