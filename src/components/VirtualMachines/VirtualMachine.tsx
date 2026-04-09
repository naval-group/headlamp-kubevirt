import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeCondition, VMVolume } from '../../types';
import { findCondition } from '../../utils/statusColors';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

class VirtualMachine extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  /** KubeVirt subresource APIs return empty bodies on success, which Headlamp's
   *  ApiProxy tries to JSON.parse — causing a harmless parse error. */
  private static isEmptyResponseError(error: unknown): boolean {
    const msg = (error as Error)?.message;
    return !!msg && (msg.includes('JSON') || msg.includes('Unexpected end'));
  }

  private async subresourceAction(
    resource: string,
    action: string,
    body: Record<string, unknown> = {}
  ) {
    const ns = encodeURIComponent(this.getNamespace());
    const name = encodeURIComponent(this.getName());
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${ns}/${resource}/${name}/${action}`;
    try {
      await ApiProxy.request(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error: unknown) {
      if (VirtualMachine.isEmptyResponseError(error)) return;
      throw error;
    }
  }

  async start() {
    return this.subresourceAction('virtualmachines', 'start');
  }

  async stop() {
    return this.subresourceAction('virtualmachines', 'stop');
  }

  async restart() {
    return this.subresourceAction('virtualmachines', 'restart');
  }

  async forceStop() {
    return this.subresourceAction('virtualmachines', 'stop', { gracePeriod: 0 });
  }

  async terminate() {
    return this.delete();
  }

  async migrate() {
    return this.subresourceAction('virtualmachines', 'migrate');
  }

  async pause() {
    return this.subresourceAction('virtualmachineinstances', 'pause');
  }

  async unpause() {
    return this.subresourceAction('virtualmachineinstances', 'unpause');
  }

  isPaused(): boolean {
    const pausedCondition = findCondition<KubeCondition>(this.status?.conditions, 'Paused');
    return pausedCondition?.status === 'True';
  }

  getNode(): string {
    // Get node from VMI status
    return this.status?.nodeName || '-';
  }

  getIPAddresses(): string[] {
    // Get IP addresses from VMI status
    const interfaces = this.status?.interfaces || [];
    const ips: string[] = [];
    interfaces.forEach((iface: { ipAddresses?: string[] }) => {
      if (iface.ipAddresses && Array.isArray(iface.ipAddresses)) {
        // Filter out IPv6 link-local addresses (fe80::)
        iface.ipAddresses.forEach((ip: string) => {
          if (!ip.startsWith('fe80::') && !ips.includes(ip)) {
            ips.push(ip);
          }
        });
      }
    });
    return ips;
  }

  isLiveMigratable(): boolean {
    const migratableCondition = findCondition<KubeCondition>(
      this.status?.conditions,
      'LiveMigratable'
    );
    return migratableCondition?.status === 'True';
  }

  getLiveMigratableReason(): string {
    const migratableCondition = findCondition<KubeCondition>(
      this.status?.conditions,
      'LiveMigratable'
    );
    return migratableCondition?.message || migratableCondition?.reason || '-';
  }

  isVolumeMigrationInProgress(): boolean {
    const conditions = this.status?.conditions || [];
    return conditions.some(
      (c: KubeCondition) => c.type === 'VolumeMigrationInProgress' && c.status === 'True'
    );
  }

  hasVolumesChangePending(): boolean {
    const conditions = this.status?.conditions || [];
    return conditions.some((c: KubeCondition) => c.type === 'VolumesChange' && c.status === 'True');
  }

  getVolumesUpdateError(): string | null {
    const conditions = this.status?.conditions || [];
    const failure = conditions.find(
      (c: KubeCondition) =>
        c.type === 'Failure' && c.reason === 'VolumesUpdateError' && c.status === 'True'
    );
    return failure?.message || null;
  }

  hasManualRecoveryRequired(): boolean {
    const conditions = this.status?.conditions || [];
    return conditions.some(
      (c: KubeCondition) => c.type === 'ManualRecoveryRequired' && c.status === 'True'
    );
  }

  /**
   * Migrate a volume's backing storage to a different StorageClass.
   * Fetches the actual PVC to get volume mode and capacity,
   * then patches the VM with updateVolumesStrategy: Migration and a replacement DVT.
   */
  /**
   * Prepare migration info for a single volume: fetch PVC, resolve original source,
   * pre-create destination DV, return the new DVT and volume reference.
   */
  private async prepareVolumeMigration(
    volumeName: string,
    targetStorageClass: string,
    targetAccessMode: string,
    targetVolumeMode: string,
    { skipBlankDv = false }: { skipBlankDv?: boolean } = {}
  ) {
    const volumes: VMVolume[] = this.spec?.template?.spec?.volumes || [];

    const volume = volumes.find((v: VMVolume) => v.name === volumeName);
    if (!volume) throw new Error(`Volume "${volumeName}" not found`);

    const pvcName = volume.dataVolume?.name || volume.persistentVolumeClaim?.claimName;
    if (!pvcName) throw new Error(`Volume "${volumeName}" has no DataVolume or PVC backing`);

    const pvc = await ApiProxy.request(
      `/api/v1/namespaces/${encodeURIComponent(
        this.getNamespace()
      )}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`
    );
    const accessModes = [targetAccessMode];
    const volumeMode = targetVolumeMode;
    const storageSize =
      pvc?.status?.capacity?.storage || pvc?.spec?.resources?.requests?.storage || '30Gi';

    // Build migration target name: pvcName-trigram-randomId
    // Trigram encodes access+volume mode: rw=ReadWriteOnce, wx=ReadWriteMany, rx=ReadOnly + f=Filesystem, b=Block
    const MODE_CODE: Record<string, string> = {
      'ReadWriteOnce-Filesystem': 'rwf',
      'ReadWriteOnce-Block': 'rwb',
      'ReadWriteMany-Filesystem': 'wxf',
      'ReadWriteMany-Block': 'wxb',
      'ReadOnlyMany-Filesystem': 'rxf',
      'ReadOnlyMany-Block': 'rxb',
    };
    const trigram = MODE_CODE[`${targetAccessMode}-${targetVolumeMode}`] || 'mig';
    const randomId = Math.random().toString(36).substring(2, 7);
    const migrationDvtName = `${pvcName}-${trigram}-${randomId}`.substring(0, 253);

    // DVT source: use pvc reference to the current PVC so CDI won't re-import on restart.
    // This preserves migrated data across VM restarts.
    const originalSource = { pvc: { name: pvcName, namespace: this.getNamespace() } };

    // Pre-create destination DV with blank source — needed for live migration so the
    // target PVC exists before KubeVirt's volume migration controller starts.
    // Skipped for clone operations: CDI must create the DV from the DVT's pvc source,
    // otherwise the destination stays blank and the VM won't boot.
    if (!skipBlankDv) {
      try {
        await ApiProxy.request(
          `/apis/cdi.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
            this.getNamespace()
          )}/datavolumes`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiVersion: 'cdi.kubevirt.io/v1beta1',
              kind: 'DataVolume',
              metadata: { name: migrationDvtName, namespace: this.getNamespace() },
              spec: {
                source: { blank: {} },
                storage: {
                  accessModes,
                  volumeMode,
                  resources: { requests: { storage: storageSize } },
                  storageClassName: targetStorageClass,
                },
              },
            }),
          }
        );
      } catch (err) {
        if (!(err as Error)?.message?.includes('already exists')) throw err;
      }
    }

    return {
      volumeName,
      pvcName,
      migrationDvtName,
      dvt: {
        metadata: { name: migrationDvtName },
        spec: {
          source: originalSource,
          storage: {
            accessModes,
            volumeMode,
            resources: { requests: { storage: storageSize } },
            storageClassName: targetStorageClass,
          },
        },
      },
    };
  }

  /**
   * Migrate a single volume's backing storage.
   */
  async migrateVolume(
    volumeName: string,
    targetStorageClass: string,
    targetAccessMode: string,
    targetVolumeMode: string
  ) {
    return this.migrateVolumes([
      {
        volumeName,
        storageClass: targetStorageClass,
        accessMode: targetAccessMode,
        volumeMode: targetVolumeMode,
      },
    ]);
  }

  /**
   * Migrate multiple volumes in a single patch. Each volume has its own target config.
   */
  async migrateVolumes(
    configs: Array<{
      volumeName: string;
      storageClass: string;
      accessMode: string;
      volumeMode: string;
    }>
  ) {
    const volumes: VMVolume[] = this.spec?.template?.spec?.volumes || [];
    const dataVolumeTemplates = this.spec?.dataVolumeTemplates || [];

    // Prepare all volumes in parallel
    const preparations = await Promise.all(
      configs.map(c =>
        this.prepareVolumeMigration(c.volumeName, c.storageClass, c.accessMode, c.volumeMode)
      )
    );

    // Build new DVTs: remove old ones, add new ones
    const oldPvcNames = new Set(preparations.map(p => p.pvcName));
    const filteredDvts = dataVolumeTemplates.filter(
      (dvt: { metadata?: { name?: string } }) => !oldPvcNames.has(dvt.metadata?.name)
    );
    const newDvts = preparations.map(p => p.dvt);

    // Build new volumes array with swapped references
    const migrationMap = new Map(preparations.map(p => [p.volumeName, p.migrationDvtName]));
    const newVolumes = volumes.map((v: VMVolume) => {
      const newName = migrationMap.get(v.name);
      if (!newName) return v;
      return { name: v.name, dataVolume: { name: newName } };
    });

    const patch = {
      spec: {
        updateVolumesStrategy: 'Migration',
        dataVolumeTemplates: [...filteredDvts, ...newDvts],
        template: { spec: { volumes: newVolumes } },
      },
    };

    const result = await this.patch(patch);
    if (result) {
      this.jsonData = result;
    }
    return result;
  }

  /**
   * Clone volumes for stopped VMs — uses CDI source:pvc cloning instead of live migration.
   * Reuses prepareVolumeMigration for PVC lookup and naming, then patches without updateVolumesStrategy.
   */
  async cloneVolumes(
    configs: Array<{
      volumeName: string;
      storageClass: string;
      accessMode: string;
      volumeMode: string;
    }>
  ) {
    const volumes: VMVolume[] = this.spec?.template?.spec?.volumes || [];
    const dataVolumeTemplates = this.spec?.dataVolumeTemplates || [];

    // Reuse prepareVolumeMigration — it handles PVC lookup, naming, and DVT building.
    // skipBlankDv: true — for stopped VMs, CDI must create the DV from the DVT's pvc source.
    const preparations = await Promise.all(
      configs.map(c =>
        this.prepareVolumeMigration(c.volumeName, c.storageClass, c.accessMode, c.volumeMode, {
          skipBlankDv: true,
        })
      )
    );
    const oldPvcNames = new Set(preparations.map(p => p.pvcName));
    const filteredDvts = dataVolumeTemplates.filter(
      (dvt: { metadata?: { name?: string } }) => !oldPvcNames.has(dvt.metadata?.name)
    );
    const newDvts = preparations.map(p => p.dvt);

    const cloneMap = new Map(preparations.map(p => [p.volumeName, p.migrationDvtName]));
    const newVolumes = volumes.map((v: VMVolume) => {
      const newName = cloneMap.get(v.name);
      if (!newName) return v;
      return { name: v.name, dataVolume: { name: newName } };
    });

    // No updateVolumesStrategy since VM is stopped
    const patch = {
      spec: {
        dataVolumeTemplates: [...filteredDvts, ...newDvts],
        template: { spec: { volumes: newVolumes } },
      },
    };

    const result = await this.patch(patch);
    if (result) {
      this.jsonData = result;
    }
    return result;
  }

  isDeleteProtected(): boolean {
    const labels = this.jsonData?.metadata?.labels || {};
    return labels['kubevirt.io/vm-delete-protection'] === 'True';
  }

  async setDeleteProtection(enabled: boolean) {
    const patch = enabled
      ? { metadata: { labels: { 'kubevirt.io/vm-delete-protection': 'True' } } }
      : { metadata: { labels: { 'kubevirt.io/vm-delete-protection': null } } };

    const result = await this.patch(patch);
    if (result) {
      this.jsonData = result;
    }
    return result;
  }

  exec(
    onExec: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const instance = new VirtualMachineInstance(this.jsonData);
    return instance.exec(onExec, options);
  }

  vnc(
    onVnc: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const instance = new VirtualMachineInstance(this.jsonData);
    return instance.vnc(onVnc, options);
  }

  static kind = 'VirtualMachine';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachines';
  static apiPlural = 'virtualmachines';

  static get detailsRoute() {
    return 'virtualmachine';
  }
}

export default VirtualMachine;
