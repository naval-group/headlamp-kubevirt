import { Icon } from '@iconify/react';
import {
  Box,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import { useMemo, useState } from 'react';
import VirtualMachine from './VirtualMachine';

interface VMCompareDialogProps {
  vms: [VirtualMachine, ...VirtualMachine[]];
  onClose: () => void;
}

type FlatEntry = { path: string; values: string[]; diff: boolean };
type Section = 'metadata' | 'spec' | 'status';

const EXCLUDED_ANNOTATIONS = [
  'kubectl.kubernetes.io/last-applied-configuration',
  'kubevirt.io/latest-observed-api-version',
  'kubevirt.io/storage-observed-api-version',
];

function flatten(obj: any, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  if (obj === null || obj === undefined) {
    result[prefix] = String(obj);
    return result;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      result[prefix] = '[]';
    } else {
      obj.forEach((item, i) => {
        Object.assign(result, flatten(item, `${prefix}[${i}]`));
      });
    }
    return result;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      result[prefix] = '{}';
    } else {
      keys.forEach(key => {
        const newPrefix = prefix ? `${prefix}.${key}` : key;
        Object.assign(result, flatten(obj[key], newPrefix));
      });
    }
    return result;
  }
  result[prefix] = String(obj);
  return result;
}

function buildDiffRows(objects: any[], prefix: string): FlatEntry[] {
  const flats = objects.map(obj => flatten(obj));
  const allKeys = new Set(flats.flatMap(f => Object.keys(f)));
  const sorted = Array.from(allKeys).sort();

  return sorted
    .map(path => {
      const values = flats.map(f => f[path] ?? '—');
      const diff = values.some(v => v !== values[0]);
      return { path: `${prefix}.${path}`, values, diff };
    })
    .filter(r => r.diff);
}

function buildMetaObject(vm: VirtualMachine): Record<string, any> {
  const annotations = Object.entries(vm.metadata?.annotations || {}).filter(
    ([k]) => !EXCLUDED_ANNOTATIONS.includes(k)
  );
  return {
    name: vm.getName(),
    namespace: vm.getNamespace(),
    ...vm.metadata?.labels,
    ...Object.fromEntries(annotations.map(([k, v]) => [`annotation:${k}`, v])),
  };
}

export default function VMCompareDialog({ vms, onClose }: VMCompareDialogProps) {
  const theme = useTheme();
  const [sections, setSections] = useState<Record<Section, boolean>>({
    metadata: true,
    spec: true,
    status: true,
  });
  // Track which VMs are visible in comparison (toggled on/off via checkboxes)
  const [vmVisible, setVmVisible] = useState<boolean[]>(vms.map(() => true));

  const toggleSection = (section: Section) => {
    const next = { ...sections, [section]: !sections[section] };
    if (!next.spec && !next.metadata && !next.status) return;
    setSections(next);
  };

  const toggleVm = (index: number) => {
    const next = [...vmVisible];
    next[index] = !next[index];
    // At least 2 must remain visible
    if (next.filter(Boolean).length < 2) return;
    setVmVisible(next);
  };

  const visibleVms = vms.filter((_, i) => vmVisible[i]);
  const visibleIndices = vms.map((_, i) => i).filter(i => vmVisible[i]);

  const rows = useMemo(() => {
    const result: FlatEntry[] = [];
    if (sections.metadata) {
      result.push(...buildDiffRows(visibleVms.map(buildMetaObject), 'metadata'));
    }
    if (sections.spec) {
      result.push(
        ...buildDiffRows(
          visibleVms.map(vm => vm.spec),
          'spec'
        )
      );
    }
    if (sections.status) {
      result.push(
        ...buildDiffRows(
          visibleVms.map(vm => vm.status),
          'status'
        )
      );
    }
    return result;
  }, [visibleVms, sections]);

  const diffColor =
    theme.palette.mode === 'dark' ? 'rgba(255, 152, 0, 0.12)' : 'rgba(255, 152, 0, 0.08)';

  // Equal-width columns: field + N visible VMs share the space equally
  const colCount = visibleVms.length + 1;
  const colWidth = `${(100 / colCount).toFixed(1)}%`;

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pr: 6,
          flexWrap: 'wrap',
        }}
      >
        <Icon icon="mdi:compare" width={24} />
        <Typography variant="h6" component="span">
          Compare
        </Typography>
        <Box sx={{ display: 'flex', gap: 0, ml: 1, alignItems: 'center' }}>
          {vms.map((vm, i) => (
            <FormControlLabel
              key={vm.metadata?.uid}
              control={
                <Checkbox size="small" checked={vmVisible[i]} onChange={() => toggleVm(i)} />
              }
              label={<Typography variant="body2">{vm.getName()}</Typography>}
              sx={{ mr: 1 }}
            />
          ))}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', ml: 'auto', mr: 4, gap: 0 }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={sections.metadata}
                onChange={() => toggleSection('metadata')}
              />
            }
            label={<Typography variant="body2">Metadata</Typography>}
            sx={{ mr: 1 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={sections.spec}
                onChange={() => toggleSection('spec')}
              />
            }
            label={<Typography variant="body2">Spec</Typography>}
            sx={{ mr: 1 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={sections.status}
                onChange={() => toggleSection('status')}
              />
            }
            label={<Typography variant="body2">Status</Typography>}
          />
          <Chip
            label={rows.length}
            size="small"
            color="warning"
            sx={{ height: 20, fontSize: '0.75rem', ml: 1 }}
          />
        </Box>

        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <Icon icon="mdi:close" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ maxHeight: '65vh', overflow: 'auto' }}>
          {rows.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Icon icon="mdi:check-circle" width={48} color={theme.palette.success.main} />
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                No differences found
              </Typography>
            </Box>
          ) : (
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold', width: colWidth }}>Field</TableCell>
                  {visibleIndices.map(i => (
                    <TableCell
                      key={vms[i].metadata?.uid}
                      sx={{ fontWeight: 'bold', width: colWidth }}
                    >
                      {vms[i].getName()}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.path} sx={{ bgcolor: diffColor }}>
                    <TableCell sx={{ width: colWidth }}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                          wordBreak: 'break-all',
                        }}
                      >
                        {row.path}
                      </Typography>
                    </TableCell>
                    {row.values.map((val, i) => (
                      <TableCell key={i} sx={{ width: colWidth }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            wordBreak: 'break-all',
                            color: val === '—' ? 'text.disabled' : undefined,
                          }}
                        >
                          {val}
                        </Typography>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
