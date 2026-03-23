import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Tab, Tabs } from '@mui/material';
import React from 'react';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import InstanceTypeForm from './InstanceTypeForm';
import VirtualMachineClusterInstanceType from './VirtualMachineClusterInstanceType';

export default function InstanceTypeList() {
  const [instanceTypes] = VirtualMachineClusterInstanceType.useList();
  const [tab, setTab] = React.useState(0);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [createInitialTab, setCreateInitialTab] = React.useState(0);

  const emptyInstanceType = {
    apiVersion: 'instancetype.kubevirt.io/v1beta1',
    kind: 'VirtualMachineClusterInstancetype',
    metadata: {
      name: '',
    },
    spec: {
      cpu: {
        guest: 2,
      },
      memory: {
        guest: '4Gi',
      },
    },
  };

  // Separate cluster-provided and user-provided instance types
  const { clusterProvided, userProvided } = React.useMemo(() => {
    if (!instanceTypes || !Array.isArray(instanceTypes)) {
      return { clusterProvided: [], userProvided: [] };
    }

    const cluster: typeof instanceTypes = [];
    const user: typeof instanceTypes = [];

    instanceTypes.forEach(it => {
      if (it.isClusterProvided()) {
        cluster.push(it);
      } else {
        user.push(it);
      }
    });

    return { clusterProvided: cluster, userProvided: user };
  }, [instanceTypes]);

  const currentData = tab === 0 ? clusterProvided : userProvided;

  return (
    <>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, px: 2 }}>
        <Tabs value={tab} onChange={(_, newValue) => setTab(newValue)}>
          <Tab label="Cluster Provided" />
          <Tab label="User Provided" />
        </Tabs>
      </Box>

      <Resource.ResourceListView
        title="Instance Types"
        data={currentData}
        headerProps={{
          titleSideActions: [
            <CreateButtonWithMode
              key="create"
              label="Create Instance Type"
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
            getValue: it => it.getName(),
            render: it => (
              <Link routeName="/kubevirt/instancetypes/:name" params={{ name: it.getName() }}>
                {it.getName()}
              </Link>
            ),
          },
          {
            id: 'cpu',
            label: 'CPU',
            getValue: it => it.getCPU(),
          },
          {
            id: 'memory',
            label: 'Memory',
            getValue: it => it.getMemory(),
          },
          {
            id: 'vendor',
            label: 'Vendor',
            getValue: it => it.getVendor(),
          },
          'age',
        ]}
      />

      <CreateResourceDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="Create Instance Type"
        resourceClass={VirtualMachineClusterInstanceType}
        initialResource={emptyInstanceType}
        initialTab={createInitialTab}
        formComponent={InstanceTypeForm}
        validate={r => !!(r?.metadata?.name && r?.spec?.cpu?.guest && r?.spec?.memory?.guest)}
      />
    </>
  );
}
