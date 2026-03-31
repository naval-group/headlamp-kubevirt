import { Icon } from '@iconify/react';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, IconButton, Tooltip } from '@mui/material';
import { MRT_TableInstance } from 'material-react-table';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import { safeError } from '../../utils/sanitize';
import ConfirmDialog from './ConfirmDialog';

interface BulkDeleteToolbarProps<T extends KubeObject> {
  table: MRT_TableInstance<T>;
  kind: string;
}

export default function BulkDeleteToolbar<T extends KubeObject>({
  table,
  kind,
}: BulkDeleteToolbarProps<T>) {
  const { enqueueSnackbar } = useSnackbar();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selected = table.getSelectedRowModel().rows.map(r => r.original);

  const handleBulkDelete = async () => {
    setConfirmOpen(false);
    let succeeded = 0;
    const failed: string[] = [];

    for (const item of selected) {
      try {
        await item.delete();
        succeeded++;
      } catch (e) {
        failed.push(`${item.getName()}: ${safeError(e, 'bulk-delete')}`);
      }
    }

    if (succeeded > 0) {
      enqueueSnackbar(`Deleted ${succeeded} ${kind}${succeeded > 1 ? 's' : ''}`, {
        variant: 'success',
      });
    }
    if (failed.length > 0) {
      enqueueSnackbar(`Failed to delete ${failed.length}: ${failed.join(', ')}`, {
        variant: 'error',
      });
    }

    table.resetRowSelection();
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title={`Delete ${selected.length} selected`}>
          <span>
            <IconButton onClick={() => setConfirmOpen(true)} sx={{ fontSize: '1.5rem' }}>
              <Icon icon="mdi:delete" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${selected.length} ${kind}${selected.length > 1 ? 's' : ''}?`}
        message={`This will permanently delete: ${selected
          .map(i => i.getName())
          .join(', ')}. This action cannot be undone.`}
        confirmLabel="Delete All"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleBulkDelete}
      />
    </>
  );
}
