/**
 * Monkey-patch Headlamp's ResourceClasses to add KubeVirt CRD kinds.
 *
 * Headlamp's MetadataDisplay renders "Controlled by" links only for kinds
 * present in ResourceClasses. Since there's no public API to register
 * custom resource classes, we inject minimal stub entries that provide
 * the `detailsRoute` property — which is all MetadataDisplay needs.
 *
 * We access ResourceClasses through window.pluginLib.K8s to get the same
 * object reference that Headlamp's runtime components use (not a bundled copy).
 */

/** Typed accessor for Headlamp's runtime pluginLib on window. */
interface PluginLib {
  K8s?: { ResourceClasses?: Record<string, unknown> };
  Router?: { createRouteURL: (name: string, params: Record<string, string>) => string };
  ReactRouter?: { useHistory: () => { replace: (url: string) => void } };
}

export function getPluginLib(): PluginLib | undefined {
  return (window as unknown as Record<string, unknown>).pluginLib as PluginLib | undefined;
}

/** KubeVirt kinds → detail route names (must match registerRoute `name` in index.tsx). */
const KUBEVIRT_ROUTES: Record<string, string> = {
  VirtualMachine: 'virtualmachine',
  VirtualMachineInstance: 'virtualmachineinstance',
  DataVolume: 'datavolume',
  DataSource: 'datasource',
  DataImportCron: 'dataimportcron',
  VirtualMachineSnapshot: 'snapshot',
  VirtualMachineRestore: 'restore',
  VirtualMachineClone: 'clone',
  VirtualMachineExport: 'export',
  VirtualMachineInstanceMigration: 'migration',
  CDI: 'cdi',
};

/**
 * Create a minimal stub class for ResourceClasses.
 * Must be constructable (Headlamp's event system does `new ResourceClasses[kind](...)`)
 * and must have a static `detailsRoute` property (MetadataDisplay reads it).
 */
function createStubClass(routeName: string, namespaced: boolean) {
  class Stub {
    static detailsRoute = routeName;
    static isNamespaced = namespaced;
    jsonData: Record<string, unknown>;
    constructor(json: Record<string, unknown>) {
      this.jsonData = json;
    }
    getName() {
      return (this.jsonData?.metadata as Record<string, unknown>)?.name || '';
    }
    getNamespace() {
      return (this.jsonData?.metadata as Record<string, unknown>)?.namespace || '';
    }
    _class() {
      return Stub;
    }
  }
  return Stub;
}

export function registerOwnerLinksProcessor() {
  const classes = getPluginLib()?.K8s?.ResourceClasses;
  if (!classes) {
    console.warn('[kubevirt] Could not access ResourceClasses from pluginLib');
    return;
  }

  for (const [kind, routeName] of Object.entries(KUBEVIRT_ROUTES)) {
    if (!(kind in classes)) {
      const namespaced = kind !== 'CDI';
      classes[kind] = createStubClass(routeName, namespaced);
    }
  }
}
