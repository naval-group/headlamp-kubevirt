import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  Grid,
  IconButton,
  MenuItem,
  Select,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useState } from 'react';
import { buildCatalogConfigMap } from '../../utils/catalogLoader';
import { getErrorMessage, safeIconColor } from '../../utils/catalogUtils';
import { dumpYaml } from '../../utils/templateUtils';
import { CatalogCategory, CatalogImage, CatalogImageTag } from '../DataImportCrons/imageCatalog';
import VirtualMachineClusterPreference from '../Preferences/VirtualMachineClusterPreference';
import IconPicker from './IconPicker';

interface CreateCatalogEntryWizardProps {
  open: boolean;
  onClose: () => void;
  initialEntry?: CatalogImage | null;
}

const STEPS = ['Image Info', 'Versions', 'Review & Create'];

export default function CreateCatalogEntryWizard({
  open,
  onClose,
  initialEntry,
}: CreateCatalogEntryWizardProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [preferences] = VirtualMachineClusterPreference.useList();
  const preferenceNames = useMemo(
    () => (preferences || []).map(p => p.getName()).sort(),
    [preferences]
  );
  const [activeStep, setActiveStep] = useState(0);

  // Step 1
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('mdi:package-variant');
  const [iconColor, setIconColor] = useState('#888888');
  const [iconUrl, setIconUrl] = useState('');
  const [osLabel, setOsLabel] = useState('');
  const [defaultPreference, setDefaultPreference] = useState('');
  const [recommendedSize, setRecommendedSize] = useState('10Gi');
  const [category, setCategory] = useState<CatalogCategory>('custom');
  const [sourceType, setSourceType] = useState<'containerdisk' | 'http'>('containerdisk');
  const [registry, setRegistry] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [allNamespaces, setAllNamespaces] = useState<string[]>([]);

  // Step 2: Tags/versions
  const [tags, setTags] = useState<CatalogImageTag[]>([{ name: 'latest', default: true }]);

  const [creating, setCreating] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const isEdit = !!initialEntry;

  useEffect(() => {
    let cancelled = false;
    if (open) {
      setActiveStep(0);
      setCreating(false);

      if (initialEntry) {
        setName(initialEntry.name);
        setDescription(initialEntry.description);
        setIcon(initialEntry.icon);
        setIconColor(initialEntry.iconColor || '#888888');
        setIconUrl(initialEntry.iconUrl || '');
        setOsLabel(initialEntry.osLabel);
        setDefaultPreference(initialEntry.defaultPreference || '');
        setRecommendedSize(initialEntry.recommendedSize);
        setCategory((initialEntry.category as CatalogCategory) || 'custom');
        setSourceType(initialEntry.sourceType || 'containerdisk');
        setRegistry(initialEntry.registry || '');
        const [ns] = (initialEntry.sourceRef || 'default/').split('/');
        setNamespace(ns || 'default');
        setTags(
          initialEntry.extendedTags ||
            initialEntry.tags.map(t => ({
              name: t,
              default: t === initialEntry.defaultTag,
            }))
        );
      } else {
        setName('');
        setDescription('');
        setIcon('mdi:package-variant');
        setIconColor('#888888');
        setIconUrl('');
        setOsLabel('');
        setDefaultPreference('');
        setRecommendedSize('10Gi');
        setCategory('custom');
        setSourceType('containerdisk');
        setRegistry('');
        setNamespace('default');
        setTags([{ name: 'latest', default: true }]);
      }

      ApiProxy.request('/api/v1/namespaces')
        .then((resp: { items?: Array<{ metadata: { name: string } }> }) => {
          if (!cancelled) {
            setAllNamespaces((resp?.items?.map(ns => ns.metadata.name) || []).sort());
          }
        })
        .catch(err => console.warn('Failed to load namespaces:', err));
    }

    return () => {
      cancelled = true;
    };
  }, [open]);

  const addTag = () => {
    setTags([...tags, { name: '' }]);
  };

  const updateTag = (index: number, updates: Partial<CatalogImageTag>) => {
    setTags(prev =>
      prev.map((t, i) => {
        if (i !== index) return updates.default ? { ...t, default: false } : t;
        return { ...t, ...updates };
      })
    );
  };

  const removeTag = (index: number) => {
    setTags(prev => prev.filter((_, i) => i !== index));
  };

  const configMapSpec = useMemo(
    () => ({
      name,
      description,
      icon,
      iconColor,
      ...(iconUrl ? { iconUrl } : {}),
      osLabel: osLabel || name.toLowerCase().replace(/\s+/g, '-'),
      ...(defaultPreference ? { defaultPreference } : {}),
      recommendedSize,
      category,
      sourceType,
      ...(registry ? { registry } : {}),
      tags: tags.filter(t => t.name.trim()),
    }),
    [
      name,
      description,
      icon,
      iconColor,
      iconUrl,
      osLabel,
      defaultPreference,
      recommendedSize,
      category,
      sourceType,
      registry,
      tags,
    ]
  );

  const fullConfigMap = useMemo(
    () => buildCatalogConfigMap(name || 'unnamed', namespace, configMapSpec),
    [name, namespace, configMapSpec]
  );

  const handleCreate = async () => {
    if (!name.trim()) {
      enqueueSnackbar('Image name is required', { variant: 'error' });
      return;
    }
    setCreating(true);
    try {
      if (isEdit && initialEntry?.sourceRef) {
        const refParts = initialEntry.sourceRef.split('/');
        if (refParts.length < 2 || !refParts[0] || !refParts[1]) {
          enqueueSnackbar('Invalid source reference', { variant: 'error' });
          setCreating(false);
          return;
        }
        const [origNs, origName] = refParts;
        await ApiProxy.request(
          `/api/v1/namespaces/${encodeURIComponent(origNs)}/configmaps/${encodeURIComponent(
            origName
          )}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              ...fullConfigMap,
              metadata: {
                ...(fullConfigMap.metadata as Record<string, unknown>),
                name: origName,
                namespace: origNs,
              },
            }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } else {
        await ApiProxy.request(`/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps`, {
          method: 'POST',
          body: JSON.stringify(fullConfigMap),
          headers: { 'Content-Type': 'application/json' },
        });
      }
      enqueueSnackbar(`Image "${name}" ${isEdit ? 'updated' : 'added to catalog'}`, {
        variant: 'success',
      });
      onClose();
    } catch (err) {
      enqueueSnackbar(`Failed: ${getErrorMessage(err)}`, { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <Box sx={{ px: 2, pt: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Box display="flex" alignItems="center" mb={1}>
            <Icon icon="mdi:image-multiple" width={22} style={{ marginRight: 8 }} />
            <Typography variant="h6" flex={1}>
              Add Image to Catalog
            </Typography>
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

        <DialogContent>
          {/* Step 1: Image Info */}
          {activeStep === 0 && (
            <Box display="flex" flexDirection="column" gap={2}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    label="Image Name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    size="small"
                    fullWidth
                    required
                    placeholder="Fedora"
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <Autocomplete
                    size="small"
                    options={allNamespaces}
                    value={namespace}
                    onChange={(_e, val) => setNamespace(val || 'default')}
                    renderInput={params => <TextField {...params} label="Namespace" />}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Description"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    size="small"
                    fullWidth
                    placeholder="Fedora Cloud Server image"
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Box display="flex" gap={2} alignItems="flex-end">
                    <Box sx={{ minWidth: 44 }}>
                      <Typography variant="caption" color="text.secondary" mb={0.5} display="block">
                        Icon
                      </Typography>
                      <IconButton
                        onClick={() => setIconPickerOpen(true)}
                        sx={{
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 1,
                        }}
                      >
                        <Icon icon={icon} width={28} style={{ color: safeIconColor(iconColor) }} />
                      </IconButton>
                    </Box>
                    <TextField
                      label="Icon"
                      value={icon}
                      onChange={e => setIcon(e.target.value)}
                      size="small"
                      sx={{ flex: 2 }}
                      placeholder="mdi:linux"
                      InputLabelProps={{ shrink: true }}
                    />
                    <TextField
                      label="Icon Color"
                      type="color"
                      value={iconColor}
                      onChange={e => setIconColor(e.target.value)}
                      size="small"
                      sx={{ width: 100 }}
                      InputLabelProps={{ shrink: true }}
                    />
                    <TextField
                      label="Icon URL (optional, overrides MDI)"
                      value={iconUrl}
                      onChange={e => setIconUrl(e.target.value)}
                      size="small"
                      sx={{ flex: 3 }}
                      placeholder="data:image/png;base64,..."
                      InputLabelProps={{ shrink: true }}
                    />
                  </Box>
                </Grid>
                <Grid item xs={4}>
                  <TextField
                    label="OS Label"
                    value={osLabel}
                    onChange={e => setOsLabel(e.target.value)}
                    size="small"
                    fullWidth
                    placeholder="fedora"
                    helperText="Used for OS identification"
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={4}>
                  <Autocomplete
                    size="small"
                    freeSolo
                    options={preferenceNames}
                    value={defaultPreference}
                    onInputChange={(_e, val) => setDefaultPreference(val || '')}
                    renderInput={params => (
                      <TextField
                        {...params}
                        label="Default Preference"
                        placeholder="fedora"
                        helperText="VirtualMachineClusterPreference name"
                        InputLabelProps={{ shrink: true }}
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={4}>
                  <TextField
                    label="Recommended Size"
                    value={recommendedSize}
                    onChange={e => setRecommendedSize(e.target.value)}
                    size="small"
                    fullWidth
                    placeholder="10Gi"
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={4}>
                  <FormControl size="small" fullWidth>
                    <Typography variant="caption" color="text.secondary" mb={0.5}>
                      Source Type
                    </Typography>
                    <Select
                      value={sourceType}
                      onChange={e => setSourceType(e.target.value as 'containerdisk' | 'http')}
                    >
                      <MenuItem value="containerdisk">Container Disk</MenuItem>
                      <MenuItem value="http">HTTP (ISO/qcow2)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={4}>
                  <FormControl size="small" fullWidth>
                    <Typography variant="caption" color="text.secondary" mb={0.5}>
                      Category
                    </Typography>
                    <Select
                      value={category}
                      onChange={e => setCategory(e.target.value as CatalogCategory)}
                    >
                      <MenuItem value="general">General Purpose</MenuItem>
                      <MenuItem value="coreos">CoreOS</MenuItem>
                      <MenuItem value="testing">Testing / Demo</MenuItem>
                      <MenuItem value="custom">Custom</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                {sourceType === 'containerdisk' && (
                  <Grid item xs={12}>
                    <TextField
                      label="Registry"
                      value={registry}
                      onChange={e => setRegistry(e.target.value)}
                      size="small"
                      fullWidth
                      placeholder="quay.io/containerdisks/fedora"
                      helperText="Container image registry. Tags will be appended as :tag"
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                )}
              </Grid>
            </Box>
          )}

          {/* Step 2: Versions/Tags */}
          {activeStep === 1 && (
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="body2" color="text.secondary">
                  {sourceType === 'containerdisk'
                    ? 'Define container image tags (versions). Image will be registry:tag.'
                    : 'Define versions with download URLs.'}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Icon icon="mdi:plus" width={16} />}
                  onClick={addTag}
                >
                  Add Version
                </Button>
              </Box>

              {tags.map((tag, index) => (
                <Card key={tag.name || `tag-${index}`} variant="outlined" sx={{ mb: 1, p: 1.5 }}>
                  <Grid container spacing={1} alignItems="center">
                    <Grid item xs={sourceType === 'http' ? 3 : 4}>
                      <TextField
                        label="Tag/Version"
                        value={tag.name}
                        onChange={e => updateTag(index, { name: e.target.value })}
                        size="small"
                        fullWidth
                        placeholder="latest"
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>
                    {sourceType === 'http' && (
                      <Grid item xs={5}>
                        <TextField
                          label="Download URL"
                          value={tag.url || ''}
                          onChange={e => updateTag(index, { url: e.target.value })}
                          size="small"
                          fullWidth
                          placeholder="https://..."
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                    )}
                    <Grid item xs={2}>
                      <TextField
                        label="OS Label override"
                        value={tag.osLabel || ''}
                        onChange={e => updateTag(index, { osLabel: e.target.value || undefined })}
                        size="small"
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <Box display="flex" alignItems="center" gap={0.5}>
                        <Chip
                          label={tag.default ? 'Default' : 'Set default'}
                          size="small"
                          color={tag.default ? 'primary' : 'default'}
                          variant={tag.default ? 'filled' : 'outlined'}
                          onClick={() => updateTag(index, { default: true })}
                          sx={{ cursor: 'pointer' }}
                        />
                        <IconButton size="small" color="error" onClick={() => removeTag(index)}>
                          <Icon icon="mdi:close" width={16} />
                        </IconButton>
                      </Box>
                    </Grid>
                  </Grid>
                </Card>
              ))}
            </Box>
          )}

          {/* Step 3: Review */}
          {activeStep === 2 && (
            <Box display="flex" flexDirection="column" gap={2}>
              <Card variant="outlined">
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <Icon icon={icon} width={24} style={{ color: safeIconColor(iconColor) }} />
                    <Typography variant="subtitle1" fontWeight={600}>
                      {name || 'Unnamed'}
                    </Typography>
                    <Chip label={sourceType} size="small" variant="outlined" />
                    <Chip label={category} size="small" variant="outlined" />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {description}
                  </Typography>
                  <Typography variant="body2" mt={1}>
                    <strong>Namespace:</strong> {namespace} · <strong>Tags:</strong>{' '}
                    {tags.filter(t => t.name).length} · <strong>Size:</strong> {recommendedSize}
                  </Typography>
                </CardContent>
              </Card>

              <Typography variant="subtitle2">ConfigMap YAML</Typography>
              <Box
                sx={{
                  bgcolor: 'action.hover',
                  p: 2,
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 300,
                  overflow: 'auto',
                }}
              >
                {dumpYaml(fullConfigMap)}
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
              onClick={() => setActiveStep(s => s + 1)}
              disabled={activeStep === 0 && !name.trim()}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              startIcon={<Icon icon="mdi:check" width={16} />}
            >
              {creating ? 'Creating...' : 'Add to Catalog'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <IconPicker
        open={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        onSelect={setIcon}
        currentIcon={icon}
      />
    </>
  );
}
