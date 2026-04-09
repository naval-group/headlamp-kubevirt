import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { ExportLinks, KubeCondition } from '../../types';
import { findCondition } from '../../utils/statusColors';

class VirtualMachineExport extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  getSourceName(): string {
    return this.spec?.source?.name || '';
  }

  getSourceKind(): string {
    return this.spec?.source?.kind || '';
  }

  getPhase(): string {
    return this.status?.phase || 'Unknown';
  }

  getTTLDuration(): string {
    return this.spec?.ttlDuration || '';
  }

  getTTLExpirationTime(): string {
    return this.status?.ttlExpirationTime || '';
  }

  getVirtualMachineName(): string {
    return this.status?.virtualMachineName || '';
  }

  getServiceName(): string {
    return this.status?.serviceName || '';
  }

  getExternalLinks(): ExportLinks | null {
    return this.status?.links?.external || null;
  }

  getInternalLinks(): ExportLinks | null {
    return this.status?.links?.internal || null;
  }

  isReady(): boolean {
    const readyCondition = findCondition<KubeCondition>(this.status?.conditions, 'Ready');
    return readyCondition?.status === 'True';
  }

  static kind = 'VirtualMachineExport';
  static apiVersion = 'export.kubevirt.io/v1beta1';
  static isNamespaced = true;
  static apiName = 'virtualmachineexports';
  static apiPlural = 'virtualmachineexports';

  static get detailsRoute() {
    return 'export';
  }
}

export default VirtualMachineExport;
