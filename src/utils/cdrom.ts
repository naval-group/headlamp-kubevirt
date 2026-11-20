import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { isFeatureGateEnabled } from './featureGates';

/**
 * CD-ROM drives and media (KubeVirt declarative volume hotplug).
 *
 * A CD-ROM drive is a `domain.devices.disks[]` entry with `cdrom: {bus: sata}`. The media is a
 * `volumes[]` entry with the same name (a DataVolume or PVC holding the ISO). With the
 * DeclarativeHotplugVolumes feature gate, a drive may exist without a volume (empty tray), and
 * adding/removing a `hotpluggable: true` volume on a running VM inserts/ejects the media live.
 * Media inserted at boot without `hotpluggable` can only be changed with a restart.
 *
 * KubeVirt only does declarative hotplug when the deprecated HotplugVolumes gate is NOT enabled
 * (the old gate takes precedence).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type CdromMediaKind = 'dataVolume' | 'persistentVolumeClaim';

export interface CdromMedia {
  kind: CdromMediaKind;
  /** DataVolume name or PVC claimName */
  name: string;
  hotpluggable: boolean;
}

export interface CdromDrive {
  name: string;
  bus: string;
  bootOrder?: number;
  media?: CdromMedia;
  /** The drive has a volume that is not a DataVolume/PVC (e.g. containerDisk) - not changeable here. */
  otherMedia?: string;
}

export type CdromLiveState =
  | { state: 'stopped' }
  | { state: 'empty' }
  | { state: 'inserting'; detail?: string }
  | { state: 'ready'; media: string }
  | { state: 'ejecting'; detail?: string }
  | { state: 'restart-required'; detail: string };

export function cdromHotplugAvailable(): boolean {
  return (
    isFeatureGateEnabled('DeclarativeHotplugVolumes') && !isFeatureGateEnabled('HotplugVolumes')
  );
}

function mediaFromVolume(vol: Obj | undefined): CdromMedia | undefined {
  if (vol?.dataVolume?.name) {
    return {
      kind: 'dataVolume',
      name: vol.dataVolume.name,
      hotpluggable: !!vol.dataVolume.hotpluggable,
    };
  }
  if (vol?.persistentVolumeClaim?.claimName) {
    return {
      kind: 'persistentVolumeClaim',
      name: vol.persistentVolumeClaim.claimName,
      hotpluggable: !!vol.persistentVolumeClaim.hotpluggable,
    };
  }
  return undefined;
}

function describeOtherVolume(vol: Obj): string {
  const key = Object.keys(vol).find(k => k !== 'name');
  return key || 'volume';
}

/** CD-ROM drives of a VirtualMachine (from spec.template) or VMI (from spec). */
export function getCdromDrives(templateSpec: Obj | undefined): CdromDrive[] {
  const disks: Obj[] = templateSpec?.domain?.devices?.disks || [];
  const volumes: Obj[] = templateSpec?.volumes || [];
  return disks
    .filter(d => d.cdrom !== undefined)
    .map(d => {
      const vol = volumes.find(v => v.name === d.name);
      const media = mediaFromVolume(vol);
      return {
        name: d.name,
        bus: d.cdrom?.bus || 'sata',
        bootOrder: d.bootOrder,
        media,
        otherMedia: vol && !media ? describeOtherVolume(vol) : undefined,
      };
    });
}

/** Names of all disks/volumes of a template spec (to pick a free drive name). */
export function nextCdromName(templateSpec: Obj | undefined): string {
  const used = new Set<string>([
    ...((templateSpec?.domain?.devices?.disks || []) as Obj[]).map(d => d.name),
    ...((templateSpec?.volumes || []) as Obj[]).map(v => v.name),
  ]);
  for (let i = 0; ; i++) {
    const name = i === 0 ? 'cdrom' : `cdrom${i}`;
    if (!used.has(name)) return name;
  }
}

function cloneTemplateSpec(vm: Obj): Obj {
  return JSON.parse(JSON.stringify(vm?.spec?.template?.spec || {}));
}

function withTemplateSpec(vm: Obj, templateSpec: Obj): Obj {
  return {
    ...vm,
    spec: { ...vm.spec, template: { ...vm.spec?.template, spec: templateSpec } },
  };
}

/** Add an empty CD-ROM drive (SATA). Returns the new VM object. */
export function addCdromDrive(
  vm: Obj,
  name: string,
  media?: { kind: CdromMediaKind; name: string }
): Obj {
  const spec = cloneTemplateSpec(vm);
  spec.domain = spec.domain || {};
  spec.domain.devices = spec.domain.devices || {};
  const disks: Obj[] = spec.domain.devices.disks || [];
  if (disks.some(d => d.name === name)) throw new Error(`A disk named "${name}" already exists`);
  spec.domain.devices.disks = [...disks, { name, cdrom: { bus: 'sata' } }];
  const next = withTemplateSpec(vm, spec);
  return media ? insertCdromMedia(next, name, media) : next;
}

/** Remove a CD-ROM drive and its media. */
export function removeCdromDrive(vm: Obj, name: string): Obj {
  const spec = cloneTemplateSpec(vm);
  spec.domain.devices.disks = (spec.domain?.devices?.disks || []).filter(
    (d: Obj) => d.name !== name
  );
  spec.volumes = (spec.volumes || []).filter((v: Obj) => v.name !== name);
  return withTemplateSpec(vm, spec);
}

/** Put media into a CD-ROM drive (replaces any current media). Always hotpluggable. */
export function insertCdromMedia(
  vm: Obj,
  drive: string,
  media: { kind: CdromMediaKind; name: string }
): Obj {
  const spec = cloneTemplateSpec(vm);
  const disk = (spec.domain?.devices?.disks || []).find((d: Obj) => d.name === drive);
  if (!disk || disk.cdrom === undefined) throw new Error(`"${drive}" is not a CD-ROM drive`);
  const volume: Obj =
    media.kind === 'dataVolume'
      ? { name: drive, dataVolume: { name: media.name, hotpluggable: true } }
      : { name: drive, persistentVolumeClaim: { claimName: media.name, hotpluggable: true } };
  const volumes: Obj[] = spec.volumes || [];
  const idx = volumes.findIndex(v => v.name === drive);
  spec.volumes = idx >= 0 ? volumes.map((v, i) => (i === idx ? volume : v)) : [...volumes, volume];
  return withTemplateSpec(vm, spec);
}

/** Remove the media from a CD-ROM drive (empty tray). */
export function ejectCdromMedia(vm: Obj, drive: string): Obj {
  const spec = cloneTemplateSpec(vm);
  spec.volumes = (spec.volumes || []).filter((v: Obj) => v.name !== drive);
  return withTemplateSpec(vm, spec);
}

/**
 * What the running VM currently has in a drive, compared with what the VM spec wants.
 * vmi = VirtualMachineInstance JSON (or null when the VM is not running).
 */
export function cdromLiveState(drive: CdromDrive, vmi: Obj | null | undefined): CdromLiveState {
  if (!vmi) return { state: 'stopped' };
  const vmiDrive = getCdromDrives(vmi.spec).find(d => d.name === drive.name);
  const status: Obj | undefined = (vmi.status?.volumeStatus || []).find(
    (s: Obj) => s.name === drive.name
  );
  const wanted = drive.media;
  const current = vmiDrive?.media;

  if (!vmiDrive) {
    return { state: 'restart-required', detail: 'Drive is added at the next restart' };
  }
  if (wanted && current && wanted.name === current.name && wanted.kind === current.kind) {
    if (status?.phase === 'Ready' || (!current.hotpluggable && status)) {
      return { state: 'ready', media: current.name };
    }
    return { state: 'inserting', detail: status?.message || status?.phase };
  }
  // Media differs between VM spec and running VM
  if (current && !current.hotpluggable) {
    return {
      state: 'restart-required',
      detail: wanted
        ? `${current.name} was inserted at boot; ${wanted.name} is used after a restart`
        : `${current.name} was inserted at boot; it is ejected at the next restart`,
    };
  }
  if (wanted) return { state: 'inserting', detail: status?.message || 'Waiting for hotplug' };
  if (current) return { state: 'ejecting', detail: status?.message };
  return { state: 'empty' };
}

/* ── API ──────────────────────────────────────────────────────────────── */

function vmPath(namespace: string, name: string): string {
  return `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
    namespace
  )}/virtualmachines/${encodeURIComponent(name)}`;
}

/**
 * Read the VM, apply `change`, and write it back with its resourceVersion, so a concurrent
 * edit is never overwritten silently. Retries on a 409 conflict.
 */
export async function updateVM(
  namespace: string,
  name: string,
  change: (vm: Obj) => Obj,
  attempts = 3
): Promise<Obj> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const vm = (await ApiProxy.request(vmPath(namespace, name))) as Obj;
    const next = change(vm);
    try {
      return (await ApiProxy.put(vmPath(namespace, name), next)) as Obj;
    } catch (err) {
      lastErr = err;
      if ((err as { status?: number })?.status !== 409) throw err;
    }
  }
  throw lastErr;
}
