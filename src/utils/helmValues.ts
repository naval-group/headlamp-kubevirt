/**
 * Builds a Helm values.yaml object from wizard/marketplace state.
 * Maps the UI selections to the kubevirt-stack chart's values structure.
 */

import yaml from 'js-yaml';
import OPERATORS, { getHelmKey } from './operatorRegistry';

export interface WizardState {
  /** Map of operator ID -> enabled/disabled */
  operators: Record<string, boolean>;
  /** Per-operator version overrides */
  versions: Record<string, string>;
  /** Global configuration */
  global: GlobalConfig;
  /** Per-operator values (from schema form) */
  operatorValues: Record<string, Record<string, unknown>>;
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

/** Deep merge two objects (b overrides a) */
function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...a };
  for (const [key, val] of Object.entries(b)) {
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>
      );
    } else {
      result[key] = val;
    }
  }
  return result;
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

  // Build per-operator values from registry (single source of truth)
  for (const op of OPERATORS) {
    const key = getHelmKey(op.id);
    const enabled = state.operators[op.id] ?? op.defaultEnabled;

    // KubeVirt is always present (no enabled flag)
    if (op.id === 'kubevirt') {
      values[key] = {
        ...(state.versions[op.id] ? { version: state.versions[op.id] } : {}),
      };
    } else {
      values[key] = {
        enabled,
        ...(state.versions[op.id] ? { version: state.versions[op.id] } : {}),
      };
    }

    // Deep merge per-operator values from schema form
    const opValues = state.operatorValues[op.id];
    if (opValues && values[key] && typeof values[key] === 'object') {
      values[key] = deepMerge(values[key] as Record<string, unknown>, opValues);
    }
  }

  return values;
}

/** Create a default wizard state from the operator registry */
export function createDefaultWizardState(): WizardState {
  const operators: Record<string, boolean> = {};
  for (const op of OPERATORS) {
    operators[op.id] = op.defaultEnabled;
  }

  return {
    operators,
    versions: {},
    operatorValues: {},
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
