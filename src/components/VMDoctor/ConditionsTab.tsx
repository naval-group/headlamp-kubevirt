import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Box, Card, CardContent, Chip, Tooltip, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

interface ConditionsTabProps {
  vmName: string;
  namespace: string;
  vmiData?: Record<string, any> | null;
  vmItem?: VirtualMachine | null;
  podName: string;
}

interface K8sCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  lastProbeTime?: string;
  lastHeartbeatTime?: string;
  observedGeneration?: number;
}

interface ConditionGroup {
  source: string;
  icon: string;
  color: string;
  phase?: string;
  conditions: K8sCondition[];
}

function statusIcon(status: string, type: string): { icon: string; color: string } {
  const isPositive = status === 'True';
  // Some conditions are "good when False" (e.g. Running on a DV means import is still running)
  const invertedTypes = new Set(['Running', 'Paused']);
  const isGood = invertedTypes.has(type) ? !isPositive : isPositive;
  return {
    icon: isGood ? 'mdi:check-circle' : 'mdi:alert-circle',
    color: isGood ? '#66bb6a' : status === 'False' ? '#ef5350' : '#ffca28',
  };
}

function timeAgo(timestamp?: string): string {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '-';
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function ConditionRow({ condition }: { condition: K8sCondition }) {
  const { icon, color } = statusIcon(condition.status, condition.type);
  const transitionTime =
    condition.lastTransitionTime || condition.lastHeartbeatTime || condition.lastProbeTime;

  return (
    <Box
      display="flex"
      alignItems="flex-start"
      gap={1.5}
      sx={{
        py: 1,
        px: 1.5,
        borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Icon icon={icon} width={20} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
      <Box flex={1} minWidth={0}>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="body2" fontWeight={600}>
            {condition.type}
          </Typography>
          <Chip
            label={condition.status}
            size="small"
            sx={{
              height: 20,
              fontSize: '0.7rem',
              fontWeight: 600,
              bgcolor: color,
              color: '#fff',
            }}
          />
          {condition.reason && (
            <Chip
              label={condition.reason}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.7rem' }}
            />
          )}
          {transitionTime && (
            <Tooltip title={transitionTime}>
              <Typography variant="caption" color="text.secondary">
                {timeAgo(transitionTime)}
              </Typography>
            </Tooltip>
          )}
        </Box>
        {condition.message && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 0.25, display: 'block', lineHeight: 1.4 }}
          >
            {condition.message}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function ConditionCard({ group }: { group: ConditionGroup }) {
  const healthyCount = group.conditions.filter(c => {
    const invertedTypes = new Set(['Running', 'Paused']);
    return invertedTypes.has(c.type) ? c.status === 'False' : c.status === 'True';
  }).length;
  const total = group.conditions.length;
  const allHealthy = healthyCount === total;

  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: '12px !important' }}>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <Icon icon={group.icon} width={20} color={group.color} />
          <Typography variant="subtitle2" fontWeight={600}>
            {group.source}
          </Typography>
          {group.phase && (
            <Chip
              label={group.phase}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.7rem', height: 20 }}
            />
          )}
          <Box flex={1} />
          <Chip
            label={`${healthyCount}/${total}`}
            size="small"
            sx={{
              fontSize: '0.7rem',
              height: 20,
              fontWeight: 600,
              bgcolor: allHealthy ? '#66bb6a' : '#ffca28',
              color: '#fff',
            }}
          />
        </Box>
        <Box display="flex" flexDirection="column" gap={0.5}>
          {group.conditions.map(c => (
            <ConditionRow key={c.type} condition={c} />
          ))}
          {group.conditions.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              No conditions reported
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export default function ConditionsTab({
  vmName,
  namespace,
  vmiData,
  vmItem,
  podName,
}: ConditionsTabProps) {
  const [podConditions, setPodConditions] = useState<K8sCondition[]>([]);
  const [podPhase, setPodPhase] = useState<string>('');
  const [dvConditions, setDvConditions] = useState<
    Array<{ name: string; conditions: K8sCondition[] }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vmName || !namespace) return;
    let cancelled = false;

    const fetchConditions = async () => {
      // Fetch pod conditions
      if (podName) {
        try {
          const pod = await ApiProxy.request(`/api/v1/namespaces/${namespace}/pods/${podName}`);
          if (!cancelled) {
            setPodConditions(pod?.status?.conditions || []);
            setPodPhase(pod?.status?.phase || '');
          }
        } catch {
          if (!cancelled) setPodConditions([]);
        }
      }

      // Fetch DataVolume conditions
      try {
        const dvList = await ApiProxy.request(
          `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes`
        );
        if (!cancelled) {
          // Find DVs belonging to this VM (by owner reference or naming convention)
          const vmDvs = (dvList?.items || []).filter((dv: any) => {
            const owners = dv.metadata?.ownerReferences || [];
            const ownedByVM = owners.some(
              (o: any) => o.name === vmName && o.kind === 'VirtualMachine'
            );
            const nameMatch = dv.metadata?.name?.startsWith(vmName + '-');
            return ownedByVM || nameMatch;
          });
          setDvConditions(
            vmDvs.map((dv: any) => ({
              name: dv.metadata?.name || 'unknown',
              conditions: dv.status?.conditions || [],
            }))
          );
        }
      } catch {
        if (!cancelled) setDvConditions([]);
      }

      if (!cancelled) setLoading(false);
    };

    fetchConditions();
    const interval = setInterval(fetchConditions, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [vmName, namespace, podName]);

  if (loading) {
    return <Typography color="text.secondary">Loading conditions...</Typography>;
  }

  const vmConditions: K8sCondition[] = vmItem?.status?.conditions || [];
  const vmiConditions: K8sCondition[] = vmiData?.status?.conditions || [];
  const vmPhase = vmItem?.status?.printableStatus || 'Unknown';
  const vmiPhase = vmiData?.status?.phase || 'Stopped';

  // Build groups
  const groups: ConditionGroup[] = [
    {
      source: 'VirtualMachine',
      icon: 'mdi:server',
      color: '#42a5f5',
      phase: vmPhase,
      conditions: vmConditions,
    },
    {
      source: 'VirtualMachineInstance',
      icon: 'mdi:memory',
      color: '#ce93d8',
      phase: vmiPhase,
      conditions: vmiConditions,
    },
    {
      source: `Pod (${podName || 'N/A'})`,
      icon: 'mdi:cube-outline',
      color: '#66bb6a',
      phase: podPhase,
      conditions: podConditions,
    },
  ];

  // Add DV groups
  dvConditions.forEach(dv => {
    groups.push({
      source: `DataVolume: ${dv.name}`,
      icon: 'mdi:harddisk',
      color: '#ffca28',
      conditions: dv.conditions,
    });
  });

  // Summary
  const totalConditions = groups.reduce((sum, g) => sum + g.conditions.length, 0);
  const unhealthyConditions = groups.reduce((sum, g) => {
    return (
      sum +
      g.conditions.filter(c => {
        const invertedTypes = new Set(['Running', 'Paused']);
        return invertedTypes.has(c.type) ? c.status === 'True' : c.status === 'False';
      }).length
    );
  }, 0);

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {/* Summary bar */}
      <Box display="flex" alignItems="center" gap={1.5}>
        <Chip
          icon={<Icon icon="mdi:clipboard-check-outline" width={16} />}
          label={`${totalConditions} conditions`}
          size="small"
          variant="outlined"
        />
        {unhealthyConditions > 0 ? (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1,
              borderRadius: 1,
              bgcolor: '#f0ab00',
              color: '#000',
            }}
          >
            <Icon icon="mdi:alert" width={20} color="#000" />
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#000' }}>
              {unhealthyConditions} condition{unhealthyConditions > 1 ? 's' : ''} need
              {unhealthyConditions === 1 ? 's' : ''} attention
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1,
              borderRadius: 1,
              bgcolor: '#3e8635',
              color: '#fff',
            }}
          >
            <Icon icon="mdi:check-circle" width={20} color="#fff" />
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#fff' }}>
              All conditions healthy
            </Typography>
          </Box>
        )}
      </Box>

      {/* Condition cards in grid */}
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)' }} gap={2}>
        {groups.map(group => (
          <ConditionCard key={group.source} group={group} />
        ))}
      </Box>
    </Box>
  );
}
