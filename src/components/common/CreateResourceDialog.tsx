import { Icon } from '@iconify/react';
import { Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Editor from '@monaco-editor/react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Paper,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import yaml from 'js-yaml';
import { useSnackbar } from 'notistack';
import React, { useEffect, useState } from 'react';
import CRDDocsViewer from './CRDDocsViewer';

const { SimpleEditor } = Resource;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface CreateResourceDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  resourceClass: {
    apiEndpoint: { put: (r: unknown) => Promise<unknown>; post: (r: unknown) => Promise<unknown> };
    apiVersion: string;
    kind: string;
  };
  initialResource: KubeResourceBuilder;
  editMode?: boolean;
  initialTab?: number;
  formComponent: (props: {
    resource: KubeResourceBuilder;
    onChange: (resource: KubeResourceBuilder) => void;
    editMode?: boolean;
    showErrors?: boolean;
  }) => React.ReactElement;
  /** Returns true if the resource is valid and can be created */
  validate?: (resource: KubeResourceBuilder) => boolean;
}

export default function CreateResourceDialog({
  open,
  onClose,
  title,
  resourceClass,
  initialResource,
  editMode = false,
  initialTab = 0,
  formComponent: FormComponent,
  validate,
}: CreateResourceDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState(initialTab); // 0 = Form, 1 = Editor, 2 = Documentation, 3 = Upload
  const [resource, setResource] = useState(initialResource);
  const [yamlContent, setYamlContent] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadMethod, setUploadMethod] = useState(0); // 0 = File, 1 = URL
  const [useMinimalEditor, setUseMinimalEditor] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const isValid = validate ? validate(resource) : true;

  // Sync initialTab when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  // Sync resource to YAML when resource changes or tab switches to Editor
  useEffect(() => {
    if (activeTab === 1) {
      try {
        const yamlStr = yaml.dump(resource, { lineWidth: -1, noRefs: true });
        setYamlContent(yamlStr);
        setYamlError(null);
      } catch (error: unknown) {
        setYamlError(`Failed to generate YAML: ${(error as Error).message}`);
      }
    }
  }, [resource, activeTab]);

  const handleYamlChange = (newYaml: string | undefined) => {
    if (!newYaml) return;
    setYamlContent(newYaml);
    try {
      const parsed = yaml.load(newYaml, { schema: yaml.JSON_SCHEMA });
      setYamlError(null);
      setResource(parsed);
    } catch (error: unknown) {
      setYamlError(`Invalid YAML: ${(error as Error).message}`);
    }
  };

  const handleSave = async () => {
    try {
      let resourceToSave = resource;

      if (activeTab === 1) {
        try {
          resourceToSave = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
        } catch (error: unknown) {
          enqueueSnackbar(`Invalid YAML: ${(error as Error).message}`, { variant: 'error' });
          return;
        }
      }

      if (!resourceToSave?.metadata?.name) {
        enqueueSnackbar('Resource name is required', { variant: 'error' });
        return;
      }

      if (editMode) {
        await resourceClass.apiEndpoint.put(resourceToSave);
        enqueueSnackbar(
          `${resourceToSave.kind} "${resourceToSave.metadata.name}" updated successfully`,
          { variant: 'success' }
        );
      } else {
        await resourceClass.apiEndpoint.post(resourceToSave);
        enqueueSnackbar(
          `${resourceToSave.kind} "${resourceToSave.metadata.name}" created successfully`,
          { variant: 'success' }
        );
      }

      setResource(initialResource);
      setYamlContent('');
      setActiveTab(0);
      onClose();
    } catch (error: unknown) {
      enqueueSnackbar(
        `Failed to ${editMode ? 'update' : 'create'} resource: ${(error as Error).message}`,
        { variant: 'error' }
      );
    }
  };

  const handleClose = () => {
    setResource(initialResource);
    setYamlContent('');
    setYamlError(null);
    setUploadUrl('');
    setActiveTab(0);
    setShowErrors(false);
    onClose();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA });
        setResource(parsed);
        setYamlContent(content);
        setYamlError(null);
        setActiveTab(1);
        enqueueSnackbar(`File "${file.name}" loaded successfully`, { variant: 'success' });
      } catch (error: unknown) {
        enqueueSnackbar(`Failed to parse file: ${(error as Error).message}`, { variant: 'error' });
      }
    };
    reader.readAsText(file);
  };

  const handleUrlLoad = async () => {
    try {
      const parsed = new URL(uploadUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        enqueueSnackbar('Only http and https URLs are supported', { variant: 'error' });
        return;
      }
    } catch {
      enqueueSnackbar('Invalid URL', { variant: 'error' });
      return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(uploadUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const content = await response.text();
      const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA });
      setResource(parsed);
      setYamlContent(content);
      setYamlError(null);
      setActiveTab(1);
      enqueueSnackbar('Resource loaded from URL successfully', { variant: 'success' });
    } catch (error: unknown) {
      enqueueSnackbar(`Failed to load from URL: ${(error as Error).message}`, { variant: 'error' });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ px: 3, py: 2, flexGrow: 1 }}>
          {title}
        </Typography>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)} sx={{ mr: 1 }}>
          <Tab label="Form" icon={<Icon icon="mdi:form-textbox" />} iconPosition="start" />
          <Tab label="Editor" icon={<Icon icon="mdi:code-braces" />} iconPosition="start" />
          <Tab
            label="Documentation"
            icon={<Icon icon="mdi:book-open-page-variant" />}
            iconPosition="start"
          />
          <Tab label="Upload" icon={<Icon icon="mdi:upload" />} iconPosition="start" />
        </Tabs>
        <IconButton onClick={handleClose} sx={{ mr: 1 }} size="small">
          <Icon icon="mdi:close" />
        </IconButton>
      </Box>

      <DialogContent
        sx={{ p: 0, height: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {activeTab === 0 ? (
          // Form Tab
          <Box sx={{ p: 3, flex: 1, overflow: 'auto' }}>
            <FormComponent
              resource={resource}
              onChange={setResource}
              editMode={editMode}
              showErrors={showErrors}
            />
          </Box>
        ) : activeTab === 1 ? (
          // Editor Tab
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                label="Use minimal editor"
              />
            </Box>
            {yamlError && (
              <Box sx={{ p: 2, bgcolor: 'error.main', color: 'error.contrastText' }}>
                <Typography variant="body2">{yamlError}</Typography>
              </Box>
            )}
            <Box sx={{ flex: 1, minHeight: 0, position: 'relative', p: 2 }}>
              {useMinimalEditor ? (
                <Box sx={{ height: '100%', overflow: 'auto' }}>
                  <SimpleEditor language="yaml" value={yamlContent} onChange={handleYamlChange} />
                </Box>
              ) : (
                <Box sx={{ position: 'absolute', top: 16, left: 16, right: 16, bottom: 16 }}>
                  <Editor
                    language="yaml"
                    theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
                    value={yamlContent}
                    onChange={handleYamlChange}
                    options={{
                      lineNumbers: 'on',
                      minimap: {
                        enabled: true,
                        scale: 2,
                        showSlider: 'always',
                      },
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
        ) : activeTab === 2 ? (
          // Documentation Tab
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            <CRDDocsViewer apiVersion={resourceClass.apiVersion} kind={resourceClass.kind} />
          </Box>
        ) : (
          // Upload Tab
          <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <Tabs value={uploadMethod} onChange={(_, val) => setUploadMethod(val)}>
              <Tab label="Upload File" />
              <Tab label="Load from URL" />
            </Tabs>

            {uploadMethod === 0 ? (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  mt: 4,
                }}
              >
                <Typography variant="h6" color="text.secondary">
                  Select a YAML or JSON file
                </Typography>
                <input
                  type="file"
                  accept=".yaml,.yml,.json"
                  style={{ display: 'none' }}
                  id="file-upload"
                  onChange={handleFileUpload}
                />
                <label htmlFor="file-upload">
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
                  Drag and drop is not supported yet. Click the button to select a file.
                </Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                <Typography variant="h6" color="text.secondary">
                  Load from a remote URL
                </Typography>
                <TextField
                  fullWidth
                  label="Resource URL"
                  placeholder="https://example.com/resource.yaml"
                  value={uploadUrl}
                  onChange={e => setUploadUrl(e.target.value)}
                  helperText="Enter a URL to a YAML or JSON file"
                />
                <Button
                  variant="contained"
                  onClick={handleUrlLoad}
                  size="large"
                  startIcon={<Icon icon="mdi:download" />}
                  disabled={!uploadUrl}
                >
                  Load from URL
                </Button>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose}>Cancel</Button>
        <Box sx={{ flex: 1 }} />
        {showErrors && !isValid && (
          <Chip
            icon={<Icon icon="mdi:alert-circle-outline" />}
            label="Some required fields are missing"
            color="warning"
            size="small"
            variant="outlined"
          />
        )}
        <Button
          onClick={() => setReviewOpen(true)}
          startIcon={<Icon icon="mdi:eye-outline" />}
          disabled={!!yamlError || !resource?.metadata?.name}
        >
          Review
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            if (validate && !isValid) {
              setShowErrors(true);
              // Scroll to the first missing mandatory field
              setTimeout(() => {
                const firstMissing = document.querySelector('[data-mandatory-empty="true"]');
                if (firstMissing) {
                  firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 50);
              return;
            }
            handleSave();
          }}
          startIcon={<Icon icon="mdi:check" />}
          disabled={!!yamlError}
        >
          {editMode ? 'Save' : 'Create'}
        </Button>
      </DialogActions>

      {/* Review Dialog */}
      <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:eye-outline" />
            Review {resource?.kind || 'Resource'}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Summary Cards */}
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="overline" color="text.secondary">
                Resource Information
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" fontWeight="bold">
                    Kind:
                  </Typography>
                  <Chip label={resource?.kind || '-'} size="small" color="primary" />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" fontWeight="bold">
                    API Version:
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {resource?.apiVersion || '-'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" fontWeight="bold">
                    Name:
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {resource?.metadata?.name || '-'}
                  </Typography>
                </Box>
                {resource?.metadata?.namespace && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" fontWeight="bold">
                      Namespace:
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {resource.metadata.namespace}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Paper>

            <Divider />

            {/* YAML Preview */}
            <Box>
              <Typography variant="overline" color="text.secondary" gutterBottom>
                YAML Configuration
              </Typography>
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  overflow: 'hidden',
                  bgcolor: 'action.hover',
                }}
              >
                <Editor
                  height="400px"
                  language="yaml"
                  theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
                  value={yaml.dump(resource, { lineWidth: -1, noRefs: true })}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    fontSize: 12,
                    tabSize: 2,
                  }}
                />
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setReviewOpen(false)}>Close</Button>
          <Button
            variant="contained"
            onClick={() => {
              setReviewOpen(false);
              handleSave();
            }}
            startIcon={<Icon icon="mdi:check" />}
            disabled={!!yamlError}
          >
            {editMode ? 'Confirm & Save' : 'Confirm & Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
