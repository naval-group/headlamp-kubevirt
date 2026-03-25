import { Icon } from '@iconify/react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { MRT_TableInstance } from 'material-react-table';
import { useSnackbar } from 'notistack';
import { useCallback, useState } from 'react';
import BulkConfirmDialog from './BulkConfirmDialog';
import VirtualMachine from './VirtualMachine';
import VMCompareDialog from './VMCompareDialog';

type BulkAction = 'start' | 'stop' | 'forceStop' | 'migrate' | 'delete';

interface BulkActionToolbarProps {
  table: MRT_TableInstance<VirtualMachine>;
  liveMigrationEnabled: boolean;
}

export default function BulkActionToolbar({ table, liveMigrationEnabled }: BulkActionToolbarProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const selectedVMs = table.getSelectedRowModel().rows.map(r => r.original);

  const hasRunning = selectedVMs.some(vm => vm.status?.printableStatus === 'Running');
  const hasStopped = selectedVMs.some(vm => vm.status?.printableStatus === 'Stopped');
  const hasNotStopped = selectedVMs.some(vm => vm.status?.printableStatus !== 'Stopped');
  const hasMigratable = selectedVMs.some(
    vm => vm.status?.printableStatus === 'Running' && vm.isLiveMigratable()
  );

  const executeBulkAction = useCallback(
    async (action: BulkAction) => {
      const results: { name: string; success: boolean; error?: string }[] = [];

      for (const vm of selectedVMs) {
        const name = vm.getName();
        try {
          switch (action) {
            case 'start':
              if (vm.status?.printableStatus === 'Stopped') {
                await vm.start();
              }
              break;
            case 'stop':
              if (vm.status?.printableStatus !== 'Stopped') {
                await vm.stop();
              }
              break;
            case 'forceStop':
              if (vm.status?.printableStatus !== 'Stopped') {
                await vm.forceStop();
              }
              break;
            case 'migrate':
              if (vm.status?.printableStatus === 'Running' && vm.isLiveMigratable()) {
                await vm.migrate();
              }
              break;
            case 'delete':
              await vm.delete();
              break;
          }
          results.push({ name, success: true });
        } catch (e) {
          results.push({ name, success: false, error: String(e) });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success);

      const actionLabel = {
        start: 'Started',
        stop: 'Stopped',
        forceStop: 'Force stopped',
        migrate: 'Migrating',
        delete: 'Deleted',
      }[action];

      if (succeeded > 0) {
        enqueueSnackbar(`${actionLabel} ${succeeded} VM${succeeded > 1 ? 's' : ''}`, {
          variant: 'success',
        });
      }
      if (failed.length > 0) {
        enqueueSnackbar(
          `Failed on ${failed.length} VM${failed.length > 1 ? 's' : ''}: ${failed
            .map(f => f.name)
            .join(', ')}`,
          { variant: 'error' }
        );
      }

      table.resetRowSelection();
      setConfirmAction(null);
    },
    [selectedVMs, enqueueSnackbar, table]
  );

  const actionLabels: Record<BulkAction, string> = {
    start: 'Start',
    stop: 'Stop',
    forceStop: 'Force Stop',
    migrate: 'Migrate',
    delete: 'Delete',
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title="Start">
          <span>
            <IconButton
              onClick={() => setConfirmAction('start')}
              disabled={!hasStopped}
              sx={{ fontSize: '1.5rem' }}
            >
              <Icon icon="mdi:play" />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Stop">
          <span>
            <IconButton
              onClick={() => setConfirmAction('stop')}
              disabled={!hasRunning}
              sx={{ fontSize: '1.5rem' }}
            >
              <Icon icon="mdi:stop" />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Force Stop">
          <span>
            <IconButton
              onClick={() => setConfirmAction('forceStop')}
              disabled={!hasNotStopped}
              sx={{ fontSize: '1.5rem' }}
            >
              <Icon icon="mdi:stop-circle" />
            </IconButton>
          </span>
        </Tooltip>

        {liveMigrationEnabled && (
          <Tooltip title="Migrate">
            <span>
              <IconButton
                onClick={() => setConfirmAction('migrate')}
                disabled={!hasMigratable}
                sx={{ fontSize: '1.5rem' }}
              >
                <Icon icon="mdi:arrow-decision" />
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Tooltip
          title={
            selectedVMs.length >= 2 && selectedVMs.length <= 3
              ? 'Compare'
              : 'Select 2 or 3 VMs to compare'
          }
        >
          <span>
            <IconButton
              onClick={() => setCompareOpen(true)}
              disabled={selectedVMs.length < 2 || selectedVMs.length > 3}
              sx={{ fontSize: '1.5rem' }}
            >
              <Icon icon="mdi:compare" />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Delete">
          <span>
            <IconButton onClick={() => setConfirmAction('delete')} sx={{ fontSize: '1.5rem' }}>
              <Icon icon="mdi:delete" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {confirmAction && (
        <BulkConfirmDialog
          action={confirmAction}
          actionLabel={actionLabels[confirmAction]}
          vms={selectedVMs}
          onConfirm={() => executeBulkAction(confirmAction)}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {compareOpen && selectedVMs.length >= 2 && selectedVMs.length <= 3 && (
        <VMCompareDialog
          vms={selectedVMs.slice(0, 3) as [VirtualMachine, ...VirtualMachine[]]}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </>
  );
}
