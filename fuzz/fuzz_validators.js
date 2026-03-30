// Fuzz target for input validators (isValidImageRef, isValidRegistry, isValidRepo)
// These accept user-controlled strings — ReDoS and logic bugs are the main risks.

const { FuzzedDataProvider } = require('@jazzer.js/core');

const {
  isValidImageRef,
  isValidRegistry,
  isValidRepo,
} = require('../src/utils/pluginSettings');

/**
 * @param { Buffer } data
 */
module.exports.fuzz = function (data) {
  const provider = new FuzzedDataProvider(data);
  const input = provider.consumeString(512, 'utf-8');

  // Each validator must complete without throwing or hanging
  isValidImageRef(input);
  isValidRegistry(input);
  isValidRepo(input);

  // Cross-check: valid registry + path should be valid image ref
  if (input.includes('/')) {
    const slashIdx = input.indexOf('/');
    const registryPart = input.slice(0, slashIdx);
    const pathPart = input.slice(slashIdx + 1);
    if (isValidRegistry(registryPart) && pathPart.length > 0) {
      // Not strictly guaranteed to be a valid image ref (path may be invalid),
      // but the validators must not throw or hang on the combined input
      isValidImageRef(input);
    }
  }
};
