export type VMArchitecture = 'amd64' | 'arm64' | 's390x';

export const DEFAULT_VM_ARCHITECTURE: VMArchitecture = 'amd64';

export const VM_ARCHITECTURES: Array<{ value: VMArchitecture; label: string }> = [
  { value: 'amd64', label: 'x86_64 (amd64)' },
  { value: 'arm64', label: 'ARM64 (arm64)' },
  { value: 's390x', label: 'IBM Z (s390x)' },
];

const CPU_MODEL_LABEL_PREFIX = 'cpu-model.node.kubevirt.io/';

interface NodeWithLabels {
  metadata?: {
    labels?: Record<string, string>;
  };
}

export function getCPUModelsForArchitecture(
  nodes: NodeWithLabels[],
  architecture: VMArchitecture
): string[] {
  const models = new Set<string>();

  nodes.forEach(node => {
    const labels = node.metadata?.labels;
    if (labels?.['kubernetes.io/arch'] !== architecture) return;

    Object.entries(labels).forEach(([key, value]) => {
      if (value !== 'true' || !key.startsWith(CPU_MODEL_LABEL_PREFIX)) return;

      const model = key.slice(CPU_MODEL_LABEL_PREFIX.length);
      if (model) models.add(model);
    });
  });

  return Array.from(models).sort((a, b) => a.localeCompare(b));
}

export const MACHINE_TYPE_OPTIONS: Record<
  VMArchitecture,
  Array<{ value: string; label: string }>
> = {
  amd64: [
    { value: '', label: 'Default (q35)' },
    { value: 'pc-q35-rhel9.2.0', label: 'pc-q35-rhel9.2.0' },
    { value: 'pc-q35-rhel9.0.0', label: 'pc-q35-rhel9.0.0' },
    { value: 'q35', label: 'q35' },
    { value: 'pc-i440fx-rhel7.6.0', label: 'pc-i440fx-rhel7.6.0' },
    { value: 'pc', label: 'pc (i440fx)' },
  ],
  arm64: [
    { value: '', label: 'Default (virt)' },
    { value: 'virt', label: 'virt' },
  ],
  s390x: [
    { value: '', label: 'Default (s390-ccw-virtio)' },
    { value: 's390-ccw-virtio', label: 's390-ccw-virtio' },
  ],
};

const ARCHITECTURE_INDEPENDENT_CPU_MODELS = new Set(['', 'host-passthrough', 'host-model']);
const HOST_PASSTHROUGH_ONLY_ARCHITECTURES = new Set<VMArchitecture>(['arm64']);

export function supportsCPUModelSelection(architecture: VMArchitecture): boolean {
  return !HOST_PASSTHROUGH_ONLY_ARCHITECTURES.has(architecture);
}

export function isCPUModelCompatible(
  model: string,
  architecture: VMArchitecture,
  availableModels: readonly string[] = []
): boolean {
  if (!supportsCPUModelSelection(architecture)) {
    return model === '' || model === 'host-passthrough';
  }

  return ARCHITECTURE_INDEPENDENT_CPU_MODELS.has(model) || availableModels.includes(model);
}

export function isMachineTypeCompatible(type: string, architecture: VMArchitecture): boolean {
  return MACHINE_TYPE_OPTIONS[architecture].some(option => option.value === type);
}
