import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataSourceForm from './DataSourceForm';

// Mock ApiProxy
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: {
    request: vi.fn().mockResolvedValue({ items: [] }),
  },
  K8s: {
    cluster: {
      getAllowedNamespaces: () => [],
    },
  },
}));

// Mock DataSource.useList
vi.mock('./DataSource', () => ({
  default: {
    useList: () => ({ items: [] }),
  },
}));

function makeDataSource(overrides: any = {}) {
  return {
    apiVersion: 'cdi.kubevirt.io/v1beta1',
    kind: 'DataSource',
    metadata: { name: 'test-ds', namespace: 'default', ...overrides.metadata },
    spec: {
      source: {
        pvc: { name: '', namespace: 'default' },
      },
      ...overrides.spec,
    },
  };
}

describe('DataSourceForm', () => {
  // ─── Name and Namespace ──────────────────────────────────────────────

  describe('Name and Namespace', () => {
    it('renders name field', () => {
      render(<DataSourceForm resource={makeDataSource()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Name *')).toHaveValue('test-ds');
    });

    it('updates name', () => {
      const onChange = vi.fn();
      render(<DataSourceForm resource={makeDataSource()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'new-ds' } });

      expect(onChange.mock.calls[0][0].metadata.name).toBe('new-ds');
    });

    it('renders namespace autocomplete', () => {
      render(<DataSourceForm resource={makeDataSource()} onChange={vi.fn()} />);

      expect(screen.getByText('Namespace for the DataSource')).toBeInTheDocument();
    });
  });

  // ─── Source Type Selection ───────────────────────────────────────────

  describe('Source Type Selection', () => {
    it('defaults to PVC source type', () => {
      render(<DataSourceForm resource={makeDataSource()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('PVC (PersistentVolumeClaim)')).toBeChecked();
    });

    it('shows PVC fields when PVC selected', () => {
      render(<DataSourceForm resource={makeDataSource()} onChange={vi.fn()} />);

      expect(
        screen.getByText('Reference an existing PVC as the source for this DataSource')
      ).toBeInTheDocument();
    });

    it('switches to VolumeSnapshot type', () => {
      const onChange = vi.fn();
      render(<DataSourceForm resource={makeDataSource()} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('VolumeSnapshot'));

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.source.snapshot).toBeDefined();
      expect(updated.spec.source.pvc).toBeUndefined();
    });

    it('shows snapshot fields when snapshot selected', () => {
      const res = makeDataSource({
        spec: { source: { snapshot: { name: '', namespace: 'default' } } },
      });
      render(<DataSourceForm resource={res} onChange={vi.fn()} />);

      expect(
        screen.getByText('Reference an existing VolumeSnapshot as the source for this DataSource')
      ).toBeInTheDocument();
    });

    it('switches to DataSource reference type', () => {
      const onChange = vi.fn();
      render(<DataSourceForm resource={makeDataSource()} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('DataSource (Reference, max depth 1)'));

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.source.dataSource).toBeDefined();
    });

    it('shows DataSource reference fields when selected', () => {
      const res = makeDataSource({
        spec: { source: { dataSource: { name: '', namespace: 'default' } } },
      });
      render(<DataSourceForm resource={res} onChange={vi.fn()} />);

      expect(
        screen.getByText('Reference another DataSource (maximum depth of 1)')
      ).toBeInTheDocument();
    });
  });

  // ─── Information Note ────────────────────────────────────────────────

  describe('Information', () => {
    it('shows DataImportCron note', () => {
      render(<DataSourceForm resource={makeDataSource()} onChange={vi.fn()} />);

      expect(
        screen.getByText(/DataSources are typically managed automatically by DataImportCrons/)
      ).toBeInTheDocument();
    });
  });
});
