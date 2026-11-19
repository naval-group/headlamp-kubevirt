import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ImportVolumeForm from './ImportVolumeForm';

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

function makeDV(overrides: any = {}) {
  return {
    apiVersion: 'cdi.kubevirt.io/v1beta1',
    kind: 'DataVolume',
    metadata: { name: 'test-dv', namespace: 'default', ...overrides.metadata },
    spec: {
      source: { http: { url: '' } },
      storage: {
        resources: { requests: { storage: '30Gi' } },
        accessModes: ['ReadWriteOnce'],
        volumeMode: 'Filesystem',
      },
      contentType: 'kubevirt',
      ...overrides.spec,
    },
  };
}

describe('ImportVolumeForm', () => {
  // ─── Name and Namespace ──────────────────────────────────────────────

  describe('Name and Namespace', () => {
    it('renders name field', () => {
      render(<ImportVolumeForm resource={makeDV()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Name *')).toHaveValue('test-dv');
    });

    it('updates name', () => {
      const onChange = vi.fn();
      render(<ImportVolumeForm resource={makeDV()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'new-dv' } });

      expect(onChange.mock.calls[0][0].metadata.name).toBe('new-dv');
    });

    it('renders namespace autocomplete', () => {
      render(<ImportVolumeForm resource={makeDV()} onChange={vi.fn()} />);

      expect(screen.getByText('Namespace for the DataVolume')).toBeInTheDocument();
    });
  });

  // ─── Source Types ────────────────────────────────────────────────────

  describe('HTTP Source', () => {
    it('shows URL field for HTTP source', () => {
      render(<ImportVolumeForm resource={makeDV()} onChange={vi.fn()} />);

      expect(
        screen.getByText(
          'Import disk image from an HTTP/HTTPS URL. Supports ISO, qcow2, and raw formats.'
        )
      ).toBeInTheDocument();
      expect(screen.getByLabelText('URL *')).toBeInTheDocument();
    });

    it('updates HTTP URL', () => {
      const onChange = vi.fn();
      render(<ImportVolumeForm resource={makeDV()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('URL *'), {
        target: { value: 'https://example.com/disk.qcow2' },
      });

      expect(onChange.mock.calls[0][0].spec.source.http.url).toBe('https://example.com/disk.qcow2');
    });
  });

  describe('Registry Source', () => {
    it('shows registry URL field', () => {
      const dv = makeDV({
        spec: {
          source: { registry: { url: '' } },
          storage: {
            resources: { requests: { storage: '30Gi' } },
            accessModes: ['ReadWriteOnce'],
            volumeMode: 'Filesystem',
          },
          contentType: 'kubevirt',
        },
      });
      render(<ImportVolumeForm resource={dv} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Registry URL *')).toBeInTheDocument();
      expect(screen.getByText('Import disk image from a container registry.')).toBeInTheDocument();
    });
  });

  describe('Blank Source', () => {
    it('shows blank disk message', () => {
      const dv = makeDV({
        spec: {
          source: { blank: {} },
          storage: {
            resources: { requests: { storage: '30Gi' } },
            accessModes: ['ReadWriteOnce'],
            volumeMode: 'Filesystem',
          },
          contentType: 'kubevirt',
        },
      });
      render(<ImportVolumeForm resource={dv} onChange={vi.fn()} />);

      expect(screen.getByText('Create an empty disk with the specified size.')).toBeInTheDocument();
    });
  });

  describe('Upload Source', () => {
    it('shows virtctl command for upload', () => {
      const dv = makeDV({
        spec: {
          source: { upload: {} },
          storage: {
            resources: { requests: { storage: '30Gi' } },
            accessModes: ['ReadWriteOnce'],
            volumeMode: 'Filesystem',
          },
          contentType: 'kubevirt',
        },
      });
      render(<ImportVolumeForm resource={dv} onChange={vi.fn()} />);

      // Multiple virtctl commands shown (create+upload and upload-only)
      const commands = screen.getAllByText(/virtctl image-upload/);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Upload Mode/)).toBeInTheDocument();
    });
  });

  describe('PVC Clone Source', () => {
    it('shows PVC clone fields', () => {
      const dv = makeDV({
        spec: {
          source: { pvc: { name: '', namespace: 'default' } },
          storage: {
            resources: { requests: { storage: '30Gi' } },
            accessModes: ['ReadWriteOnce'],
            volumeMode: 'Filesystem',
          },
          contentType: 'kubevirt',
        },
      });
      render(<ImportVolumeForm resource={dv} onChange={vi.fn()} />);

      expect(screen.getByText('Clone an existing PVC to create a new volume.')).toBeInTheDocument();
    });
  });

  describe('Snapshot Source', () => {
    it('shows snapshot restore fields', () => {
      const dv = makeDV({
        spec: {
          source: { snapshot: { name: '', namespace: 'default' } },
          storage: {
            resources: { requests: { storage: '30Gi' } },
            accessModes: ['ReadWriteOnce'],
            volumeMode: 'Filesystem',
          },
          contentType: 'kubevirt',
        },
      });
      render(<ImportVolumeForm resource={dv} onChange={vi.fn()} />);

      expect(screen.getByText('Restore from an existing VolumeSnapshot.')).toBeInTheDocument();
    });
  });

  // ─── Storage Configuration ───────────────────────────────────────────

  describe('Storage Configuration', () => {
    it('renders storage size field', () => {
      render(<ImportVolumeForm resource={makeDV()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Size *')).toHaveValue(30);
    });

    it('updates storage size', () => {
      const onChange = vi.fn();
      render(<ImportVolumeForm resource={makeDV()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Size *'), { target: { value: '50' } });

      expect(onChange.mock.calls[0][0].spec.storage.resources.requests.storage).toBe('50Gi');
    });

    it('renders storage class autocomplete', () => {
      render(<ImportVolumeForm resource={makeDV()} onChange={vi.fn()} />);

      expect(
        screen.getByText('Storage class for the PVC (leave empty for default)')
      ).toBeInTheDocument();
    });

    it('renders access mode selector', () => {
      render(<ImportVolumeForm resource={makeDV()} onChange={vi.fn()} />);

      expect(screen.getByText('Access Mode')).toBeInTheDocument();
    });

    it('renders volume mode selector', () => {
      render(<ImportVolumeForm resource={makeDV()} onChange={vi.fn()} />);

      expect(screen.getByText('Volume Mode')).toBeInTheDocument();
    });

    it('renders content type selector for non-blank sources', () => {
      render(<ImportVolumeForm resource={makeDV()} onChange={vi.fn()} />);

      expect(screen.getByText('Content Type')).toBeInTheDocument();
    });

    it('hides content type for blank sources', () => {
      const dv = makeDV({
        spec: {
          source: { blank: {} },
          storage: {
            resources: { requests: { storage: '30Gi' } },
            accessModes: ['ReadWriteOnce'],
            volumeMode: 'Filesystem',
          },
          contentType: 'kubevirt',
        },
      });
      render(<ImportVolumeForm resource={dv} onChange={vi.fn()} />);

      expect(screen.queryByText('Content Type')).not.toBeInTheDocument();
    });
  });
});
