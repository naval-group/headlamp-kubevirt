import { describe, expect, it } from 'vitest';
import { generateDeploymentOutput } from './deploymentStrategies';
import { OperatorInstall } from './helmValues';

const mockInstalls: OperatorInstall[] = [
  {
    id: 'kubevirt',
    chartName: 'kubevirt',
    chartUrl: 'oci://ghcr.io/naval-group/kubevirt-stack-charts/kubevirt',
    chartVersion: '0.2.0',
    values: { namespace: 'kubevirt', global: { imageRegistry: 'custom.io' } },
    displayName: 'KubeVirt',
  },
  {
    id: 'cdi',
    chartName: 'cdi',
    chartUrl: 'oci://ghcr.io/naval-group/kubevirt-stack-charts/cdi',
    chartVersion: '0.2.0',
    values: { namespace: 'cdi' },
    displayName: 'CDI',
  },
];

describe('generateDeploymentOutput', () => {
  it('generates per-operator helm commands for helm-install', () => {
    const output = generateDeploymentOutput('helm-install', mockInstalls, 'kubevirt');
    expect(output.perOperator).toHaveLength(2);
    expect(output.perOperator[0].helmCommand).toContain('helm install kubevirt');
    expect(output.perOperator[0].helmCommand).toContain('--version 0.2.0');
    expect(output.perOperator[0].helmCommand).toContain('-f kubevirt-values.yaml');
    expect(output.perOperator[1].helmCommand).toContain('helm install cdi');
    expect(output.perOperator[1].helmCommand).toContain('helm install cdi');
    expect(output.perOperator[1].helmCommand).toContain('--namespace cdi');
  });

  it('generates per-operator helm commands for helm-template', () => {
    const output = generateDeploymentOutput('helm-template', mockInstalls, 'kubevirt');
    expect(output.perOperator).toHaveLength(2);
    expect(output.perOperator[0].helmCommand).toContain('helm install kubevirt');
    expect(output.perOperator[1].helmCommand).toContain('helm install cdi');
  });

  it('generates ArgoCD Applications per operator', () => {
    const output = generateDeploymentOutput('argocd', mockInstalls, 'kubevirt');
    expect(output.resources).toHaveLength(2);

    const kvApp = output.resources[0] as Record<string, unknown>;
    expect(kvApp.kind).toBe('Application');
    expect(kvApp.apiVersion).toBe('argoproj.io/v1alpha1');
    const kvMeta = kvApp.metadata as Record<string, string>;
    expect(kvMeta.name).toBe('kubevirt');
    expect(kvMeta.namespace).toBe('argocd');

    const kvSpec = kvApp.spec as Record<string, unknown>;
    const source = kvSpec.source as Record<string, unknown>;
    expect(source.chart).toBe('kubevirt');
    expect(source.targetRevision).toBe('0.2.0');

    const cdiApp = output.resources[1] as Record<string, unknown>;
    const cdiMeta = cdiApp.metadata as Record<string, string>;
    expect(cdiMeta.name).toBe('cdi');
  });

  it('generates Flux HelmRepo + HelmRelease per operator', () => {
    const output = generateDeploymentOutput('flux', mockInstalls, 'kubevirt');
    // 2 operators × 2 resources each (HelmRepo + HelmRelease) = 4
    expect(output.resources).toHaveLength(4);

    const kinds = output.resources.map(r => (r as Record<string, unknown>).kind);
    expect(kinds.filter(k => k === 'HelmRepository')).toHaveLength(2);
    expect(kinds.filter(k => k === 'HelmRelease')).toHaveLength(2);
  });

  it('generates Rancher HelmChart CRs per operator', () => {
    const output = generateDeploymentOutput('rancher', mockInstalls, 'kubevirt');
    expect(output.resources).toHaveLength(2);

    const kvChart = output.resources[0] as Record<string, unknown>;
    expect(kvChart.kind).toBe('HelmChart');
    expect(kvChart.apiVersion).toBe('helm.cattle.io/v1');
    const kvMeta = kvChart.metadata as Record<string, string>;
    expect(kvMeta.name).toBe('kubevirt');
    expect(kvMeta.namespace).toBe('kube-system');

    const kvSpec = kvChart.spec as Record<string, unknown>;
    expect(kvSpec.chart).toBe('kubevirt');
    expect(kvSpec.targetNamespace).toBe('kubevirt');
  });

  it('includes values in ArgoCD Application helm section', () => {
    const output = generateDeploymentOutput('argocd', mockInstalls, 'kubevirt');
    const kvSpec = (output.resources[0] as Record<string, unknown>).spec as Record<string, unknown>;
    const source = kvSpec.source as Record<string, unknown>;
    const helm = source.helm as Record<string, unknown>;
    expect(helm.values).toContain('imageRegistry');

    // CDI has namespace value — should include it in helm values
    const cdiSpec = (output.resources[1] as Record<string, unknown>).spec as Record<
      string,
      unknown
    >;
    const cdiSource = cdiSpec.source as Record<string, unknown>;
    const cdiHelm = cdiSource.helm as Record<string, unknown>;
    expect(cdiHelm.values).toContain('namespace');
  });

  it('sets description with operator count', () => {
    const output = generateDeploymentOutput('argocd', mockInstalls, 'kubevirt');
    expect(output.description).toContain('2 operator(s)');
  });

  it('handles empty installs array', () => {
    const output = generateDeploymentOutput('argocd', [], 'kubevirt');
    expect(output.resources).toHaveLength(0);
    expect(output.perOperator).toHaveLength(0);
    expect(output.yaml).toBe('');
  });
});
