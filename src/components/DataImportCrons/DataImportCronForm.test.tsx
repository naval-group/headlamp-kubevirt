import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataImportCronForm from './DataImportCronForm';

// Mock ApiProxy
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: {
    request: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

function makeDIC(overrides: any = {}) {
  return {
    apiVersion: 'cdi.kubevirt.io/v1beta1',
    kind: 'DataImportCron',
    metadata: { name: 'test-dic', namespace: 'default', ...overrides.metadata },
    spec: {
      managedDataSource: 'fedora',
      schedule: '0 0 * * *',
      garbageCollect: { outdated: 'Outdated' },
      source: { registry: { url: 'docker://quay.io/containerdisks/fedora:latest' } },
      template: {
        spec: {
          pvc: {
            resources: { requests: { storage: '30Gi' } },
            accessModes: ['ReadWriteOnce'],
            volumeMode: 'Filesystem',
          },
        },
      },
      ...overrides.spec,
    },
  };
}

function getSwitch(labelText: string): HTMLInputElement {
  const labelEl = screen.getByText(labelText);
  const fcl = labelEl.closest('.MuiFormControlLabel-root');
  if (!fcl) throw new Error(`No FormControlLabel for "${labelText}"`);
  const input = fcl.querySelector('input[type="checkbox"]') as HTMLInputElement;
  if (!input) throw new Error(`No checkbox for "${labelText}"`);
  return input;
}

describe('DataImportCronForm', () => {
  // ─── Basic Information ───────────────────────────────────────────────

  describe('Basic Information', () => {
    it('renders name field', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Name *')).toHaveValue('test-dic');
    });

    it('updates name', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'new-dic' } });

      expect(onChange.mock.calls[0][0].metadata.name).toBe('new-dic');
    });

    it('renders managed datasource field', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Managed DataSource *')).toHaveValue('fedora');
    });

    it('updates managed datasource', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Managed DataSource *'), {
        target: { value: 'ubuntu' },
      });

      expect(onChange.mock.calls[0][0].spec.managedDataSource).toBe('ubuntu');
    });

    it('renders schedule selector', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByText('Schedule')).toBeInTheDocument();
    });
  });

  // ─── Garbage Collection ──────────────────────────────────────────────

  describe('Garbage Collection', () => {
    it('renders garbage collect selector', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByText('When to garbage collect old imports')).toBeInTheDocument();
    });

    it('shows imports to keep when Outdated selected', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Imports to Keep')).toBeInTheDocument();
    });

    it('updates imports to keep as number', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Imports to Keep'), { target: { value: '3' } });

      expect(onChange.mock.calls[0][0].spec.importsToKeep).toBe(3);
    });

    it('clears imports to keep when emptied', () => {
      const onChange = vi.fn();
      const res = makeDIC({ spec: { ...makeDIC().spec, importsToKeep: 3 } });
      render(<DataImportCronForm resource={res} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Imports to Keep'), { target: { value: '' } });

      expect(onChange.mock.calls[0][0].spec.importsToKeep).toBeUndefined();
    });

    it('hides imports to keep when Never selected', () => {
      const res = makeDIC({
        spec: {
          ...makeDIC().spec,
          garbageCollect: { outdated: 'Never' },
        },
      });
      render(<DataImportCronForm resource={res} onChange={vi.fn()} />);

      expect(screen.queryByLabelText('Imports to Keep')).not.toBeInTheDocument();
    });
  });

  // ─── Source Configuration ────────────────────────────────────────────

  describe('Source Configuration', () => {
    it('defaults to registry source', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Container Registry')).toBeChecked();
    });

    it('shows registry URL field', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Registry URL *')).toBeInTheDocument();
    });

    it('updates registry URL', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Registry URL *'), {
        target: { value: 'docker://new-registry/image:v1' },
      });

      expect(onChange.mock.calls[0][0].spec.source.registry.url).toBe(
        'docker://new-registry/image:v1'
      );
    });

    it('switches to HTTP source', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('HTTP'));

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.source.http).toBeDefined();
      expect(updated.spec.source.registry).toBeUndefined();
    });

    it('shows HTTP URL field when HTTP selected', () => {
      const res = makeDIC({
        spec: {
          ...makeDIC().spec,
          source: { http: { url: '' } },
        },
      });
      render(<DataImportCronForm resource={res} onChange={vi.fn()} />);

      expect(screen.getByLabelText('HTTP URL *')).toBeInTheDocument();
    });

    it('switches to S3 source', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('S3'));

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.source.s3).toBeDefined();
    });

    it('shows S3 URL field when S3 selected', () => {
      const res = makeDIC({
        spec: {
          ...makeDIC().spec,
          source: { s3: { url: '' } },
        },
      });
      render(<DataImportCronForm resource={res} onChange={vi.fn()} />);

      expect(screen.getByLabelText('S3 URL *')).toBeInTheDocument();
    });

    it('switches to Blank source', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('Blank'));

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.source.blank).toBeDefined();
    });
  });

  // ─── Storage Configuration ───────────────────────────────────────────

  describe('Storage Configuration', () => {
    it('renders storage size field', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Storage Size *')).toHaveValue(30);
    });

    it('updates storage size', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Storage Size *'), { target: { value: '50' } });

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.template.spec.pvc.resources.requests.storage).toBe('50Gi');
    });

    it('renders storage class selector', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByText('Storage class for the PVC')).toBeInTheDocument();
    });

    it('renders access mode selector', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByText('Volume access mode')).toBeInTheDocument();
    });

    it('renders volume mode selector', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByText('Volume mode')).toBeInTheDocument();
    });

    it('renders preallocation switch', () => {
      render(<DataImportCronForm resource={makeDIC()} onChange={vi.fn()} />);

      expect(screen.getByText('Preallocation')).toBeInTheDocument();
    });

    it('toggles preallocation', () => {
      const onChange = vi.fn();
      render(<DataImportCronForm resource={makeDIC()} onChange={onChange} />);

      fireEvent.click(getSwitch('Preallocation'));

      expect(onChange.mock.calls[0][0].spec.template.spec.preallocation).toBe(true);
    });
  });
});
