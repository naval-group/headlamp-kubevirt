import { Icon } from '@iconify/react';
import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Tab, Tabs } from '@mui/material';
import React from 'react';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import { mapIconClass } from './iconMapper';
import PreferenceForm from './PreferenceForm';
import VirtualMachineClusterPreference from './VirtualMachineClusterPreference';

export default function PreferenceList() {
  const [preferences] = VirtualMachineClusterPreference.useList();
  const [tab, setTab] = React.useState(0);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [createInitialTab, setCreateInitialTab] = React.useState(0);

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

      <Resource.ResourceListView
        title="Preferences"
        data={currentData}
        headerProps={{
          titleSideActions: [
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
          ],
        }}
        columns={[
          {
            id: 'name',
            label: 'Name',
            getValue: pref => pref.getName(),
            render: pref => {
              const iconClass = pref.getIconClass();
              const hasIcon = iconClass !== '-';
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {hasIcon && <Icon icon={mapIconClass(iconClass)} width="20" height="20" />}
                  <Link routeName="/kubevirt/preferences/:name" params={{ name: pref.getName() }}>
                    {pref.getName()}
                  </Link>
                </Box>
              );
            },
          },
          {
            id: 'display-name',
            label: 'Display Name',
            getValue: pref => pref.getDisplayName(),
          },
          {
            id: 'os-type',
            label: 'OS Type',
            getValue: pref => pref.getOSType(),
          },
          {
            id: 'vendor',
            label: 'Vendor',
            getValue: pref => pref.getVendor(),
          },
          'age',
        ]}
      />

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
