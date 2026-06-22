/**
 * KubeVirt Install Wizard - Guides users from zero to running KubeVirt.
 * Shown when KubeVirt is not detected on the cluster.
 */

import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Editor from '@monaco-editor/react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { getGlobalSchema, getOperatorSchema } from '../../utils/chartSchemas';
import {
  applyResources,
  DEPLOYMENT_METHODS,
  DeploymentMethod,
  DeploymentMode,
  detectAvailableMethods,
  downloadFile,
  generateDeploymentOutput,
} from '../../utils/deploymentStrategies';
import {
  buildHelmValues,
  createDefaultWizardState,
  GlobalConfig,
  valuesToYaml,
  WizardState,
} from '../../utils/helmValues';
import {
  detectInstalledOperators,
  getStackInfo,
  readStackValues,
  useOperatorDetection,
} from '../../utils/operatorDetection';
import OPERATORS, {
  CATEGORY_COLORS,
  getOperatorsByCategory,
  OPERATOR_CATEGORIES,
  OperatorCategory,
} from '../../utils/operatorRegistry';
import SchemaForm from '../common/SchemaForm';
import OperatorCard from './OperatorCard';

const STEPS = ['Welcome', 'Operators', 'Configuration', 'Deployment', 'Review'];

const DEFAULT_CHART = {
  repoUrl: 'oci://ghcr.io/naval-group/helm-kubevirt',
  chartName: 'kubevirt-stack',
  chartVersion: '1.8.1',
};

// ── Reducer ─────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_OPERATOR'; id: string; enabled: boolean }
  | { type: 'SET_VERSION'; id: string; version: string }
  | { type: 'SET_GLOBAL'; global: Partial<WizardState['global']> }
  | { type: 'SET_OPERATOR_VALUES'; id: string; values: Record<string, unknown> }
  | { type: 'SET_METHOD'; method: DeploymentMethod }
  | { type: 'SET_MODE'; mode: DeploymentMode }
  | { type: 'RESET' };

interface FullState {
  wizard: WizardState;
  method: DeploymentMethod;
  mode: DeploymentMode;
}

function reducer(state: FullState, action: Action): FullState {
  switch (action.type) {
    case 'SET_OPERATOR': {
      const operators = { ...state.wizard.operators, [action.id]: action.enabled };
      // Auto-enable dependencies
      if (action.enabled) {
        const op = OPERATORS.find(o => o.id === action.id);
        if (op) {
          for (const dep of op.dependencies) {
            operators[dep] = true;
          }
        }
      }
      return { ...state, wizard: { ...state.wizard, operators } };
    }
    case 'SET_VERSION':
      return {
        ...state,
        wizard: {
          ...state.wizard,
          versions: { ...state.wizard.versions, [action.id]: action.version },
        },
      };
    case 'SET_GLOBAL':
      return {
        ...state,
        wizard: {
          ...state.wizard,
          global: { ...state.wizard.global, ...action.global },
        },
      };
    case 'SET_OPERATOR_VALUES':
      return {
        ...state,
        wizard: {
          ...state.wizard,
          operatorValues: {
            ...state.wizard.operatorValues,
            [action.id]: action.values,
          },
        },
      };
    case 'SET_METHOD':
      return { ...state, method: action.method };
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'RESET':
      return initialState();
    default:
      return state;
  }
}

function initialState(): FullState {
  return {
    wizard: createDefaultWizardState(),
    method: 'helm-template',
    mode: 'apply',
  };
}

// ── Component ───────────────────────────────────────────────────────

export default function InstallWizard() {
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();
  const [activeStep, setActiveStep] = useState(0);
  const [state, dispatch] = useReducer(reducer, initialState());
  const [availableMethods, setAvailableMethods] = useState<Record<DeploymentMethod, boolean>>(
    {} as Record<DeploymentMethod, boolean>
  );
  const [deploying, setDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState({ current: 0, total: 0, resource: '' });
  const [chartUrl, setChartUrl] = useState(DEFAULT_CHART.repoUrl);
  const [prereqs, setPrereqs] = useState<{
    checked: boolean;
    k8sVersion: string;
    canCreateCRDs: boolean | null;
    canCreateNamespaces: boolean | null;
    canCreateDeployments: boolean | null;
    allRbac: boolean | null;
    rbacDetails: string;
    storageClasses: string[];
  }>({
    checked: false,
    k8sVersion: '',
    canCreateCRDs: null,
    canCreateNamespaces: null,
    canCreateDeployments: null,
    allRbac: null,
    rbacDetails: '',
    storageClasses: [],
  });
  const [checkingPrereqs, setCheckingPrereqs] = useState(false);

  const operatorsByCategory = useMemo(() => getOperatorsByCategory(), []);
  const detection = useOperatorDetection();
  const kvInstalled = detection.operators.kubevirt?.status === 'installed';

  // Sync wizard state with detection: only enable installed operators + query params
  useEffect(() => {
    if (detection.loading) return;

    // Set operator enabled state based on detection
    for (const op of OPERATORS) {
      const isInstalled = detection.operators[op.id]?.status === 'installed';
      dispatch({ type: 'SET_OPERATOR', id: op.id, enabled: isInstalled });
    }

    // Handle ?enable= query param from catalog (pre-select additional operators)
    const params = new URLSearchParams(
      window.location.search || window.location.hash.split('?')[1] || ''
    );
    const enableParam = params.get('enable');
    const validIds = new Set(OPERATORS.map(o => o.id));
    if (enableParam) {
      enableParam
        .split(',')
        .map(id => id.trim())
        .filter(id => validIds.has(id))
        .forEach(id => {
          dispatch({ type: 'SET_OPERATOR', id, enabled: true });
        });
      setActiveStep(1); // Jump to Operators step
    }
    // Rehydrate from stack values if the chart is managed by us
    const stackInfo = getStackInfo();
    if (stackInfo.managed) {
      readStackValues().then(sv => {
        if (!sv.parsed) return;
        const g = sv.parsed.global;
        if (g) {
          dispatch({
            type: 'SET_GLOBAL',
            global: {
              imageRegistry: g.imageRegistry || '',
              imagePullSecrets: (g.imagePullSecrets || []).map((s: { name?: string } | string) =>
                typeof s === 'string' ? s : s.name || ''
              ),
              nodeSelector: g.nodeSelector || {},
              tolerations: g.tolerations || [],
            },
          });
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection.loading]);

  // Detect available deployment methods on mount
  useEffect(() => {
    detectAvailableMethods().then(setAvailableMethods);
  }, []);

  // Reset permission checks when method or mode changes
  useEffect(() => {
    setPrereqs(p => ({ ...p, checked: false }));
  }, [state.method, state.mode]);

  const checkPrerequisites = useCallback(async () => {
    setCheckingPrereqs(true);
    try {
      // K8s version
      let k8sVersion = '';
      try {
        const ver = (await ApiProxy.request('/version')) as { gitVersion?: string };
        k8sVersion = ver?.gitVersion || 'unknown';
      } catch {
        k8sVersion = 'unknown';
      }

      // SelfSubjectAccessReview checks
      const checkAccess = async (
        resource: string,
        verb: string,
        group: string
      ): Promise<boolean> => {
        try {
          const resp = (await ApiProxy.request(
            '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews',
            {
              method: 'POST',
              body: JSON.stringify({
                apiVersion: 'authorization.k8s.io/v1',
                kind: 'SelfSubjectAccessReview',
                spec: {
                  resourceAttributes: { verb, resource, group },
                },
              }),
              headers: { 'Content-Type': 'application/json' },
            }
          )) as { status?: { allowed?: boolean } };
          return resp?.status?.allowed ?? false;
        } catch {
          return false;
        }
      };

      const checks = await Promise.all([
        checkAccess('customresourcedefinitions', 'create', 'apiextensions.k8s.io'),
        checkAccess('namespaces', 'create', ''),
        checkAccess('deployments', 'create', 'apps'),
        checkAccess('serviceaccounts', 'create', ''),
        checkAccess('clusterroles', 'create', 'rbac.authorization.k8s.io'),
        checkAccess('clusterrolebindings', 'create', 'rbac.authorization.k8s.io'),
        checkAccess('roles', 'create', 'rbac.authorization.k8s.io'),
        checkAccess('rolebindings', 'create', 'rbac.authorization.k8s.io'),
        checkAccess('configmaps', 'create', ''),
        checkAccess('secrets', 'create', ''),
      ]);
      const [
        canCreateCRDs,
        canCreateNamespaces,
        canCreateDeployments,
        canCreateSAs,
        canCreateClusterRoles,
        canCreateClusterRoleBindings,
        canCreateRoles,
        canCreateRoleBindings,
        canCreateConfigMaps,
        canCreateSecrets,
      ] = checks;
      const allRbac =
        canCreateSAs &&
        canCreateClusterRoles &&
        canCreateClusterRoleBindings &&
        canCreateRoles &&
        canCreateRoleBindings &&
        canCreateConfigMaps &&
        canCreateSecrets;

      // Storage classes
      let storageClasses: string[] = [];
      try {
        const scResp = (await ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses')) as {
          items?: Array<{ metadata: { name: string } }>;
        };
        storageClasses = scResp?.items?.map(sc => sc.metadata.name) || [];
      } catch {
        // ignore
      }

      const missingRbac = [
        !canCreateSAs && 'ServiceAccounts',
        !canCreateClusterRoles && 'ClusterRoles',
        !canCreateClusterRoleBindings && 'ClusterRoleBindings',
        !canCreateRoles && 'Roles',
        !canCreateRoleBindings && 'RoleBindings',
        !canCreateConfigMaps && 'ConfigMaps',
        !canCreateSecrets && 'Secrets',
      ].filter(Boolean);

      setPrereqs({
        checked: true,
        k8sVersion,
        canCreateCRDs,
        canCreateNamespaces,
        canCreateDeployments,
        allRbac,
        rbacDetails: allRbac ? '' : `Missing: ${missingRbac.join(', ')}`,
        storageClasses,
      });
    } finally {
      setCheckingPrereqs(false);
    }
  }, []);

  // Which operators are locked (required as dependency by another enabled operator)
  const lockedOperators = useMemo(() => {
    const locked = new Set<string>();
    for (const op of OPERATORS) {
      if (state.wizard.operators[op.id]) {
        for (const dep of op.dependencies) {
          locked.add(dep);
        }
      }
    }
    return locked;
  }, [state.wizard.operators]);

  const selectedCount = useMemo(
    () => Object.values(state.wizard.operators).filter(Boolean).length,
    [state.wizard.operators]
  );

  const values = useMemo(() => buildHelmValues(state.wizard), [state.wizard]);

  const output = useMemo(
    () =>
      generateDeploymentOutput({
        method: state.method,
        mode: state.mode,
        chart: { ...DEFAULT_CHART, repoUrl: chartUrl },
        releaseName: 'kubevirt-stack',
        namespace: 'kubevirt',
        values,
      }),
    [state.method, state.mode, chartUrl, values]
  );

  const handleDeploy = useCallback(async () => {
    if (state.mode === 'download') {
      if (state.method === 'helm-install') {
        downloadFile(valuesToYaml(values), 'kubevirt-stack-values.yaml');
      } else {
        downloadFile(output.yaml, output.filename);
      }
      enqueueSnackbar('File downloaded', { variant: 'success' });
      return;
    }

    // Apply mode
    if (state.method === 'helm-template') {
      enqueueSnackbar(
        'For helm template + apply, download the manifests and run: helm template kubevirt-stack <chart> -f values.yaml | kubectl apply -f -',
        { variant: 'info' }
      );
      downloadFile(valuesToYaml(values), 'kubevirt-stack-values.yaml');
      return;
    }

    if (state.method === 'helm-install') {
      enqueueSnackbar(
        `Run: helm install kubevirt-stack ${chartUrl}/${DEFAULT_CHART.chartName} --version ${DEFAULT_CHART.chartVersion} -f values.yaml`,
        { variant: 'info' }
      );
      downloadFile(valuesToYaml(values), 'kubevirt-stack-values.yaml');
      return;
    }

    // GitOps modes (ArgoCD, Flux, Rancher) - apply the CR
    setDeploying(true);
    const result = await applyResources(output.resources, (current, total, resource) => {
      setDeployProgress({ current, total, resource });
    });

    if (result.success) {
      enqueueSnackbar(`${output.description} applied successfully`, { variant: 'success' });
      // Re-detect operators after a delay to pick up new installs
      setTimeout(() => {
        detectInstalledOperators().catch(() => {});
      }, 5000);
    } else {
      enqueueSnackbar(result.error || 'Deployment failed', { variant: 'error' });
    }
    setDeploying(false);
  }, [state, values, output, chartUrl, enqueueSnackbar]);

  return (
    <SectionBox
      title={
        <Box display="flex" alignItems="center" gap={1} py={1}>
          <Icon icon="mdi:rocket-launch" width={28} />
          <Typography variant="h5">Install KubeVirt</Typography>
        </Box>
      }
    >
      <Stepper activeStep={activeStep} sx={{ mt: 2, mb: 4 }}>
        {STEPS.map(label => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Step 0: Welcome */}
      {activeStep === 0 && (
        <Box textAlign="center" py={4}>
          <Icon
            icon={kvInstalled ? 'mdi:server-security' : 'mdi:server-plus'}
            width={80}
            style={{ opacity: 0.5 }}
          />
          <Typography variant="h5" mt={2} mb={1}>
            {kvInstalled
              ? 'Manage KubeVirt Operators'
              : 'KubeVirt is not installed on this cluster'}
          </Typography>
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ maxWidth: 600, mx: 'auto', mb: 3 }}
          >
            {kvInstalled
              ? 'KubeVirt is already running. Use this wizard to add or configure ecosystem operators.'
              : 'This wizard will guide you through installing KubeVirt and its ecosystem operators. You can choose which components to install and how to deploy them.'}
          </Typography>
          <Alert severity="info" sx={{ maxWidth: 600, mx: 'auto', textAlign: 'left' }}>
            <Typography variant="body2">
              <strong>Requirements:</strong> Kubernetes 1.30+ and appropriate permissions depending
              on the deployment method you choose. GitOps methods (ArgoCD, Flux, Rancher) require
              minimal permissions.
            </Typography>
          </Alert>
        </Box>
      )}

      {/* Step 1: Operator Selection */}
      {activeStep === 1 && (
        <Box>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Select the operators to install. Dependencies are automatically enabled.
            {selectedCount} operator{selectedCount !== 1 ? 's' : ''} selected.
          </Typography>

          {(Object.entries(operatorsByCategory) as [OperatorCategory, typeof OPERATORS][]).map(
            ([category, ops]) =>
              ops.length > 0 && (
                <Box key={category} mb={3}>
                  <Typography
                    variant="overline"
                    display="block"
                    mb={1}
                    sx={{
                      color: CATEGORY_COLORS[category],
                      borderLeft: `3px solid ${CATEGORY_COLORS[category]}`,
                      pl: 1,
                    }}
                  >
                    {OPERATOR_CATEGORIES[category]}
                  </Typography>
                  <Grid container spacing={2}>
                    {ops.map(op => (
                      <Grid item xs={12} sm={6} md={4} key={op.id}>
                        <OperatorCard
                          operator={op}
                          enabled={state.wizard.operators[op.id] ?? op.defaultEnabled}
                          onToggle={(id, enabled) =>
                            dispatch({ type: 'SET_OPERATOR', id, enabled })
                          }
                          version={state.wizard.versions[op.id]}
                          onVersionChange={(id, version) =>
                            dispatch({ type: 'SET_VERSION', id, version })
                          }
                          status={detection.operators[op.id]?.status}
                          locked={
                            lockedOperators.has(op.id) ||
                            detection.operators[op.id]?.status === 'installed'
                          }
                          showVersion
                          categoryColor={CATEGORY_COLORS[category]}
                        />
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )
          )}
        </Box>
      )}

      {/* Step 2: Configuration (schema-driven) */}
      {activeStep === 2 && (
        <Box>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Configure settings for each operator. Expand sections for advanced options.
          </Typography>

          {/* Global settings */}
          {(() => {
            const globalSchema = getGlobalSchema();
            return globalSchema ? (
              <Accordion
                defaultExpanded
                variant="outlined"
                sx={{ mb: 2, '&:before': { display: 'none' } }}
              >
                <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Icon icon="mdi:earth" width={20} />
                    <Typography variant="subtitle1" fontWeight={600}>
                      Global Settings
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <SchemaForm
                    schema={globalSchema}
                    values={{
                      global: {
                        imageRegistry: state.wizard.global.imageRegistry,
                        imagePullSecrets: state.wizard.global.imagePullSecrets,
                        nodeSelector: state.wizard.global.nodeSelector,
                        tolerations: state.wizard.global.tolerations,
                      },
                    }}
                    onChange={v => {
                      const g = (v.global as Record<string, unknown>) || {};
                      dispatch({
                        type: 'SET_GLOBAL',
                        global: {
                          imageRegistry: (g.imageRegistry as string) || '',
                          imagePullSecrets: (g.imagePullSecrets as string[]) || [],
                          nodeSelector: (g.nodeSelector as Record<string, string>) || {},
                          tolerations: (g.tolerations as GlobalConfig['tolerations']) || [],
                        },
                      });
                    }}
                    exclude={Object.keys(globalSchema.properties || {}).filter(k => k !== 'global')}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label="Chart Repository URL"
                    value={chartUrl}
                    onChange={e => setChartUrl(e.target.value)}
                    placeholder={DEFAULT_CHART.repoUrl}
                    helperText="Helm chart repository URL. Override for air-gap or custom chart locations."
                    sx={{ mt: 1 }}
                  />
                </AccordionDetails>
              </Accordion>
            ) : null;
          })()}

          {/* Per-operator settings — only for enabled operators */}
          {OPERATORS.filter(op => state.wizard.operators[op.id]).map(op => {
            const schema = getOperatorSchema(op.id);
            if (!schema) return null;
            return (
              <Accordion
                key={op.id}
                variant="outlined"
                sx={{
                  mb: 1,
                  '&:before': { display: 'none' },
                  borderLeft: `3px solid ${CATEGORY_COLORS[op.category]}`,
                }}
              >
                <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Icon icon={op.icon} width={20} color={CATEGORY_COLORS[op.category]} />
                    <Typography variant="subtitle2">{op.name}</Typography>
                    {detection.operators[op.id]?.status === 'installed' ? (
                      <Chip label="Installed" size="small" color="success" variant="outlined" />
                    ) : (
                      <Chip
                        label="+ New"
                        size="small"
                        variant="filled"
                        sx={{
                          bgcolor: CATEGORY_COLORS[op.category],
                          color: '#fff',
                          fontWeight: 600,
                        }}
                      />
                    )}
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <SchemaForm
                    schema={schema}
                    values={state.wizard.operatorValues[op.id] || {}}
                    onChange={v => dispatch({ type: 'SET_OPERATOR_VALUES', id: op.id, values: v })}
                    exclude={['enabled', 'global']}
                  />
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Box>
      )}

      {/* Step 3: Deployment Method */}
      {activeStep === 3 && (
        <Box>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Choose how to deploy the selected operators.
          </Typography>

          {/* Mode selector — first */}
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <Typography variant="body2" fontWeight={600}>
              Mode:
            </Typography>
            <RadioGroup
              row
              value={state.mode}
              onChange={e => dispatch({ type: 'SET_MODE', mode: e.target.value as DeploymentMode })}
            >
              <FormControlLabel
                value="apply"
                control={<Radio size="small" />}
                label={
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <Icon icon="mdi:rocket-launch" width={16} />
                    <Typography variant="body2">Apply to this cluster</Typography>
                  </Box>
                }
              />
              <FormControlLabel
                value="download"
                control={<Radio size="small" />}
                label={
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <Icon icon="mdi:download" width={16} />
                    <Typography variant="body2">Download for another cluster</Typography>
                  </Box>
                }
              />
            </RadioGroup>
          </Box>

          {/* Method selector — gated by mode */}
          <FormControl sx={{ mb: 3 }}>
            <RadioGroup
              value={state.method}
              onChange={e =>
                dispatch({ type: 'SET_METHOD', method: e.target.value as DeploymentMethod })
              }
            >
              {DEPLOYMENT_METHODS.map(m => {
                // In apply mode, only show methods detected on this cluster
                // In download mode, all methods are available (generating files for another cluster)
                const detected = availableMethods[m.id] !== false;
                const available = state.mode === 'download' || detected;
                return (
                  <Box
                    key={m.id}
                    sx={{
                      border: 1,
                      borderColor: state.method === m.id ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      p: 2,
                      mb: 1,
                      cursor: available ? 'pointer' : 'default',
                      opacity: available ? 1 : 0.5,
                    }}
                    onClick={() => available && dispatch({ type: 'SET_METHOD', method: m.id })}
                  >
                    <FormControlLabel
                      value={m.id}
                      control={<Radio size="small" />}
                      disabled={!available}
                      label={
                        <Box display="flex" alignItems="center" gap={1}>
                          <Icon icon={m.icon} width={20} />
                          <Typography variant="subtitle2">{m.name}</Typography>
                          {!available && (
                            <Chip
                              label="Not detected on this cluster"
                              size="small"
                              color="warning"
                              variant="outlined"
                            />
                          )}
                        </Box>
                      }
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                      {m.description}
                    </Typography>
                  </Box>
                );
              })}
            </RadioGroup>
          </FormControl>

          {state.mode === 'apply' && (
            <Box mt={3}>
              {!prereqs.checked ? (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={checkPrerequisites}
                  disabled={checkingPrereqs}
                  startIcon={<Icon icon={checkingPrereqs ? 'mdi:loading' : 'mdi:shield-check'} />}
                >
                  {checkingPrereqs ? 'Checking permissions...' : 'Check cluster permissions'}
                </Button>
              ) : (
                <Box>
                  <Typography variant="subtitle2" mb={1}>
                    Cluster Permissions
                  </Typography>
                  {(state.method === 'helm-template' || state.method === 'helm-install'
                    ? [
                        {
                          label: `Kubernetes ${prereqs.k8sVersion}`,
                          ok: prereqs.k8sVersion !== 'unknown',
                        },
                        { label: 'Create CRDs', ok: prereqs.canCreateCRDs },
                        { label: 'Create Namespaces', ok: prereqs.canCreateNamespaces },
                        { label: 'Create Deployments', ok: prereqs.canCreateDeployments },
                        {
                          label: 'RBAC & Resources (SA, Roles, Bindings, ConfigMaps, Secrets)',
                          ok: prereqs.allRbac,
                          detail: prereqs.rbacDetails,
                        },
                      ]
                    : [
                        {
                          label: `Kubernetes ${prereqs.k8sVersion}`,
                          ok: prereqs.k8sVersion !== 'unknown',
                        },
                        {
                          label: `Create ${
                            DEPLOYMENT_METHODS.find(m => m.id === state.method)?.name
                          } CR`,
                          ok: prereqs.canCreateCRDs,
                        },
                      ]
                  ).map((check, i) => (
                    <Box key={i} display="flex" alignItems="center" gap={1} mb={0.5}>
                      <Icon
                        icon={
                          check.ok === null
                            ? 'mdi:help-circle-outline'
                            : check.ok
                            ? 'mdi:check-circle'
                            : 'mdi:alert-circle'
                        }
                        width={18}
                        style={{
                          color: check.ok === null ? '#888' : check.ok ? '#4caf50' : '#f44336',
                        }}
                      />
                      <Typography variant="body2">{check.label}</Typography>
                      {'detail' in check && check.detail && (
                        <Typography variant="caption" color="text.secondary">
                          {check.detail}
                        </Typography>
                      )}
                    </Box>
                  ))}
                  {state.method !== 'helm-template' && state.method !== 'helm-install' && (
                    <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                      <Icon icon="mdi:information-outline" width={18} style={{ color: '#888' }} />
                      <Typography variant="body2" color="text.secondary">
                        The controller handles CRDs, Deployments, and RBAC
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Step 4: Review & Deploy */}
      {activeStep === 4 && (
        <Box>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {output.description}
          </Typography>

          <Box display="flex" gap={1} flexWrap="wrap" mb={2}>
            {OPERATORS.filter(op => state.wizard.operators[op.id]).map(op => (
              <Chip
                key={op.id}
                label={`${op.name} ${state.wizard.versions[op.id] || op.version}`}
                size="small"
                icon={<Icon icon={op.icon} width={16} />}
              />
            ))}
          </Box>

          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden',
              mb: 2,
            }}
          >
            <Editor
              height="400px"
              language="yaml"
              theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
              value={
                state.method === 'helm-install' || state.method === 'helm-template'
                  ? valuesToYaml(values)
                  : output.yaml
              }
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                fontSize: 12,
                tabSize: 2,
              }}
            />
          </Box>

          {(state.method === 'helm-install' || state.method === 'helm-template') && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                {state.method === 'helm-install' ? (
                  <>
                    Run:{' '}
                    <code>
                      helm install kubevirt-stack {chartUrl}/{DEFAULT_CHART.chartName} --version{' '}
                      {DEFAULT_CHART.chartVersion} -f values.yaml
                    </code>
                  </>
                ) : (
                  <>
                    Run:{' '}
                    <code>
                      helm template kubevirt-stack {chartUrl}/{DEFAULT_CHART.chartName} --version{' '}
                      {DEFAULT_CHART.chartVersion} -f values.yaml | kubectl apply -f -
                    </code>
                  </>
                )}
              </Typography>
            </Alert>
          )}

          {deploying && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                Applying {deployProgress.current}/{deployProgress.total}: {deployProgress.resource}
              </Typography>
            </Alert>
          )}
        </Box>
      )}

      {/* Navigation */}
      <Box display="flex" justifyContent="space-between" mt={4}>
        <Button
          disabled={activeStep === 0}
          onClick={() => setActiveStep(s => s - 1)}
          startIcon={<Icon icon="mdi:arrow-left" />}
        >
          Back
        </Button>
        <Box display="flex" gap={1}>
          {activeStep < STEPS.length - 1 ? (
            <Button
              variant="contained"
              onClick={() => setActiveStep(s => s + 1)}
              endIcon={<Icon icon="mdi:arrow-right" />}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={handleDeploy}
              disabled={deploying}
              startIcon={
                <Icon icon={state.mode === 'download' ? 'mdi:download' : 'mdi:rocket-launch'} />
              }
            >
              {deploying ? 'Deploying...' : state.mode === 'download' ? 'Download' : 'Deploy'}
            </Button>
          )}
        </Box>
      </Box>
    </SectionBox>
  );
}
