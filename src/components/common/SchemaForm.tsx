/**
 * Dynamic form renderer from JSON Schema.
 * Reads a JSON Schema and renders MUI form fields with proper types,
 * defaults, descriptions, and validation.
 */

import { Icon } from '@iconify/react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

const GreenSwitch = styled(Switch)({
  '& .MuiSwitch-switchBase.Mui-checked': {
    color: '#4caf50',
  },
  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
    backgroundColor: '#4caf50',
  },
});

interface JsonSchemaProperty {
  title?: string;
  description?: string;
  type?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchemaProperty>;
  additionalProperties?: JsonSchemaProperty | boolean;
  items?: JsonSchemaProperty;
  oneOf?: Array<{ type?: string }>;
}

interface SchemaFormProps {
  schema: JsonSchemaProperty;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** Path prefix for nested schemas */
  path?: string;
  /** Depth level for visual nesting */
  depth?: number;
  /** Skip these property keys */
  exclude?: string[];
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

function setNestedValue(
  obj: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  return { ...obj, [key]: value };
}

function SchemaField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchemaProperty;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  // Resolve oneOf — treat as the first type (usually string)
  const effectiveType =
    schema.type ||
    (schema.oneOf?.find(o => o.type === 'string') ? 'string' : schema.oneOf?.[0]?.type);
  const resolved = { ...schema, type: effectiveType };
  const label = resolved.title || name;
  const helperText = resolved.description || '';

  // Boolean → Switch
  if (resolved.type === 'boolean') {
    return (
      <FormControlLabel
        control={
          <GreenSwitch
            checked={Boolean(value ?? schema.default)}
            onChange={e => onChange(e.target.checked)}
            size="small"
          />
        }
        label={
          <Box>
            <Typography variant="body2">{label}</Typography>
            {helperText && (
              <Typography variant="caption" color="text.secondary">
                {helperText}
              </Typography>
            )}
          </Box>
        }
        sx={{ mb: 1, ml: 0 }}
      />
    );
  }

  // String with enum → Select
  if (resolved.type === 'string' && schema.enum) {
    return (
      <TextField
        select
        fullWidth
        size="small"
        label={label}
        value={(value as string) ?? schema.default ?? ''}
        onChange={e => onChange(e.target.value)}
        helperText={helperText}
        sx={{ mb: 2 }}
      >
        {schema.enum.map(opt => (
          <MenuItem key={opt} value={opt}>
            {opt}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  // String → TextField
  if (resolved.type === 'string') {
    return (
      <TextField
        fullWidth
        size="small"
        label={label}
        value={(value as string) ?? schema.default ?? ''}
        onChange={e => onChange(e.target.value)}
        helperText={helperText}
        sx={{ mb: 2 }}
      />
    );
  }

  // Integer/Number → TextField number
  if (resolved.type === 'integer' || resolved.type === 'number') {
    return (
      <TextField
        fullWidth
        size="small"
        type="number"
        label={label}
        value={value ?? schema.default ?? ''}
        onChange={e => {
          const v =
            resolved.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value);
          onChange(isNaN(v) ? '' : v);
        }}
        helperText={helperText}
        inputProps={{
          min: schema.minimum,
          max: schema.maximum,
        }}
        sx={{ mb: 2 }}
      />
    );
  }

  // Array of strings → comma-separated TextField with chips preview
  if (resolved.type === 'array' && schema.items?.type === 'string') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label={label}
          value={arr.join(', ')}
          onChange={e =>
            onChange(
              e.target.value
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            )
          }
          helperText={helperText || 'Comma-separated values'}
        />
        {arr.length > 0 && (
          <Box display="flex" gap={0.5} flexWrap="wrap" mt={0.5}>
            {arr.map((item, i) => (
              <Chip key={i} label={item} size="small" variant="outlined" />
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Object with additionalProperties (key-value map like nodeSelector)
  if (resolved.type === 'object' && schema.additionalProperties && !schema.properties) {
    const obj =
      (value as Record<string, string>) ?? (schema.default as Record<string, string>) ?? {};
    const entries = Object.entries(obj);
    return (
      <TextField
        fullWidth
        size="small"
        label={label}
        value={entries.map(([k, v]) => `${k}=${v}`).join(', ')}
        onChange={e => {
          const parsed: Record<string, string> = {};
          e.target.value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .forEach(pair => {
              const [k, ...rest] = pair.split('=');
              if (k) parsed[k.trim()] = rest.join('=').trim();
            });
          onChange(parsed);
        }}
        helperText={helperText || 'key=value pairs, comma-separated'}
        sx={{ mb: 2 }}
      />
    );
  }

  // Array of objects (tolerations, etc.) — show as YAML-like text
  if (resolved.type === 'array' && schema.items?.type === 'object') {
    const arr = Array.isArray(value) ? value : [];
    const isEmpty = arr.length === 0;
    return (
      <TextField
        fullWidth
        size="small"
        label={label}
        value={isEmpty ? '' : JSON.stringify(arr, null, 2)}
        onChange={e => {
          if (!e.target.value.trim()) {
            onChange([]);
            return;
          }
          try {
            const parsed = JSON.parse(e.target.value);
            if (Array.isArray(parsed)) onChange(parsed);
          } catch {
            /* keep current — invalid JSON */
          }
        }}
        helperText={helperText}
        placeholder="Leave empty for defaults"
        sx={{ mb: 2 }}
        multiline={!isEmpty}
        rows={isEmpty ? 1 : 3}
      />
    );
  }

  // Empty object without properties (resources: {}) — show placeholder
  if (resolved.type === 'object' && !schema.properties && !schema.additionalProperties) {
    const obj = value as Record<string, unknown> | undefined;
    const isEmpty = !obj || Object.keys(obj).length === 0;
    return (
      <TextField
        fullWidth
        size="small"
        label={label}
        value={isEmpty ? '' : JSON.stringify(obj, null, 2)}
        onChange={e => {
          if (!e.target.value.trim()) {
            onChange({});
            return;
          }
          try {
            const parsed = JSON.parse(e.target.value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) onChange(parsed);
          } catch {
            /* keep current — invalid JSON */
          }
        }}
        helperText={helperText}
        placeholder="Leave empty for defaults"
        sx={{ mb: 2 }}
        multiline={!isEmpty}
        rows={isEmpty ? 1 : 3}
      />
    );
  }

  // Fallback — should rarely be reached
  return null;
}

export default function SchemaForm({
  schema,
  values,
  onChange,
  depth = 0,
  exclude = [],
}: SchemaFormProps) {
  if (!schema.properties) return null;

  const entries = Object.entries(schema.properties).filter(([key]) => !exclude.includes(key));

  // Separate simple fields from nested objects
  const simpleFields = entries.filter(([, prop]) => prop.type !== 'object' || !prop.properties);
  const nestedObjects = entries.filter(([, prop]) => prop.type === 'object' && prop.properties);

  return (
    <Box>
      {/* Simple fields first */}
      {simpleFields.map(([key, prop]) => (
        <SchemaField
          key={key}
          name={key}
          schema={prop}
          value={getNestedValue(values, key)}
          onChange={v => onChange(setNestedValue(values, key, v))}
        />
      ))}

      {/* Nested objects as collapsible sections */}
      {nestedObjects.map(([key, prop]) => (
        <Accordion
          key={key}
          variant="outlined"
          defaultExpanded={depth === 0}
          sx={{ mb: 1, '&:before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
            <Box>
              <Typography variant="subtitle2">{prop.title || key}</Typography>
              {prop.description && (
                <Typography variant="caption" color="text.secondary">
                  {prop.description}
                </Typography>
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <SchemaForm
              schema={prop}
              values={(getNestedValue(values, key) as Record<string, unknown>) || {}}
              onChange={v => onChange(setNestedValue(values, key, v))}
              depth={depth + 1}
            />
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
