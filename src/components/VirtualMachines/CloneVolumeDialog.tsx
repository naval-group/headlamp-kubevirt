import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { KubeListResponse, VMDisk, VMVolume } from '../../types';
import { safeError } from '../../utils/sanitize';
import {
  ACCESS_MODES,
  ClaimPropertySet,
  getChangedVolumes,
  getIneligibleReason,
  getValidAccessModes,
  getValidCombos,
  getValidVolumeModes,
  shortAccessMode,
  StorageProfileItem,
  VMFilesystem,
  VOLUME_MODES,
  VolumeConfig,
  VolumeInfo,
} from '../../utils/volumeDialog';
import VirtualMachine from './VirtualMachine';

interface CloneVolumeDialogProps {
  open: boolean;
  onClose: () => void;
  vm: InstanceType<typeof VirtualMachine>;
  volumeName?: string;
}

type Step = 'configure' | 'review';

export default function CloneVolumeDialog({
  open,
  onClose,
  vm,
  volumeName,
}: CloneVolumeDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [storageClasses, setStorageClasses] = useState<string[]>([]);
  const [storageProfiles, setStorageProfiles] = useState<Record<string, ClaimPropertySet[]>>({});
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [volumeInfos, setVolumeInfos] = useState<VolumeInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<Record<string, VolumeConfig>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('configure');

  const disks: VMDisk[] = vm.spec?.template?.spec?.domain?.devices?.disks || [];
  const volumes: VMVolume[] = vm.spec?.template?.spec?.volumes || [];
  const filesystems: VMFilesystem[] = vm.spec?.template?.spec?.domain?.devices?.filesystems || [];
  const dataVolumeTemplates = vm.spec?.dataVolumeTemplates || [];

  useEffect(() => {
    if (!open) return;

    // Reset state on open (merged from separate effect to avoid race)
    setSelected(new Set());
    setExpanded(new Set());
    setVolumeInfos([]);
    setConfigs({});
    setStep('configure');
    setFetching(true);

    const fetchSCList = ApiProxy.request('/apis/cdi.kubevirt.io/v1beta1/storageprofiles')
      .then((response: KubeListResponse<StorageProfileItem>) => {
        const items = response?.items || [];
        setStorageClasses(items.map(sp => sp.metadata.name));
        const profiles: Record<string, ClaimPropertySet[]> = {};
        for (const sp of items) {
          profiles[sp.metadata.name] = sp.status?.claimPropertySets || [];
        }
        setStorageProfiles(profiles);
        return profiles;
      })
      .catch(() => {
        enqueueSnackbar('Failed to fetch storage profiles', { variant: 'warning' });
        return {} as Record<string, ClaimPropertySet[]>;
      });

    const pvcVolumes = volumes.filter(v => v.persistentVolumeClaim || v.dataVolume);
    const fetchPvcs = Promise.all(
      pvcVolumes.map(async vol => {
        const pvcName = vol.dataVolume?.name || vol.persistentVolumeClaim?.claimName || '';
        const reason = getIneligibleReason(vol.name, disks, volumes, filesystems);

        try {
          const pvc = await ApiProxy.request(
            `/api/v1/namespaces/${encodeURIComponent(
              vm.getNamespace()
            )}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`
          );
          const dvt = dataVolumeTemplates.find(
            (d: { metadata?: { name?: string } }) => d.metadata?.name === pvcName
          );
          const sc =
            pvc?.spec?.storageClassName ||
            dvt?.spec?.storage?.storageClassName ||
            dvt?.spec?.pvc?.storageClassName ||
            '';

          return {
            name: vol.name,
            pvcName,
            storageClassName: sc,
            accessMode: pvc?.spec?.accessModes?.[0] || 'ReadWriteMany',
            volumeMode: pvc?.spec?.volumeMode || 'Filesystem',
            capacity:
              pvc?.status?.capacity?.storage ||
              pvc?.spec?.resources?.requests?.storage ||
              'Unknown',
            eligible: !reason,
            reason: reason || undefined,
          } as VolumeInfo;
        } catch {
          return {
            name: vol.name,
            pvcName,
            storageClassName: '',
            accessMode: '',
            volumeMode: '',
            capacity: 'Unknown',
            eligible: false,
            reason: reason || 'PVC not found',
          } as VolumeInfo;
        }
      })
    );

    Promise.all([fetchSCList, fetchPvcs])
      .then(([, infos]) => {
        setVolumeInfos(infos);

        // Initialize per-volume configs with source values (no RWO→RWX force — CDI can clone any combo)
        const initial: Record<string, VolumeConfig> = {};
        for (const info of infos) {
          if (info.eligible) {
            initial[info.name] = {
              storageClass: info.storageClassName,
              accessMode: info.accessMode,
              volumeMode: info.volumeMode,
            };
          }
        }
        setConfigs(initial);

        if (volumeName) {
          setSelected(new Set([volumeName]));
          setExpanded(new Set([volumeName]));
        } else {
          const eligibleNames = infos.filter(i => i.eligible).map(i => i.name);
          setSelected(new Set(eligibleNames));
          setExpanded(new Set(eligibleNames));
        }
      })
      .finally(() => setFetching(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const eligibleVolumes = volumeInfos.filter(v => v.eligible);
  const allSelected =
    eligibleVolumes.length > 0 && eligibleVolumes.every(v => selected.has(v.name));
  const someSelected = eligibleVolumes.some(v => selected.has(v.name));

  const toggleVolume = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        setExpanded(exp => {
          const e = new Set(exp);
          e.delete(name);
          return e;
        });
      } else {
        next.add(name);
        setExpanded(exp => new Set(exp).add(name));
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
      setExpanded(new Set());
    } else {
      const names = eligibleVolumes.map(v => v.name);
      setSelected(new Set(names));
      setExpanded(new Set(names));
    }
  };

  const toggleExpand = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Bind shared helpers to current storageProfiles state
  const getCombos = (sc: string) => getValidCombos(sc, storageProfiles);
  const getVolumeModes = (sc: string, am: string) => getValidVolumeModes(sc, am, storageProfiles);
  const getAccessModes = (sc: string, vm: string) => getValidAccessModes(sc, vm, storageProfiles);

  const updateConfig = (name: string, field: keyof VolumeConfig, value: string) => {
    setConfigs(prev => {
      const current = prev[name];
      const updated = { ...current, [field]: value };

      if (field === 'storageClass') {
        const combos = getCombos(value);
        const stillValid = combos.some(
          c => c.accessMode === updated.accessMode && c.volumeMode === updated.volumeMode
        );
        if (!stillValid && combos.length > 0) {
          updated.accessMode = combos[0].accessMode;
          updated.volumeMode = combos[0].volumeMode;
        }
      } else if (field === 'accessMode') {
        const validVMs = getVolumeModes(updated.storageClass, value);
        if (validVMs.length > 0 && !validVMs.includes(updated.volumeMode)) {
          updated.volumeMode = validVMs[0];
        }
      } else if (field === 'volumeMode') {
        const validAMs = getAccessModes(updated.storageClass, value);
        if (validAMs.length > 0 && !validAMs.includes(updated.accessMode)) {
          updated.accessMode = validAMs[0];
        }
      }

      return { ...prev, [name]: updated };
    });
  };

  // Check if any selected volume has an invalid storage combo
  const hasInvalidStorageCombo = (() => {
    for (const name of selected) {
      const cfg = configs[name];
      if (!cfg) continue;
      const combos = getCombos(cfg.storageClass);
      if (combos.length === 0) continue;
      const valid = combos.some(
        c => c.accessMode === cfg.accessMode && c.volumeMode === cfg.volumeMode
      );
      if (!valid) return true;
    }
    return false;
  })();

  const selectedWithChanges = getChangedVolumes(selected, volumeInfos, configs);

  const handleClone = async () => {
    if (selectedWithChanges.length === 0) return;
    setLoading(true);
    try {
      // Re-check VM state before submitting
      const freshVm = await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
          vm.getNamespace()
        )}/virtualmachines/${encodeURIComponent(vm.getName())}`
      );
      const currentStatus = (freshVm as { status?: { printableStatus?: string } })?.status
        ?.printableStatus;

      if (currentStatus !== 'Stopped') {
        enqueueSnackbar(
          currentStatus === 'Running'
            ? 'VM is now running — use live migration instead.'
            : `VM is "${currentStatus}" — wait until it is Stopped before cloning.`,
          { variant: 'warning' }
        );
        setLoading(false);
        return;
      }

      const cloneConfigs = selectedWithChanges.map(name => ({
        volumeName: name,
        storageClass: configs[name].storageClass,
        accessMode: configs[name].accessMode,
        volumeMode: configs[name].volumeMode,
      }));

      await vm.cloneVolumes(cloneConfigs);
      const label =
        cloneConfigs.length === 1
          ? `"${cloneConfigs[0].volumeName}"`
          : `${cloneConfigs.length} volumes`;
      enqueueSnackbar(`Volume clone started for ${label} — CDI will copy data in the background`, {
        variant: 'success',
      });
      onClose();
    } catch (error) {
      enqueueSnackbar(`Failed to start volume clone: ${safeError(error, 'clone-volume')}`, {
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth disableScrollLock>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
          {step === 'configure' ? 'Clone Volumes (Offline)' : 'Review Clone'} — {vm.getName()}
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ ml: 1 }}>
          <Icon icon="mdi:close" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {fetching ? (
            <Box display="flex" justifyContent="center" py={2}>
              <CircularProgress size={24} />
            </Box>
          ) : step === 'configure' ? (
            <>
              <Alert severity="info" variant="filled" icon={<Icon icon="mdi:content-copy" />}>
                VM is stopped — volumes will be cloned using CDI. Data is copied in the background
                and the VM spec will be updated to point to the new PVCs.
              </Alert>

              <Typography variant="body2" color="text.secondary">
                Select volumes to clone and configure the target storage for each.
              </Typography>

              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                {eligibleVolumes.length > 1 && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      px: 1,
                      py: 0.5,
                      bgcolor: 'action.hover',
                      borderBottom: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={toggleAll}
                    />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Select all ({eligibleVolumes.length})
                    </Typography>
                  </Box>
                )}

                {volumeInfos.map(vol => {
                  const isSelected = selected.has(vol.name);
                  const isExpanded = expanded.has(vol.name);
                  const cfg = configs[vol.name];
                  const info = vol;

                  return (
                    <Box key={vol.name}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          px: 1,
                          py: 0.5,
                          borderBottom: 1,
                          borderColor: 'divider',
                          opacity: vol.eligible ? 1 : 0.5,
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => toggleVolume(vol.name)}
                          disabled={!vol.eligible}
                        />
                        <Box
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            cursor: vol.eligible && isSelected ? 'pointer' : 'default',
                          }}
                          onClick={() => vol.eligible && isSelected && toggleExpand(vol.name)}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {vol.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {vol.eligible
                              ? `${
                                  vol.storageClassName || 'default'
                                } \u00A0·\u00A0 ${shortAccessMode(vol.accessMode)} \u00A0·\u00A0 ${
                                  vol.volumeMode
                                } \u00A0·\u00A0 ${vol.capacity}`
                              : vol.reason}
                          </Typography>
                        </Box>
                        {vol.eligible && isSelected && (
                          <IconButton size="small" onClick={() => toggleExpand(vol.name)}>
                            <Icon icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
                          </IconButton>
                        )}
                      </Box>

                      <Collapse in={isSelected && isExpanded}>
                        {cfg && (
                          <Box
                            sx={{
                              px: 2,
                              py: 1.5,
                              bgcolor: 'action.hover',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 1.5,
                              borderBottom: 1,
                              borderColor: 'divider',
                            }}
                          >
                            <FormControl fullWidth size="small">
                              <InputLabel>StorageClass</InputLabel>
                              <Select
                                value={cfg.storageClass}
                                label="StorageClass"
                                onChange={e =>
                                  updateConfig(vol.name, 'storageClass', e.target.value)
                                }
                              >
                                {storageClasses.map(sc => (
                                  <MenuItem key={sc} value={sc}>
                                    {sc}
                                    {sc === info.storageClassName ? ' (current)' : ''}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>

                            <Box sx={{ display: 'flex', gap: 1 }}>
                              {(() => {
                                const combos = getCombos(cfg.storageClass);
                                const validAMs = [...new Set(combos.map(c => c.accessMode))];
                                const validVMs = getVolumeModes(cfg.storageClass, cfg.accessMode);
                                const noProfile = combos.length === 0;
                                return (
                                  <>
                                    <FormControl fullWidth size="small">
                                      <InputLabel>Access Mode</InputLabel>
                                      <Select
                                        value={cfg.accessMode}
                                        label="Access Mode"
                                        onChange={e =>
                                          updateConfig(vol.name, 'accessMode', e.target.value)
                                        }
                                      >
                                        {(noProfile ? [...ACCESS_MODES] : validAMs).map(mode => (
                                          <MenuItem key={mode} value={mode}>
                                            {shortAccessMode(mode)}
                                            {mode === info.accessMode ? ' (current)' : ''}
                                          </MenuItem>
                                        ))}
                                      </Select>
                                    </FormControl>

                                    <FormControl fullWidth size="small">
                                      <InputLabel>Volume Mode</InputLabel>
                                      <Select
                                        value={cfg.volumeMode}
                                        label="Volume Mode"
                                        onChange={e =>
                                          updateConfig(vol.name, 'volumeMode', e.target.value)
                                        }
                                      >
                                        {(noProfile ? [...VOLUME_MODES] : validVMs).map(mode => (
                                          <MenuItem key={mode} value={mode}>
                                            {mode}
                                            {mode === info.volumeMode ? ' (current)' : ''}
                                          </MenuItem>
                                        ))}
                                      </Select>
                                    </FormControl>
                                  </>
                                );
                              })()}
                            </Box>
                          </Box>
                        )}
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>

              {hasInvalidStorageCombo && (
                <Alert severity="error" variant="filled">
                  One or more volumes have an invalid Access Mode + Volume Mode combination for the
                  selected StorageClass.
                </Alert>
              )}
            </>
          ) : (
            /* Review step */
            <>
              <Typography variant="body2" color="text.secondary">
                Review the changes below before cloning.
              </Typography>

              {selectedWithChanges.map(name => {
                const info = volumeInfos.find(v => v.name === name);
                const cfg = configs[name];
                if (!info || !cfg) return null;

                const scChanged = cfg.storageClass !== info.storageClassName;
                const amChanged = cfg.accessMode !== info.accessMode;
                const vmChanged = cfg.volumeMode !== info.volumeMode;

                return (
                  <Box
                    key={name}
                    sx={{
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.5,
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {name}
                    </Typography>
                    {scChanged && (
                      <Typography variant="body2">
                        StorageClass: {info.storageClassName || 'default'} →{' '}
                        <strong>{cfg.storageClass}</strong>
                      </Typography>
                    )}
                    {amChanged && (
                      <Typography variant="body2">
                        Access Mode: {shortAccessMode(info.accessMode)} →{' '}
                        <strong>{shortAccessMode(cfg.accessMode)}</strong>
                      </Typography>
                    )}
                    {vmChanged && (
                      <Typography variant="body2">
                        Volume Mode: {info.volumeMode} → <strong>{cfg.volumeMode}</strong>
                      </Typography>
                    )}
                  </Box>
                );
              })}

              {selectedWithChanges.length === 0 && (
                <Alert severity="info" variant="filled">
                  No volumes have changed settings. Go back to modify the target configuration.
                </Alert>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {step === 'configure' ? (
          <Button
            variant="contained"
            endIcon={<Icon icon="mdi:chevron-right" />}
            disabled={selected.size === 0 || hasInvalidStorageCombo}
            onClick={() => setStep('review')}
          >
            Review
          </Button>
        ) : (
          <>
            <Button
              startIcon={<Icon icon="mdi:chevron-left" />}
              onClick={() => setStep('configure')}
            >
              Back
            </Button>
            <Button
              variant="contained"
              disabled={selectedWithChanges.length === 0 || loading}
              onClick={handleClone}
            >
              {loading ? (
                <CircularProgress size={20} />
              ) : selectedWithChanges.length > 1 ? (
                `Clone ${selectedWithChanges.length} volumes`
              ) : (
                'Clone'
              )}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
