import { SxProps, TextField, TextFieldProps, Theme } from '@mui/material';
import React from 'react';

/** Warning styles for mandatory fields — use with Autocomplete renderInput or standalone TextFields */
export const mandatoryFieldSx: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    '& fieldset': { borderColor: 'warning.main' },
    '&:hover fieldset': { borderColor: 'warning.dark' },
    '&.Mui-focused fieldset': { borderColor: 'warning.main' },
  },
  '& .MuiInputLabel-root': { color: 'warning.main' },
  '& .MuiFormHelperText-root': { color: 'warning.main' },
};

type MandatoryTextFieldProps = TextFieldProps & {
  /** When true, shows warning state if the field value is empty */
  showErrors?: boolean;
  /** Message shown when field is empty and showErrors is true. Defaults to "{label} is required" */
  errorMessage?: string;
};

/**
 * A TextField wrapper for mandatory form fields.
 * Shows a soft warning (amber border + helper text) when showErrors is true and value is empty.
 */
export default function MandatoryTextField({
  showErrors = false,
  errorMessage,
  helperText,
  label,
  value,
  sx,
  ...props
}: MandatoryTextFieldProps) {
  const isEmpty = !value || (typeof value === 'string' && value.trim() === '');
  const showWarning = showErrors && isEmpty;
  const defaultErrorMessage = errorMessage || `${label} is required`;

  return (
    <TextField
      {...props}
      required
      label={label}
      value={value}
      helperText={showWarning ? defaultErrorMessage : helperText}
      data-mandatory-empty={showWarning ? 'true' : undefined}
      sx={[
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ...(showWarning ? [mandatoryFieldSx] : []),
      ]}
    />
  );
}
