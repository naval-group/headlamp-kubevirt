/**
 * Disk storage allocated to VMs, for the Overview "Total allocated resources" card.
 *
 * A VM disk is a volume backed by a PVC (persistentVolumeClaim.claimName) or a DataVolume
 * (dataVolume.name, whose PVC has the same name). Its size is the PVC's capacity when the PVC is
 * known, otherwise the size requested in the VM's dataVolumeTemplates. Ephemeral volumes
 * (containerDisk, cloudInit, ...) are not counted. A PVC shared by several VMs is counted once.
 */

const BINARY: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};
const DECIMAL: Record<string, number> = {
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/** Kubernetes quantity (e.g. "65Gi", "500M", "1e9", "1073741824") in bytes, or null if invalid. */
export function parseQuantity(q: string | number | undefined | null): number | null {
  if (q === undefined || q === null) return null;
  const m = String(q)
    .trim()
    .match(/^([0-9]+(?:\.[0-9]+)?)(?:([eE][-+]?[0-9]+)|(Ki|Mi|Gi|Ti|Pi|Ei|k|K|M|G|T|P|E))?$/);
  if (!m) return null;
  let value = parseFloat(m[1]);
  if (m[2]) value *= Math.pow(10, parseInt(m[2].slice(1), 10));
  else if (m[3]) value *= BINARY[m[3]] ?? DECIMAL[m[3]];
  return Number.isFinite(value) ? value : null;
}

/** Size of a PVC (status.capacity, else spec request) keyed "namespace/name". */
export type PvcSizes = Map<string, number>;

interface PvcLike {
  metadata?: { name?: string; namespace?: string };
  spec?: { resources?: { requests?: { storage?: string } } };
  status?: { capacity?: { storage?: string } };
}

export function pvcSizes(pvcs: PvcLike[]): PvcSizes {
  const sizes: PvcSizes = new Map();
  for (const pvc of pvcs || []) {
    const name = pvc?.metadata?.name;
    const ns = pvc?.metadata?.namespace;
    if (!name || !ns) continue;
    const bytes =
      parseQuantity(pvc.status?.capacity?.storage) ??
      parseQuantity(pvc.spec?.resources?.requests?.storage);
    if (bytes !== null) sizes.set(`${ns}/${name}`, bytes);
  }
  return sizes;
}

interface VmLike {
  metadata?: { name?: string; namespace?: string };
  spec?: {
    dataVolumeTemplates?: Array<{
      metadata?: { name?: string };
      spec?: {
        storage?: { resources?: { requests?: { storage?: string } } };
        pvc?: { resources?: { requests?: { storage?: string } } };
      };
    }>;
    template?: {
      spec?: {
        volumes?: Array<{
          dataVolume?: { name?: string };
          persistentVolumeClaim?: { claimName?: string };
        }>;
      };
    };
  };
}

export interface VmStorageTotal {
  /** Bytes of all disks whose size is known. */
  bytes: number;
  /** Distinct PVC-backed disks. */
  disks: number;
  /** Disks whose size could not be found (PVC not readable and no template size). */
  unknown: number;
}

export function vmStorageTotal(vms: VmLike[], pvcs: PvcSizes): VmStorageTotal {
  const seen = new Map<string, number | null>();
  for (const vm of vms || []) {
    const ns = vm?.metadata?.namespace;
    if (!ns) continue;
    const templateSizes = new Map<string, number | null>();
    for (const t of vm.spec?.dataVolumeTemplates || []) {
      const name = t?.metadata?.name;
      if (!name) continue;
      templateSizes.set(
        name,
        parseQuantity(t.spec?.storage?.resources?.requests?.storage) ??
          parseQuantity(t.spec?.pvc?.resources?.requests?.storage)
      );
    }
    for (const vol of vm.spec?.template?.spec?.volumes || []) {
      const claim = vol?.persistentVolumeClaim?.claimName || vol?.dataVolume?.name;
      if (!claim) continue;
      const key = `${ns}/${claim}`;
      const size = pvcs.get(key) ?? templateSizes.get(claim) ?? null;
      // keep a known size if another VM sharing the claim found one
      if (!seen.has(key) || seen.get(key) === null) seen.set(key, size);
    }
  }
  let bytes = 0;
  let unknown = 0;
  for (const size of seen.values()) {
    if (size === null) unknown++;
    else bytes += size;
  }
  return { bytes, disks: seen.size, unknown };
}

/** "65.0 GiB", "1.2 TiB". */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}
