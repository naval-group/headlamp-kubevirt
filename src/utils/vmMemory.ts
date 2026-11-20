/**
 * Guest memory helpers.
 *
 * KubeVirt sizes the guest from `spec.domain.memory.guest`. `resources.requests/limits.memory`
 * only size the virt-launcher pod; KubeVirt fills them in from the guest memory (plus overhead)
 * when they are not set. With hugepages, the pod gets hugepages equal to the smaller of guest and
 * requests.memory, and any requests.memory above the guest is added as ordinary pod memory.
 *
 * The forms therefore read and write only `memory.guest`. Older VMs that only set
 * `resources.requests.memory` (or limits) are read from there, and saving writes `memory.guest`.
 */

export type MemoryUnit = 'Mi' | 'Gi';

interface DomainMemorySpec {
  memory?: { guest?: string; hugepages?: { pageSize?: string } };
  resources?: { requests?: { memory?: string }; limits?: { memory?: string } };
}

const BINARY: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
};
const DECIMAL: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 };

/** Bytes for a Kubernetes quantity (e.g. "4Gi", "4096Mi", "4G", "4294967296"); null if invalid. */
export function quantityToBytes(quantity: string | undefined | null): number | null {
  if (!quantity) return null;
  const m = String(quantity)
    .trim()
    .match(/^(\d+(?:\.\d+)?)([KMGTP]i|[kKMGTP])?$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const suffix = m[2];
  if (!suffix) return num;
  return num * (BINARY[suffix] ?? DECIMAL[suffix]);
}

/** The memory the guest sees: memory.guest, else requests.memory, else limits.memory. */
export function getGuestMemory(domain: DomainMemorySpec | undefined): string | undefined {
  return (
    domain?.memory?.guest ||
    domain?.resources?.requests?.memory ||
    domain?.resources?.limits?.memory ||
    undefined
  );
}

/**
 * Split a quantity into a value + unit for the form (GiB if a whole number of GiB, else MiB).
 * Returns null when it cannot be shown exactly in MiB/GiB.
 */
export function toFormMemory(
  quantity: string | undefined | null
): { value: string; unit: MemoryUnit } | null {
  const bytes = quantityToBytes(quantity);
  if (bytes === null || bytes <= 0) return null;
  if (bytes % BINARY.Gi === 0) return { value: String(bytes / BINARY.Gi), unit: 'Gi' };
  if (bytes % BINARY.Mi === 0) return { value: String(bytes / BINARY.Mi), unit: 'Mi' };
  return null;
}

/**
 * Validation message when the guest memory does not fit the hugepage size
 * (KubeVirt rejects memory smaller than, or not a multiple of, the page size).
 */
export function hugepagesMemoryError(
  guest: string | undefined,
  pageSize: string | undefined
): string | null {
  if (!guest || !pageSize) return null;
  const mem = quantityToBytes(guest);
  const page = quantityToBytes(pageSize);
  if (mem === null || page === null || page === 0) return null;
  if (mem < page) return `Memory must be at least the hugepage size (${pageSize})`;
  if (mem % page !== 0) return `Memory must be a multiple of the hugepage size (${pageSize})`;
  return null;
}

/**
 * Validation message when memory.guest is above resources.limits.memory, which KubeVirt rejects
 * ("memory.guest must be equal to or less than the memory limit"). The form does not change
 * resources, so the limit has to be raised or removed in the YAML.
 */
export function memoryLimitError(domain: DomainMemorySpec | undefined): string | null {
  const guest = quantityToBytes(domain?.memory?.guest);
  const limit = domain?.resources?.limits?.memory;
  const limitBytes = quantityToBytes(limit);
  if (guest === null || limitBytes === null || guest <= limitBytes) return null;
  return `Memory is above resources.limits.memory (${limit}); raise or remove the limit in the YAML`;
}

/**
 * Return a copy of `domain` with `memory.guest` set (or removed when `guest` is empty).
 * Other memory settings (hugepages, maxGuest) and `resources` are left as they are.
 */
export function withGuestMemory<T extends DomainMemorySpec>(
  domain: T,
  guest: string | undefined
): T {
  const memory = { ...(domain?.memory || {}) };
  if (guest) memory.guest = guest;
  else delete memory.guest;
  const next = { ...domain, memory } as T;
  if (Object.keys(memory).length === 0) delete next.memory;
  return next;
}
