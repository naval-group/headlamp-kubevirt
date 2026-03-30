import { useCallback, useState } from 'react';

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

const closed: ConfirmDialogState = {
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Delete',
  onConfirm: () => {},
};

/**
 * Hook to manage a ConfirmDialog's state.
 *
 * Usage:
 * ```tsx
 * const { dialogProps, confirm } = useConfirmDialog();
 *
 * confirm({
 *   title: 'Delete VM?',
 *   message: 'This cannot be undone.',
 *   confirmLabel: 'Delete',
 *   onConfirm: () => vm.delete(),
 * });
 *
 * <ConfirmDialog {...dialogProps} />
 * ```
 */
export default function useConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState>(closed);

  const confirm = useCallback((opts: Omit<ConfirmDialogState, 'open'>) => {
    setState({ ...opts, open: true });
  }, []);

  const cancel = useCallback(() => setState(closed), []);

  const dialogProps = {
    open: state.open,
    title: state.title,
    message: state.message,
    confirmLabel: state.confirmLabel,
    onConfirm: () => {
      state.onConfirm();
      setState(closed);
    },
    onCancel: cancel,
  };

  return { dialogProps, confirm, cancel };
}
