import { Icon } from '@iconify/react';
import { Link, Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, ListItemIcon, ListItemText, MenuItem, Tooltip } from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isFeatureGateEnabled, subscribeToFeatureGates } from '../../utils/featureGates';
import { getLabelColumns, LabelColumn } from '../../utils/pluginSettings';
import CreateButtonWithMode from '../common/CreateButtonWithMode';
import CreateResourceDialog from '../common/CreateResourceDialog';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';
import VirtualMachine from './VirtualMachine';
import VMFormWrapper from './VMFormWrapper';

export default function VirtualMachineList() {
  const { enqueueSnackbar } = useSnackbar();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [customLabelColumns, setCustomLabelColumns] = useState<LabelColumn[]>([]);
  const location = useLocation();

  const triggerRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  // Load custom label columns from settings
  useEffect(() => {
    setCustomLabelColumns(getLabelColumns());
  }, []);

  // Check if a namespace is selected (from URL query params)
  const isNamespaceFiltered = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const namespace = params.get('namespace');
    return namespace && namespace !== '';
  }, [location.search]);

  // Use pre-loaded feature gates (loaded at plugin init, no delay)
  const [liveMigrationEnabled, setLiveMigrationEnabled] = useState(
    isFeatureGateEnabled('LiveMigration')
  );
  useEffect(() => {
    // Re-check in case gates loaded between module init and mount
    setLiveMigrationEnabled(isFeatureGateEnabled('LiveMigration'));
    return subscribeToFeatureGates(() => {
      setLiveMigrationEnabled(isFeatureGateEnabled('LiveMigration'));
    });
  }, []);

  const emptyVM = {
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
                  disk: {
                    bus: 'virtio',
                  },
                },
              ],
              interfaces: [
                {
                  name: 'default',
                  masquerade: {},
                },
              ],
            },
            resources: {
              requests: {
                memory: '2Gi',
              },
            },
            cpu: {
              cores: 2,
            },
          },
          networks: [
            {
              name: 'default',
              pod: {},
            },
          ],
          volumes: [
            {
              name: 'cloudinitdisk',
              cloudInitNoCloud: {
                userData: '#cloud-config\n',
              },
            },
          ],
        },
      },
    },
  };

  // Fetch VMIs to get node and IP information
  const { items: vmiItems } = VirtualMachineInstance.useList();
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

  const getVMI = (vm: VirtualMachine) => {
    const key = `${vm.getNamespace()}/${vm.getName()}`;
    return vmiMap.get(key);
  };

  return (
    <>
      <Resource.ResourceListView
        key={refreshKey}
        title="Virtual Machines"
        resourceClass={VirtualMachine}
        headerProps={{
          titleSideActions: [
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
          ],
        }}
        actions={[
          {
            id: 'start',
            action: ({ item, closeMenu }: { item: VirtualMachine; closeMenu: () => void }) => {
              const status = item.status?.printableStatus || 'Unknown';
              const isDisabled = status !== 'Stopped';
              return (
                <MenuItem
                  onClick={async () => {
                    closeMenu();
                    try {
                      await item.start();
                      enqueueSnackbar(`Starting VM ${item.getName()}`, { variant: 'success' });
                    } catch (e) {
                      enqueueSnackbar(`Failed to start VM ${item.getName()}: ${e}`, {
                        variant: 'error',
                      });
                    }
                  }}
                  disabled={isDisabled}
                >
                  <ListItemIcon>
                    <Icon icon="mdi:play" />
                  </ListItemIcon>
                  <ListItemText>Start</ListItemText>
                </MenuItem>
              );
            },
          },
          {
            id: 'stop',
            action: ({ item, closeMenu }: { item: VirtualMachine; closeMenu: () => void }) => {
              const status = item.status?.printableStatus || 'Unknown';
              const isDisabled = status === 'Stopped' || status === 'Stopping';
              return (
                <MenuItem
                  onClick={async () => {
                    closeMenu();
                    try {
                      await item.stop();
                      enqueueSnackbar(`Stopping VM ${item.getName()}`, { variant: 'success' });
                    } catch (e) {
                      enqueueSnackbar(`Failed to stop VM ${item.getName()}: ${e}`, {
                        variant: 'error',
                      });
                    }
                  }}
                  disabled={isDisabled}
                >
                  <ListItemIcon>
                    <Icon icon="mdi:stop" />
                  </ListItemIcon>
                  <ListItemText>Stop</ListItemText>
                </MenuItem>
              );
            },
          },
          {
            id: 'force-stop',
            action: ({ item, closeMenu }: { item: VirtualMachine; closeMenu: () => void }) => {
              const status = item.status?.printableStatus || 'Unknown';
              const isDisabled = status === 'Stopped';
              return (
                <MenuItem
                  onClick={async () => {
                    closeMenu();
                    try {
                      await item.forceStop();
                      enqueueSnackbar(`Force stopping VM ${item.getName()}`, {
                        variant: 'success',
                      });
                    } catch (e) {
                      enqueueSnackbar(`Failed to force stop VM ${item.getName()}: ${e}`, {
                        variant: 'error',
                      });
                    }
                  }}
                  disabled={isDisabled}
                >
                  <ListItemIcon>
                    <Icon icon="mdi:stop-circle" />
                  </ListItemIcon>
                  <ListItemText>Force Stop</ListItemText>
                </MenuItem>
              );
            },
          },
          {
            id: 'vm-restart',
            action: ({ item, closeMenu }: { item: VirtualMachine; closeMenu: () => void }) => {
              const status = item.status?.printableStatus || 'Unknown';
              const isDisabled = status !== 'Running';
              return (
                <MenuItem
                  onClick={async () => {
                    closeMenu();
                    try {
                      await item.restart();
                      enqueueSnackbar(`Restarting VM ${item.getName()}`, { variant: 'success' });
                    } catch (e) {
                      enqueueSnackbar(`Failed to restart VM ${item.getName()}: ${e}`, {
                        variant: 'error',
                      });
                    }
                  }}
                  disabled={isDisabled}
                >
                  <ListItemIcon>
                    <Icon icon="mdi:restart" />
                  </ListItemIcon>
                  <ListItemText>Restart</ListItemText>
                </MenuItem>
              );
            },
          },
          {
            id: 'vm-pause',
            action: ({ item, closeMenu }: { item: VirtualMachine; closeMenu: () => void }) => {
              const status = item.status?.printableStatus || 'Unknown';
              const isPaused = item.isPaused();
              const isDisabled = status !== 'Running';
              return (
                <MenuItem
                  onClick={async () => {
                    closeMenu();
                    try {
                      if (isPaused) {
                        await item.unpause();
                        enqueueSnackbar(`Unpausing VM ${item.getName()}`, { variant: 'success' });
                      } else {
                        await item.pause();
                        enqueueSnackbar(`Pausing VM ${item.getName()}`, { variant: 'success' });
                      }
                    } catch (e) {
                      enqueueSnackbar(
                        `Failed to ${isPaused ? 'unpause' : 'pause'} VM ${item.getName()}: ${e}`,
                        { variant: 'error' }
                      );
                    }
                  }}
                  disabled={isDisabled}
                >
                  <ListItemIcon>
                    <Icon icon={isPaused ? 'mdi:play-pause' : 'mdi:pause'} />
                  </ListItemIcon>
                  <ListItemText>{isPaused ? 'Unpause' : 'Pause'}</ListItemText>
                </MenuItem>
              );
            },
          },
          ...(liveMigrationEnabled
            ? [
                {
                  id: 'vm-migrate',
                  action: ({
                    item,
                    closeMenu,
                  }: {
                    item: VirtualMachine;
                    closeMenu: () => void;
                  }) => {
                    const status = item.status?.printableStatus || 'Unknown';
                    const isDisabled = status !== 'Running' || !item.isLiveMigratable();
                    return (
                      <MenuItem
                        onClick={async () => {
                          closeMenu();
                          try {
                            await item.migrate();
                            enqueueSnackbar(`Migrating VM ${item.getName()}`, {
                              variant: 'success',
                            });
                          } catch (e) {
                            enqueueSnackbar(`Failed to migrate VM ${item.getName()}: ${e}`, {
                              variant: 'error',
                            });
                          }
                        }}
                        disabled={isDisabled}
                      >
                        <ListItemIcon>
                          <Icon icon="mdi:arrow-decision" />
                        </ListItemIcon>
                        <ListItemText>Migrate</ListItemText>
                      </MenuItem>
                    );
                  },
                },
              ]
            : []),
          {
            id: 'vm-protect',
            action: ({ item, closeMenu }: { item: VirtualMachine; closeMenu: () => void }) => {
              const isProtected = item.isDeleteProtected();
              return (
                <MenuItem
                  onClick={async () => {
                    closeMenu();
                    try {
                      await item.setDeleteProtection(!isProtected);
                      enqueueSnackbar(
                        `VM ${item.getName()} ${
                          isProtected ? 'unprotected' : 'protected'
                        } from deletion`,
                        { variant: 'success' }
                      );
                      triggerRefresh();
                    } catch (e) {
                      enqueueSnackbar(
                        `Failed to ${
                          isProtected ? 'unprotect' : 'protect'
                        } VM ${item.getName()}: ${e}`,
                        { variant: 'error' }
                      );
                    }
                  }}
                >
                  <ListItemIcon>
                    <Icon icon={isProtected ? 'mdi:lock-open' : 'mdi:lock'} />
                  </ListItemIcon>
                  <ListItemText>{isProtected ? 'Unprotect' : 'Protect'}</ListItemText>
                </MenuItem>
              );
            },
          },
        ]}
        columns={[
          {
            id: 'name',
            label: 'Name',
            getValue: vm => vm.getName(),
            render: vm => (
              <Link
                routeName="virtualmachine"
                params={{ name: vm.getName(), namespace: vm.getNamespace() }}
              >
                {vm.getName()}
              </Link>
            ),
          },
          // Only show namespace column when not filtered by namespace
          ...(isNamespaceFiltered ? [] : ['namespace' as const]),
          {
            id: 'status',
            label: 'Status',
            getValue: vm => vm.status?.printableStatus || 'Unknown',
            render: vm => {
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
                  {liveMigrationEnabled && !vm.isLiveMigratable() && status === 'Running' && (
                    <Tooltip
                      title={
                        <div style={{ fontSize: '0.875rem' }}>
                          <strong>Not Migratable</strong>
                          <br />
                          {vm.getLiveMigratableReason()}
                        </div>
                      }
                      arrow
                    >
                      <Chip
                        size="small"
                        color="warning"
                        sx={{
                          minWidth: 'auto',
                          '& .MuiChip-label': { px: 0.5 },
                        }}
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
                    </Tooltip>
                  )}
                  {vm.isDeleteProtected() && (
                    <Tooltip
                      title={
                        <div style={{ fontSize: '0.875rem' }}>
                          <strong>Protected</strong>
                          <br />
                          Delete protection enabled - cannot be deleted until protection is removed
                        </div>
                      }
                      arrow
                    >
                      <Chip
                        size="small"
                        color="info"
                        sx={{
                          minWidth: 'auto',
                          '& .MuiChip-label': { px: 0.5 },
                        }}
                        icon={<Icon icon="mdi:lock" />}
                        label=""
                      />
                    </Tooltip>
                  )}
                </Box>
              );
            },
          },
          {
            id: 'node',
            label: 'Node',
            getValue: vm => {
              const vmi = getVMI(vm);
              return vmi?.status?.nodeName || '-';
            },
          },
          {
            id: 'ip',
            label: 'IP Address',
            getValue: vm => {
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
            render: vm => {
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

              if (ips.length === 0) return '-';
              if (ips.length === 1) return ips[0];

              return (
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <span>{ips[0]}</span>
                  <Tooltip
                    title={
                      <div style={{ fontSize: '0.875rem' }}>
                        {ips.slice(1).map((ip: string, idx: number) => (
                          <div key={idx}>{ip}</div>
                        ))}
                      </div>
                    }
                    arrow
                  >
                    <Chip
                      label={`+${ips.length - 1} more`}
                      size="small"
                      variant="outlined"
                      sx={{ cursor: 'help' }}
                    />
                  </Tooltip>
                </Box>
              );
            },
          },
          // Custom label columns from settings
          ...customLabelColumns.map(col => ({
            id: `label-${col.labelKey}`,
            label: col.label,
            getValue: (vm: VirtualMachine) => {
              const labels = vm.metadata?.labels || {};
              return labels[col.labelKey] || '-';
            },
          })),
          'age',
        ]}
      />

      <CreateResourceDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="Create Virtual Machine"
        resourceClass={VirtualMachine}
        initialResource={emptyVM}
        initialTab={createInitialTab}
        formComponent={VMFormWrapper}
        validate={r => !!(r?.metadata?.name && r?.metadata?.namespace)}
      />
    </>
  );
}
