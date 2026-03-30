import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Alert, Box, Card, CardContent, Chip, LinearProgress, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

interface GuestInfoTabProps {
  vmName: string;
  namespace: string;
  vmiData?: Record<string, any> | null;
  vmItem?: VirtualMachine | null;
}

interface GuestOSInfo {
  guestAgentVersion?: string;
  hostname?: string;
  os?: {
    name?: string;
    prettyName?: string;
    version?: string;
    versionId?: string;
    id?: string;
    kernelRelease?: string;
    kernelVersion?: string;
    machine?: string;
  };
  timezone?: string;
  supportedCommands?: Array<{ name: string; enabled: boolean }>;
}

interface GuestFilesystem {
  diskName?: string;
  mountPoint?: string;
  fileSystemType?: string;
  totalBytes?: number;
  usedBytes?: number;
}

interface GuestUser {
  userName?: string;
  loginTime?: number;
  domain?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function GuestInfoTab({ vmName, namespace, vmiData }: GuestInfoTabProps) {
  const [guestInfo, setGuestInfo] = useState<GuestOSInfo | null>(null);
  const [filesystems, setFilesystems] = useState<GuestFilesystem[]>([]);
  const [users, setUsers] = useState<GuestUser[]>([]);
  const [agentAvailable, setAgentAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!vmName || !namespace) return;
    let cancelled = false;

    const fetchGuestData = async () => {
      // Fetch guest OS info
      try {
        const osInfo = await ApiProxy.request(
          `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${vmName}/guestosinfo`
        );
        if (!cancelled) {
          setGuestInfo(osInfo);
          setAgentAvailable(true);
        }
      } catch {
        if (!cancelled) {
          setGuestInfo(null);
          setAgentAvailable(false);
        }
      }

      // Fetch filesystems
      try {
        const fsData = await ApiProxy.request(
          `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${vmName}/filesystemlist`
        );
        if (!cancelled) setFilesystems(fsData?.items || []);
      } catch {
        if (!cancelled) setFilesystems([]);
      }

      // Fetch logged-in users
      try {
        const userData = await ApiProxy.request(
          `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${vmName}/userlist`
        );
        if (!cancelled) setUsers(userData?.items || []);
      } catch {
        if (!cancelled) setUsers([]);
      }
    };

    fetchGuestData();
    const interval = setInterval(fetchGuestData, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [vmName, namespace]);

  const vmiPhase = vmiData?.status?.phase;

  if (vmiPhase !== 'Running') {
    return (
      <Alert severity="info" icon={<Icon icon="mdi:power-off" />}>
        VM is not running. Guest information is only available when the VM is active.
      </Alert>
    );
  }

  if (agentAvailable === false) {
    return (
      <Alert severity="warning" icon={<Icon icon="mdi:robot-off" />}>
        <Typography variant="body2">
          <strong>QEMU Guest Agent not available.</strong> Install <code>qemu-guest-agent</code>{' '}
          inside the VM to enable guest OS information, filesystem details, and logged-in user
          visibility.
        </Typography>
      </Alert>
    );
  }

  if (agentAvailable === null) {
    return <LinearProgress />;
  }

  const osInfo = guestInfo?.os;

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {/* OS Identity Card */}
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)' }} gap={2}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              <Icon
                icon="mdi:linux"
                width={18}
                style={{ verticalAlign: 'middle', marginRight: 6 }}
              />
              Operating System
            </Typography>
            <SimpleTable
              columns={[
                { label: 'Field', getter: (r: [string, string]) => r[0] },
                { label: 'Value', getter: (r: [string, string]) => r[1] },
              ]}
              data={[
                ['Hostname', guestInfo?.hostname || 'N/A'],
                ['OS', osInfo?.prettyName || osInfo?.name || 'N/A'],
                ['Version', osInfo?.version || osInfo?.versionId || 'N/A'],
                ['Kernel', osInfo?.kernelRelease || 'N/A'],
                ['Architecture', osInfo?.machine || 'N/A'],
                ['Timezone', guestInfo?.timezone || 'N/A'],
                ['Agent Version', guestInfo?.guestAgentVersion || 'N/A'],
              ]}
            />
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              <Icon
                icon="mdi:account-group"
                width={18}
                style={{ verticalAlign: 'middle', marginRight: 6 }}
              />
              Logged-in Users
            </Typography>
            {users.length > 0 ? (
              <SimpleTable
                columns={[
                  { label: 'User', getter: (u: GuestUser) => u.userName || 'Unknown' },
                  {
                    label: 'Login Time',
                    getter: (u: GuestUser) =>
                      u.loginTime ? new Date(u.loginTime * 1000).toLocaleString() : 'N/A',
                  },
                  { label: 'Domain', getter: (u: GuestUser) => u.domain || '-' },
                ]}
                data={users}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                No users currently logged in
              </Typography>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Filesystems */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            <Icon
              icon="mdi:harddisk"
              width={18}
              style={{ verticalAlign: 'middle', marginRight: 6 }}
            />
            Filesystems
          </Typography>
          {filesystems.length > 0 ? (
            <SimpleTable
              columns={[
                { label: 'Mount Point', getter: (fs: GuestFilesystem) => fs.mountPoint || '-' },
                { label: 'Type', getter: (fs: GuestFilesystem) => fs.fileSystemType || '-' },
                { label: 'Disk', getter: (fs: GuestFilesystem) => fs.diskName || '-' },
                {
                  label: 'Usage',
                  getter: (fs: GuestFilesystem) => {
                    if (!fs.totalBytes || fs.totalBytes === 0) return 'N/A';
                    const usedPct = ((fs.usedBytes || 0) / fs.totalBytes) * 100;
                    return (
                      <Box display="flex" alignItems="center" gap={1} minWidth={200}>
                        <LinearProgress
                          variant="determinate"
                          value={usedPct}
                          sx={{
                            flexGrow: 1,
                            height: 8,
                            borderRadius: 4,
                            '& .MuiLinearProgress-bar': {
                              bgcolor:
                                usedPct > 90 ? '#c9190b' : usedPct > 75 ? '#f0ab00' : '#3e8635',
                            },
                          }}
                        />
                        <Typography variant="caption" sx={{ minWidth: 40 }}>
                          {usedPct.toFixed(0)}%
                        </Typography>
                      </Box>
                    );
                  },
                },
                {
                  label: 'Size',
                  getter: (fs: GuestFilesystem) => {
                    if (!fs.totalBytes) return '-';
                    return `${formatBytes(fs.usedBytes || 0)} / ${formatBytes(fs.totalBytes)}`;
                  },
                },
              ]}
              data={filesystems}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No filesystem information available
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Network Interfaces from VMI status */}
      {vmiData?.status?.interfaces && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              <Icon icon="mdi:lan" width={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Network Interfaces
            </Typography>
            <SimpleTable
              columns={[
                {
                  label: 'Name',
                  getter: (iface: Record<string, any>) => iface.name || '-',
                },
                {
                  label: 'Interface',
                  getter: (iface: Record<string, any>) => iface.interfaceName || '-',
                },
                {
                  label: 'MAC',
                  getter: (iface: Record<string, any>) => (
                    <Typography variant="body2" fontFamily="monospace" fontSize="0.85rem">
                      {iface.mac || '-'}
                    </Typography>
                  ),
                },
                {
                  label: 'IP Addresses',
                  getter: (iface: Record<string, any>) => {
                    const ips = (iface.ipAddresses || []).filter(
                      (ip: string) => !ip.startsWith('fe80::')
                    );
                    return ips.length > 0
                      ? ips.map((ip: string) => (
                          <Chip
                            key={ip}
                            label={ip}
                            size="small"
                            variant="outlined"
                            sx={{ mr: 0.5, mb: 0.5, fontFamily: 'monospace', fontSize: '0.8rem' }}
                          />
                        ))
                      : '-';
                  },
                },
              ]}
              data={vmiData.status.interfaces}
            />
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
