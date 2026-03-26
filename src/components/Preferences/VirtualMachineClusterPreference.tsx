import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineClusterPreference extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  getVendor(): string {
    return this.metadata?.labels?.['instancetype.kubevirt.io/vendor'] || 'custom';
  }

  isClusterProvided(): boolean {
    const vendor = this.getVendor();
    return vendor === 'redhat.com' || vendor === 'kubevirt.io';
  }

  getDisplayName(): string {
    return this.metadata?.annotations?.['openshift.io/display-name'] || this.getName();
  }

  getOSType(): string {
    return this.metadata?.labels?.['instancetype.kubevirt.io/os-type'] || '-';
  }

  getArchitecture(): string {
    return this.metadata?.labels?.['instancetype.kubevirt.io/arch'] || '-';
  }

  getIconClass(): string {
    return this.metadata?.annotations?.['iconClass'] || '-';
  }

  getPreferredDiskBus(): string {
    return this.spec?.devices?.preferredDiskBus || '-';
  }

  getPreferredInterfaceModel(): string {
    return this.spec?.devices?.preferredInterfaceModel || '-';
  }

  hasPreferredEFI(): boolean {
    return !!this.spec?.firmware?.preferredEfi;
  }

  hasSecureBoot(): boolean {
    return !!this.spec?.firmware?.preferredEfi?.secureBoot;
  }

  getMinCPU(): number {
    return this.spec?.requirements?.cpu?.guest || 0;
  }

  getMinMemory(): string {
    return this.spec?.requirements?.memory?.guest || '-';
  }

  static kind = 'VirtualMachineClusterPreference';
  static apiVersion = 'instancetype.kubevirt.io/v1beta1';
  static isNamespaced = false;
  static apiName = 'virtualmachineclusterpreferences';
  static apiPlural = 'virtualmachineclusterpreferences';

  static get detailsRoute() {
    return 'preference';
  }
}

export default VirtualMachineClusterPreference;
