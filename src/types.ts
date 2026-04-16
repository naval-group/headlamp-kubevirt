/**
 * Shared TypeScript types for KubeVirt resources.
 *
 * These mirror the Kubernetes/KubeVirt API object shapes so that
 * component code can stop relying on `any`.
 */

// ─── Common Kubernetes types ────────────────────────────────────────

export interface KubeCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastProbeTime?: string;
  lastTransitionTime?: string;
  lastHeartbeatTime?: string;
}

export interface KubeListResponse<T = Record<string, unknown>> {
  kind: string;
  apiVersion: string;
  metadata: { continue?: string; resourceVersion?: string };
  items: T[];
}

// ─── VirtualMachine ─────────────────────────────────────────────────

export interface VMInterface {
  name: string;
  model?: string;
  macAddress?: string;
  bridge?: Record<string, unknown>;
  masquerade?: Record<string, unknown>;
  sriov?: Record<string, unknown>;
  slirp?: Record<string, unknown>;
  binding?: { name: string };
  ports?: Array<{ name?: string; port: number; protocol?: string }>;
  tag?: string;
}

export interface VMNetwork {
  name: string;
  pod?: Record<string, unknown>;
  multus?: { networkName: string };
}

export interface VMDisk {
  name: string;
  disk?: { bus?: string; readonly?: boolean };
  cdrom?: { bus?: string; readonly?: boolean };
  lun?: { bus?: string; readonly?: boolean };
  serial?: string;
  bootOrder?: number;
  dedicatedIOThread?: boolean;
  cache?: string;
  io?: string;
  tag?: string;
  shareable?: boolean;
}

export interface VMVolume {
  name: string;
  containerDisk?: { image: string; imagePullPolicy?: string };
  cloudInitNoCloud?: { userData?: string; networkData?: string; userDataBase64?: string };
  cloudInitConfigDrive?: { userData?: string; networkData?: string; userDataBase64?: string };
  persistentVolumeClaim?: { claimName: string; readOnly?: boolean };
  dataVolume?: { name: string };
  emptyDisk?: { capacity: string };
  ephemeral?: { persistentVolumeClaim?: { claimName: string } };
  configMap?: { name: string; volumeLabel?: string; optional?: boolean };
  secret?: { secretName: string; volumeLabel?: string; optional?: boolean };
  serviceAccount?: { serviceAccountName: string };
  sysprep?: { configMap?: { name: string }; secret?: { name: string } };
  downwardMetrics?: Record<string, unknown>;
}

export interface VMResources {
  requests?: { memory?: string; cpu?: string };
  limits?: { memory?: string; cpu?: string };
}

export interface VMCPUTopology {
  cores?: number;
  sockets?: number;
  threads?: number;
}

export interface DataVolumeTemplate {
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: {
    source?: DataVolumeSource;
    sourceRef?: { kind: string; name: string; namespace?: string };
    storage?: DataVolumeStorage;
    pvc?: {
      accessModes?: string[];
      resources?: { requests?: { storage?: string } };
      storageClassName?: string;
      volumeMode?: string;
    };
    contentType?: string;
  };
}

// ─── DataVolume ─────────────────────────────────────────────────────

export interface DataVolumeSource {
  http?: { url: string; certConfigMap?: string; secretRef?: string };
  registry?: { url: string; certConfigMap?: string; secretRef?: string };
  pvc?: { name: string; namespace: string };
  snapshot?: { name: string; namespace: string };
  upload?: Record<string, unknown>;
  blank?: Record<string, unknown>;
  s3?: { url: string; certConfigMap?: string; secretRef?: string };
  gcs?: { url: string };
  imageio?: { url: string; diskId: string; secretRef: string; certConfigMap?: string };
  vddk?: {
    url: string;
    uuid: string;
    backingFile?: string;
    thumbprint?: string;
    secretRef?: string;
  };
}

export interface DataVolumeStorage {
  accessModes?: string[];
  resources?: { requests?: { storage?: string } };
  storageClassName?: string;
  volumeMode?: string;
}

// ─── DataImportCron ─────────────────────────────────────────────────

export interface DataImportCronImport {
  DataVolumeName: string;
  Digest?: string;
}

// ─── VirtualMachineExport links ─────────────────────────────────────

export interface ExportVolume {
  name: string;
  formats?: Array<{ format: string; url: string }>;
}

export interface ExportLinks {
  cert?: string;
  volumes?: ExportVolume[];
  manifests?: Array<{ type: string; url: string }>;
}

// ─── NetworkAttachmentDefinition config ─────────────────────────────

export interface NADConfig {
  cniVersion?: string;
  name?: string;
  type?: string;
  bridge?: string;
  master?: string;
  vlanId?: number;
  mtu?: number;
  isGateway?: boolean;
  isDefaultGateway?: boolean;
  forceAddress?: boolean;
  hairpinMode?: boolean;
  ipMasq?: boolean;
  promiscMode?: boolean;
  vlan?: number;
  ipam?: NADIpam;
  // macvlan / ipvlan
  mode?: string;
  macspoofchk?: boolean;
  // host-device
  device?: string;
  hwaddr?: string;
  kernelpath?: string;
  pciBusID?: string;
  // SR-IOV
  vlanQoS?: number;
  vlanProto?: string;
  mac?: string;
  spoofchk?: string;
  trust?: string;
  linkState?: string;
  minTxRate?: number;
  maxTxRate?: number;
  // tap
  selinuxcontext?: string;
  owner?: number;
  group?: number;
  multiQueue?: boolean;
  // Allow extension fields
  [key: string]: unknown;
}

export interface NADIpam {
  type?: string;
  subnet?: string;
  rangeStart?: string;
  rangeEnd?: string;
  gateway?: string;
  routes?: NADRoute[];
  ranges?: NADRange[][];
  addresses?: NADAddress[];
  [key: string]: unknown;
}

export interface NADRange {
  subnet?: string;
  rangeStart?: string;
  rangeEnd?: string;
  gateway?: string;
}

export interface NADRoute {
  dst?: string;
  gw?: string;
}

export interface NADAddress {
  address?: string;
  gateway?: string;
}

// ─── KubeVirt configuration ─────────────────────────────────────────

export interface MigrationConfig {
  parallelMigrationsPerCluster?: number;
  parallelOutboundMigrationsPerNode?: number;
  bandwidthPerMigration?: string;
  completionTimeoutPerGiB?: number;
  progressTimeout?: number;
  allowAutoConverge?: boolean;
  allowPostCopy?: boolean;
  unsafeMigrationOverride?: boolean;
  disableTLS?: boolean;
  network?: string;
  nodeDrainTaintKey?: string;
  [key: string]: unknown;
}

export interface LiveUpdateConfig {
  maxCpuSockets?: number;
  maxGuest?: string;
  [key: string]: unknown;
}

export interface NetworkConfig {
  defaultNetworkInterface?: string;
  permitSlirpInterface?: boolean;
  permitBridgeInterfaceOnPodNetwork?: boolean;
  [key: string]: unknown;
}

export interface PciDevice {
  pciVendorSelector: string;
  resourceName: string;
  externalResourceProvider?: boolean;
}

export interface MediatedDevice {
  mdevNameSelector: string;
  resourceName: string;
  externalResourceProvider?: boolean;
}

export interface PermittedHostDevices {
  pciHostDevices?: PciDevice[];
  mediatedDevices?: MediatedDevice[];
}

// ─── Prometheus ─────────────────────────────────────────────────────

export interface PrometheusQueryResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
}

// ─── VirtualMachineInstance (VMI) ───────────────────────────────────

/** Runtime network interface from VMI status (guest-agent reported) */
export interface VMIStatusNetworkInterface {
  name?: string;
  interfaceName?: string;
  mac?: string;
  ipAddress?: string;
  ipAddresses?: string[];
  linkState?: string;
  queueCount?: number;
}

/** Runtime volume status from VMI status */
export interface VMIVolumeStatus {
  name: string;
  target?: string;
  size?: number;
  persistentVolumeClaimInfo?: {
    claimName: string;
    capacity?: { storage?: string };
    accessModes?: string[];
  };
}

/** Subset of VirtualMachineInstance used across views */
export interface VMIData {
  [key: string]: unknown;
  metadata?: {
    creationTimestamp?: string;
  };
  spec?: {
    domain?: {
      cpu?: VMCPUTopology;
      resources?: VMResources;
    };
    volumes?: Array<{
      name: string;
      dataVolume?: { name: string };
      persistentVolumeClaim?: { claimName: string };
    }>;
  };
  status?: {
    phase?: string;
    nodeName?: string;
    currentCPUTopology?: VMCPUTopology;
    memory?: {
      guestCurrent?: string;
      guestRequested?: string;
      memoryOverhead?: string;
    };
    guestOSInfo?: {
      prettyName?: string;
      kernelRelease?: string;
    };
    interfaces?: VMIStatusNetworkInterface[];
    volumeStatus?: VMIVolumeStatus[];
    migrationState?: {
      completed?: boolean;
      migrationUid?: string;
      mode?: string;
      startTimestamp?: string;
      endTimestamp?: string;
      sourceNode?: string;
      targetNode?: string;
    };
  };
}

// ─── Kubernetes Service (subset) ────────────────────────────────────

/** Minimal K8s Service shape for fields actually accessed */
export interface KubeServiceSubset {
  metadata?: { name?: string; namespace?: string };
  spec?: {
    selector?: Record<string, string>;
    ports?: Array<{ port?: number; targetPort?: number | string; protocol?: string }>;
  };
  data?: Record<string, string>;
  items?: Array<{ metadata: { name: string } }>;
}

// ─── DataVolume Template storage ────────────────────────────────────

/** Storage block used when building DataVolumeTemplate specs in forms */
export interface DVTStorageSpec {
  resources: {
    requests: {
      storage: string;
    };
  };
  storageClassName?: string;
  accessModes?: string[];
  volumeMode?: 'Filesystem' | 'Block';
}

// ─── Recharts tooltip ───────────────────────────────────────────────

export interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string;
}

// ─── VNC ────────────────────────────────────────────────────────────

export interface RFBPixelFormat {
  bitsPerPixel: number;
  depth: number;
  bigEndian: boolean;
  trueColor: boolean;
  redMax: number;
  greenMax: number;
  blueMax: number;
  redShift: number;
  greenShift: number;
  blueShift: number;
}
