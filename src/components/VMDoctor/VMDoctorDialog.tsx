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
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useCallback, useState } from 'react';
import useVMActions from '../../hooks/useVMActions';
import { safeError } from '../../utils/sanitize';
import { getVMIPhaseColor } from '../../utils/statusColors';
import ConfirmDialog from '../common/ConfirmDialog';
import { TabContent, TabDef, TabPanelHeader } from '../common/TabPanel';
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
import YAMLEditorTab from './YAMLEditorTab';

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
const TAB_YAML = 8;
const TAB_MEMDUMP = 9;

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
  const { actions: vmActions } = useVMActions(vmItem);

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
  const isYaml = activeTab === TAB_YAML;
  const isMemDump = activeTab === TAB_MEMDUMP;
  const isShellTab = isVMShell || isPodShell;
  const isFixedLayout = isShellTab || isLogs || isYaml || isMemDump;

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
      icon: 'mdi:code-braces',
      label: 'YAML',
      disabled: false,
      reason: '',
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
            bgcolor: getVMIPhaseColor(vmiPhase),
            color: 'white',
            fontWeight: 600,
          }}
        />
        <Box flexGrow={1} />
        {vmItem && (
          <Box display="flex" alignItems="center" gap={0.25}>
            {vmActions
              .filter(a => a.id !== 'protect')
              .map(a => (
                <Tooltip key={a.id} title={a.label} arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={a.disabled}
                      onClick={a.handler}
                      aria-label={a.label}
                    >
                      <Icon icon={a.icon} width={18} />
                    </IconButton>
                  </span>
                </Tooltip>
              ))}
            <Tooltip title="Delete" arrow>
              <span>
                <IconButton
                  size="small"
                  onClick={() => setShowDeleteConfirm(true)}
                  aria-label="Delete virtual machine"
                >
                  <Icon icon="mdi:delete" width={18} color="#ef5350" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )}
        <IconButton onClick={handleClose} size="small" aria-label="Close VM Doctor">
          <Icon icon="mdi:close" width={20} />
        </IconButton>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <TabPanelHeader tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
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
        {/* Unmounted on tab change (no persistent state) */}
        <TabContent activeTab={activeTab} index={TAB_GUEST_INFO}>
          <GuestInfoTab vmName={vmName} namespace={namespace} vmiData={vmiData} vmItem={vmItem} />
        </TabContent>
        <TabContent activeTab={activeTab} index={TAB_CONDITIONS}>
          <ConditionsTab
            vmName={vmName}
            namespace={namespace}
            vmiData={vmiData}
            vmItem={vmItem}
            podName={podName}
          />
        </TabContent>
        <TabContent activeTab={activeTab} index={TAB_EVENTS}>
          <EventsTab vmName={vmName} namespace={namespace} />
        </TabContent>
        <TabContent activeTab={activeTab} index={TAB_METRICS}>
          <MetricsDashboardTab
            vmName={vmName}
            namespace={namespace}
            vmiData={vmiData}
            vmItem={vmItem}
          />
        </TabContent>

        {/* Kept alive (display:none) to preserve session/scroll state */}
        <TabContent activeTab={activeTab} index={TAB_QUERIER} keepAlive flex>
          <PrometheusQuerier vmName={vmName} namespace={namespace} />
        </TabContent>
        <TabContent activeTab={activeTab} index={TAB_LOGS} keepAlive flex>
          <PodLogsTab podName={podName} namespace={namespace} />
        </TabContent>

        {/* VM Shell: unmounted (reconnects on mount) */}
        <TabContent activeTab={activeTab} index={TAB_VM_SHELL} flex>
          <VMShellTab vmItem={vmItem} active={open && isVMShell} />
        </TabContent>

        {/* Pod Shell + Memory Dump: kept alive */}
        <TabContent activeTab={activeTab} index={TAB_POD_SHELL} keepAlive flex>
          <VirtLauncherExec podName={podName} namespace={namespace} hasAgent={hasAgent} />
        </TabContent>
        <TabContent activeTab={activeTab} index={TAB_YAML} flex>
          <YAMLEditorTab
            vmName={vmName}
            namespace={namespace}
            vmItem={vmItem}
            vmiData={vmiData}
            podName={podName}
          />
        </TabContent>
        <TabContent activeTab={activeTab} index={TAB_MEMDUMP} keepAlive flex>
          <MemoryDumpTab
            vmName={vmName}
            namespace={namespace}
            vmItem={vmItem}
            vmiData={vmiData}
            hasAgent={hasAgent}
          />
        </TabContent>
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
