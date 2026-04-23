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

import './icons';
import { Icon } from '@iconify/react';
import {
  registerAppBarAction,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, GlobalStyles, IconButton, Snackbar } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import DataVolumeDetails from './components/BootableVolumes/DataVolumeDetails';
import DataVolumeList from './components/BootableVolumes/DataVolumeList';
import DataSourceDetails from './components/BootableVolumes/Details';
import DataSourceList from './components/BootableVolumes/List';
import ErrorBoundary from './components/common/ErrorBoundary';
import DataImportCronDetails from './components/DataImportCrons/Details';
import DataImportCronList from './components/DataImportCrons/List';
import CatalogPage from './components/ImageCatalog/CatalogPage';
import InstanceTypeDetails from './components/InstanceTypes/Details';
import InstanceTypeList from './components/InstanceTypes/List';
import MigrationDetails from './components/Migrations/Details';
import MigrationList from './components/Migrations/List';
import NADDetails from './components/NetworkAttachmentDefinitions/Details';
import NADList from './components/NetworkAttachmentDefinitions/List';
import VirtualizationOverview from './components/Overview/Overview';
import { getPluginLib, registerOwnerLinksProcessor } from './components/OwnerLinks';
import PreferenceDetails from './components/Preferences/Details';
import PreferenceList from './components/Preferences/List';
import VirtualMachineCloneDetails from './components/VirtualMachineClone/Details';
import VirtualMachineCloneList from './components/VirtualMachineClone/List';
import ExportDetails from './components/VirtualMachineExport/Details';
import ExportList from './components/VirtualMachineExport/List';
import VMIDetails from './components/VirtualMachineInstance/Details';
import VMIList from './components/VirtualMachineInstance/List';
import RestoreDetails from './components/VirtualMachineRestore/Details';
import RestoreList from './components/VirtualMachineRestore/List';
import VirtualMachineDetails from './components/VirtualMachines/Details';
import VirtualMachineList from './components/VirtualMachines/List';
import SnapshotDetails from './components/VirtualMachineSnapshot/Details';
import SnapshotList from './components/VirtualMachineSnapshot/List';
import VMTemplateDetails from './components/VirtualMachineTemplate/Details';
import VMTemplateList from './components/VirtualMachineTemplate/List';
import KubeVirtSettings from './kubevirt/Settings';
import { areFeatureGatesLoaded, getFeatureGates, loadFeatureGates } from './utils/featureGates';
import { detectKubeVirtCapabilities } from './utils/kubevirtVersion';

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
    component: () => (
      <ErrorBoundary>
        <config.ListComponent />
      </ErrorBoundary>
    ),
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
      component: () => (
        <ErrorBoundary>
          <config.DetailsComponent />
        </ErrorBoundary>
      ),
      exact: true,
      name: config.detailsRouteName,
    });
  }
}

// Load feature gates and detect capabilities on plugin initialization
loadFeatureGates();
detectKubeVirtCapabilities();

// Feature gates that affect sidebar visibility
const SIDEBAR_AFFECTING_FEATURE_GATES = ['Snapshot', 'VMExport', 'DataVolumes'];

// KubeVirt Update Watcher Component
function KubeVirtUpdateWatcher() {
  const [showReloadBanner, setShowReloadBanner] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const initialVersionRef = useRef<string | null>(null);
  const initialFeatureGatesRef = useRef<string[] | null>(null);

  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const response = await ApiProxy.request('/apis/kubevirt.io/v1/kubevirts');
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

// Global tooltip style override + JSON formatter (XSS-safe: uses DOM API, not innerHTML)
function TooltipEnhancer() {
  useEffect(() => {
    const esc = (s: string) => s; // textContent is inherently safe

    const makeEl = (tag: string, styles: Record<string, string>, text?: string): HTMLElement => {
      const el = document.createElement(tag);
      Object.assign(el.style, styles);
      if (text !== undefined) el.textContent = text;
      return el;
    };

    const summarize = (val: unknown): string => {
      if (val === null || val === undefined) return 'null';
      if (typeof val !== 'object') return String(val);
      if (Array.isArray(val)) return `[${val.length} items]`;
      const keys = Object.keys(val);
      return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
    };

    const MAX_DEPTH = 2;

    const buildRows = (tbody: HTMLElement, obj: Record<string, unknown>, depth: number) => {
      for (const [key, val] of Object.entries(obj)) {
        const tr = document.createElement('tr');
        const tdKey = makeEl(
          'td',
          {
            padding: `2px 8px 2px ${8 + depth * 12}px`,
            color: 'rgba(255,255,255,0.5)',
            whiteSpace: 'nowrap',
            verticalAlign: 'top',
            fontSize: '0.75rem',
          },
          esc(key)
        );
        tr.appendChild(tdKey);

        if (depth < MAX_DEPTH && val && typeof val === 'object' && !Array.isArray(val)) {
          // Nested object: show key as section header, recurse
          const tdEmpty = makeEl('td', {});
          tr.appendChild(tdEmpty);
          tbody.appendChild(tr);
          buildRows(tbody, val as Record<string, unknown>, depth + 1);
        } else {
          // Leaf or max-depth: show summarized value
          const tdVal = makeEl(
            'td',
            {
              padding: '2px 8px',
              color: '#fff',
              wordBreak: 'break-all',
              fontSize: '0.75rem',
            },
            esc(typeof val === 'object' ? summarize(val) : String(val ?? 'null'))
          );
          tr.appendChild(tdVal);
          tbody.appendChild(tr);
        }
      }
    };

    const formatJsonTooltip = (el: HTMLElement) => {
      if (el.dataset.formatted) return;
      const text = el.textContent || '';
      if (!text.includes('{"') && !text.includes(':{')) return;
      const jsonStart = text.indexOf('{');
      if (jsonStart < 0) return;
      const prefix = text.slice(0, jsonStart).trim().replace(/:$/, '');
      const jsonStr = text.slice(jsonStart);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        return;
      }
      el.dataset.formatted = '1';

      // Clear existing content safely
      while (el.firstChild) el.removeChild(el.firstChild);

      // Header
      if (prefix) {
        el.appendChild(
          makeEl(
            'div',
            {
              padding: '6px 10px 4px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              textTransform: 'uppercase',
              fontSize: '0.65rem',
              fontWeight: '600',
              letterSpacing: '0.5px',
              color: 'rgba(255,255,255,0.5)',
            },
            prefix
          )
        );
      }

      // Table
      const table = makeEl('table', { width: '100%', borderCollapse: 'collapse' });
      const tbody = document.createElement('tbody');
      buildRows(tbody, parsed, 0);
      table.appendChild(tbody);
      el.appendChild(table);
    };

    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        m.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          if (node.classList?.contains('MuiTooltip-tooltip')) {
            formatJsonTooltip(node);
          }
          node
            .querySelectorAll?.('.MuiTooltip-tooltip')
            .forEach(t => formatJsonTooltip(t as HTMLElement));
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <GlobalStyles
      styles={{
        '.MuiTooltip-tooltip': {
          backgroundColor: '#1e1e1e !important',
          color: '#e0e0e0 !important',
          border: '1px solid rgba(255,255,255,0.12) !important',
          borderRadius: '8px !important',
          fontSize: '0.8rem !important',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4) !important',
          padding: '8px 12px !important',
          maxWidth: '600px !important',
        },
        '.MuiTooltip-tooltip[data-formatted]': {
          padding: '0 !important',
          maxWidth: '700px !important',
        },
        '.MuiTooltip-arrow': {
          color: '#1e1e1e !important',
          '&::before': {
            border: '1px solid rgba(255,255,255,0.12) !important',
          },
        },
      }}
    />
  );
}
registerAppBarAction(() => <TooltipEnhancer />);

// Filter sidebar entries based on feature gates
registerSidebarEntryFilter(entry => {
  const loaded = areFeatureGatesLoaded();
  const gates = getFeatureGates();

  // Hide snapshots if Snapshot feature gate is not enabled
  if (entry.name === 'snapshots' && loaded && !gates.includes('Snapshot')) {
    return null;
  }
  // Hide clones if Snapshot feature gate is not enabled (clone requires snapshot)
  if (entry.name === 'clones' && loaded && !gates.includes('Snapshot')) {
    return null;
  }
  // Hide restores if Snapshot feature gate is not enabled
  if (entry.name === 'restores' && loaded && !gates.includes('Snapshot')) {
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
  name: 'kubevirt-overview',
  label: 'Overview',
  url: '/kubevirt/overview',
  icon: 'mdi:view-dashboard',
});

registerRoute({
  path: '/kubevirt/overview',
  sidebar: 'kubevirt-overview',
  component: () => (
    <ErrorBoundary>
      <VirtualizationOverview />
    </ErrorBoundary>
  ),
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
  component: () => (
    <ErrorBoundary>
      <VMIList />
    </ErrorBoundary>
  ),
  exact: true,
});

registerRoute({
  path: '/kubevirt/virtualmachineinstances/:namespace/:name',
  sidebar: 'virtualmachines',
  component: () => (
    <ErrorBoundary>
      <VMIDetails />
    </ErrorBoundary>
  ),
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
  name: 'vmtemplates',
  label: 'Templates',
  path: 'templates',
  icon: 'mdi:text-box-outline',
  ListComponent: VMTemplateList,
  DetailsComponent: VMTemplateDetails,
  detailsRouteName: 'vmtemplate',
  hasNamespace: true,
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
  DetailsComponent: MigrationDetails,
  detailsRouteName: 'migration',
  hasNamespace: true,
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
  name: 'clones',
  label: 'Clones',
  path: 'clones',
  icon: 'mdi:content-copy',
  ListComponent: VirtualMachineCloneList,
  DetailsComponent: VirtualMachineCloneDetails,
  detailsRouteName: 'clone',
  hasNamespace: true,
});

registerKubeVirtResource({
  name: 'restores',
  label: 'Restores',
  path: 'restores',
  icon: 'mdi:restore',
  ListComponent: RestoreList,
  DetailsComponent: RestoreDetails,
  detailsRouteName: 'restore',
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

// Image Catalog — not a CRD, registered as a simple page
registerSidebarEntry({
  parent: 'kubevirt',
  name: 'kubevirt-imagecatalog',
  label: 'Image Catalog',
  url: '/kubevirt/imagecatalog',
  icon: 'mdi:image-multiple',
});
registerRoute({
  path: '/kubevirt/imagecatalog',
  sidebar: 'kubevirt-imagecatalog',
  component: () => (
    <ErrorBoundary>
      <CatalogPage />
    </ErrorBoundary>
  ),
  exact: true,
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
  name: 'kubevirt-settings',
  label: 'Settings',
  url: '/kubevirt/settings',
  icon: 'mdi:cog',
});

registerRoute({
  path: '/kubevirt/settings',
  sidebar: 'kubevirt-settings',
  component: () => (
    <ErrorBoundary>
      <KubeVirtSettings />
    </ErrorBoundary>
  ),
  exact: true,
});

// CDI detail route — redirects to Headlamp's custom resource detail page.
// This enables the "Controlled by: CDI" link on CronJobs owned by the CDI operator.
function CDIRedirect() {
  const lib = getPluginLib();
  const history = lib?.ReactRouter?.useHistory();
  const url = lib?.Router?.createRouteURL('customresource', {
    crd: 'cdis.cdi.kubevirt.io',
    namespace: '-',
    crName: 'cdi',
  });

  useEffect(() => {
    if (url && history) history.replace(url);
  }, [url, history]);

  if (!url) {
    return <Box p={4}>Unable to resolve CDI custom resource page.</Box>;
  }
  return null;
}

registerRoute({
  path: '/kubevirt/cdi/:namespace/:name',
  sidebar: 'kubevirt-settings',
  component: () => (
    <ErrorBoundary>
      <CDIRedirect />
    </ErrorBoundary>
  ),
  exact: true,
  name: 'cdi',
});

// Add clickable links for KubeVirt owner references on native resource pages
registerOwnerLinksProcessor();
