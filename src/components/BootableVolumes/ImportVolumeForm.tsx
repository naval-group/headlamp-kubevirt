/**
 * ImportVolumeForm - Form for importing disk images as DataVolumes
 *
 * Supports importing from:
 * 1. HTTP/HTTPS URL (ISO, qcow2, raw)
 * 2. Container Registry
 * 3. Upload (local file - requires virtctl or upload proxy)
 * 4. Blank (empty disk)
 */

import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Divider,
  FormControl,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import React, { useState } from 'react';
import useResourceEditor from '../../hooks/useResourceEditor';
import { KubeListResponse } from '../../types';
import FormSection from '../common/FormSection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface KubeNamedItem {
  metadata: { name: string };
}

interface ImportVolumeFormProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
}

export default function ImportVolumeForm({
  resource,
  onChange,
  editMode = false,
}: ImportVolumeFormProps) {
  // Parse current values from resource
  const name = resource.metadata?.name || '';
  const namespace = resource.metadata?.namespace || 'default';

  // Determine source type
  let sourceType: 'http' | 'registry' | 'upload' | 'blank' | 'pvc' | 'snapshot' = 'http';
  if (resource.spec?.source?.http) {
    sourceType = 'http';
  } else if (resource.spec?.source?.registry) {
    sourceType = 'registry';
  } else if (resource.spec?.source?.upload) {
    sourceType = 'upload';
  } else if (resource.spec?.source?.blank) {
    sourceType = 'blank';
  } else if (resource.spec?.source?.pvc) {
    sourceType = 'pvc';
  } else if (resource.spec?.source?.snapshot) {
    sourceType = 'snapshot';
  }

  // Source details
  const httpUrl = resource.spec?.source?.http?.url || '';
  const registryUrl = resource.spec?.source?.registry?.url || '';
  const pvcName = resource.spec?.source?.pvc?.name || '';
  const pvcNamespace = resource.spec?.source?.pvc?.namespace || namespace;
  const snapshotName = resource.spec?.source?.snapshot?.name || '';
  const snapshotNamespace = resource.spec?.source?.snapshot?.namespace || namespace;

  // Storage
  const storageSize = resource.spec?.storage?.resources?.requests?.storage || '30Gi';
  const storageSizeMatch = storageSize.match(/^(\d+)(Mi|Gi)$/);
  const storageSizeValue = storageSizeMatch ? storageSizeMatch[1] : '30';
  const storageSizeUnit = (storageSizeMatch ? storageSizeMatch[2] : 'Gi') as 'Mi' | 'Gi';
  const storageClass = resource.spec?.storage?.storageClassName || '';
  const accessMode = resource.spec?.storage?.accessModes?.[0] || 'ReadWriteOnce';
  const volumeMode = resource.spec?.storage?.volumeMode || 'Filesystem';

  // Content type
  const contentType = resource.spec?.contentType || 'kubevirt';

  // Fetch available resources
  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  const [storageClasses, setStorageClasses] = useState<string[]>([]);
  const [pvcs, setPvcs] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<string[]>([]);

  React.useEffect(() => {
    ApiProxy.request('/api/v1/namespaces')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const nsList = response?.items?.map(ns => ns.metadata.name) || ['default'];
        setNamespaces(nsList);
      })
      .catch(err => console.error('Failed to fetch namespaces:', err));

    ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses')
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const scList = response?.items?.map(sc => sc.metadata.name) || [];
        setStorageClasses(scList);
      })
      .catch(err => console.error('Failed to fetch storage classes:', err));
  }, []);

  // Fetch PVCs for the source namespace
  React.useEffect(() => {
    if (sourceType !== 'pvc') return;

    ApiProxy.request(`/api/v1/namespaces/${pvcNamespace}/persistentvolumeclaims`)
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const pvcList = response?.items?.map(pvc => pvc.metadata.name) || [];
        setPvcs(pvcList);
      })
      .catch(err => console.error('Failed to fetch PVCs:', err));
  }, [sourceType, pvcNamespace]);

  // Fetch VolumeSnapshots for the source namespace
  React.useEffect(() => {
    if (sourceType !== 'snapshot') return;

    ApiProxy.request(
      `/apis/snapshot.storage.k8s.io/v1/namespaces/${snapshotNamespace}/volumesnapshots`
    )
      .then((response: KubeListResponse<KubeNamedItem>) => {
        const snapshotList = response?.items?.map(snap => snap.metadata.name) || [];
        setSnapshots(snapshotList);
      })
      .catch(err => console.error('Failed to fetch snapshots:', err));
  }, [sourceType, snapshotNamespace]);

  // Use shared resource editor hook
  const { updateMetadata } = useResourceEditor(resource, onChange);

  const updateSource = (
    type: 'http' | 'registry' | 'upload' | 'blank' | 'pvc' | 'snapshot',
    config: KubeResourceBuilder
  ) => {
    const newSource: KubeResourceBuilder = {};
    if (type === 'blank') {
      newSource.blank = {};
    } else if (type === 'upload') {
      newSource.upload = {};
    } else {
      newSource[type] = config;
    }

    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        source: newSource,
      },
    });
  };

  const updateStorage = (updates: KubeResourceBuilder) => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        storage: {
          ...resource.spec?.storage,
          ...updates,
        },
      },
    });
  };

  const updateStorageSize = (value: string, unit: 'Mi' | 'Gi') => {
    updateStorage({
      resources: {
        requests: {
          storage: value ? `${value}${unit}` : undefined,
        },
      },
    });
  };

  const updateContentType = (type: 'kubevirt' | 'archive') => {
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        contentType: type,
      },
    });
  };

  // Generate dynamic virtctl command
  const generateVirtctlCommand = () => {
    const dvName = name || '<datavolume-name>';
    const size = `${storageSizeValue}${storageSizeUnit}`;

    let cmd = `virtctl image-upload dv ${dvName}`;
    cmd += ` \\\n  --namespace ${namespace}`;
    cmd += ` \\\n  --size=${size}`;

    if (storageClass) {
      cmd += ` \\\n  --storage-class=${storageClass}`;
    }

    if (accessMode !== 'ReadWriteOnce') {
      cmd += ` \\\n  --access-mode=${accessMode}`;
    }

    if (volumeMode === 'Block') {
      cmd += ` \\\n  --block-volume`;
    }

    cmd += ` \\\n  --image-path=/path/to/disk.img`;
    cmd += ` \\\n  --insecure`;

    return cmd;
  };

  // Generate command for uploading to existing DataVolume
  const generateUploadCommand = () => {
    const dvName = name || '<datavolume-name>';

    let cmd = `virtctl image-upload dv ${dvName}`;
    cmd += ` \\\n  --namespace ${namespace}`;
    cmd += ` \\\n  --no-create`;
    cmd += ` \\\n  --image-path=/path/to/disk.img`;
    cmd += ` \\\n  --insecure`;

    return cmd;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Name and Namespace */}
      <FormSection icon="mdi:information-outline" title="Basic Information" color="other" noGrid>
        <TextField
          fullWidth
          label="Name"
          required
          value={name}
          onChange={e => updateMetadata('name', e.target.value)}
          helperText={editMode ? 'Name cannot be changed' : 'Unique name for the DataVolume'}
          disabled={editMode}
          sx={{ mb: 2 }}
        />

        <Autocomplete
          fullWidth
          options={namespaces}
          value={namespace}
          onChange={(_, newValue) => updateMetadata('namespace', newValue || 'default')}
          disabled={editMode}
          renderInput={params => (
            <TextField
              {...params}
              label="Namespace"
              required
              helperText={editMode ? 'Namespace cannot be changed' : 'Namespace for the DataVolume'}
            />
          )}
        />
      </FormSection>

      <Divider />

      {/* Source Type */}
      <FormSection icon="mdi:source-branch" title="Source Type" color="storage" noGrid>
        <FormControl fullWidth sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Source Type
          </Typography>
          <Select
            value={sourceType}
            onChange={e =>
              updateSource(
                e.target.value as 'http' | 'registry' | 'upload' | 'blank' | 'pvc' | 'snapshot',
                {}
              )
            }
          >
            <MenuItem value="" disabled sx={{ fontWeight: 'bold', color: 'text.secondary' }}>
              Upload new
            </MenuItem>
            <MenuItem value="upload" sx={{ pl: 4 }}>
              Volume (Upload a new file to a PVC)
            </MenuItem>

            <MenuItem value="" disabled sx={{ fontWeight: 'bold', color: 'text.secondary', mt: 1 }}>
              Use existing
            </MenuItem>
            <MenuItem value="pvc" sx={{ pl: 4 }}>
              Volume (Use volume already available on the cluster)
            </MenuItem>
            <MenuItem value="snapshot" sx={{ pl: 4 }}>
              Volume snapshot
            </MenuItem>

            <MenuItem value="" disabled sx={{ fontWeight: 'bold', color: 'text.secondary', mt: 1 }}>
              Import from
            </MenuItem>
            <MenuItem value="http" sx={{ pl: 4 }}>
              URL (HTTP/HTTPS endpoint)
            </MenuItem>
            <MenuItem value="registry" sx={{ pl: 4 }}>
              Registry (Container registry)
            </MenuItem>

            <MenuItem value="" disabled sx={{ fontWeight: 'bold', color: 'text.secondary', mt: 1 }}>
              Other
            </MenuItem>
            <MenuItem value="blank" sx={{ pl: 4 }}>
              Blank (Empty disk)
            </MenuItem>
          </Select>
        </FormControl>

        {sourceType === 'http' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Import disk image from an HTTP/HTTPS URL. Supports ISO, qcow2, and raw formats.
            </Typography>

            <TextField
              fullWidth
              label="URL"
              required
              value={httpUrl}
              onChange={e => updateSource('http', { url: e.target.value })}
              placeholder="https://example.com/disk-image.iso"
              helperText="Full URL to the disk image (ISO, qcow2, or raw)"
            />
          </Box>
        )}

        {sourceType === 'registry' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Import disk image from a container registry.
            </Typography>

            <TextField
              fullWidth
              label="Registry URL"
              required
              value={registryUrl}
              onChange={e => updateSource('registry', { url: e.target.value })}
              placeholder="docker://quay.io/kubevirt/fedora-cloud-container-disk-demo:latest"
              helperText="Container registry URL (docker:// or oci-archive://)"
            />
          </Box>
        )}

        {sourceType === 'pvc' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Clone an existing PVC to create a new volume.
            </Typography>

            <Autocomplete
              fullWidth
              options={namespaces}
              value={pvcNamespace}
              onChange={(_, newValue) =>
                updateSource('pvc', { name: pvcName, namespace: newValue || namespace })
              }
              renderInput={params => <TextField {...params} label="Source Namespace" required />}
              sx={{ mb: 2 }}
            />

            <Autocomplete
              fullWidth
              options={pvcs}
              value={pvcName}
              onChange={(_, newValue) =>
                updateSource('pvc', { name: newValue || '', namespace: pvcNamespace })
              }
              renderInput={params => (
                <TextField {...params} label="PVC Name" required placeholder="Select PVC..." />
              )}
            />
          </Box>
        )}

        {sourceType === 'snapshot' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Restore from an existing VolumeSnapshot.
            </Typography>

            <Autocomplete
              fullWidth
              options={namespaces}
              value={snapshotNamespace}
              onChange={(_, newValue) =>
                updateSource('snapshot', { name: snapshotName, namespace: newValue || namespace })
              }
              renderInput={params => <TextField {...params} label="Source Namespace" required />}
              sx={{ mb: 2 }}
            />

            <Autocomplete
              fullWidth
              options={snapshots}
              value={snapshotName}
              onChange={(_, newValue) =>
                updateSource('snapshot', { name: newValue || '', namespace: snapshotNamespace })
              }
              renderInput={params => (
                <TextField
                  {...params}
                  label="Snapshot Name"
                  required
                  placeholder="Select snapshot..."
                />
              )}
            />
          </Box>
        )}

        {sourceType === 'upload' && (
          <Box>
            {/* Alternative: Skip UI and use virtctl directly */}
            <Alert severity="info" icon={<Icon icon="mdi:information-outline" />} sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    <strong>Alternative:</strong> You can skip this form and directly create +
                    upload a volume using virtctl:
                  </Typography>
                  <Box
                    sx={{
                      mt: 1,
                      p: 1.5,
                      bgcolor: 'background.paper',
                      borderRadius: 1,
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap',
                      border: 1,
                      borderColor: 'divider',
                    }}
                  >
                    {generateVirtctlCommand()}
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 1, display: 'block' }}
                  >
                    This command will automatically create the DataVolume and upload your file in
                    one step.
                  </Typography>
                </Box>
              </Box>
            </Alert>

            {/* Upload mode instructions */}
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ color: 'text.primary' }}>
                <strong>Upload Mode:</strong> This creates a DataVolume ready for upload. After
                creating, use <code>virtctl image-upload --no-create</code> to upload your local
                disk image.
              </Typography>
            </Alert>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Command to upload after creating this DataVolume:
            </Typography>
            <Box
              sx={{
                mt: 1,
                p: 1.5,
                bgcolor: 'background.paper',
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                border: 1,
                borderColor: 'divider',
              }}
            >
              {generateUploadCommand()}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Use <code>--no-create</code> flag since the DataVolume will already exist.
            </Typography>
          </Box>
        )}

        {sourceType === 'blank' && (
          <Box>
            <Typography variant="body2" color="text.secondary">
              Create an empty disk with the specified size.
            </Typography>
          </Box>
        )}
      </FormSection>

      <Divider />

      {/* Storage Configuration */}
      <FormSection icon="mdi:harddisk" title="Storage Configuration" color="storage" noGrid>
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField
            fullWidth
            label="Size"
            required
            value={storageSizeValue}
            onChange={e => updateStorageSize(e.target.value, storageSizeUnit)}
            inputProps={{ min: 1, type: 'number' }}
            helperText="Storage size for the volume"
          />
          <Select
            value={storageSizeUnit}
            onChange={e => updateStorageSize(storageSizeValue, e.target.value as 'Mi' | 'Gi')}
            sx={{ minWidth: 80 }}
          >
            <MenuItem value="Mi">MiB</MenuItem>
            <MenuItem value="Gi">GiB</MenuItem>
          </Select>
        </Box>

        <Autocomplete
          fullWidth
          options={storageClasses}
          value={storageClass}
          onChange={(_, newValue) => updateStorage({ storageClassName: newValue || undefined })}
          renderInput={params => (
            <TextField
              {...params}
              label="Storage Class"
              helperText="Storage class for the PVC (leave empty for default)"
            />
          )}
          sx={{ mb: 2 }}
        />

        <FormControl fullWidth sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            Access Mode
          </Typography>
          <Select
            value={accessMode}
            onChange={e => updateStorage({ accessModes: [e.target.value] })}
          >
            <MenuItem value="ReadWriteOnce">ReadWriteOnce (RWO)</MenuItem>
            <MenuItem value="ReadWriteMany">ReadWriteMany (RWX)</MenuItem>
            <MenuItem value="ReadOnlyMany">ReadOnlyMany (ROX)</MenuItem>
          </Select>
        </FormControl>

        <FormControl fullWidth sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            Volume Mode
          </Typography>
          <Select value={volumeMode} onChange={e => updateStorage({ volumeMode: e.target.value })}>
            <MenuItem value="Filesystem">Filesystem</MenuItem>
            <MenuItem value="Block">Block</MenuItem>
          </Select>
        </FormControl>

        {sourceType !== 'blank' && (
          <FormControl fullWidth>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Content Type
            </Typography>
            <Select
              value={contentType}
              onChange={e => updateContentType(e.target.value as 'kubevirt' | 'archive')}
            >
              <MenuItem value="kubevirt">KubeVirt (VM Disk)</MenuItem>
              <MenuItem value="archive">Archive (tar)</MenuItem>
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              KubeVirt: Treats as VM disk image, auto-converts qcow2 to raw
              <br />
              Archive: Extracts tar archive contents
            </Typography>
          </FormControl>
        )}
      </FormSection>
    </Box>
  );
}
