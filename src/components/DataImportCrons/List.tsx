import { Icon } from '@iconify/react';
import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import React, { useState } from 'react';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import DataImportCron from './DataImportCron';
import DataImportCronForm from './DataImportCronForm';

export default function DataImportCronList() {
  const { items, errors } = DataImportCron.useList();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState(0);

  const emptyDataImportCron = {
    apiVersion: 'cdi.kubevirt.io/v1beta1',
    kind: 'DataImportCron',
    metadata: {
      name: '',
      namespace: 'default',
    },
    spec: {
      managedDataSource: '',
      schedule: '0 0 * * *',
      garbageCollect: 'Outdated',
      importsToKeep: 3,
      template: {
        spec: {
          source: {
            registry: {
              url: '',
            },
          },
          storage: {
            accessModes: ['ReadWriteOnce'],
            volumeMode: 'Filesystem',
            resources: {
              requests: {
                storage: '30Gi',
              },
            },
          },
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
          The DataImportCron feature requires CDI to be installed in your cluster. CDI provides the
          DataImportCron resources used for automatically importing and updating DataSources.
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
        title="DataImportCrons"
        data={items}
        headerProps={{
          titleSideActions: [
            <CreateButtonWithMode
              key="create"
              label="Create DataImportCron"
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
            getValue: dic => dic.getName(),
            render: dic => (
              <Link
                routeName="/kubevirt/dataimportcrons/:namespace/:name"
                params={{ name: dic.getName(), namespace: dic.getNamespace() }}
              >
                {dic.getName()}
              </Link>
            ),
          },
          {
            id: 'namespace',
            label: 'Namespace',
            getValue: dic => dic.getNamespace(),
            render: dic => <Chip label={dic.getNamespace()} size="small" variant="outlined" />,
          },
          {
            id: 'managed-datasource',
            label: 'Managed DataSource',
            getValue: dic => dic.getManagedDataSource(),
            render: dic => (
              <Link
                routeName="datasource"
                params={{ name: dic.getManagedDataSource(), namespace: dic.getNamespace() }}
              >
                {dic.getManagedDataSource()}
              </Link>
            ),
          },
          {
            id: 'schedule',
            label: 'Schedule',
            getValue: dic => dic.getSchedule(),
          },
          {
            id: 'source-type',
            label: 'Source Type',
            getValue: dic => dic.getSourceType(),
          },
          {
            id: 'source-url',
            label: 'Source URL',
            getValue: dic => dic.getSourceURL(),
            render: dic => {
              const url = dic.getSourceURL();
              if (url === '-') return url;
              return (
                <Typography
                  variant="body2"
                  sx={{
                    maxWidth: 300,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {url}
                </Typography>
              );
            },
          },
          {
            id: 'garbage-collect',
            label: 'Garbage Collect',
            getValue: dic => dic.getGarbageCollect(),
          },
          {
            id: 'imports-to-keep',
            label: 'Imports to Keep',
            getValue: dic => dic.getImportsToKeep(),
          },
          {
            id: 'status',
            label: 'Status',
            getValue: dic => {
              if (dic.isUpToDate()) return 'Up to Date';
              if (dic.isProgressing()) return 'Progressing';
              return 'Out of Date';
            },
            render: dic => {
              if (dic.isUpToDate()) {
                return <Chip label="Up to Date" size="small" color="success" />;
              } else if (dic.isProgressing()) {
                return (
                  <Chip
                    label="Progressing"
                    size="small"
                    color="info"
                    icon={<Icon icon="mdi:sync" />}
                  />
                );
              }
              return <Chip label="Out of Date" size="small" color="warning" />;
            },
          },
          {
            id: 'last-execution',
            label: 'Last Execution',
            getValue: dic => dic.getLastExecutionTimestamp(),
          },
          'age',
        ]}
      />

      <CreateResourceDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="Create DataImportCron"
        resourceClass={DataImportCron}
        initialResource={emptyDataImportCron}
        initialTab={createInitialTab}
        formComponent={DataImportCronForm}
        validate={r =>
          !!(
            r?.metadata?.name &&
            r?.metadata?.namespace &&
            r?.spec?.managedDataSource &&
            r?.spec?.schedule &&
            r?.spec?.template?.spec?.storage?.resources?.requests?.storage
          )
        }
      />
    </>
  );
}
