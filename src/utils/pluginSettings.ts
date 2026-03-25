// Plugin settings stored in localStorage

const STORAGE_KEY = 'headlamp-kubevirt-settings';

export interface LabelColumn {
  label: string; // Display name
  labelKey: string; // Kubernetes label key (e.g., 'app.kubernetes.io/name')
}

export interface PluginSettings {
  customLabelColumns: LabelColumn[];
}

const defaultSettings: PluginSettings = {
  customLabelColumns: [],
};

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
