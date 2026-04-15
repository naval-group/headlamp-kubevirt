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
  Button,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
import useResourceActions from '../../hooks/useResourceActions';
import BulkDeleteToolbar from '../common/BulkDeleteToolbar';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import StandardRowActions from '../common/StandardRowActions';
import CreateTemplateWizard from './CreateTemplateWizard';
import ProcessTemplateDialog from './ProcessTemplateDialog';
import VirtualMachineTemplate from './VirtualMachineTemplate';

export default function VirtualMachineTemplateList() {
  const { items: rawItems } = VirtualMachineTemplate.useList();
  const items = useFilteredList(rawItems);
  const [createOpen, setCreateOpen] = useState(false);
  const [processDialog, setProcessDialog] = useState<{
    open: boolean;
    template: InstanceType<typeof VirtualMachineTemplate> | null;
  }>({ open: false, template: null });
  const [editWizardTemplate, setEditWizardTemplate] = useState<InstanceType<
    typeof VirtualMachineTemplate
  > | null>(null);

  const { setEditItem, setViewYamlItem, setDeleteItem, ActionDialogs } = useResourceActions<
    InstanceType<typeof VirtualMachineTemplate>
  >({
    apiVersion: 'template.kubevirt.io/v1alpha1',
    kind: 'VirtualMachineTemplate',
  });

  if (rawItems && rawItems.length === 0) {
    return (
      <>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 300,
            gap: 2,
          }}
        >
          <Icon icon="mdi:text-box-outline" width={48} style={{ opacity: 0.3 }} />
          <Typography variant="h6" color="text.secondary">
            No VM Templates
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center" maxWidth={400}>
            VM Templates let you define reusable VM blueprints with configurable parameters.
          </Typography>
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:plus" width={16} />}
            onClick={() => setCreateOpen(true)}
          >
            Create Template
          </Button>
        </Box>
        <CreateTemplateWizard open={createOpen} onClose={() => setCreateOpen(false)} />
      </>
    );
  }

  return (
    <>
      <SectionBox
        title={
          <SectionFilterHeader
            title="VM Templates"
            titleSideActions={[
              <CreateButtonWithMode
                key="create"
                label="Create Template"
                onCreateForm={() => setCreateOpen(true)}
                onCreateYAML={() => setCreateOpen(true)}
              />,
            ]}
            noNamespaceFilter={false}
            headerStyle="main"
          />
        }
      >
        <Table
          data={items ?? []}
          loading={items === null}
          enableRowActions
          enableRowSelection
          getRowId={(t: InstanceType<typeof VirtualMachineTemplate>) =>
            t.metadata?.uid ?? `${t.getNamespace()}/${t.getName()}`
          }
          renderRowSelectionToolbar={({ table }) => (
            <BulkDeleteToolbar table={table} kind="Template" />
          )}
          renderRowActionMenuItems={({
            row,
            closeMenu,
          }: {
            row: { original: InstanceType<typeof VirtualMachineTemplate> };
            closeMenu: () => void;
          }) => [
            <MenuItem
              key="create-vm"
              disabled={!row.original.isReady()}
              onClick={() => {
                closeMenu();
                setProcessDialog({ open: true, template: row.original });
              }}
            >
              <ListItemIcon>
                <Icon icon="mdi:play-circle" />
              </ListItemIcon>
              <ListItemText>Create VM</ListItemText>
            </MenuItem>,
            <MenuItem
              key="edit-wizard"
              onClick={() => {
                closeMenu();
                setEditWizardTemplate(row.original);
              }}
            >
              <ListItemIcon>
                <Icon icon="mdi:auto-fix" />
              </ListItemIcon>
              <ListItemText>Edit with Wizard</ListItemText>
            </MenuItem>,
            <Divider key="div1" />,
            <StandardRowActions
              key="standard"
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
              header: 'Name',
              accessorFn: (t: InstanceType<typeof VirtualMachineTemplate>) => t.getName(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineTemplate> };
              }) => (
                <Link
                  routeName="vmtemplate"
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
              accessorFn: (t: InstanceType<typeof VirtualMachineTemplate>) => t.getNamespace(),
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineTemplate> };
              }) => (
                <Link routeName="namespace" params={{ name: row.original.getNamespace() }} tooltip>
                  {row.original.getNamespace()}
                </Link>
              ),
            },
            {
              id: 'parameters',
              header: 'Parameters',
              accessorFn: (t: InstanceType<typeof VirtualMachineTemplate>) =>
                t.getParameters().length,
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineTemplate> };
              }) => {
                const params = row.original.getParameters();
                const required = row.original.getRequiredParameterCount();
                return (
                  <Typography variant="body2">
                    {params.length}
                    {required > 0 && (
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.secondary"
                        sx={{ ml: 0.5 }}
                      >
                        ({required} required)
                      </Typography>
                    )}
                  </Typography>
                );
              },
            },
            {
              id: 'status',
              header: 'Status',
              accessorFn: (t: InstanceType<typeof VirtualMachineTemplate>) =>
                t.isReady() ? 'Ready' : 'Not Ready',
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineTemplate> };
              }) => (
                <Chip
                  label={row.original.isReady() ? 'Ready' : 'Not Ready'}
                  size="small"
                  color={row.original.isReady() ? 'success' : 'default'}
                />
              ),
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (t: InstanceType<typeof VirtualMachineTemplate>) =>
                t.metadata?.creationTimestamp || '',
              Cell: ({
                row,
              }: {
                row: { original: InstanceType<typeof VirtualMachineTemplate> };
              }) => <DateLabel date={row.original.metadata?.creationTimestamp || ''} />,
            },
          ]}
        />
      </SectionBox>

      {processDialog.template && (
        <ProcessTemplateDialog
          open={processDialog.open}
          onClose={() => setProcessDialog({ open: false, template: null })}
          template={processDialog.template}
        />
      )}

      <CreateTemplateWizard open={createOpen} onClose={() => setCreateOpen(false)} />

      <CreateTemplateWizard
        open={!!editWizardTemplate}
        onClose={() => setEditWizardTemplate(null)}
        initialTemplate={editWizardTemplate}
      />

      {ActionDialogs}
    </>
  );
}
