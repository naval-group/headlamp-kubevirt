import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useCallback, useState } from 'react';
import { safeError } from '../../utils/sanitize';
import ConfirmDialog from '../common/ConfirmDialog';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import ConditionsTab from './ConditionsTab';
import EventsTab from './EventsTab';
import GuestInfoTab from './GuestInfoTab';
import MemoryDumpTab from './MemoryDumpTab';
import MetricsDashboardTab from './MetricsDashboardTab';
import PodLogsTab from './PodLogsTab';
import PrometheusQuerier from './PrometheusQuerier';
import VirtLauncherExec from './VirtLauncherExec';
import VMShellTab from './VMShellTab';

function getStatusColor(phase: string): string {
  switch (phase?.toLowerCase()) {
    case 'running':
      return '#3e8635';
    case 'succeeded':
      return '#3e8635';
    case 'paused':
      return '#f0ab00';
    case 'scheduling':
    case 'scheduled':
    case 'starting':
      return '#2196f3';
    case 'failed':
    case 'crashloopbackoff':
      return '#c9190b';
    default:
      return '#6a6e73';
  }
}

interface VMDoctorDialogProps {
  open: boolean;
  onClose: () => void;
  vmName: string;
  namespace: string;
  vmiData?: Record<string, any> | null;
  vmItem?: VirtualMachine | null;
  podName: string;
}

// Tab indices
const TAB_GUEST_INFO = 0;
const TAB_CONDITIONS = 1;
const TAB_EVENTS = 2;
const TAB_METRICS = 3;
const TAB_QUERIER = 4;
const TAB_LOGS = 5;
const TAB_VM_SHELL = 6;
const TAB_POD_SHELL = 7;
const TAB_MEMDUMP = 8;

interface TabDef {
  icon: string;
  label: string;
  disabled: boolean;
  reason: string;
}

function tabLabel(tab: TabDef) {
  return (
    <Tooltip title={tab.disabled ? tab.reason : ''} arrow placement="bottom">
      <Box display="flex" alignItems="center" gap={0.5}>
        {tab.label}
        {tab.disabled && (
          <Icon icon="mdi:information-outline" width={14} style={{ opacity: 0.7 }} />
        )}
      </Box>
    </Tooltip>
  );
}

export default function VMDoctorDialog({
  open,
  onClose,
  vmName,
  namespace,
  vmiData,
  vmItem,
  podName,
}: VMDoctorDialogProps) {
  const [activeTab, setActiveTab] = useState(TAB_CONDITIONS);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCleanupPrompt, setShowCleanupPrompt] = useState(false);
  const [analysisPods, setAnalysisPods] = useState<string[]>([]);
  const { enqueueSnackbar } = useSnackbar();

  // Intercept close: check for running analysis pods before closing
  const handleClose = useCallback(async () => {
    try {
      const res = await ApiProxy.request(
        `/api/v1/namespaces/${namespace}/pods?labelSelector=app%3Dvolatility3-analysis`
      );
      const pods = (res?.items || [])
        .filter((p: any) => !p.metadata.deletionTimestamp && p.status?.phase === 'Running')
        .map((p: any) => p.metadata.name);
      if (pods.length > 0) {
        setAnalysisPods(pods);
        setShowCleanupPrompt(true);
        return;
      }
    } catch {
      /* ignore — just close */
    }
    onClose();
  }, [namespace, onClose]);

  const cleanupAndClose = async () => {
    setShowCleanupPrompt(false);
    for (const pod of analysisPods) {
      try {
        await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${pod}`, {
          method: 'DELETE',
          isJSON: false,
        });
      } catch {
        /* ignore */
      }
    }
    enqueueSnackbar(`Cleaning up ${analysisPods.length} analysis pod(s)`, { variant: 'info' });
    onClose();
  };

  const keepAndClose = () => {
    setShowCleanupPrompt(false);
    onClose();
  };

  const vmiPhase = vmiData?.status?.phase || 'Stopped';
  const vmStatus = vmItem?.status?.printableStatus || vmiPhase;
  const isVMShell = activeTab === TAB_VM_SHELL;
  const isPodShell = activeTab === TAB_POD_SHELL;
  const isLogs = activeTab === TAB_LOGS;
  const isMemDump = activeTab === TAB_MEMDUMP;
  const isShellTab = isVMShell || isPodShell;
  const isFixedLayout = isShellTab || isLogs || isMemDump;

  const isRunning = vmiPhase === 'Running';
  const hasPod = !!podName;
  const hasAgent = (vmiData?.status?.conditions || []).some(
    (c: any) => c.type === 'AgentConnected' && c.status === 'True'
  );

  const tabs: TabDef[] = [
    {
      icon: 'mdi:card-account-details',
      label: 'Guest Info',
      disabled: !isRunning || !hasAgent,
      reason: !isRunning
        ? 'VM is not running. Guest info requires an active VM.'
        : 'QEMU Guest Agent not installed. Install qemu-guest-agent inside the VM.',
    },
    {
      icon: 'mdi:clipboard-check-outline',
      label: 'Conditions',
      disabled: false,
      reason: '',
    },
    {
      icon: 'mdi:timeline-alert',
      label: 'Events',
      disabled: false,
      reason: '',
    },
    {
      icon: 'mdi:chart-line',
      label: 'Metrics',
      disabled: !isRunning,
      reason: 'VM is not running. Metrics require an active VM.',
    },
    {
      icon: 'mdi:database-search',
      label: 'Querier',
      disabled: !isRunning,
      reason: 'VM is not running. Querier requires an active VM.',
    },
    {
      icon: 'mdi:text-box-outline',
      label: 'Logs',
      disabled: !hasPod,
      reason: 'No virt-launcher pod found. Logs require a running or recently active VM.',
    },
    {
      icon: 'mdi:monitor',
      label: 'VM Shell',
      disabled: !isRunning,
      reason: 'VM is not running. VM Shell requires an active VM with VNC/Serial access.',
    },
    {
      icon: 'mdi:console-line',
      label: 'Pod Shell',
      disabled: !hasPod,
      reason: 'No virt-launcher pod found. Pod Shell requires a running VM.',
    },
    {
      icon: 'mdi:memory',
      label: 'Memory Dump',
      disabled: false,
      reason: '',
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={false}
      fullWidth
      TransitionProps={{ unmountOnExit: true }}
      PaperProps={{
        sx: {
          width: '94vw',
          maxWidth: '94vw',
          height: '96vh',
          maxHeight: '96vh',
          margin: '2vh 3vw',
          transition: 'all 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          pb: 1,
        }}
      >
        <Icon icon="mdi:stethoscope" width={24} />
        <Typography variant="h6" fontWeight={600} component="span">
          VM Doctor
        </Typography>
        <Typography variant="body1" color="text.secondary" component="span">
          {namespace}/{vmName}
        </Typography>
        <Chip
          label={vmStatus}
          size="small"
          sx={{
            bgcolor: getStatusColor(vmiPhase),
            color: 'white',
            fontWeight: 600,
          }}
        />
        <Box flexGrow={1} />
        {vmItem &&
          (() => {
            const status = vmItem.status?.printableStatus || 'Unknown';
            const isStopped = status === 'Stopped';
            const isStopping = status === 'Stopping';
            const vmAction = async (
              action: () => Promise<any>,
              successMsg: string,
              failMsg: string
            ) => {
              try {
                await action();
                enqueueSnackbar(successMsg, { variant: 'success' });
              } catch (e) {
                enqueueSnackbar(`${failMsg}: ${safeError(e, 'vmAction')}`, { variant: 'error' });
              }
            };
            return (
              <Box display="flex" alignItems="center" gap={0.25}>
                <Tooltip title="Start" arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={!isStopped}
                      onClick={() =>
                        vmAction(() => vmItem.start(), `Starting ${vmName}`, 'Failed to start')
                      }
                    >
                      <Icon icon="mdi:play" width={18} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Stop" arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={isStopped || isStopping}
                      onClick={() =>
                        vmAction(() => vmItem.stop(), `Stopping ${vmName}`, 'Failed to stop')
                      }
                    >
                      <Icon icon="mdi:stop" width={18} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Restart" arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={status !== 'Running'}
                      onClick={() =>
                        vmAction(
                          () => vmItem.restart(),
                          `Restarting ${vmName}`,
                          'Failed to restart'
                        )
                      }
                    >
                      <Icon icon="mdi:restart" width={18} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={vmItem.isPaused() ? 'Unpause' : 'Pause'} arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={status !== 'Running' && !vmItem.isPaused()}
                      onClick={() =>
                        vmAction(
                          () => (vmItem.isPaused() ? vmItem.unpause() : vmItem.pause()),
                          vmItem.isPaused() ? `Unpausing ${vmName}` : `Pausing ${vmName}`,
                          vmItem.isPaused() ? 'Failed to unpause' : 'Failed to pause'
                        )
                      }
                    >
                      <Icon icon={vmItem.isPaused() ? 'mdi:play-pause' : 'mdi:pause'} width={18} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Force Stop" arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={isStopped}
                      onClick={() =>
                        vmAction(
                          () => vmItem.forceStop(),
                          `Force stopping ${vmName}`,
                          'Failed to force stop'
                        )
                      }
                    >
                      <Icon icon="mdi:stop-circle" width={18} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Migrate" arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={status !== 'Running' || !vmItem.isLiveMigratable()}
                      onClick={() =>
                        vmAction(() => vmItem.migrate(), `Migrating ${vmName}`, 'Failed to migrate')
                      }
                    >
                      <Icon icon="mdi:arrow-decision" width={18} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Delete" arrow>
                  <span>
                    <IconButton size="small" onClick={() => setShowDeleteConfirm(true)}>
                      <Icon icon="mdi:delete" width={18} color="#ef5350" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            );
          })()}
        <IconButton onClick={handleClose} size="small">
          <Icon icon="mdi:close" width={20} />
        </IconButton>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => {
            if (!tabs[v].disabled) setActiveTab(v);
          }}
          variant="scrollable"
          scrollButtons="auto"
        >
          {tabs.map((tab, i) => (
            <Tab
              key={i}
              icon={<Icon icon={tab.icon} width={18} />}
              iconPosition="start"
              label={tabLabel(tab)}
              sx={tab.disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
            />
          ))}
        </Tabs>
      </Box>

      <DialogContent
        sx={{
          pt: 2,
          overflow: isFixedLayout ? 'hidden' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Guest Info, Conditions, Events, Metrics: unmount on tab change (no persistent state) */}
        {activeTab === TAB_GUEST_INFO && (
          <GuestInfoTab vmName={vmName} namespace={namespace} vmiData={vmiData} vmItem={vmItem} />
        )}
        {activeTab === TAB_CONDITIONS && (
          <ConditionsTab
            vmName={vmName}
            namespace={namespace}
            vmiData={vmiData}
            vmItem={vmItem}
            podName={podName}
          />
        )}
        {activeTab === TAB_EVENTS && (
          <EventsTab vmName={vmName} namespace={namespace} />
        )}
        {activeTab === TAB_METRICS && (
          <MetricsDashboardTab
            vmName={vmName}
            namespace={namespace}
            vmiData={vmiData}
            vmItem={vmItem}
          />
        )}
        <Box
          sx={{
            display: activeTab === TAB_QUERIER ? 'flex' : 'none',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <PrometheusQuerier vmName={vmName} namespace={namespace} />
        </Box>
        <Box
          sx={{
            display: activeTab === TAB_LOGS ? 'flex' : 'none',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <PodLogsTab podName={podName} namespace={namespace} />
        </Box>
        {activeTab === TAB_VM_SHELL && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
            }}
          >
            <VMShellTab vmItem={vmItem} active={open && isVMShell} />
          </Box>
        )}
        <Box
          sx={{
            display: activeTab === TAB_POD_SHELL ? 'flex' : 'none',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <VirtLauncherExec podName={podName} namespace={namespace} hasAgent={hasAgent} />
        </Box>
        <Box
          sx={{
            display: activeTab === TAB_MEMDUMP ? 'flex' : 'none',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <MemoryDumpTab
            vmName={vmName}
            namespace={namespace}
            vmItem={vmItem}
            vmiData={vmiData}
            hasAgent={hasAgent}
          />
        </Box>
      </DialogContent>

      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete ${vmName}?`}
        message={`This will permanently delete the Virtual Machine ${namespace}/${vmName}. This action cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={async () => {
          setShowDeleteConfirm(false);
          if (!vmItem) return;
          try {
            await vmItem.delete();
            enqueueSnackbar(`Deleted ${vmName}`, { variant: 'success' });
            onClose();
          } catch (e) {
            enqueueSnackbar(`Failed to delete: ${safeError(e, 'deleteVM')}`, { variant: 'error' });
          }
        }}
      />

      {/* Cleanup analysis pods on close */}
      <Dialog
        open={showCleanupPrompt}
        onClose={() => setShowCleanupPrompt(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <Icon icon="mdi:flask-outline" width={22} />
          Analysis pods still running
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {analysisPods.length === 1
              ? 'There is 1 Volatility3 analysis pod still running:'
              : `There are ${analysisPods.length} Volatility3 analysis pods still running:`}
          </Typography>
          {analysisPods.map(pod => (
            <Chip
              key={pod}
              label={pod}
              size="small"
              variant="outlined"
              sx={{ fontFamily: 'monospace', fontSize: '0.7rem', mr: 0.5, mb: 0.5 }}
            />
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setShowCleanupPrompt(false)} size="small">
            Cancel
          </Button>
          <Button
            onClick={keepAndClose}
            variant="outlined"
            size="small"
            startIcon={<Icon icon="mdi:clock-outline" width={16} />}
          >
            Keep for later
          </Button>
          <Button
            onClick={cleanupAndClose}
            variant="contained"
            color="error"
            size="small"
            startIcon={<Icon icon="mdi:delete-sweep" width={16} />}
          >
            Clean up &amp; close
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
