import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Box,
  Chip,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';

interface EventsTabProps {
  vmName: string;
  namespace: string;
}

interface K8sEvent {
  metadata: { name: string; creationTimestamp: string; uid: string };
  involvedObject: { kind: string; name: string; namespace: string };
  reason: string;
  message: string;
  type: string;
  count?: number;
  lastTimestamp?: string;
  firstTimestamp?: string;
  source?: { component?: string; host?: string };
}

export default function EventsTab({ vmName, namespace }: EventsTabProps) {
  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'Normal' | 'Warning'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!vmName || !namespace) return;
    let cancelled = false;

    const fetchEvents = async () => {
      try {
        // Fetch events for VM, VMI, and related pods
        const [vmEvents, vmiEvents, podEvents] = await Promise.all([
          ApiProxy.request(
            `/api/v1/namespaces/${encodeURIComponent(
              namespace
            )}/events?fieldSelector=${encodeURIComponent(
              `involvedObject.name=${vmName},involvedObject.kind=VirtualMachine`
            )}`
          ).catch(() => ({ items: [] })),
          ApiProxy.request(
            `/api/v1/namespaces/${encodeURIComponent(
              namespace
            )}/events?fieldSelector=${encodeURIComponent(
              `involvedObject.name=${vmName},involvedObject.kind=VirtualMachineInstance`
            )}`
          ).catch(() => ({ items: [] })),
          // Also fetch pod events for the virt-launcher pod
          ApiProxy.request(
            `/api/v1/namespaces/${encodeURIComponent(
              namespace
            )}/pods?labelSelector=${encodeURIComponent(`vm.kubevirt.io/name=${vmName}`)}`
          )
            .then(async (podResp: any) => {
              const podName = podResp?.items?.[0]?.metadata?.name;
              if (!podName) return { items: [] };
              return ApiProxy.request(
                `/api/v1/namespaces/${encodeURIComponent(
                  namespace
                )}/events?fieldSelector=${encodeURIComponent(
                  `involvedObject.name=${podName},involvedObject.kind=Pod`
                )}`
              ).catch(() => ({ items: [] }));
            })
            .catch(() => ({ items: [] })),
        ]);

        if (!cancelled) {
          const allEvents = [
            ...(vmEvents?.items || []),
            ...(vmiEvents?.items || []),
            ...(podEvents?.items || []),
          ];

          // Deduplicate by UID
          const seen = new Set<string>();
          const unique = allEvents.filter(e => {
            if (seen.has(e.metadata.uid)) return false;
            seen.add(e.metadata.uid);
            return true;
          });

          // Sort by last timestamp descending
          unique.sort((a, b) => {
            const timeA = new Date(a.lastTimestamp || a.metadata.creationTimestamp).getTime();
            const timeB = new Date(b.lastTimestamp || b.metadata.creationTimestamp).getTime();
            return timeB - timeA;
          });

          setEvents(unique);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setEvents([]);
          setLoading(false);
        }
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [vmName, namespace]);

  const filteredEvents = events.filter(e => {
    if (filter !== 'all' && e.type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (e.reason || '').toLowerCase().includes(q) ||
        (e.message || '').toLowerCase().includes(q) ||
        (e.involvedObject?.kind || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const warningCount = events.filter(e => e.type === 'Warning').length;

  if (loading) {
    return <Typography color="text.secondary">Loading events...</Typography>;
  }

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {/* Summary + Filters */}
      <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
        <Chip label={`${events.length} events`} size="small" variant="outlined" />
        {warningCount > 0 && (
          <Chip
            icon={<Icon icon="mdi:alert" width={16} />}
            label={`${warningCount} warnings`}
            size="small"
            color="warning"
          />
        )}
        <FormControl size="small">
          <Select
            value={filter}
            onChange={e => setFilter(e.target.value as typeof filter)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="all">All Types</MenuItem>
            <MenuItem value="Normal">Normal</MenuItem>
            <MenuItem value="Warning">Warning</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="Search events..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon icon="mdi:magnify" width={18} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearch('')} aria-label="Clear search">
                  <Icon icon="mdi:close" width={16} />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
          sx={{ minWidth: 220 }}
        />
      </Box>

      {filteredEvents.length === 0 ? (
        <Alert severity="info">No events found for this VM.</Alert>
      ) : (
        <SimpleTable
          columns={[
            {
              label: 'Type',
              getter: (e: K8sEvent) => (
                <Chip
                  label={e.type}
                  size="small"
                  color={e.type === 'Warning' ? 'warning' : 'success'}
                  sx={{ fontWeight: 600, minWidth: 70 }}
                />
              ),
            },
            {
              label: 'Reason',
              getter: (e: K8sEvent) => (
                <Typography variant="body2" fontWeight={600}>
                  {e.reason}
                </Typography>
              ),
            },
            {
              label: 'Object',
              getter: (e: K8sEvent) => (
                <Chip
                  label={`${e.involvedObject.kind}/${e.involvedObject.name}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                />
              ),
            },
            {
              label: 'Message',
              getter: (e: K8sEvent) => (
                <Tooltip title={e.message || ''}>
                  <Typography
                    variant="body2"
                    sx={{
                      maxWidth: 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {e.message || '-'}
                  </Typography>
                </Tooltip>
              ),
            },
            {
              label: 'Count',
              getter: (e: K8sEvent) => e.count || 1,
            },
            {
              label: 'Last Seen',
              getter: (e: K8sEvent) => {
                const ts = e.lastTimestamp || e.metadata.creationTimestamp;
                if (!ts) return '-';
                const d = new Date(ts);
                const ago = Math.floor((Date.now() - d.getTime()) / 1000);
                if (ago < 60) return `${ago}s ago`;
                if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
                if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`;
                return d.toLocaleString();
              },
            },
            {
              label: 'Source',
              getter: (e: K8sEvent) =>
                e.source?.component ? (
                  <Typography variant="caption" color="text.secondary">
                    {e.source.component}
                  </Typography>
                ) : (
                  '-'
                ),
            },
          ]}
          data={filteredEvents}
        />
      )}
    </Box>
  );
}
