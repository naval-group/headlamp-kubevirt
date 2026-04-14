import { Icon } from '@iconify/react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';

// All available OS/platform icons from our airgapped bundles
const AVAILABLE_ICONS: Array<{ name: string; label: string; category: string }> = [
  // MDI OS icons
  { name: 'mdi:linux', label: 'Linux', category: 'OS' },
  { name: 'mdi:linux-mint', label: 'Linux Mint', category: 'Distro' },
  { name: 'mdi:fedora', label: 'Fedora', category: 'Distro' },
  { name: 'mdi:debian', label: 'Debian', category: 'Distro' },
  { name: 'mdi:centos', label: 'CentOS', category: 'Distro' },
  { name: 'mdi:ubuntu', label: 'Ubuntu', category: 'Distro' },
  { name: 'mdi:redhat', label: 'Red Hat', category: 'Distro' },
  { name: 'mdi:arch', label: 'Arch', category: 'Distro' },
  { name: 'mdi:gentoo', label: 'Gentoo', category: 'Distro' },
  { name: 'mdi:manjaro', label: 'Manjaro', category: 'Distro' },
  { name: 'mdi:microsoft-windows', label: 'Windows', category: 'OS' },
  { name: 'mdi:microsoft-windows-classic', label: 'Windows Classic', category: 'OS' },
  { name: 'mdi:apple', label: 'Apple', category: 'OS' },
  { name: 'mdi:apple-ios', label: 'iOS', category: 'OS' },
  { name: 'mdi:android', label: 'Android', category: 'OS' },
  { name: 'mdi:penguin', label: 'Penguin', category: 'OS' },
  { name: 'mdi:hat-fedora', label: 'Hat (Fedora)', category: 'Other' },
  { name: 'mdi:gnome', label: 'GNOME', category: 'Desktop' },
  { name: 'mdi:freebsd', label: 'FreeBSD', category: 'BSD' },
  { name: 'mdi:docker', label: 'Docker', category: 'Container' },
  { name: 'mdi:kubernetes', label: 'Kubernetes', category: 'Container' },
  { name: 'mdi:cloud', label: 'Cloud', category: 'Other' },
  { name: 'mdi:cloud-outline', label: 'Cloud Outline', category: 'Other' },
  { name: 'mdi:server', label: 'Server', category: 'Other' },
  { name: 'mdi:desktop-classic', label: 'Desktop', category: 'Other' },
  { name: 'mdi:desktop-tower', label: 'Tower', category: 'Other' },
  { name: 'mdi:monitor', label: 'Monitor', category: 'Other' },
  // Simple Icons OS
  { name: 'simple-icons:archlinux', label: 'Arch Linux', category: 'Distro' },
  { name: 'simple-icons:almalinux', label: 'AlmaLinux', category: 'Distro' },
  { name: 'simple-icons:alpinelinux', label: 'Alpine Linux', category: 'Distro' },
  { name: 'simple-icons:artixlinux', label: 'Artix Linux', category: 'Distro' },
  { name: 'simple-icons:asahilinux', label: 'Asahi Linux', category: 'Distro' },
  { name: 'simple-icons:garudalinux', label: 'Garuda Linux', category: 'Distro' },
  { name: 'simple-icons:gentoo', label: 'Gentoo', category: 'Distro' },
  { name: 'simple-icons:kalilinux', label: 'Kali Linux', category: 'Distro' },
  { name: 'simple-icons:linuxmint', label: 'Linux Mint', category: 'Distro' },
  { name: 'simple-icons:manjaro', label: 'Manjaro', category: 'Distro' },
  { name: 'simple-icons:mxlinux', label: 'MX Linux', category: 'Distro' },
  { name: 'simple-icons:nixos', label: 'NixOS', category: 'Distro' },
  { name: 'simple-icons:nobaralinux', label: 'Nobara Linux', category: 'Distro' },
  { name: 'simple-icons:opensuse', label: 'openSUSE', category: 'Distro' },
  { name: 'simple-icons:popos', label: 'Pop!_OS', category: 'Distro' },
  { name: 'simple-icons:rockylinux', label: 'Rocky Linux', category: 'Distro' },
  { name: 'simple-icons:slackware', label: 'Slackware', category: 'Distro' },
  { name: 'simple-icons:solus', label: 'Solus', category: 'Distro' },
  { name: 'simple-icons:voidlinux', label: 'Void Linux', category: 'Distro' },
  { name: 'simple-icons:zorin', label: 'Zorin', category: 'Distro' },
  { name: 'simple-icons:kubuntu', label: 'Kubuntu', category: 'Distro' },
  { name: 'simple-icons:lubuntu', label: 'Lubuntu', category: 'Distro' },
  { name: 'simple-icons:xubuntu', label: 'Xubuntu', category: 'Distro' },
  // BSDs
  { name: 'simple-icons:freebsd', label: 'FreeBSD', category: 'BSD' },
  { name: 'simple-icons:openbsd', label: 'OpenBSD', category: 'BSD' },
  { name: 'simple-icons:netbsd', label: 'NetBSD', category: 'BSD' },
  // Desktop environments
  { name: 'simple-icons:gnome', label: 'GNOME', category: 'Desktop' },
  { name: 'simple-icons:kde', label: 'KDE', category: 'Desktop' },
  { name: 'simple-icons:kdeplasma', label: 'KDE Plasma', category: 'Desktop' },
  { name: 'simple-icons:xfce', label: 'Xfce', category: 'Desktop' },
  // Platforms
  { name: 'simple-icons:windows', label: 'Windows', category: 'OS' },
  { name: 'simple-icons:windows10', label: 'Windows 10', category: 'OS' },
  { name: 'simple-icons:macos', label: 'macOS', category: 'OS' },
  { name: 'simple-icons:ios', label: 'iOS', category: 'OS' },
  { name: 'simple-icons:android', label: 'Android', category: 'OS' },
  { name: 'simple-icons:googlechrome', label: 'Chrome/ChromeOS', category: 'OS' },
  { name: 'simple-icons:steam', label: 'Steam/SteamOS', category: 'Gaming' },
  { name: 'simple-icons:steamdeck', label: 'Steam Deck', category: 'Gaming' },
  { name: 'simple-icons:riscv', label: 'RISC-V', category: 'Hardware' },
  { name: 'simple-icons:raspberrypi', label: 'Raspberry Pi', category: 'Hardware' },
  // Network/firewall appliances
  { name: 'simple-icons:pfsense', label: 'pfSense', category: 'Appliance' },
  { name: 'simple-icons:opnsense', label: 'OPNsense', category: 'Appliance' },
  { name: 'simple-icons:openwrt', label: 'OpenWrt', category: 'Appliance' },
  { name: 'simple-icons:paloaltonetworks', label: 'Palo Alto', category: 'Appliance' },
  { name: 'simple-icons:fortinet', label: 'Fortinet', category: 'Appliance' },
  { name: 'simple-icons:junipernetworks', label: 'Juniper', category: 'Appliance' },
  { name: 'simple-icons:truenas', label: 'TrueNAS', category: 'Appliance' },
  // Container/tools
  { name: 'simple-icons:docker', label: 'Docker', category: 'Container' },
  { name: 'simple-icons:kubernetes', label: 'Kubernetes', category: 'Container' },
  { name: 'simple-icons:flatpak', label: 'Flatpak', category: 'Container' },
  { name: 'simple-icons:snapcraft', label: 'Snap', category: 'Container' },
  { name: 'simple-icons:talos', label: 'Talos', category: 'Container' },
  // Security
  { name: 'simple-icons:tails', label: 'Tails', category: 'Security' },
  { name: 'simple-icons:qubesos', label: 'Qubes OS', category: 'Security' },
  // Enterprise
  { name: 'simple-icons:oracle', label: 'Oracle', category: 'Enterprise' },
];

const CATEGORIES = [...new Set(AVAILABLE_ICONS.map(i => i.category))].sort();

interface IconPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (iconName: string) => void;
  currentIcon?: string;
}

export default function IconPicker({ open, onClose, onSelect, currentIcon }: IconPickerProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const filtered = useMemo(() => {
    return AVAILABLE_ICONS.filter(i => {
      const matchSearch =
        !search ||
        i.label.toLowerCase().includes(search.toLowerCase()) ||
        i.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = !categoryFilter || i.category === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [search, categoryFilter]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="mdi:image-multiple" width={22} />
          Pick an Icon
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box display="flex" gap={1} mb={2} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            placeholder="Search icons..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Icon icon="mdi:magnify" width={18} />
                </InputAdornment>
              ),
            }}
          />
          {CATEGORIES.map(cat => (
            <Typography
              key={cat}
              variant="caption"
              onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
              sx={{
                cursor: 'pointer',
                px: 1,
                py: 0.25,
                borderRadius: 1,
                bgcolor: categoryFilter === cat ? 'primary.main' : 'action.hover',
                color: categoryFilter === cat ? 'primary.contrastText' : 'text.secondary',
                '&:hover': { bgcolor: categoryFilter === cat ? 'primary.dark' : 'action.selected' },
              }}
            >
              {cat}
            </Typography>
          ))}
        </Box>

        <Grid container spacing={0.5}>
          {filtered.map(icon => (
            <Grid item key={icon.name}>
              <Tooltip title={`${icon.label} (${icon.name})`} arrow>
                <IconButton
                  onClick={() => {
                    onSelect(icon.name);
                    onClose();
                  }}
                  sx={{
                    border: currentIcon === icon.name ? 2 : 1,
                    borderColor: currentIcon === icon.name ? 'primary.main' : 'divider',
                    borderRadius: 1,
                    p: 1,
                  }}
                >
                  <Icon icon={icon.name} width={28} />
                </IconButton>
              </Tooltip>
            </Grid>
          ))}
        </Grid>

        {filtered.length === 0 && (
          <Typography color="text.secondary" textAlign="center" py={4}>
            No icons match your search
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
