/**
 * Security sanitization helpers for user-facing inputs.
 */

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
 * Extract a safe, user-friendly message from an error.
 * Logs the full error to console, returns a short summary for the UI.
 */
export function safeError(e: unknown, context: string): string {
  console.error(`[${context}]`, e);
  if (e instanceof Error) {
    const msg = e.message || '';
    // Strip API paths, stack traces, and verbose details
    if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) return 'Permission denied';
    if (msg.includes('404') || msg.toLowerCase().includes('not found')) return 'Resource not found';
    if (msg.includes('409') || msg.toLowerCase().includes('conflict')) return 'Resource conflict';
    if (msg.includes('422')) return 'Invalid resource';
    if (msg.includes('500') || msg.toLowerCase().includes('internal')) return 'Server error';
    // Return first sentence only, capped at 120 chars
    const first = msg.split(/[.\n]/)[0].trim();
    return first.length > 120 ? first.slice(0, 117) + '...' : first;
  }
  return 'An unexpected error occurred';
}
