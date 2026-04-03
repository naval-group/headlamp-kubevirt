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
import { getRestoreStatusColor } from '../../utils/statusColors';
import ConfirmDialog from '../common/ConfirmDialog';
import VirtualMachineRestore from './VirtualMachineRestore';

function statusChip(status: string) {
  return (
    <Chip
      label={status || 'Unknown'}
      color={getRestoreStatusColor(status)}
      size="small"
      variant="outlined"
    />
  );
}

export default function VirtualMachineRestoreList() {
  const { enqueueSnackbar } = useSnackbar();
  const { items: rawItems } = VirtualMachineRestore.useList();
  const items = useFilteredList(rawItems);
  const [deleteRestore, setDeleteRestore] = useState<InstanceType<
    typeof VirtualMachineRestore
  > | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteItems, setBulkDeleteItems] = useState<
    InstanceType<typeof VirtualMachineRestore>[]
  >([]);

  const handleBulkDelete = useCallback(
    (table: MRT_TableInstance<InstanceType<typeof VirtualMachineRestore>>) => {
      const selected = table.getSelectedRowModel().rows.map(r => r.original);
      setBulkDeleteItems(selected);
      setBulkDeleteOpen(true);
    },
    []
  );

  const executeBulkDelete = useCallback(async () => {
    const results = await Promise.allSettled(bulkDeleteItems.map(r => r.delete()));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.filter(r => r.status === 'rejected').length;
    if (ok > 0) enqueueSnackbar(`Deleted ${ok} restore(s)`, { variant: 'success' });
    if (fail > 0) enqueueSnackbar(`Failed to delete ${fail} restore(s)`, { variant: 'error' });
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
        <Icon icon="mdi:restore" width={48} style={{ opacity: 0.4 }} />
        <Typography variant="h6" color="text.secondary">
          No VM Restores
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
          Restore a virtual machine from a snapshot on the snapshot details page or the VM snapshots
          tab.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <SectionBox title={<SectionFilterHeader title="VM Restores" />}>
        <Table
          data={items ?? []}
          loading={items === null}
          enableRowSelection
          enableRowActions
          getRowId={(restore: InstanceType<typeof VirtualMachineRestore>) =>
            restore.metadata?.uid ?? restore.getName()
          }
          renderRowSelectionToolbar={({
            table,
          }: {
            table: MRT_TableInstance<InstanceType<typeof VirtualMachineRestore>>;
          }) => (
            <Box display="flex" alignItems="center" gap={1}>
              <Tooltip title="Delete selected restores" arrow>
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
            row: { original: InstanceType<typeof VirtualMachineRestore> };
            closeMenu: () => void;
          }) => [
            <MenuItem
              key="delete"
              onClick={() => {
                closeMenu();
                setDeleteRestore(row.original);
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
              header: 'Restore',
              accessorFn: (restore: InstanceType<typeof VirtualMachineRestore>) =>
                restore.getName(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineRestore> };
              }) => (
                <Link
                  routeName="restore"
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
              accessorFn: (restore: InstanceType<typeof VirtualMachineRestore>) =>
                restore.getNamespace(),
            },
            {
              id: 'target',
              header: 'Target VM',
              accessorFn: (restore: InstanceType<typeof VirtualMachineRestore>) =>
                restore.getTargetName(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineRestore> };
              }) => (
                <Link
                  routeName="virtualmachine"
                  params={{
                    name: row.original.getTargetName(),
                    namespace: row.original.getNamespace(),
                  }}
                >
                  {row.original.getTargetName()}
                </Link>
              ),
            },
            {
              id: 'snapshot',
              header: 'Snapshot',
              accessorFn: (restore: InstanceType<typeof VirtualMachineRestore>) =>
                restore.getSnapshotName(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineRestore> };
              }) => (
                <Link
                  routeName="snapshot"
                  params={{
                    name: row.original.getSnapshotName(),
                    namespace: row.original.getNamespace(),
                  }}
                >
                  {row.original.getSnapshotName()}
                </Link>
              ),
            },
            {
              id: 'status',
              header: 'Status',
              accessorFn: (restore: InstanceType<typeof VirtualMachineRestore>) =>
                restore.getEffectiveStatus(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineRestore> };
              }) => {
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
              accessorFn: (restore: InstanceType<typeof VirtualMachineRestore>) =>
                restore.metadata?.creationTimestamp || '',
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineRestore> };
              }) => {
                const ts = row.original.metadata?.creationTimestamp;
                return ts ? <DateLabel date={ts} /> : '-';
              },
            },
          ]}
        />
      </SectionBox>

      <ConfirmDialog
        open={!!deleteRestore}
        title={`Delete restore ${deleteRestore?.getName() || ''}?`}
        message="This removes the restore resource only. The target VM is not affected."
        confirmLabel="Delete"
        onCancel={() => setDeleteRestore(null)}
        onConfirm={async () => {
          if (!deleteRestore) return;
          const name = deleteRestore.getName();
          setDeleteRestore(null);
          try {
            await deleteRestore.delete();
            enqueueSnackbar(`Deleted restore ${name}`, { variant: 'success' });
          } catch (e) {
            enqueueSnackbar(`Failed to delete: ${safeError(e, 'restore-delete')}`, {
              variant: 'error',
            });
          }
        }}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete ${bulkDeleteItems.length} restore(s)?`}
        message="This removes the restore resources only. The target VMs are not affected."
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
