import { useMemo } from 'react';
import { useSelector } from 'react-redux';

/**
 * Filters an array of KubeObjects by the namespaces selected in Headlamp's
 * namespace selector. Returns the full list when no namespace filter is active.
 *
 * Uses client-side filtering so namespace changes are instant (no API re-fetch).
 */
export default function useFilteredList<T extends { getNamespace(): string }>(
  items: T[] | null
): T[] | null {
  const namespacesSet = useSelector(
    (state: { filter: { namespaces: Set<string> } }) => state.filter.namespaces
  );

  return useMemo(() => {
    if (!items) return null;
    if (!namespacesSet || namespacesSet.size === 0) return items;
    return items.filter(item => namespacesSet.has(item.getNamespace()));
  }, [items, namespacesSet]);
}
