import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Box, Chip, Tab, Tabs, Typography } from '@mui/material';
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import usePolling from '../../hooks/usePolling';
import { VMIData } from '../../types';
import { getVMIPhaseColor } from '../../utils/statusColors';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import ConsoleLogTab from './ConsoleLogTab';
import EventsTab from './EventsTab';
import GuestInfoTab from './GuestInfoTab';
import MetricsDashboardTab from './MetricsDashboardTab';
import PodLogsTab from './PodLogsTab';

export default function VMDoctor() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [activeTab, setActiveTab] = useState(0);
  const [vmItem] = VirtualMachine.useGet(name, namespace);
  const [vmiData, setVmiData] = useState<VMIData | null>(null);
  const [podName, setPodName] = useState<string>('');

  // Poll VMI data
  usePolling(
    async cancelled => {
      try {
        const resp = await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}`
        );
        if (!cancelled()) setVmiData(resp);
      } catch {
        if (!cancelled()) setVmiData(null);
      }
    },
    10000,
    [name, namespace],
    !!name && !!namespace
  );

  // Poll virt-launcher pod
  usePolling(
    async cancelled => {
      try {
        const resp = await ApiProxy.request(
          `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(
            `vm.kubevirt.io/name=${name}`
          )}`
        );
        const pod = resp?.items?.[0]?.metadata?.name;
        if (!cancelled() && pod) setPodName(pod);
      } catch {
        // ignore
      }
    },
    15000,
    [name, namespace],
    !!name && !!namespace
  );

  const vmiPhase = vmiData?.status?.phase || 'Stopped';
  const vmStatus = vmItem?.status?.printableStatus || vmiPhase;

  return (
    <SectionBox
      title={
        <Box display="flex" alignItems="center" gap={1.5}>
          <Icon icon="mdi:stethoscope" width={28} />
          <Typography variant="h5" fontWeight={600}>
            VM Doctor
          </Typography>
          <Typography variant="h6" color="text.secondary">
            {namespace}/{name}
          </Typography>
          <Chip
            label={vmStatus}
            size="small"
            sx={{
              bgcolor: getVMIPhaseColor(vmiPhase),
              color: 'white',
              fontWeight: 600,
              ml: 1,
            }}
          />
        </Box>
      }
      backLink={`/kubevirt/virtualmachines/${namespace}/${name}`}
    >
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab
            icon={<Icon icon="mdi:card-account-details" width={20} />}
            iconPosition="start"
            label="Guest Info"
          />
          <Tab
            icon={<Icon icon="mdi:timeline-alert" width={20} />}
            iconPosition="start"
            label="Events"
          />
          <Tab
            icon={<Icon icon="mdi:chart-line" width={20} />}
            iconPosition="start"
            label="Metrics"
          />
          <Tab
            icon={<Icon icon="mdi:console" width={20} />}
            iconPosition="start"
            label="Console Log"
          />
          <Tab
            icon={<Icon icon="mdi:text-box-outline" width={20} />}
            iconPosition="start"
            label="Pod Logs"
          />
        </Tabs>
      </Box>

      {activeTab === 0 && (
        <GuestInfoTab vmName={name} namespace={namespace} vmiData={vmiData} vmItem={vmItem} />
      )}
      {activeTab === 1 && <EventsTab vmName={name} namespace={namespace} />}
      {activeTab === 2 && (
        <MetricsDashboardTab
          vmName={name}
          namespace={namespace}
          vmiData={vmiData}
          vmItem={vmItem}
        />
      )}
      {activeTab === 3 && <ConsoleLogTab podName={podName} namespace={namespace} />}
      {activeTab === 4 && <PodLogsTab podName={podName} namespace={namespace} />}
    </SectionBox>
  );
}
