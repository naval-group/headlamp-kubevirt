/**
 * Centralized tooltip texts for KubeVirt concepts.
 *
 * Usage: import { TOOLTIPS } from '../../utils/tooltips';
 * Then use with MUI Tooltip or a shared InfoTooltip component.
 *
 * Guidelines:
 * - Keep tooltips short (1-2 sentences max)
 * - Explain WHAT it does, not HOW it works internally
 * - Use plain language, avoid K8s jargon when possible
 * - Only add tooltips for concepts that are genuinely confusing
 */

// ─── VM Lifecycle ──────────────────────────────────────────────────

export const TOOLTIPS = {
  // Run strategy
  runStrategyAlways:
    'The VM will be automatically restarted if it stops or crashes. Equivalent to "always running".',
  runStrategyHalted: 'The VM is defined but not running. You can start it manually later.',
  runStrategyManual: 'The VM must be started and stopped manually. It will not auto-restart.',
  runStrategyRerunOnFailure:
    'The VM will be restarted only if it exits with an error. Clean shutdowns are final.',
  evictionStrategy:
    'What happens when the node hosting this VM needs to be drained (e.g., during maintenance). "LiveMigrate" moves the VM to another node without downtime.',

  // ─── CPU & Memory ──────────────────────────────────────────────────

  instanceType:
    'A pre-configured profile defining CPU, memory, and device defaults. Similar to cloud instance types (e.g., m5.large). Simplifies VM creation by applying consistent resource settings.',
  preference:
    'Default settings for a guest OS (disk bus, network model, firmware). Applied automatically when creating a VM, but can be overridden.',
  cpuModelHostPassthrough:
    'Exposes the exact host CPU to the VM. Best performance, but prevents live migration to hosts with different CPUs.',
  cpuModelHostModel:
    'Uses a CPU model compatible with the host. Allows live migration to similar hosts while maintaining most features.',
  memoryOvercommit:
    'Allows scheduling more VM memory than physically available. 100% = no overcommit. 200% = VMs can request up to 2× physical RAM. Increases density but risks OOM kills.',
  memoryBalloon:
    'Enables dynamic memory management. The host can reclaim unused memory from the VM when needed. Improves memory utilization across VMs.',

  // ─── Storage ───────────────────────────────────────────────────────

  dataVolume:
    'A CDI (Containerized Data Importer) resource that automates creating and populating a PVC from a source like a container image, URL, or another PVC.',
  accessModeRWO:
    'ReadWriteOnce — the volume can be mounted read-write by a single node. Most common for VM disks. Does not support live migration.',
  accessModeRWX:
    'ReadWriteMany — the volume can be mounted read-write by multiple nodes simultaneously. Required for live migration.',
  accessModeROX:
    'ReadOnlyMany — the volume can be mounted read-only by multiple nodes. Useful for shared base images.',
  volumeModeFilesystem:
    'The volume is mounted as a directory with a filesystem. Adds a small overhead but supports resizing and snapshots more easily.',
  volumeModeBlock:
    'The volume is exposed as a raw block device. Better performance for I/O-heavy workloads, but no filesystem layer.',
  preallocation:
    'Pre-allocates the full disk size on creation instead of growing on demand. Improves write performance but uses more storage immediately.',
  storageClass:
    'Determines how the storage is provisioned (e.g., local SSD, network-attached, replicated). Leave empty to use the cluster default.',

  // ─── Disk Sources ──────────────────────────────────────────────────

  sourceEmptyDisk:
    'A temporary in-memory disk that exists only while the VM runs. Data is lost on shutdown. Useful for scratch space or swap.',
  sourceBlankDV:
    'A persistent blank disk backed by a DataVolume. Survives VM restarts. Use for data disks that need to persist.',
  sourceContainerDisk:
    'A read-only disk image pulled from a container registry (e.g., quay.io). Commonly used for OS boot images. Does not persist writes across reboots.',
  sourceEphemeral:
    'Uses a copy-on-write overlay on an existing PVC. Writes are discarded on VM stop. Useful for testing with a base image.',
  sourcePvcSnapshot:
    'Creates a new disk from a volume snapshot. The snapshot must exist and the storage class must support CSI snapshots.',

  // ─── Network ───────────────────────────────────────────────────────

  networkPod:
    'The default cluster network. VMs get a Pod IP and can communicate with other pods and services. Uses NAT for outbound traffic.',
  networkMultus:
    'A secondary network defined by a NetworkAttachmentDefinition. Provides direct L2 access to external networks (VLANs, bridges, SR-IOV).',
  bindingMasquerade:
    'NAT-based network binding. The VM gets a private IP and the host translates traffic. Simple and works everywhere, but no inbound connections without services.',
  bindingBridge:
    'Bridges the VM directly onto the pod network at L2. The VM gets an IP from the pod network. Supports inbound connections but requires permitBridgeInterfaceOnPodNetwork.',
  bindingSriov:
    'SR-IOV passthrough. Assigns a physical network function directly to the VM for near-native network performance. Requires SR-IOV-capable NICs and node configuration.',
  interfaceModelVirtio:
    'Paravirtualized network adapter. Best performance but requires virtio drivers in the guest OS (included in most Linux distros and Windows virtio drivers).',
  interfaceModelE1000e:
    'Emulated Intel e1000e NIC. Widely compatible with all guest OSes without extra drivers, but lower performance than virtio.',

  // ─── Bus Types ─────────────────────────────────────────────────────

  busVirtio:
    'Paravirtualized disk controller. Best performance but requires virtio drivers in the guest OS.',
  busSata:
    'Emulated SATA controller. Good compatibility with all guest OSes, moderate performance.',
  busScsi: 'Emulated SCSI controller. Supports features like TRIM/UNMAP and multiple LUNs.',

  // ─── Firmware & Boot ───────────────────────────────────────────────

  uefi: 'Modern firmware replacing legacy BIOS. Required for Secure Boot and some newer operating systems.',
  secureBoot:
    'Verifies that the OS bootloader is signed by a trusted authority. Prevents rootkits but requires UEFI and compatible OS images.',
  persistUefiVars:
    'Saves UEFI settings (boot order, Secure Boot keys) across reboots. Without this, UEFI variables reset on each VM start.',

  // ─── Cloud-Init ────────────────────────────────────────────────────

  cloudInitNoCloud:
    'Standard cloud-init datasource. Passes user-data (scripts, SSH keys) and network config via a virtual config drive. Works with most cloud images.',
  cloudInitConfigDrive:
    'OpenStack-compatible config drive format. Also used by Fedora CoreOS with Ignition. Use this for Ignition configs.',

  // ─── Advanced Features ─────────────────────────────────────────────

  vsock:
    'Virtual socket for host-guest communication without networking. Used by guest agents and monitoring tools for efficient data exchange.',
  inputDevice:
    'Attaches a virtual input device (keyboard/mouse via USB or virtio). Required for VNC console interaction.',
  liveMigration:
    'Moves a running VM to another node without downtime. Requires RWX storage and compatible CPU models across nodes.',
  autoConverge:
    'Throttles the VM CPU during live migration to help memory pages converge faster. Useful when migration stalls due to high memory write rate.',
  postCopy:
    'Transfers remaining memory pages on-demand after switching the VM to the target node. Faster completion but risks VM pause if pages arrive slowly.',

  // ─── Snapshots & Exports ───────────────────────────────────────────

  snapshotDeletionPolicyDelete:
    'When the snapshot is deleted, the underlying volume snapshots are also deleted. Frees storage but the snapshot cannot be recovered.',
  snapshotDeletionPolicyRetain:
    'When the snapshot is deleted, the underlying volume snapshots are kept. Uses more storage but allows recovery.',
  snapshotFailureDeadline:
    'Maximum time to wait for the snapshot to complete. If exceeded, the snapshot is marked as failed.',
  exportTtl:
    'How long the export remains available for download before being automatically cleaned up.',
  restoreToSameVM:
    'Overwrites the current VM disks with the snapshot contents. The VM must be stopped. All changes since the snapshot are lost.',
  restoreToNewVM: 'Creates a new VM from the snapshot, leaving the original VM untouched.',

  // ─── Device Passthrough ────────────────────────────────────────────

  pciPassthrough:
    'Assigns a physical PCI device (GPU, NIC, accelerator) directly to the VM. The device is exclusively used by the VM and unavailable to the host.',
  mediatedDevice:
    'A virtual device (vGPU) created by partitioning a physical device. Multiple VMs can share one physical GPU. Requires vendor drivers (e.g., NVIDIA vGPU).',
  externalResourceProvider:
    'Enable when a third-party device plugin (e.g., NVIDIA GPU Operator) manages this device. KubeVirt will permit the device but delegate allocation and health monitoring to the external plugin.',
  pciVendorSelector:
    'The PCI vendor and device ID in hexadecimal (e.g., 10DE:1DB6). Find it with "lspci -nn" on the host node.',

  // ─── Migration ─────────────────────────────────────────────────────

  volumeMigration:
    'Moves VM disk data from one storage class to another while the VM is running. Requires the target storage to support the same or compatible access modes.',
  disksNotLiveMigratable:
    'One or more disks use ReadWriteOnce (RWO) access mode, which cannot be accessed from multiple nodes simultaneously. Convert to ReadWriteMany (RWX) to enable live migration.',
} as const;
