import { Icon } from '@iconify/react';
import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip, ListItemIcon, ListItemText, MenuItem, Tooltip } from '@mui/material';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
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
  const { enqueueSnackbar } = useSnackbar();
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState(0);

  return (
    <>
      <Resource.ResourceListView
        title="VM Exports"
        resourceClass={VirtualMachineExport}
        headerProps={{
          titleSideActions: [
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
          ],
        }}
        actions={[
          {
            id: 'delete',
            action: ({
              item,
              closeMenu,
            }: {
              item: VirtualMachineExport;
              closeMenu: () => void;
            }) => {
              return (
                <MenuItem
                  onClick={async () => {
                    closeMenu();
                    if (!confirm(`Are you sure you want to delete export "${item.getName()}"?`)) {
                      return;
                    }
                    try {
                      await item.delete();
                      enqueueSnackbar(`Export ${item.getName()} deleted`, { variant: 'success' });
                    } catch (e) {
                      enqueueSnackbar(`Failed to delete export: ${e}`, { variant: 'error' });
                    }
                  }}
                >
                  <ListItemIcon>
                    <Icon icon="mdi:delete" />
                  </ListItemIcon>
                  <ListItemText>Delete</ListItemText>
                </MenuItem>
              );
            },
          },
        ]}
        columns={[
          {
            id: 'name',
            label: 'Name',
            getValue: vmExport => vmExport.getName(),
            render: vmExport => (
              <Link
                routeName="export"
                params={{ name: vmExport.getName(), namespace: vmExport.getNamespace() }}
              >
                {vmExport.getName()}
              </Link>
            ),
          },
          'namespace',
          {
            id: 'source',
            label: 'Source',
            getValue: vmExport => `${vmExport.getSourceKind()}/${vmExport.getSourceName()}`,
            render: vmExport => (
              <Tooltip title={vmExport.getSourceKind()}>
                <span>{vmExport.getSourceName()}</span>
              </Tooltip>
            ),
          },
          {
            id: 'status',
            label: 'Status',
            getValue: vmExport => vmExport.getPhase(),
            render: vmExport => {
              const phase = vmExport.getPhase();
              const isReady = vmExport.isReady();
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
            label: 'TTL',
            getValue: vmExport => vmExport.getTTLDuration() || '-',
          },
          {
            id: 'expires',
            label: 'Expires',
            getValue: vmExport => {
              const time = vmExport.getTTLExpirationTime();
              if (!time) return '-';
              return new Date(time).toLocaleString();
            },
          },
          'age',
        ]}
      />

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
