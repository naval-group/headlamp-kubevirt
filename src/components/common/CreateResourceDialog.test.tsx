import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { SnackbarProvider } from 'notistack';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Resource: { EditorDialog: () => null },
}));
vi.mock('@monaco-editor/react', () => ({ default: () => null, DiffEditor: () => null }));
vi.mock('./CRDDocsViewer', () => ({ default: () => null }));

import CreateResourceDialog, { saveErrorMessage } from './CreateResourceDialog';

/* eslint-disable @typescript-eslint/no-explicit-any */
function MemoryForm({ resource }: { resource: any }) {
  return <div data-testid="memory">{resource?.spec?.memory}</div>;
}

const vm = (memory: string, rv: string) => ({
  apiVersion: 'kubevirt.io/v1',
  kind: 'VirtualMachine',
  metadata: { name: 'vm1', namespace: 'ns1', resourceVersion: rv },
  spec: { memory },
});

function renderDialog(open: boolean, initialResource: any) {
  return (
    <SnackbarProvider>
      <CreateResourceDialog
        open={open}
        onClose={vi.fn()}
        title="Edit"
        resourceClass={{ apiEndpoint: { put: vi.fn(), post: vi.fn() } } as any}
        initialResource={initialResource}
        editMode
        formComponent={MemoryForm as any}
      />
    </SnackbarProvider>
  );
}

describe('CreateResourceDialog', () => {
  it('loads the latest resource each time it opens', () => {
    const { rerender } = render(renderDialog(true, vm('1Gi', '1')));
    expect(screen.getByTestId('memory')).toHaveTextContent('1Gi');

    // Closed, then the resource changes on the cluster (e.g. edited elsewhere)
    rerender(renderDialog(false, vm('1Gi', '1')));
    rerender(renderDialog(false, vm('2Gi', '2')));

    rerender(renderDialog(true, vm('2Gi', '2')));
    expect(screen.getByTestId('memory')).toHaveTextContent('2Gi');
  });

  it('does not overwrite the form while open when the resource updates', () => {
    const { rerender } = render(renderDialog(true, vm('1Gi', '1')));
    rerender(renderDialog(true, vm('3Gi', '3')));
    expect(screen.getByTestId('memory')).toHaveTextContent('1Gi');
  });
});

describe('saveErrorMessage', () => {
  it('explains a conflict', () => {
    expect(saveErrorMessage({ status: 409, message: 'conflict' }, true)).toMatch(
      /changed by someone else.*reopen/
    );
  });
  it('includes the API server reason', () => {
    expect(saveErrorMessage(new Error('admission webhook denied'), true)).toBe(
      'Failed to update resource: admission webhook denied'
    );
    expect(saveErrorMessage({}, false)).toBe('Failed to create resource.');
  });
});
