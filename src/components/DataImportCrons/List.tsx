import { Icon } from '@iconify/react';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import React, { useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
import useResourceActions from '../../hooks/useResourceActions';
import BulkDeleteToolbar from '../common/BulkDeleteToolbar';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import StandardRowActions from '../common/StandardRowActions';
import DataImportCron from './DataImportCron';
import DataImportCronForm from './DataImportCronForm';

export default function DataImportCronList() {
  const { items: rawItems, errors } = DataImportCron.useList();
  const items = useFilteredList(rawItems);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState(0);
  const { setEditItem, setViewYamlItem, setDeleteItem, ActionDialogs } = useResourceActions<
    InstanceType<typeof DataImportCron>
  >({
    apiVersion: 'cdi.kubevirt.io/v1beta1',
    kind: 'DataImportCron',
  });

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
      <SectionBox
        title={
          <SectionFilterHeader
            title="DataImportCrons"
            titleSideActions={[
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
            ]}
          />
        }
      >
        <Table
          data={items ?? []}
          loading={items === null}
          enableRowActions
          enableRowSelection
          getRowId={(dic: InstanceType<typeof DataImportCron>) =>
            dic.metadata?.uid ?? `${dic.getNamespace()}/${dic.getName()}`
          }
          renderRowSelectionToolbar={({ table }) => (
            <BulkDeleteToolbar table={table} kind="DataImportCron" />
          )}
          renderRowActionMenuItems={({
            row,
            closeMenu,
          }: {
            row: { original: InstanceType<typeof DataImportCron> };
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
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => dic.getName(),
              Cell: ({ row }: { row: { original: InstanceType<typeof DataImportCron> } }) => (
                <Link
                  routeName="dataimportcron"
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
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => dic.getNamespace(),
            },
            {
              id: 'managed-datasource',
              header: 'Managed DataSource',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => dic.getManagedDataSource(),
              Cell: ({ row }: { row: { original: InstanceType<typeof DataImportCron> } }) => (
                <Link
                  routeName="datasource"
                  params={{
                    name: row.original.getManagedDataSource(),
                    namespace: row.original.getNamespace(),
                  }}
                >
                  {row.original.getManagedDataSource()}
                </Link>
              ),
            },
            {
              id: 'schedule',
              header: 'Schedule',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => dic.getSchedule(),
            },
            {
              id: 'source-type',
              header: 'Source Type',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => dic.getSourceType(),
            },
            {
              id: 'source-url',
              header: 'Source URL',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => dic.getSourceURL(),
              Cell: ({ row }: { row: { original: InstanceType<typeof DataImportCron> } }) => {
                const url = row.original.getSourceURL();
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
              header: 'Garbage Collect',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => dic.getGarbageCollect(),
            },
            {
              id: 'imports-to-keep',
              header: 'Imports to Keep',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => dic.getImportsToKeep(),
            },
            {
              id: 'status',
              header: 'Status',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) => {
                if (dic.isUpToDate()) return 'Up to Date';
                if (dic.isProgressing()) return 'Progressing';
                return 'Out of Date';
              },
              Cell: ({ row }: { row: { original: InstanceType<typeof DataImportCron> } }) => {
                if (row.original.isUpToDate()) {
                  return <Chip label="Up to Date" size="small" color="success" />;
                } else if (row.original.isProgressing()) {
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
              header: 'Last Execution',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) =>
                dic.getLastExecutionTimestamp(),
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (dic: InstanceType<typeof DataImportCron>) =>
                dic.metadata?.creationTimestamp || '',
              Cell: ({ row }: { row: { original: InstanceType<typeof DataImportCron> } }) => {
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
