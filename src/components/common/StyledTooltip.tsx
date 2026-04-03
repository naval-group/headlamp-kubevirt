import { Box, Tooltip, TooltipProps } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

/**
 * Styled tooltip matching the VNC Send Keys dropdown aesthetic:
 * dark backdrop, subtle border, compact typography.
 */
const DarkTooltip = styled(({ className, ...props }: TooltipProps) => (
  <Tooltip {...props} classes={{ popper: className }} />
))(() => ({
  '& .MuiTooltip-tooltip': {
    backgroundColor: '#1e1e1e',
    color: '#e0e0e0',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: 0,
    maxWidth: 420,
    fontSize: '0.8rem',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  '& .MuiTooltip-arrow': {
    color: '#1e1e1e',
    '&::before': {
      border: '1px solid rgba(255,255,255,0.12)',
    },
  },
}));

/* ── Simple titled tooltip ──────────────────────────────────── */

interface TitledTooltipProps {
  title: string;
  rows: { label: string; value: React.ReactNode }[];
  children: React.ReactElement;
  placement?: TooltipProps['placement'];
}

/**
 * Tooltip with a header and key-value rows rendered as a compact table.
 */
export function TitledTooltip({ title, rows, children, placement = 'bottom' }: TitledTooltipProps) {
  return (
    <DarkTooltip
      arrow
      placement={placement}
      title={
        <Box>
          <Box
            sx={{
              px: 1.5,
              py: 0.75,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              textTransform: 'uppercase',
              fontSize: '0.65rem',
              fontWeight: 600,
              letterSpacing: 0.5,
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            {title}
          </Box>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {rows.map((row, i) => (
                <Box
                  component="tr"
                  key={i}
                  sx={{
                    '&:not(:last-child) td': { borderBottom: '1px solid rgba(255,255,255,0.05)' },
                  }}
                >
                  <Box
                    component="td"
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      fontSize: '0.75rem',
                      color: 'rgba(255,255,255,0.5)',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'top',
                    }}
                  >
                    {row.label}
                  </Box>
                  <Box
                    component="td"
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      fontSize: '0.75rem',
                      color: '#fff',
                      wordBreak: 'break-all',
                    }}
                  >
                    {row.value}
                  </Box>
                </Box>
              ))}
            </tbody>
          </Box>
        </Box>
      }
    >
      {children}
    </DarkTooltip>
  );
}

/* ── Simple styled tooltip (no table, just text) ──────────── */

interface SimpleStyledTooltipProps {
  title: React.ReactNode;
  children: React.ReactElement;
  placement?: TooltipProps['placement'];
}

/**
 * Dark-styled tooltip with simple text content (no table layout).
 */
export function SimpleStyledTooltip({
  title,
  children,
  placement = 'bottom',
}: SimpleStyledTooltipProps) {
  return (
    <DarkTooltip
      arrow
      placement={placement}
      title={<Box sx={{ px: 1.5, py: 1, fontSize: '0.8rem' }}>{title}</Box>}
    >
      {children}
    </DarkTooltip>
  );
}

/* ── JSON-to-table tooltip ────────────────────────────────── */

interface JsonTooltipProps {
  title: string;
  data: Record<string, unknown>;
  children: React.ReactElement;
  placement?: TooltipProps['placement'];
  maxDepth?: number;
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
  maxDepth = 2,
  depth = 0
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val) && depth < maxDepth) {
      rows.push(...flattenObject(val as Record<string, unknown>, fullKey, maxDepth, depth + 1));
    } else if (Array.isArray(val)) {
      rows.push({ label: fullKey, value: `[${val.length} items]` });
    } else {
      rows.push({ label: fullKey, value: String(val ?? 'null') });
    }
  }
  return rows;
}

/**
 * Tooltip that renders a JSON object as a clean key-value table.
 */
export function JsonTooltip({
  title,
  data,
  children,
  placement = 'bottom',
  maxDepth = 2,
}: JsonTooltipProps) {
  const rows = flattenObject(data, '', maxDepth);
  return (
    <TitledTooltip
      title={title}
      rows={rows.map(r => ({ label: r.label, value: r.value }))}
      placement={placement}
    >
      {children}
    </TitledTooltip>
  );
}

export { DarkTooltip };
