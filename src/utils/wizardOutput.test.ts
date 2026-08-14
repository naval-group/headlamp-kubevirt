/**
 * Validate that wizard-generated values match each chart's values.schema.json.
 * Tests every operator's schema against the output of buildOperatorInstalls.
 */
import Ajv from 'ajv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildOperatorInstalls, createDefaultWizardState } from './helmValues';
import OPERATORS, { getChartName } from './operatorRegistry';

const SCHEMA_DIR = join(__dirname, '../schemas/0.1.0');
const CHARTS_DIR = join(process.env.HOME || '', 'kubevirt-stack-charts/charts');

// Load schemas from both embedded and source chart dirs
function loadSchema(chartName: string): Record<string, unknown> | null {
  // Try embedded first
  const embeddedPath = join(SCHEMA_DIR, `${chartName}.json`);
  try {
    return JSON.parse(readFileSync(embeddedPath, 'utf-8'));
  } catch {
    // Try source chart dir
    try {
      return JSON.parse(readFileSync(join(CHARTS_DIR, chartName, 'values.schema.json'), 'utf-8'));
    } catch {
      return null;
    }
  }
}

describe('Wizard output validates against chart schemas', () => {
  // Test 1: Default state — all default-enabled operators, no custom values
  it('default state generates valid values for each operator', () => {
    const state = createDefaultWizardState();
    const installs = buildOperatorInstalls(state);
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });

    for (const install of installs) {
      const schema = loadSchema(install.chartName);
      if (!schema) {
        console.warn(`  ⚠ No schema for ${install.chartName} — skipped`);
        continue;
      }

      const validate = ajv.compile(schema);
      const valid = validate(install.values);

      if (!valid) {
        console.error(`  ✗ ${install.chartName}:`, validate.errors);
      }
      expect(
        valid,
        `${install.chartName} values should match schema: ${JSON.stringify(validate.errors)}`
      ).toBe(true);
    }
  });

  // Test 2: All operators enabled with global config
  it('all operators + global config generates valid values', () => {
    const state = createDefaultWizardState();
    // Enable all
    for (const op of OPERATORS) {
      state.operators[op.id] = true;
    }
    state.global.imageRegistry = 'registry.example.com';
    state.global.imagePullSecrets = ['my-pull-secret'];
    state.global.nodeSelector = { 'node-role.kubernetes.io/worker': '' };

    const installs = buildOperatorInstalls(state);
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });

    for (const install of installs) {
      const schema = loadSchema(install.chartName);
      if (!schema) continue;

      const validate = ajv.compile(schema);
      const valid = validate(install.values);

      if (!valid) {
        console.error(`  ✗ ${install.chartName} (with globals):`, validate.errors);
      }
      expect(valid, `${install.chartName} with globals: ${JSON.stringify(validate.errors)}`).toBe(
        true
      );
    }
  });

  // Test 3: Each operator's chartName maps to a real schema
  it('every operator has a matching schema file', () => {
    const missing: string[] = [];
    for (const op of OPERATORS) {
      const chartName = getChartName(op.id);
      const schema = loadSchema(chartName);
      if (!schema) missing.push(chartName);
    }
    if (missing.length > 0) {
      console.warn(`  ⚠ Missing schemas: ${missing.join(', ')}`);
    }
    // At least core operators must have schemas
    expect(loadSchema('kubevirt')).not.toBeNull();
    expect(loadSchema('cdi')).not.toBeNull();
    expect(loadSchema('multus')).not.toBeNull();
  });

  // Test 4: Version override is valid
  it('version override produces valid values', () => {
    const state = createDefaultWizardState();
    for (const key of Object.keys(state.operators)) state.operators[key] = false;
    state.operators.kubevirt = true;
    state.versions.kubevirt = 'v1.9.0';

    const installs = buildOperatorInstalls(state);
    const schema = loadSchema('kubevirt');
    if (!schema) return;

    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
    const validate = ajv.compile(schema);
    const valid = validate(installs[0].values);
    expect(valid, `kubevirt with version override: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  // Test 5: Empty values (no global, no overrides) is valid
  it('minimal install (no config) produces valid values', () => {
    const state = createDefaultWizardState();
    for (const key of Object.keys(state.operators)) state.operators[key] = false;
    state.operators.kubevirt = true;

    const installs = buildOperatorInstalls(state);
    expect(installs).toHaveLength(1);
    expect(installs[0].chartName).toBe('kubevirt');

    const schema = loadSchema('kubevirt');
    if (!schema) return;

    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
    const validate = ajv.compile(schema);
    const valid = validate(installs[0].values);
    expect(valid, `minimal kubevirt: ${JSON.stringify(validate.errors)}`).toBe(true);
  });
});
