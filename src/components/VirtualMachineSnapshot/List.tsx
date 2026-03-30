import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
import { isFeatureGateEnabled, subscribeToFeatureGates } from '../../utils/featureGates';
import VirtualMachineSnapshot from './VirtualMachineSnapshot';

// CreateExportDialog component for creating exports from snapshots
function CreateExportDialog({
  open,
  onClose,
  snapshotName,
  snapshotNamespace,
}: {
  open: boolean;
  onClose: () => void;
  snapshotName: string;
  snapshotNamespace: string;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [ttl, setTtl] = useState('2h');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const exportName = `${snapshotName}-export-${Date.now()}`;
      const exportResource = {
        apiVersion: 'export.kubevirt.io/v1beta1',
        kind: 'VirtualMachineExport',
        metadata: {
          name: exportName,
          namespace: snapshotNamespace,
        },
        spec: {
          source: {
            apiGroup: 'snapshot.kubevirt.io',
            kind: 'VirtualMachineSnapshot',
            name: snapshotName,
          },
          ttlDuration: ttl,
        },
      };

      await ApiProxy.request(
        `/apis/export.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
          snapshotNamespace
        )}/virtualmachineexports`,
        {
          method: 'POST',
          body: JSON.stringify(exportResource),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar(`Export ${exportName} created`, { variant: 'success' });
      onClose();
    } catch (error: unknown) {
      console.error('Failed to create export:', error);
      enqueueSnackbar('Failed to create export.', { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
      }}
      onClick={onClose}
    >
      <Card sx={{ minWidth: 400, maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Create Export from Snapshot
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Snapshot: {snapshotName}
          </Typography>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              TTL Duration
            </Typography>
            <select
              value={ttl}
              onChange={e => setTtl(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px' }}
            >
              <option value="1h">1 hour</option>
              <option value="2h">2 hours</option>
              <option value="6h">6 hours</option>
              <option value="12h">12 hours</option>
              <option value="24h">24 hours</option>
              <option value="48h">48 hours</option>
              <option value="168h">1 week</option>
            </select>
          </Box>
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create Export'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function VirtualMachineSnapshotList() {
  const { items: rawItems } = VirtualMachineSnapshot.useList();
  const items = useFilteredList(rawItems);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<{
    name: string;
    namespace: string;
  } | null>(null);

  const [vmExportEnabled, setVmExportEnabled] = useState(isFeatureGateEnabled('VMExport'));
  useEffect(() => {
    setVmExportEnabled(isFeatureGateEnabled('VMExport'));
    return subscribeToFeatureGates(() => setVmExportEnabled(isFeatureGateEnabled('VMExport')));
  }, []);

  return (
    <>
      <SectionBox title={<SectionFilterHeader title="VM Snapshots" />}>
        <Table
          data={items ?? []}
          loading={items === null}
          enableRowActions={vmExportEnabled}
          renderRowActionMenuItems={
            vmExportEnabled
              ? ({
                  row,
                  closeMenu,
                }: {
                  row: { original: InstanceType<typeof VirtualMachineSnapshot> };
                  closeMenu: () => void;
                }) => [
                  <MenuItem
                    key="export"
                    onClick={() => {
                      closeMenu();
                      setSelectedSnapshot({
                        name: row.original.getName(),
                        namespace: row.original.getNamespace(),
                      });
                      setExportDialogOpen(true);
                    }}
                  >
                    <ListItemIcon>
                      <Icon icon="mdi:export" />
                    </ListItemIcon>
                    <ListItemText>Export</ListItemText>
                  </MenuItem>,
                ]
              : undefined
          }
          columns={[
            {
              id: 'name',
              header: 'Name',
              accessorFn: (snapshot: InstanceType<typeof VirtualMachineSnapshot>) =>
                snapshot.getName(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineSnapshot> };
              }) => (
                <Link
                  routeName="snapshot"
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
              accessorFn: (snapshot: InstanceType<typeof VirtualMachineSnapshot>) =>
                snapshot.getNamespace(),
            },
            {
              id: 'source',
              header: 'Source VM',
              accessorFn: (snapshot: InstanceType<typeof VirtualMachineSnapshot>) =>
                snapshot.getSourceName(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineSnapshot> };
              }) => (
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
              id: 'status',
              header: 'Status',
              accessorFn: (snapshot: InstanceType<typeof VirtualMachineSnapshot>) =>
                snapshot.getPhase(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineSnapshot> };
              }) => {
                const phase = row.original.getPhase();
                const isReady = row.original.isReadyToUse();
                let color: 'success' | 'info' | 'error' | 'default' = 'default';
                if (phase === 'Succeeded' && isReady) color = 'success';
                else if (phase === 'InProgress') color = 'info';
                else if (phase === 'Failed') color = 'error';
                return <Chip label={phase} size="small" color={color} />;
              },
            },
            {
              id: 'ready',
              header: 'Ready',
              accessorFn: (snapshot: InstanceType<typeof VirtualMachineSnapshot>) =>
                snapshot.isReadyToUse() ? 'Yes' : 'No',
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineSnapshot> };
              }) => (
                <Chip
                  label={row.original.isReadyToUse() ? 'Yes' : 'No'}
                  size="small"
                  color={row.original.isReadyToUse() ? 'success' : 'default'}
                />
              ),
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (snapshot: InstanceType<typeof VirtualMachineSnapshot>) =>
                snapshot.metadata?.creationTimestamp || '',
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineSnapshot> };
              }) => {
                const ts = row.original.metadata?.creationTimestamp;
                return ts ? <DateLabel date={ts} /> : '-';
              },
            },
          ]}
        />
      </SectionBox>
      {selectedSnapshot && (
        <CreateExportDialog
          open={exportDialogOpen}
          onClose={() => {
            setExportDialogOpen(false);
            setSelectedSnapshot(null);
          }}
          snapshotName={selectedSnapshot.name}
          snapshotNamespace={selectedSnapshot.namespace}
        />
      )}
    </>
  );
}
