import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { NADConfig } from '../../types';

class NetworkAttachmentDefinition extends KubeObject {
  private _parsedConfig: NADConfig | null = null;

  get spec() {
    return this.jsonData?.spec;
  }

  getConfig(): string {
    return this.spec?.config || '';
  }

  getParsedConfig(): NADConfig {
    if (this._parsedConfig === null) {
      try {
        this._parsedConfig = JSON.parse(this.getConfig());
      } catch (e) {
        this._parsedConfig = {};
      }
    }
    return this._parsedConfig;
  }

  getNetworkType(): string {
    return this.getParsedConfig().type || 'unknown';
  }

  getIPAMType(): string {
    const ipam = this.getParsedConfig().ipam;
    if (!ipam || Object.keys(ipam).length === 0) return 'none';
    return ipam.type || 'none';
  }

  getBridgeName(): string {
    return this.getParsedConfig().bridge || '';
  }

  getMaster(): string {
    return this.getParsedConfig().master || '';
  }

  getVlanId(): number | null {
    return this.getParsedConfig().vlanId ?? null;
  }

  getMTU(): number | null {
    return this.getParsedConfig().mtu ?? null;
  }

  static kind = 'NetworkAttachmentDefinition';
  static apiVersion = 'k8s.cni.cncf.io/v1';
  static isNamespaced = true;
  static apiName = 'network-attachment-definitions';
  static apiPlural = 'network-attachment-definitions';

  static get detailsRoute() {
    return 'nad';
  }
}

export default NetworkAttachmentDefinition;
