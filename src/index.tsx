/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Icon } from '@iconify/react';
import {
  registerAppBarAction,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, IconButton, Snackbar } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import DataVolumeDetails from './components/BootableVolumes/DataVolumeDetails';
import DataVolumeList from './components/BootableVolumes/DataVolumeList';
import DataSourceDetails from './components/BootableVolumes/Details';
import DataSourceList from './components/BootableVolumes/List';
import DataImportCronDetails from './components/DataImportCrons/Details';
import DataImportCronList from './components/DataImportCrons/List';
import InstanceTypeDetails from './components/InstanceTypes/Details';
import InstanceTypeList from './components/InstanceTypes/List';
import MigrationList from './components/Migrations/List';
import NADDetails from './components/NetworkAttachmentDefinitions/Details';
import NADList from './components/NetworkAttachmentDefinitions/List';
import VirtualizationOverview from './components/Overview/Overview';
import PreferenceDetails from './components/Preferences/Details';
import PreferenceList from './components/Preferences/List';
import ExportDetails from './components/VirtualMachineExport/Details';
import ExportList from './components/VirtualMachineExport/List';
import VMIDetails from './components/VirtualMachineInstance/Details';
import VMIList from './components/VirtualMachineInstance/List';
import VirtualMachineDetails from './components/VirtualMachines/Details';
import VirtualMachineList from './components/VirtualMachines/List';
import SnapshotDetails from './components/VirtualMachineSnapshot/Details';
import SnapshotList from './components/VirtualMachineSnapshot/List';
import KubeVirtSettings from './kubevirt/Settings';
import { areFeatureGatesLoaded, getFeatureGates, loadFeatureGates } from './utils/featureGates';

// Route registration helper - DRY pattern for KubeVirt resources
interface ResourceRoute {
  name: string;
  label: string;
  path: string;
  icon: string;
  ListComponent: React.ComponentType;
  DetailsComponent?: React.ComponentType;
  detailsRouteName?: string;
  hasNamespace?: boolean;
}

function registerKubeVirtResource(config: ResourceRoute) {
  registerSidebarEntry({
    parent: 'kubevirt',
    name: config.name,
    label: config.label,
    url: `/kubevirt/${config.path}`,
    icon: config.icon,
  });

  registerRoute({
    path: `/kubevirt/${config.path}`,
    sidebar: config.name,
    component: () => <config.ListComponent />,
    exact: true,
  });

  if (config.DetailsComponent) {
    const detailPath =
      config.hasNamespace !== false
        ? `/kubevirt/${config.path}/:namespace/:name`
        : `/kubevirt/${config.path}/:name`;
    registerRoute({
      path: detailPath,
      sidebar: config.name,
      component: () => <config.DetailsComponent />,
      exact: true,
      name: config.detailsRouteName,
    });
  }
}

// Load feature gates on plugin initialization
loadFeatureGates();

// Feature gates that affect sidebar visibility
const SIDEBAR_AFFECTING_FEATURE_GATES = ['Snapshot', 'VMExport', 'DataVolumes', 'LiveMigration'];

// KubeVirt Update Watcher Component
function KubeVirtUpdateWatcher() {
  const [showReloadBanner, setShowReloadBanner] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const initialVersionRef = useRef<string | null>(null);
  const initialFeatureGatesRef = useRef<string[] | null>(null);

  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const response = await ApiProxy.request(
          '/apis/kubevirt.io/v1/namespaces/kubevirt/kubevirts'
        );
        const items = response?.items || [];
        if (items.length > 0) {
          const kv = items[0];
          const currentVersion = kv?.status?.observedKubeVirtVersion || '';
          const targetVersion = kv?.status?.targetKubeVirtVersion || '';
          const currentFeatureGates: string[] =
            kv?.spec?.configuration?.developerConfiguration?.featureGates || [];

          // Store initial values on first check
          if (initialVersionRef.current === null) {
            initialVersionRef.current = currentVersion;
            initialFeatureGatesRef.current = currentFeatureGates;
            return;
          }

          // Check if KubeVirt is updating (target != observed)
          if (targetVersion && targetVersion !== currentVersion) {
            setUpdateMessage(`KubeVirt is updating to ${targetVersion}...`);
            setShowReloadBanner(true);
            return;
          }

          // Check if version changed from initial
          if (currentVersion !== initialVersionRef.current) {
            setUpdateMessage(`KubeVirt updated to ${currentVersion}. Reload recommended.`);
            setShowReloadBanner(true);
            return;
          }

          // Check if sidebar-affecting feature gates changed
          const initialGates = initialFeatureGatesRef.current || [];
          const sidebarGatesChanged = SIDEBAR_AFFECTING_FEATURE_GATES.some(gate => {
            const wasEnabled = initialGates.includes(gate);
            const isEnabled = currentFeatureGates.includes(gate);
            return wasEnabled !== isEnabled;
          });

          if (sidebarGatesChanged) {
            setUpdateMessage('KubeVirt configuration changed. Reload recommended.');
            setShowReloadBanner(true);
            return;
          }
        }
      } catch {}
    };

    // Check immediately and then every 10 seconds
    checkForUpdates();
    const intervalId = setInterval(checkForUpdates, 10000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  if (!showReloadBanner) {
    return null;
  }

  return (
    <Snackbar open={showReloadBanner} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Alert
        severity="info"
        action={
          <Box display="flex" gap={1}>
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <IconButton size="small" color="inherit" onClick={() => setShowReloadBanner(false)}>
              <Icon icon="mdi:close" width={18} />
            </IconButton>
          </Box>
        }
        sx={{
          alignItems: 'center',
          '& .MuiAlert-message': { display: 'flex', alignItems: 'center' },
        }}
      >
        {updateMessage}
      </Alert>
    </Snackbar>
  );
}

// Register the update watcher in the app bar
registerAppBarAction(() => <KubeVirtUpdateWatcher />);

// Filter sidebar entries based on feature gates
registerSidebarEntryFilter(entry => {
  const loaded = areFeatureGatesLoaded();
  const gates = getFeatureGates();

  // Hide snapshots if Snapshot feature gate is not enabled
  if (entry.name === 'snapshots' && loaded && !gates.includes('Snapshot')) {
    return null;
  }
  // Hide exports if VMExport feature gate is not enabled
  if (entry.name === 'exports' && loaded && !gates.includes('VMExport')) {
    return null;
  }
  // Hide datavolumes if DataVolumes feature gate is not enabled
  if (entry.name === 'datavolumes' && loaded && !gates.includes('DataVolumes')) {
    return null;
  }
  // Hide migrations if LiveMigration feature gate is not enabled
  if (entry.name === 'migrations' && loaded && !gates.includes('LiveMigration')) {
    return null;
  }
  return entry;
});

// Register main sidebar entry
registerSidebarEntry({
  parent: null,
  name: 'kubevirt',
  label: 'KubeVirt',
  url: '/kubevirt/overview',
  icon: 'mdi:cloud-outline',
});

// Overview
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'overview',
  label: 'Overview',
  url: '/kubevirt/overview',
  icon: 'mdi:view-dashboard',
});

registerRoute({
  path: '/kubevirt/overview',
  sidebar: 'overview',
  component: () => <VirtualizationOverview />,
  exact: true,
});

// Register KubeVirt resources
registerKubeVirtResource({
  name: 'virtualmachines',
  label: 'Virtual Machines',
  path: 'virtualmachines',
  icon: 'mdi:monitor',
  ListComponent: VirtualMachineList,
  DetailsComponent: VirtualMachineDetails,
  detailsRouteName: 'virtualmachine',
  hasNamespace: true,
});

// VMI route (no sidebar entry - accessed from VM details links)
registerRoute({
  path: '/kubevirt/virtualmachineinstances',
  sidebar: 'virtualmachines',
  component: () => <VMIList />,
  exact: true,
});

registerRoute({
  path: '/kubevirt/virtualmachineinstances/:namespace/:name',
  sidebar: 'virtualmachines',
  component: () => <VMIDetails />,
  exact: true,
  name: 'virtualmachineinstance',
});

registerKubeVirtResource({
  name: 'instancetypes',
  label: 'Instance Types',
  path: 'instancetypes',
  icon: 'mdi:shape',
  ListComponent: InstanceTypeList,
  DetailsComponent: InstanceTypeDetails,
  detailsRouteName: 'instancetype',
  hasNamespace: false,
});

registerKubeVirtResource({
  name: 'preferences',
  label: 'Preferences',
  path: 'preferences',
  icon: 'mdi:tune',
  ListComponent: PreferenceList,
  DetailsComponent: PreferenceDetails,
  detailsRouteName: 'preference',
  hasNamespace: false,
});

registerKubeVirtResource({
  name: 'datasources',
  label: 'DataSources',
  path: 'datasources',
  icon: 'mdi:database',
  ListComponent: DataSourceList,
  DetailsComponent: DataSourceDetails,
  detailsRouteName: 'datasource',
  hasNamespace: true,
});

registerKubeVirtResource({
  name: 'datavolumes',
  label: 'DataVolumes',
  path: 'datavolumes',
  icon: 'mdi:database-import',
  ListComponent: DataVolumeList,
  DetailsComponent: DataVolumeDetails,
  detailsRouteName: 'datavolume',
  hasNamespace: true,
});

registerKubeVirtResource({
  name: 'migrations',
  label: 'Migrations',
  path: 'migrations',
  icon: 'mdi:swap-horizontal',
  ListComponent: MigrationList,
});

registerKubeVirtResource({
  name: 'networks',
  label: 'Networks',
  path: 'networks',
  icon: 'mdi:lan',
  ListComponent: NADList,
  DetailsComponent: NADDetails,
  detailsRouteName: 'nad',
  hasNamespace: true,
});

registerKubeVirtResource({
  name: 'snapshots',
  label: 'Snapshots',
  path: 'snapshots',
  icon: 'mdi:camera',
  ListComponent: SnapshotList,
  DetailsComponent: SnapshotDetails,
  detailsRouteName: 'snapshot',
  hasNamespace: true,
});

registerKubeVirtResource({
  name: 'exports',
  label: 'Exports',
  path: 'exports',
  icon: 'mdi:export',
  ListComponent: ExportList,
  DetailsComponent: ExportDetails,
  detailsRouteName: 'export',
  hasNamespace: true,
});

registerKubeVirtResource({
  name: 'dataimportcrons',
  label: 'DataImportCrons',
  path: 'dataimportcrons',
  icon: 'mdi:calendar-sync',
  ListComponent: DataImportCronList,
  DetailsComponent: DataImportCronDetails,
  detailsRouteName: 'dataimportcron',
  hasNamespace: true,
});

// Settings - Last in sidebar
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'settings',
  label: 'Settings',
  url: '/kubevirt/settings',
  icon: 'mdi:cog',
});

registerRoute({
  path: '/kubevirt/settings',
  sidebar: 'settings',
  component: () => <KubeVirtSettings />,
  exact: true,
});
