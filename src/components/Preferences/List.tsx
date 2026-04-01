import { Icon } from '@iconify/react';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Tab, Tabs } from '@mui/material';
import React from 'react';
import useResourceActions from '../../hooks/useResourceActions';
import BulkDeleteToolbar from '../common/BulkDeleteToolbar';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import StandardRowActions from '../common/StandardRowActions';
import { mapIconClass } from './iconMapper';
import PreferenceForm from './PreferenceForm';
import VirtualMachineClusterPreference from './VirtualMachineClusterPreference';

export default function PreferenceList() {
  const [preferences] = VirtualMachineClusterPreference.useList();
  const [tab, setTab] = React.useState(0);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [createInitialTab, setCreateInitialTab] = React.useState(0);
  const { setEditItem, setViewYamlItem, setDeleteItem, ActionDialogs } =
    useResourceActions<VirtualMachineClusterPreference>({
      apiVersion: 'instancetype.kubevirt.io/v1beta1',
      kind: 'VirtualMachineClusterPreference',
    });

  const emptyPreference = {
    apiVersion: 'instancetype.kubevirt.io/v1beta1',
    kind: 'VirtualMachineClusterPreference',
    metadata: {
      name: '',
    },
    spec: {
      annotations: {
        'vm.kubevirt.io/os': 'linux',
      },
      devices: {
        preferredDiskBus: 'virtio',
        preferredInterfaceModel: 'virtio',
        preferredRng: {},
      },
    },
  };

  // Separate cluster-provided and user-provided preferences
  const { clusterPrefs, userPrefs } = React.useMemo(() => {
    if (!preferences || !Array.isArray(preferences)) {
      return { clusterPrefs: [], userPrefs: [] };
    }

    const cluster: typeof preferences = [];
    const user: typeof preferences = [];

    preferences.forEach(pref => {
      if (pref.isClusterProvided()) {
        cluster.push(pref);
      } else {
        user.push(pref);
      }
    });

    return { clusterPrefs: cluster, userPrefs: user };
  }, [preferences]);

  const currentData = tab === 0 ? clusterPrefs : userPrefs;

  return (
    <>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, px: 2 }}>
        <Tabs value={tab} onChange={(_, newValue) => setTab(newValue)}>
          <Tab label="Cluster Preferences" />
          <Tab label="User Preferences" />
        </Tabs>
      </Box>

      <SectionBox
        title={
          <SectionFilterHeader
            title="Preferences"
            titleSideActions={[
              <CreateButtonWithMode
                key="create"
                label="Create Preference"
                onCreateForm={() => {
                  setCreateInitialTab(0);
                  setCreateDialogOpen(true);
                }}
                onCreateYAML={() => {
                  setCreateInitialTab(1);
                  setCreateDialogOpen(true);
                }}
              />,
            ]}
          />
        }
      >
        <Table
          data={currentData ?? []}
          loading={preferences === null}
          enableRowActions
          enableRowSelection
          getRowId={(pref: VirtualMachineClusterPreference) => pref.metadata?.uid ?? pref.getName()}
          renderRowSelectionToolbar={({ table }) => (
            <BulkDeleteToolbar table={table} kind="Preference" />
          )}
          renderRowActionMenuItems={({
            row,
            closeMenu,
          }: {
            row: { original: VirtualMachineClusterPreference };
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
              header: 'Name',
              accessorFn: (pref: VirtualMachineClusterPreference) => pref.getName(),
              Cell: ({ row }: { row: { original: VirtualMachineClusterPreference } }) => {
                const iconClass = row.original.getIconClass();
                const hasIcon = iconClass !== '-';
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {hasIcon && <Icon icon={mapIconClass(iconClass)} width="20" height="20" />}
                    <Link routeName="preference" params={{ name: row.original.getName() }}>
                      {row.original.getName()}
                    </Link>
                  </Box>
                );
              },
            },
            {
              id: 'display-name',
              header: 'Display Name',
              accessorFn: (pref: VirtualMachineClusterPreference) => pref.getDisplayName(),
            },
            {
              id: 'os-type',
              header: 'OS Type',
              accessorFn: (pref: VirtualMachineClusterPreference) => pref.getOSType(),
            },
            {
              id: 'vendor',
              header: 'Vendor',
              accessorFn: (pref: VirtualMachineClusterPreference) => pref.getVendor(),
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (pref: VirtualMachineClusterPreference) =>
                pref.metadata?.creationTimestamp || '',
              Cell: ({ row }: { row: { original: VirtualMachineClusterPreference } }) => {
                const ts = row.original.metadata?.creationTimestamp;
                return ts ? <DateLabel date={ts} /> : '-';
              },
            },
          ]}
        />
      </SectionBox>

      {ActionDialogs}

      <CreateResourceDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="Create Preference"
        resourceClass={VirtualMachineClusterPreference}
        initialResource={emptyPreference}
        initialTab={createInitialTab}
        formComponent={PreferenceForm}
        validate={r => !!r?.metadata?.name}
      />
    </>
  );
}
