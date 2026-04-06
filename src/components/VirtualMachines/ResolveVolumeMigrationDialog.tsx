import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KubeCondition, VMVolume } from '../../types';
import { safeError } from '../../utils/sanitize';
import VirtualMachine from './VirtualMachine';

interface ResolveVolumeMigrationDialogProps {
  open: boolean;
  onClose: () => void;
  vm: InstanceType<typeof VirtualMachine>;
  pendingChanges?: string[];
}

interface VolumeRevertInfo {
  volumeName: string;
  currentDvt: string;
  activePvc: string;
}

type RestartPhase =
  | 'idle'
  | 'restarting'
  | 'stopping'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error';

export default function ResolveVolumeMigrationDialog({
  open,
  onClose,
  vm,
  pendingChanges = [],
}: ResolveVolumeMigrationDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [revertInfo, setRevertInfo] = useState<VolumeRevertInfo | null>(null);
  const [fetching, setFetching] = useState(true);
  const [reverted, setReverted] = useState(false);
  const [restartPhase, setRestartPhase] = useState<RestartPhase>('idle');
  const [restartError, setRestartError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount or dialog close
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const vmStopped =
    vm.status?.printableStatus === 'Stopped' || vm.status?.printableStatus === 'Stopping';

  // Detect if this is a failure case (needs force-stop) vs normal restart
  const hasFailure = !!vm.getVolumesUpdateError() || vm.hasManualRecoveryRequired();

  useEffect(() => {
    if (!open) {
      setReverted(false);
      setRestartPhase('idle');
      setRestartError('');
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    if (vmStopped) {
      setRevertInfo(null);
      setFetching(false);
      setRestartPhase('stopped');
      return;
    }

    setFetching(true);

    ApiProxy.request(
      `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
        vm.getNamespace()
      )}/virtualmachineinstances/${encodeURIComponent(vm.getName())}`
    )
      .then(
        (vmi: {
          status?: {
            volumeStatus?: Array<{
              name: string;
              persistentVolumeClaimInfo?: { claimName: string };
            }>;
          };
        }) => {
          const volumes: VMVolume[] = vm.spec?.template?.spec?.volumes || [];

          for (const vol of volumes) {
            const specDvt = vol.dataVolume?.name || vol.persistentVolumeClaim?.claimName;
            const vmiVol = vmi?.status?.volumeStatus?.find(v => v.name === vol.name);
            const activePvc = vmiVol?.persistentVolumeClaimInfo?.claimName;

            if (specDvt && activePvc && specDvt !== activePvc) {
              setRevertInfo({
                volumeName: vol.name,
                currentDvt: specDvt,
                activePvc,
              });
              return;
            }
          }
          setRevertInfo(null);
        }
      )
      .catch(() => setRevertInfo(null))
      .finally(() => setFetching(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pollVmStatus = useCallback(
    (targetStatus: string, onMatch: () => void) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const vmData = await ApiProxy.request(
            `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
              vm.getNamespace()
            )}/virtualmachines/${encodeURIComponent(vm.getName())}`
          );
          const status = (vmData as { status?: { printableStatus?: string } })?.status
            ?.printableStatus;
          if (status === targetStatus) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            onMatch();
          }
        } catch {
          // Keep polling
        }
      }, 2000);
    },
    [vm]
  );

  // Normal restart
  const handleRestart = async () => {
    setRestartError('');
    setRestartPhase('restarting');
    try {
      await vm.restart();
      pollVmStatus('Running', () => {
        setRestartPhase('running');
        enqueueSnackbar('VM restarted successfully', { variant: 'success' });
      });
    } catch (err) {
      // If normal restart fails (e.g. conflict during migration recovery), fall back to force-stop
      setRestartPhase('error');
      setRestartError('Restart failed — try Force Stop + Start instead');
    }
  };

  // Force stop → start state machine
  const handleForceAction = async () => {
    setRestartError('');

    if (restartPhase === 'idle' || restartPhase === 'error') {
      setRestartPhase('stopping');
      try {
        await vm.forceStop();
        pollVmStatus('Stopped', () => setRestartPhase('stopped'));
      } catch (err) {
        setRestartPhase('error');
        setRestartError('Failed to stop the VM');
      }
    } else if (restartPhase === 'stopped') {
      setRestartPhase('starting');
      try {
        await vm.start();
        pollVmStatus('Running', () => {
          setRestartPhase('running');
          enqueueSnackbar('VM restarted — pending changes applied', { variant: 'success' });
        });
      } catch (err) {
        setRestartPhase('error');
        setRestartError('Failed to start the VM');
      }
    }
  };

  const handleRevert = async () => {
    if (!revertInfo) return;
    setLoading(true);

    try {
      const volumes: VMVolume[] = vm.spec?.template?.spec?.volumes || [];
      const dataVolumeTemplates = vm.spec?.dataVolumeTemplates || [];

      const revertedVolumes = volumes.map((v: VMVolume) => {
        if (v.name !== revertInfo.volumeName) return v;
        return { name: v.name, dataVolume: { name: revertInfo.activePvc } };
      });

      const revertedDvts = dataVolumeTemplates.filter(
        (dvt: { metadata?: { name?: string } }) => dvt.metadata?.name !== revertInfo.currentDvt
      );

      const hasActiveDvt = revertedDvts.some(
        (dvt: { metadata?: { name?: string } }) => dvt.metadata?.name === revertInfo.activePvc
      );

      if (!hasActiveDvt) {
        const pvc = await ApiProxy.request(
          `/api/v1/namespaces/${encodeURIComponent(
            vm.getNamespace()
          )}/persistentvolumeclaims/${encodeURIComponent(revertInfo.activePvc)}`
        );

        let originalSource: Record<string, unknown> = {
          pvc: { name: revertInfo.activePvc, namespace: vm.getNamespace() },
        };
        try {
          const dv = await ApiProxy.request(
            `/apis/cdi.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(
              vm.getNamespace()
            )}/datavolumes/${encodeURIComponent(revertInfo.activePvc)}`
          );
          if (dv?.spec?.source) {
            originalSource = dv.spec.source;
          }
        } catch {
          // DV may not exist
        }

        revertedDvts.push({
          metadata: { name: revertInfo.activePvc },
          spec: {
            source: originalSource,
            storage: {
              accessModes: pvc?.spec?.accessModes || ['ReadWriteMany'],
              volumeMode: pvc?.spec?.volumeMode || 'Block',
              resources: {
                requests: {
                  storage:
                    pvc?.status?.capacity?.storage ||
                    pvc?.spec?.resources?.requests?.storage ||
                    '30Gi',
                },
              },
              storageClassName: pvc?.spec?.storageClassName || '',
            },
          },
        });
      }

      const patch = {
        spec: {
          dataVolumeTemplates: revertedDvts,
          template: { spec: { volumes: revertedVolumes } },
        },
      };

      const result = await vm.patch(patch);
      if (result) {
        vm.jsonData = result;
      }

      try {
        await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(
            vm.getNamespace()
          )}/virtualmachines/${encodeURIComponent(vm.getName())}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json-patch+json' },
            body: JSON.stringify([{ op: 'remove', path: '/spec/updateVolumesStrategy' }]),
          }
        );
      } catch {
        // Not critical
      }

      enqueueSnackbar('Volume migration reverted successfully', { variant: 'success' });
      setReverted(true);
    } catch (error) {
      enqueueSnackbar(`Failed to revert: ${safeError(error, 'revert-volume')}`, {
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const conditions: KubeCondition[] = vm.status?.conditions || [];
  const staleConditions = conditions.filter(
    (c: KubeCondition) =>
      (c.type === 'VolumesChange' || c.type === 'RestartRequired') && c.status === 'True'
  );
  const generationMismatch =
    vm.status?.desiredGeneration !== undefined &&
    vm.status?.observedGeneration !== undefined &&
    vm.status.desiredGeneration !== vm.status.observedGeneration;
  const hasStaleState = staleConditions.length > 0 || generationMismatch;

  const needsRevertFirst = !vmStopped && !!vm.getVolumesUpdateError() && !!revertInfo;
  const restartOnly = !needsRevertFirst && (hasStaleState || vmStopped) && !fetching;

  const isStopping = restartPhase === 'stopping';

  const showRestartUI = reverted || restartOnly;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableScrollLock>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon="mdi:auto-fix" />
        {showRestartUI
          ? `Apply Pending Changes — ${vm.getName()}`
          : `Resolve Failed Volume Migration — ${vm.getName()}`}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {!showRestartUI ? (
            <>
              <Alert severity="error" variant="filled" icon={<Icon icon="mdi:alert-circle" />}>
                A volume migration failed. The VM spec references a volume that differs from what is
                actually running. This must be resolved before any new migration can be started.
              </Alert>

              {fetching ? (
                <Box display="flex" justifyContent="center" py={2}>
                  <CircularProgress size={24} />
                </Box>
              ) : revertInfo ? (
                <>
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.5,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Mismatch detected on volume: {revertInfo.volumeName}
                    </Typography>
                    <Typography variant="body2">
                      VM spec points to: <strong>{revertInfo.currentDvt}</strong>
                    </Typography>
                    <Typography variant="body2">
                      VM is actually running on: <strong>{revertInfo.activePvc}</strong>
                    </Typography>
                  </Box>

                  <Typography variant="body2" color="text.secondary">
                    Clicking <strong>Revert</strong> will update the VM spec to match what is
                    actually running, removing the failed migration target.
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No volume mismatch detected. The error may have resolved itself.
                </Typography>
              )}
            </>
          ) : (
            <>
              {reverted && (
                <Alert severity="success" variant="filled" icon={<Icon icon="mdi:check-circle" />}>
                  Volume spec reverted successfully. A restart is needed to apply the changes.
                </Alert>
              )}

              {restartPhase !== 'running' && (
                <>
                  <Alert severity="warning" variant="filled">
                    {vmStopped && restartPhase === 'stopped'
                      ? 'The VM is stopped. Start it to apply pending changes.'
                      : 'A restart is required to apply pending configuration changes.'}
                  </Alert>

                  {pendingChanges.length > 0 && (
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        Pending changes
                      </Typography>
                      {pendingChanges.map(change => (
                        <Typography key={change} variant="body2">
                          {change}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </>
              )}

              {restartError && (
                <Alert severity="error" variant="filled">
                  {restartError}
                </Alert>
              )}

              {restartPhase === 'starting' && (
                <Typography variant="body2" color="text.secondary">
                  VM is starting — you may now close this dialog.
                </Typography>
              )}

              {restartPhase === 'running' && (
                <Alert severity="success" variant="filled">
                  VM is running. Pending changes have been applied.
                </Alert>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isStopping}>
          {restartPhase === 'running' ? 'Done' : showRestartUI ? 'Close' : 'Cancel'}
        </Button>
        {!showRestartUI && (
          <Button
            onClick={handleRevert}
            variant="contained"
            disabled={!revertInfo || loading}
            startIcon={loading ? <CircularProgress size={16} /> : <Icon icon="mdi:undo" />}
          >
            Revert
          </Button>
        )}
        {showRestartUI && restartPhase !== 'running' && (
          <>
            {/* Normal restart — for non-failure cases */}
            {!hasFailure && restartPhase === 'idle' && (
              <Button
                onClick={handleRestart}
                variant="contained"
                color="primary"
                startIcon={<Icon icon="mdi:restart" />}
              >
                Restart
              </Button>
            )}

            {/* Restarting spinner */}
            {restartPhase === 'restarting' && (
              <Button variant="contained" disabled startIcon={<CircularProgress size={16} />}>
                Restarting...
              </Button>
            )}

            {/* Force stop — for failure cases, or if normal restart failed, or mid-flow */}
            {(hasFailure ||
              restartPhase === 'error' ||
              restartPhase === 'stopping' ||
              restartPhase === 'stopped') &&
              restartPhase !== 'restarting' && (
                <Button
                  onClick={handleForceAction}
                  variant="contained"
                  color={restartPhase === 'stopped' ? 'success' : 'error'}
                  disabled={isStopping || restartPhase === 'starting'}
                  startIcon={
                    isStopping || restartPhase === 'starting' ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : restartPhase === 'stopped' ? (
                      <Icon icon="mdi:play" />
                    ) : (
                      <Icon icon="mdi:stop" />
                    )
                  }
                >
                  {isStopping
                    ? 'Stopping...'
                    : restartPhase === 'stopped'
                    ? 'Start VM'
                    : restartPhase === 'starting'
                    ? 'Starting...'
                    : 'Force Stop'}
                </Button>
              )}

            {/* Starting spinner (after stopped → start) */}
            {restartPhase === 'starting' && (
              <Button
                variant="contained"
                color="info"
                disabled
                startIcon={<CircularProgress size={16} color="inherit" />}
              >
                Starting...
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
