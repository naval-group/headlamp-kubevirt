import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import React, { useCallback, useState } from 'react';

interface UnsavedChangesGuardProps {
  dirty: boolean;
  onClose: () => void;
  children: (guardedClose: () => void) => React.ReactNode;
}

/**
 * Wraps a dialog's close behavior with an "unsaved changes" confirmation.
 *
 * Usage:
 * ```tsx
 * <UnsavedChangesGuard dirty={isDirty} onClose={handleClose}>
 *   {(guardedClose) => (
 *     <Dialog open={open} onClose={guardedClose}>
 *       ...
 *     </Dialog>
 *   )}
 * </UnsavedChangesGuard>
 * ```
 */
export default function UnsavedChangesGuard({
  dirty,
  onClose,
  children,
}: UnsavedChangesGuardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const guardedClose = useCallback(() => {
    if (dirty) {
      setConfirmOpen(true);
    } else {
      onClose();
    }
  }, [dirty, onClose]);

  return (
    <>
      {children(guardedClose)}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="xs"
        sx={{ zIndex: 9999 }}
      >
        <DialogTitle>Unsaved Changes</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You have unsaved changes. Are you sure you want to close? Your changes will be lost.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Continue Editing</Button>
          <Button
            onClick={() => {
              setConfirmOpen(false);
              onClose();
            }}
            color="error"
            variant="contained"
          >
            Discard Changes
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
