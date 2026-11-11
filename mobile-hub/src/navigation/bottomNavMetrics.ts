/** Keep the floating bar and screen clearance on the same font-scale contract. */
export function bottomNavMetrics(fontScale: number) {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const lines = scale > 1.2 ? 2 : 1;
  const rowHeight = Math.max(66, 34 + 2 + Math.ceil(14 * scale) * lines + 12);
  return { lines, rowHeight, contentHeight: rowHeight + 6 };
}
