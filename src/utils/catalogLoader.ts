import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import yaml from 'js-yaml';
import IMAGE_CATALOG, {
  CatalogImage,
  CatalogImageTag,
} from '../components/DataImportCrons/imageCatalog';
import { isValidCategory, isValidSourceType } from './catalogUtils';

const CATALOG_LABEL = 'headlamp-kubevirt.io/image-catalog';

interface ConfigMapCatalogSpec {
  kind?: string;
  name: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  iconUrl?: string;
  osLabel?: string;
  defaultPreference?: string;
  recommendedSize?: string;
  category?: string;
  sourceType?: string;
  registry?: string;
  tags?: Array<string | CatalogImageTag>;
}

/** Parse a ConfigMap's spec data into a CatalogImage */
function parseConfigMapEntry(
  cmName: string,
  cmNamespace: string,
  specYaml: string
): CatalogImage | null {
  try {
    const spec = yaml.load(specYaml) as ConfigMapCatalogSpec;
    if (!spec?.name) return null;

    const id = `custom-${cmNamespace}-${cmName}`;

    // Parse tags — can be simple strings or extended objects
    const parsedTags: string[] = [];
    const extendedTags: CatalogImageTag[] = [];
    const tagOverrides: Record<string, { osLabel?: string; defaultPreference?: string }> = {};
    let defaultTag = '';

    if (Array.isArray(spec.tags)) {
      for (const tag of spec.tags) {
        if (typeof tag === 'string') {
          parsedTags.push(tag);
          extendedTags.push({ name: tag });
          if (!defaultTag) defaultTag = tag;
        } else {
          parsedTags.push(tag.name);
          extendedTags.push(tag);
          if (tag.default) defaultTag = tag.name;
          if (tag.osLabel || tag.defaultPreference) {
            tagOverrides[tag.name] = {
              osLabel: tag.osLabel,
              defaultPreference: tag.defaultPreference,
            };
          }
        }
      }
    }
    if (!defaultTag && parsedTags.length > 0) defaultTag = parsedTags[0];

    return {
      id,
      name: spec.name,
      description: spec.description || '',
      icon: spec.icon || 'mdi:package-variant',
      iconColor: spec.iconColor,
      iconUrl: spec.iconUrl,
      registry: spec.registry || '',
      tags: parsedTags,
      defaultTag,
      recommendedSize: spec.recommendedSize || '10Gi',
      osLabel: spec.osLabel || spec.name.toLowerCase().replace(/\s+/g, '-'),
      defaultPreference: spec.defaultPreference,
      tagOverrides: Object.keys(tagOverrides).length > 0 ? tagOverrides : undefined,
      category: isValidCategory(spec.category) ? spec.category : 'custom',
      sourceType: isValidSourceType(spec.sourceType) ? spec.sourceType : 'containerdisk',
      source: 'configmap',
      sourceRef: `${cmNamespace}/${cmName}`,
      extendedTags,
    };
  } catch {
    return null;
  }
}

/** Fetch all catalog ConfigMaps from all namespaces and parse them */
export async function loadCustomCatalogEntries(): Promise<CatalogImage[]> {
  try {
    const resp = (await ApiProxy.request(
      `/api/v1/configmaps?labelSelector=${encodeURIComponent(CATALOG_LABEL + '=true')}`
    )) as {
      items?: Array<{
        metadata: { name: string; namespace: string };
        data?: Record<string, string>;
      }>;
    };

    const entries: CatalogImage[] = [];
    for (const cm of resp?.items || []) {
      const specData = cm.data?.spec;
      if (specData) {
        const entry = parseConfigMapEntry(cm.metadata.name, cm.metadata.namespace, specData);
        if (entry) entries.push(entry);
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/** Get the full merged catalog: built-in + custom ConfigMap entries.
 * Custom entries with the same name as built-in override them. */
export async function getFullCatalog(): Promise<CatalogImage[]> {
  const custom = await loadCustomCatalogEntries();

  // Mark built-in entries
  const builtIn = IMAGE_CATALOG.map(img => ({ ...img, source: 'builtin' as const }));

  // Custom entries override built-in by name match
  const customNames = new Set(custom.map(c => c.name.toLowerCase()));
  const filtered = builtIn.filter(b => !customNames.has(b.name.toLowerCase()));

  return [...filtered, ...custom];
}

/** ConfigMap YAML for creating a new catalog entry */
export function buildCatalogConfigMap(
  name: string,
  namespace: string,
  spec: ConfigMapCatalogSpec
): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: `catalog-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`,
      namespace,
      labels: {
        [CATALOG_LABEL]: 'true',
      },
    },
    data: {
      spec: yaml.dump({ kind: 'ImageCatalogEntry', ...spec }, { lineWidth: -1, noRefs: true }),
    },
  };
}
