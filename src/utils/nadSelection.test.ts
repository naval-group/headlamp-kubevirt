import { describe, expect, it } from 'vitest';
import { parseNamespaceList } from './clusterConfig';
import { buildNadOptions, nadListNamespaces, parseNadRef, toNadRef } from './nadSelection';

describe('parseNadRef', () => {
  it('treats a plain name as the VM namespace', () => {
    expect(parseNadRef('mgmt', 'tenant-a')).toEqual({ namespace: 'tenant-a', name: 'mgmt' });
  });
  it('splits namespace/name', () => {
    expect(parseNadRef('networks/mgmt', 'tenant-a')).toEqual({
      namespace: 'networks',
      name: 'mgmt',
    });
  });
});

describe('toNadRef', () => {
  it('omits the namespace for NADs in the VM namespace', () => {
    expect(toNadRef('tenant-a', 'mgmt', 'tenant-a')).toBe('mgmt');
  });
  it('prefixes the namespace for NADs elsewhere', () => {
    expect(toNadRef('networks', 'mgmt', 'tenant-a')).toBe('networks/mgmt');
  });
});

describe('nadListNamespaces', () => {
  it('lists all namespaces when no shared namespaces are configured', () => {
    expect(nadListNamespaces('tenant-a', [], false)).toBeUndefined();
  });
  it('falls back to the VM namespace when listing all is forbidden', () => {
    expect(nadListNamespaces('tenant-a', [], true)).toEqual(['tenant-a']);
  });
  it('lists the VM namespace plus shared namespaces, without duplicates', () => {
    expect(nadListNamespaces('networks', ['networks', 'default'], false)).toEqual([
      'networks',
      'default',
    ]);
    expect(nadListNamespaces('tenant-a', ['networks', 'default'], true)).toEqual([
      'tenant-a',
      'networks',
      'default',
    ]);
  });
});

describe('buildNadOptions', () => {
  const nads = [
    { namespace: 'networks', name: 'mgmt' },
    { namespace: 'default', name: 'mgmt' },
    { namespace: 'tenant-a', name: 'trunk-net' },
    { namespace: 'networks', name: 'dmz' },
  ];

  it('puts the VM namespace first and stores ns/name for other namespaces', () => {
    const options = buildNadOptions(nads, 'tenant-a');
    expect(options.map(o => o.value)).toEqual([
      'trunk-net',
      'default/mgmt',
      'networks/dmz',
      'networks/mgmt',
    ]);
  });

  it('keeps NADs already set on the VM even if not listed', () => {
    const options = buildNadOptions(nads, 'tenant-a', ['other/legacy', 'networks/dmz', '']);
    const legacy = options.find(o => o.value === 'other/legacy');
    expect(legacy).toEqual({
      value: 'other/legacy',
      namespace: 'other',
      name: 'legacy',
      unlisted: true,
    });
    expect(options.filter(o => o.value === 'networks/dmz')).toHaveLength(1);
  });

  it('normalises an explicit own-namespace reference to the plain name', () => {
    const options = buildNadOptions([], 'tenant-a', ['tenant-a/trunk-net']);
    expect(options[0].value).toBe('trunk-net');
  });
});

describe('parseNamespaceList', () => {
  it('splits on commas and whitespace, trims and de-duplicates', () => {
    expect(parseNamespaceList(' networks, default ,networks\ndefault')).toEqual([
      'networks',
      'default',
    ]);
  });
  it('drops invalid namespace names', () => {
    expect(parseNamespaceList('networks,Bad_NS,-x,ok-1')).toEqual(['networks', 'ok-1']);
  });
  it('returns an empty list for empty input', () => {
    expect(parseNamespaceList('')).toEqual([]);
    expect(parseNamespaceList(undefined)).toEqual([]);
  });
});
