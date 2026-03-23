/**
 * Workflow tests — simulate a user creating a DataImportCron end-to-end.
 */
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import DataImportCronForm from './DataImportCronForm';

// Mock ApiProxy
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: {
    request: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

function FormWrapper({ initial }: { initial: any }) {
  const [resource, setResource] = useState(initial);
  return (
    <>
      <DataImportCronForm resource={resource} onChange={setResource} />
      <div data-testid="resource-snapshot">{JSON.stringify(resource)}</div>
    </>
  );
}

function getResource(): any {
  return JSON.parse(screen.getByTestId('resource-snapshot').textContent!);
}

function getSwitch(labelText: string): HTMLInputElement {
  const labelEl = screen.getByText(labelText);
  const fcl = labelEl.closest('.MuiFormControlLabel-root');
  if (!fcl) throw new Error(`No FormControlLabel for "${labelText}"`);
  const input = fcl.querySelector('input[type="checkbox"]') as HTMLInputElement;
  if (!input) throw new Error(`No checkbox for "${labelText}"`);
  return input;
}

const INITIAL_DIC = {
  apiVersion: 'cdi.kubevirt.io/v1beta1',
  kind: 'DataImportCron',
  metadata: { name: '', namespace: 'default' },
  spec: {
    managedDataSource: '',
    schedule: '0 0 * * *',
    garbageCollect: 'Outdated',
    template: {
      spec: {
        source: { registry: { url: '' } },
        storage: {
          resources: { requests: { storage: '' } },
          accessModes: ['ReadWriteOnce'],
          volumeMode: 'Filesystem',
        },
      },
    },
  },
};

describe('DataImportCronForm Workflows', () => {
  it('creates a registry-based DataImportCron with full config', () => {
    render(<FormWrapper initial={INITIAL_DIC} />);

    // Step 1: Basic info
    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: 'fedora-nightly' },
    });
    fireEvent.change(screen.getByLabelText('Managed DataSource *'), {
      target: { value: 'fedora-cloud' },
    });

    // Step 2: Set imports to keep
    fireEvent.change(screen.getByLabelText('Imports to Keep'), {
      target: { value: '3' },
    });

    // Step 3: Registry URL (already on registry by default)
    fireEvent.change(screen.getByLabelText('Registry URL *'), {
      target: { value: 'docker://quay.io/containerdisks/fedora:40' },
    });

    // Step 4: Storage
    fireEvent.change(screen.getByLabelText('Storage Size *'), {
      target: { value: '30' },
    });

    // Step 5: Enable preallocation
    fireEvent.click(getSwitch('Preallocation'));

    // ── Verify ──
    const resource = getResource();
    expect(resource.metadata.name).toBe('fedora-nightly');
    expect(resource.spec.managedDataSource).toBe('fedora-cloud');
    expect(resource.spec.schedule).toBe('0 0 * * *');
    expect(resource.spec.importsToKeep).toBe(3);
    expect(resource.spec.template.spec.source.registry.url).toBe(
      'docker://quay.io/containerdisks/fedora:40'
    );
    expect(resource.spec.template.spec.storage.resources.requests.storage).toBe('30Gi');
    expect(resource.spec.template.spec.preallocation).toBe(true);
  });

  it('creates an HTTP-based DataImportCron', () => {
    render(<FormWrapper initial={INITIAL_DIC} />);

    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: 'ubuntu-weekly' },
    });
    fireEvent.change(screen.getByLabelText('Managed DataSource *'), {
      target: { value: 'ubuntu-24' },
    });

    // Switch to HTTP source
    fireEvent.click(screen.getByLabelText('HTTP'));

    // Fill HTTP URL
    fireEvent.change(screen.getByLabelText('HTTP URL *'), {
      target: {
        value: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
      },
    });

    // Storage
    fireEvent.change(screen.getByLabelText('Storage Size *'), {
      target: { value: '20' },
    });

    // ── Verify ──
    const resource = getResource();
    expect(resource.spec.template.spec.source.http.url).toBe(
      'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img'
    );
    expect(resource.spec.template.spec.source.registry).toBeUndefined();
  });

  it('switches from registry to S3 to blank — source changes cleanly', () => {
    render(<FormWrapper initial={INITIAL_DIC} />);

    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: 'source-test' },
    });

    // Default is registry
    expect(screen.getByLabelText('Container Registry')).toBeChecked();

    // Switch to S3
    fireEvent.click(screen.getByLabelText('S3'));
    fireEvent.change(screen.getByLabelText('S3 URL *'), {
      target: { value: 's3://mybucket/images/disk.img' },
    });

    let resource = getResource();
    expect(resource.spec.template.spec.source.s3.url).toBe('s3://mybucket/images/disk.img');
    expect(resource.spec.template.spec.source.registry).toBeUndefined();

    // Switch to Blank
    fireEvent.click(screen.getByLabelText('Blank'));

    resource = getResource();
    expect(resource.spec.template.spec.source.blank).toEqual({});
    expect(resource.spec.template.spec.source.s3).toBeUndefined();
    expect(resource.spec.template.spec.source.registry).toBeUndefined();
  });
});
