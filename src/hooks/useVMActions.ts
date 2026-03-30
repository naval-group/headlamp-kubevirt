import { useSnackbar } from 'notistack';
import { useCallback, useMemo } from 'react';
import VirtualMachine from '../components/VirtualMachines/VirtualMachine';
import { safeError } from '../utils/sanitize';

export interface VMAction {
  id: string;
  label: string;
  icon: string;
  disabled: boolean;
  handler: () => Promise<void>;
}

interface UseVMActionsOptions {
  onAfterProtect?: () => void;
}

export default function useVMActions(
  vm: VirtualMachine | null | undefined,
  options?: UseVMActionsOptions
) {
  const { enqueueSnackbar } = useSnackbar();

  const exec = useCallback(
    async (action: () => Promise<any>, successMsg: string, context: string) => {
      try {
        await action();
        enqueueSnackbar(successMsg, { variant: 'success' });
      } catch (e) {
        enqueueSnackbar(`${context}: ${safeError(e, context)}`, { variant: 'error' });
      }
    },
    [enqueueSnackbar]
  );

  const status = vm?.status?.printableStatus || 'Unknown';
  const isStopped = status === 'Stopped';
  const isStopping = status === 'Stopping';
  const isRunning = status === 'Running';
  const isPaused = vm?.isPaused() ?? false;
  const isLiveMigratable = vm?.isLiveMigratable() ?? false;
  const isProtected = vm?.isDeleteProtected() ?? false;
  const name = vm?.getName() || '';

  const actions: VMAction[] = useMemo(() => {
    if (!vm) return [];
    return [
      {
        id: 'start',
        label: 'Start',
        icon: 'mdi:play',
        disabled: !isStopped,
        handler: () => exec(() => vm.start(), `Starting ${name}`, 'Failed to start'),
      },
      {
        id: 'stop',
        label: 'Stop',
        icon: 'mdi:stop',
        disabled: isStopped || isStopping,
        handler: () => exec(() => vm.stop(), `Stopping ${name}`, 'Failed to stop'),
      },
      {
        id: 'restart',
        label: 'Restart',
        icon: 'mdi:restart',
        disabled: !isRunning,
        handler: () => exec(() => vm.restart(), `Restarting ${name}`, 'Failed to restart'),
      },
      {
        id: 'pause',
        label: isPaused ? 'Unpause' : 'Pause',
        icon: isPaused ? 'mdi:play-pause' : 'mdi:pause',
        disabled: !isRunning && !isPaused,
        handler: () =>
          isPaused
            ? exec(() => vm.unpause(), `Unpausing ${name}`, 'Failed to unpause')
            : exec(() => vm.pause(), `Pausing ${name}`, 'Failed to pause'),
      },
      {
        id: 'force-stop',
        label: 'Force Stop',
        icon: 'mdi:stop-circle',
        disabled: isStopped,
        handler: () => exec(() => vm.forceStop(), `Force stopping ${name}`, 'Failed to force stop'),
      },
      {
        id: 'migrate',
        label: 'Migrate',
        icon: 'mdi:arrow-decision',
        disabled: !isRunning || !isLiveMigratable,
        handler: () => exec(() => vm.migrate(), `Migrating ${name}`, 'Failed to migrate'),
      },
      {
        id: 'protect',
        label: isProtected ? 'Unprotect' : 'Protect',
        icon: isProtected ? 'mdi:lock-open' : 'mdi:lock',
        disabled: false,
        handler: async () => {
          await exec(
            () => vm.setDeleteProtection(!isProtected),
            `${name} ${isProtected ? 'unprotected' : 'protected'} from deletion`,
            `Failed to ${isProtected ? 'unprotect' : 'protect'}`
          );
          options?.onAfterProtect?.();
        },
      },
    ];
  }, [
    vm,
    exec,
    name,
    isStopped,
    isStopping,
    isRunning,
    isPaused,
    isLiveMigratable,
    isProtected,
    options,
  ]);

  const byId = useMemo(() => {
    const map = new Map<string, VMAction>();
    actions.forEach(a => map.set(a.id, a));
    return map;
  }, [actions]);

  return { actions, byId, status, isPaused, isProtected, isLiveMigratable };
}
