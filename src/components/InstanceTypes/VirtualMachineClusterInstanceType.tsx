import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineClusterInstanceType extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  getCPU(): number {
    return this.spec?.cpu?.guest || 0;
  }

  getMemory(): string {
    return this.spec?.memory?.guest || '0';
  }

  getVendor(): string {
    return this.metadata?.labels?.['instancetype.kubevirt.io/vendor'] || 'custom';
  }

  isClusterProvided(): boolean {
    const vendor = this.getVendor();
    return vendor === 'redhat.com' || vendor === 'kubevirt.io';
  }

  getDisplayName(): string {
    return this.metadata?.annotations?.['instancetype.kubevirt.io/displayName'] || this.getName();
  }

  getDescription(): string {
    return this.metadata?.annotations?.['instancetype.kubevirt.io/description'] || '-';
  }

  getClass(): string {
    return this.metadata?.labels?.['instancetype.kubevirt.io/class'] || '-';
  }

  getSize(): string {
    return this.metadata?.labels?.['instancetype.kubevirt.io/size'] || '-';
  }

  getVersion(): string {
    return this.metadata?.labels?.['instancetype.kubevirt.io/version'] || '-';
  }

  getCPUModel(): string {
    return this.spec?.cpu?.model || '-';
  }

  getDedicatedCPUPlacement(): boolean {
    return this.spec?.cpu?.dedicatedCPUPlacement || false;
  }

  getIsolateEmulatorThread(): boolean {
    return this.spec?.cpu?.isolateEmulatorThread || false;
  }

  static kind = 'VirtualMachineClusterInstancetype';
  static apiVersion = 'instancetype.kubevirt.io/v1beta1';
  static isNamespaced = false;
  static apiName = 'virtualmachineclusterinstancetypes';
  static apiPlural = 'virtualmachineclusterinstancetypes';

  static get detailsRoute() {
    return 'instancetype';
  }
}

export default VirtualMachineClusterInstanceType;
