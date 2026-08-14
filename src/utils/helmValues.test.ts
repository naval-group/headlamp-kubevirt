import { describe, expect, it } from 'vitest';
import { buildOperatorInstalls, createDefaultWizardState, valuesToYaml } from './helmValues';
import { getChartName, getChartUrl, getChartVersion, OCI_CHART_BASE } from './operatorRegistry';

describe('operatorRegistry helpers', () => {
  it('getChartName returns helmKey for operators with custom keys', () => {
    expect(getChartName('hostpathProvisioner')).toBe('hostpath-provisioner');
    expect(getChartName('butaneOperator')).toBe('butane-operator');
    expect(getChartName('vmConsoleProxy')).toBe('vm-console-proxy');
    expect(getChartName('cloudProvider')).toBe('cloud-provider-kubevirt');
    expect(getChartName('deleteProtection')).toBe('kubevirt-delete-protection');
    expect(getChartName('vmTemplates')).toBe('kubevirt-vm-templates');
    expect(getChartName('ipamController')).toBe('kubevirt-ipam-controller');
  });

  it('getChartName returns id for operators without helmKey', () => {
    expect(getChartName('kubevirt')).toBe('kubevirt');
    expect(getChartName('cdi')).toBe('cdi');
    expect(getChartName('multus')).toBe('multus');
    expect(getChartName('aaq')).toBe('aaq');
    expect(getChartName('forklift')).toBe('forklift');
    expect(getChartName('monitoring')).toBe('kubevirt-monitoring');
    expect(getChartName('kubemacpool')).toBe('kubemacpool');
  });

  it('getChartUrl builds OCI URL', () => {
    expect(getChartUrl('kubevirt')).toBe(`${OCI_CHART_BASE}/kubevirt`);
    expect(getChartUrl('hostpathProvisioner')).toBe(`${OCI_CHART_BASE}/hostpath-provisioner`);
  });

  it('getChartVersion returns 0.1.0 for all operators', () => {
    for (const id of ['kubevirt', 'cdi', 'multus', 'forklift', 'aaq']) {
      expect(getChartVersion(id)).toBe('0.2.0');
    }
  });
});

describe('createDefaultWizardState', () => {
  it('creates state with all operators and their default enabled status', () => {
    const state = createDefaultWizardState();
    expect(state.operators.kubevirt).toBe(true);
    expect(state.operators.cdi).toBe(true);
    expect(state.operators.multus).toBe(true);
    expect(state.operators.forklift).toBe(false);
    expect(state.operators.aaq).toBe(false);
    expect(state.operators.cloudProvider).toBe(false);
    expect(state.operators.hostpathProvisioner).toBe(false);
  });

  it('initializes empty global config', () => {
    const state = createDefaultWizardState();
    expect(state.global.imageRegistry).toBe('');
    expect(state.global.imagePullSecrets).toEqual([]);
    expect(state.global.nodeSelector).toEqual({});
    expect(state.global.tolerations).toEqual([]);
  });

  it('initializes empty versions and operatorValues', () => {
    const state = createDefaultWizardState();
    expect(state.versions).toEqual({});
    expect(state.operatorValues).toEqual({});
  });
});

describe('buildOperatorInstalls', () => {
  it('only includes enabled operators', () => {
    const state = createDefaultWizardState();
    state.operators = { kubevirt: true, cdi: true, multus: false, forklift: false };
    // Disable all others
    for (const key of Object.keys(state.operators)) {
      if (key !== 'kubevirt' && key !== 'cdi') state.operators[key] = false;
    }

    const installs = buildOperatorInstalls(state);
    const ids = installs.map(i => i.id);
    expect(ids).toContain('kubevirt');
    expect(ids).toContain('cdi');
    expect(ids).not.toContain('multus');
    expect(ids).not.toContain('forklift');
  });

  it('sets correct chartName and chartUrl for each install', () => {
    const state = createDefaultWizardState();
    // Enable only kubevirt and hostpathProvisioner
    for (const key of Object.keys(state.operators)) state.operators[key] = false;
    state.operators.kubevirt = true;
    state.operators.hostpathProvisioner = true;

    const installs = buildOperatorInstalls(state);
    const kv = installs.find(i => i.id === 'kubevirt')!;
    expect(kv.chartName).toBe('kubevirt');
    expect(kv.chartUrl).toBe(`${OCI_CHART_BASE}/kubevirt`);

    const hpp = installs.find(i => i.id === 'hostpathProvisioner')!;
    expect(hpp.chartName).toBe('hostpath-provisioner');
    expect(hpp.chartUrl).toBe(`${OCI_CHART_BASE}/hostpath-provisioner`);
  });

  it('includes operator values from schema form', () => {
    const state = createDefaultWizardState();
    for (const key of Object.keys(state.operators)) state.operators[key] = false;
    state.operators.kubevirt = true;
    state.operatorValues.kubevirt = { global: { imageRegistry: 'registry.example.com' } };

    const installs = buildOperatorInstalls(state);
    const kv = installs.find(i => i.id === 'kubevirt')!;
    expect(kv.values.global).toEqual({ imageRegistry: 'registry.example.com' });
  });

  it('omits values when no operator values set', () => {
    const state = createDefaultWizardState();
    for (const key of Object.keys(state.operators)) state.operators[key] = false;
    state.operators.kubevirt = true;

    const installs = buildOperatorInstalls(state);
    const kv = installs.find(i => i.id === 'kubevirt')!;
    expect(Object.keys(kv.values).length).toBe(0);
  });

  it('merges per-operator values from schema form', () => {
    const state = createDefaultWizardState();
    for (const key of Object.keys(state.operators)) state.operators[key] = false;
    state.operators.cdi = true;
    state.operatorValues.cdi = { uploadProxy: { enabled: true } };

    const installs = buildOperatorInstalls(state);
    const cdi = installs.find(i => i.id === 'cdi')!;
    expect(cdi.values.uploadProxy).toEqual({ enabled: true });
  });

  it('includes version override when set', () => {
    const state = createDefaultWizardState();
    for (const key of Object.keys(state.operators)) state.operators[key] = false;
    state.operators.kubevirt = true;
    state.versions.kubevirt = 'v1.9.0';

    const installs = buildOperatorInstalls(state);
    const kv = installs.find(i => i.id === 'kubevirt')!;
    expect(kv.values.version).toBe('v1.9.0');
  });

  it('deep merges nested operator values', () => {
    const state = createDefaultWizardState();
    for (const key of Object.keys(state.operators)) state.operators[key] = false;
    state.operators.kubevirt = true;
    state.operatorValues.kubevirt = {
      global: { imageRegistry: 'registry.example.com' },
      someConfig: { nested: true },
    };

    const installs = buildOperatorInstalls(state);
    const kv = installs.find(i => i.id === 'kubevirt')!;
    expect(kv.values.global).toEqual({ imageRegistry: 'registry.example.com' });
    expect(kv.values.someConfig).toEqual({ nested: true });
  });
});

describe('valuesToYaml', () => {
  it('serializes values to YAML', () => {
    const yaml = valuesToYaml({ key: 'value', nested: { a: 1 } });
    expect(yaml).toContain('key: value');
    expect(yaml).toContain('nested:');
    expect(yaml).toContain('a: 1');
  });
});
