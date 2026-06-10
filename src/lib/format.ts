function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

export function formatCompactCN(n: number): string {
  if (n >= 1e8) return `${trim(n / 1e8)}亿`;
  if (n >= 1e4) {
    // trim rounds to 1 decimal, which can carry up to "10000" (= 1亿) at the band edge.
    const s = trim(n / 1e4);
    return s === "10000" ? "1亿" : `${s}万`;
  }
  return n.toLocaleString("en-US");
}
