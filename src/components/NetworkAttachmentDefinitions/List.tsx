import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Chip, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
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
  const { items: rawItems } = NetworkAttachmentDefinition.useList();
  const items = useFilteredList(rawItems);
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
      <SectionBox title={<SectionFilterHeader title="Networks" />}>
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
      <SectionBox
        title={
          <SectionFilterHeader
            title="Networks"
            titleSideActions={[
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
            ]}
          />
        }
      >
        <Table
          data={items ?? []}
          loading={items === null}
          columns={[
            {
              id: 'name',
              header: 'Name',
              accessorFn: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => nad.getName(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof NetworkAttachmentDefinition> };
              }) => (
                <Link
                  routeName="nad"
                  params={{
                    name: row.original.getName(),
                    namespace: row.original.getNamespace(),
                  }}
                >
                  {row.original.getName()}
                </Link>
              ),
            },
            {
              id: 'namespace',
              header: 'Namespace',
              accessorFn: (nad: InstanceType<typeof NetworkAttachmentDefinition>) =>
                nad.getNamespace(),
            },
            {
              id: 'type',
              header: 'Type',
              accessorFn: (nad: InstanceType<typeof NetworkAttachmentDefinition>) =>
                nad.getNetworkType(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof NetworkAttachmentDefinition> };
              }) => {
                const type = row.original.getNetworkType();
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
              header: 'IPAM',
              accessorFn: (nad: InstanceType<typeof NetworkAttachmentDefinition>) =>
                nad.getIPAMType(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof NetworkAttachmentDefinition> };
              }) => {
                const ipamType = row.original.getIPAMType();
                return <Chip label={ipamType} size="small" variant="outlined" />;
              },
            },
            {
              id: 'details',
              header: 'Details',
              accessorFn: (nad: InstanceType<typeof NetworkAttachmentDefinition>) => {
                const config = nad.getParsedConfig();
                const parts: string[] = [];
                if (config.bridge) parts.push(`bridge: ${config.bridge}`);
                if (config.master) parts.push(`master: ${config.master}`);
                if (config.vlanId) parts.push(`vlan: ${config.vlanId}`);
                if (config.mtu) parts.push(`mtu: ${config.mtu}`);
                if (config.mode) parts.push(`mode: ${config.mode}`);
                return parts.join(' · ') || '-';
              },
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof NetworkAttachmentDefinition> };
              }) => {
                const config = row.original.getParsedConfig();
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
            {
              id: 'age',
              header: 'Age',
              accessorFn: (nad: InstanceType<typeof NetworkAttachmentDefinition>) =>
                nad.metadata?.creationTimestamp || '',
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof NetworkAttachmentDefinition> };
              }) => {
                const ts = row.original.metadata?.creationTimestamp;
                return ts ? <DateLabel date={ts} /> : '-';
              },
            },
          ]}
        />
      </SectionBox>

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
