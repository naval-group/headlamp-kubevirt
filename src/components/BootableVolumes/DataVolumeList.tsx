import { Icon } from '@iconify/react';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Button, Chip } from '@mui/material';
import { useState } from 'react';
import useFilteredList from '../../hooks/useFilteredList';
import CreateResourceDialog from '../common/CreateResourceDialog';
import DataVolume from './DataVolume';
import ImportVolumeForm from './ImportVolumeForm';

export default function DataVolumeList() {
  const { items: rawItems } = DataVolume.useList();
  const items = useFilteredList(rawItems);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Empty DataVolume for import
  const emptyDataVolume = {
    apiVersion: 'cdi.kubevirt.io/v1beta1',
    kind: 'DataVolume',
    metadata: {
      name: '',
      namespace: 'default',
    },
    spec: {
      source: {
        http: {
          url: '',
        },
      },
      storage: {
        resources: {
          requests: {
            storage: '30Gi',
          },
        },
        accessModes: ['ReadWriteOnce'],
        volumeMode: 'Filesystem',
      },
      contentType: 'kubevirt',
    },
  };

  return (
    <>
      <SectionBox
        title={
          <SectionFilterHeader
            title="DataVolumes"
            titleSideActions={[
              <Button
                key="import"
                variant="contained"
                startIcon={<Icon icon="mdi:upload" />}
                onClick={() => setImportDialogOpen(true)}
              >
                Import Volume
              </Button>,
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
              accessorFn: (dv: InstanceType<typeof DataVolume>) => dv.getName(),
              Cell: ({ row }: { row: { original: InstanceType<typeof DataVolume> } }) => (
                <Link
                  routeName="datavolume"
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
              accessorFn: (dv: InstanceType<typeof DataVolume>) => dv.getNamespace(),
            },
            {
              id: 'source',
              header: 'Source Type',
              accessorFn: (dv: InstanceType<typeof DataVolume>) => dv.getSourceType(),
            },
            {
              id: 'size',
              header: 'Size',
              accessorFn: (dv: InstanceType<typeof DataVolume>) => dv.getSize(),
            },
            {
              id: 'storage-class',
              header: 'Storage Class',
              accessorFn: (dv: InstanceType<typeof DataVolume>) => dv.getStorageClass(),
            },
            {
              id: 'content-type',
              header: 'Content Type',
              accessorFn: (dv: InstanceType<typeof DataVolume>) => dv.getContentType(),
            },
            {
              id: 'status',
              header: 'Status',
              accessorFn: (dv: InstanceType<typeof DataVolume>) => dv.status?.phase || 'Unknown',
              Cell: ({ row }: { row: { original: InstanceType<typeof DataVolume> } }) => {
                const phase = row.original.status?.phase || 'Unknown';
                let color: 'success' | 'error' | 'warning' | 'info' | 'default' = 'default';

                switch (phase) {
                  case 'Succeeded':
                    color = 'success';
                    break;
                  case 'Failed':
                    color = 'error';
                    break;
                  case 'Paused':
                    color = 'warning';
                    break;
                  case 'Pending':
                  case 'ImportScheduled':
                  case 'ImportInProgress':
                  case 'CloneScheduled':
                  case 'CloneInProgress':
                  case 'SnapshotForSmartCloneInProgress':
                  case 'SmartClonePVCInProgress':
                  case 'CSICloneInProgress':
                  case 'CloneFromSnapshotSourceInProgress':
                  case 'Provisioning':
                  case 'WaitForFirstConsumer':
                    color = 'info';
                    break;
                  default:
                    color = 'default';
                }

                return <Chip label={phase} size="small" color={color} />;
              },
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (dv: InstanceType<typeof DataVolume>) =>
                dv.metadata?.creationTimestamp || '',
              Cell: ({ row }: { row: { original: InstanceType<typeof DataVolume> } }) => {
                const ts = row.original.metadata?.creationTimestamp;
                return ts ? <DateLabel date={ts} /> : '-';
              },
            },
          ]}
        />
      </SectionBox>

      <CreateResourceDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        title="Import Volume (DataVolume)"
        resourceClass={DataVolume}
        initialResource={emptyDataVolume}
        formComponent={ImportVolumeForm}
        validate={r =>
          !!(
            r?.metadata?.name &&
            r?.metadata?.namespace &&
            r?.spec?.storage?.resources?.requests?.storage
          )
        }
      />
    </>
  );
}
