import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeCondition } from '../../types';
import { findCondition } from '../../utils/statusColors';

class VirtualMachineRestore extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  private getConditions(): KubeCondition[] {
    return this.status?.conditions || [];
  }

  getTargetName(): string {
    return this.spec?.target?.name || '-';
  }

  getSnapshotName(): string {
    return this.spec?.virtualMachineSnapshotName || '-';
  }

  isComplete(): boolean {
    const ready = findCondition(this.getConditions(), 'Ready');
    return ready?.status === 'True';
  }

  isFailed(): boolean {
    const ready = findCondition(this.getConditions(), 'Ready');
    const progressing = findCondition(this.getConditions(), 'Progressing');
    return ready?.status === 'False' && progressing?.status === 'False';
  }

  getEffectiveStatus(): string {
    if (this.isComplete()) return 'Succeeded';
    if (this.isFailed()) return 'Failed';
    const progressing = findCondition(this.getConditions(), 'Progressing');
    if (progressing?.status === 'True') return 'InProgress';
    return 'Unknown';
  }

  getStatusReason(): string {
    const ready = findCondition(this.getConditions(), 'Ready');
    return ready?.reason || ready?.message || '';
  }

  getRestoreTime(): string {
    return this.status?.restoreTime || '';
  }

  getDeletedDataVolumes(): string[] {
    return this.status?.deletedDataVolumes || [];
  }

  getRestoredVolumes(): Array<{ volumeName: string; persistentVolumeClaim: string }> {
    return (this.status?.restores || []).map(
      (r: { volumeName?: string; persistentVolumeClaimName?: string }) => ({
        volumeName: r.volumeName || '',
        persistentVolumeClaim: r.persistentVolumeClaimName || '',
      })
    );
  }

  static kind = 'VirtualMachineRestore';
  static apiVersion = 'snapshot.kubevirt.io/v1beta1';
  static isNamespaced = true;
  static apiName = 'virtualmachinerestores';
  static apiPlural = 'virtualmachinerestores';
}

export default VirtualMachineRestore;
