import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import { useState } from 'react';
import { KubeCondition } from '../../types';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import DataSource from './DataSource';
import DataSourceForm from './DataSourceForm';

export default function DataSourceList() {
  const { items, errors } = DataSource.useList();
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
      <Resource.ResourceListView
        title="DataSources"
        data={items}
        headerProps={{
          titleSideActions: [
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
          ],
        }}
        columns={[
          {
            id: 'name',
            label: 'Name',
            getValue: ds => ds.getName(),
            render: ds => (
              <Link
                routeName="datasource"
                params={{ name: ds.getName(), namespace: ds.getNamespace() }}
              >
                {ds.getName()}
              </Link>
            ),
          },
          'namespace',
          {
            id: 'os',
            label: 'Operating System',
            getValue: ds => ds.getOperatingSystem(),
          },
          {
            id: 'instancetype',
            label: 'Instance Type',
            getValue: ds => ds.getInstanceType(),
            render: ds =>
              ds.getInstanceType() !== '-' ? (
                <Link routeName="instancetype" params={{ name: ds.getInstanceType() }}>
                  {ds.getInstanceType()}
                </Link>
              ) : (
                '-'
              ),
          },
          {
            id: 'preference',
            label: 'Preference',
            getValue: ds => ds.getPreference(),
            render: ds =>
              ds.getPreference() !== '-' ? (
                <Link routeName="preference" params={{ name: ds.getPreference() }}>
                  {ds.getPreference()}
                </Link>
              ) : (
                '-'
              ),
          },
          {
            id: 'source-pvc',
            label: 'Source PVC',
            getValue: ds => ds.getSourcePVCName(),
          },
          {
            id: 'dataimportcron',
            label: 'DataImportCron',
            getValue: ds => ds.getDataImportCron(),
            render: ds =>
              ds.getDataImportCron() !== '-' ? (
                <Link
                  routeName="dataimportcron"
                  params={{ name: ds.getDataImportCron(), namespace: ds.getNamespace() }}
                >
                  {ds.getDataImportCron()}
                </Link>
              ) : (
                '-'
              ),
          },
          {
            id: 'status',
            label: 'Status',
            getValue: ds => {
              const conditions = ds.status?.conditions || [];
              const readyCondition = conditions.find((c: KubeCondition) => c.type === 'Ready');
              const runningCondition = conditions.find((c: KubeCondition) => c.type === 'Running');

              if (readyCondition?.status === 'True') return 'Ready';
              if (runningCondition?.status === 'True') return 'Running';
              if (readyCondition?.reason) return readyCondition.reason;
              return 'Unknown';
            },
            render: ds => {
              const conditions = ds.status?.conditions || [];
              const readyCondition = conditions.find((c: KubeCondition) => c.type === 'Ready');
              const runningCondition = conditions.find((c: KubeCondition) => c.type === 'Running');

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
          'age',
        ]}
      />

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
