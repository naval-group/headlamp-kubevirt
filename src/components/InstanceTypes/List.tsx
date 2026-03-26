import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
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

      <SectionBox
        title={
          <SectionFilterHeader
            title="Instance Types"
            titleSideActions={[
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
            ]}
          />
        }
      >
        <Table
          data={currentData ?? []}
          loading={instanceTypes === null}
          columns={[
            {
              id: 'name',
              header: 'Name',
              accessorFn: (it: VirtualMachineClusterInstanceType) => it.getName(),
              Cell: ({ row }: { row: { original: VirtualMachineClusterInstanceType } }) => (
                <Link routeName="instancetype" params={{ name: row.original.getName() }}>
                  {row.original.getName()}
                </Link>
              ),
            },
            {
              id: 'cpu',
              header: 'CPU',
              accessorFn: (it: VirtualMachineClusterInstanceType) => it.getCPU(),
            },
            {
              id: 'memory',
              header: 'Memory',
              accessorFn: (it: VirtualMachineClusterInstanceType) => it.getMemory(),
            },
            {
              id: 'vendor',
              header: 'Vendor',
              accessorFn: (it: VirtualMachineClusterInstanceType) => it.getVendor(),
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (it: VirtualMachineClusterInstanceType) =>
                it.metadata?.creationTimestamp || '',
              Cell: ({ row }: { row: { original: VirtualMachineClusterInstanceType } }) => {
                const ts = row.original.metadata?.creationTimestamp;
                return ts ? <DateLabel date={ts} /> : '-';
              },
            },
          ]}
        />
      </SectionBox>

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
