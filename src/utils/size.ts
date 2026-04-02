/** Convert Kubernetes size strings (10Gi, 5368709120) to human-readable */
export function humanSize(raw?: string): string {
  if (!raw) return '?';
  // Already has a unit suffix (e.g. "10Gi", "5G", "500Mi")
  if (/[a-zA-Z]/.test(raw)) return raw;
  // Pure number — bytes
  const bytes = parseInt(raw, 10);
  if (isNaN(bytes)) return raw;
  const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
  let value = bytes;
  for (const unit of units) {
    if (value < 1024) return `${Math.round(value * 10) / 10}${unit}`;
    value /= 1024;
  }
  return `${Math.round(value * 10) / 10}Pi`;
}
