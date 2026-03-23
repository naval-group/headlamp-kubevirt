import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Chip, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import NADForm from './NADForm';
import NetworkAttachmentDefinition from './NetworkAttachmentDefinition';

const INITIAL_NAD = {
  apiVersion: 'k8s.cni.cncf.io/v1',
  kind: 'NetworkAttachmentDefinition',
  metadata: {
    name: '',
    namespace: 'default',
  },
  spec: {
    config: JSON.stringify(
      {
        cniVersion: '0.3.1',
        type: 'bridge',
        bridge: 'br0',
        ipam: {},
      },
      null,
      2
    ),
  },
};

const TYPE_COLORS: Record<
  string,
  'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error'
> = {
  bridge: 'primary',
  macvlan: 'secondary',
  ipvlan: 'info',
  vlan: 'warning',
  'host-device': 'success',
  sriov: 'error',
  ptp: 'info',
  tap: 'secondary',
};

export default function NADList() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState(0);
  const [multusInstalled, setMultusInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    ApiProxy.request(
      '/apis/apiextensions.k8s.io/v1/customresourcedefinitions/network-attachment-definitions.k8s.cni.cncf.io'
    )
      .then(() => setMultusInstalled(true))
      .catch(() => setMultusInstalled(false));
  }, []);

  if (multusInstalled === false) {
    return (
      <SectionBox title="Networks">
        <Alert severity="info" sx={{ m: 2 }}>
          <Typography variant="body2">
            <strong>Multus CNI is not installed.</strong> Network Attachment Definitions require{' '}
            <a
              href="https://github.com/k8snetworkplumbingwg/multus-cni"
              target="_blank"
              rel="noopener noreferrer"
            >
              Multus CNI
            </a>{' '}
            to be deployed in your cluster.
          </Typography>
        </Alert>
      </SectionBox>
    );
  }

  return (
    <>
      <Resource.ResourceListView
        title="Networks"
        resourceClass={NetworkAttachmentDefinition}
        columns={[
          {
            id: 'name',
            label: 'Name',
            getValue: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => nad.getName(),
            render: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => (
              <Link routeName="nad" params={{ name: nad.getName(), namespace: nad.getNamespace() }}>
                {nad.getName()}
              </Link>
            ),
          },
          'namespace',
          {
            id: 'type',
            label: 'Type',
            getValue: (nad: InstanceType<typeof NetworkAttachmentDefinition>) =>
              nad.getNetworkType(),
            render: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => {
              const type = nad.getNetworkType();
              return (
                <Chip
                  label={type}
                  size="small"
                  color={TYPE_COLORS[type] || 'default'}
                  variant="filled"
                />
              );
            },
          },
          {
            id: 'ipam',
            label: 'IPAM',
            getValue: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => nad.getIPAMType(),
            render: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => {
              const ipamType = nad.getIPAMType();
              return <Chip label={ipamType} size="small" variant="outlined" />;
            },
          },
          {
            id: 'details',
            label: 'Details',
            getValue: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => {
              const config = nad.getParsedConfig();
              const parts: string[] = [];
              if (config.bridge) parts.push(`bridge: ${config.bridge}`);
              if (config.master) parts.push(`master: ${config.master}`);
              if (config.vlanId) parts.push(`vlan: ${config.vlanId}`);
              if (config.mtu) parts.push(`mtu: ${config.mtu}`);
              if (config.mode) parts.push(`mode: ${config.mode}`);
              return parts.join(' · ') || '-';
            },
            render: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => {
              const config = nad.getParsedConfig();
              const parts: string[] = [];
              if (config.bridge) parts.push(`bridge: ${config.bridge}`);
              if (config.master) parts.push(`master: ${config.master}`);
              if (config.vlanId) parts.push(`vlan: ${config.vlanId}`);
              if (config.mtu) parts.push(`mtu: ${config.mtu}`);
              if (config.mode) parts.push(`mode: ${config.mode}`);
              return (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                >
                  {parts.join(' · ') || '-'}
                </Typography>
              );
            },
          },
          'age',
        ]}
        headerProps={{
          titleSideActions: [
            <CreateButtonWithMode
              key="create"
              label="Create Network"
              onCreateForm={() => {
                setCreateInitialTab(0);
                setCreateOpen(true);
              }}
              onCreateYAML={() => {
                setCreateInitialTab(1);
                setCreateOpen(true);
              }}
            />,
          ],
        }}
      />

      <CreateResourceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Network Attachment Definition"
        resourceClass={NetworkAttachmentDefinition}
        initialResource={INITIAL_NAD}
        initialTab={createInitialTab}
        formComponent={NADForm}
        validate={r => !!(r?.metadata?.name && r?.metadata?.namespace)}
      />
    </>
  );
}
