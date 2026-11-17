import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { CdromMediaKind } from '../../utils/cdrom';

export interface CdromMediaOption {
  kind: CdromMediaKind;
  name: string;
  size?: string;
  phase?: string;
  /** Used by another disk of this VM */
  inUse?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * DataVolumes and PVCs in a namespace that can be inserted as CD-ROM media.
 * A PVC created by a DataVolume is shown once, as the DataVolume.
 */
export function buildMediaOptions(
  dataVolumes: Obj[],
  pvcs: Obj[],
  usedClaims: string[] = []
): CdromMediaOption[] {
  const used = new Set(usedClaims);
  const dvNames = new Set(dataVolumes.map(dv => dv.metadata?.name));
  const options: CdromMediaOption[] = [
    ...dataVolumes.map(dv => ({
      kind: 'dataVolume' as const,
      name: dv.metadata?.name,
      size:
        dv.spec?.storage?.resources?.requests?.storage ||
        dv.spec?.pvc?.resources?.requests?.storage,
      phase: dv.status?.phase,
      inUse: used.has(dv.metadata?.name),
    })),
    ...pvcs
      .filter(pvc => !dvNames.has(pvc.metadata?.name))
      .map(pvc => ({
        kind: 'persistentVolumeClaim' as const,
        name: pvc.metadata?.name,
        size: pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage,
        phase: pvc.status?.phase,
        inUse: used.has(pvc.metadata?.name),
      })),
  ];
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

interface CdromMediaDialogProps {
  open: boolean;
  namespace: string;
  title: string;
  /** PVC/DataVolume names already used by this VM's other disks */
  usedClaims?: string[];
  /** Allow confirming without media (adds an empty drive) */
  allowEmpty?: boolean;
  /** Extra content above the picker (e.g. drive name field) */
  children?: React.ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (media: CdromMediaOption | null) => void;
  /** Render inside this element (needed when shown over a fullscreen console) */
  container?: HTMLElement | null;
}

export default function CdromMediaDialog({
  open,
  namespace,
  title,
  usedClaims = [],
  allowEmpty = false,
  children,
  confirmLabel = 'Insert',
  busy = false,
  error,
  onClose,
  onConfirm,
  container,
}: CdromMediaDialogProps) {
  const [options, setOptions] = useState<CdromMediaOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CdromMediaOption | null>(null);

  useEffect(() => {
    if (!open || !namespace) return;
    let cancelled = false;
    setSelected(null);
    setLoading(true);
    setLoadError(null);
    const ns = encodeURIComponent(namespace);
    Promise.all([
      ApiProxy.request(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${ns}/datavolumes`).catch(() => ({
        items: [],
      })),
      ApiProxy.request(`/api/v1/namespaces/${ns}/persistentvolumeclaims`),
    ])
      .then(([dvs, pvcs]) => {
        if (cancelled) return;
        setOptions(buildMediaOptions(dvs?.items || [], pvcs?.items || [], usedClaims));
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, namespace]);

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      container={container}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon="mdi:disc" width={22} />
        {title}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {children}
          <Autocomplete
            options={options}
            loading={loading}
            value={selected}
            onChange={(_, v) => setSelected(v)}
            getOptionLabel={o => o.name}
            getOptionDisabled={o => !!o.inUse}
            isOptionEqualToValue={(a, b) => a.kind === b.kind && a.name === b.name}
            groupBy={o => (o.kind === 'dataVolume' ? 'DataVolumes' : 'PVCs')}
            renderOption={(props, o) => (
              <li {...props} key={`${o.kind}/${o.name}`}>
                <Box sx={{ display: 'flex', width: '100%', gap: 1, alignItems: 'baseline' }}>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {o.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[o.size, o.phase, o.inUse ? 'used by this VM' : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
              </li>
            )}
            renderInput={params => (
              <TextField
                {...params}
                label={allowEmpty ? 'ISO (optional)' : 'ISO'}
                placeholder={`DataVolume or PVC in ${namespace}`}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loading && <CircularProgress size={16} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
          <Typography variant="caption" color="text.secondary">
            The ISO must be a DataVolume or PVC in namespace <b>{namespace}</b>. To add one, import
            it under Bootable Volumes (from a URL) or upload it with{' '}
            <code>virtctl image-upload</code>.
            {allowEmpty && ' Leave empty to add a drive with no disc inserted.'}
          </Typography>
          {loadError && <Alert severity="error">Could not list volumes: {loadError}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => onConfirm(selected)}
          disabled={busy || (!allowEmpty && !selected)}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
