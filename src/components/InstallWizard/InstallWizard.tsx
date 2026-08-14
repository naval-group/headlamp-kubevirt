/**
 * KubeVirt Install Wizard - Guides users from zero to running KubeVirt.
 * Shown when KubeVirt is not detected on the cluster.
 */

import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import yaml from 'js-yaml';
import { useSnackbar } from 'notistack';
import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { getOperatorSchema } from '../../utils/chartSchemas';
import {
  applyResources,
  DEPLOYMENT_METHODS,
  DeploymentMethod,
  DeploymentMode,
  detectAvailableMethods,
  downloadFile,
  fetchExistingValues,
  generateDeploymentOutput,
} from '../../utils/deploymentStrategies';
import {
  buildOperatorInstalls,
  createDefaultWizardState,
  GlobalConfig,
  valuesToYaml,
  WizardState,
} from '../../utils/helmValues';
import { getStackInfo, readStackValues, useOperatorDetection } from '../../utils/operatorDetection';
import { getAppsChartUrl, getChartName } from '../../utils/operatorRegistry';
import OPERATORS, {
  CATEGORY_COLORS,
  getOperatorsByCategory,
  OPERATOR_CATEGORIES,
  OperatorCategory,
} from '../../utils/operatorRegistry';
import SchemaForm from '../common/SchemaForm';
import OperatorCard from './OperatorCard';

const STEPS = ['Welcome', 'Operators', 'Configuration', 'Deployment', 'Review'];

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
    method: 'helm-install',
    mode: 'apply',
  };
}

// ── Component ───────────────────────────────────────────────────────

export default function InstallWizard() {
  const { enqueueSnackbar } = useSnackbar();
  const [activeStep, setActiveStep] = useState(0);
  const [state, dispatch] = useReducer(reducer, initialState());
  const [availableMethods, setAvailableMethods] = useState<Record<DeploymentMethod, boolean>>(
    {} as Record<DeploymentMethod, boolean>
  );
  const [deploying, setDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState({ current: 0, total: 0, resource: '' });
  const [deployResult, setDeployResult] = useState<{
    success: boolean;
    message: string;
    operators: string[];
  } | null>(null);
  const [crNamespace, setCrNamespace] = useState('flux-system');
  const [clusterNamespaces, setClusterNamespaces] = useState<string[]>([]);
  const [existingValues, setExistingValues] = useState<
    Record<string, Record<string, unknown> | null>
  >({});
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
  const stackInfo = getStackInfo();

  // Sync wizard state with detection: only enable installed operators + query params
  useEffect(() => {
    if (detection.loading) return;

    // Set operator enabled state based on detection
    for (const op of OPERATORS) {
      const isInstalled = detection.operators[op.id]?.status === 'installed';
      dispatch({ type: 'SET_OPERATOR', id: op.id, enabled: isInstalled });
    }

    // Handle ?enable= query param from catalog (pre-select additional operators)
    const hashQuery =
      window.location.hash.indexOf('?') !== -1
        ? window.location.hash.substring(window.location.hash.indexOf('?') + 1)
        : '';
    const params = new URLSearchParams(window.location.search || hashQuery);
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
    // Rehydrate from stack values if charts are managed by us
    const si = getStackInfo();
    if (si.managed) {
      readStackValues().then(sv => {
        // Rehydrate global config from the first chart that has one
        for (const vals of Object.values(sv.perOperator)) {
          const g = vals?.global as Record<string, unknown> | undefined;
          if (g) {
            dispatch({
              type: 'SET_GLOBAL',
              global: {
                imageRegistry: (g.imageRegistry as string) || '',
                imagePullSecrets: (
                  (g.imagePullSecrets as Array<{ name?: string } | string>) || []
                ).map((s: { name?: string } | string) =>
                  typeof s === 'string' ? s : s.name || ''
                ),
                nodeSelector: (g.nodeSelector as Record<string, string>) || {},
                tolerations: (g.tolerations as GlobalConfig['tolerations']) || [],
              },
            });
            break; // global is the same across all charts
          }
        }
        // Rehydrate per-operator values
        for (const [chartName, vals] of Object.entries(sv.perOperator)) {
          // Find the operator ID for this chart name
          const op = OPERATORS.find(o => getChartName(o.id) === chartName);
          if (op && vals) {
            // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
            const { global: _, ...opVals } = vals;
            if (Object.keys(opVals).length > 0) {
              dispatch({ type: 'SET_OPERATOR_VALUES', id: op.id, values: opVals });
            }
          }
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection.loading]);

  // Detect available deployment methods on mount and auto-select best one
  useEffect(() => {
    detectAvailableMethods().then(methods => {
      setAvailableMethods(methods);
      // Auto-select best available method
      if (methods.rancher) dispatch({ type: 'SET_METHOD', method: 'rancher' });
      else if (methods.flux) dispatch({ type: 'SET_METHOD', method: 'flux' });
      else if (methods.argocd) dispatch({ type: 'SET_METHOD', method: 'argocd' });
    });
  }, []);

  // Fetch cluster namespaces for CR namespace selector
  useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((resp: { items?: Array<{ metadata: { name: string } }> }) => {
        setClusterNamespaces((resp?.items || []).map(n => n.metadata.name).sort());
      })
      .catch(e => console.warn('[kubevirt] Failed to fetch namespaces:', e));
  }, []);

  // Reset permission checks and CR namespace when method changes
  useEffect(() => {
    setPrereqs(p => ({ ...p, checked: false }));
    if (state.method === 'flux') setCrNamespace('flux-system');
    else if (state.method === 'argocd') setCrNamespace('argocd');
    else if (state.method === 'rancher') setCrNamespace('kube-system');
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

  // Include new operators + managed operators with modified values (for updates)
  const installs = useMemo(() => {
    const allInstalls = buildOperatorInstalls(state.wizard);
    return allInstalls.filter(i => {
      const det = detection.operators[i.id];
      if (det?.status !== 'installed') return true; // new operator
      // Managed operator with modified values → include for update
      const chart = stackInfo.charts[getChartName(i.id)];
      if (chart && Object.keys(i.values).length > 0) return true;
      return false;
    });
  }, [state.wizard, detection.operators, stackInfo]);

  // If all installs are updates, detect the common install method and lock to it
  const forcedMethod = useMemo((): DeploymentMethod | null => {
    if (installs.length === 0) return null;
    const allUpdates = installs.every(i => !!stackInfo.charts[getChartName(i.id)]);
    if (!allUpdates) return null;
    const methods = installs
      .map(i => stackInfo.charts[getChartName(i.id)]?.installMethod)
      .filter(Boolean);
    if (methods.length === 0) return null;
    const unique = [...new Set(methods)];
    if (unique.length !== 1) return null; // mixed methods — can't lock
    const methodMap: Record<string, DeploymentMethod> = {
      flux: 'flux',
      argocd: 'argocd',
      rancher: 'rancher',
      'helm-cli': 'helm-install',
    };
    return methodMap[unique[0]!] || null;
  }, [installs, stackInfo]);

  // Auto-set method when forced
  useEffect(() => {
    if (forcedMethod && state.method !== forcedMethod) {
      dispatch({ type: 'SET_METHOD', method: forcedMethod });
    }
  }, [forcedMethod, state.method]);

  // Fetch existing values for updates when entering review step
  useEffect(() => {
    if (activeStep !== 4) return;
    const updateInstalls = installs.filter(i => !!stackInfo.charts[getChartName(i.id)]);
    if (updateInstalls.length === 0) return;
    Promise.all(
      updateInstalls.map(async i => {
        const chart = stackInfo.charts[getChartName(i.id)];
        const existing = chart?.installMethod
          ? await fetchExistingValues(i.chartName, chart.installMethod)
          : null;
        return [i.chartName, existing] as const;
      })
    ).then(results => {
      setExistingValues(Object.fromEntries(results));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);

  const output = useMemo(
    () => generateDeploymentOutput(state.method, installs, 'kubevirt', crNamespace),
    [state.method, installs, crNamespace]
  );

  const handleDeploy = useCallback(async () => {
    if (state.mode === 'download') {
      if (state.method === 'helm-install' || state.method === 'helm-template') {
        // Download per-operator values files as a combined YAML
        const combined = installs
          .map(i => {
            const header = `# ${i.displayName} (${i.chartName})\n# helm install ${i.chartName} ${i.chartUrl} --version ${i.chartVersion} -n kubevirt --create-namespace\n`;
            return (
              header +
              (Object.keys(i.values).length > 0 ? valuesToYaml(i.values) : '# (no custom values)\n')
            );
          })
          .join('---\n');
        downloadFile(combined, 'kubevirt-operators-values.yaml');
      } else {
        downloadFile(output.yaml, output.filename);
      }
      enqueueSnackbar('File downloaded', { variant: 'success' });
      return;
    }

    // Apply mode — helm CLI methods can't apply directly, download instructions
    if (state.method === 'helm-template' || state.method === 'helm-install') {
      const commands = output.perOperator
        .map(p => p.helmCommand)
        .filter(Boolean)
        .join('\n\n');
      enqueueSnackbar(
        `${installs.length} operator(s) selected. Run the helm commands shown in the review step.`,
        { variant: 'info' }
      );
      downloadFile(commands, 'kubevirt-install-commands.sh');
      return;
    }

    const operatorNames = installs.map(i => i.displayName);

    // GitOps modes (ArgoCD, Flux, Rancher) - apply the CR
    setDeploying(true);
    const result = await applyResources(output.resources, (current, total, resource) => {
      setDeployProgress({ current, total, resource });
    });
    setDeploying(false);
    setDeployResult({
      success: result.success,
      message: result.success
        ? `${output.description} applied successfully`
        : result.error || 'Deployment failed',
      operators: operatorNames,
    });
  }, [state, installs, output, enqueueSnackbar]);

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
                          managed={
                            stackInfo.managed ? !!stackInfo.charts[getChartName(op.id)] : false
                          }
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

          {/* Per-operator settings — only for enabled operators, skip externally installed */}
          {OPERATORS.filter(op => state.wizard.operators[op.id]).map(op => {
            const schema = getOperatorSchema(op.id);
            if (!schema) return null;
            const isExternal =
              detection.operators[op.id]?.status === 'installed' &&
              !(stackInfo.managed && stackInfo.charts[getChartName(op.id)]);
            const isInstalled = detection.operators[op.id]?.status === 'installed';

            if (isExternal) {
              return (
                <Box
                  key={op.id}
                  sx={{
                    mb: 1,
                    p: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    borderLeft: `3px solid ${CATEGORY_COLORS[op.category]}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    opacity: 0.7,
                  }}
                >
                  <Icon icon={op.icon} width={20} color={CATEGORY_COLORS[op.category]} />
                  <Typography variant="subtitle2">{op.name}</Typography>
                  <Chip label="External" size="small" variant="outlined" />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    Managed externally — use Apps or CLI to reconfigure
                  </Typography>
                </Box>
              );
            }

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
                    {isInstalled ? (
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
                    exclude={['enabled']}
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
                    <Typography variant="body2">Download manifests</Typography>
                  </Box>
                }
              />
            </RadioGroup>
          </Box>

          {/* Locked method for updates */}
          {forcedMethod && state.mode === 'apply' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Deployment method locked to match how these operators were originally installed.
            </Alert>
          )}

          {/* Method selector — gated by mode */}
          <FormControl sx={{ mb: 3 }}>
            <RadioGroup
              value={state.method}
              onChange={e =>
                !forcedMethod &&
                dispatch({ type: 'SET_METHOD', method: e.target.value as DeploymentMethod })
              }
            >
              {DEPLOYMENT_METHODS.filter(m => {
                if (m.id === 'helm-template') return false;
                if (state.mode === 'download' && m.id === 'helm-install') return false;
                return true;
              }).map(m => {
                const detected = availableMethods[m.id] !== false;
                const locked = forcedMethod && state.mode === 'apply' && m.id !== forcedMethod;
                const available = (state.mode === 'download' || detected) && !locked;
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

          {/* CR namespace for GitOps methods */}
          {!['helm-install', 'helm-template'].includes(state.method) && (
            <Box sx={{ mt: 2, maxWidth: 400 }}>
              <Autocomplete
                freeSolo
                options={clusterNamespaces}
                value={crNamespace}
                onInputChange={(_, v) => setCrNamespace(v)}
                size="small"
                renderInput={params => (
                  <TextField
                    {...params}
                    label="CR Namespace"
                    helperText={
                      state.method === 'flux'
                        ? 'Namespace where Flux CRs will be created'
                        : state.method === 'argocd'
                        ? 'Namespace where ArgoCD Application CRs will be created'
                        : state.method === 'rancher'
                        ? 'Namespace where Rancher HelmChart CRs will be created'
                        : 'Namespace for the GitOps CRs'
                    }
                  />
                )}
              />
            </Box>
          )}

          {state.mode === 'apply' && state.method !== 'helm-install' && (
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
                  {(state.method === 'helm-template'
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
                  {state.method !== 'helm-template' && (
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
          {/* Deploy result panel */}
          {deployResult ? (
            <Box textAlign="center" py={4}>
              <Icon
                icon={deployResult.success ? 'mdi:check-circle' : 'mdi:alert-circle'}
                width={64}
                color={deployResult.success ? '#4caf50' : '#f44336'}
              />
              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {deployResult.success ? 'Deployment Successful' : 'Deployment Failed'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {deployResult.message}
              </Typography>
              <Box display="flex" gap={1} justifyContent="center" flexWrap="wrap" mb={3}>
                {deployResult.operators.map((name, i) => (
                  <Chip
                    key={i}
                    label={name}
                    size="small"
                    color={deployResult.success ? 'success' : 'error'}
                    variant="outlined"
                  />
                ))}
              </Box>
              {deployResult.success && (
                <Typography variant="caption" color="text.secondary">
                  Operators may take a few minutes to become fully ready. Check the Operator Catalog
                  for status.
                </Typography>
              )}
            </Box>
          ) : deploying ? (
            <Box textAlign="center" py={4}>
              <CircularProgress size={48} sx={{ mb: 2 }} />
              <Typography variant="h6" sx={{ mb: 1 }}>
                Deploying...
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {deployProgress.resource} ({deployProgress.current}/{deployProgress.total})
              </Typography>
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {output.description}
              </Typography>

              {/* Per-operator breakdown */}
              {output.perOperator.map((p, i) => {
                const install = installs.find(inst => inst.chartName === p.chartName);
                const hasVals = install && Object.keys(install.values).length > 0;
                const op = OPERATORS.find(o => getChartName(o.id) === p.chartName);
                const chart = stackInfo.charts[p.chartName];
                const isUpdate = !!chart;
                return (
                  <Box
                    key={i}
                    sx={{
                      border: 1,
                      borderColor: isUpdate ? 'info.main' : 'divider',
                      borderRadius: 1,
                      p: 2,
                      mb: 1.5,
                    }}
                  >
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Icon icon={op?.icon || 'mdi:package-variant'} width={20} />
                      <Typography variant="subtitle2">{p.displayName}</Typography>
                      <Chip
                        label={`${p.chartName}:${p.chartVersion}`}
                        size="small"
                        variant="outlined"
                      />
                      <Chip
                        label={isUpdate ? 'Update' : 'Install'}
                        size="small"
                        color={isUpdate ? 'info' : 'success'}
                        variant="outlined"
                      />
                      {chart?.installMethod && (
                        <Chip
                          label={`via ${chart.installMethod}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: '0.7rem' }}
                        />
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                        {hasVals ? 'Custom values' : 'Default values'}
                      </Typography>
                    </Box>
                    {!isUpdate && p.helmCommand ? (
                      <Box
                        component="pre"
                        sx={{
                          bgcolor: 'action.hover',
                          color: 'text.primary',
                          p: 1.5,
                          m: 0,
                          borderRadius: 1,
                          fontSize: '0.78rem',
                          overflow: 'auto',
                          userSelect: 'all',
                        }}
                      >
                        {p.helmCommand}
                      </Box>
                    ) : null}
                    {/* Values view for updates */}
                    {isUpdate && hasVals && (
                      <Box sx={{ mt: 1 }}>
                        {existingValues[p.chartName] &&
                        Object.keys(existingValues[p.chartName]!).length > 0 ? (
                          <>
                            <Typography
                              variant="caption"
                              fontWeight={600}
                              color="text.secondary"
                              sx={{ mb: 0.5, display: 'block' }}
                            >
                              Values diff (current → new)
                            </Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                              <Box>
                                <Typography variant="caption" color="text.secondary">
                                  Current
                                </Typography>
                                <Box
                                  component="pre"
                                  sx={{
                                    bgcolor: 'action.hover',
                                    color: 'text.primary',
                                    p: 1,
                                    m: 0,
                                    borderRadius: 1,
                                    fontSize: '0.75rem',
                                    overflow: 'auto',
                                    maxHeight: 200,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                  }}
                                >
                                  {valuesToYaml(existingValues[p.chartName]!)}
                                </Box>
                              </Box>
                              <Box>
                                <Typography variant="caption" color="info.main">
                                  New
                                </Typography>
                                <Box
                                  component="pre"
                                  sx={{
                                    bgcolor: 'action.hover',
                                    color: 'text.primary',
                                    p: 1,
                                    m: 0,
                                    borderRadius: 1,
                                    fontSize: '0.75rem',
                                    overflow: 'auto',
                                    maxHeight: 200,
                                    border: '1px solid',
                                    borderColor: 'info.main',
                                  }}
                                >
                                  {valuesToYaml(install?.values || {})}
                                </Box>
                              </Box>
                            </Box>
                          </>
                        ) : (
                          <>
                            <Typography
                              variant="caption"
                              fontWeight={600}
                              color="text.secondary"
                              sx={{ mb: 0.5, display: 'block' }}
                            >
                              New values (no previous custom values)
                            </Typography>
                            <Box
                              component="pre"
                              sx={{
                                bgcolor: 'action.hover',
                                color: 'text.primary',
                                p: 1.5,
                                m: 0,
                                borderRadius: 1,
                                fontSize: '0.75rem',
                                overflow: 'auto',
                                maxHeight: 200,
                                border: '1px solid',
                                borderColor: 'info.main',
                              }}
                            >
                              {valuesToYaml(install?.values || {})}
                            </Box>
                          </>
                        )}
                      </Box>
                    )}
                    {state.method === 'helm-install' && state.mode === 'apply' && (
                      <Box mt={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Icon icon="mdi:store" width={16} />}
                          onClick={() => {
                            const op = OPERATORS.find(o => getChartName(o.id) === p.chartName);
                            if (op) window.location.hash = getAppsChartUrl(op.id);
                          }}
                        >
                          Install via Apps
                        </Button>
                      </Box>
                    )}
                    {!isUpdate && p.resources.length > 0 && (
                      <Box
                        component="pre"
                        sx={{
                          bgcolor: 'action.hover',
                          color: 'text.primary',
                          p: 1.5,
                          m: 0,
                          borderRadius: 1,
                          fontSize: '0.78rem',
                          overflow: 'auto',
                          maxHeight: 200,
                          userSelect: 'all',
                        }}
                      >
                        {p.resources
                          .map(r => yaml.dump(r, { lineWidth: -1, noRefs: true }))
                          .join('---\n')}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </>
          )}
        </Box>
      )}

      {/* Navigation */}
      <Box display="flex" justifyContent="space-between" mt={4}>
        <Button
          disabled={activeStep === 0 || deployResult?.success === true}
          onClick={() => {
            setDeployResult(null);
            setActiveStep(s => s - 1);
          }}
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
              onClick={
                deployResult
                  ? () => {
                      setDeployResult(null);
                      setActiveStep(0);
                      dispatch({ type: 'RESET' });
                      // Re-sync with detection after reset
                      for (const op of OPERATORS) {
                        const isInstalled = detection.operators[op.id]?.status === 'installed';
                        dispatch({ type: 'SET_OPERATOR', id: op.id, enabled: isInstalled });
                      }
                    }
                  : handleDeploy
              }
              disabled={deploying}
              startIcon={
                <Icon
                  icon={
                    deployResult
                      ? 'mdi:restart'
                      : state.mode === 'download'
                      ? 'mdi:download'
                      : 'mdi:rocket-launch'
                  }
                />
              }
            >
              {deployResult
                ? 'Start Over'
                : deploying
                ? 'Applying...'
                : state.mode === 'download'
                ? 'Download'
                : 'Apply'}
            </Button>
          )}
        </Box>
      </Box>
    </SectionBox>
  );
}
