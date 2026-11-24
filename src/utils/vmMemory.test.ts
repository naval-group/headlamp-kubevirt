import { describe, expect, it } from 'vitest';
import {
  getGuestMemory,
  hugepagesMemoryError,
  memoryLimitError,
  quantityToBytes,
  toFormMemory,
  withGuestMemory,
} from './vmMemory';

describe('quantityToBytes', () => {
  it('parses binary, decimal and plain quantities', () => {
    expect(quantityToBytes('4Gi')).toBe(4 * 2 ** 30);
    expect(quantityToBytes('4096Mi')).toBe(4 * 2 ** 30);
    expect(quantityToBytes('4G')).toBe(4e9);
    expect(quantityToBytes('1024')).toBe(1024);
  });
  it('returns null for invalid input', () => {
    expect(quantityToBytes('')).toBeNull();
    expect(quantityToBytes('four')).toBeNull();
    expect(quantityToBytes(undefined)).toBeNull();
  });
});

describe('getGuestMemory', () => {
  it('prefers memory.guest over resources', () => {
    expect(
      getGuestMemory({ memory: { guest: '16Gi' }, resources: { requests: { memory: '8Gi' } } })
    ).toBe('16Gi');
  });
  it('falls back to requests then limits for older VMs', () => {
    expect(getGuestMemory({ resources: { requests: { memory: '8Gi' } } })).toBe('8Gi');
    expect(getGuestMemory({ resources: { limits: { memory: '2Gi' } } })).toBe('2Gi');
  });
  it('returns undefined when nothing is set (no hard-coded default)', () => {
    expect(getGuestMemory({})).toBeUndefined();
    expect(getGuestMemory(undefined)).toBeUndefined();
  });
});

describe('toFormMemory', () => {
  it('uses GiB for whole GiB values and MiB otherwise', () => {
    expect(toFormMemory('16384Mi')).toEqual({ value: '16', unit: 'Gi' });
    expect(toFormMemory('1536Mi')).toEqual({ value: '1536', unit: 'Mi' });
    expect(toFormMemory('64Gi')).toEqual({ value: '64', unit: 'Gi' });
  });
  it('returns null for values not representable in MiB', () => {
    expect(toFormMemory('4G')).toBeNull();
    expect(toFormMemory(undefined)).toBeNull();
  });
});

describe('hugepagesMemoryError', () => {
  it('accepts whole multiples of the page size', () => {
    expect(hugepagesMemoryError('16Gi', '1Gi')).toBeNull();
    expect(hugepagesMemoryError('1536Mi', '2Mi')).toBeNull();
  });
  it('rejects memory below or not a multiple of the page size', () => {
    expect(hugepagesMemoryError('512Mi', '1Gi')).toMatch(/at least/);
    expect(hugepagesMemoryError('1536Mi', '1Gi')).toMatch(/multiple/);
  });
  it('ignores VMs without hugepages', () => {
    expect(hugepagesMemoryError('1536Mi', '')).toBeNull();
  });
});

describe('withGuestMemory', () => {
  it('sets memory.guest and leaves hugepages and resources alone', () => {
    const domain = {
      memory: { guest: '16Gi', hugepages: { pageSize: '1Gi' } },
      resources: { requests: { memory: '16Gi' }, limits: { memory: '16Gi' } },
    };
    const next = withGuestMemory(domain, '8Gi');
    expect(next.memory).toEqual({ guest: '8Gi', hugepages: { pageSize: '1Gi' } });
    expect(next.resources).toBe(domain.resources);
    expect(domain.memory.guest).toBe('16Gi'); // not mutated
  });
  it('removes guest (and an empty memory block) when cleared', () => {
    expect(withGuestMemory({ memory: { guest: '2Gi' } }, undefined)).toEqual({});
    expect(
      withGuestMemory({ memory: { guest: '2Gi', hugepages: { pageSize: '2Mi' } } }, undefined)
    ).toEqual({
      memory: { hugepages: { pageSize: '2Mi' } },
    });
  });
});

describe('memoryLimitError', () => {
  it('flags guest memory above the memory limit', () => {
    expect(
      memoryLimitError({ memory: { guest: '32Gi' }, resources: { limits: { memory: '16Gi' } } })
    ).toMatch(/limits\.memory \(16Gi\)/);
  });
  it('accepts guest memory within the limit or without a limit', () => {
    expect(
      memoryLimitError({ memory: { guest: '16Gi' }, resources: { limits: { memory: '16Gi' } } })
    ).toBeNull();
    expect(memoryLimitError({ memory: { guest: '64Gi' } })).toBeNull();
  });
});
