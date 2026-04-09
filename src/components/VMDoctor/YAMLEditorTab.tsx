import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Editor from '@monaco-editor/react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Select,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import yaml from 'js-yaml';
import { useSnackbar } from 'notistack';
import React, { useEffect, useState } from 'react';
import { safeError } from '../../utils/sanitize';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

const { SimpleEditor } = Resource;

interface YAMLEditorTabProps {
  vmName: string;
  namespace: string;
  vmItem?: VirtualMachine | null;
  vmiData?: Record<string, unknown> | null;
  podName: string;
}

type K8sResource = Record<string, unknown>;

function resourceName(r: K8sResource): string | undefined {
  return (r.metadata as { name?: string } | undefined)?.name;
}

type ResourceKind = 'vm' | 'vmi' | 'pod' | 'dv';

interface ResourceOption {
  kind: ResourceKind;
  label: string;
  icon: string;
  tooltip: string;
  editable: boolean;
}

const RESOURCE_OPTIONS: ResourceOption[] = [
  { kind: 'vm', label: 'VM', icon: 'mdi:server', tooltip: 'VirtualMachine', editable: true },
  {
    kind: 'vmi',
    label: 'VMI',
    icon: 'mdi:server-network',
    tooltip: 'VirtualMachineInstance (read-only)',
    editable: false,
  },
  {
    kind: 'pod',
    label: 'Pod',
    icon: 'mdi:cube-outline',
    tooltip: 'Virt-launcher Pod (read-only)',
    editable: false,
  },
  {
    kind: 'dv',
    label: 'DV',
    icon: 'mdi:database',
    tooltip: 'DataVolume (read-only)',
    editable: false,
  },
];

export default function YAMLEditorTab({
  vmName,
  namespace,
  vmItem,
  vmiData,
  podName,
}: YAMLEditorTabProps) {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const [yamlContent, setYamlContent] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [useMinimalEditor, setUseMinimalEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [resourceKind, setResourceKind] = useState<ResourceKind>('vm');
  const [podData, setPodData] = useState<Record<string, unknown> | null>(null);
  const [dvList, setDvList] = useState<Record<string, unknown>[]>([]);
  const [selectedDV, setSelectedDV] = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch pod data when pod view selected or podName changes
  useEffect(() => {
    if (!podName || !namespace) {
      setPodData(null);
      return;
    }
    let cancelled = false;
    ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podName}`)
      .then((data: Record<string, unknown>) => {
        if (!cancelled) setPodData(data);
      })
      .catch(() => {
        if (!cancelled) setPodData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [podName, namespace]);

  // Fetch DataVolumes belonging to this VM
  useEffect(() => {
    if (!vmName || !namespace) {
      setDvList([]);
      return;
    }
    let cancelled = false;
    ApiProxy.request(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes`)
      .then((resp: { items?: Array<Record<string, unknown>> }) => {
        if (cancelled) return;
        const vmDvs = (resp?.items || []).filter((dv: Record<string, unknown>) => {
          const meta = dv.metadata as
            | { name?: string; ownerReferences?: Array<{ name: string; kind: string }> }
            | undefined;
          const owners = meta?.ownerReferences || [];
          const ownedByVM = owners.some(
            (o: { name: string; kind: string }) => o.name === vmName && o.kind === 'VirtualMachine'
          );
          const nameMatch = meta?.name?.startsWith(vmName + '-');
          return ownedByVM || nameMatch;
        });
        setDvList(vmDvs);
        if (vmDvs.length > 0 && !selectedDV) {
          setSelectedDV(resourceName(vmDvs[0]) || '');
        }
      })
      .catch(() => {
        if (!cancelled) setDvList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [vmName, namespace]);

  // Determine current resource data
  const getCurrentResource = (): Record<string, unknown> | null => {
    switch (resourceKind) {
      case 'vm':
        return vmItem?.jsonData || null;
      case 'vmi':
        return vmiData || null;
      case 'pod':
        return podData;
      case 'dv':
        return dvList.find(dv => resourceName(dv) === selectedDV) || null;
    }
  };

  const currentResource = getCurrentResource();
  const option = RESOURCE_OPTIONS.find(o => o.kind === resourceKind)!;
  const isReadOnly = !option.editable;

  // Load YAML when resource or view changes
  useEffect(() => {
    if (!currentResource) {
      setYamlContent('');
      setYamlError(null);
      setDirty(false);
      return;
    }
    try {
      setYamlContent(yaml.dump(currentResource, { lineWidth: -1, noRefs: true }));
      setYamlError(null);
      setDirty(false);
    } catch (e) {
      setYamlError(`Failed to serialize YAML: ${(e as Error).message}`);
    }
  }, [currentResource, resourceKind, selectedDV]);

  const handleYamlChange = (newYaml: string | undefined) => {
    if (!newYaml || isReadOnly) return;
    setYamlContent(newYaml);
    setDirty(true);
    try {
      yaml.load(newYaml, { schema: yaml.JSON_SCHEMA });
      setYamlError(null);
    } catch (e) {
      setYamlError(`Invalid YAML: ${(e as Error).message}`);
    }
  };

  const handleSave = async () => {
    if (!vmItem || isReadOnly) return;
    setSaving(true);
    try {
      const parsed = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA }) as Record<
        string,
        unknown
      >;
      const meta = parsed.metadata as { namespace?: string; name?: string } | undefined;
      const ns = meta?.namespace || vmItem.getNamespace();
      const name = meta?.name || vmItem.getName();
      await ApiProxy.request(`/apis/kubevirt.io/v1/namespaces/${ns}/virtualmachines/${name}`, {
        method: 'PUT',
        body: JSON.stringify(parsed),
      });
      enqueueSnackbar('VM updated successfully', { variant: 'success' });
      setDirty(false);
    } catch (e) {
      enqueueSnackbar(`Failed to save: ${safeError(e, 'yamlSave')}`, { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!currentResource) return;
    try {
      setYamlContent(yaml.dump(currentResource, { lineWidth: -1, noRefs: true }));
      setYamlError(null);
      setDirty(false);
    } catch {
      /* ignore */
    }
  };

  // Refresh: re-fetch the current resource from the API
  const handleRefresh = async () => {
    setLoading(true);
    try {
      let data: Record<string, unknown> | null = null;
      switch (resourceKind) {
        case 'pod':
          if (podName) {
            data = await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podName}`);
            setPodData(data);
          }
          break;
        case 'dv':
          if (selectedDV) {
            data = await ApiProxy.request(
              `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${selectedDV}`
            );
            if (data) {
              setDvList(prev => prev.map(dv => (resourceName(dv) === selectedDV ? data! : dv)));
            }
          }
          break;
        default:
          // VM and VMI are already polled by the parent
          break;
      }
      enqueueSnackbar('Refreshed', { variant: 'info' });
    } catch (e) {
      enqueueSnackbar(`Refresh failed: ${safeError(e, 'yamlRefresh')}`, { variant: 'warning' });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(yamlContent).catch(() => {});
    enqueueSnackbar('YAML copied to clipboard', { variant: 'info' });
  };

  const handleDownload = () => {
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const resName =
      resourceKind === 'dv'
        ? selectedDV
        : resourceKind === 'pod'
        ? podName
        : resourceKind === 'vmi'
        ? resourceName(vmiData || {}) || vmName
        : vmItem?.getName() || vmName;
    a.download = `${resName}-${resourceKind}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isKindDisabled = (kind: ResourceKind): boolean => {
    switch (kind) {
      case 'vm':
        return !vmItem;
      case 'vmi':
        return !vmiData;
      case 'pod':
        return !podName;
      case 'dv':
        return dvList.length === 0;
    }
  };

  if (!vmItem && !vmiData) {
    return (
      <Alert severity="info" icon={<Icon icon="mdi:code-braces" />}>
        No VM data available.
      </Alert>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={1} sx={{ flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
        <ToggleButtonGroup
          value={resourceKind}
          exclusive
          onChange={(_, v) => {
            if (v) setResourceKind(v);
          }}
          size="small"
        >
          {RESOURCE_OPTIONS.map(opt => (
            <ToggleButton key={opt.kind} value={opt.kind} disabled={isKindDisabled(opt.kind)}>
              <Tooltip title={opt.tooltip}>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <Icon icon={opt.icon} width={16} />
                  {opt.label}
                </Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {resourceKind === 'dv' && dvList.length > 1 && (
          <Select
            value={selectedDV}
            onChange={e => setSelectedDV(e.target.value)}
            size="small"
            sx={{ minWidth: 200 }}
          >
            {dvList.map(dv => (
              <MenuItem key={resourceName(dv)} value={resourceName(dv)}>
                {resourceName(dv)}
              </MenuItem>
            ))}
          </Select>
        )}

        <Box flexGrow={1} />

        <FormControlLabel
          control={
            <Switch
              checked={useMinimalEditor}
              onChange={e => setUseMinimalEditor(e.target.checked)}
              size="small"
            />
          }
          label={<Typography variant="caption">Minimal editor</Typography>}
          sx={{ mr: 0 }}
        />

        <Tooltip title="Refresh from cluster">
          <Button
            size="small"
            startIcon={
              <Icon
                icon={loading ? 'mdi:loading' : 'mdi:refresh'}
                width={16}
                className={loading ? 'spin' : ''}
              />
            }
            onClick={handleRefresh}
            disabled={loading}
          >
            Refresh
          </Button>
        </Tooltip>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:content-copy" width={16} />}
          onClick={handleCopy}
        >
          Copy
        </Button>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:download" width={16} />}
          onClick={handleDownload}
        >
          Download
        </Button>

        {!isReadOnly && (
          <>
            <Button size="small" onClick={handleReset} disabled={!dirty}>
              Reset
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={handleSave}
              disabled={saving || !!yamlError || !dirty}
              startIcon={
                saving ? (
                  <Icon icon="mdi:loading" className="spin" width={16} />
                ) : (
                  <Icon icon="mdi:content-save" width={16} />
                )
              }
            >
              {saving ? 'Saving...' : 'Save & Apply'}
            </Button>
          </>
        )}
      </Box>

      {isReadOnly && currentResource && (
        <Typography variant="caption" color="text.secondary">
          {resourceKind === 'vmi' && 'VMI is a runtime resource — switch to VM to edit.'}
          {resourceKind === 'pod' && 'Pod is managed by KubeVirt — view only.'}
          {resourceKind === 'dv' &&
            `DataVolume: ${
              selectedDV || (dvList[0] ? resourceName(dvList[0]) : '') || ''
            } — view only.`}
        </Typography>
      )}

      {!currentResource && !loading && (
        <Alert severity="info" icon={<Icon icon="mdi:information-outline" />} sx={{ py: 0 }}>
          {resourceKind === 'pod' && 'No virt-launcher pod found. Is the VM running?'}
          {resourceKind === 'dv' && 'No DataVolumes found for this VM.'}
          {resourceKind === 'vmi' && 'No VMI found. The VM may not be running.'}
          {resourceKind === 'vm' && 'No VM data available.'}
        </Alert>
      )}

      {yamlError && (
        <Alert severity="error" icon={<Icon icon="mdi:alert" />} sx={{ py: 0 }}>
          {yamlError}
        </Alert>
      )}

      {/* Editor */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {useMinimalEditor ? (
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <SimpleEditor
              language="yaml"
              value={yamlContent}
              onChange={isReadOnly ? undefined : handleYamlChange}
            />
          </Box>
        ) : (
          <Box sx={{ position: 'absolute', inset: 0 }}>
            <Editor
              language="yaml"
              theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
              value={yamlContent}
              onChange={handleYamlChange}
              options={{
                readOnly: isReadOnly,
                lineNumbers: 'on',
                minimap: { enabled: true, scale: 2, showSlider: 'always' },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                wrappingIndent: 'indent',
                fontSize: 14,
                tabSize: 2,
                automaticLayout: true,
                padding: { top: 8, bottom: 8 },
              }}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
