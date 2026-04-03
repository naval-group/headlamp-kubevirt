import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeCondition } from '../../types';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

class VirtualMachine extends KubeObject {
  get spec() {
    return this.jsonData?.spec;
  }

  get status() {
    return this.jsonData?.status;
  }

  async start() {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachines/${this.getName()}/start`;
    try {
      await ApiProxy.request(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (error: unknown) {
      if (
        (error as Error)?.message?.includes('JSON') ||
        (error as Error)?.message?.includes('Unexpected end')
      ) {
        return;
      }
      throw error;
    }
  }

  async stop() {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachines/${this.getName()}/stop`;
    try {
      await ApiProxy.request(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (error: unknown) {
      if (
        (error as Error)?.message?.includes('JSON') ||
        (error as Error)?.message?.includes('Unexpected end')
      ) {
        return;
      }
      throw error;
    }
  }

  async restart() {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachines/${this.getName()}/restart`;
    try {
      await ApiProxy.request(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (error: unknown) {
      if (
        (error as Error)?.message?.includes('JSON') ||
        (error as Error)?.message?.includes('Unexpected end')
      ) {
        return;
      }
      throw error;
    }
  }

  async forceStop() {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachines/${this.getName()}/stop`;
    try {
      await ApiProxy.request(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gracePeriod: 0 }),
      });
    } catch (error: unknown) {
      if (
        (error as Error)?.message?.includes('JSON') ||
        (error as Error)?.message?.includes('Unexpected end')
      ) {
        return;
      }
      throw error;
    }
  }

  async terminate() {
    return this.delete();
  }

  async migrate() {
    // Trigger live migration via KubeVirt subresource API
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachines/${this.getName()}/migrate`;
    try {
      await ApiProxy.request(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
    } catch (error: unknown) {
      // If the response is empty but the request succeeded (status 2xx), ignore the JSON parse error
      if (
        (error as Error)?.message?.includes('JSON') ||
        (error as Error)?.message?.includes('Unexpected end')
      ) {
        // Success - migrate API returns empty response
        return;
      }
      throw error;
    }
  }

  async pause() {
    // Pause VM via KubeVirt subresource API
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/pause`;
    try {
      await ApiProxy.request(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
    } catch (error: unknown) {
      // If the response is empty but the request succeeded (status 2xx), ignore the JSON parse error
      if (
        (error as Error)?.message?.includes('JSON') ||
        (error as Error)?.message?.includes('Unexpected end')
      ) {
        // Success - pause API returns empty response
        return;
      }
      throw error;
    }
  }

  async unpause() {
    // Unpause VM via KubeVirt subresource API
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/unpause`;
    try {
      await ApiProxy.request(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
    } catch (error: unknown) {
      // If the response is empty but the request succeeded (status 2xx), ignore the JSON parse error
      if (
        (error as Error)?.message?.includes('JSON') ||
        (error as Error)?.message?.includes('Unexpected end')
      ) {
        // Success - unpause API returns empty response
        return;
      }
      throw error;
    }
  }

  isPaused(): boolean {
    const conditions = this.status?.conditions || [];
    const pausedCondition = conditions.find((c: KubeCondition) => c.type === 'Paused');
    return pausedCondition?.status === 'True';
  }

  getNode(): string {
    // Get node from VMI status
    return this.status?.nodeName || '-';
  }

  getIPAddresses(): string[] {
    // Get IP addresses from VMI status
    const interfaces = this.status?.interfaces || [];
    const ips: string[] = [];
    interfaces.forEach((iface: { ipAddresses?: string[] }) => {
      if (iface.ipAddresses && Array.isArray(iface.ipAddresses)) {
        // Filter out IPv6 link-local addresses (fe80::)
        iface.ipAddresses.forEach((ip: string) => {
          if (!ip.startsWith('fe80::') && !ips.includes(ip)) {
            ips.push(ip);
          }
        });
      }
    });
    return ips;
  }

  isLiveMigratable(): boolean {
    const conditions = this.status?.conditions || [];
    const migratableCondition = conditions.find((c: KubeCondition) => c.type === 'LiveMigratable');
    return migratableCondition?.status === 'True';
  }

  getLiveMigratableReason(): string {
    const conditions = this.status?.conditions || [];
    const migratableCondition = conditions.find((c: KubeCondition) => c.type === 'LiveMigratable');
    return migratableCondition?.message || migratableCondition?.reason || '-';
  }

  isDeleteProtected(): boolean {
    const labels = this.jsonData?.metadata?.labels || {};
    return labels['kubevirt.io/vm-delete-protection'] === 'True';
  }

  async setDeleteProtection(enabled: boolean) {
    const patch = enabled
      ? { metadata: { labels: { 'kubevirt.io/vm-delete-protection': 'True' } } }
      : { metadata: { labels: { 'kubevirt.io/vm-delete-protection': null } } };

    const result = await this.patch(patch);
    if (result) {
      this.jsonData = result;
    }
    return result;
  }

  exec(
    onExec: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const instance = new VirtualMachineInstance(this.jsonData);
    return instance.exec(onExec, options);
  }

  vnc(
    onVnc: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const instance = new VirtualMachineInstance(this.jsonData);
    return instance.vnc(onVnc, options);
  }

  static kind = 'VirtualMachine';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachines';
  static apiPlural = 'virtualmachines';

  static get detailsRoute() {
    return 'virtualmachine';
  }
}

export default VirtualMachine;
