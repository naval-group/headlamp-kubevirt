import { Icon } from '@iconify/react';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Chip,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { MRT_TableInstance } from 'material-react-table';
import { useSnackbar } from 'notistack';
import { useCallback, useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
import { safeError } from '../../utils/sanitize';
import { getCloneStatusColor } from '../../utils/statusColors';
import ConfirmDialog from '../common/ConfirmDialog';
import VirtualMachineClone from './VirtualMachineClone';

function statusChip(status: string) {
  return (
    <Chip
      label={status || 'Unknown'}
      color={getCloneStatusColor(status)}
      size="small"
      variant="outlined"
    />
  );
}

export default function VirtualMachineCloneList() {
  const { enqueueSnackbar } = useSnackbar();
  const { items: rawItems } = VirtualMachineClone.useList();
  const items = useFilteredList(rawItems);
  const [deleteClone, setDeleteClone] = useState<InstanceType<typeof VirtualMachineClone> | null>(
    null
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteItems, setBulkDeleteItems] = useState<
    InstanceType<typeof VirtualMachineClone>[]
  >([]);

  const handleBulkDelete = useCallback(
    async (table: MRT_TableInstance<InstanceType<typeof VirtualMachineClone>>) => {
      const selected = table.getSelectedRowModel().rows.map(r => r.original);
      setBulkDeleteItems(selected);
      setBulkDeleteOpen(true);
    },
    []
  );

  const executeBulkDelete = useCallback(async () => {
    const results = await Promise.allSettled(bulkDeleteItems.map(clone => clone.delete()));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.filter(r => r.status === 'rejected').length;
    if (ok > 0) enqueueSnackbar(`Deleted ${ok} clone(s)`, { variant: 'success' });
    if (fail > 0) enqueueSnackbar(`Failed to delete ${fail} clone(s)`, { variant: 'error' });
    setBulkDeleteOpen(false);
    setBulkDeleteItems([]);
  }, [bulkDeleteItems, enqueueSnackbar]);

  if (rawItems && rawItems.length === 0) {
    return (
      <Box
        sx={{
          p: 4,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Icon icon="mdi:content-copy" width={48} style={{ opacity: 0.4 }} />
        <Typography variant="h6" color="text.secondary">
          No VM Clones
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
          Clone a virtual machine from the VM details page or the VM list context menu. KubeVirt
          will snapshot the source, clone all disks, and create a new VM.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <SectionBox title={<SectionFilterHeader title="VM Clones" />}>
        <Table
          data={items ?? []}
          loading={items === null}
          enableRowSelection
          enableRowActions
          getRowId={(clone: InstanceType<typeof VirtualMachineClone>) =>
            clone.metadata?.uid ?? clone.getName()
          }
          renderRowSelectionToolbar={({
            table,
          }: {
            table: MRT_TableInstance<InstanceType<typeof VirtualMachineClone>>;
          }) => (
            <Box display="flex" alignItems="center" gap={1}>
              <Tooltip title="Delete selected clones" arrow>
                <IconButton size="small" onClick={() => handleBulkDelete(table)}>
                  <Icon icon="mdi:delete" width={20} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
          renderRowActionMenuItems={({
            row,
            closeMenu,
          }: {
            row: { original: InstanceType<typeof VirtualMachineClone> };
            closeMenu: () => void;
          }) => [
            <MenuItem
              key="delete"
              onClick={() => {
                closeMenu();
                setDeleteClone(row.original);
              }}
            >
              <ListItemIcon>
                <Icon icon="mdi:delete" />
              </ListItemIcon>
              <ListItemText>Delete</ListItemText>
            </MenuItem>,
          ]}
          columns={[
            {
              id: 'name',
              header: 'Clone',
              accessorFn: (clone: InstanceType<typeof VirtualMachineClone>) => clone.getName(),
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineClone> } }) => (
                <Link
                  routeName="clone"
                  params={{
                    name: row.original.getName(),
                    namespace: row.original.getNamespace(),
                  }}
                >
                  <Typography variant="body2" fontFamily="monospace" noWrap sx={{ maxWidth: 250 }}>
                    {row.original.getName()}
                  </Typography>
                </Link>
              ),
            },
            {
              id: 'namespace',
              header: 'Namespace',
              accessorFn: (clone: InstanceType<typeof VirtualMachineClone>) => clone.getNamespace(),
            },
            {
              id: 'source',
              header: 'Source VM',
              accessorFn: (clone: InstanceType<typeof VirtualMachineClone>) =>
                clone.getSourceName(),
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineClone> } }) => (
                <Link
                  routeName="virtualmachine"
                  params={{
                    name: row.original.getSourceName(),
                    namespace: row.original.getNamespace(),
                  }}
                >
                  {row.original.getSourceName()}
                </Link>
              ),
            },
            {
              id: 'target',
              header: 'Target VM',
              accessorFn: (clone: InstanceType<typeof VirtualMachineClone>) =>
                `${clone.getTargetName()}|${clone.getEffectiveStatus()}`,
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineClone> } }) => {
                const target = row.original.getTargetName();
                const status = row.original.getEffectiveStatus();
                if (status === 'Succeeded' && target !== '-') {
                  return (
                    <Link
                      routeName="virtualmachine"
                      params={{
                        name: target,
                        namespace: row.original.getNamespace(),
                      }}
                    >
                      {target}
                    </Link>
                  );
                }
                return target;
              },
            },
            {
              id: 'status',
              header: 'Status',
              accessorFn: (clone: InstanceType<typeof VirtualMachineClone>) =>
                clone.getEffectiveStatus(),
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineClone> } }) => {
                const status = row.original.getEffectiveStatus();
                const reason = row.original.getStatusReason();
                if (reason && (status === 'Failed' || status === 'Unknown')) {
                  return (
                    <Tooltip title={reason} arrow>
                      <span>{statusChip(status)}</span>
                    </Tooltip>
                  );
                }
                return statusChip(status);
              },
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (clone: InstanceType<typeof VirtualMachineClone>) =>
                clone.metadata?.creationTimestamp || '',
              Cell: ({ row }: { row: { original: InstanceType<typeof VirtualMachineClone> } }) => {
                const ts = row.original.metadata?.creationTimestamp;
                return ts ? <DateLabel date={ts} /> : '-';
              },
            },
          ]}
        />
      </SectionBox>

      <ConfirmDialog
        open={!!deleteClone}
        title={`Delete clone ${deleteClone?.getName() || ''}?`}
        message="This removes the clone resource only. The source and target VMs are not affected."
        confirmLabel="Delete"
        onCancel={() => setDeleteClone(null)}
        onConfirm={async () => {
          if (!deleteClone) return;
          const name = deleteClone.getName();
          setDeleteClone(null);
          try {
            await deleteClone.delete();
            enqueueSnackbar(`Deleted clone ${name}`, { variant: 'success' });
          } catch (e) {
            enqueueSnackbar(`Failed to delete: ${safeError(e, 'clone-delete')}`, {
              variant: 'error',
            });
          }
        }}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete ${bulkDeleteItems.length} clone(s)?`}
        message="This removes the clone resources only. The source and target VMs are not affected."
        confirmLabel="Delete All"
        onCancel={() => {
          setBulkDeleteOpen(false);
          setBulkDeleteItems([]);
        }}
        onConfirm={executeBulkDelete}
      />
    </>
  );
}
