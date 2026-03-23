import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

export default class DataVolume extends KubeObject {
  static kind = 'DataVolume';
  static apiVersion = 'cdi.kubevirt.io/v1beta1';
  static apiName = 'datavolumes';
  static apiGroup = 'cdi.kubevirt.io';
  static isNamespaced = true;

  static get listRoute() {
    return 'datavolumes';
  }

  static get detailsRoute() {
    return 'datavolume';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get spec(): any {
    return this.jsonData?.spec;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get status(): any {
    return this.jsonData?.status;
  }

  // Get source type
  getSourceType(): string {
    if (this.spec?.source?.http) return 'HTTP';
    if (this.spec?.source?.registry) return 'Registry';
    if (this.spec?.source?.upload) return 'Upload';
    if (this.spec?.source?.blank) return 'Blank';
    if (this.spec?.source?.pvc) return 'Clone PVC';
    if (this.spec?.source?.snapshot) return 'Snapshot';
    return 'Unknown';
  }

  // Get storage size
  getSize(): string {
    return this.spec?.storage?.resources?.requests?.storage || '-';
  }

  // Get storage class
  getStorageClass(): string {
    return this.spec?.storage?.storageClassName || '-';
  }

  // Get content type
  getContentType(): string {
    return this.spec?.contentType || 'kubevirt';
  }
}
