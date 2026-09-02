// Plugin settings stored in localStorage

const STORAGE_KEY = 'headlamp-kubevirt-settings';

export interface LabelColumn {
  label: string; // Display name
  labelKey: string; // Kubernetes label key (e.g., 'app.kubernetes.io/name')
}

export interface ForensicSettings {
  toolboxImage: string; // Forensic toolbox image (vol-qemu + vol3)
  isfRegistry: string; // ISF image registry (e.g., 'ghcr.io')
  isfRepo: string; // ISF image repository name (e.g., 'genesary/kernel-isf-oci')
  isfSuffix: string; // Tag suffix appended after kernel version (e.g., '-busybox')
}

export interface GuestfsSettings {
  image: string; // ContainerDisk image for disk inspector VM
}

export interface PluginSettings {
  customLabelColumns: LabelColumn[];
  forensic: ForensicSettings;
  guestfs: GuestfsSettings;
}

export const defaultForensicSettings: ForensicSettings = {
  toolboxImage: 'sk4la/volatility3:2.26',
  isfRegistry: 'ghcr.io',
  isfRepo: 'genesary/kernel-isf-oci',
  isfSuffix: '-busybox',
};

export const defaultGuestfsSettings: GuestfsSettings = {
  image: '', // Empty = use INSPECTOR_IMAGE default (alpine-with-test-tooling)
};

const defaultSettings: PluginSettings = {
  customLabelColumns: [],
  forensic: { ...defaultForensicSettings },
  guestfs: { ...defaultGuestfsSettings },
};

/**
 * Validate a container image reference.
 * Accepts: registry[:port]/repo[:tag], user/image:tag, or registry.fqdn/repo:tag
 * Must contain a slash (registry/repo or user/image).
 */
export function isValidImageRef(value: string): boolean {
  // hostname label: starts/ends with alnum, dashes allowed in middle (no dots — dots are separators)
  // This avoids ReDoS by ensuring dots cannot appear inside repeated character classes
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*(:[0-9]{1,5})?\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*(?::[a-zA-Z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/.test(
    value
  );
}

/**
 * Validate a registry FQDN (with optional port).
 */
export function isValidRegistry(value: string): boolean {
  // Same ReDoS-safe hostname pattern: dots only as literal separators between labels
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*(:[0-9]{1,5})?$/.test(
    value
  );
}

/**
 * Validate a repository name (alphanumeric, dots, dashes, slashes).
 */
export function isValidRepo(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/.test(value) && value.length <= 253;
}

function isValidLabelColumn(obj: unknown): obj is LabelColumn {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as LabelColumn).label === 'string' &&
    typeof (obj as LabelColumn).labelKey === 'string'
  );
}

function validateSettings(parsed: unknown): PluginSettings {
  if (typeof parsed !== 'object' || parsed === null) {
    return defaultSettings;
  }

  const raw = parsed as Record<string, unknown>;
  const result: PluginSettings = { ...defaultSettings };

  if (Array.isArray(raw.customLabelColumns)) {
    result.customLabelColumns = raw.customLabelColumns.filter(isValidLabelColumn);
  }

  if (typeof raw.forensic === 'object' && raw.forensic !== null) {
    const f = raw.forensic as Record<string, unknown>;
    result.forensic = {
      toolboxImage:
        typeof f.toolboxImage === 'string' && isValidImageRef(f.toolboxImage)
          ? f.toolboxImage
          : defaultForensicSettings.toolboxImage,
      isfRegistry:
        typeof f.isfRegistry === 'string' && isValidRegistry(f.isfRegistry)
          ? f.isfRegistry
          : defaultForensicSettings.isfRegistry,
      isfRepo:
        typeof f.isfRepo === 'string' && isValidRepo(f.isfRepo)
          ? f.isfRepo
          : defaultForensicSettings.isfRepo,
      isfSuffix: typeof f.isfSuffix === 'string' ? f.isfSuffix : defaultForensicSettings.isfSuffix,
    };
  }

  if (typeof raw.guestfs === 'object' && raw.guestfs !== null) {
    const g = raw.guestfs as Record<string, unknown>;
    result.guestfs = {
      image:
        typeof g.image === 'string' && (g.image === '' || isValidImageRef(g.image))
          ? g.image
          : defaultGuestfsSettings.image,
    };
  }

  return result;
}

export function getPluginSettings(): PluginSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const validated = validateSettings(parsed);
      // Write back cleaned data if validation stripped invalid entries
      if (JSON.stringify(validated) !== JSON.stringify(parsed)) {
        savePluginSettings(validated);
      }
      return validated;
    }
  } catch (error) {
    console.error('Failed to load plugin settings:', error);
    // Corrupted JSON — reset to defaults
    localStorage.removeItem(STORAGE_KEY);
  }
  return defaultSettings;
}

export function savePluginSettings(settings: PluginSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save plugin settings:', error);
  }
}

export function addLabelColumn(column: LabelColumn): void {
  const settings = getPluginSettings();
  // Avoid duplicates
  if (!settings.customLabelColumns.find(c => c.labelKey === column.labelKey)) {
    settings.customLabelColumns.push(column);
    savePluginSettings(settings);
  }
}

export function removeLabelColumn(labelKey: string): void {
  const settings = getPluginSettings();
  settings.customLabelColumns = settings.customLabelColumns.filter(c => c.labelKey !== labelKey);
  savePluginSettings(settings);
}

export function getLabelColumns(): LabelColumn[] {
  return getPluginSettings().customLabelColumns;
}

export function getForensicSettings(): ForensicSettings {
  return getPluginSettings().forensic;
}

export function saveForensicSettings(forensic: ForensicSettings): void {
  const settings = getPluginSettings();
  settings.forensic = forensic;
  savePluginSettings(settings);
}

export function getGuestfsSettings(): GuestfsSettings {
  return getPluginSettings().guestfs;
}

export function saveGuestfsSettings(guestfs: GuestfsSettings): void {
  const settings = getPluginSettings();
  settings.guestfs = guestfs;
  savePluginSettings(settings);
}
