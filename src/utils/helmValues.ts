/**
 * Builds per-operator Helm values from wizard state.
 * Each operator is an independent chart — no umbrella chart.
 */

import yaml from 'js-yaml';
import OPERATORS, { getChartName, getChartVersion, OCI_CHART_BASE } from './operatorRegistry';

export interface WizardState {
  /** Map of operator ID -> enabled/disabled */
  operators: Record<string, boolean>;
  /** Per-operator version overrides */
  versions: Record<string, string>;
  /** Global configuration (applied to each chart's global section) */
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

/** Per-operator chart install descriptor */
export interface OperatorInstall {
  /** Operator ID */
  id: string;
  /** Chart name (kebab-case) */
  chartName: string;
  /** Full OCI URL */
  chartUrl: string;
  /** Chart version */
  chartVersion: string;
  /** Helm values for this chart */
  values: Record<string, unknown>;
  /** Display name */
  displayName: string;
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

/** Build per-operator install descriptors for all selected operators */
export function buildOperatorInstalls(state: WizardState): OperatorInstall[] {
  const installs: OperatorInstall[] = [];

  for (const op of OPERATORS) {
    const enabled = state.operators[op.id] ?? op.defaultEnabled;
    if (!enabled) continue;

    const chartName = getChartName(op.id);
    let values: Record<string, unknown> = {};

    // Per-operator values from schema form (includes global section if configured)
    const opValues = state.operatorValues[op.id];
    if (opValues) {
      values = deepMerge(values, opValues);
    }

    // Add version override if set
    if (state.versions[op.id]) {
      values.version = state.versions[op.id];
    }

    installs.push({
      id: op.id,
      chartName,
      chartUrl: `${OCI_CHART_BASE}/${chartName}`,
      chartVersion: getChartVersion(op.id),
      values,
      displayName: op.name,
    });
  }

  return installs;
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
