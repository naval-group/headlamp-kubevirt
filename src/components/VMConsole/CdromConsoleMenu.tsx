import { Icon } from '@iconify/react';
import {
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import useFeatureGate from '../../hooks/useFeatureGate';
import { cdromHotplugAvailable } from '../../utils/cdrom';
import CdromMediaDialog, { CdromMediaOption } from '../VirtualMachines/CdromMediaDialog';
import useCdrom, { liveStateLabel } from '../VirtualMachines/useCdrom';

const menuItemSx = { fontSize: '0.8rem', py: 0.5, minHeight: 0 };
const iconSx = { minWidth: 28 };
const sectionSx = { fontSize: '0.7rem', opacity: '0.6 !important', py: 0.25, minHeight: 0 };

/**
 * VNC toolbar button: insert / eject discs in the VM's CD-ROM drives while watching the console.
 * `container` is the element shown fullscreen (so the menu and dialog stay visible).
 */
export default function CdromConsoleMenu({
  namespace,
  name,
  container,
}: {
  namespace: string;
  name: string;
  container?: HTMLElement | null;
}) {
  const { enqueueSnackbar } = useSnackbar();
  useFeatureGate('DeclarativeHotplugVolumes');
  useFeatureGate('HotplugVolumes');
  const hotplug = cdromHotplugAvailable();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [insertDrive, setInsertDrive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cd = useCdrom(namespace, name, hotplug);

  if (!hotplug || !cd.loaded || cd.drives.length === 0) return null;

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const eject = async (drive: string, media?: string) => {
    setAnchorEl(null);
    try {
      await cd.eject(drive);
      enqueueSnackbar(`Ejecting ${media || 'disc'} from ${drive}`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(`Eject failed: ${errMsg(err)}`, { variant: 'error' });
    }
  };

  const confirmInsert = async (media: CdromMediaOption | null) => {
    if (!insertDrive || !media) return;
    setBusy(true);
    setError(null);
    try {
      await cd.insert(insertDrive, media);
      enqueueSnackbar(`Inserting ${media.name} into ${insertDrive}`, { variant: 'success' });
      setInsertDrive(null);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const anyBusy = cd.drives.some(d => d.live.state === 'inserting' || d.live.state === 'ejecting');

  return (
    <>
      <Tooltip title="CD-ROM" arrow placement="left">
        <IconButton
          size="small"
          onClick={e => {
            cd.refresh();
            setAnchorEl(e.currentTarget);
          }}
          sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff' }, p: 0.5 }}
        >
          <Icon icon={anyBusy ? 'mdi:disc-alert' : 'mdi:disc'} width={18} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        container={container}
        slotProps={{
          paper: { sx: { bgcolor: 'rgba(30,30,30,0.95)', color: '#fff', minWidth: 240 } },
        }}
      >
        {cd.drives.map((d, i) => {
          const { label } = liveStateLabel(d.live);
          return [
            i > 0 && (
              <Divider
                key={`div-${d.name}`}
                sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 0.5 }}
              />
            ),
            <MenuItem key={`hdr-${d.name}`} disabled sx={sectionSx}>
              {d.name}: {d.media?.name || (d.otherMedia ? d.otherMedia : 'empty')} ({label})
            </MenuItem>,
            <MenuItem
              key={`ins-${d.name}`}
              sx={menuItemSx}
              disabled={!!d.otherMedia}
              onClick={() => {
                setAnchorEl(null);
                setError(null);
                setInsertDrive(d.name);
              }}
            >
              <ListItemIcon sx={iconSx}>
                <Icon icon="mdi:disc-player" width={16} color="rgba(255,255,255,0.7)" />
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
                {d.media ? 'Change disc…' : 'Insert disc…'}
              </ListItemText>
            </MenuItem>,
            <MenuItem
              key={`ej-${d.name}`}
              sx={menuItemSx}
              disabled={!d.media}
              onClick={() => eject(d.name, d.media?.name)}
            >
              <ListItemIcon sx={iconSx}>
                <Icon icon="mdi:eject" width={16} color="rgba(255,255,255,0.7)" />
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
                {d.media && !d.media.hotpluggable ? 'Eject (after restart)' : 'Eject'}
              </ListItemText>
            </MenuItem>,
          ];
        })}
      </Menu>
      <CdromMediaDialog
        open={!!insertDrive}
        namespace={namespace}
        title={`Insert disc into ${insertDrive || ''}`}
        usedClaims={cd.usedClaims}
        busy={busy}
        error={error}
        onClose={() => setInsertDrive(null)}
        onConfirm={confirmInsert}
        container={container}
      />
    </>
  );
}
