import yaml from 'js-yaml';

/** Standard options for YAML dump across the plugin */
export const YAML_DUMP_OPTIONS: yaml.DumpOptions = { lineWidth: -1, noRefs: true };

/** Dump an object to YAML with standard options */
export function dumpYaml(obj: unknown): string {
  return yaml.dump(obj, YAML_DUMP_OPTIONS);
}

/** Parse YAML to object, returns null on error */
export function parseYaml<T = Record<string, unknown>>(text: string): T | null {
  try {
    return yaml.load(text, { schema: yaml.JSON_SCHEMA }) as T;
  } catch {
    return null;
  }
}

/** Extract all ${PARAM_NAME} references from a serialized object */
export function extractParams(obj: unknown): string[] {
  const json = JSON.stringify(obj);
  const matches = json.match(/\$\{([a-zA-Z0-9_]+)\}/g) || [];
  return [...new Set(matches.map(m => m.replace(/\$\{|\}/g, '')))];
}

/** Substitute ${PARAM} placeholders in a string with values from a map */
export function substituteParams(
  text: string,
  params: Array<{ name: string; value?: string; displayName?: string }>,
  values?: Record<string, string>
): string {
  let result = text;
  params.forEach(p => {
    const val = values?.[p.name] || p.value || `<${p.displayName || p.name}>`;
    result = result.replace(new RegExp(`\\$\\{${p.name}\\}`, 'g'), val);
  });
  return result;
}
