# Fuzzing

This project uses two complementary fuzzing approaches:

- **fast-check** — property-based testing integrated into Jest (`src/utils/pluginSettings.test.ts`)
- **ClusterFuzzLite + Jazzer.js** — coverage-guided fuzzing for OpenSSF Scorecard compliance

## Fuzz targets

| Target | File | What it fuzzes |
|--------|------|----------------|
| `fuzz_validators` | `fuzz/fuzz_validators.js` | `isValidImageRef`, `isValidRegistry`, `isValidRepo` — user-controlled input validators, checks for ReDoS and logic bugs |
| `fuzz_settings` | `fuzz/fuzz_settings.js` | `getPluginSettings` — parses untrusted JSON from localStorage, checks structural invariants and round-trip stability |

## Running locally

### fast-check (via Jest)

```bash
npx @kinvolk/headlamp-plugin test .
```

Runs ~15k generated inputs across 17 property-based tests.

### Jazzer.js

```bash
# Compile TypeScript to JS (CommonJS)
npx tsc --outDir lib --rootDir src \
  --module commonjs --target es2020 \
  --esModuleInterop true --skipLibCheck true \
  --resolveJsonModule true \
  src/utils/pluginSettings.ts

# Copy and patch a target (fuzz targets import from src/, need lib/)
cp fuzz/fuzz_validators.js fuzz/_run.js
sed -i 's|../src/utils/pluginSettings|../lib/utils/pluginSettings|g' fuzz/_run.js

# Run for 30 seconds
npx jazzer fuzz/_run.js --sync -- -max_total_time=30

# Clean up
rm fuzz/_run.js lib/ -rf
```

## Adding a new fuzz target

1. Create `fuzz/fuzz_<name>.js` with a `module.exports.fuzz` function:

```javascript
const { FuzzedDataProvider } = require('@jazzer.js/core');
const { myFunction } = require('../src/utils/myModule');

module.exports.fuzz = function (data) {
  const provider = new FuzzedDataProvider(data);
  const input = provider.consumeString(512, 'utf-8');
  myFunction(input); // must not throw or hang
};
```

2. Register it in `.clusterfuzzlite/build.sh`:

```bash
compile_javascript_fuzzer headlamp-kubevirt fuzz/fuzz_<name>.js --sync
```

3. Optionally add matching fast-check properties in a `.test.ts` file.

## CI workflows

| Workflow | Trigger | Duration |
|----------|---------|----------|
| `cflite_pr.yml` | PRs touching `src/`, `fuzz/`, `.clusterfuzzlite/` | 5 min |
| `cflite_batch.yml` | Weekly (Monday 06:00 UTC) | 30 min |

Both output SARIF results to GitHub's Security tab.
