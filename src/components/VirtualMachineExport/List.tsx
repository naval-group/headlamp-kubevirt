import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip, Tooltip } from '@mui/material';
import { useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import VirtualMachineExport from './VirtualMachineExport';
import VMExportForm from './VMExportForm';

const INITIAL_EXPORT = {
  apiVersion: 'export.kubevirt.io/v1beta1',
  kind: 'VirtualMachineExport',
  metadata: {
    name: '',
    namespace: 'default',
  },
  spec: {
    ttlDuration: '1h',
    source: {
      apiGroup: 'kubevirt.io',
      kind: 'VirtualMachine',
      name: '',
    },
  },
};

export default function VirtualMachineExportList() {
  const { items: rawItems } = VirtualMachineExport.useList();
  const items = useFilteredList(rawItems);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState(0);

  return (
    <>
      <SectionBox
        title={
          <SectionFilterHeader
            title="VM Exports"
            titleSideActions={[
              <CreateButtonWithMode
                key="create"
                label="Create Export"
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
              accessorFn: (vmExport: InstanceType<typeof VirtualMachineExport>) =>
                vmExport.getName(),
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineExport> } }) => (
                <Link
                  routeName="export"
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
              accessorFn: (vmExport: InstanceType<typeof VirtualMachineExport>) =>
                vmExport.getNamespace(),
            },
            {
              id: 'source',
              header: 'Source',
              accessorFn: (vmExport: InstanceType<typeof VirtualMachineExport>) =>
                `${vmExport.getSourceKind()}/${vmExport.getSourceName()}`,
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineExport> } }) => (
                <Tooltip title={row.original.getSourceKind()}>
                  <span>{row.original.getSourceName()}</span>
                </Tooltip>
              ),
            },
            {
              id: 'status',
              header: 'Status',
              accessorFn: (vmExport: InstanceType<typeof VirtualMachineExport>) =>
                vmExport.getPhase(),
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineExport> } }) => {
                const phase = row.original.getPhase();
                const isReady = row.original.isReady();
                let color: 'success' | 'info' | 'error' | 'warning' | 'default' = 'default';
                if (phase === 'Ready' && isReady) color = 'success';
                else if (phase === 'Pending') color = 'info';
                else if (phase === 'Failed') color = 'error';
                else if (phase === 'Terminated') color = 'warning';
                return <Chip label={phase} size="small" color={color} />;
              },
            },
            {
              id: 'ttl',
              header: 'TTL',
              accessorFn: (vmExport: InstanceType<typeof VirtualMachineExport>) =>
                vmExport.getTTLDuration() || '-',
            },
            {
              id: 'expires',
              header: 'Expires',
              accessorFn: (vmExport: InstanceType<typeof VirtualMachineExport>) => {
                const time = vmExport.getTTLExpirationTime();
                if (!time) return '-';
                return new Date(time).toLocaleString();
              },
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (vmExport: InstanceType<typeof VirtualMachineExport>) =>
                vmExport.metadata?.creationTimestamp || '',
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineExport> } }) => {
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
        title="Create VM Export"
        resourceClass={VirtualMachineExport}
        initialResource={INITIAL_EXPORT}
        initialTab={createInitialTab}
        formComponent={VMExportForm}
        validate={r => !!(r?.metadata?.name && r?.metadata?.namespace && r?.spec?.source?.name)}
      />
    </>
  );
}
