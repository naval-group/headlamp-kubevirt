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
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useRef, useState } from 'react';
import { KubeListResponse, VMDisk, VMVolume } from '../../types';
import { safeError } from '../../utils/sanitize';
import { findCondition } from '../../utils/statusColors';
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

interface MigrateVolumeDialogProps {
  open: boolean;
  onClose: () => void;
  vm: InstanceType<typeof VirtualMachine>;
  volumeName?: string;
}

type Step = 'configure' | 'review';

export default function MigrateVolumeDialog({
  open,
  onClose,
  vm,
  volumeName,
}: MigrateVolumeDialogProps) {
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
  const [ackRisk, setAckRisk] = useState(false);
  const [snapshotState, setSnapshotState] = useState<
    'idle' | 'creating' | 'polling' | 'done' | 'error'
  >('idle');
  const [snapshotError, setSnapshotError] = useState('');
  const snapshotPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup snapshot polling on unmount
  useEffect(() => {
    return () => {
      if (snapshotPollRef.current) clearInterval(snapshotPollRef.current);
    };
  }, []);

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
    setAckRisk(false);
    setSnapshotState('idle');
    setSnapshotError('');
    setShowChecks(false);
    setNetworkFixed(false);
    setFixingNetwork(false);
    if (snapshotPollRef.current) {
      clearInterval(snapshotPollRef.current);
      snapshotPollRef.current = null;
    }
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

    // Wait for both fetches so we can apply RWO→RWX force with profile data
    Promise.all([fetchSCList, fetchPvcs])
      .then(([profiles, infos]) => {
        setVolumeInfos(infos);

        // Helper to get valid combos from fetched profiles (not state, which isn't set yet)
        const getCombos = (sc: string): Array<{ accessMode: string; volumeMode: string }> => {
          const sets = profiles[sc] || [];
          const combos: Array<{ accessMode: string; volumeMode: string }> = [];
          for (const set of sets) {
            for (const am of set.accessModes) {
              combos.push({ accessMode: am, volumeMode: set.volumeMode });
            }
          }
          return combos;
        };

        // Initialize per-volume configs with source values, applying RWO→RWX force
        const initial: Record<string, VolumeConfig> = {};
        for (const info of infos) {
          if (info.eligible) {
            let cfg: VolumeConfig = {
              storageClass: info.storageClassName,
              accessMode: info.accessMode,
              volumeMode: info.volumeMode,
            };
            // Force RWO sources to RWX destination
            if (info.accessMode === 'ReadWriteOnce') {
              const combos = getCombos(info.storageClassName);
              const rwxSameVM = combos.find(
                c => c.accessMode === 'ReadWriteMany' && c.volumeMode === info.volumeMode
              );
              if (rwxSameVM) {
                cfg = { ...cfg, accessMode: 'ReadWriteMany' };
              } else {
                const anyRwx = combos.find(c => c.accessMode === 'ReadWriteMany');
                if (anyRwx) {
                  cfg = { ...cfg, accessMode: 'ReadWriteMany', volumeMode: anyRwx.volumeMode };
                }
              }
            }
            initial[info.name] = cfg;
          }
        }
        setConfigs(initial);

        // Pre-select: specific volume if passed, otherwise all eligible
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

  // RWO source → destination must be RWX (RWO→RWO requires intermediate RWX step)
  const needsForceRwx = (volName: string, accessMode: string): boolean => {
    const info = volumeInfos.find(v => v.name === volName);
    return !!info && info.accessMode === 'ReadWriteOnce' && accessMode === 'ReadWriteOnce';
  };

  const applyRwxForce = (volName: string, updated: VolumeConfig): VolumeConfig => {
    if (needsForceRwx(volName, updated.accessMode)) {
      const combos = getCombos(updated.storageClass);
      const rwxCombo = combos.find(
        c => c.accessMode === 'ReadWriteMany' && c.volumeMode === updated.volumeMode
      );
      if (rwxCombo) {
        return { ...updated, accessMode: 'ReadWriteMany' };
      }
      const anyRwx = combos.find(c => c.accessMode === 'ReadWriteMany');
      if (anyRwx) {
        return { ...updated, accessMode: 'ReadWriteMany', volumeMode: anyRwx.volumeMode };
      }
    }
    return updated;
  };

  const updateConfig = (name: string, field: keyof VolumeConfig, value: string) => {
    setConfigs(prev => {
      const current = prev[name];
      let updated = { ...current, [field]: value };

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

      // Force RWX when source is RWO
      updated = applyRwxForce(name, updated);

      return { ...prev, [name]: updated };
    });
  };

  const handleSnapshot = async () => {
    const name = `${vm.getName()}-snapshot-${Date.now()}`;
    const ns = vm.getNamespace();
    setSnapshotState('creating');
    setSnapshotError('');
    try {
      await ApiProxy.request(
        `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
          ns
        )}/virtualmachinesnapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiVersion: 'snapshot.kubevirt.io/v1beta1',
            kind: 'VirtualMachineSnapshot',
            metadata: { name, namespace: ns },
            spec: {
              source: { apiGroup: 'kubevirt.io', kind: 'VirtualMachine', name: vm.getName() },
            },
          }),
        }
      );
      setSnapshotState('polling');
      // Poll until readyToUse (max 5 minutes)
      let attempts = 0;
      const maxAttempts = 150; // 5min at 2s interval
      if (snapshotPollRef.current) clearInterval(snapshotPollRef.current);
      snapshotPollRef.current = setInterval(async () => {
        attempts++;
        if (attempts >= maxAttempts) {
          if (snapshotPollRef.current) clearInterval(snapshotPollRef.current);
          snapshotPollRef.current = null;
          setSnapshotState('error');
          setSnapshotError('Snapshot timed out after 5 minutes');
          return;
        }
        try {
          const snap = await ApiProxy.request(
            `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
              ns
            )}/virtualmachinesnapshots/${encodeURIComponent(name)}`
          );
          if ((snap as { status?: { readyToUse?: boolean } })?.status?.readyToUse) {
            if (snapshotPollRef.current) clearInterval(snapshotPollRef.current);
            snapshotPollRef.current = null;
            setSnapshotState('done');
            enqueueSnackbar(`Snapshot "${name}" ready`, { variant: 'success' });
          }
          const phase = (snap as { status?: { phase?: string } })?.status?.phase;
          if (phase === 'Failed' || phase === 'Error') {
            if (snapshotPollRef.current) clearInterval(snapshotPollRef.current);
            snapshotPollRef.current = null;
            setSnapshotState('error');
            setSnapshotError('Snapshot failed');
          }
        } catch {
          // keep polling
        }
      }, 2000);
    } catch (e) {
      setSnapshotState('error');
      setSnapshotError(safeError(e, 'create-snapshot'));
    }
  };

  const vmRunning = vm.status?.printableStatus === 'Running';
  const volumesChangePending = vm.hasVolumesChangePending();
  const volumesUpdateError = vm.getVolumesUpdateError();

  // Pre-flight checks for volume migration
  const conditions: Array<{ type: string; status: string; reason?: string; message?: string }> =
    vm.status?.conditions || [];
  const liveMigratable = findCondition(conditions, 'LiveMigratable');
  const isLiveMigratable = liveMigratable?.status === 'True';
  const migratableReason = liveMigratable?.reason || '';
  const migratableMessage = liveMigratable?.message || '';

  // Parse individual blockers from the reason/message
  const hasDisksBlocker =
    migratableReason === 'DisksNotLiveMigratable' || migratableMessage.includes('not shared');
  const hasHostDeviceBlocker =
    migratableReason === 'HostDeviceNotLiveMigratable' ||
    migratableMessage.includes('HostDeviceNotLiveMigratable');

  // Network analysis — detect the specific situation
  const specNetworks = vm.spec?.template?.spec?.networks || [];
  const autoAttachPod = vm.spec?.template?.spec?.domain?.devices?.autoattachPodInterface;
  const templateAnnotations = vm.spec?.template?.metadata?.annotations || {};
  const hasAllowAnnotation =
    templateAnnotations['kubevirt.io/allow-pod-bridge-network-live-migration'] === 'true';
  const specInterfaces = vm.spec?.template?.spec?.domain?.devices?.interfaces || [];

  // Detect network blocker cases
  const noNetworksDefined = specNetworks.length === 0;
  const autoAttachNotDisabled = autoAttachPod !== false;
  const hasBridgeBinding = specInterfaces.some(
    (iface: { bridge?: Record<string, unknown> }) => iface.bridge !== undefined
  );

  // Case 1: No networks defined + autoattach not disabled + no annotation
  //   → KubeVirt silently adds pod network, which blocks migration
  const hiddenPodNetwork = noNetworksDefined && autoAttachNotDisabled && !hasAllowAnnotation;

  // Case 2: Explicit bridge binding without annotation
  const explicitBridgeNoAnnotation = hasBridgeBinding && !hasAllowAnnotation;

  // Network blocker from condition OR from spec analysis
  const hasNetworkBlocker =
    migratableReason === 'InterfaceNotLiveMigratable' ||
    migratableMessage.includes('InterfaceNotLiveMigratable') ||
    hiddenPodNetwork ||
    explicitBridgeNoAnnotation;

  // Determine network detail and fix type
  type NetworkFixType = 'hidden-pod' | 'bridge' | 'none';
  let networkFixType: NetworkFixType = 'none';
  let networkDetail = '';
  if (hiddenPodNetwork) {
    networkFixType = 'hidden-pod';
    networkDetail =
      'No network is defined, but KubeVirt silently attaches a default pod network. This hidden interface blocks live migration.';
  } else if (explicitBridgeNoAnnotation) {
    networkFixType = 'bridge';
    networkDetail = 'A bridge-type network binding is configured, which blocks live migration.';
  } else if (hasNetworkBlocker) {
    networkDetail = 'Pod network interface is not configured for live migration.';
  }

  // If not migratable and not any known reason, flag as unknown blocker
  const hasOtherBlocker =
    !isLiveMigratable && !hasDisksBlocker && !hasNetworkBlocker && !hasHostDeviceBlocker;

  // Only DisksNotLiveMigratable is acceptable — all other blockers must be resolved
  const onlyDiskBlocker =
    !isLiveMigratable &&
    hasDisksBlocker &&
    !hasNetworkBlocker &&
    !hasHostDeviceBlocker &&
    !hasOtherBlocker;
  const migrationSafe = isLiveMigratable || onlyDiskBlocker;

  // Fix network blocker — annotate both VMI (immediate) and VM template (persistent)
  const [fixingNetwork, setFixingNetwork] = useState(false);
  const [networkFixed, setNetworkFixed] = useState(false);

  const handleFixNetwork = async (fixType: NetworkFixType) => {
    if (fixType === 'none') return;
    setFixingNetwork(true);
    try {
      // Both 'hidden-pod' and 'bridge' use the same fix: allow annotation
      if (vmRunning) {
        await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
            vm.getNamespace()
          )}/virtualmachineinstances/${encodeURIComponent(vm.getName())}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/merge-patch+json' },
            body: JSON.stringify({
              metadata: {
                annotations: { 'kubevirt.io/allow-pod-bridge-network-live-migration': 'true' },
              },
            }),
          }
        );
      }
      await vm.patch({
        spec: {
          template: {
            metadata: {
              annotations: { 'kubevirt.io/allow-pod-bridge-network-live-migration': 'true' },
            },
          },
        },
      });
      setNetworkFixed(true);
      enqueueSnackbar('Network migration annotation applied', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(`Failed to fix network: ${safeError(e, 'fix-network')}`, {
        variant: 'error',
      });
    } finally {
      setFixingNetwork(false);
    }
  };

  interface PreflightCheck {
    label: string;
    passed: boolean;
    detail?: string;
    fixType?: NetworkFixType;
  }

  const preflightChecks: PreflightCheck[] = [
    {
      label: 'VM is running',
      passed: vmRunning,
      detail: vmRunning ? undefined : `Status: ${vm.status?.printableStatus || 'Unknown'}`,
    },
    {
      label: networkFixed
        ? 'Network migration allowed (just fixed)'
        : hasNetworkBlocker
        ? 'Network blocks live migration'
        : 'No network migration blockers',
      passed: !hasNetworkBlocker || networkFixed,
      detail: networkFixed
        ? 'Annotation applied — migration is now allowed'
        : networkDetail || undefined,
      fixType: hasNetworkBlocker && !networkFixed ? networkFixType : undefined,
    },
    {
      label: 'No host device blockers',
      passed: !hasHostDeviceBlocker,
      detail: hasHostDeviceBlocker
        ? 'Host devices (GPU, USB passthrough) prevent live migration. Remove the device to enable migration.'
        : undefined,
    },
    {
      label: 'Disks eligible for migration',
      passed: hasDisksBlocker || isLiveMigratable,
      detail: hasDisksBlocker
        ? 'One or more PVCs are not RWX — this is what migration will fix'
        : undefined,
    },
    ...(() => {
      // Check if any selected volume has an invalid storage combo
      const invalidVolumes: string[] = [];
      for (const name of selected) {
        const cfg = configs[name];
        if (!cfg) continue;
        const combos = getCombos(cfg.storageClass);
        if (combos.length === 0) continue; // No profile data — can't validate
        const valid = combos.some(
          c => c.accessMode === cfg.accessMode && c.volumeMode === cfg.volumeMode
        );
        if (!valid) invalidVolumes.push(name);
      }
      if (invalidVolumes.length === 0) return [];
      return [
        {
          label: 'Invalid storage configuration',
          passed: false,
          detail: `${invalidVolumes.join(
            ', '
          )}: selected Access Mode + Volume Mode combination is not supported by the target StorageClass.`,
        },
      ];
    })(),
  ];

  const [showChecks, setShowChecks] = useState(false);
  const hasInvalidStorageCombo = preflightChecks.some(
    c => c.label === 'Invalid storage configuration' && !c.passed
  );
  const effectiveMigrationSafe =
    vmRunning && (migrationSafe || networkFixed) && !hasInvalidStorageCombo;

  // Auto-expand checks when they fail
  useEffect(() => {
    if (!fetching && !migrationSafe) {
      setShowChecks(true);
    }
  }, [fetching, migrationSafe]);

  // Check if any selected volume has a changed config
  const selectedWithChanges = getChangedVolumes(selected, volumeInfos, configs);

  const handleMigrate = async () => {
    if (selectedWithChanges.length === 0) return;
    setLoading(true);
    try {
      const migrationConfigs = selectedWithChanges.map(name => ({
        volumeName: name,
        storageClass: configs[name].storageClass,
        accessMode: configs[name].accessMode,
        volumeMode: configs[name].volumeMode,
      }));

      await vm.migrateVolumes(migrationConfigs);
      const label =
        migrationConfigs.length === 1
          ? `"${migrationConfigs[0].volumeName}"`
          : `${migrationConfigs.length} volumes`;
      enqueueSnackbar(`Volume migration started for ${label}`, { variant: 'success' });
      onClose();
    } catch (error) {
      enqueueSnackbar(`Failed to start volume migration: ${safeError(error, 'migrate-volume')}`, {
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
          {step === 'configure' ? 'Migrate Volumes' : 'Review Migration'} — {vm.getName()}
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
              <Alert
                severity={
                  snapshotState === 'done'
                    ? 'success'
                    : snapshotState === 'error'
                    ? 'error'
                    : 'warning'
                }
                variant="filled"
                icon={
                  snapshotState === 'done' ? (
                    <Icon icon="mdi:check-circle" />
                  ) : snapshotState === 'error' ? (
                    <Icon icon="mdi:alert-circle" />
                  ) : (
                    <Icon icon="mdi:alert-outline" />
                  )
                }
                action={
                  snapshotState === 'idle' ? (
                    <Button
                      size="small"
                      color="inherit"
                      variant="outlined"
                      startIcon={<Icon icon="mdi:camera" />}
                      onClick={handleSnapshot}
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      Snapshot now
                    </Button>
                  ) : snapshotState === 'creating' || snapshotState === 'polling' ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : null
                }
              >
                {snapshotState === 'idle' &&
                  'Volume migration can be destructive. Take a snapshot before proceeding.'}
                {snapshotState === 'creating' && 'Creating snapshot...'}
                {snapshotState === 'polling' && 'Snapshot created, waiting for it to be ready...'}
                {snapshotState === 'done' &&
                  'Snapshot ready. You can safely proceed with migration.'}
                {snapshotState === 'error' && (snapshotError || 'Snapshot failed.')}
              </Alert>

              {/* Pre-flight checklist */}
              <Box
                sx={{
                  border: 1,
                  borderColor: effectiveMigrationSafe ? 'success.main' : 'error.main',
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    px: 1.5,
                    py: 1,
                    bgcolor: effectiveMigrationSafe ? '#2e7d32' : 'error.main',
                    color: effectiveMigrationSafe ? '#fff' : 'white',
                    cursor: 'pointer',
                  }}
                  onClick={() => setShowChecks(!showChecks)}
                >
                  <Icon
                    icon={effectiveMigrationSafe ? 'mdi:check-decagram' : 'mdi:alert-decagram'}
                    style={{ marginRight: 8, fontSize: 20 }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                    {effectiveMigrationSafe
                      ? `Pre-flight checks passed (${
                          preflightChecks.filter(c => c.passed).length
                        }/${preflightChecks.length})`
                      : `Pre-flight checks failed — migration will not work`}
                  </Typography>
                  <Icon icon={showChecks ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
                </Box>
                <Collapse in={showChecks}>
                  <Box sx={{ p: 1 }}>
                    {preflightChecks.map(check => (
                      <Box
                        key={check.label}
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 1,
                          py: 0.5,
                        }}
                      >
                        <Icon
                          icon={check.passed ? 'mdi:check-circle' : 'mdi:close-circle'}
                          style={{
                            color: check.passed ? '#4caf50' : '#f44336',
                            fontSize: 18,
                            marginTop: 2,
                            flexShrink: 0,
                          }}
                        />
                        <Box sx={{ flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {check.label}
                            </Typography>
                            {check.fixType && check.fixType !== 'none' && (
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                disabled={fixingNetwork}
                                startIcon={
                                  fixingNetwork ? (
                                    <CircularProgress size={12} />
                                  ) : (
                                    <Icon icon="mdi:wrench" />
                                  )
                                }
                                onClick={() => handleFixNetwork(check.fixType!)}
                                sx={{ minHeight: 24, py: 0, px: 1, fontSize: '0.7rem' }}
                              >
                                {fixingNetwork ? 'Fixing...' : 'Fix now'}
                              </Button>
                            )}
                          </Box>
                          {check.detail && (
                            <Typography variant="caption" color="text.secondary" component="div">
                              {check.detail}
                              {check.fixType === 'hidden-pod' && !networkFixed && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  component="div"
                                  sx={{ mt: 0.5 }}
                                >
                                  <strong>Fix:</strong> Adds{' '}
                                  <code>kubevirt.io/allow-pod-bridge-network-live-migration</code>{' '}
                                  annotation to allow migration with the default pod network.
                                </Typography>
                              )}
                              {check.fixType === 'bridge' && !networkFixed && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  component="div"
                                  sx={{ mt: 0.5 }}
                                >
                                  <strong>Fix:</strong> Adds{' '}
                                  <code>kubevirt.io/allow-pod-bridge-network-live-migration</code>{' '}
                                  annotation to allow migration with bridge binding.
                                </Typography>
                              )}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Collapse>
              </Box>

              <Typography variant="body2" color="text.secondary">
                Select volumes to migrate and configure the target storage for each.
              </Typography>

              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                {/* Select all */}
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

                      {/* Per-volume config */}
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
                                {storageClasses.map(sc => {
                                  const sourceIsRwo = info.accessMode === 'ReadWriteOnce';
                                  const scCombos = getCombos(sc);
                                  const hasRwx = scCombos.some(
                                    c => c.accessMode === 'ReadWriteMany'
                                  );
                                  const disabledSc = sourceIsRwo && scCombos.length > 0 && !hasRwx;
                                  return (
                                    <MenuItem key={sc} value={sc} disabled={disabledSc}>
                                      {sc}
                                      {sc === info.storageClassName ? ' (current)' : ''}
                                      {disabledSc ? ' (no RWX)' : ''}
                                    </MenuItem>
                                  );
                                })}
                              </Select>
                            </FormControl>

                            <Box sx={{ display: 'flex', gap: 1 }}>
                              {(() => {
                                const combos = getCombos(cfg.storageClass);
                                const validAMs = [...new Set(combos.map(c => c.accessMode))];
                                const validVMs = getVolumeModes(cfg.storageClass, cfg.accessMode);
                                const noProfile = combos.length === 0;
                                const sourceIsRwo = info.accessMode === 'ReadWriteOnce';
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
                                        {(noProfile ? [...ACCESS_MODES] : validAMs).map(mode => {
                                          const disabledRwo =
                                            sourceIsRwo && mode === 'ReadWriteOnce';
                                          return (
                                            <MenuItem
                                              key={mode}
                                              value={mode}
                                              disabled={disabledRwo}
                                            >
                                              {shortAccessMode(mode)}
                                              {mode === info.accessMode ? ' (current)' : ''}
                                            </MenuItem>
                                          );
                                        })}
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

                            {/* RWO→RWX force info tip */}
                            {info.accessMode === 'ReadWriteOnce' &&
                              cfg.accessMode === 'ReadWriteMany' && (
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                                  <Tooltip title="KubeVirt volume migration requires at least one side (source or destination) to be RWX. Since the source is RWO, the destination is forced to RWX. You can migrate back to RWO afterwards.">
                                    <Box
                                      sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        flexShrink: 0,
                                        mt: '1px',
                                      }}
                                    >
                                      <Icon
                                        icon="mdi:information-outline"
                                        style={{ fontSize: 16, color: '#1976d2' }}
                                      />
                                    </Box>
                                  </Tooltip>
                                  <Typography variant="caption" color="text.secondary">
                                    Source is RWO — destination forced to RWX. An intermediate RWX
                                    step is required for RWO→RWO migration.
                                  </Typography>
                                </Box>
                              )}
                          </Box>
                        )}
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>

              {/* Warnings */}
              {volumesUpdateError && <Alert severity="error">{volumesUpdateError}</Alert>}

              {volumesChangePending &&
                !volumesUpdateError &&
                (vm.isVolumeMigrationInProgress() || vm.status?.printableStatus === 'Migrating' ? (
                  <Alert
                    severity="info"
                    variant="filled"
                    icon={<CircularProgress size={18} color="inherit" />}
                  >
                    A volume migration is in progress. Please wait for it to complete before
                    starting another.
                  </Alert>
                ) : (
                  <Alert severity="warning" variant="filled">
                    A previous volume migration is still pending. Chaining migrations may fail —
                    KubeVirt recommends restarting the VM first.
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={ackRisk}
                          onChange={e => setAckRisk(e.target.checked)}
                          size="small"
                          sx={{ color: 'inherit', '&.Mui-checked': { color: 'inherit' } }}
                        />
                      }
                      label={
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          I understand the risk
                        </Typography>
                      }
                      sx={{ mt: 1, ml: 0 }}
                    />
                  </Alert>
                ))}
            </>
          ) : (
            /* Review step */
            <>
              <Typography variant="body2" color="text.secondary">
                Review the changes below before applying.
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
                    {!scChanged && !amChanged && !vmChanged && (
                      <Typography variant="body2" color="text.secondary">
                        No changes
                      </Typography>
                    )}
                  </Box>
                );
              })}

              {/* Warn RWX → RWO */}
              {selectedWithChanges.some(name => {
                const info = volumeInfos.find(v => v.name === name);
                const cfg = configs[name];
                return info?.accessMode === 'ReadWriteMany' && cfg?.accessMode === 'ReadWriteOnce';
              }) && (
                <Alert severity="warning" variant="filled">
                  RWX → RWO: the VM will be migrated to another node during the copy. Once complete,
                  the VM will no longer be live-migratable from its new node.
                </Alert>
              )}

              {selectedWithChanges.length === 0 && (
                <Alert severity="info">
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
            disabled={
              selected.size === 0 ||
              !effectiveMigrationSafe ||
              (volumesChangePending &&
                (vm.isVolumeMigrationInProgress() ||
                  vm.status?.printableStatus === 'Migrating' ||
                  !ackRisk))
            }
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
              onClick={handleMigrate}
            >
              {loading ? (
                <CircularProgress size={20} />
              ) : selectedWithChanges.length > 1 ? (
                `Migrate ${selectedWithChanges.length} volumes`
              ) : (
                'Migrate'
              )}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
