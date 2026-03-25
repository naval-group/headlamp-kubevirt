import { Icon } from '@iconify/react';
import {
  Box,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import yaml from 'js-yaml';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import FormDialog from '../common/FormDialog';
import VirtualMachineClusterInstanceType from './VirtualMachineClusterInstanceType';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div role="tabpanel" hidden={value !== index} id={`tabpanel-${index}`} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

interface CreateInstanceTypeProps {
  open: boolean;
  onClose: () => void;
}

export default function CreateInstanceType({ open, onClose }: CreateInstanceTypeProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [tabValue, setTabValue] = useState(0);

  // Basic Info
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');

  // CPU & Memory
  const [cpuCores, setCpuCores] = useState('2');
  const [memory, setMemory] = useState('4');
  const [memoryUnit, setMemoryUnit] = useState('Gi');

  // Advanced CPU Options
  const [dedicatedCPU, setDedicatedCPU] = useState(false);
  const [isolateEmulator, setIsolateEmulator] = useState(false);
  const [ioThreadsPolicy, setIoThreadsPolicy] = useState('');

  // Hugepages
  const [useHugepages, setUseHugepages] = useState(false);
  const [hugepagesSize, setHugepagesSize] = useState('2Mi');

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const generateResource = () => {
    const spec: KubeResourceBuilder = {
      cpu: {
        guest: parseInt(cpuCores) || 2,
      },
      memory: {
        guest: `${memory}${memoryUnit}`,
      },
    };

    if (dedicatedCPU) {
      spec.cpu.dedicatedCPUPlacement = true;
    }

    if (isolateEmulator) {
      spec.cpu.isolateEmulatorThread = true;
    }

    if (ioThreadsPolicy) {
      spec.ioThreadsPolicy = ioThreadsPolicy;
    }

    if (useHugepages) {
      spec.memory.hugepages = {
        pageSize: hugepagesSize,
      };
    }

    const annotations: Record<string, string> = {};
    if (displayName) {
      annotations['instancetype.kubevirt.io/displayName'] = displayName;
    }
    if (description) {
      annotations['instancetype.kubevirt.io/description'] = description;
    }

    return {
      apiVersion: 'instancetype.kubevirt.io/v1beta1',
      kind: 'VirtualMachineClusterInstancetype',
      metadata: {
        name: name || 'my-instancetype',
        ...(Object.keys(annotations).length > 0 && { annotations }),
      },
      spec,
    };
  };

  const handleSave = async () => {
    if (!name) {
      enqueueSnackbar('Name is required', { variant: 'error' });
      return;
    }

    if (!cpuCores || parseInt(cpuCores) < 1) {
      enqueueSnackbar('CPU cores must be at least 1', { variant: 'error' });
      return;
    }

    if (!memory || parseInt(memory) < 1) {
      enqueueSnackbar('Memory must be at least 1', { variant: 'error' });
      return;
    }

    const resource = generateResource();

    try {
      await VirtualMachineClusterInstanceType.apiEndpoint.post(resource);
      enqueueSnackbar(`Instance Type ${resource.metadata.name} created successfully`, {
        variant: 'success',
      });
      onClose();
    } catch (error: unknown) {
      console.error('Failed to create Instance Type:', error);
      enqueueSnackbar('Failed to create Instance Type.', {
        variant: 'error',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSave={handleSave}
      title="Create Instance Type"
      saveLabel="Create"
      maxWidth="lg"
      disableSave={!name || !cpuCores || !memory}
    >
      <Box sx={{ flexGrow: 1 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={handleTabChange}>
            <Tab
              label="Basic Configuration"
              icon={<Icon icon="mdi:form-textbox" />}
              iconPosition="start"
            />
            <Tab label="Advanced Options" icon={<Icon icon="mdi:tune" />} iconPosition="start" />
            <Tab label="YAML" icon={<Icon icon="mdi:code-braces" />} iconPosition="start" />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
            {/* Basic Information */}
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Icon icon="mdi:information-outline" />
                  <Typography variant="h6">Basic Information</Typography>
                </Box>

                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      required
                      label="Name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      helperText="Unique identifier for this instance type"
                      placeholder="custom.large"
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Display Name"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      helperText="Human-readable name"
                      placeholder="Custom Large"
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      multiline
                      rows={3}
                      label="Description"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      helperText="Detailed description of this instance type"
                    />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {/* CPU & Memory */}
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Icon icon="mdi:chip" />
                  <Typography variant="h6">CPU & Memory</Typography>
                </Box>

                <Grid container spacing={3}>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      required
                      type="number"
                      label="CPU Cores"
                      value={cpuCores}
                      onChange={e => setCpuCores(e.target.value)}
                      inputProps={{ min: 1 }}
                      helperText="Number of virtual CPU cores"
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      required
                      type="number"
                      label="Memory"
                      value={memory}
                      onChange={e => setMemory(e.target.value)}
                      inputProps={{ min: 1 }}
                      helperText="Amount of memory"
                    />
                  </Grid>

                  <Grid item xs={12} sm={2}>
                    <TextField
                      fullWidth
                      select
                      label="Unit"
                      value={memoryUnit}
                      onChange={e => setMemoryUnit(e.target.value)}
                    >
                      <MenuItem value="Mi">Mi</MenuItem>
                      <MenuItem value="Gi">Gi</MenuItem>
                    </TextField>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Grid container spacing={3}>
            {/* CPU Features */}
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Icon icon="mdi:cpu-64-bit" />
                  <Typography variant="h6">CPU Features</Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={dedicatedCPU}
                        onChange={e => setDedicatedCPU(e.target.checked)}
                      />
                    }
                    label={
                      <Box>
                        <Typography>Dedicated CPU Placement</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Pins vCPUs to physical CPU cores for better performance
                        </Typography>
                      </Box>
                    }
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={isolateEmulator}
                        onChange={e => setIsolateEmulator(e.target.checked)}
                      />
                    }
                    label={
                      <Box>
                        <Typography>Isolate Emulator Thread</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Runs emulator thread on separate core (requires dedicated CPU)
                        </Typography>
                      </Box>
                    }
                  />

                  <TextField
                    fullWidth
                    select
                    label="IO Threads Policy"
                    value={ioThreadsPolicy}
                    onChange={e => setIoThreadsPolicy(e.target.value)}
                    helperText="Controls how IO threads are allocated"
                  >
                    <MenuItem value="">None</MenuItem>
                    <MenuItem value="auto">Auto</MenuItem>
                    <MenuItem value="shared">Shared</MenuItem>
                  </TextField>
                </Box>
              </Paper>
            </Grid>

            {/* Memory Features */}
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Icon icon="mdi:memory" />
                  <Typography variant="h6">Memory Features</Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={useHugepages}
                        onChange={e => setUseHugepages(e.target.checked)}
                      />
                    }
                    label={
                      <Box>
                        <Typography>Use Hugepages</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Use larger memory pages for improved performance
                        </Typography>
                      </Box>
                    }
                  />

                  {useHugepages && (
                    <TextField
                      fullWidth
                      select
                      label="Hugepages Size"
                      value={hugepagesSize}
                      onChange={e => setHugepagesSize(e.target.value)}
                    >
                      <MenuItem value="2Mi">2 MiB</MenuItem>
                      <MenuItem value="1Gi">1 GiB</MenuItem>
                    </TextField>
                  )}
                </Box>
              </Paper>
            </Grid>
          </Grid>
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography
              component="pre"
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                bgcolor: 'background.paper',
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
                maxHeight: '60vh',
              }}
            >
              {yaml.dump(generateResource())}
            </Typography>
          </Paper>
        </TabPanel>
      </Box>
    </FormDialog>
  );
}
