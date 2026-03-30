// Fuzz target for plugin settings parser (validateSettings via getPluginSettings)
// Exercises JSON parsing of untrusted localStorage data — must never throw or corrupt state.

const { FuzzedDataProvider } = require('@jazzer.js/core');

const {
  getPluginSettings,
  savePluginSettings,
} = require('../src/utils/pluginSettings');

// Minimal localStorage polyfill for the fuzzing container
if (typeof globalThis.localStorage === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: key => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

const STORAGE_KEY = 'headlamp-kubevirt-settings';

/**
 * @param { Buffer } data
 */
module.exports.fuzz = function (data) {
  const provider = new FuzzedDataProvider(data);
  const input = provider.consumeString(1024, 'utf-8');

  // Inject fuzzed data as if it came from localStorage
  localStorage.setItem(STORAGE_KEY, input);

  // Must never throw — should always return valid defaults
  const result = getPluginSettings();

  // Structural invariants that must always hold
  if (!result || typeof result !== 'object') {
    throw new Error('getPluginSettings returned non-object');
  }
  if (!Array.isArray(result.customLabelColumns)) {
    throw new Error('customLabelColumns is not an array');
  }
  if (!result.forensic || typeof result.forensic !== 'object') {
    throw new Error('forensic is not an object');
  }
  if (typeof result.forensic.toolboxImage !== 'string') {
    throw new Error('toolboxImage is not a string');
  }
  if (typeof result.forensic.isfRegistry !== 'string') {
    throw new Error('isfRegistry is not a string');
  }
  if (typeof result.forensic.isfRepo !== 'string') {
    throw new Error('isfRepo is not a string');
  }

  // Round-trip: saving and reloading must be stable
  savePluginSettings(result);
  const reloaded = getPluginSettings();
  if (JSON.stringify(result) !== JSON.stringify(reloaded)) {
    throw new Error('Settings round-trip produced different output');
  }

  // Clean up for next iteration
  localStorage.clear();
};
