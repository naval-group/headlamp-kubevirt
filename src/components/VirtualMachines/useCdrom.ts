import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addCdromDrive,
  CdromDrive,
  CdromLiveState,
  cdromLiveState,
  CdromMediaKind,
  ejectCdromMedia,
  getCdromDrives,
  insertCdromMedia,
  removeCdromDrive,
  updateVM,
} from '../../utils/cdrom';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface CdromDriveView extends CdromDrive {
  live: CdromLiveState;
}

const FAST_POLL_MS = 3000;
const SLOW_POLL_MS = 15000;

/**
 * Live view of a VM's CD-ROM drives plus insert/eject actions.
 * Polls the VM and VMI (faster while a disc is being inserted or ejected).
 */
export default function useCdrom(namespace: string, name: string, enabled = true) {
  const [vm, setVm] = useState<Obj | null>(null);
  const [vmi, setVmi] = useState<Obj | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!enabled || !namespace || !name) return;
    let cancelled = false;
    const ns = encodeURIComponent(namespace);
    const n = encodeURIComponent(name);
    Promise.all([
      ApiProxy.request(`/apis/kubevirt.io/v1/namespaces/${ns}/virtualmachines/${n}`).catch(
        () => null
      ),
      ApiProxy.request(`/apis/kubevirt.io/v1/namespaces/${ns}/virtualmachineinstances/${n}`).catch(
        () => null
      ),
    ]).then(([vmResp, vmiResp]) => {
      if (cancelled) return;
      setVm(vmResp);
      setVmi(vmiResp);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [namespace, name, enabled, tick]);

  const drives: CdromDriveView[] = useMemo(
    () =>
      getCdromDrives(vm?.spec?.template?.spec).map(d => ({ ...d, live: cdromLiveState(d, vmi) })),
    [vm, vmi]
  );

  const busy = drives.some(d => d.live.state === 'inserting' || d.live.state === 'ejecting');

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(refresh, busy ? FAST_POLL_MS : SLOW_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, busy, refresh]);

  /** PVC/DataVolume names used by the VM's volumes (to grey them out in the picker). */
  const usedClaims: string[] = useMemo(
    () =>
      ((vm?.spec?.template?.spec?.volumes || []) as Obj[])
        .map(v => v.dataVolume?.name || v.persistentVolumeClaim?.claimName)
        .filter(Boolean),
    [vm]
  );

  const run = useCallback(
    async (change: (vm: Obj) => Obj) => {
      await updateVM(namespace, name, change);
      refresh();
    },
    [namespace, name, refresh]
  );

  return {
    loaded,
    running: !!vmi,
    drives,
    usedClaims,
    templateSpec: vm?.spec?.template?.spec as Obj | undefined,
    refresh,
    insert: (drive: string, media: { kind: CdromMediaKind; name: string }) =>
      run(v => insertCdromMedia(v, drive, media)),
    eject: (drive: string) => run(v => ejectCdromMedia(v, drive)),
    addDrive: (drive: string, media?: { kind: CdromMediaKind; name: string }) =>
      run(v => addCdromDrive(v, drive, media)),
    removeDrive: (drive: string) => run(v => removeCdromDrive(v, drive)),
  };
}

export function liveStateLabel(live: CdromLiveState): {
  label: string;
  color: 'default' | 'success' | 'info' | 'warning';
} {
  switch (live.state) {
    case 'ready':
      return { label: 'Inserted', color: 'success' };
    case 'inserting':
      return { label: 'Inserting…', color: 'info' };
    case 'ejecting':
      return { label: 'Ejecting…', color: 'info' };
    case 'restart-required':
      return { label: 'Restart required', color: 'warning' };
    case 'empty':
      return { label: 'Empty', color: 'default' };
    case 'stopped':
    default:
      return { label: 'VM stopped', color: 'default' };
  }
}
