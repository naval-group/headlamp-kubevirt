import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
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
        `/apis/export.kubevirt.io/v1beta1/namespaces/${snapshotNamespace}/virtualmachineexports`,
        {
          method: 'POST',
          body: JSON.stringify(exportResource),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar(`Export ${exportName} created`, { variant: 'success' });
      onClose();
    } catch (error: unknown) {
      enqueueSnackbar(`Failed to create export: ${(error as Error).message}`, { variant: 'error' });
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
  const { enqueueSnackbar } = useSnackbar();
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

  const actions = [
    ...(vmExportEnabled
      ? [
          {
            id: 'export',
            action: ({
              item,
              closeMenu,
            }: {
              item: VirtualMachineSnapshot;
              closeMenu: () => void;
            }) => {
              return (
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    setSelectedSnapshot({ name: item.getName(), namespace: item.getNamespace() });
                    setExportDialogOpen(true);
                  }}
                >
                  <ListItemIcon>
                    <Icon icon="mdi:export" />
                  </ListItemIcon>
                  <ListItemText>Export</ListItemText>
                </MenuItem>
              );
            },
          },
        ]
      : []),
    {
      id: 'delete',
      action: ({ item, closeMenu }: { item: VirtualMachineSnapshot; closeMenu: () => void }) => {
        return (
          <MenuItem
            onClick={async () => {
              closeMenu();
              if (!confirm(`Are you sure you want to delete snapshot "${item.getName()}"?`)) {
                return;
              }
              try {
                await item.delete();
                enqueueSnackbar(`Snapshot ${item.getName()} deleted`, { variant: 'success' });
              } catch (e) {
                enqueueSnackbar(`Failed to delete snapshot: ${e}`, { variant: 'error' });
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
  ];

  return (
    <>
      <Resource.ResourceListView
        title="VM Snapshots"
        resourceClass={VirtualMachineSnapshot}
        actions={actions}
        columns={[
          {
            id: 'name',
            label: 'Name',
            getValue: snapshot => snapshot.getName(),
            render: snapshot => (
              <Link
                routeName="snapshot"
                params={{ name: snapshot.getName(), namespace: snapshot.getNamespace() }}
              >
                {snapshot.getName()}
              </Link>
            ),
          },
          'namespace',
          {
            id: 'source',
            label: 'Source VM',
            getValue: snapshot => snapshot.getSourceName(),
            render: snapshot => (
              <Link
                routeName="virtualmachine"
                params={{ name: snapshot.getSourceName(), namespace: snapshot.getNamespace() }}
              >
                {snapshot.getSourceName()}
              </Link>
            ),
          },
          {
            id: 'status',
            label: 'Status',
            getValue: snapshot => snapshot.getPhase(),
            render: snapshot => {
              const phase = snapshot.getPhase();
              const isReady = snapshot.isReadyToUse();
              let color: 'success' | 'info' | 'error' | 'default' = 'default';
              if (phase === 'Succeeded' && isReady) color = 'success';
              else if (phase === 'InProgress') color = 'info';
              else if (phase === 'Failed') color = 'error';
              return <Chip label={phase} size="small" color={color} />;
            },
          },
          {
            id: 'ready',
            label: 'Ready',
            getValue: snapshot => (snapshot.isReadyToUse() ? 'Yes' : 'No'),
            render: snapshot => (
              <Chip
                label={snapshot.isReadyToUse() ? 'Yes' : 'No'}
                size="small"
                color={snapshot.isReadyToUse() ? 'success' : 'default'}
              />
            ),
          },
          'age',
        ]}
      />
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
