/**
 * Builds a Helm values.yaml object from wizard/marketplace state.
 * Maps the UI selections to the kubevirt-stack chart's values structure.
 */

import yaml from 'js-yaml';

export interface WizardState {
  /** Map of operator ID -> enabled/disabled */
  operators: Record<string, boolean>;
  /** Per-operator version overrides */
  versions: Record<string, string>;
  /** Global configuration */
  global: GlobalConfig;
}

export interface GlobalConfig {
  imageRegistry: string;
  imagePullSecrets: string[];
  nodeSelector: Record<string, string>;
  tolerations: Array<{
    key?: string;
    operator?: string;
    value?: string;
    effect?: string;
  }>;
}

/** Build a complete values.yaml object from wizard state */
export function buildHelmValues(state: WizardState): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  // Global settings
  values.global = {
    imageRegistry: state.global.imageRegistry || '',
    imagePullSecrets:
      state.global.imagePullSecrets.length > 0
        ? state.global.imagePullSecrets.map(name => ({ name }))
        : [],
    nodeSelector:
      Object.keys(state.global.nodeSelector).length > 0 ? state.global.nodeSelector : {},
    tolerations: state.global.tolerations.length > 0 ? state.global.tolerations : [],
  };

  // KubeVirt (always present)
  if (state.operators.kubevirt !== false) {
    values.kubevirt = {
      version: state.versions.kubevirt || 'v1.8.1',
    };
  }

  // CDI
  values.cdi = {
    enabled: state.operators.cdi ?? true,
    ...(state.versions.cdi ? { version: state.versions.cdi } : {}),
  };

  // Multus
  values.multus = {
    enabled: state.operators.multus ?? true,
  };

  // KubeMacPool
  values.kubemacpool = {
    enabled: state.operators.kubemacpool ?? true,
  };

  // AAQ
  values.aaq = {
    enabled: state.operators.aaq ?? false,
    ...(state.versions.aaq ? { version: state.versions.aaq } : {}),
  };

  // HostPath Provisioner
  values.hostpathProvisioner = {
    enabled: state.operators.hostpathProvisioner ?? false,
  };

  // Butane Operator
  values.butaneOperator = {
    enabled: state.operators.butaneOperator ?? true,
  };

  // VM Console Proxy
  values.vmConsoleProxy = {
    enabled: state.operators.vmConsoleProxy ?? true,
  };

  // Forklift
  values.forklift = {
    enabled: state.operators.forklift ?? false,
  };

  // Cloud Provider
  values.cloudProvider = {
    enabled: state.operators.cloudProvider ?? false,
  };

  // Monitoring
  values.monitoring = {
    enabled: state.operators.monitoring ?? true,
  };

  // Delete Protection
  values.deleteProtection = {
    enabled: state.operators.deleteProtection ?? true,
  };

  return values;
}

/** Create a default wizard state with default-enabled operators */
export function createDefaultWizardState(): WizardState {
  return {
    operators: {
      kubevirt: true,
      cdi: true,
      multus: true,
      kubemacpool: true,
      aaq: false,
      hostpathProvisioner: false,
      butaneOperator: true,
      vmConsoleProxy: true,
      forklift: false,
      cloudProvider: false,
      monitoring: true,
      deleteProtection: true,
    },
    versions: {},
    global: {
      imageRegistry: '',
      imagePullSecrets: [],
      nodeSelector: {},
      tolerations: [],
    },
  };
}

/** Serialize values to YAML string */
export function valuesToYaml(values: Record<string, unknown>): string {
  return yaml.dump(values, { lineWidth: -1, noRefs: true });
}
