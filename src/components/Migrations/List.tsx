import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import useFilteredList from '../../hooks/useFilteredList';
import useResourceActions from '../../hooks/useResourceActions';
import BulkDeleteToolbar from '../common/BulkDeleteToolbar';
import StandardRowActions from '../common/StandardRowActions';
import VirtualMachineInstanceMigration from './VirtualMachineInstanceMigration';

export default function MigrationList() {
  const { items: rawItems } = VirtualMachineInstanceMigration.useList();
  const items = useFilteredList(rawItems);
  const { setEditItem, setViewYamlItem, setDeleteItem, ActionDialogs } = useResourceActions<
    InstanceType<typeof VirtualMachineInstanceMigration>
  >({
    apiVersion: 'kubevirt.io/v1',
    kind: 'VirtualMachineInstanceMigration',
  });

  // Show empty state only when there are truly no migrations cluster-wide
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
        <Typography variant="h6" color="text.secondary">
          No VM Migrations Found
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
          There are currently no active or recent VM migrations. Migrations allow you to move
          running virtual machines between nodes without downtime.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          To migrate a VM, use the "Migrate" action from the Virtual Machines list or details page.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <SectionBox title={<SectionFilterHeader title="VM Migrations" />}>
        <Table
          data={items ?? []}
          loading={items === null}
          enableRowActions
          enableRowSelection
          getRowId={(m: InstanceType<typeof VirtualMachineInstanceMigration>) =>
            m.metadata?.uid ?? `${m.getNamespace()}/${m.getName()}`
          }
          renderRowSelectionToolbar={({ table }) => (
            <BulkDeleteToolbar table={table} kind="Migration" />
          )}
          renderRowActionMenuItems={({
            row,
            closeMenu,
          }: {
            row: { original: InstanceType<typeof VirtualMachineInstanceMigration> };
            closeMenu: () => void;
          }) => [
            <StandardRowActions
              key="std"
              resource={row.original}
              closeMenu={closeMenu}
              onEdit={setEditItem}
              onViewYaml={setViewYamlItem}
              onDelete={setDeleteItem}
            />,
          ]}
          columns={[
            {
              id: 'name',
              header: 'Migration Name',
              accessorFn: (migration: InstanceType<typeof VirtualMachineInstanceMigration>) =>
                migration.getName(),
            },
            {
              id: 'namespace',
              header: 'Namespace',
              accessorFn: (migration: InstanceType<typeof VirtualMachineInstanceMigration>) =>
                migration.getNamespace(),
            },
            {
              id: 'vmi',
              header: 'Virtual Machine',
              accessorFn: (migration: InstanceType<typeof VirtualMachineInstanceMigration>) =>
                migration.getVMIName(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineInstanceMigration> };
              }) => (
                <Link
                  routeName="virtualmachine"
                  params={{
                    name: row.original.getVMIName(),
                    namespace: row.original.getNamespace(),
                  }}
                >
                  {row.original.getVMIName()}
                </Link>
              ),
            },
            {
              id: 'source',
              header: 'Source Node',
              accessorFn: (migration: InstanceType<typeof VirtualMachineInstanceMigration>) =>
                migration.getSourceNode(),
            },
            {
              id: 'target',
              header: 'Target Node',
              accessorFn: (migration: InstanceType<typeof VirtualMachineInstanceMigration>) =>
                migration.getTargetNode(),
            },
            {
              id: 'phase',
              header: 'Status',
              accessorFn: (migration: InstanceType<typeof VirtualMachineInstanceMigration>) =>
                migration.getPhase(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineInstanceMigration> };
              }) => {
                const phase = row.original.getPhase();
                let color: 'default' | 'primary' | 'success' | 'error' | 'warning' = 'default';

                if (phase === 'Succeeded') {
                  color = 'success';
                } else if (phase === 'Failed') {
                  color = 'error';
                } else if (phase === 'Running' || phase === 'Scheduling') {
                  color = 'primary';
                } else if (phase === 'Pending') {
                  color = 'warning';
                }

                return <Chip label={phase} color={color} size="small" />;
              },
            },
            {
              id: 'started',
              header: 'Started',
              accessorFn: (migration: InstanceType<typeof VirtualMachineInstanceMigration>) =>
                migration.getStartTime(),
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (migration: InstanceType<typeof VirtualMachineInstanceMigration>) =>
                migration.metadata?.creationTimestamp || '',
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineInstanceMigration> };
              }) => {
                const ts = row.original.metadata?.creationTimestamp;
                return ts ? <DateLabel date={ts} /> : '-';
              },
            },
          ]}
        />
      </SectionBox>
      {ActionDialogs}
    </>
  );
}
