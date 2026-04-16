import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineSnapshot extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  getSourceName(): string {
    return this.spec?.source?.name || '';
  }

  getPhase(): string {
    return this.status?.phase || 'Unknown';
  }

  isReadyToUse(): boolean {
    return this.status?.readyToUse === true;
  }

  getCreationTime(): string {
    return this.status?.creationTime || '';
  }

  getError(): string | null {
    return this.status?.error?.message || null;
  }

  getIncludedVolumes(): string[] {
    return this.status?.snapshotVolumes?.includedVolumes || [];
  }

  getExcludedVolumes(): string[] {
    return this.status?.snapshotVolumes?.excludedVolumes || [];
  }

  getSourceIndications(): Array<{ indication: string; message: string }> {
    return this.status?.sourceIndications || [];
  }

  static kind = 'VirtualMachineSnapshot';
  static apiVersion = 'snapshot.kubevirt.io/v1beta1';
  static isNamespaced = true;
  static apiName = 'virtualmachinesnapshots';
  static apiPlural = 'virtualmachinesnapshots';

  static get detailsRoute() {
    return 'snapshot';
  }
}

export default VirtualMachineSnapshot;
