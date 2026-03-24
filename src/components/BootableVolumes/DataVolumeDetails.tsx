import { Icon } from '@iconify/react';
import { Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { KubeCondition } from '../../types';
import CopyCodeBlock from '../common/CopyCodeBlock';
import CreateResourceDialog from '../common/CreateResourceDialog';
import DataVolume from './DataVolume';
import ImportVolumeForm from './ImportVolumeForm';

export default function DataVolumeDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [dv] = DataVolume.useGet(name, namespace);
  const [editOpen, setEditOpen] = useState(false);

  if (!dv) {
    return null;
  }

  const renderSourceDetails = () => {
    const sourceSpec = dv.spec?.source;
    if (!sourceSpec) return null;

    if (sourceSpec.http) {
      return (
        <Box>
          <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
            HTTP Source
          </Typography>
          <Typography variant="caption" color="text.secondary">
            URL:
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {sourceSpec.http.url}
          </Typography>
        </Box>
      );
    } else if (sourceSpec.registry) {
      return (
        <Box>
          <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
            Registry Source
          </Typography>
          <Typography variant="caption" color="text.secondary">
            URL:
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {sourceSpec.registry.url}
          </Typography>
        </Box>
      );
    } else if (sourceSpec.pvc) {
      return (
        <Box>
          <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
            Clone PVC Source
          </Typography>
          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Name:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {sourceSpec.pvc.name}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Namespace:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {sourceSpec.pvc.namespace}
            </Typography>
          </Box>
        </Box>
      );
    } else if (sourceSpec.snapshot) {
      return (
        <Box>
          <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
            Snapshot Source
          </Typography>
          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Name:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {sourceSpec.snapshot.name}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Namespace:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {sourceSpec.snapshot.namespace}
            </Typography>
          </Box>
        </Box>
      );
    } else if (sourceSpec.upload) {
      return (
        <Box>
          <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
            Upload Source
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Ready for upload via virtctl image-upload
          </Typography>
        </Box>
      );
    } else if (sourceSpec.blank) {
      return (
        <Box>
          <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
            Blank Volume
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Empty disk
          </Typography>
        </Box>
      );
    }

    return null;
  };

  return (
    <>
      <Resource.DetailsGrid
        resourceType={DataVolume}
        name={name}
        namespace={namespace}
        withEvents
        actions={[
          <Tooltip title="Edit with Wizard">
            <IconButton key="edit-wizard" onClick={() => setEditOpen(true)} size="small">
              <Icon icon="mdi:auto-fix" />
            </IconButton>
          </Tooltip>,
        ]}
      />

      <Grid container spacing={3} sx={{ mt: 2, px: 2 }}>
        {/* Upload Instructions — shown while waiting for upload */}
        {dv.spec?.source?.upload &&
          (dv.status?.phase === 'UploadReady' || dv.status?.phase === 'UploadScheduled') && (
            <Grid item xs={12}>
              <Alert severity="info" icon={<Icon icon="mdi:upload" />}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>Ready for Upload:</strong> This DataVolume is waiting for a file upload.
                </Typography>
                <CopyCodeBlock
                  title="Step 1 — Port-forward the CDI upload proxy"
                  code={`kubectl port-forward -n cdi svc/cdi-uploadproxy 3443:443 &\nPF_PID=$!`}
                />
                <CopyCodeBlock
                  title="Step 2 — Upload a local disk image"
                  code={`virtctl image-upload dv ${name} \\\n  --namespace ${namespace} \\\n  --no-create \\\n  --uploadproxy-url=https://localhost:3443 \\\n  --insecure \\\n  --image-path=/path/to/disk.qcow2`}
                />
                <CopyCodeBlock title="Step 3 — Stop the port-forward" code={`kill $PF_PID`} />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1, display: 'block' }}
                >
                  Supported formats: qcow2, raw, ISO, vmdk (auto-detected). The{' '}
                  <code>--insecure</code> flag is needed because the port-forward uses a self-signed
                  certificate.
                </Typography>
              </Alert>
            </Grid>
          )}
        {/* Upload Success — shown after upload completes */}
        {dv.spec?.source?.upload && dv.status?.phase === 'Succeeded' && (
          <Grid item xs={12}>
            <Alert severity="success" icon={<Icon icon="mdi:check-circle" />}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Upload complete!</strong> The disk image has been successfully uploaded to
                this DataVolume.
              </Typography>
              <CopyCodeBlock title="Don't forget to stop the port-forward" code={`kill $PF_PID`} />
            </Alert>
          </Grid>
        )}

        {/* Summary */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Icon icon="mdi:information-outline" />
                <Typography variant="h6">Summary</Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Source Type
                </Typography>
                <Typography variant="body1">{dv.getSourceType()}</Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Size
                </Typography>
                <Typography variant="body1">{dv.getSize()}</Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Storage Class
                </Typography>
                <Typography variant="body1">{dv.getStorageClass()}</Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Content Type
                </Typography>
                <Typography variant="body1">{dv.getContentType()}</Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Phase
                </Typography>
                <Chip
                  label={dv.status?.phase || 'Unknown'}
                  size="small"
                  color={dv.status?.phase === 'Succeeded' ? 'success' : 'default'}
                />
              </Box>

              {dv.status?.progress && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Progress
                  </Typography>
                  <Typography variant="body1">{dv.status.progress}</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Source Details */}
        {dv.spec?.source && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Icon icon="mdi:database" />
                  <Typography variant="h6">Source Details</Typography>
                </Box>

                {renderSourceDetails()}
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Conditions */}
        {dv.status?.conditions && dv.status.conditions.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Icon icon="mdi:check-circle-outline" />
                  <Typography variant="h6">Conditions</Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {dv.status.conditions.map((condition: KubeCondition, idx: number) => (
                    <Box
                      key={idx}
                      sx={{
                        p: 2,
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        bgcolor: condition.status === 'True' ? 'success.light' : 'action.hover',
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2" fontWeight="bold">
                          {condition.type}
                        </Typography>
                        <Chip
                          label={condition.status}
                          size="small"
                          color={condition.status === 'True' ? 'success' : 'default'}
                        />
                      </Box>
                      {condition.reason && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ mb: 0.5 }}
                        >
                          Reason: {condition.reason}
                        </Typography>
                      )}
                      {condition.message && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {condition.message}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      <CreateResourceDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit DataVolume"
        resourceClass={DataVolume}
        initialResource={dv.jsonData}
        editMode
        formComponent={ImportVolumeForm}
      />
    </>
  );
}
