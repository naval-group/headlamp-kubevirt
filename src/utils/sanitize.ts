/**
 * Security sanitization helpers for user-facing inputs.
 */

/**
 * Sanitize a feature gate search query.
 * Only allows alphanumeric characters and dashes.
 */
export function sanitizeFeatureGateSearch(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, '');
}

/**
 * Sanitize a value before interpolating into a PromQL label matcher.
 * Allowlist: only keep characters safe inside a label value string.
 * Label values are K8s names/namespaces, so alphanumeric + dot/dash/underscore/colon.
 */
export function sanitizePromQL(value: string): string {
  return value.replace(/[^a-zA-Z0-9._\-:]/g, '');
}

/**
 * Validate a Kubernetes resource name (RFC 1123 DNS subdomain).
 * Returns the name if valid, throws otherwise.
 */
export function assertK8sName(value: string, label = 'name'): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value) || value.length > 253) {
    throw new Error(`Invalid Kubernetes ${label}: ${value.slice(0, 64)}`);
  }
  return value;
}

/**
 * Validate a Kubernetes resource name, returning true/false.
 */
export function isValidK8sName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(value) && value.length <= 253;
}

/**
 * Validate a Kubernetes label value (RFC 1123).
 * Must be ≤63 chars, start/end with alphanumeric, middle can include [-_.].
 * Empty string is valid per K8s spec.
 */
export function isValidK8sLabelValue(value: string): boolean {
  if (value === '') return true;
  return /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/.test(value);
}

/**
 * Validate a PCI vendor selector (e.g., "10DE:1DB6").
 * Format: 4 hex digits, colon, 4 hex digits.
 */
export function isValidPciSelector(value: string): boolean {
  return /^[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}$/.test(value);
}

/**
 * Validate a Kubernetes extended resource name (e.g., "nvidia.com/GP102GL").
 * Format: optional DNS domain prefix + "/" + name segment.
 */
export function isValidResourceName(value: string): boolean {
  return /^([a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?\/)?[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/.test(
    value
  );
}

/**
 * Validate a Kubernetes label key (e.g., "app.kubernetes.io/name").
 * Format: optional DNS prefix + "/" + name, name ≤63 chars.
 */
export function isValidK8sLabelKey(value: string): boolean {
  return /^([a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?\/)?[a-zA-Z]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/.test(
    value
  );
}

/**
 * Validate a display column name — safe printable characters only.
 * Allows letters, digits, spaces, dashes, underscores. Max 64 chars.
 */
export function isValidColumnName(value: string): boolean {
  return /^[a-zA-Z0-9 _-]{1,64}$/.test(value);
}

/**
 * Validate a mediated device name selector (e.g., "GRID T4-2A").
 * Allows alphanumeric, spaces, dashes, underscores, dots. Max 128 chars.
 */
export function isValidMdevSelector(value: string): boolean {
  return /^[a-zA-Z0-9 ._-]{1,128}$/.test(value);
}

/**
 * Extract a safe, user-friendly message from an error.
 * Logs the full error to console, returns a short summary for the UI.
 */
export function safeError(e: unknown, context: string): string {
  console.error(`[${context}]`, e);
  const msg = e instanceof Error ? e.message || '' : typeof e === 'string' ? e : '';
  if (!msg) return 'An unexpected error occurred';
  // Strip API paths, stack traces, and verbose details
  if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) return 'Permission denied';
  if (msg.includes('404') || msg.toLowerCase().includes('not found')) return 'Resource not found';
  if (msg.includes('409') || msg.toLowerCase().includes('conflict')) return 'Resource conflict';
  if (msg.includes('422') || msg.toLowerCase().includes('unprocessable')) {
    // Extract webhook name or reason if present
    const webhookMatch = msg.match(/admission webhook [""*]*(\S+)/i);
    if (webhookMatch) return `Rejected by webhook: ${webhookMatch[1].replace(/[""*]/g, '')}`;
    return 'Request rejected by validation';
  }
  if (msg.includes('500') || msg.toLowerCase().includes('internal')) return 'Server error';
  // Return first sentence only, capped at 120 chars
  const first = msg.split(/[.\n]/)[0].trim();
  return first.length > 120 ? first.slice(0, 117) + '...' : first;
}
