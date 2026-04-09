import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { DataImportCronImport, KubeCondition } from '../../types';
import { findCondition } from '../../utils/statusColors';

class DataImportCron extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  getManagedDataSource(): string {
    return this.spec?.managedDataSource || '-';
  }

  getSchedule(): string {
    return this.spec?.schedule || '-';
  }

  getGarbageCollect(): string {
    return this.spec?.garbageCollect || 'Outdated';
  }

  getImportsToKeep(): number {
    return this.spec?.importsToKeep || 3;
  }

  getRetentionPolicy(): string {
    return this.spec?.retentionPolicy || 'RetainAll';
  }

  getLastExecutionTimestamp(): string {
    return this.status?.lastExecutionTimestamp || '-';
  }

  getLastImportedPVC(): string {
    return this.status?.lastImportedPVC?.name || '-';
  }

  getConditions(): KubeCondition[] {
    return this.status?.conditions || [];
  }

  getSourceType(): string {
    const template = this.spec?.template;
    if (!template) return '-';

    const spec = template.spec;
    if (!spec || !spec.source) return '-';

    if (spec.source.registry) return 'Registry';
    if (spec.source.http) return 'HTTP';
    if (spec.source.s3) return 'S3';
    if (spec.source.gcs) return 'GCS';
    if (spec.source.imageio) return 'ImageIO';
    if (spec.source.vddk) return 'VDDK';
    if (spec.source.blank) return 'Blank';

    return 'Unknown';
  }

  getSourceURL(): string {
    const template = this.spec?.template;
    if (!template) return '-';

    const spec = template.spec;
    if (!spec || !spec.source) return '-';

    return spec.source.registry?.url || spec.source.http?.url || spec.source.s3?.url || '-';
  }

  getStorageSize(): string {
    return this.spec?.template?.spec?.storage?.resources?.requests?.storage || '-';
  }

  getStorageClass(): string {
    return this.spec?.template?.spec?.storage?.storageClassName || '-';
  }

  getAccessMode(): string {
    const modes = this.spec?.template?.spec?.storage?.accessModes || [];
    return modes.join(', ') || '-';
  }

  getVolumeMode(): string {
    return this.spec?.template?.spec?.storage?.volumeMode || '-';
  }

  isUpToDate(): boolean {
    const upToDateCondition = findCondition<KubeCondition>(this.status?.conditions, 'UpToDate');
    return upToDateCondition?.status === 'True';
  }

  isProgressing(): boolean {
    const progressingCondition = findCondition<KubeCondition>(
      this.status?.conditions,
      'Progressing'
    );
    return progressingCondition?.status === 'True';
  }

  getCurrentImports(): DataImportCronImport[] {
    return this.status?.currentImports || [];
  }

  static kind = 'DataImportCron';
  static apiVersion = 'cdi.kubevirt.io/v1beta1';
  static isNamespaced = true;
  static apiName = 'dataimportcrons';
  static apiPlural = 'dataimportcrons';

  static get detailsRoute() {
    return 'dataimportcron';
  }
}

export default DataImportCron;
