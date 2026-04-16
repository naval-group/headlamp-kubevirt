# Headlamp KubeVirt Plugin

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/naval-group/headlamp-kubevirt/badge)](https://scorecard.dev/viewer/?uri=github.com/naval-group/headlamp-kubevirt)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12240/badge)](https://www.bestpractices.dev/projects/12240)
[![ArtifactHub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/headlamp-kubevirt)](https://artifacthub.io/packages/headlamp/headlamp-kubevirt/headlamp_kubevirt)
[![GHCR](https://img.shields.io/badge/GHCR-naval--group%2Fheadlamp--kubevirt-blue?logo=github)](https://github.com/naval-group/headlamp-kubevirt/pkgs/container/headlamp-kubevirt)
[![Release](https://img.shields.io/github/v/release/naval-group/headlamp-kubevirt?logo=github)](https://github.com/naval-group/headlamp-kubevirt/releases/latest)
[![License](https://img.shields.io/github/license/naval-group/headlamp-kubevirt)](https://github.com/naval-group/headlamp-kubevirt/blob/main/LICENSE)

A comprehensive [Headlamp](https://headlamp.dev) plugin for managing [KubeVirt](https://kubevirt.io) virtual machines in Kubernetes.

Originally based on the excellent work from [buttahtoast](https://github.com/buttahtoast/headlamp-plugins/tree/main/kubevirt).

> **Disclaimer:** This is an independent community plugin. It is not maintained by, affiliated with,
> or endorsed by the [KubeVirt](https://kubevirt.io) project. For KubeVirt issues, please use the
> [KubeVirt issue tracker](https://github.com/kubevirt/kubevirt/issues). For issues with this plugin,
> please use [our issue tracker](https://github.com/naval-group/headlamp-kubevirt/issues).

## Features

- **Virtual Machines** - Full lifecycle management (create, start, stop, restart, migrate, pause, snapshot, export), VNC console, serial terminal, live metrics
- **VM Doctor** - Per-VM diagnostic panel with conditions, events, metrics, PromQL querier, guest OS info, VM/pod shell, logs, YAML, memory dump with Volatility3 forensic analysis, and disk inspector
- **VM Templates** - Create, manage, and instantiate VirtualMachineTemplates with parameter substitution
- **Image Catalog** - Built-in OS images and custom entries via ConfigMaps, with hide/show toggle and icon picker
- **Instance Types & Preferences** - Browse and manage VirtualMachineClusterInstanceTypes and VirtualMachineClusterPreferences
- **Bootable Volumes** - Manage DataSources, DataVolumes (HTTP, Registry, S3, PVC, Upload), and DataImportCrons for OS images
- **Networking** - Create and manage Network Attachment Definitions (Multus CNI)
- **Live Migration** - Monitor VirtualMachineInstanceMigrations
- **Snapshots & Exports** - Create and restore VM snapshots, export VMs
- **Overview Dashboard** - Cluster-wide VM status, Prometheus-powered metrics (CPU, memory, network, storage top consumers)
- **Settings** - KubeVirt/CDI version display, feature gate management with maturity labels (GA/Beta/Alpha/Deprecated), migration configuration, RBAC aggregation, VM delete protection

## Screenshots

### Overview Dashboard

Prometheus-powered top consumers for CPU, memory, network, and storage across all VMs.

![Overview Dashboard](screenshots/overview-dashboard.png)

### Virtual Machine Management

Full lifecycle management with context menu actions: Start, Stop, Restart, Pause, Migrate, Protect, Edit, and Delete. Live migration notifications appear in the status bar.

![VM List](screenshots/vm-list-actions.png)

### VM Details

Detailed view showing status, CPU, memory, node placement, guest OS info, and links to the VMI and virt-launcher pod.

![VM Details](screenshots/vm-details.png)

Scroll down for network interfaces, disks & volumes, and live CPU/memory metrics charts.

![VM Details - Metrics](screenshots/vm-details-metrics.png)

### Console Access

Built-in serial console and VNC console for direct VM interaction.

|                  Serial Console                   |                 VNC Console                 |
| :-----------------------------------------------: | :-----------------------------------------: |
| ![Serial Console](screenshots/serial-console.png) | ![VNC Console](screenshots/vnc-console.png) |

### Create Virtual Machine

Guided VM creation wizard with Form, Editor, Documentation, and Upload tabs. Configure name, boot source, resources, network interfaces, disks, scheduling, and advanced options.

|             Create VM Form              |                 API Documentation                 |
| :-------------------------------------: | :-----------------------------------------------: |
| ![Create VM](screenshots/create-vm.png) | ![Create VM Docs](screenshots/create-vm-docs.png) |

### Instance Types & Preferences

Browse and manage VirtualMachineClusterInstanceTypes and VirtualMachineClusterPreferences.

|                  Instance Types                   |                 Preferences                 |
| :-----------------------------------------------: | :-----------------------------------------: |
| ![Instance Types](screenshots/instance-types.png) | ![Preferences](screenshots/preferences.png) |

### Storage

Manage DataSources and DataImportCrons for automated OS image imports.

|                 DataSources                 |                      Create DataImportCron                      |
| :-----------------------------------------: | :-------------------------------------------------------------: |
| ![DataSources](screenshots/datasources.png) | ![Create DataImportCron](screenshots/create-dataimportcron.png) |

### Networking

Create and manage Network Attachment Definitions with support for Bridge, Macvlan, IPvlan, VLAN, Host Device, SR-IOV, PTP, and TAP types.

![Create NAD](screenshots/create-nad.png)

### Live Migration

Monitor VirtualMachineInstanceMigrations with source/target node tracking and status.

![Migrations](screenshots/migrations.png)

### VM Templates

Create, edit, and instantiate VirtualMachineTemplates. Templates support parameter substitution for generating VMs from golden images.

![VM Templates](docs/screenshots/vm-templates.png)

### VM Doctor

Per-VM diagnostic panel accessible from the VM details page. Provides a unified view of everything related to a VM across multiple tabs.

**Conditions** - Aggregated conditions from the VirtualMachine, VirtualMachineInstance, Pod, and DataVolumes. Highlights conditions that need attention.

![VM Doctor - Conditions](docs/screenshots/vm-doctor-conditions.png)

**Events** - Filtered Kubernetes events related to the VM, with type filtering and search.

![VM Doctor - Events](docs/screenshots/vm-doctor-events.png)

**Metrics** - Live CPU, memory, network throughput, storage throughput, storage IOPS, and swap activity charts powered by Prometheus.

![VM Doctor - Metrics](docs/screenshots/vm-doctor-metrics.png)

**Guest Info** - Operating system details, logged-in users, filesystems with usage bars, and network interfaces. Requires the QEMU guest agent.

![VM Doctor - Guest Info](docs/screenshots/vm-doctor-guest-info.png)

**Pod Shell** - Direct shell access to the virt-launcher compute container with a command reference sidebar. Click-to-run virsh commands for VM status, resources, configuration, and diagnostics.

![VM Doctor - Pod Shell](docs/screenshots/vm-doctor-pod-shell.png)

**Memory Dump** - Trigger and download VM memory dumps. Launch a Volatility3 forensic analysis pod with ISF symbol auto-detection, interactive shell, and command reference sidebar.

![VM Doctor - Memory Dump](docs/screenshots/vm-doctor-memory-dump.png)

**Disk Inspector** - Boot a lightweight Alpine VM with the selected disk(s) attached as secondary block devices. Browse files, inspect partitions, repair bootloaders, and check installed packages.

![VM Doctor - Disk Inspector](docs/screenshots/vm-doctor-disk-inspector.png)

### Image Catalog

Browse built-in OS images and add custom entries via ConfigMaps. Hide/show images from pickers, searchable by name and category. See [Image Catalog documentation](docs/image-catalog/README.md) for details on adding custom entries.

![Image Catalog](docs/image-catalog/catalog-overview.png)

### Settings & Feature Gates

View KubeVirt and CDI versions, manage feature gates with categorized toggle switches (Storage, Network, Compute, Devices, Security, Migration, Display).

|               Settings                |                  Feature Gates                  |
| :-----------------------------------: | :---------------------------------------------: |
| ![Settings](screenshots/settings.png) | ![Feature Gates](screenshots/feature-gates.png) |

## Prerequisites

- Kubernetes cluster with [KubeVirt](https://kubevirt.io/user-guide/cluster_admin/installation/) installed
- [CDI (Containerized Data Importer)](https://github.com/kubevirt/containerized-data-importer) for storage features
- Headlamp >= 0.24.0

## Installation

### Option 1: Desktop App (Plugin Mode)

For users running the Headlamp desktop application (Linux, macOS, Windows).

#### From Release Artifact

1. Download the latest `headlamp-kubevirt-*.tar.gz` from the [Releases](https://github.com/naval-group/headlamp-kubevirt/releases) page

2. Extract to your Headlamp plugins directory (the archive creates the `kubevirt/` folder automatically):

   **Linux (native)**

   ```bash
   tar -xzf headlamp-kubevirt-*.tar.gz -C ~/.config/Headlamp/plugins/
   ```

   **Linux (Flatpak)**

   ```bash
   tar -xzf headlamp-kubevirt-*.tar.gz -C ~/.var/app/io.kinvolk.Headlamp/config/Headlamp/plugins/
   ```

   **macOS**

   ```bash
   tar -xzf headlamp-kubevirt-*.tar.gz -C ~/Library/Application\ Support/Headlamp/plugins/
   ```

   **Windows (PowerShell)**

   ```powershell
   tar -xzf headlamp-kubevirt-*.tar.gz -C "$env:APPDATA\Headlamp\Config\plugins\"
   ```

3. Restart (or reload) Headlamp

#### From Source

```bash
git clone https://github.com/naval-group/headlamp-kubevirt.git
cd headlamp-kubevirt
npm install
npm run build
```

Then copy the files to the appropriate plugins directory:

```bash
mkdir -p ~/.var/app/io.kinvolk.Headlamp/config/Headlamp/plugins/kubevirt
cp dist/main.js package.json ~/.var/app/io.kinvolk.Headlamp/config/Headlamp/plugins/kubevirt/
```

### Option 2: In-Cluster (Container Mode)

For Headlamp deployed as a Kubernetes service. The plugin is served as an init container that copies the built plugin into a shared volume.

#### Using Helm

If you deploy Headlamp with the [official Helm chart](https://headlamp.dev/docs/latest/installation/in-cluster/), add the plugin as an init container:

```yaml
# values.yaml
initContainers:
  - name: headlamp-kubevirt
    image: ghcr.io/naval-group/headlamp-kubevirt:latest
    command: ['/bin/sh', '-c']
    args:
      - 'cp -r /plugins/kubevirt /headlamp-plugins/'
    volumeMounts:
      - name: headlamp-plugins
        mountPath: /headlamp-plugins

volumeMounts:
  - name: headlamp-plugins
    mountPath: /headlamp/plugins

volumes:
  - name: headlamp-plugins
    emptyDir: {}
```

Then install/upgrade:

```bash
helm repo add headlamp https://headlamp-k8s.github.io/headlamp/
helm upgrade --install headlamp headlamp/headlamp -f values.yaml
```

#### Using kubectl

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: headlamp
spec:
  template:
    spec:
      initContainers:
        - name: headlamp-kubevirt
          image: ghcr.io/naval-group/headlamp-kubevirt:latest
          command: ['/bin/sh', '-c']
          args:
            - 'cp -r /plugins/kubevirt /headlamp-plugins/'
          volumeMounts:
            - name: headlamp-plugins
              mountPath: /headlamp-plugins
      containers:
        - name: headlamp
          image: ghcr.io/headlamp-k8s/headlamp:latest
          args:
            - '-plugins-dir=/headlamp/plugins'
          volumeMounts:
            - name: headlamp-plugins
              mountPath: /headlamp/plugins
      volumes:
        - name: headlamp-plugins
          emptyDir: {}
```

## Development

```bash
# Install dependencies
npm install

# Start development server (with hot reload)
npm run start

# Build for production
npm run build

# Run tests
npm run test

# Lint
npm run lint

# Type check
npm run tsc
```

## License

Apache-2.0
