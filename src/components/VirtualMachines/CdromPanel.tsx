import { Icon } from '@iconify/react';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import useFeatureGate from '../../hooks/useFeatureGate';
import { cdromHotplugAvailable, nextCdromName } from '../../utils/cdrom';
import CdromMediaDialog, { CdromMediaOption } from './CdromMediaDialog';
import useCdrom, { CdromDriveView, liveStateLabel } from './useCdrom';

type DialogState = { mode: 'insert'; drive: string } | { mode: 'add' } | null;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** CD-ROM drives of a VM with insert / eject / add / remove (VM details page). */
export default function CdromPanel({ namespace, name }: { namespace: string; name: string }) {
  const { enqueueSnackbar } = useSnackbar();
  // Re-render when feature gates load/change
  useFeatureGate('DeclarativeHotplugVolumes');
  useFeatureGate('HotplugVolumes');
  const hotplug = cdromHotplugAvailable();
  const cd = useCdrom(namespace, name);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [newDriveName, setNewDriveName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openAdd = () => {
    setNewDriveName(nextCdromName(cd.templateSpec));
    setError(null);
    setDialog({ mode: 'add' });
  };

  const confirm = async (media: CdromMediaOption | null) => {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    try {
      if (dialog.mode === 'insert' && media) {
        await cd.insert(dialog.drive, media);
        enqueueSnackbar(
          cd.running
            ? `Inserting ${media.name} into ${dialog.drive}`
            : `${media.name} set for ${dialog.drive}`,
          { variant: 'success' }
        );
      } else if (dialog.mode === 'add') {
        await cd.addDrive(newDriveName.trim(), media || undefined);
        enqueueSnackbar(
          cd.running
            ? `CD-ROM drive ${newDriveName} added; it appears after the next restart`
            : `CD-ROM drive ${newDriveName} added`,
          { variant: 'success' }
        );
      }
      setDialog(null);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const doEject = async (drive: CdromDriveView) => {
    try {
      await cd.eject(drive.name);
      enqueueSnackbar(`Ejecting ${drive.media?.name} from ${drive.name}`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(`Eject failed: ${errMsg(err)}`, { variant: 'error' });
    }
  };

  const doRemove = async (drive: CdromDriveView) => {
    try {
      await cd.removeDrive(drive.name);
      enqueueSnackbar(
        cd.running
          ? `CD-ROM drive ${drive.name} removed; takes effect after the next restart`
          : `CD-ROM drive ${drive.name} removed`,
        { variant: 'success' }
      );
    } catch (err) {
      enqueueSnackbar(`Remove failed: ${errMsg(err)}`, { variant: 'error' });
    }
  };

  if (!cd.loaded) return null;

  return (
    <SectionBox
      title="CD-ROM Drives"
      headerProps={{
        titleSideActions: [
          <Tooltip
            key="add"
            title={
              hotplug
                ? 'Add a CD-ROM drive (SATA). A drive added to a running VM appears after a restart.'
                : 'Needs declarative volume hotplug: remove the deprecated HotplugVolumes feature gate'
            }
          >
            <span>
              <Button
                size="small"
                startIcon={<Icon icon="mdi:plus" />}
                onClick={openAdd}
                disabled={!hotplug}
              >
                Add drive
              </Button>
            </span>
          </Tooltip>,
        ],
      }}
    >
      {!hotplug && (
        <Alert severity="info" sx={{ mb: 1 }}>
          CD-ROM insert/eject needs KubeVirt declarative volume hotplug (feature gate
          DeclarativeHotplugVolumes, Beta and on by default from v1.9) and the deprecated
          HotplugVolumes gate removed.
        </Alert>
      )}
      {cd.drives.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No CD-ROM drives.
        </Typography>
      ) : (
        <SimpleTable
          data={cd.drives}
          columns={[
            { label: 'Drive', getter: (d: CdromDriveView) => `${d.name} (${d.bus})` },
            {
              label: 'Disc',
              getter: (d: CdromDriveView) =>
                d.media ? (
                  <Box>
                    <Typography variant="body2">{d.media.name}</Typography>
                    {!d.media.hotpluggable && (
                      <Typography variant="caption" color="text.secondary">
                        inserted at boot
                      </Typography>
                    )}
                  </Box>
                ) : d.otherMedia ? (
                  <Typography variant="body2" color="text.secondary">
                    {d.otherMedia} (edit in YAML)
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Empty
                  </Typography>
                ),
            },
            {
              label: 'Status',
              getter: (d: CdromDriveView) => {
                const { label, color } = liveStateLabel(d.live);
                const detail = 'detail' in d.live ? d.live.detail : undefined;
                return (
                  <Tooltip title={detail || ''}>
                    <Chip size="small" label={label} color={color} variant="outlined" />
                  </Tooltip>
                );
              },
            },
            {
              label: '',
              getter: (d: CdromDriveView) => (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Tooltip title={d.media ? 'Change disc' : 'Insert disc'}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={!hotplug || !!d.otherMedia}
                        onClick={() => {
                          setError(null);
                          setDialog({ mode: 'insert', drive: d.name });
                        }}
                      >
                        <Icon icon="mdi:disc-player" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip
                    title={
                      d.media && !d.media.hotpluggable && cd.running
                        ? 'Eject (inserted at boot: takes effect after a restart)'
                        : 'Eject'
                    }
                  >
                    <span>
                      <IconButton
                        size="small"
                        disabled={!hotplug || !d.media}
                        onClick={() => doEject(d)}
                      >
                        <Icon icon="mdi:eject" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Remove drive">
                    <span>
                      <IconButton size="small" onClick={() => doRemove(d)}>
                        <Icon icon="mdi:delete" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              ),
            },
          ]}
        />
      )}

      <CdromMediaDialog
        open={!!dialog}
        namespace={namespace}
        title={
          dialog?.mode === 'add'
            ? 'Add CD-ROM drive'
            : `Insert disc into ${dialog?.mode === 'insert' ? dialog.drive : ''}`
        }
        usedClaims={cd.usedClaims}
        allowEmpty={dialog?.mode === 'add'}
        confirmLabel={dialog?.mode === 'add' ? 'Add drive' : 'Insert'}
        busy={busy}
        error={error}
        onClose={() => setDialog(null)}
        onConfirm={confirm}
      >
        {dialog?.mode === 'add' && (
          <TextField
            size="small"
            label="Drive name"
            value={newDriveName}
            onChange={e => setNewDriveName(e.target.value)}
            helperText={
              cd.running
                ? 'The VM is running: the drive appears after the next restart (discs can then be swapped live).'
                : 'SATA CD-ROM drive.'
            }
          />
        )}
      </CdromMediaDialog>
    </SectionBox>
  );
}
