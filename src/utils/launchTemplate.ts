/**
 * Build a clean VM template for "Launch More Like This".
 * Keeps the full spec (disks, networks, cloud-init, etc.) as-is.
 * Strips runtime metadata, renames the first DVT to <newname>-boot-volume
 * so the form recognizes it, and updates all internal references.
 */
export function buildLaunchTemplate(vmJson: Record<string, unknown>): Record<string, unknown> {
  const vm = JSON.parse(JSON.stringify(vmJson));
  const originalName = (vm.metadata?.name as string) || '';
  const newName = `${originalName}-copy`;

  vm.metadata = {
    name: newName,
    namespace: vm.metadata?.namespace || 'default',
    labels: vm.metadata?.labels || {},
    annotations: {},
  };

  // Remove runtime-only fields
  delete vm.status;
  delete vm.metadata.uid;
  delete vm.metadata.resourceVersion;
  delete vm.metadata.creationTimestamp;
  delete vm.metadata.generation;
  delete vm.metadata.managedFields;

  // Remove system annotations
  const sysAnnotations = [
    'kubectl.kubernetes.io/last-applied-configuration',
    'kubevirt.io/latest-observed-api-version',
    'kubevirt.io/storage-observed-api-version',
    'kubemacpool.io/transaction-timestamp',
  ];
  for (const key of sysAnnotations) {
    delete vm.metadata.annotations?.[key];
  }

  // Remove restore-related labels/annotations
  for (const store of [vm.metadata.labels, vm.metadata.annotations]) {
    if (store) {
      for (const key of Object.keys(store)) {
        if (key.startsWith('restore.kubevirt.io/')) delete store[key];
      }
    }
  }

  // Rename the first DVT to <newname>-boot-volume so the form recognizes it
  const dvts = vm.spec?.dataVolumeTemplates as
    | Array<{ metadata?: { name?: string; creationTimestamp?: string } }>
    | undefined;
  const volumes = (vm.spec?.template?.spec?.volumes || []) as Array<{
    name?: string;
    dataVolume?: { name?: string };
  }>;
  const disks = (vm.spec?.template?.spec?.domain?.devices?.disks || []) as Array<{
    name?: string;
  }>;

  if (dvts && dvts.length > 0) {
    const oldDvtName = dvts[0].metadata?.name as string;
    const newDvtName = `${newName}-boot-volume`;

    // Rename DVT
    dvts[0].metadata.name = newDvtName;
    delete dvts[0].metadata.creationTimestamp;

    // Find the volume that references this DVT and get its current name
    const bootVol = volumes.find(v => v.dataVolume?.name === oldDvtName);
    if (bootVol) {
      const oldVolName = bootVol.name as string;
      bootVol.dataVolume.name = newDvtName;
      bootVol.name = newDvtName;

      // Update the disk entry that referenced the old volume name
      const bootDisk = disks.find(d => d.name === oldVolName);
      if (bootDisk) {
        bootDisk.name = newDvtName;
      }
    }
  }

  // Remove runtime-injected fields
  delete vm.spec?.template?.metadata?.creationTimestamp;

  // Remove MAC addresses — let kubemacpool assign new ones
  const interfaces = vm.spec?.template?.spec?.domain?.devices?.interfaces;
  if (interfaces) {
    for (const iface of interfaces as Array<{ macAddress?: string }>) {
      delete iface.macAddress;
    }
  }

  // Remove firmware UUIDs — new VM should get its own
  delete vm.spec?.template?.spec?.domain?.firmware;

  return vm;
}
