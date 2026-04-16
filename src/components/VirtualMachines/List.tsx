import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { DateLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Divider, ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useFeatureGate from '../../hooks/useFeatureGate';
import useFilteredList from '../../hooks/useFilteredList';
import useVMActions from '../../hooks/useVMActions';
import { buildLaunchTemplate } from '../../utils/launchTemplate';
import { getLabelColumns, LabelColumn } from '../../utils/pluginSettings';
import { safeError } from '../../utils/sanitize';
import ConfirmDialog from '../common/ConfirmDialog';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import { SimpleStyledTooltip, TitledTooltip } from '../common/StyledTooltip';
import ResourceEditorDialog from '../ResourceEditorDialog';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';
import CreateSnapshotDialog from '../VirtualMachineSnapshot/CreateSnapshotDialog';
import SaveAsTemplateDialog from '../VirtualMachineTemplate/SaveAsTemplateDialog';
import VMDoctorDialog from '../VMDoctor/VMDoctorDialog';
import BulkActionToolbar from './BulkActionToolbar';
import CloneDialog from './CloneDialog';
import VirtualMachine from './VirtualMachine';
import VMFormWrapper from './VMFormWrapper';

function DeleteProtectionBadge({ vm }: { vm: VirtualMachine }) {
  const [liveVM] = VirtualMachine.useGet(vm.getName(), vm.getNamespace());
  const isProtected = (liveVM || vm).isDeleteProtected();
  if (!isProtected) return null;
  return (
    <SimpleStyledTooltip title="Delete protection enabled — cannot be deleted until protection is removed">
      <Chip
        size="small"
        color="info"
        sx={{ minWidth: 'auto', '& .MuiChip-label': { px: 0.5 } }}
        icon={<Icon icon="mdi:lock" />}
        label=""
      />
    </SimpleStyledTooltip>
  );
}

function VMRowActionMenuItems({
  vm,
  closeMenu,
  snapshotEnabled,
  onDoctor,
  onClone,
  onSnapshot,
  onLaunchLikeThis,
  onSaveAsTemplate,
  onEdit,
  onViewYaml,
  onDelete,
}: {
  vm: VirtualMachine;
  closeMenu: () => void;
  snapshotEnabled: boolean;
  onDoctor: (vm: VirtualMachine) => void;
  onClone: (vm: VirtualMachine) => void;
  onSnapshot: (vm: VirtualMachine) => void;
  onLaunchLikeThis: (vm: VirtualMachine) => void;
  onSaveAsTemplate: (vm: VirtualMachine) => void;
  onEdit: (vm: VirtualMachine) => void;
  onViewYaml: (vm: VirtualMachine) => void;
  onDelete: (vm: VirtualMachine) => void;
}) {
  // Use live VM data only when menu is open (one at a time, not per row)
  const [liveVM] = VirtualMachine.useGet(vm.getName(), vm.getNamespace());
  const { actions, isProtected } = useVMActions(liveVM || vm);
  const templateEnabled = useFeatureGate('Template');

  return (
    <>
      {actions.map(a => (
        <MenuItem
          key={a.id}
          onClick={() => {
            closeMenu();
            a.handler();
          }}
          disabled={a.disabled}
        >
          <ListItemIcon>
            <Icon icon={a.icon} />
          </ListItemIcon>
          <ListItemText>{a.label}</ListItemText>
        </MenuItem>
      ))}
      <MenuItem
        key="doctor"
        onClick={() => {
          closeMenu();
          onDoctor(vm);
        }}
      >
        <ListItemIcon>
          <Icon icon="mdi:stethoscope" />
        </ListItemIcon>
        <ListItemText>VM Doctor</ListItemText>
      </MenuItem>
      {snapshotEnabled && (
        <MenuItem
          key="snapshot"
          onClick={() => {
            closeMenu();
            onSnapshot(vm);
          }}
        >
          <ListItemIcon>
            <Icon icon="mdi:camera" />
          </ListItemIcon>
          <ListItemText>Snapshot</ListItemText>
        </MenuItem>
      )}
      {snapshotEnabled && (
        <MenuItem
          key="clone"
          onClick={() => {
            closeMenu();
            onClone(vm);
          }}
        >
          <ListItemIcon>
            <Icon icon="mdi:content-copy" />
          </ListItemIcon>
          <ListItemText>Clone</ListItemText>
        </MenuItem>
      )}
      <MenuItem
        key="launch-like-this"
        onClick={() => {
          closeMenu();
          onLaunchLikeThis(vm);
        }}
      >
        <ListItemIcon>
          <Icon icon="mdi:rocket-launch" />
        </ListItemIcon>
        <ListItemText>Launch More Like This</ListItemText>
      </MenuItem>
      {templateEnabled && (
        <MenuItem
          key="save-as-template"
          onClick={() => {
            closeMenu();
            onSaveAsTemplate(vm);
          }}
        >
          <ListItemIcon>
            <Icon icon="mdi:text-box-outline" />
          </ListItemIcon>
          <ListItemText>Save as Template</ListItemText>
        </MenuItem>
      )}
      <Divider />
      <MenuItem
        key="edit"
        onClick={() => {
          closeMenu();
          onEdit(liveVM || vm);
        }}
      >
        <ListItemIcon>
          <Icon icon="mdi:pencil" />
        </ListItemIcon>
        <ListItemText>Edit</ListItemText>
      </MenuItem>
      <MenuItem
        key="view-yaml"
        onClick={() => {
          closeMenu();
          onViewYaml(liveVM || vm);
        }}
      >
        <ListItemIcon>
          <Icon icon="mdi:eye" />
        </ListItemIcon>
        <ListItemText>View YAML</ListItemText>
      </MenuItem>
      <MenuItem
        key="delete"
        onClick={() => {
          closeMenu();
          onDelete(vm);
        }}
        disabled={isProtected}
      >
        <ListItemIcon>
          <Icon icon="mdi:delete" />
        </ListItemIcon>
        <ListItemText>Delete</ListItemText>
      </MenuItem>
    </>
  );
}

const EMPTY_VM = {
  apiVersion: 'kubevirt.io/v1',
  kind: 'VirtualMachine',
  metadata: {
    name: '',
    namespace: 'default',
  },
  spec: {
    runStrategy: 'Always',
    template: {
      metadata: {},
      spec: {
        domain: {
          devices: {
            disks: [
              {
                name: 'cloudinitdisk',
                disk: { bus: 'virtio' },
              },
            ],
            interfaces: [{ name: 'default', masquerade: {} }],
          },
          resources: { requests: { memory: '2Gi' } },
          cpu: { cores: 2 },
        },
        networks: [{ name: 'default', pod: {} }],
        volumes: [
          {
            name: 'cloudinitdisk',
            cloudInitNoCloud: { userData: '#cloud-config\n' },
          },
        ],
      },
    },
  },
};

export default function VirtualMachineList() {
  const { enqueueSnackbar } = useSnackbar();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState(0);
  const [customLabelColumns, setCustomLabelColumns] = useState<LabelColumn[]>([]);
  const [doctorVM, setDoctorVM] = useState<VirtualMachine | null>(null);
  const [doctorVMI, setDoctorVMI] = useState<Record<string, unknown> | null>(null);
  const [doctorPodName, setDoctorPodName] = useState('');
  const [deleteVM, setDeleteVM] = useState<VirtualMachine | null>(null);
  const [editVM, setEditVM] = useState<VirtualMachine | null>(null);
  const [viewYamlVM, setViewYamlVM] = useState<VirtualMachine | null>(null);
  const [cloneVM, setCloneVM] = useState<VirtualMachine | null>(null);
  const [snapshotVM, setSnapshotVM] = useState<VirtualMachine | null>(null);
  const [saveAsTemplateVM, setSaveAsTemplateVM] = useState<VirtualMachine | null>(null);
  const [launchLikeThisVM, setLaunchLikeThisVM] = useState<VirtualMachine | null>(null);
  useEffect(() => {
    setCustomLabelColumns(getLabelColumns());
  }, []);

  const snapshotEnabled = useFeatureGate('Snapshot');

  // Fetch VMs (all namespaces, filtered client-side for smooth switching)
  const { items: rawVmItems } = VirtualMachine.useList();
  const vmItems = useFilteredList(rawVmItems);

  // Fetch VMIs for node and IP information
  const { items: rawVmiItems } = VirtualMachineInstance.useList();
  const vmiItems = useFilteredList(rawVmiItems);
  const vmiMap = React.useMemo(() => {
    const map = new Map();
    if (vmiItems) {
      vmiItems.forEach(vmi => {
        const key = `${vmi.getNamespace()}/${vmi.getName()}`;
        map.set(key, vmi);
      });
    }
    return map;
  }, [vmiItems]);

  const getVMI = useCallback(
    (vm: VirtualMachine) => {
      const key = `${vm.getNamespace()}/${vm.getName()}`;
      return vmiMap.get(key);
    },
    [vmiMap]
  );

  // Build MRT columns
  const columns = useMemo(() => {
    const cols: Array<{
      id: string;
      header: string;
      accessorFn: (vm: VirtualMachine) => string;
      Cell?: (props: { row: { original: VirtualMachine } }) => React.ReactNode;
    }> = [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (vm: VirtualMachine) => vm.getName(),
        Cell: ({ row }: { row: { original: VirtualMachine } }) => (
          <Link
            routeName="virtualmachine"
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
        accessorFn: (vm: VirtualMachine) => vm.getNamespace(),
      },
    ];

    cols.push(
      {
        id: 'status',
        header: 'Status',
        accessorFn: (vm: VirtualMachine) => vm.status?.printableStatus || 'Unknown',
        Cell: ({ row }: { row: { original: VirtualMachine } }) => {
          const vm = row.original;
          const status = vm.status?.printableStatus || 'Unknown';
          let color: 'success' | 'error' | 'warning' | 'info' | 'default' = 'default';
          let icon = null;

          switch (status) {
            case 'Running':
              color = 'success';
              break;
            case 'Stopped':
              color = 'default';
              break;
            case 'Starting':
            case 'Stopping':
              color = 'info';
              icon = <Icon icon="mdi:sync" />;
              break;
            case 'Migrating':
              color = 'info';
              icon = <Icon icon="mdi:arrow-decision" />;
              break;
            case 'Error':
            case 'CrashLoopBackOff':
              color = 'error';
              icon = <Icon icon="mdi:alert-circle" />;
              break;
            case 'Paused':
              color = 'warning';
              break;
            default:
              color = 'default';
          }

          return (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip label={status} size="small" color={color} icon={icon} />
              {!vm.isLiveMigratable() && status === 'Running' && (
                <TitledTooltip
                  title="Not Migratable"
                  rows={[{ label: 'Reason', value: vm.getLiveMigratableReason() }]}
                >
                  <Chip
                    size="small"
                    color="warning"
                    sx={{ minWidth: 'auto', '& .MuiChip-label': { px: 0.5 } }}
                    icon={
                      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Icon icon="mdi:swap-horizontal" />
                        <Icon
                          icon="mdi:close-thick"
                          style={{
                            position: 'absolute',
                            fontSize: '0.7em',
                            right: -2,
                            bottom: -2,
                            color: '#d32f2f',
                          }}
                        />
                      </Box>
                    }
                    label=""
                  />
                </TitledTooltip>
              )}
              <DeleteProtectionBadge vm={vm} />
            </Box>
          );
        },
      },
      {
        id: 'node',
        header: 'Node',
        accessorFn: (vm: VirtualMachine) => {
          const vmi = getVMI(vm);
          return vmi?.status?.nodeName || '-';
        },
      },
      {
        id: 'ip',
        header: 'IP Address',
        accessorFn: (vm: VirtualMachine) => {
          const vmi = getVMI(vm);
          if (!vmi) return '-';
          const interfaces = vmi.status?.interfaces || [];
          const ips: string[] = [];
          interfaces.forEach((iface: { ipAddresses?: string[] }) => {
            if (iface.ipAddresses && Array.isArray(iface.ipAddresses)) {
              iface.ipAddresses.forEach((ip: string) => {
                if (!ip.startsWith('fe80::') && !ips.includes(ip)) {
                  ips.push(ip);
                }
              });
            }
          });
          return ips.length > 0 ? ips[0] : '-';
        },
        Cell: ({ row }: { row: { original: VirtualMachine } }) => {
          const vmi = getVMI(row.original);
          if (!vmi) return '-';

          const interfaces = vmi.status?.interfaces || [];
          const ips: string[] = [];
          interfaces.forEach((iface: { ipAddresses?: string[] }) => {
            if (iface.ipAddresses && Array.isArray(iface.ipAddresses)) {
              iface.ipAddresses.forEach((ip: string) => {
                if (!ip.startsWith('fe80::') && !ips.includes(ip)) {
                  ips.push(ip);
                }
              });
            }
          });

          if (ips.length === 0) return '-';
          if (ips.length === 1) return ips[0];

          return (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <span>{ips[0]}</span>
              <TitledTooltip
                title="Additional IPs"
                rows={ips.slice(1).map((ip: string) => ({ label: '', value: ip }))}
              >
                <Chip
                  label={`+${ips.length - 1} more`}
                  size="small"
                  variant="outlined"
                  sx={{ cursor: 'help' }}
                />
              </TitledTooltip>
            </Box>
          );
        },
      }
    );

    // Custom label columns from settings
    customLabelColumns.forEach(col => {
      cols.push({
        id: `label-${col.labelKey}`,
        header: col.label,
        accessorFn: (vm: VirtualMachine) => {
          const labels = vm.metadata?.labels || {};
          return labels[col.labelKey] || '-';
        },
      });
    });

    // Age column
    cols.push({
      id: 'age',
      header: 'Age',
      accessorFn: (vm: VirtualMachine) => vm.metadata?.creationTimestamp || '',
      Cell: ({ row }: { row: { original: VirtualMachine } }) => {
        const ts = row.original.metadata?.creationTimestamp;
        return ts ? <DateLabel date={ts} /> : '-';
      },
    });

    return cols;
  }, [getVMI, customLabelColumns]);

  const openDoctor = useCallback(async (vm: VirtualMachine) => {
    const vmName = vm.getName();
    const ns = vm.getNamespace();

    // Fetch VMI and pod before opening dialog
    let vmi = null;
    let podName = '';

    try {
      const [vmiResult, podResult] = await Promise.allSettled([
        ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
            ns
          )}/virtualmachineinstances/${encodeURIComponent(vmName)}`
        ),
        ApiProxy.request(
          `/api/v1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${encodeURIComponent(
            `vm.kubevirt.io/name=${vmName}`
          )}`
        ),
      ]);
      if (vmiResult.status === 'fulfilled') vmi = vmiResult.value;
      if (podResult.status === 'fulfilled') {
        const pod = (podResult.value?.items || []).find((p: { metadata?: { name?: string } }) =>
          p.metadata?.name?.startsWith('virt-launcher-')
        );
        if (pod) podName = pod.metadata.name;
      }
    } catch {
      /* ignore */
    }

    setDoctorVMI(vmi);
    setDoctorPodName(podName);
    setDoctorVM(vm);
  }, []);

  // Row action menu items (per-row three-dot menu)
  const renderRowActionMenuItems = useCallback(
    ({ row, closeMenu }: { row: { original: VirtualMachine }; closeMenu: () => void }) => [
      <VMRowActionMenuItems
        key="actions"
        vm={row.original}
        closeMenu={closeMenu}
        snapshotEnabled={snapshotEnabled}
        onDoctor={openDoctor}
        onClone={setCloneVM}
        onSnapshot={setSnapshotVM}
        onLaunchLikeThis={setLaunchLikeThisVM}
        onSaveAsTemplate={setSaveAsTemplateVM}
        onEdit={setEditVM}
        onViewYaml={setViewYamlVM}
        onDelete={setDeleteVM}
      />,
    ],
    [snapshotEnabled, openDoctor]
  );

  return (
    <>
      <SectionBox
        title={
          <SectionFilterHeader
            title="Virtual Machines"
            titleSideActions={[
              <CreateButtonWithMode
                key="create"
                label="Create VM"
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
          columns={columns}
          data={vmItems ?? []}
          loading={vmItems === null}
          enableRowSelection
          enableRowActions
          enableFacetedValues
          enableFullScreenToggle={false}
          renderRowActionMenuItems={renderRowActionMenuItems}
          renderRowSelectionToolbar={({ table }) => <BulkActionToolbar table={table} />}
          getRowId={(vm: VirtualMachine) => vm.metadata?.uid ?? vm.getName()}
        />
      </SectionBox>

      <CreateResourceDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="Create Virtual Machine"
        resourceClass={VirtualMachine}
        initialResource={EMPTY_VM}
        initialTab={createInitialTab}
        formComponent={VMFormWrapper}
        validate={r => !!(r?.metadata?.name && r?.metadata?.namespace)}
      />

      <VMDoctorDialog
        open={!!doctorVM}
        onClose={() => setDoctorVM(null)}
        vmName={doctorVM?.getName() || ''}
        namespace={doctorVM?.getNamespace() || ''}
        vmiData={doctorVMI}
        vmItem={doctorVM}
        podName={doctorPodName}
      />

      <ConfirmDialog
        open={!!deleteVM}
        title={`Delete ${deleteVM?.getName() || ''}?`}
        message={`This will permanently delete the Virtual Machine ${deleteVM?.getNamespace()}/${deleteVM?.getName()}. This action cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setDeleteVM(null)}
        onConfirm={async () => {
          if (!deleteVM) return;
          const name = deleteVM.getName();
          setDeleteVM(null);
          try {
            await deleteVM.delete();
            enqueueSnackbar(`Deleted ${name}`, { variant: 'success' });
          } catch (e) {
            enqueueSnackbar(`Failed to delete ${name}: ${safeError(e, 'vm-delete')}`, {
              variant: 'error',
            });
          }
        }}
      />

      {editVM && (
        <ResourceEditorDialog
          open={!!editVM}
          onClose={() => setEditVM(null)}
          onSave={async updatedResource => {
            const resource = updatedResource as {
              kind: string;
              metadata: { name: string; namespace?: string };
            };
            if (!resource.kind || !resource.metadata?.name) {
              throw new Error('Invalid resource: missing kind or metadata.name');
            }
            await editVM.update(
              updatedResource as import('@kinvolk/headlamp-plugin/lib/lib/k8s/KubeObject').KubeObjectInterface
            );
          }}
          item={editVM.jsonData}
          title={editVM.getName()}
          apiVersion="kubevirt.io/v1"
          kind="VirtualMachine"
        />
      )}

      {viewYamlVM && (
        <ResourceEditorDialog
          open={!!viewYamlVM}
          onClose={() => setViewYamlVM(null)}
          onSave={async () => {}}
          item={viewYamlVM.jsonData}
          title={`${viewYamlVM.getName()} (read-only)`}
          apiVersion="kubevirt.io/v1"
          kind="VirtualMachine"
        />
      )}

      <CloneDialog
        open={!!cloneVM}
        onClose={() => setCloneVM(null)}
        vmName={cloneVM?.getName() || ''}
        namespace={cloneVM?.getNamespace() || ''}
      />

      <SaveAsTemplateDialog
        open={!!saveAsTemplateVM}
        onClose={() => setSaveAsTemplateVM(null)}
        vmName={saveAsTemplateVM?.getName() || ''}
        namespace={saveAsTemplateVM?.getNamespace() || ''}
      />

      <CreateSnapshotDialog
        open={!!snapshotVM}
        onClose={() => setSnapshotVM(null)}
        vmName={snapshotVM?.getName() || ''}
        namespace={snapshotVM?.getNamespace() || ''}
      />

      {launchLikeThisVM && (
        <CreateResourceDialog
          open={!!launchLikeThisVM}
          onClose={() => setLaunchLikeThisVM(null)}
          title="Launch More Like This"
          resourceClass={VirtualMachine}
          initialResource={buildLaunchTemplate(launchLikeThisVM.jsonData)}
          formComponent={VMFormWrapper}
          validate={r => !!(r?.metadata?.name && r?.metadata?.namespace)}
        />
      )}
    </>
  );
}
