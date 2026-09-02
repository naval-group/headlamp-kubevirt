import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

class IPAMClaim extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  getNetwork(): string {
    return this.spec?.network || '-';
  }

  getInterface(): string {
    return this.spec?.interface || '-';
  }

  getIPs(): string[] {
    return this.status?.ips || [];
  }

  getOwnerPodName(): string {
    return this.status?.ownerPod?.name || '-';
  }

  getOwnerVMName(): string {
    return this.metadata?.labels?.['kubevirt.io/vm'] || '-';
  }

  static kind = 'IPAMClaim';
  static apiVersion = 'k8s.cni.cncf.io/v1alpha1';
  static isNamespaced = true;
  static apiName = 'ipamclaims';
  static apiPlural = 'ipamclaims';

  static get detailsRoute() {
    return 'ipamclaim';
  }
}

export default IPAMClaim;
