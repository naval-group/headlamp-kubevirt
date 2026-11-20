/**
 * Helpers for choosing NetworkAttachmentDefinitions (NADs) for a VM interface.
 *
 * Multus resolves `networkName: <name>` in the pod's (VM's) namespace and
 * `networkName: <namespace>/<name>` in the given namespace, so NADs from other namespaces
 * are stored with their namespace prefix and NADs from the VM's own namespace without it.
 */

export interface NadRef {
  namespace: string;
  name: string;
}

export interface NadOption {
  /** Value stored in spec.template.spec.networks[].multus.networkName */
  value: string;
  namespace: string;
  name: string;
  /** Not in the listed NADs (e.g. already set on the VM but not readable/listed) */
  unlisted?: boolean;
}

/** Split a multus networkName into namespace and name (no prefix = the VM's namespace). */
export function parseNadRef(networkName: string, vmNamespace: string): NadRef {
  const idx = networkName.indexOf('/');
  if (idx > 0) {
    return { namespace: networkName.slice(0, idx), name: networkName.slice(idx + 1) };
  }
  return { namespace: vmNamespace, name: networkName };
}

/** The networkName to store for a NAD: plain name in the VM's namespace, else namespace/name. */
export function toNadRef(nadNamespace: string, nadName: string, vmNamespace: string): string {
  return nadNamespace === vmNamespace ? nadName : `${nadNamespace}/${nadName}`;
}

/**
 * Which namespaces to list NADs from.
 * - shared namespaces configured: the VM's namespace plus those namespaces
 * - none configured: all namespaces (undefined), unless listing all is forbidden,
 *   then only the VM's namespace
 */
export function nadListNamespaces(
  vmNamespace: string,
  sharedNamespaces: string[],
  allNamespacesForbidden: boolean
): string[] | undefined {
  if (sharedNamespaces.length > 0) {
    return [vmNamespace, ...sharedNamespaces.filter(ns => ns !== vmNamespace)];
  }
  return allNamespacesForbidden ? [vmNamespace] : undefined;
}

/**
 * Build the dropdown options: the VM's own namespace first, then the other namespaces
 * alphabetically, names sorted within a namespace. Values already used by the VM are always
 * included so editing an existing VM never drops them.
 */
export function buildNadOptions(
  nads: Array<{ namespace: string; name: string }>,
  vmNamespace: string,
  currentValues: string[] = []
): NadOption[] {
  const byValue = new Map<string, NadOption>();
  for (const nad of nads) {
    const value = toNadRef(nad.namespace, nad.name, vmNamespace);
    byValue.set(value, { value, namespace: nad.namespace, name: nad.name });
  }
  for (const current of currentValues) {
    if (!current) continue;
    const ref = parseNadRef(current, vmNamespace);
    const value = toNadRef(ref.namespace, ref.name, vmNamespace);
    if (!byValue.has(value)) byValue.set(value, { value, ...ref, unlisted: true });
  }
  return Array.from(byValue.values()).sort((a, b) => {
    if (a.namespace !== b.namespace) {
      if (a.namespace === vmNamespace) return -1;
      if (b.namespace === vmNamespace) return 1;
      return a.namespace.localeCompare(b.namespace);
    }
    return a.name.localeCompare(b.name);
  });
}
