import { Icon } from '@iconify/react';
import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Button, Chip } from '@mui/material';
import { useState } from 'react';
import CreateResourceDialog from '../common/CreateResourceDialog';
import DataVolume from './DataVolume';
import ImportVolumeForm from './ImportVolumeForm';

export default function DataVolumeList() {
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
      <Resource.ResourceListView
        title="DataVolumes"
        resourceClass={DataVolume}
        headerProps={{
          titleSideActions: [
            <Button
              key="import"
              variant="contained"
              startIcon={<Icon icon="mdi:upload" />}
              onClick={() => setImportDialogOpen(true)}
            >
              Import Volume
            </Button>,
          ],
          noNamespaceFilter: false,
        }}
        columns={[
          {
            id: 'name',
            label: 'Name',
            getValue: dv => dv.getName(),
            render: dv => (
              <Link
                routeName="datavolume"
                params={{ name: dv.getName(), namespace: dv.getNamespace() }}
              >
                {dv.getName()}
              </Link>
            ),
          },
          'namespace',
          {
            id: 'source',
            label: 'Source Type',
            getValue: dv => dv.getSourceType(),
          },
          {
            id: 'size',
            label: 'Size',
            getValue: dv => dv.getSize(),
          },
          {
            id: 'storage-class',
            label: 'Storage Class',
            getValue: dv => dv.getStorageClass(),
          },
          {
            id: 'content-type',
            label: 'Content Type',
            getValue: dv => dv.getContentType(),
          },
          {
            id: 'status',
            label: 'Status',
            getValue: dv => {
              const phase = dv.status?.phase || 'Unknown';
              return phase;
            },
            render: dv => {
              const phase = dv.status?.phase || 'Unknown';
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
          'age',
        ]}
      />

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
