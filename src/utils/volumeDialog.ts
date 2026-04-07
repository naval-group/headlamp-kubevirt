import { VMDisk, VMVolume } from '../types';

/** CDI StorageProfile claim property set */
export interface ClaimPropertySet {
  accessModes: string[];
  volumeMode: string;
}

/** CDI StorageProfile item */
export interface StorageProfileItem {
  metadata: { name: string };
  status?: {
    claimPropertySets?: ClaimPropertySet[];
  };
}

/** VM filesystem spec entry */
export interface VMFilesystem {
  name: string;
  virtiofs?: Record<string, unknown>;
}

/** Per-volume info fetched from PVC */
export interface VolumeInfo {
  name: string;
  pvcName: string;
  storageClassName: string;
  accessMode: string;
  volumeMode: string;
  capacity: string;
  eligible: boolean;
  reason?: string;
}

/** Per-volume target configuration */
export interface VolumeConfig {
  storageClass: string;
  accessMode: string;
  volumeMode: string;
}

export const ACCESS_MODES = ['ReadWriteMany', 'ReadWriteOnce', 'ReadOnlyMany'] as const;
export const VOLUME_MODES = ['Block', 'Filesystem'] as const;

export const ACCESS_MODE_SHORT: Record<string, string> = {
  ReadWriteMany: 'RWX',
  ReadWriteOnce: 'RWO',
  ReadOnlyMany: 'ROX',
};

/** Abbreviate a full access mode name to its short form (RWX, RWO, ROX). */
export function shortAccessMode(mode: string): string {
  return ACCESS_MODE_SHORT[mode] || mode;
}

/** Abbreviate an array of access modes to short form. */
export function shortAccessModes(modes: string[]): string {
  if (modes.includes('ReadWriteMany')) return 'RWX';
  if (modes.includes('ReadWriteOnce')) return 'RWO';
  if (modes.includes('ReadOnlyMany')) return 'ROX';
  return modes.join(',');
}

/** Check why a volume is ineligible for migration/cloning. Returns null if eligible. */
export function getIneligibleReason(
  volumeName: string,
  disks: VMDisk[],
  volumes: VMVolume[],
  filesystems: VMFilesystem[]
): string | null {
  const volume = volumes.find(v => v.name === volumeName);
  if (!volume) return 'Not found';
  if (!volume.persistentVolumeClaim && !volume.dataVolume) return 'Not PVC/DV backed';
  if (filesystems.some(fs => fs.name === volumeName)) return 'Filesystem (virtiofs)';
  const disk = disks.find(d => d.name === volumeName);
  if (disk?.lun) return 'LUN disk';
  if (disk?.shareable) return 'Shareable disk';
  return null;
}

/** Get valid access+volume mode combinations for a StorageClass. */
export function getValidCombos(
  sc: string,
  storageProfiles: Record<string, ClaimPropertySet[]>
): Array<{ accessMode: string; volumeMode: string }> {
  const sets = storageProfiles[sc] || [];
  const combos: Array<{ accessMode: string; volumeMode: string }> = [];
  for (const set of sets) {
    for (const am of set.accessModes) {
      combos.push({ accessMode: am, volumeMode: set.volumeMode });
    }
  }
  return combos;
}

/** Get valid volume modes for a given SC + access mode. */
export function getValidVolumeModes(
  sc: string,
  accessMode: string,
  storageProfiles: Record<string, ClaimPropertySet[]>
): string[] {
  const combos = getValidCombos(sc, storageProfiles);
  return [...new Set(combos.filter(c => c.accessMode === accessMode).map(c => c.volumeMode))];
}

/** Get valid access modes for a given SC + volume mode. */
export function getValidAccessModes(
  sc: string,
  volumeMode: string,
  storageProfiles: Record<string, ClaimPropertySet[]>
): string[] {
  const combos = getValidCombos(sc, storageProfiles);
  return [...new Set(combos.filter(c => c.volumeMode === volumeMode).map(c => c.accessMode))];
}

/** Check if a volume's config differs from its current state. */
export function hasVolumeChanged(info: VolumeInfo, cfg: VolumeConfig): boolean {
  return (
    cfg.storageClass !== info.storageClassName ||
    cfg.accessMode !== info.accessMode ||
    cfg.volumeMode !== info.volumeMode
  );
}

/** Filter selected volume names to only those with changed configs. */
export function getChangedVolumes(
  selected: Set<string>,
  volumeInfos: VolumeInfo[],
  configs: Record<string, VolumeConfig>
): string[] {
  return Array.from(selected).filter(name => {
    const info = volumeInfos.find(v => v.name === name);
    const cfg = configs[name];
    return !!info && !!cfg && hasVolumeChanged(info, cfg);
  });
}
