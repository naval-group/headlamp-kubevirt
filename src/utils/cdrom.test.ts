import { describe, expect, it } from 'vitest';
import {
  addCdromDrive,
  cdromLiveState,
  ejectCdromMedia,
  getCdromDrives,
  insertCdromMedia,
  nextCdromName,
  removeCdromDrive,
} from './cdrom';

function makeVM(disks: object[] = [], volumes: object[] = []) {
  return {
    apiVersion: 'kubevirt.io/v1',
    kind: 'VirtualMachine',
    metadata: { name: 'vm1', namespace: 'ns1', resourceVersion: '7' },
    spec: {
      runStrategy: 'Always',
      template: {
        metadata: { labels: { a: 'b' } },
        spec: { domain: { devices: { disks } }, volumes },
      },
    },
  };
}

const rootDisk = { name: 'root', disk: { bus: 'virtio' } };
const rootVol = { name: 'root', dataVolume: { name: 'vm1-root' } };

describe('getCdromDrives', () => {
  it('lists empty and loaded drives, ignoring normal disks', () => {
    const vm = makeVM(
      [
        rootDisk,
        { name: 'cdrom', cdrom: { bus: 'sata' } },
        { name: 'iso', cdrom: { bus: 'sata' }, bootOrder: 1 },
      ],
      [rootVol, { name: 'iso', persistentVolumeClaim: { claimName: 'win-iso' } }]
    );
    expect(getCdromDrives(vm.spec.template.spec)).toEqual([
      { name: 'cdrom', bus: 'sata', bootOrder: undefined, media: undefined, otherMedia: undefined },
      {
        name: 'iso',
        bus: 'sata',
        bootOrder: 1,
        media: { kind: 'persistentVolumeClaim', name: 'win-iso', hotpluggable: false },
        otherMedia: undefined,
      },
    ]);
  });

  it('flags media that cannot be changed here (e.g. containerDisk)', () => {
    const vm = makeVM(
      [{ name: 'cd', cdrom: { bus: 'sata' } }],
      [{ name: 'cd', containerDisk: { image: 'x' } }]
    );
    expect(getCdromDrives(vm.spec.template.spec)[0].otherMedia).toBe('containerDisk');
  });
});

describe('nextCdromName', () => {
  it('picks a name not used by any disk or volume', () => {
    expect(nextCdromName(makeVM([rootDisk], [rootVol]).spec.template.spec)).toBe('cdrom');
    expect(
      nextCdromName(
        makeVM([{ name: 'cdrom', cdrom: {} }], [{ name: 'cdrom1', dataVolume: { name: 'x' } }]).spec
          .template.spec
      )
    ).toBe('cdrom2');
  });
});

describe('add / insert / eject / remove', () => {
  it('adds an empty SATA drive without touching other fields', () => {
    const vm = makeVM([rootDisk], [rootVol]);
    const next = addCdromDrive(vm, 'cdrom');
    expect(next.spec.template.spec.domain.devices.disks).toEqual([
      rootDisk,
      { name: 'cdrom', cdrom: { bus: 'sata' } },
    ]);
    expect(next.spec.template.spec.volumes).toEqual([rootVol]);
    expect(next.metadata.resourceVersion).toBe('7');
    expect(next.spec.template.metadata).toEqual({ labels: { a: 'b' } });
    expect(vm.spec.template.spec.domain.devices.disks).toHaveLength(1); // not mutated
  });

  it('refuses a duplicate drive name', () => {
    expect(() => addCdromDrive(makeVM([rootDisk], [rootVol]), 'root')).toThrow(/already exists/);
  });

  it('adds a drive with media in one step', () => {
    const next = addCdromDrive(makeVM([rootDisk], [rootVol]), 'cdrom', {
      kind: 'dataVolume',
      name: 'ubuntu-iso',
    });
    expect(next.spec.template.spec.volumes).toContainEqual({
      name: 'cdrom',
      dataVolume: { name: 'ubuntu-iso', hotpluggable: true },
    });
  });

  it('inserts hotpluggable media and replaces existing media', () => {
    const vm = makeVM([rootDisk, { name: 'cdrom', cdrom: { bus: 'sata' } }], [rootVol]);
    const a = insertCdromMedia(vm, 'cdrom', { kind: 'persistentVolumeClaim', name: 'iso-a' });
    expect(a.spec.template.spec.volumes).toEqual([
      rootVol,
      { name: 'cdrom', persistentVolumeClaim: { claimName: 'iso-a', hotpluggable: true } },
    ]);
    const b = insertCdromMedia(a, 'cdrom', { kind: 'dataVolume', name: 'iso-b' });
    expect(b.spec.template.spec.volumes).toEqual([
      rootVol,
      { name: 'cdrom', dataVolume: { name: 'iso-b', hotpluggable: true } },
    ]);
  });

  it('refuses to insert into a normal disk', () => {
    expect(() =>
      insertCdromMedia(makeVM([rootDisk], [rootVol]), 'root', { kind: 'dataVolume', name: 'x' })
    ).toThrow(/not a CD-ROM/);
  });

  it('ejects by removing only the drive volume', () => {
    const vm = makeVM(
      [rootDisk, { name: 'cdrom', cdrom: { bus: 'sata' } }],
      [rootVol, { name: 'cdrom', dataVolume: { name: 'iso', hotpluggable: true } }]
    );
    const next = ejectCdromMedia(vm, 'cdrom');
    expect(next.spec.template.spec.volumes).toEqual([rootVol]);
    expect(next.spec.template.spec.domain.devices.disks).toHaveLength(2);
  });

  it('removes the drive and its media', () => {
    const vm = makeVM(
      [rootDisk, { name: 'cdrom', cdrom: { bus: 'sata' } }],
      [rootVol, { name: 'cdrom', dataVolume: { name: 'iso', hotpluggable: true } }]
    );
    const next = removeCdromDrive(vm, 'cdrom');
    expect(next.spec.template.spec.domain.devices.disks).toEqual([rootDisk]);
    expect(next.spec.template.spec.volumes).toEqual([rootVol]);
  });
});

describe('cdromLiveState', () => {
  const drive = (media?: object) =>
    getCdromDrives(
      makeVM(
        [{ name: 'cdrom', cdrom: { bus: 'sata' } }],
        media ? [{ name: 'cdrom', ...media }] : []
      ).spec.template.spec
    )[0];
  const vmi = (media?: object, status?: object) => ({
    spec: {
      domain: { devices: { disks: [{ name: 'cdrom', cdrom: { bus: 'sata' } }] } },
      volumes: media ? [{ name: 'cdrom', ...media }] : [],
    },
    status: { volumeStatus: status ? [{ name: 'cdrom', ...status }] : [] },
  });
  const hpIso = { dataVolume: { name: 'iso', hotpluggable: true } };

  it('reports stopped without a VMI', () => {
    expect(cdromLiveState(drive(hpIso), null)).toEqual({ state: 'stopped' });
  });
  it('reports ready when the running VM has the media attached', () => {
    expect(cdromLiveState(drive(hpIso), vmi(hpIso, { phase: 'Ready' }))).toEqual({
      state: 'ready',
      media: 'iso',
    });
  });
  it('reports inserting while the hotplug is in progress', () => {
    expect(cdromLiveState(drive(hpIso), vmi(undefined)).state).toBe('inserting');
    expect(cdromLiveState(drive(hpIso), vmi(hpIso, { phase: 'AttachedToNode' })).state).toBe(
      'inserting'
    );
  });
  it('reports ejecting when the spec has no media but the VM still does', () => {
    expect(cdromLiveState(drive(), vmi(hpIso, { phase: 'Ready' })).state).toBe('ejecting');
  });
  it('reports empty when neither has media', () => {
    expect(cdromLiveState(drive(), vmi(undefined))).toEqual({ state: 'empty' });
  });
  it('needs a restart to change media inserted at boot (not hotpluggable)', () => {
    const bootIso = { persistentVolumeClaim: { claimName: 'boot-iso' } };
    expect(cdromLiveState(drive(bootIso), vmi(bootIso, { phase: 'Ready' })).state).toBe('ready');
    expect(cdromLiveState(drive(), vmi(bootIso, { phase: 'Ready' })).state).toBe(
      'restart-required'
    );
    expect(cdromLiveState(drive(hpIso), vmi(bootIso, { phase: 'Ready' })).state).toBe(
      'restart-required'
    );
  });
  it('needs a restart for a drive added while running', () => {
    const running = { spec: { domain: { devices: { disks: [] } }, volumes: [] }, status: {} };
    expect(cdromLiveState(drive(), running).state).toBe('restart-required');
  });
});
