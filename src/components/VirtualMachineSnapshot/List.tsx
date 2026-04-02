import { Icon } from '@iconify/react';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, ListItemIcon, ListItemText, MenuItem, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
import useResourceActions from '../../hooks/useResourceActions';
import { isFeatureGateEnabled, subscribeToFeatureGates } from '../../utils/featureGates';
import BulkDeleteToolbar from '../common/BulkDeleteToolbar';
import StandardRowActions from '../common/StandardRowActions';
import CreateExportDialog from '../VirtualMachineExport/CreateExportDialog';
import RestoreDialog from './RestoreDialog';
import VirtualMachineSnapshot from './VirtualMachineSnapshot';

export default function VirtualMachineSnapshotList() {
  const { items: rawItems } = VirtualMachineSnapshot.useList();
  const items = useFilteredList(rawItems);
  const [selectedSnapshot, setSelectedSnapshot] = useState<{
    name: string;
    namespace: string;
  } | null>(null);

  const [restoreSnapshot, setRestoreSnapshot] = useState<{
    name: string;
    namespace: string;
    vmName: string;
  } | null>(null);

  const [vmExportEnabled, setVmExportEnabled] = useState(isFeatureGateEnabled('VMExport'));
  useEffect(() => {
    setVmExportEnabled(isFeatureGateEnabled('VMExport'));
    return subscribeToFeatureGates(() => setVmExportEnabled(isFeatureGateEnabled('VMExport')));
  }, []);
  const { setEditItem, setViewYamlItem, setDeleteItem, ActionDialogs } = useResourceActions<
    InstanceType<typeof VirtualMachineSnapshot>
  >({
    apiVersion: 'snapshot.kubevirt.io/v1beta1',
    kind: 'VirtualMachineSnapshot',
  });

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
        <Icon icon="mdi:camera" width={48} style={{ opacity: 0.4 }} />
        <Typography variant="h6" color="text.secondary">
          No VM Snapshots
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
          Create a snapshot from a virtual machine's details page to capture its current state.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <SectionBox title={<SectionFilterHeader title="VM Snapshots" />}>
        <Table
          data={items ?? []}
          loading={items === null}
          enableRowActions
          enableRowSelection
          getRowId={(snap: InstanceType<typeof VirtualMachineSnapshot>) =>
            snap.metadata?.uid ?? `${snap.getNamespace()}/${snap.getName()}`
          }
          renderRowSelectionToolbar={({ table }) => (
            <BulkDeleteToolbar table={table} kind="Snapshot" />
          )}
          renderRowActionMenuItems={({
            row,
            closeMenu,
          }: {
            row: { original: InstanceType<typeof VirtualMachineSnapshot> };
            closeMenu: () => void;
          }) => [
            <StandardRowActions
              key="std"
              resource={row.original}
              closeMenu={closeMenu}
              onEdit={setEditItem}
              onViewYaml={setViewYamlItem}
              onDelete={setDeleteItem}
              extraItems={[
                row.original.isReadyToUse() && (
                  <MenuItem
                    key="restore"
                    onClick={() => {
                      closeMenu();
                      setRestoreSnapshot({
                        name: row.original.getName(),
                        namespace: row.original.getNamespace(),
                        vmName: row.original.getSourceName(),
                      });
                    }}
                  >
                    <ListItemIcon>
                      <Icon icon="mdi:restore" />
                    </ListItemIcon>
                    <ListItemText>Restore</ListItemText>
                  </MenuItem>
                ),
                vmExportEnabled && (
                  <MenuItem
                    key="export"
                    onClick={() => {
                      closeMenu();
                      setSelectedSnapshot({
                        name: row.original.getName(),
                        namespace: row.original.getNamespace(),
                      });
                    }}
                  >
                    <ListItemIcon>
                      <Icon icon="mdi:export" />
                    </ListItemIcon>
                    <ListItemText>Export</ListItemText>
                  </MenuItem>
                ),
              ]}
            />,
          ]}
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
      {ActionDialogs}
      {selectedSnapshot && (
        <CreateExportDialog
          open={!!selectedSnapshot}
          onClose={() => setSelectedSnapshot(null)}
          snapshotName={selectedSnapshot.name}
          snapshotNamespace={selectedSnapshot.namespace}
        />
      )}
      {restoreSnapshot && (
        <RestoreDialog
          open={!!restoreSnapshot}
          onClose={() => setRestoreSnapshot(null)}
          snapshotName={restoreSnapshot.name}
          vmName={restoreSnapshot.vmName}
          namespace={restoreSnapshot.namespace}
        />
      )}
    </>
  );
}
