import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Editor from '@monaco-editor/react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Select,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { safeError } from '../../utils/sanitize';
import { dumpYaml, extractParams, parseYaml, substituteParams } from '../../utils/templateUtils';
import CRDDocsViewer from '../common/CRDDocsViewer';
import VMFormFull from '../VirtualMachines/VMFormFull';

const { SimpleEditor } = Resource;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface TemplateParameter {
  name: string;
  displayName: string;
  description: string;
  value: string;
  generate: '' | 'expression';
  from: string;
  required: boolean;
}

interface CreateTemplateWizardProps {
  open: boolean;
  onClose: () => void;
  /** Pass an existing template to edit it */
  initialTemplate?: InstanceType<typeof import('./VirtualMachineTemplate').default> | null;
}

const STEPS = ['VM Definition', 'Parameters', 'Message', 'Review & Create'];

// extractParams imported from templateUtils

function defaultVMResource(): KubeResourceBuilder {
  return {
    apiVersion: 'kubevirt.io/v1',
    kind: 'VirtualMachine',
    metadata: { name: '${VM_NAME}', namespace: 'default' },
    spec: {
      runStrategy: 'Always',
      template: {
        spec: {
          domain: {
            devices: { disks: [{ name: 'rootdisk', disk: { bus: 'virtio' } }] },
            resources: { requests: { memory: '1Gi' } },
          },
          volumes: [
            { name: 'rootdisk', containerDisk: { image: 'quay.io/containerdisks/fedora:latest' } },
          ],
          networks: [{ name: 'default', pod: {} }],
        },
      },
    },
  };
}

export default function CreateTemplateWizard({
  open,
  onClose,
  initialTemplate,
}: CreateTemplateWizardProps) {
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();

  // Wizard state
  const [activeStep, setActiveStep] = useState(0);
  const [templateName, setTemplateName] = useState('');

  // Step 1: VM resource + tabs (Form/Editor/Documentation/Upload)
  const [vmResource, setVmResource] = useState<KubeResourceBuilder>(defaultVMResource());
  const [vmTab, setVmTab] = useState(0);
  const [yamlContent, setYamlContent] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [useMinimalEditor, setUseMinimalEditor] = useState(false);

  // Step 2: Parameters
  const [parameters, setParameters] = useState<TemplateParameter[]>([]);

  // Step 3: Message
  const [message, setMessage] = useState('');
  const messageRef = useRef<HTMLInputElement>(null);

  // Step 4: Create
  const [creating, setCreating] = useState(false);

  const isEdit = !!initialTemplate;

  // Reset on open — load from initialTemplate if editing
  useEffect(() => {
    if (open) {
      setActiveStep(0);
      setVmTab(0);
      setCreating(false);
      setYamlError(null);

      if (initialTemplate) {
        setTemplateName(initialTemplate.getName());
        setVmResource(initialTemplate.getVirtualMachineSpec() || defaultVMResource());
        setMessage(initialTemplate.getMessage());
        const params = initialTemplate.getParameters().map(p => ({
          name: p.name,
          displayName: p.displayName || '',
          description: p.description || '',
          value: p.value || '',
          generate: (p.generate || '') as '' | 'expression',
          from: p.from || '',
          required: p.required || false,
        }));
        setParameters(params);
      } else {
        setVmResource(defaultVMResource());
        setTemplateName('');
        setParameters([]);
        setMessage('');
      }
    }
  }, [open, initialTemplate]);

  // Sync YAML when switching to editor tab
  useEffect(() => {
    if (vmTab === 1) {
      try {
        setYamlContent(dumpYaml(vmResource));
        setYamlError(null);
      } catch (e) {
        setYamlError(`Failed to generate YAML: ${(e as Error).message}`);
      }
    }
  }, [vmResource, vmTab]);

  const handleYamlChange = (newYaml: string | undefined) => {
    if (!newYaml) return;
    setYamlContent(newYaml);
    const parsed = parseYaml(newYaml);
    if (parsed) {
      setYamlError(null);
      setVmResource(parsed as KubeResourceBuilder);
    } else {
      setYamlError('Invalid YAML');
    }
  };

  // Detected params
  const detectedParams = useMemo(() => extractParams(vmResource), [vmResource]);

  const syncParameters = () => {
    const existing = new Map(parameters.map(p => [p.name, p]));
    const synced: TemplateParameter[] = detectedParams.map(name => {
      if (existing.has(name)) return existing.get(name)!;
      return {
        name,
        displayName: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        value: '',
        generate: '' as const,
        from: '',
        required: name === 'VM_NAME',
      };
    });
    const extra = parameters.filter(p => !detectedParams.includes(p.name) && p.name.trim());
    setParameters([...synced, ...extra]);
  };

  const updateParameter = (index: number, updates: Partial<TemplateParameter>) => {
    setParameters(prev => prev.map((p, i) => (i === index ? { ...p, ...updates } : p)));
  };

  const addParameter = () => {
    setParameters([
      ...parameters,
      {
        name: `PARAM_${parameters.length + 1}`,
        displayName: '',
        description: '',
        value: '',
        generate: '',
        from: '',
        required: false,
      },
    ]);
  };

  const removeParameter = (index: number) => {
    setParameters(prev => prev.filter((_, i) => i !== index));
  };

  const insertParamInMessage = (paramName: string) => {
    const ref = `\${${paramName}}`;
    const input = messageRef.current;
    if (input) {
      const start = input.selectionStart || message.length;
      const end = input.selectionEnd || message.length;
      setMessage(message.substring(0, start) + ref + message.substring(end));
      setTimeout(() => {
        input.selectionStart = input.selectionEnd = start + ref.length;
        input.focus();
      }, 0);
    } else {
      setMessage(message + ref);
    }
  };

  const previewMessage = useMemo(
    () => substituteParams(message, parameters),
    [message, parameters]
  );

  const templateSpec = useMemo(() => {
    const ns = vmResource.metadata?.namespace || 'default';
    return {
      apiVersion: 'template.kubevirt.io/v1alpha1',
      kind: 'VirtualMachineTemplate',
      metadata: { name: templateName.trim() || 'unnamed', namespace: ns },
      spec: {
        virtualMachine: vmResource,
        parameters: parameters
          .filter(p => p.name.trim())
          .map(p => {
            const param: Record<string, unknown> = { name: p.name };
            if (p.displayName) param.displayName = p.displayName;
            if (p.description) param.description = p.description;
            if (p.value) param.value = p.value;
            if (p.generate) {
              param.generate = p.generate;
              if (p.from) param.from = p.from;
            }
            if (p.required) param.required = true;
            return param;
          }),
        ...(message.trim() ? { message: message.trim() } : {}),
      },
    };
  }, [vmResource, templateName, parameters, message]);

  const handleCreate = async () => {
    if (!templateName.trim()) {
      enqueueSnackbar('Template name is required', { variant: 'error' });
      return;
    }
    setCreating(true);
    try {
      const ns = templateSpec.metadata.namespace;
      const endpoint = isEdit
        ? `/apis/template.kubevirt.io/v1alpha1/namespaces/${encodeURIComponent(
            ns
          )}/virtualmachinetemplates/${encodeURIComponent(templateName.trim())}`
        : `/apis/template.kubevirt.io/v1alpha1/namespaces/${encodeURIComponent(
            ns
          )}/virtualmachinetemplates`;

      // For update, preserve resourceVersion
      const specToSend =
        isEdit && initialTemplate
          ? {
              ...templateSpec,
              metadata: {
                ...templateSpec.metadata,
                resourceVersion: initialTemplate.jsonData?.metadata?.resourceVersion,
              },
            }
          : templateSpec;

      await ApiProxy.request(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(specToSend),
        headers: { 'Content-Type': 'application/json' },
      });
      enqueueSnackbar(`Template "${templateName}" ${isEdit ? 'updated' : 'created'}`, {
        variant: 'success',
      });
      onClose();
    } catch (err) {
      enqueueSnackbar(safeError('Failed to create template', err), { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  // ── Render parameter card ────────────────────────────────────────
  const renderParam = (param: TemplateParameter, index: number, isSourced: boolean) => {
    const realIndex = parameters.indexOf(param);
    return (
      <Card key={param.name + index} variant="outlined" sx={{ mb: 1, p: 1.5 }}>
        <Grid container spacing={1} alignItems="center">
          <Grid item xs={2}>
            {isSourced ? (
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'primary.main',
                }}
              >
                {param.name}
              </Typography>
            ) : (
              <TextField
                label="Name"
                value={param.name}
                onChange={e =>
                  updateParameter(realIndex, {
                    name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''),
                  })
                }
                size="small"
                fullWidth
                InputLabelProps={{ shrink: true }}
                sx={{ '& input': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
              />
            )}
          </Grid>
          <Grid item xs={2}>
            <TextField
              label="Display Name"
              value={param.displayName}
              onChange={e => updateParameter(realIndex, { displayName: e.target.value })}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={3}>
            <TextField
              label="Description"
              value={param.description}
              onChange={e => updateParameter(realIndex, { description: e.target.value })}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={2}>
            <TextField
              label="Default Value"
              value={param.value}
              onChange={e => updateParameter(realIndex, { value: e.target.value })}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={3}>
            <Box display="flex" alignItems="center" gap={0.5}>
              <Chip
                label={param.required ? 'Required' : 'Optional'}
                size="small"
                color={param.required ? 'warning' : 'default'}
                variant="outlined"
                onClick={() => updateParameter(realIndex, { required: !param.required })}
                sx={{ cursor: 'pointer', minWidth: 70 }}
              />
              <Select
                size="small"
                value={param.generate}
                onChange={e =>
                  updateParameter(realIndex, { generate: e.target.value as '' | 'expression' })
                }
                displayEmpty
                sx={{ minWidth: 100, fontSize: '0.8rem' }}
              >
                <MenuItem value="">Manual</MenuItem>
                <MenuItem value="expression">Auto-gen</MenuItem>
              </Select>
              <IconButton
                size="small"
                onClick={() => removeParameter(realIndex)}
                color="error"
                title="Remove"
              >
                <Icon icon="mdi:close" width={16} />
              </IconButton>
            </Box>
          </Grid>
          {param.generate === 'expression' && (
            <Grid item xs={12}>
              <TextField
                label="Generator Pattern"
                value={param.from}
                onChange={e => updateParameter(realIndex, { from: e.target.value })}
                size="small"
                placeholder="[a-zA-Z0-9]{12}"
                helperText="Regex-like pattern. E.g. [a-zA-Z0-9]{12} → 12-char random string."
                InputLabelProps={{ shrink: true }}
                sx={{ maxWidth: 400, '& input': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
              />
            </Grid>
          )}
        </Grid>
      </Card>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      {/* Title bar with tabs for step 1 */}
      {/* Header: title + stepper */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box display="flex" alignItems="center" mb={1}>
          <Icon icon="mdi:text-box-outline" width={22} style={{ marginRight: 8 }} />
          <Typography variant="h6" sx={{ flexShrink: 0, mr: 2 }}>
            {isEdit ? 'Edit VM Template' : 'Create VM Template'}
          </Typography>
          {templateName && (
            <Chip label={templateName} size="small" variant="outlined" sx={{ mr: 2 }} />
          )}
          <Box flex={1} />
          <IconButton onClick={onClose} size="small">
            <Icon icon="mdi:close" />
          </IconButton>
        </Box>
        <Stepper activeStep={activeStep}>
          {STEPS.map(label => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <DialogContent
        sx={{ p: 0, height: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {/* Step 1: VM Definition */}
        {activeStep === 0 && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Sticky header */}
            <Box
              sx={{
                px: 3,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
              }}
            >
              <Grid container spacing={2} alignItems="flex-start">
                <Grid item xs={4}>
                  <TextField
                    label="Template Name"
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    size="small"
                    required
                    fullWidth
                    disabled={isEdit}
                    placeholder="fedora-basic"
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={8}>
                  {detectedParams.length > 0 && (
                    <Box display="flex" gap={0.5} flexWrap="wrap" alignItems="center" mb={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        Detected parameters:
                      </Typography>
                      {detectedParams.map(p => (
                        <Chip
                          key={p}
                          label={`\${${p}}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontFamily: 'monospace', fontSize: '0.7rem', height: 22 }}
                        />
                      ))}
                    </Box>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    Type <code>{'${PARAM_NAME}'}</code> in any text field to create a template
                    parameter.
                  </Typography>
                </Grid>
              </Grid>
              <Box display="flex" justifyContent="flex-end" mt={1}>
                <Tabs value={vmTab} onChange={(_, v) => setVmTab(v)}>
                  <Tab
                    label="Form"
                    icon={<Icon icon="mdi:form-textbox" />}
                    iconPosition="start"
                    sx={{ minHeight: 36, textTransform: 'none' }}
                  />
                  <Tab
                    label="Editor"
                    icon={<Icon icon="mdi:code-braces" />}
                    iconPosition="start"
                    sx={{ minHeight: 36, textTransform: 'none' }}
                  />
                  <Tab
                    label="Documentation"
                    icon={<Icon icon="mdi:book-open-page-variant" />}
                    iconPosition="start"
                    sx={{ minHeight: 36, textTransform: 'none' }}
                  />
                  <Tab
                    label="Upload"
                    icon={<Icon icon="mdi:upload" />}
                    iconPosition="start"
                    sx={{ minHeight: 36, textTransform: 'none' }}
                  />
                </Tabs>
              </Box>
            </Box>

            {/* Tab content */}
            <Box sx={{ flex: 1, overflow: 'auto', p: vmTab === 0 ? 3 : 0 }}>
              {vmTab === 0 && <VMFormFull resource={vmResource} onChange={setVmResource} />}
              {vmTab === 1 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <Box
                    sx={{
                      p: 1.5,
                      borderBottom: 1,
                      borderColor: 'divider',
                      display: 'flex',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <FormControlLabel
                      control={
                        <Switch
                          checked={useMinimalEditor}
                          onChange={e => setUseMinimalEditor(e.target.checked)}
                          size="small"
                        />
                      }
                      label="Minimal editor"
                    />
                  </Box>
                  {yamlError && (
                    <Box sx={{ p: 1, bgcolor: 'error.main', color: 'error.contrastText' }}>
                      <Typography variant="body2">{yamlError}</Typography>
                    </Box>
                  )}
                  <Box sx={{ flex: 1, minHeight: 0, position: 'relative', p: 2 }}>
                    {useMinimalEditor ? (
                      <Box sx={{ height: '100%', overflow: 'auto' }}>
                        <SimpleEditor
                          language="yaml"
                          value={yamlContent}
                          onChange={handleYamlChange}
                        />
                      </Box>
                    ) : (
                      <Box sx={{ position: 'absolute', top: 16, left: 16, right: 16, bottom: 16 }}>
                        <Editor
                          language="yaml"
                          value={yamlContent}
                          onChange={handleYamlChange}
                          theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
                          options={{
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            fontSize: 13,
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
              {vmTab === 2 && (
                <Box sx={{ p: 2 }}>
                  <CRDDocsViewer
                    apiVersion="template.kubevirt.io/v1alpha1"
                    kind="VirtualMachineTemplate"
                  />
                </Box>
              )}
              {vmTab === 3 && (
                <Box
                  sx={{
                    p: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                    mt: 4,
                  }}
                >
                  <Typography variant="h6" color="text.secondary">
                    Upload a VM YAML or JSON file
                  </Typography>
                  <input
                    type="file"
                    accept=".yaml,.yml,.json"
                    style={{ display: 'none' }}
                    id="template-file-upload"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => {
                        try {
                          const content = ev.target?.result as string;
                          const parsed = parseYaml(content);
                          if (!parsed) throw new Error('Invalid YAML/JSON');
                          setVmResource(parsed as KubeResourceBuilder);
                          setVmTab(0);
                          enqueueSnackbar('File loaded successfully', { variant: 'success' });
                        } catch (err) {
                          enqueueSnackbar(`Failed to parse file: ${(err as Error).message}`, {
                            variant: 'error',
                          });
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                  <label htmlFor="template-file-upload">
                    <Button
                      variant="contained"
                      component="span"
                      size="large"
                      startIcon={<Icon icon="mdi:upload" />}
                    >
                      Select File
                    </Button>
                  </label>
                  <Typography variant="caption" color="text.secondary">
                    Accepts YAML or JSON. The file will be loaded into the form.
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}

        {/* Step 2: Parameters */}
        {activeStep === 1 && (
          <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="body2" color="text.secondary">
                Configure parameters detected from <code>{'${...}'}</code> placeholders.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Icon icon="mdi:plus" width={16} />}
                onClick={addParameter}
              >
                Add Parameter
              </Button>
            </Box>
            {(() => {
              const sourced = parameters.filter(p => detectedParams.includes(p.name));
              const additional = parameters.filter(p => !detectedParams.includes(p.name));
              return (
                <>
                  {sourced.length > 0 && (
                    <Box mb={2}>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Icon icon="mdi:code-braces" width={18} style={{ color: '#2196f3' }} />
                        <Typography variant="subtitle2">
                          From VM Definition ({sourced.length})
                        </Typography>
                      </Box>
                      {sourced.map((p, i) => renderParam(p, i, true))}
                    </Box>
                  )}
                  {additional.length > 0 && (
                    <Box mb={2}>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Icon icon="mdi:plus-circle" width={18} style={{ color: '#ff9800' }} />
                        <Typography variant="subtitle2">
                          Additional ({additional.length})
                        </Typography>
                      </Box>
                      {additional.map((p, i) => renderParam(p, i, false))}
                    </Box>
                  )}
                  {parameters.length === 0 && (
                    <Typography variant="body2" color="text.secondary" textAlign="center" py={4}>
                      No parameters detected.
                    </Typography>
                  )}
                </>
              );
            })()}
          </Box>
        )}

        {/* Step 3: Message */}
        {activeStep === 2 && (
          <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
            <Typography variant="caption" color="text.secondary" mb={0.5} display="block">
              Template Message (shown after VM creation)
            </Typography>
            <TextField
              multiline
              minRows={3}
              maxRows={5}
              fullWidth
              value={message}
              onChange={e => setMessage(e.target.value)}
              inputRef={messageRef}
              size="small"
              placeholder="VM ${VM_NAME} created successfully."
            />
            <Box display="flex" gap={0.5} flexWrap="wrap" mt={1}>
              <Typography variant="caption" color="text.secondary">
                Insert:
              </Typography>
              {parameters.map(p => (
                <Chip
                  key={p.name}
                  label={`\${${p.name}}`}
                  size="small"
                  variant="outlined"
                  onClick={() => insertParamInMessage(p.name)}
                  sx={{
                    cursor: 'pointer',
                    height: 20,
                    fontSize: '0.7rem',
                    fontFamily: 'monospace',
                  }}
                />
              ))}
            </Box>
            {previewMessage && (
              <Box mt={2}>
                <Typography variant="caption" color="text.secondary">
                  Preview
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    bgcolor: 'action.hover',
                    p: 1,
                    borderRadius: 1,
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.85rem',
                  }}
                >
                  {previewMessage}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Step 4: Review & Create */}
        {activeStep === 3 && (
          <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" mb={1}>
                  Summary
                </Typography>
                <Typography variant="body2">
                  <strong>Template:</strong> {templateName || '-'}
                </Typography>
                <Typography variant="body2">
                  <strong>Namespace:</strong> {vmResource.metadata?.namespace || 'default'}
                </Typography>
                <Typography variant="body2">
                  <strong>Parameters:</strong> {parameters.filter(p => p.name).length} (
                  {parameters.filter(p => p.required).length} required)
                </Typography>
                {message && (
                  <Typography variant="body2">
                    <strong>Message:</strong> {message}
                  </Typography>
                )}
                <Box mt={1} display="flex" gap={0.5} flexWrap="wrap">
                  {parameters.map(p => (
                    <Chip
                      key={p.name}
                      label={p.displayName || p.name}
                      size="small"
                      color={p.required ? 'warning' : 'default'}
                      variant="outlined"
                    />
                  ))}
                </Box>
              </CardContent>
            </Card>
            <Typography variant="subtitle2" mb={0.5}>
              Template YAML
            </Typography>
            <Box
              sx={{
                bgcolor: 'action.hover',
                p: 2,
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 350,
                overflow: 'auto',
              }}
            >
              {dumpYaml(templateSpec)}
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        {activeStep > 0 && (
          <Button onClick={() => setActiveStep(s => s - 1)} disabled={creating}>
            Back
          </Button>
        )}
        {activeStep < STEPS.length - 1 ? (
          <Button
            variant="contained"
            onClick={() => {
              if (activeStep === 0) syncParameters();
              setActiveStep(s => s + 1);
            }}
            disabled={activeStep === 0 && !templateName.trim()}
          >
            Next
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={creating || !templateName.trim()}
            startIcon={<Icon icon="mdi:check" width={16} />}
          >
            {creating
              ? isEdit
                ? 'Updating...'
                : 'Creating...'
              : isEdit
              ? 'Update Template'
              : 'Create Template'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
