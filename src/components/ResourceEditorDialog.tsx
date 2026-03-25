import { Icon } from '@iconify/react';
import { Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Editor from '@monaco-editor/react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  IconButton,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import yaml from 'js-yaml';
import { useSnackbar } from 'notistack';
import React, { useEffect, useState } from 'react';
import CRDDocsViewer from './common/CRDDocsViewer';

const { SimpleEditor } = Resource;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface ResourceEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (item: KubeResourceBuilder) => Promise<void>;
  item: KubeResourceBuilder;
  title: string;
  apiVersion: string;
  kind: string;
}

export default function ResourceEditorDialog({
  open,
  onClose,
  onSave,
  item,
  title,
  apiVersion,
  kind,
}: ResourceEditorDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState(0); // 0 = Editor, 1 = Documentation
  const [yamlContent, setYamlContent] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [useMinimalEditor, setUseMinimalEditor] = useState(false);
  const [saving, setSaving] = useState(false);

  // Initialize YAML content when item changes or dialog opens
  useEffect(() => {
    if (item && open) {
      try {
        const yamlStr = yaml.dump(item, { lineWidth: -1, noRefs: true });
        setYamlContent(yamlStr);
        setYamlError(null);
      } catch (error: unknown) {
        setYamlError(`Failed to generate YAML: ${(error as Error).message}`);
      }
    }
  }, [item, open]);

  const handleYamlChange = (newYaml: string | undefined) => {
    if (!newYaml) return;
    setYamlContent(newYaml);
    try {
      yaml.load(newYaml, { schema: yaml.JSON_SCHEMA });
      setYamlError(null);
    } catch (error: unknown) {
      setYamlError(`Invalid YAML: ${(error as Error).message}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA }) as KubeResourceBuilder;
      await onSave(parsed);
      enqueueSnackbar(`${title} updated successfully`, { variant: 'success' });
      onClose();
    } catch (error: unknown) {
      console.error('Failed to save:', error);
      enqueueSnackbar('Failed to save.', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setYamlContent('');
    setYamlError(null);
    setActiveTab(0);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 3, py: 2, flexGrow: 1 }}>
          <Icon icon="mdi:pencil" width={20} />
          <Typography variant="h6">Edit: {title}</Typography>
        </Box>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)} sx={{ mr: 1 }}>
          <Tab label="Editor" icon={<Icon icon="mdi:code-braces" />} iconPosition="start" />
          <Tab
            label="Documentation"
            icon={<Icon icon="mdi:book-open-page-variant" />}
            iconPosition="start"
          />
        </Tabs>
        <IconButton onClick={handleClose} sx={{ mr: 1 }} size="small">
          <Icon icon="mdi:close" />
        </IconButton>
      </Box>

      <DialogContent
        sx={{ p: 0, height: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {activeTab === 0 ? (
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
        ) : (
          // Documentation Tab
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            <CRDDocsViewer apiVersion={apiVersion} kind={kind} />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          onClick={handleSave}
          startIcon={
            saving ? <Icon icon="mdi:loading" className="spin" /> : <Icon icon="mdi:content-save" />
          }
          disabled={saving || !!yamlError}
        >
          {saving ? 'Saving...' : 'Save & Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
