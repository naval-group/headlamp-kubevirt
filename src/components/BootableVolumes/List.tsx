import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import { useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
import { KubeCondition } from '../../types';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import DataSource from './DataSource';
import DataSourceForm from './DataSourceForm';

export default function DataSourceList() {
  const { items: rawItems, errors } = DataSource.useList();
  const items = useFilteredList(rawItems);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState(0);

  const emptyDataSource = {
    apiVersion: 'cdi.kubevirt.io/v1beta1',
    kind: 'DataSource',
    metadata: {
      name: '',
      namespace: 'default',
    },
    spec: {
      source: {
        pvc: {
          name: '',
          namespace: 'default',
        },
      },
    },
  };

  // Check if CDI is not installed (404 or API not found)
  const isCDINotInstalled =
    errors &&
    errors.length > 0 &&
    errors.some(
      error =>
        error?.status === 404 ||
        error?.message?.includes('not found') ||
        error?.message?.includes('the server could not find the requested resource')
    );

  if (isCDINotInstalled) {
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
          CDI (Containerized Data Importer) Not Installed
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
          The Bootable Volumes feature requires CDI to be installed in your cluster. CDI provides
          the DataSource resources used for managing bootable volumes.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Install CDI to enable this feature:{' '}
          <a
            href="https://kubevirt.io/user-guide/operations/containerized_data_importer/"
            target="_blank"
            rel="noopener noreferrer"
          >
            CDI Installation Guide
          </a>
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <SectionBox
        title={
          <SectionFilterHeader
            title="DataSources"
            titleSideActions={[
              <CreateButtonWithMode
                key="create"
                label="Create DataSource"
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
          data={items ?? []}
          loading={items === null}
          columns={[
            {
              id: 'name',
              header: 'Name',
              accessorFn: (ds: InstanceType<typeof DataSource>) => ds.getName(),
              Cell: ({ row }: { row: { original: InstanceType<typeof DataSource> } }) => (
                <Link
                  routeName="datasource"
                  params={{ name: row.original.getName(), namespace: row.original.getNamespace() }}
                >
                  {row.original.getName()}
                </Link>
              ),
            },
            {
              id: 'namespace',
              header: 'Namespace',
              accessorFn: (ds: InstanceType<typeof DataSource>) => ds.getNamespace(),
            },
            {
              id: 'os',
              header: 'Operating System',
              accessorFn: (ds: InstanceType<typeof DataSource>) => ds.getOperatingSystem(),
            },
            {
              id: 'instancetype',
              header: 'Instance Type',
              accessorFn: (ds: InstanceType<typeof DataSource>) => ds.getInstanceType(),
              Cell: ({ row }: { row: { original: InstanceType<typeof DataSource> } }) =>
                row.original.getInstanceType() !== '-' ? (
                  <Link routeName="instancetype" params={{ name: row.original.getInstanceType() }}>
                    {row.original.getInstanceType()}
                  </Link>
                ) : (
                  '-'
                ),
            },
            {
              id: 'preference',
              header: 'Preference',
              accessorFn: (ds: InstanceType<typeof DataSource>) => ds.getPreference(),
              Cell: ({ row }: { row: { original: InstanceType<typeof DataSource> } }) =>
                row.original.getPreference() !== '-' ? (
                  <Link routeName="preference" params={{ name: row.original.getPreference() }}>
                    {row.original.getPreference()}
                  </Link>
                ) : (
                  '-'
                ),
            },
            {
              id: 'source-pvc',
              header: 'Source PVC',
              accessorFn: (ds: InstanceType<typeof DataSource>) => ds.getSourcePVCName(),
            },
            {
              id: 'dataimportcron',
              header: 'DataImportCron',
              accessorFn: (ds: InstanceType<typeof DataSource>) => ds.getDataImportCron(),
              Cell: ({ row }: { row: { original: InstanceType<typeof DataSource> } }) =>
                row.original.getDataImportCron() !== '-' ? (
                  <Link
                    routeName="dataimportcron"
                    params={{
                      name: row.original.getDataImportCron(),
                      namespace: row.original.getNamespace(),
                    }}
                  >
                    {row.original.getDataImportCron()}
                  </Link>
                ) : (
                  '-'
                ),
            },
            {
              id: 'status',
              header: 'Status',
              accessorFn: (ds: InstanceType<typeof DataSource>) => {
                const conditions = ds.status?.conditions || [];
                const readyCondition = conditions.find((c: KubeCondition) => c.type === 'Ready');
                const runningCondition = conditions.find(
                  (c: KubeCondition) => c.type === 'Running'
                );

                if (readyCondition?.status === 'True') return 'Ready';
                if (runningCondition?.status === 'True') return 'Running';
                if (readyCondition?.reason) return readyCondition.reason;
                return 'Unknown';
              },
              Cell: ({ row }: { row: { original: InstanceType<typeof DataSource> } }) => {
                const conditions = row.original.status?.conditions || [];
                const readyCondition = conditions.find((c: KubeCondition) => c.type === 'Ready');
                const runningCondition = conditions.find(
                  (c: KubeCondition) => c.type === 'Running'
                );

                if (readyCondition?.status === 'True') {
                  return <Chip label="Ready" size="small" color="success" />;
                } else if (runningCondition?.status === 'True') {
                  return <Chip label="Running" size="small" color="info" />;
                } else if (
                  readyCondition?.reason === 'Pending' ||
                  readyCondition?.reason === 'Progressing'
                ) {
                  return <Chip label={readyCondition.reason} size="small" color="warning" />;
                } else if (readyCondition?.status === 'False') {
                  return <Chip label="Error" size="small" color="error" />;
                }
                return <Chip label="Unknown" size="small" color="default" />;
              },
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (ds: InstanceType<typeof DataSource>) =>
                ds.metadata?.creationTimestamp || '',
              Cell: ({ row }: { row: { original: InstanceType<typeof DataSource> } }) => {
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
        title="Create DataSource"
        resourceClass={DataSource}
        initialResource={emptyDataSource}
        initialTab={createInitialTab}
        formComponent={DataSourceForm}
        validate={r => !!(r?.metadata?.name && r?.metadata?.namespace)}
      />
    </>
  );
}
