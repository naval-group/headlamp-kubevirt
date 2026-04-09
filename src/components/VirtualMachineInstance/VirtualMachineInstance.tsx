import * as ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeCondition } from '../../types';
import { findCondition } from '../../utils/statusColors';

class VirtualMachineInstance extends KubeObject {
  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }

  getLastStateChangeTimestamp() {
    return new Date(
      findCondition<KubeCondition>(this.status?.conditions, 'Ready')?.lastTransitionTime || 0
    );
  }

  exec(
    onExec: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/console`;
    return ApiProxy.stream(url, onExec, {
      isJson: false,
      additionalProtocols: ['plain.kubevirt.io'],
      ...options,
    });
  }

  vnc(
    onVnc: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket } {
    const url = `/apis/subresources.kubevirt.io/v1/namespaces/${this.getNamespace()}/virtualmachineinstances/${this.getName()}/vnc`;
    return ApiProxy.stream(url, onVnc, {
      isJson: false,
      additionalProtocols: ['plain.kubevirt.io'],
      ...options,
    });
  }

  static kind = 'VirtualMachineInstance';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
  static apiName = 'virtualmachineinstances';
  static apiPlural = 'virtualmachineinstances';

  static get detailsRoute() {
    return 'virtualmachineinstance';
  }
}

export default VirtualMachineInstance;
