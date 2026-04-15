import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class VirtualMachineTemplate extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  getMessage(): string {
    return this.spec?.message || '';
  }

  getParameters(): Array<{
    name: string;
    displayName?: string;
    description?: string;
    value?: string;
    generate?: string;
    from?: string;
    required?: boolean;
  }> {
    return this.spec?.parameters || [];
  }

  getVirtualMachineSpec(): Record<string, unknown> | null {
    return this.spec?.virtualMachine || null;
  }

  isReady(): boolean {
    const conditions = this.status?.conditions || [];
    return conditions.some(
      (c: { type: string; status: string }) => c.type === 'Ready' && c.status === 'True'
    );
  }

  getRequiredParameterCount(): number {
    return this.getParameters().filter(p => p.required).length;
  }

  static kind = 'VirtualMachineTemplate';
  static apiVersion = 'template.kubevirt.io/v1alpha1';
  static isNamespaced = true;
  static apiName = 'virtualmachinetemplates';
  static apiPlural = 'virtualmachinetemplates';

  static get detailsRoute() {
    return 'vmtemplate';
  }
}

export default VirtualMachineTemplate;
