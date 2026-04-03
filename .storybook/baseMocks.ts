import { http, HttpResponse } from 'msw';

const VM_NAME = 'fedora-server-01';
const NAMESPACE = 'default';
const POD_NAME = 'virt-launcher-fedora-server-01-xk7rp';
const CREATION = '2024-11-15T10:30:00Z';
const NOW = new Date().toISOString();

// ─── KubeVirt VM Data ──────────────────────────────────────────────

export const MOCK_VM_JSON = {
  apiVersion: 'kubevirt.io/v1',
  kind: 'VirtualMachine',
  metadata: {
    name: VM_NAME,
    namespace: NAMESPACE,
    uid: 'vm-uid-1234',
    creationTimestamp: CREATION,
    resourceVersion: '12345',
    generation: 2,
    labels: { 'app.kubernetes.io/name': 'fedora-server' },
    annotations: {},
  },
  spec: {
    running: true,
    template: {
      metadata: {
        labels: { 'kubevirt.io/domain': VM_NAME, 'kubevirt.io/size': 'small' },
      },
      spec: {
        domain: {
          cpu: { cores: 2, sockets: 1, threads: 1 },
          memory: { guest: '4Gi' },
          devices: {
            disks: [
              { name: 'rootdisk', disk: { bus: 'virtio' } },
              { name: 'cloudinit', disk: { bus: 'virtio' } },
            ],
            interfaces: [{ name: 'default', masquerade: {} }],
          },
          resources: { requests: { memory: '4Gi', cpu: '2' } },
        },
        networks: [{ name: 'default', pod: {} }],
        volumes: [
          {
            name: 'rootdisk',
            dataVolume: { name: `${VM_NAME}-rootdisk` },
          },
          {
            name: 'cloudinit',
            cloudInitNoCloud: {
              userData:
                '#cloud-config\npassword: fedora\nchpasswd: { expire: false }\nssh_pwauth: true\n',
            },
          },
        ],
      },
    },
  },
  status: {
    printableStatus: 'Running',
    ready: true,
    created: true,
    conditions: [
      {
        type: 'Ready',
        status: 'True',
        reason: 'VMIReady',
        message: '',
        lastTransitionTime: NOW,
      },
      {
        type: 'Initialized',
        status: 'True',
        reason: 'NoFailure',
        message: '',
        lastTransitionTime: CREATION,
      },
    ],
  },
};

export const MOCK_VMI_JSON = {
  apiVersion: 'kubevirt.io/v1',
  kind: 'VirtualMachineInstance',
  metadata: {
    name: VM_NAME,
    namespace: NAMESPACE,
    uid: 'vmi-uid-5678',
    creationTimestamp: CREATION,
    resourceVersion: '12346',
    ownerReferences: [
      { apiVersion: 'kubevirt.io/v1', kind: 'VirtualMachine', name: VM_NAME, uid: 'vm-uid-1234' },
    ],
    labels: { 'kubevirt.io/domain': VM_NAME },
  },
  spec: MOCK_VM_JSON.spec.template.spec,
  status: {
    phase: 'Running',
    nodeName: 'worker-01',
    guestOSInfo: {
      name: 'Fedora Linux',
      id: 'fedora',
      versionId: '39',
      prettyName: 'Fedora Linux 39 (Server Edition)',
      kernelRelease: '6.5.6-300.fc39.x86_64',
      kernelVersion: '#1 SMP PREEMPT_DYNAMIC',
      machine: 'x86_64',
    },
    interfaces: [
      {
        name: 'default',
        ipAddress: '10.244.1.42',
        ipAddresses: ['10.244.1.42', 'fd00::42'],
        mac: '52:54:00:12:34:56',
        interfaceName: 'eth0',
      },
    ],
    conditions: [
      { type: 'Ready', status: 'True', lastTransitionTime: NOW },
      { type: 'LiveMigratable', status: 'True', lastTransitionTime: NOW },
      {
        type: 'AgentConnected',
        status: 'True',
        lastTransitionTime: NOW,
        reason: 'GuestAgentIsConnected',
        message: 'QEMU guest agent is connected',
      },
    ],
    activePods: { [POD_NAME]: 'worker-01' },
    migrationMethod: 'LiveMigration',
    launcherContainerImageVersion: 'quay.io/kubevirt/virt-launcher:v1.7.0',
    volumeStatus: [
      { name: 'rootdisk', target: 'vda', phase: 'Ready' },
      { name: 'cloudinit', target: 'vdb', phase: 'Ready' },
    ],
  },
};

const MOCK_POD_JSON = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: POD_NAME,
    namespace: NAMESPACE,
    uid: 'pod-uid-9012',
    creationTimestamp: CREATION,
    labels: {
      'kubevirt.io/domain': VM_NAME,
      'vm.kubevirt.io/name': VM_NAME,
    },
    ownerReferences: [
      {
        apiVersion: 'kubevirt.io/v1',
        kind: 'VirtualMachineInstance',
        name: VM_NAME,
        uid: 'vmi-uid-5678',
      },
    ],
  },
  spec: {
    containers: [
      {
        name: 'compute',
        image: 'quay.io/kubevirt/virt-launcher:v1.7.0',
        resources: { requests: { memory: '4Gi', cpu: '2' }, limits: { memory: '4Gi', cpu: '2' } },
      },
      {
        name: 'guest-console-log',
        image: 'quay.io/kubevirt/virt-launcher:v1.7.0',
      },
    ],
    nodeName: 'worker-01',
  },
  status: {
    phase: 'Running',
    conditions: [
      { type: 'Ready', status: 'True', lastTransitionTime: NOW },
      { type: 'PodScheduled', status: 'True', lastTransitionTime: CREATION },
      { type: 'ContainersReady', status: 'True', lastTransitionTime: NOW },
      { type: 'Initialized', status: 'True', lastTransitionTime: CREATION },
    ],
    containerStatuses: [
      {
        name: 'compute',
        ready: true,
        state: { running: { startedAt: CREATION } },
        restartCount: 0,
        image: 'quay.io/kubevirt/virt-launcher:v1.7.0',
      },
      {
        name: 'guest-console-log',
        ready: true,
        state: { running: { startedAt: CREATION } },
        restartCount: 0,
        image: 'quay.io/kubevirt/virt-launcher:v1.7.0',
      },
    ],
    podIP: '10.244.1.42',
    startTime: CREATION,
  },
};

const MOCK_DV_JSON = {
  apiVersion: 'cdi.kubevirt.io/v1beta1',
  kind: 'DataVolume',
  metadata: {
    name: `${VM_NAME}-rootdisk`,
    namespace: NAMESPACE,
    uid: 'dv-uid-3456',
    creationTimestamp: CREATION,
    ownerReferences: [
      { apiVersion: 'kubevirt.io/v1', kind: 'VirtualMachine', name: VM_NAME, uid: 'vm-uid-1234' },
    ],
  },
  spec: {
    pvc: {
      accessModes: ['ReadWriteOnce'],
      resources: { requests: { storage: '30Gi' } },
      storageClassName: 'local-path',
    },
    source: {
      http: { url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/39/Cloud/x86_64/images/Fedora-Cloud-Base-39-1.5.x86_64.raw.xz' },
    },
  },
  status: {
    phase: 'Succeeded',
    progress: '100.0%',
    conditions: [
      { type: 'Ready', status: 'True', lastTransitionTime: CREATION },
      { type: 'Bound', status: 'True', lastTransitionTime: CREATION },
    ],
  },
};

// ─── Events ────────────────────────────────────────────────────────

function makeEvent(
  name: string,
  kind: string,
  objName: string,
  reason: string,
  message: string,
  type: string,
  minutesAgo: number
) {
  const ts = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: { name, namespace: NAMESPACE, creationTimestamp: ts, uid: `ev-${name}` },
    involvedObject: { kind, name: objName, namespace: NAMESPACE },
    reason,
    message,
    type,
    firstTimestamp: ts,
    lastTimestamp: ts,
    count: 1,
    source: { component: 'kubevirt-controller' },
  };
}

const VM_EVENTS = [
  makeEvent('ev-vm-1', 'VirtualMachine', VM_NAME, 'SuccessfulCreate', 'Created virtual machine instance fedora-server-01', 'Normal', 120),
  makeEvent('ev-vm-2', 'VirtualMachine', VM_NAME, 'SuccessfulUpdate', 'Updated virtual machine with running state', 'Normal', 118),
];

const VMI_EVENTS = [
  makeEvent('ev-vmi-1', 'VirtualMachineInstance', VM_NAME, 'Created', 'VirtualMachineInstance defined', 'Normal', 115),
  makeEvent('ev-vmi-2', 'VirtualMachineInstance', VM_NAME, 'Started', 'VirtualMachineInstance started', 'Normal', 110),
  makeEvent('ev-vmi-3', 'VirtualMachineInstance', VM_NAME, 'GuestAgentConnected', 'QEMU Guest Agent connected', 'Normal', 105),
];

const POD_EVENTS = [
  makeEvent('ev-pod-1', 'Pod', POD_NAME, 'Scheduled', `Successfully assigned ${NAMESPACE}/${POD_NAME} to worker-01`, 'Normal', 116),
  makeEvent('ev-pod-2', 'Pod', POD_NAME, 'Pulled', 'Container image already present on machine', 'Normal', 114),
  makeEvent('ev-pod-3', 'Pod', POD_NAME, 'Created', 'Created container compute', 'Normal', 114),
  makeEvent('ev-pod-4', 'Pod', POD_NAME, 'Started', 'Started container compute', 'Normal', 113),
];

// ─── Guest Agent Data ──────────────────────────────────────────────

const GUEST_OS_INFO = {
  guestAgentVersion: '8.1.3',
  hostname: 'fedora-server-01',
  os: {
    name: 'Fedora Linux',
    id: 'fedora',
    versionId: '39',
    prettyName: 'Fedora Linux 39 (Server Edition)',
    kernelRelease: '6.5.6-300.fc39.x86_64',
  },
  timezone: 'UTC,0',
  fsInfo: {
    disks: [
      { diskName: 'vda', serial: 'rootdisk', busType: 'virtio' },
    ],
  },
};

const FILESYSTEM_LIST = {
  items: [
    { name: 'vda1', mountPoint: '/', type: 'xfs', totalBytes: 32212254720, usedBytes: 8589934592 },
    { name: 'vda2', mountPoint: '/boot', type: 'ext4', totalBytes: 536870912, usedBytes: 134217728 },
  ],
};

const USER_LIST = {
  items: [
    { userName: 'fedora', domain: '', loginTime: Date.now() / 1000 - 3600 },
    { userName: 'root', domain: '', loginTime: Date.now() / 1000 - 7200 },
  ],
};

// ─── Pod Logs ──────────────────────────────────────────────────────

const COMPUTE_LOG = `time="2024-11-15T10:30:15Z" level=info msg="Setting up networking"
time="2024-11-15T10:30:16Z" level=info msg="Starting VM"
time="2024-11-15T10:30:18Z" level=info msg="QEMU machine type is: pc-q35-8.1"
time="2024-11-15T10:30:19Z" level=info msg="Starting container"
time="2024-11-15T10:30:20Z" level=info msg="VNC is listening on port 5900"
time="2024-11-15T10:30:22Z" level=info msg="Guest agent connected"
time="2024-11-15T10:30:25Z" level=info msg="Domain state changed to running"
`;

// ─── Prometheus (stub) ─────────────────────────────────────────────

const PROM_SERVICE = {
  apiVersion: 'v1',
  kind: 'Service',
  metadata: {
    name: 'prometheus-k8s',
    namespace: 'monitoring',
    uid: 'svc-prom',
  },
  spec: {
    ports: [{ port: 9090, targetPort: 9090, protocol: 'TCP' }],
    selector: { app: 'prometheus' },
    type: 'ClusterIP',
  },
};

// ─── Storage Classes ───────────────────────────────────────────────

const STORAGE_CLASSES = [
  {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: { name: 'local-path', uid: 'sc-1' },
    provisioner: 'rancher.io/local-path',
    reclaimPolicy: 'Delete',
    volumeBindingMode: 'WaitForFirstConsumer',
  },
];

// ─── MSW Handlers ──────────────────────────────────────────────────

const BASE = 'http://localhost:4466';

export const baseMocks = [
  // Common Headlamp endpoints
  http.get(`${BASE}/wsMultiplexer`, () => HttpResponse.error()),
  http.get('https://api.iconify.design/mdi.json', () => HttpResponse.json({})),
  http.post(`${BASE}/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`, () =>
    HttpResponse.json({ status: { allowed: true, reason: '', code: 200 } })
  ),
  http.get(`${BASE}/api/v1/namespaces`, () =>
    HttpResponse.json({
      kind: 'NamespaceList',
      items: [
        {
          kind: 'Namespace',
          apiVersion: 'v1',
          metadata: { name: NAMESPACE, uid: 'ns-1', creationTimestamp: CREATION },
          status: { phase: 'Active' },
        },
      ],
    })
  ),
  http.get(`${BASE}/version`, () => HttpResponse.json({})),

  // ── KubeVirt VM ──
  http.get(`${BASE}/apis/kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachines/${VM_NAME}`, () =>
    HttpResponse.json(MOCK_VM_JSON)
  ),
  http.put(`${BASE}/apis/kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachines/${VM_NAME}`, () =>
    HttpResponse.json(MOCK_VM_JSON)
  ),

  // ── KubeVirt VMI ──
  http.get(
    `${BASE}/apis/kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachineinstances/${VM_NAME}`,
    () => HttpResponse.json(MOCK_VMI_JSON)
  ),
  http.put(
    `${BASE}/apis/kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachineinstances/${VM_NAME}`,
    () => HttpResponse.json(MOCK_VMI_JSON)
  ),
  http.patch(
    `${BASE}/apis/kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachineinstances/${VM_NAME}`,
    () => HttpResponse.json(MOCK_VMI_JSON)
  ),

  // ── VM Subresources (start/stop/restart/pause/unpause/migrate) ──
  ...(
    ['start', 'stop', 'restart', 'pause', 'unpause', 'migrate'] as const
  ).map(action =>
    http.put(
      `${BASE}/apis/subresources.kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachines/${VM_NAME}/${action}`,
      () => new HttpResponse(null, { status: 202 })
    )
  ),

  // ── Guest Agent subresources ──
  http.get(
    `${BASE}/apis/subresources.kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachineinstances/${VM_NAME}/guestosinfo`,
    () => HttpResponse.json(GUEST_OS_INFO)
  ),
  http.get(
    `${BASE}/apis/subresources.kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachineinstances/${VM_NAME}/filesystemlist`,
    () => HttpResponse.json(FILESYSTEM_LIST)
  ),
  http.get(
    `${BASE}/apis/subresources.kubevirt.io/v1/namespaces/${NAMESPACE}/virtualmachineinstances/${VM_NAME}/userlist`,
    () => HttpResponse.json(USER_LIST)
  ),

  // ── Pod ──
  http.get(`${BASE}/api/v1/namespaces/${NAMESPACE}/pods/${POD_NAME}`, () =>
    HttpResponse.json(MOCK_POD_JSON)
  ),
  http.get(`${BASE}/api/v1/namespaces/${NAMESPACE}/pods`, ({ request }) => {
    const url = new URL(request.url);
    const sel = url.searchParams.get('labelSelector') || '';
    if (sel.includes('volatility3-analysis') || sel.includes('memory-dump')) {
      return HttpResponse.json({ kind: 'PodList', items: [], metadata: {} });
    }
    return HttpResponse.json({ kind: 'PodList', items: [MOCK_POD_JSON], metadata: {} });
  }),

  // ── Pod Logs ──
  http.get(`${BASE}/api/v1/namespaces/${NAMESPACE}/pods/${POD_NAME}/log`, () =>
    new HttpResponse(COMPUTE_LOG, {
      headers: { 'Content-Type': 'text/plain' },
    })
  ),

  // ── Events ──
  http.get(`${BASE}/api/v1/namespaces/${NAMESPACE}/events`, ({ request }) => {
    const url = new URL(request.url);
    const sel = url.searchParams.get('fieldSelector') || '';
    let items: any[] = [];
    if (sel.includes('VirtualMachine')) items = VM_EVENTS;
    else if (sel.includes('VirtualMachineInstance')) items = VMI_EVENTS;
    else if (sel.includes('Pod')) items = POD_EVENTS;
    else items = [...VM_EVENTS, ...VMI_EVENTS, ...POD_EVENTS];
    return HttpResponse.json({ kind: 'EventList', items, metadata: {} });
  }),
  http.get(`${BASE}/api/v1/events`, () =>
    HttpResponse.json({ kind: 'EventList', items: [], metadata: {} })
  ),

  // ── DataVolumes ──
  http.get(`${BASE}/apis/cdi.kubevirt.io/v1beta1/namespaces/${NAMESPACE}/datavolumes`, () =>
    HttpResponse.json({ kind: 'DataVolumeList', items: [MOCK_DV_JSON], metadata: {} })
  ),
  http.get(
    `${BASE}/apis/cdi.kubevirt.io/v1beta1/namespaces/${NAMESPACE}/datavolumes/${VM_NAME}-rootdisk`,
    () => HttpResponse.json(MOCK_DV_JSON)
  ),

  // ── Storage Classes ──
  http.get(`${BASE}/apis/storage.k8s.io/v1/storageclasses`, () =>
    HttpResponse.json({ kind: 'StorageClassList', items: STORAGE_CLASSES, metadata: {} })
  ),

  // ── PVCs (empty for now) ──
  http.get(`${BASE}/api/v1/namespaces/${NAMESPACE}/persistentvolumeclaims`, () =>
    HttpResponse.json({ kind: 'PersistentVolumeClaimList', items: [], metadata: {} })
  ),
  http.post(`${BASE}/api/v1/namespaces/${NAMESPACE}/persistentvolumeclaims`, () =>
    HttpResponse.json({}, { status: 201 })
  ),

  // ── Services (for Prometheus discovery) ──
  http.get(`${BASE}/api/v1/services`, () =>
    HttpResponse.json({ kind: 'ServiceList', items: [PROM_SERVICE], metadata: {} })
  ),

  // ── Prometheus queries (return empty data) ──
  http.get(/\/proxy\/api\/v1\/query/, () =>
    HttpResponse.json({
      status: 'success',
      data: { resultType: 'vector', result: [{ metric: {}, value: [Date.now() / 1000, '1'] }] },
    })
  ),
  http.get(/\/proxy\/api\/v1\/query_range/, () =>
    HttpResponse.json({
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { instance: VM_NAME },
            values: Array.from({ length: 30 }, (_, i) => [
              Date.now() / 1000 - (30 - i) * 60,
              String(Math.random() * 50 + 10),
            ]),
          },
        ],
      },
    })
  ),
];
