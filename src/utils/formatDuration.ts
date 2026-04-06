/**
 * Format a duration between two timestamps as a human-readable string.
 * If endStr is omitted, uses the current time (for active/in-progress items).
 */
export function formatDuration(startStr: string, endStr?: string): string {
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return '-';
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const totalSec = Math.floor(diffMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
