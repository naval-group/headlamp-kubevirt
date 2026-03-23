import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useMemo } from 'react';
import useResourceEditor from '../../hooks/useResourceEditor';
import FormSection from '../common/FormSection';
import MandatoryTextField from '../common/MandatoryTextField';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Permissive record type for building Kubernetes resource objects with deep nesting */
type KubeResourceBuilder = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface NADFormProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
  showErrors?: boolean;
}

const CNI_TYPES = [
  {
    value: 'bridge',
    label: 'Bridge',
    description: 'Linux bridge — L2 connectivity between VMs on the same host',
    icon: 'mdi:bridge',
  },
  {
    value: 'macvlan',
    label: 'Macvlan',
    description: 'Sub-interface with its own MAC off a host interface',
    icon: 'mdi:lan',
  },
  {
    value: 'ipvlan',
    label: 'IPvlan',
    description: 'Sub-interface sharing host MAC, separate IP',
    icon: 'mdi:ip-network',
  },
  {
    value: 'vlan',
    label: 'VLAN',
    description: '802.1q VLAN sub-interface',
    icon: 'mdi:tag-outline',
  },
  {
    value: 'host-device',
    label: 'Host Device',
    description: 'Move a host network device into the container',
    icon: 'mdi:expansion-card',
  },
  {
    value: 'sriov',
    label: 'SR-IOV',
    description: 'SR-IOV Virtual Function passthrough',
    icon: 'mdi:lightning-bolt',
  },
  { value: 'ptp', label: 'PTP', description: 'Point-to-point veth pair', icon: 'mdi:connection' },
  {
    value: 'tap',
    label: 'TAP',
    description: 'TAP device for VM/userspace networking',
    icon: 'mdi:ethernet',
  },
];

const IPAM_TYPES = [
  { value: 'none', label: 'None (L2 only)', description: 'No IP address management' },
  { value: 'host-local', label: 'Host-Local', description: 'Allocate from local address ranges' },
  { value: 'dhcp', label: 'DHCP', description: 'Acquire addresses from DHCP server' },
  { value: 'static', label: 'Static', description: 'Assign fixed IP addresses' },
];

const MACVLAN_MODES = ['bridge', 'private', 'vepa', 'passthru'];
const IPVLAN_MODES = ['l2', 'l3', 'l3s'];

export default function NADForm({
  resource,
  onChange,
  editMode = false,
  showErrors = false,
}: NADFormProps) {
  const { updateMetadata } = useResourceEditor(resource, onChange);

  // Parse the config JSON string into a working object
  const config = useMemo(() => {
    try {
      return JSON.parse(resource?.spec?.config || '{}');
    } catch {
      return { cniVersion: '0.3.1', type: 'bridge', ipam: {} };
    }
  }, [resource?.spec?.config]);

  // Update the CNI config and serialize back to spec.config
  const updateConfig = (updates: KubeResourceBuilder) => {
    const newConfig = { ...config, ...updates };
    onChange({
      ...resource,
      spec: {
        ...resource.spec,
        config: JSON.stringify(newConfig, null, 2),
      },
    });
  };

  // Update IPAM sub-object
  // eslint-disable-next-line no-unused-vars
  const updateIPAM = (updates: KubeResourceBuilder) => {
    updateConfig({ ipam: { ...config.ipam, ...updates } });
  };

  // Handle CNI type change — reset type-specific fields, keep common ones
  const handleCNITypeChange = (newType: string) => {
    const base: KubeResourceBuilder = {
      cniVersion: config.cniVersion || '0.3.1',
      name: config.name,
      type: newType,
      ipam: config.ipam || {},
    };
    // Set sensible defaults per type
    switch (newType) {
      case 'bridge':
        base.bridge = 'br0';
        break;
      case 'macvlan':
        base.mode = 'bridge';
        break;
      case 'ipvlan':
        base.mode = 'l2';
        break;
    }
    onChange({
      ...resource,
      spec: { ...resource.spec, config: JSON.stringify(base, null, 2) },
    });
  };

  // Handle IPAM type change
  const handleIPAMTypeChange = (newType: string) => {
    if (newType === 'none') {
      updateConfig({ ipam: {} });
    } else if (newType === 'host-local') {
      updateConfig({ ipam: { type: 'host-local', ranges: [[{ subnet: '' }]] } });
    } else if (newType === 'static') {
      updateConfig({ ipam: { type: 'static', addresses: [{ address: '' }] } });
    } else if (newType === 'dhcp') {
      updateConfig({ ipam: { type: 'dhcp' } });
    }
  };

  const ipamType =
    !config.ipam || Object.keys(config.ipam).length === 0 ? 'none' : config.ipam.type || 'none';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Basic Information */}
      <FormSection icon="mdi:information-outline" title="Basic Information" color="other">
        <Grid item xs={12} md={4}>
          <MandatoryTextField
            fullWidth
            label="Name"
            value={resource.metadata?.name || ''}
            onChange={e => updateMetadata('name', e.target.value)}
            showErrors={showErrors}
            helperText={editMode ? 'Name cannot be changed' : 'Network attachment definition name'}
            placeholder="my-network"
            disabled={editMode}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <MandatoryTextField
            fullWidth
            label="Namespace"
            value={resource.metadata?.namespace || 'default'}
            onChange={e => updateMetadata('namespace', e.target.value)}
            showErrors={showErrors}
            helperText={editMode ? 'Namespace cannot be changed' : 'Kubernetes namespace'}
            disabled={editMode}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            fullWidth
            select
            label="CNI Version"
            value={config.cniVersion || '0.3.1'}
            onChange={e => updateConfig({ cniVersion: e.target.value })}
            helperText="CNI specification version"
          >
            <MenuItem value="0.3.0">0.3.0</MenuItem>
            <MenuItem value="0.3.1">0.3.1</MenuItem>
            <MenuItem value="0.4.0">0.4.0</MenuItem>
            <MenuItem value="1.0.0">1.0.0</MenuItem>
            <MenuItem value="1.1.0">1.1.0</MenuItem>
          </TextField>
        </Grid>
      </FormSection>

      {/* CNI Plugin Type Selection */}
      <FormSection icon="mdi:network-outline" title="Network Type" color="network" noGrid>
        <Grid container spacing={2} sx={{ alignItems: 'stretch' }}>
          {CNI_TYPES.map(cni => (
            <Grid item xs={6} sm={4} md={3} key={cni.value} sx={{ display: 'flex' }}>
              <Paper
                variant="outlined"
                onClick={() => handleCNITypeChange(cni.value)}
                sx={{
                  p: 2,
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.2s',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderColor: config.type === cni.value ? 'primary.main' : 'divider',
                  borderWidth: config.type === cni.value ? 2 : 1,
                  bgcolor: config.type === cni.value ? 'primary.main' : 'transparent',
                  color: config.type === cni.value ? 'primary.contrastText' : 'text.primary',
                  '&:hover': {
                    borderColor: 'primary.main',
                    bgcolor: config.type === cni.value ? 'primary.main' : 'action.hover',
                  },
                }}
              >
                <Icon icon={cni.icon} width={28} />
                <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
                  {cni.label}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: config.type === cni.value ? 'primary.contrastText' : 'text.secondary',
                    display: 'block',
                    mt: 0.5,
                    lineHeight: 1.3,
                  }}
                >
                  {cni.description}
                </Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </FormSection>

      {/* Plugin Configuration — dynamic based on CNI type */}
      <FormSection
        icon="mdi:tune"
        title={`${CNI_TYPES.find(c => c.value === config.type)?.label || 'Plugin'} Configuration`}
        color="network"
        noGrid
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, mt: -1 }}>
          <Chip label={config.type || 'bridge'} size="small" color="primary" />
        </Box>

        {config.type === 'bridge' && <BridgeFields config={config} updateConfig={updateConfig} />}
        {config.type === 'macvlan' && <MacvlanFields config={config} updateConfig={updateConfig} />}
        {config.type === 'ipvlan' && <IpvlanFields config={config} updateConfig={updateConfig} />}
        {config.type === 'vlan' && <VlanFields config={config} updateConfig={updateConfig} />}
        {config.type === 'host-device' && (
          <HostDeviceFields config={config} updateConfig={updateConfig} />
        )}
        {config.type === 'sriov' && <SriovFields config={config} updateConfig={updateConfig} />}
        {config.type === 'ptp' && <PtpFields config={config} updateConfig={updateConfig} />}
        {config.type === 'tap' && <TapFields config={config} updateConfig={updateConfig} />}
      </FormSection>

      {/* IPAM Configuration */}
      <FormSection
        icon="mdi:ip-network"
        title="IP Address Management (IPAM)"
        color="network"
        noGrid
      >
        <TextField
          fullWidth
          select
          label="IPAM Type"
          value={ipamType}
          onChange={e => handleIPAMTypeChange(e.target.value)}
          sx={{ mb: 3 }}
        >
          {IPAM_TYPES.map(ipam => (
            <MenuItem key={ipam.value} value={ipam.value}>
              <Box>
                <Typography variant="body2">{ipam.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {ipam.description}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </TextField>

        {ipamType === 'none' && (
          <Alert severity="info" icon={<Icon icon="mdi:information-outline" />}>
            L2 only networking — no IP address management. Suitable for bridge networks where the
            guest handles its own IP configuration.
          </Alert>
        )}

        {ipamType === 'host-local' && <HostLocalIPAM config={config} updateConfig={updateConfig} />}

        {ipamType === 'dhcp' && (
          <Alert severity="info" icon={<Icon icon="mdi:information-outline" />}>
            IP addresses will be acquired from a DHCP server on the network. The DHCP daemon must be
            running on the host.
          </Alert>
        )}

        {ipamType === 'static' && <StaticIPAM config={config} updateConfig={updateConfig} />}
      </FormSection>
    </Box>
  );
}

// ─── CNI Type-Specific Field Components ────────────────────────────────────────

function BridgeFields({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Bridge Name"
          value={config.bridge || ''}
          onChange={e => updateConfig({ bridge: e.target.value })}
          helperText="Name of the Linux bridge on the host"
          placeholder="br0"
        />
      </Grid>
      <Grid item xs={12} md={3}>
        <TextField
          fullWidth
          label="MTU"
          value={config.mtu ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ mtu: val === '' ? undefined : parseInt(val) || undefined });
          }}
          inputProps={{ type: 'number', min: 0 }}
          helperText="Interface MTU (blank = kernel default)"
        />
      </Grid>
      <Grid item xs={12} md={3}>
        <TextField
          fullWidth
          label="VLAN Tag"
          value={config.vlan ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ vlan: val === '' ? undefined : parseInt(val) || undefined });
          }}
          inputProps={{ type: 'number', min: 0, max: 4094 }}
          helperText="VLAN tag (0-4094)"
        />
      </Grid>

      <Grid item xs={12}>
        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle2" sx={{ mb: 2, mt: 1 }}>
          Options
        </Typography>
      </Grid>

      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.isGateway || false}
              onChange={e => updateConfig({ isGateway: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">Gateway</Typography>
              <Typography variant="caption" color="text.secondary">
                Assign IP to bridge, making it a gateway
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.isDefaultGateway || false}
              onChange={e => updateConfig({ isDefaultGateway: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">Default Gateway</Typography>
              <Typography variant="caption" color="text.secondary">
                Make bridge IP the default route
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.ipMasq || false}
              onChange={e => updateConfig({ ipMasq: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">IP Masquerade</Typography>
              <Typography variant="caption" color="text.secondary">
                SNAT for outbound traffic
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.hairpinMode || false}
              onChange={e => updateConfig({ hairpinMode: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">Hairpin Mode</Typography>
              <Typography variant="caption" color="text.secondary">
                Allow container to reach its own IP via bridge
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.promiscMode || false}
              onChange={e => updateConfig({ promiscMode: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">Promiscuous Mode</Typography>
              <Typography variant="caption" color="text.secondary">
                Set promiscuous mode on bridge
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.macspoofchk || false}
              onChange={e => updateConfig({ macspoofchk: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">MAC Spoof Check</Typography>
              <Typography variant="caption" color="text.secondary">
                Restrict traffic to assigned MAC/IP
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.forceAddress || false}
              onChange={e => updateConfig({ forceAddress: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">Force Address</Typography>
              <Typography variant="caption" color="text.secondary">
                Reconfigure bridge IP if changed
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.preserveDefaultVlan !== false}
              onChange={e => updateConfig({ preserveDefaultVlan: e.target.checked })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">Preserve Default VLAN</Typography>
              <Typography variant="caption" color="text.secondary">
                Keep bridge default PVID 1
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <FormControlLabel
          control={
            <Switch
              checked={config.enabledad || false}
              onChange={e => updateConfig({ enabledad: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">DAD</Typography>
              <Typography variant="caption" color="text.secondary">
                Duplicate Address Detection for IPv6
              </Typography>
            </Box>
          }
        />
      </Grid>
    </Grid>
  );
}

function MacvlanFields({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="Master Interface"
          value={config.master || ''}
          onChange={e => updateConfig({ master: e.target.value || undefined })}
          helperText="Host interface (blank = default route interface)"
          placeholder="eth0"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          select
          label="Mode"
          value={config.mode || 'bridge'}
          onChange={e => updateConfig({ mode: e.target.value })}
          helperText="Macvlan operating mode"
        >
          {MACVLAN_MODES.map(m => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="MTU"
          value={config.mtu ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ mtu: val === '' ? undefined : parseInt(val) || undefined });
          }}
          inputProps={{ type: 'number', min: 0 }}
          helperText="Blank = kernel default"
        />
      </Grid>
      <Grid item xs={12}>
        <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
          <strong>bridge</strong> — containers can communicate directly &bull;
          <strong> private</strong> — no inter-container traffic &bull;
          <strong> vepa</strong> — traffic goes through external switch &bull;
          <strong> passthru</strong> — 1:1 master takeover
        </Alert>
      </Grid>
    </Grid>
  );
}

function IpvlanFields({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="Master Interface"
          value={config.master || ''}
          onChange={e => updateConfig({ master: e.target.value || undefined })}
          helperText="Host interface (blank = default route interface)"
          placeholder="eth0"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          select
          label="Mode"
          value={config.mode || 'l2'}
          onChange={e => updateConfig({ mode: e.target.value })}
          helperText="IPvlan operating mode"
        >
          {IPVLAN_MODES.map(m => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="MTU"
          value={config.mtu ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ mtu: val === '' ? undefined : parseInt(val) || undefined });
          }}
          inputProps={{ type: 'number', min: 0 }}
          helperText="Blank = kernel default"
        />
      </Grid>
      <Grid item xs={12}>
        <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
          <strong>l2</strong> — frame switching, broadcast works &bull;
          <strong> l3</strong> — IP routing only, no broadcast &bull;
          <strong> l3s</strong> — l3 with source address verification
        </Alert>
      </Grid>
    </Grid>
  );
}

function VlanFields({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          required
          label="Master Interface"
          value={config.master || ''}
          onChange={e => updateConfig({ master: e.target.value })}
          helperText="Host interface that supports 802.1q"
          placeholder="eth0"
          sx={{
            '& .MuiOutlinedInput-root fieldset': {
              borderColor: !config.master ? 'warning.main' : undefined,
            },
          }}
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          required
          label="VLAN ID"
          value={config.vlanId ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ vlanId: val === '' ? undefined : parseInt(val) });
          }}
          inputProps={{ type: 'number', min: 1, max: 4094 }}
          helperText="VLAN tag (1-4094)"
          sx={{
            '& .MuiOutlinedInput-root fieldset': {
              borderColor: !config.vlanId ? 'warning.main' : undefined,
            },
          }}
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="MTU"
          value={config.mtu ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ mtu: val === '' ? undefined : parseInt(val) || undefined });
          }}
          inputProps={{ type: 'number', min: 0 }}
          helperText="Blank = kernel default"
        />
      </Grid>
    </Grid>
  );
}

function HostDeviceFields({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  const hasAny = config.device || config.hwaddr || config.kernelpath || config.pciBusID;
  return (
    <Grid container spacing={3}>
      {!hasAny && (
        <Grid item xs={12}>
          <Alert severity="warning">
            At least one of device name, MAC address, kernel path, or PCI bus ID is required.
          </Alert>
        </Grid>
      )}
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Device Name"
          value={config.device || ''}
          onChange={e => updateConfig({ device: e.target.value || undefined })}
          helperText='Network device name (e.g. "eth1")'
          placeholder="eth1"
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="MAC Address"
          value={config.hwaddr || ''}
          onChange={e => updateConfig({ hwaddr: e.target.value || undefined })}
          helperText='Hardware address (e.g. "02:42:ac:11:00:02")'
          placeholder="02:42:ac:11:00:02"
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Kernel Path"
          value={config.kernelpath || ''}
          onChange={e => updateConfig({ kernelpath: e.target.value || undefined })}
          helperText="Kernel device kobj path"
          placeholder="/sys/devices/pci0000:00/0000:00:1f.6"
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="PCI Bus ID"
          value={config.pciBusID || ''}
          onChange={e => updateConfig({ pciBusID: e.target.value || undefined })}
          helperText='PCI address (e.g. "0000:00:1f.6")'
          placeholder="0000:00:1f.6"
        />
      </Grid>
    </Grid>
  );
}

function SriovFields({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Alert severity="info" variant="outlined">
          SR-IOV requires the SR-IOV device plugin and operator to be installed. The VF PCI address
          is typically injected automatically at runtime.
        </Alert>
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="VLAN"
          value={config.vlan ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ vlan: val === '' ? undefined : parseInt(val) });
          }}
          inputProps={{ type: 'number', min: 0, max: 4094 }}
          helperText="VLAN ID (0 = no VLAN)"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="VLAN QoS"
          value={config.vlanQoS ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ vlanQoS: val === '' ? undefined : parseInt(val) });
          }}
          inputProps={{ type: 'number', min: 0, max: 7 }}
          helperText="VLAN QoS priority (0-7)"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          select
          label="VLAN Protocol"
          value={config.vlanProto || '802.1q'}
          onChange={e => updateConfig({ vlanProto: e.target.value })}
          helperText="802.1q or 802.1ad (QinQ)"
        >
          <MenuItem value="802.1q">802.1q</MenuItem>
          <MenuItem value="802.1ad">802.1ad (QinQ)</MenuItem>
        </TextField>
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="MAC Address"
          value={config.mac || ''}
          onChange={e => updateConfig({ mac: e.target.value || undefined })}
          placeholder="02:00:00:00:00:01"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          select
          label="Spoof Check"
          value={config.spoofchk || ''}
          onChange={e => updateConfig({ spoofchk: e.target.value || undefined })}
        >
          <MenuItem value="">Default</MenuItem>
          <MenuItem value="on">On</MenuItem>
          <MenuItem value="off">Off</MenuItem>
        </TextField>
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          select
          label="Trust"
          value={config.trust || ''}
          onChange={e => updateConfig({ trust: e.target.value || undefined })}
        >
          <MenuItem value="">Default</MenuItem>
          <MenuItem value="on">On</MenuItem>
          <MenuItem value="off">Off</MenuItem>
        </TextField>
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          select
          label="Link State"
          value={config.linkState || ''}
          onChange={e => updateConfig({ linkState: e.target.value || undefined })}
        >
          <MenuItem value="">Default</MenuItem>
          <MenuItem value="auto">Auto</MenuItem>
          <MenuItem value="enable">Enable</MenuItem>
          <MenuItem value="disable">Disable</MenuItem>
        </TextField>
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="Min TX Rate (Mbps)"
          value={config.minTxRate ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ minTxRate: val === '' ? undefined : parseInt(val) });
          }}
          inputProps={{ type: 'number', min: 0 }}
          helperText="0 = no minimum"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="Max TX Rate (Mbps)"
          value={config.maxTxRate ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ maxTxRate: val === '' ? undefined : parseInt(val) });
          }}
          inputProps={{ type: 'number', min: 0 }}
          helperText="0 = no limit"
        />
      </Grid>
    </Grid>
  );
}

function PtpFields({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="MTU"
          value={config.mtu ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ mtu: val === '' ? undefined : parseInt(val) || undefined });
          }}
          inputProps={{ type: 'number', min: 0 }}
          helperText="Blank = kernel default"
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <FormControlLabel
          control={
            <Switch
              checked={config.ipMasq || false}
              onChange={e => updateConfig({ ipMasq: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">IP Masquerade</Typography>
              <Typography variant="caption" color="text.secondary">
                SNAT for outbound traffic
              </Typography>
            </Box>
          }
        />
      </Grid>
    </Grid>
  );
}

function TapFields({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="MAC Address"
          value={config.mac || ''}
          onChange={e => updateConfig({ mac: e.target.value || undefined })}
          placeholder="02:00:00:00:00:01"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="MTU"
          value={config.mtu ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ mtu: val === '' ? undefined : parseInt(val) || undefined });
          }}
          inputProps={{ type: 'number', min: 0 }}
          helperText="Blank = kernel default"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="Bridge"
          value={config.bridge || ''}
          onChange={e => updateConfig({ bridge: e.target.value || undefined })}
          helperText="Attach TAP to existing bridge"
          placeholder="br0"
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="SELinux Context"
          value={config.selinuxcontext || ''}
          onChange={e => updateConfig({ selinuxcontext: e.target.value || undefined })}
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="Owner (UID)"
          value={config.owner ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ owner: val === '' ? undefined : parseInt(val) });
          }}
          inputProps={{ type: 'number', min: 0 }}
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField
          fullWidth
          label="Group (GID)"
          value={config.group ?? ''}
          onChange={e => {
            const val = e.target.value;
            updateConfig({ group: val === '' ? undefined : parseInt(val) });
          }}
          inputProps={{ type: 'number', min: 0 }}
        />
      </Grid>
      <Grid item xs={12}>
        <FormControlLabel
          control={
            <Switch
              checked={config.multiQueue || false}
              onChange={e => updateConfig({ multiQueue: e.target.checked || undefined })}
            />
          }
          label={
            <Box>
              <Typography variant="body2">Multi-Queue</Typography>
              <Typography variant="caption" color="text.secondary">
                Enable multi-queue TAP for multi-vCPU VMs
              </Typography>
            </Box>
          }
        />
      </Grid>
    </Grid>
  );
}

// ─── IPAM Field Components ─────────────────────────────────────────────────────

function HostLocalIPAM({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  const ranges = config.ipam?.ranges?.[0] || [{ subnet: '' }];
  const routes = config.ipam?.routes || [];

  const updateRanges = (newRanges: Record<string, unknown>[]) => {
    updateConfig({
      ipam: { ...config.ipam, ranges: [newRanges] },
    });
  };

  const updateRoutes = (newRoutes: Record<string, unknown>[]) => {
    updateConfig({
      ipam: { ...config.ipam, routes: newRoutes.length > 0 ? newRoutes : undefined },
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Ranges */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle2">Subnet Ranges</Typography>
          <Tooltip title="Add range">
            <IconButton
              size="small"
              color="primary"
              onClick={() => updateRanges([...ranges, { subnet: '' }])}
            >
              <Icon icon="mdi:plus-circle" />
            </IconButton>
          </Tooltip>
        </Box>

        {ranges.map((range: Record<string, unknown>, idx: number) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2, position: 'relative' }}>
            {ranges.length > 1 && (
              <IconButton
                size="small"
                onClick={() => updateRanges(ranges.filter((_: unknown, i: number) => i !== idx))}
                sx={{ position: 'absolute', top: 4, right: 4 }}
              >
                <Icon icon="mdi:close" width={18} />
              </IconButton>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  required
                  label="Subnet"
                  value={range.subnet || ''}
                  onChange={e => {
                    const updated = [...ranges];
                    updated[idx] = { ...updated[idx], subnet: e.target.value };
                    updateRanges(updated);
                  }}
                  placeholder="10.10.0.0/24"
                  size="small"
                  sx={{
                    '& .MuiOutlinedInput-root fieldset': {
                      borderColor: !range.subnet ? 'warning.main' : undefined,
                    },
                  }}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Range Start"
                  value={range.rangeStart || ''}
                  onChange={e => {
                    const updated = [...ranges];
                    updated[idx] = { ...updated[idx], rangeStart: e.target.value || undefined };
                    updateRanges(updated);
                  }}
                  placeholder="10.10.0.10"
                  size="small"
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Range End"
                  value={range.rangeEnd || ''}
                  onChange={e => {
                    const updated = [...ranges];
                    updated[idx] = { ...updated[idx], rangeEnd: e.target.value || undefined };
                    updateRanges(updated);
                  }}
                  placeholder="10.10.0.200"
                  size="small"
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Gateway"
                  value={range.gateway || ''}
                  onChange={e => {
                    const updated = [...ranges];
                    updated[idx] = { ...updated[idx], gateway: e.target.value || undefined };
                    updateRanges(updated);
                  }}
                  placeholder="10.10.0.1"
                  size="small"
                />
              </Grid>
            </Grid>
          </Paper>
        ))}
      </Box>

      {/* Routes */}
      <RoutesEditor routes={routes} onChange={updateRoutes} />
    </Box>
  );
}

function StaticIPAM({
  config,
  updateConfig,
}: {
  config: KubeResourceBuilder;
  updateConfig: (u: KubeResourceBuilder) => void;
}) {
  const addresses = config.ipam?.addresses || [{ address: '' }];
  const routes = config.ipam?.routes || [];

  const updateAddresses = (newAddresses: Record<string, unknown>[]) => {
    updateConfig({
      ipam: { ...config.ipam, addresses: newAddresses },
    });
  };

  const updateRoutes = (newRoutes: Record<string, unknown>[]) => {
    updateConfig({
      ipam: { ...config.ipam, routes: newRoutes.length > 0 ? newRoutes : undefined },
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Addresses */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle2">Static Addresses</Typography>
          <Tooltip title="Add address">
            <IconButton
              size="small"
              color="primary"
              onClick={() => updateAddresses([...addresses, { address: '' }])}
            >
              <Icon icon="mdi:plus-circle" />
            </IconButton>
          </Tooltip>
        </Box>

        {addresses.map((addr: Record<string, unknown>, idx: number) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2, position: 'relative' }}>
            {addresses.length > 1 && (
              <IconButton
                size="small"
                onClick={() =>
                  updateAddresses(addresses.filter((_: unknown, i: number) => i !== idx))
                }
                sx={{ position: 'absolute', top: 4, right: 4 }}
              >
                <Icon icon="mdi:close" width={18} />
              </IconButton>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  required
                  label="Address (CIDR)"
                  value={addr.address || ''}
                  onChange={e => {
                    const updated = [...addresses];
                    updated[idx] = { ...updated[idx], address: e.target.value };
                    updateAddresses(updated);
                  }}
                  placeholder="10.10.0.5/24"
                  size="small"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Gateway"
                  value={addr.gateway || ''}
                  onChange={e => {
                    const updated = [...addresses];
                    updated[idx] = { ...updated[idx], gateway: e.target.value || undefined };
                    updateAddresses(updated);
                  }}
                  placeholder="10.10.0.1"
                  size="small"
                />
              </Grid>
            </Grid>
          </Paper>
        ))}
      </Box>

      {/* Routes */}
      <RoutesEditor routes={routes} onChange={updateRoutes} />
    </Box>
  );
}

function RoutesEditor({
  routes,
  onChange,
}: {
  routes: Record<string, unknown>[];
  onChange: (routes: Record<string, unknown>[]) => void;
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle2">Routes</Typography>
        <Tooltip title="Add route">
          <IconButton
            size="small"
            color="primary"
            onClick={() => onChange([...routes, { dst: '' }])}
          >
            <Icon icon="mdi:plus-circle" />
          </IconButton>
        </Tooltip>
      </Box>

      {routes.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          No routes configured. Click + to add a route.
        </Typography>
      )}

      {routes.map((route: Record<string, unknown>, idx: number) => (
        <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2, position: 'relative' }}>
          <IconButton
            size="small"
            onClick={() => onChange(routes.filter((_: unknown, i: number) => i !== idx))}
            sx={{ position: 'absolute', top: 4, right: 4 }}
          >
            <Icon icon="mdi:close" width={18} />
          </IconButton>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Destination (CIDR)"
                value={route.dst || ''}
                onChange={e => {
                  const updated = [...routes];
                  updated[idx] = { ...updated[idx], dst: e.target.value };
                  onChange(updated);
                }}
                placeholder="0.0.0.0/0"
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Gateway"
                value={route.gw || ''}
                onChange={e => {
                  const updated = [...routes];
                  updated[idx] = { ...updated[idx], gw: e.target.value || undefined };
                  onChange(updated);
                }}
                placeholder="10.10.0.1"
                size="small"
              />
            </Grid>
          </Grid>
        </Paper>
      ))}
    </Box>
  );
}
