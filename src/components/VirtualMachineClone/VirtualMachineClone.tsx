import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeCondition } from '../../types';
import { findCondition } from '../../utils/statusColors';

class VirtualMachineClone extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  getSourceName(): string {
    return this.spec?.source?.name || '-';
  }

  getTargetName(): string {
    return this.status?.targetName || this.spec?.target?.name || '-';
  }

  getPhase(): string {
    return this.status?.phase || '';
  }

  private getConditions(): KubeCondition[] {
    return this.status?.conditions || [];
  }

  /** Derive effective status from phase + conditions. */
  getEffectiveStatus(): string {
    const phase = this.getPhase();
    if (phase) return phase;

    // No phase — check conditions
    const conditions = this.getConditions();
    const ready = findCondition(conditions, 'Ready');
    const progressing = findCondition(conditions, 'Progressing');

    // Pending: progressing exists but hasn't started yet
    if (progressing?.reason === 'Pending') {
      return 'Pending';
    }
    if (progressing?.status === 'True') {
      return 'InProgress';
    }
    if (ready?.status === 'False' && progressing?.status === 'False') {
      return 'Failed';
    }
    return 'Unknown';
  }

  getStatusReason(): string {
    const ready = findCondition(this.getConditions(), 'Ready');
    return ready?.reason || ready?.message || '';
  }

  getSnapshotName(): string {
    return this.status?.snapshotName || '-';
  }

  getRestoreName(): string {
    return this.status?.restoreName || '-';
  }

  isComplete(): boolean {
    const status = this.getEffectiveStatus();
    return status === 'Succeeded' || status === 'Failed';
  }

  isFailed(): boolean {
    return this.getEffectiveStatus() === 'Failed';
  }

  static kind = 'VirtualMachineClone';
  static apiVersion = 'clone.kubevirt.io/v1beta1';
  static isNamespaced = true;
  static apiName = 'virtualmachineclones';
  static apiPlural = 'virtualmachineclones';
}

export default VirtualMachineClone;
