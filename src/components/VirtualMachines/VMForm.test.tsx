import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VMForm from './VMForm';

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
vi.mock('../BootableVolumes/DataSource', () => ({
  default: {
    useList: () => ({ items: [] }),
  },
}));

// Mock InstanceType.useList
vi.mock('../InstanceTypes/VirtualMachineClusterInstanceType', () => ({
  default: {
    useList: () => ({ items: [] }),
  },
}));

// Mock Preference.useList
vi.mock('../Preferences/VirtualMachineClusterPreference', () => ({
  default: {
    useList: () => ({ items: [] }),
  },
}));

function makeVM(overrides: any = {}) {
  return {
    apiVersion: 'kubevirt.io/v1',
    kind: 'VirtualMachine',
    metadata: { name: 'test-vm', namespace: 'default', ...overrides.metadata },
    spec: {
      running: false,
      template: {
        spec: {
          domain: {
            cpu: { cores: 2 },
            resources: { requests: { memory: '4Gi' } },
          },
        },
      },
      dataVolumeTemplates: [
        {
          metadata: { name: 'test-vm-disk' },
          spec: {
            source: { pvc: { name: '', namespace: '' } },
            pvc: {
              accessModes: ['ReadWriteOnce'],
              resources: { requests: { storage: '30Gi' } },
            },
          },
        },
      ],
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

describe('VMForm', () => {
  // ─── Basic Information ───────────────────────────────────────────────

  describe('Basic Information', () => {
    it('renders name field', () => {
      render(<VMForm resource={makeVM()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Name *')).toHaveValue('test-vm');
    });

    it('updates name', () => {
      const onChange = vi.fn();
      render(<VMForm resource={makeVM()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'new-vm' } });

      expect(onChange.mock.calls[0][0].metadata.name).toBe('new-vm');
    });

    it('renders namespace selector', () => {
      render(<VMForm resource={makeVM()} onChange={vi.fn()} />);

      expect(screen.getByText('Namespace for the Virtual Machine')).toBeInTheDocument();
    });

    it('renders boot source autocomplete', () => {
      render(<VMForm resource={makeVM()} onChange={vi.fn()} />);

      expect(
        screen.getByText('Select a bootable volume (DataSource) to boot from')
      ).toBeInTheDocument();
    });
  });

  // ─── Resource Configuration ──────────────────────────────────────────

  describe('Resource Configuration', () => {
    it('defaults to custom resources mode', () => {
      render(<VMForm resource={makeVM()} onChange={vi.fn()} />);

      // Custom resources radio should be selected by default (no instancetype in spec)
      expect(screen.getByLabelText('Custom Resources')).toBeChecked();
    });

    it('shows CPU and memory fields in custom mode', () => {
      render(<VMForm resource={makeVM()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('CPU Cores *')).toHaveValue(2);
      expect(screen.getByLabelText('Memory *')).toHaveValue(4);
    });

    it('updates CPU cores', () => {
      const onChange = vi.fn();
      render(<VMForm resource={makeVM()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('CPU Cores *'), { target: { value: '8' } });

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.template.spec.domain.cpu.cores).toBe(8);
    });

    it('updates memory', () => {
      const onChange = vi.fn();
      render(<VMForm resource={makeVM()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Memory *'), { target: { value: '16' } });

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.template.spec.domain.resources.requests.memory).toBe('16Gi');
    });

    it('switches to instance type mode', () => {
      const onChange = vi.fn();
      render(<VMForm resource={makeVM()} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('Use Instance Type'));

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.instancetype).toBeDefined();
      expect(updated.spec.instancetype.kind).toBe('VirtualMachineClusterInstancetype');
    });

    it('shows instance type fields in instance type mode', () => {
      const vm = makeVM({
        spec: {
          instancetype: { kind: 'VirtualMachineClusterInstancetype', name: '' },
          running: false,
          template: { spec: { domain: {} } },
          dataVolumeTemplates: [
            {
              metadata: { name: 'test-vm-disk' },
              spec: {
                source: {},
                pvc: {
                  accessModes: ['ReadWriteOnce'],
                  resources: { requests: { storage: '30Gi' } },
                },
              },
            },
          ],
        },
      });
      render(<VMForm resource={vm} onChange={vi.fn()} />);

      expect(screen.getByText('Pre-defined CPU and memory configuration')).toBeInTheDocument();
      expect(screen.getByText('Operating system preferences')).toBeInTheDocument();
    });

    it('switches back to custom mode', () => {
      const onChange = vi.fn();
      const vm = makeVM({
        spec: {
          instancetype: { kind: 'VirtualMachineClusterInstancetype', name: 'u1.medium' },
          running: false,
          template: { spec: { domain: {} } },
          dataVolumeTemplates: [
            {
              metadata: { name: 'test-vm-disk' },
              spec: {
                source: {},
                pvc: {
                  accessModes: ['ReadWriteOnce'],
                  resources: { requests: { storage: '30Gi' } },
                },
              },
            },
          ],
        },
      });
      render(<VMForm resource={vm} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('Custom Resources'));

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.instancetype).toBeUndefined();
    });
  });

  // ─── Storage ─────────────────────────────────────────────────────────

  describe('Storage', () => {
    it('renders storage size field', () => {
      render(<VMForm resource={makeVM()} onChange={vi.fn()} />);

      expect(screen.getByLabelText('Storage Size *')).toHaveValue(30);
    });

    it('updates storage size', () => {
      const onChange = vi.fn();
      render(<VMForm resource={makeVM()} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('Storage Size *'), { target: { value: '50' } });

      const updated = onChange.mock.calls[0][0];
      expect(updated.spec.dataVolumeTemplates[0].spec.pvc.resources.requests.storage).toBe('50Gi');
    });

    it('renders storage class selector', () => {
      render(<VMForm resource={makeVM()} onChange={vi.fn()} />);

      expect(screen.getByText('Storage class for the disk')).toBeInTheDocument();
    });
  });

  // ─── VM Control ──────────────────────────────────────────────────────

  describe('VM Control', () => {
    it('renders start VM switch', () => {
      render(<VMForm resource={makeVM()} onChange={vi.fn()} />);

      expect(screen.getByText('Start VM after creation')).toBeInTheDocument();
    });

    it('toggles running state', () => {
      const onChange = vi.fn();
      render(<VMForm resource={makeVM()} onChange={onChange} />);

      fireEvent.click(getSwitch('Start VM after creation'));

      expect(onChange.mock.calls[0][0].spec.running).toBe(true);
    });
  });
});
