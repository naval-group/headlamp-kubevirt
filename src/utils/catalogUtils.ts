import {
  CatalogCategory,
  CatalogImage,
  CatalogSourceType,
} from '../components/DataImportCrons/imageCatalog';

// ── Hidden images (localStorage) ────────────────────────────────────

const HIDDEN_IMAGES_KEY = 'headlamp-kubevirt-hidden-catalog-images';

export function getHiddenImageIds(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_IMAGES_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function setHiddenImageIds(ids: Set<string>): void {
  localStorage.setItem(HIDDEN_IMAGES_KEY, JSON.stringify([...ids]));
}

// ── Filtering ───────────────────────────────────────────────────────

export interface CatalogFilterOptions {
  search: string;
  categoryFilter: string;
  showHidden: boolean;
  hiddenIds: Set<string>;
  allowedSourceTypes?: Array<'containerdisk' | 'http'>;
}

export function filterCatalogImages(
  catalog: CatalogImage[],
  options: CatalogFilterOptions
): CatalogImage[] {
  return catalog.filter(img => {
    if (!options.showHidden && options.hiddenIds.has(img.id)) return false;
    const q = options.search.toLowerCase();
    const matchesSearch =
      !q ||
      img.name.toLowerCase().includes(q) ||
      img.description.toLowerCase().includes(q) ||
      img.osLabel.toLowerCase().includes(q);
    const matchesCategory =
      options.categoryFilter === 'all' ||
      img.category === options.categoryFilter ||
      (options.categoryFilter === 'custom' && img.source === 'configmap');
    const matchesSourceType =
      !options.allowedSourceTypes ||
      options.allowedSourceTypes.includes(img.sourceType || 'containerdisk');
    return matchesSearch && matchesCategory && matchesSourceType;
  });
}

// ── Validation helpers ──────────────────────────────────────────────

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/;

export function isValidHexColor(color: string): boolean {
  return HEX_COLOR_RE.test(color);
}

export function safeIconColor(color: string | undefined): string {
  return color && isValidHexColor(color) ? color : '#888888';
}

export function isSafeIconUrl(url: string): boolean {
  return url.startsWith('data:image/') || url.startsWith('https://');
}

export function isValidCategory(val: unknown): val is CatalogCategory {
  return ['general', 'coreos', 'testing', 'custom'].includes(val as string);
}

export function isValidSourceType(val: unknown): val is CatalogSourceType {
  return ['containerdisk', 'http'].includes(val as string);
}

// ── Error helpers ───────────────────────────────────────────────────

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}
