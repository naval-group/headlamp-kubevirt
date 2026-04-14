import { Icon } from '@iconify/react';
import { Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { dumpYaml } from '../../utils/templateUtils';
import CreateTemplateWizard from './CreateTemplateWizard';
import ProcessTemplateDialog from './ProcessTemplateDialog';
import VirtualMachineTemplate from './VirtualMachineTemplate';

export default function VirtualMachineTemplateDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [template] = VirtualMachineTemplate.useGet(name, namespace);
  const [processOpen, setProcessOpen] = useState(false);
  const [editWizardOpen, setEditWizardOpen] = useState(false);

  if (!template) {
    return null;
  }

  const params = template.getParameters();
  const vmSpec = template.getVirtualMachineSpec();
  const message = template.getMessage();
  const isReady = template.isReady();

  return (
    <>
      <Resource.DetailsGrid
        resourceType={VirtualMachineTemplate}
        name={name}
        namespace={namespace}
        withEvents
        actions={[
          {
            id: 'process',
            action: (
              <ActionButton
                description="Create VM from Template"
                icon="mdi:play-circle"
                onClick={() => setProcessOpen(true)}
                iconButtonProps={{ disabled: !isReady }}
              />
            ),
          },
          {
            id: 'edit-wizard',
            action: (
              <ActionButton
                description="Edit with Wizard"
                icon="mdi:auto-fix"
                onClick={() => setEditWizardOpen(true)}
              />
            ),
          },
        ]}
      />

      <Grid container spacing={3} sx={{ mt: 2, px: 2, pb: 4 }}>
        {/* Overview */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Icon icon="mdi:text-box-outline" width={20} />
                <Typography variant="h6">Overview</Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Status
                </Typography>
                <Box mt={0.5}>
                  <Chip
                    label={isReady ? 'Ready' : 'Not Ready'}
                    size="small"
                    color={isReady ? 'success' : 'default'}
                  />
                </Box>
              </Box>

              <Box mb={2}>
                <Typography variant="caption" color="text.secondary">
                  Parameters
                </Typography>
                <Typography variant="body1">
                  {params.length} total, {template.getRequiredParameterCount()} required
                </Typography>
              </Box>

              {message && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary">
                    Message
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 0.5,
                      fontFamily: 'monospace',
                      bgcolor: 'action.hover',
                      p: 1,
                      borderRadius: 1,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {message}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Parameters */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Icon icon="mdi:tune" width={20} />
                <Typography variant="h6">Parameters</Typography>
              </Box>

              {params.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No parameters defined
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Default</TableCell>
                      <TableCell>Required</TableCell>
                      <TableCell>Generator</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {params.map(param => (
                      <TableRow key={param.name}>
                        <TableCell>
                          <Box>
                            <Typography variant="body2" fontWeight={500}>
                              {param.displayName || param.name}
                            </Typography>
                            {param.description && (
                              <Typography variant="caption" color="text.secondary">
                                {param.description}
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {param.value || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {param.required ? (
                            <Chip
                              label="Required"
                              size="small"
                              color="warning"
                              variant="outlined"
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Optional
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {param.generate ? (
                            <Chip
                              label={param.generate}
                              size="small"
                              variant="outlined"
                              title={param.from ? `Pattern: ${param.from}` : undefined}
                            />
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* VM Spec Preview */}
        {vmSpec && (
          <Grid item xs={12}>
            <SectionBox title="VM Spec Preview">
              <Box
                sx={{
                  bgcolor: 'action.hover',
                  p: 2,
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 400,
                  overflow: 'auto',
                }}
              >
                {dumpYaml(vmSpec)}
              </Box>
            </SectionBox>
          </Grid>
        )}
      </Grid>

      <ProcessTemplateDialog
        open={processOpen}
        onClose={() => setProcessOpen(false)}
        template={template}
      />

      <CreateTemplateWizard
        open={editWizardOpen}
        onClose={() => setEditWizardOpen(false)}
        initialTemplate={template}
      />
    </>
  );
}
