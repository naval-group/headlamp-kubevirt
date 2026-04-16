import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  KubeCondition,
  LiveUpdateConfig,
  MigrationConfig,
  NetworkConfig,
  PermittedHostDevices,
} from '../types';

class KubeVirt extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  getVersion(): string {
    return this.status?.observedKubeVirtVersion || 'Unknown';
  }

  getFeatureGates(): string[] {
    return this.spec?.configuration?.developerConfiguration?.featureGates || [];
  }

  getPhase(): string {
    const availableCondition = this.status?.conditions?.find(
      (c: KubeCondition) => c.type === 'Available'
    );
    if (availableCondition?.status === 'True') {
      return 'Ready';
    }
    const progressingCondition = this.status?.conditions?.find(
      (c: KubeCondition) => c.type === 'Progressing'
    );
    if (progressingCondition?.status === 'True') {
      return 'Progressing';
    }
    return 'Unknown';
  }

  getMigrationConfig() {
    return this.spec?.configuration?.migrations || {};
  }

  getCommonInstancetypesEnabled(): boolean {
    return this.spec?.configuration?.commonInstancetypesDeployment?.enabled || false;
  }

  getMemoryOvercommit(): number {
    return this.spec?.configuration?.developerConfiguration?.memoryOvercommit || 100;
  }

  getLiveUpdateConfig() {
    return this.spec?.configuration?.liveUpdateConfiguration || {};
  }

  getNetworkConfig() {
    return this.spec?.configuration?.network || {};
  }

  getEvictionStrategy(): string {
    return this.spec?.configuration?.evictionStrategy || '';
  }

  getPermittedHostDevices() {
    return this.spec?.configuration?.permittedHostDevices || {};
  }

  getPciHostDevices(): Array<{
    pciVendorSelector: string;
    resourceName: string;
    externalResourceProvider?: boolean;
  }> {
    return this.spec?.configuration?.permittedHostDevices?.pciHostDevices || [];
  }

  getMediatedDevices(): Array<{
    mdevNameSelector: string;
    resourceName: string;
    externalResourceProvider?: boolean;
  }> {
    return this.spec?.configuration?.permittedHostDevices?.mediatedDevices || [];
  }

  async updatePermittedHostDevices(permittedHostDevices: PermittedHostDevices) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    updated.spec.configuration.permittedHostDevices = permittedHostDevices;
    return this.update(updated);
  }

  async updateFeatureGates(featureGates: string[]) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    if (!updated.spec.configuration.developerConfiguration) {
      updated.spec.configuration.developerConfiguration = {};
    }
    updated.spec.configuration.developerConfiguration.featureGates = featureGates;
    return this.update(updated);
  }

  async updateMigrationConfig(migrationConfig: MigrationConfig) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    updated.spec.configuration.migrations = migrationConfig;
    return this.update(updated);
  }

  async updateCommonInstancetypes(enabled: boolean) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    if (!updated.spec.configuration.commonInstancetypesDeployment) {
      updated.spec.configuration.commonInstancetypesDeployment = {};
    }
    updated.spec.configuration.commonInstancetypesDeployment.enabled = enabled;
    return this.update(updated);
  }

  async updateMemoryOvercommit(overcommit: number) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    if (!updated.spec.configuration.developerConfiguration) {
      updated.spec.configuration.developerConfiguration = {};
    }
    updated.spec.configuration.developerConfiguration.memoryOvercommit = overcommit;
    return this.update(updated);
  }

  async updateLiveUpdateConfig(liveUpdateConfig: LiveUpdateConfig) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    updated.spec.configuration.liveUpdateConfiguration = liveUpdateConfig;
    return this.update(updated);
  }

  async updateNetworkConfig(networkConfig: NetworkConfig) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    updated.spec.configuration.network = networkConfig;
    return this.update(updated);
  }

  getMonitorNamespace(): string {
    return this.jsonData?.spec?.monitorNamespace || '';
  }

  getMonitorAccount(): string {
    return this.jsonData?.spec?.monitorAccount || '';
  }

  async updateMonitoringConfig(monitorNamespace: string, monitorAccount: string) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (monitorNamespace) {
      updated.spec.monitorNamespace = monitorNamespace;
    } else {
      delete updated.spec.monitorNamespace;
    }
    if (monitorAccount) {
      updated.spec.monitorAccount = monitorAccount;
    } else {
      delete updated.spec.monitorAccount;
    }
    return this.update(updated);
  }

  async updateEvictionStrategy(strategy: string) {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    if (strategy) {
      updated.spec.configuration.evictionStrategy = strategy;
    } else {
      delete updated.spec.configuration.evictionStrategy;
    }
    return this.update(updated);
  }

  getRoleAggregationStrategy(): string {
    return this.jsonData?.spec?.configuration?.roleAggregationStrategy || 'AggregateToDefault';
  }

  async updateRoleAggregationStrategy(strategy: 'AggregateToDefault' | 'Manual') {
    const updated = { ...this.jsonData };
    if (!updated.spec) updated.spec = {};
    if (!updated.spec.configuration) updated.spec.configuration = {};
    if (strategy === 'Manual') {
      updated.spec.configuration.roleAggregationStrategy = 'Manual';
    } else {
      delete updated.spec.configuration.roleAggregationStrategy;
    }
    return this.update(updated);
  }

  static kind = 'KubeVirt';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'kubevirts';
  static apiPlural = 'kubevirts';
}

export default KubeVirt;
