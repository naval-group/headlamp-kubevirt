export interface TagOverride {
  osLabel?: string;
  defaultPreference?: string;
}

export interface CatalogImage {
  id: string;
  name: string;
  description: string;
  icon: string;
  iconColor?: string;
  registry: string;
  tags: string[];
  defaultTag: string;
  recommendedSize: string;
  osLabel: string;
  defaultPreference?: string;
  tagOverrides?: Record<string, TagOverride>;
  category: 'general' | 'coreos' | 'testing';
}

/** Resolve osLabel and defaultPreference for a given image + tag. */
export function resolveTagValues(
  image: CatalogImage,
  tag: string
): { osLabel: string; defaultPreference?: string } {
  const overrides = image.tagOverrides?.[tag];
  return {
    osLabel: overrides?.osLabel ?? image.osLabel,
    defaultPreference: overrides?.defaultPreference ?? image.defaultPreference,
  };
}

const IMAGE_CATALOG: CatalogImage[] = [
  // ── General-purpose containerdisks ──────────────────────────────
  {
    id: 'fedora',
    name: 'Fedora',
    description: 'Fedora Cloud Server image',
    icon: 'mdi:fedora',
    iconColor: '#51A2DA',
    registry: 'quay.io/containerdisks/fedora',
    tags: ['latest', '43', '42', '40', '39'],
    defaultTag: 'latest',
    recommendedSize: '10Gi',
    osLabel: 'fedora',
    defaultPreference: 'fedora',
    category: 'general',
  },
  {
    id: 'ubuntu',
    name: 'Ubuntu',
    description: 'Ubuntu Server cloud image',
    icon: 'mdi:ubuntu',
    iconColor: '#E95420',
    registry: 'quay.io/containerdisks/ubuntu',
    tags: ['24.04', '22.04'],
    defaultTag: '24.04',
    recommendedSize: '10Gi',
    osLabel: 'ubuntu',
    defaultPreference: 'ubuntu',
    category: 'general',
  },
  {
    id: 'debian',
    name: 'Debian',
    description: 'Debian stable cloud image',
    icon: 'mdi:debian',
    iconColor: '#A80030',
    registry: 'quay.io/containerdisks/debian',
    tags: ['latest', '13', '12', '11'],
    defaultTag: 'latest',
    recommendedSize: '10Gi',
    osLabel: 'debian',
    defaultPreference: 'debian',
    category: 'general',
  },
  {
    id: 'centos-stream',
    name: 'CentOS Stream',
    description: 'CentOS Stream cloud image',
    icon: 'mdi:centos',
    iconColor: '#932279',
    registry: 'quay.io/containerdisks/centos-stream',
    tags: ['10', '9'],
    defaultTag: '9',
    recommendedSize: '10Gi',
    osLabel: 'centos-stream9',
    defaultPreference: 'centos.stream9',
    tagOverrides: {
      '10': { osLabel: 'centos-stream10', defaultPreference: 'centos.stream10' },
    },
    category: 'general',
  },
  {
    id: 'opensuse-leap',
    name: 'openSUSE Leap',
    description: 'openSUSE Leap stable cloud image',
    icon: 'simple-icons:opensuse',
    iconColor: '#73BA25',
    registry: 'quay.io/containerdisks/opensuse-leap',
    tags: ['15.6'],
    defaultTag: '15.6',
    recommendedSize: '10Gi',
    osLabel: 'opensuse',
    defaultPreference: 'opensuse.leap',
    category: 'general',
  },
  {
    id: 'opensuse-tumbleweed',
    name: 'openSUSE Tumbleweed',
    description: 'openSUSE Tumbleweed rolling-release cloud image',
    icon: 'simple-icons:opensuse',
    iconColor: '#73BA25',
    registry: 'quay.io/containerdisks/opensuse-tumbleweed',
    tags: ['1.0.0'],
    defaultTag: '1.0.0',
    recommendedSize: '10Gi',
    osLabel: 'opensuse',
    defaultPreference: 'opensuse.tumbleweed',
    category: 'general',
  },

  // ── Fedora CoreOS ───────────────────────────────────────────────
  {
    id: 'fedora-coreos',
    name: 'Fedora CoreOS',
    description: 'Minimal, auto-updating, container-focused OS',
    icon: 'mdi:fedora',
    iconColor: '#51A2DA',
    registry: 'quay.io/fedora/fedora-coreos-kubevirt',
    tags: ['stable', 'testing', 'next'],
    defaultTag: 'stable',
    recommendedSize: '10Gi',
    osLabel: 'fedora-coreos',
    defaultPreference: 'fedora',
    category: 'coreos',
  },

  // ── Testing / demo disks ────────────────────────────────────────
  {
    id: 'cirros',
    name: 'CirrOS',
    description: 'Tiny cloud image for testing (< 20 MB)',
    icon: 'mdi:cloud-outline',
    iconColor: '#FF6F00',
    registry: 'quay.io/kubevirt/cirros-container-disk-demo',
    tags: ['latest', 'v1.8.0'],
    defaultTag: 'latest',
    recommendedSize: '1Gi',
    osLabel: 'cirros',
    defaultPreference: 'cirros',
    category: 'testing',
  },
  {
    id: 'alpine',
    name: 'Alpine Linux',
    description: 'Lightweight Linux for testing',
    icon: 'simple-icons:alpinelinux',
    iconColor: '#0D597F',
    registry: 'quay.io/kubevirt/alpine-container-disk-demo',
    tags: ['latest', 'v1.8.0'],
    defaultTag: 'latest',
    recommendedSize: '1Gi',
    osLabel: 'alpine',
    defaultPreference: 'alpine',
    category: 'testing',
  },
  {
    id: 'fedora-test-tooling',
    name: 'Fedora (Test Tooling)',
    description: 'Fedora with pre-installed test utilities',
    icon: 'mdi:fedora',
    iconColor: '#51A2DA',
    registry: 'quay.io/kubevirt/fedora-with-test-tooling-container-disk',
    tags: ['latest', 'v1.8.0'],
    defaultTag: 'latest',
    recommendedSize: '10Gi',
    osLabel: 'fedora',
    category: 'testing',
  },
  {
    id: 'alpine-test-tooling',
    name: 'Alpine (Test Tooling)',
    description: 'Alpine with pre-installed test utilities',
    icon: 'simple-icons:alpinelinux',
    iconColor: '#0D597F',
    registry: 'quay.io/kubevirt/alpine-with-test-tooling-container-disk',
    tags: ['latest', 'v1.8.0'],
    defaultTag: 'latest',
    recommendedSize: '1Gi',
    osLabel: 'alpine',
    defaultPreference: 'alpine',
    category: 'testing',
  },
];

export default IMAGE_CATALOG;

export const CATALOG_CATEGORIES: Record<CatalogImage['category'], string> = {
  general: 'General Purpose',
  coreos: 'CoreOS',
  testing: 'Testing / Demo',
};
