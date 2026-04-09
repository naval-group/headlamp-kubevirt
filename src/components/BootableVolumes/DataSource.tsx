import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeCondition } from '../../types';
import { findCondition } from '../../utils/statusColors';

class DataSource extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  getOperatingSystem(): string {
    const labels = this.metadata?.labels || {};
    return (
      labels['os.template.kubevirt.io/name'] ||
      labels['instancetype.kubevirt.io/default-preference'] ||
      '-'
    );
  }

  getDescription(): string {
    return this.metadata?.annotations?.['description'] || '-';
  }

  getPreference(): string {
    const labels = this.metadata?.labels || {};
    return labels['instancetype.kubevirt.io/default-preference'] || '-';
  }

  getInstanceType(): string {
    const labels = this.metadata?.labels || {};
    return labels['instancetype.kubevirt.io/default-instancetype'] || '-';
  }

  getSourcePVCName(): string {
    return this.spec?.source?.pvc?.name || '-';
  }

  getSourcePVCNamespace(): string {
    return this.spec?.source?.pvc?.namespace || this.getNamespace();
  }

  getDataImportCron(): string {
    const labels = this.metadata?.labels || {};
    return labels['cdi.kubevirt.io/dataImportCron'] || '-';
  }

  isReady(): boolean {
    const readyCondition = findCondition<KubeCondition>(this.status?.conditions, 'Ready');
    return readyCondition?.status === 'True';
  }

  getReadyMessage(): string {
    const readyCondition = findCondition<KubeCondition>(this.status?.conditions, 'Ready');
    return readyCondition?.message || '-';
  }

  getSize(): string {
    // Try to get size from PVC status
    if (this.status?.source?.pvc?.resources?.requests?.storage) {
      return this.status.source.pvc.resources.requests.storage;
    }
    // Try to get from spec
    if (this.spec?.source?.pvc?.resources?.requests?.storage) {
      return this.spec.source.pvc.resources.requests.storage;
    }
    // Default size
    return '30Gi';
  }

  getStorageClass(): string {
    // Try to get from PVC status
    if (this.status?.source?.pvc?.storageClassName) {
      return this.status.source.pvc.storageClassName;
    }
    // Try to get from spec
    if (this.spec?.source?.pvc?.storageClassName) {
      return this.spec.source.pvc.storageClassName;
    }
    return '-';
  }

  static kind = 'DataSource';
  static apiVersion = 'cdi.kubevirt.io/v1beta1';
  static isNamespaced = true;
  static apiName = 'datasources';
  static apiPlural = 'datasources';

  static get detailsRoute() {
    return 'datasource';
  }
}

export default DataSource;
