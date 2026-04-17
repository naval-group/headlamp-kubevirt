import * as fc from 'fast-check';
import {
  getPluginSettings,
  isValidImageRef,
  isValidRegistry,
  isValidRepo,
  PluginSettings,
  savePluginSettings,
} from './pluginSettings';

// ---------------------------------------------------------------------------
// Arbitraries — generators for structured random inputs
// ---------------------------------------------------------------------------

/** A single DNS-like hostname label: starts/ends alnum, dashes allowed in middle */
const hostnameLabel = fc.stringMatching(/^[a-z0-9]([a-z0-9-]{0,10}[a-z0-9])?$/);

/** A valid FQDN-ish hostname: label(.label)* */
const hostname = fc
  .array(hostnameLabel, { minLength: 1, maxLength: 4 })
  .map(labels => labels.join('.'));

/** Optional port :1-65535 */
const optionalPort = fc.option(
  fc.integer({ min: 1, max: 65535 }).map(p => `:${p}`),
  {
    nil: '',
  }
);

/** A valid registry string: hostname[:port] */
const validRegistryArb = fc.tuple(hostname, optionalPort).map(([h, p]) => h + p);

/** A path segment for image refs */
const pathSegment = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,11}$/);

/** Optional tag */
const optionalTag = fc.option(
  fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,9}$/).map(t => `:${t}`),
  { nil: '' }
);

/** Optional sha256 digest */
const optionalDigest = fc.option(
  fc.stringMatching(/^[a-f0-9]{64}$/).map(d => `@sha256:${d}`),
  { nil: '' }
);

/** A valid image reference: registry[:port]/path[/path][:tag][@sha256:...] */
const validImageRefArb = fc
  .tuple(
    validRegistryArb,
    fc.array(pathSegment, { minLength: 1, maxLength: 3 }),
    optionalTag,
    optionalDigest
  )
  .map(([reg, paths, tag, digest]) => `${reg}/${paths.join('/')}${tag}${digest}`);

/** A valid repo name */
const validRepoArb = fc
  .tuple(fc.stringMatching(/^[a-z0-9]$/), fc.stringMatching(/^[a-z0-9._/-]{0,50}$/))
  .map(([start, rest]) => start + rest);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isValidImageRef', () => {
  it('accepts known-good image refs', () => {
    const knownGood = [
      'docker.io/library/alpine:3.18',
      'ghcr.io/naval-group/headlamp-kubevirt:latest',
      'registry.example.com:5000/repo:tag',
      'sk4la/volatility3:2.26',
      'localhost:5000/isf/ubuntu:latest',
      `r.example.com/a@sha256:${'a'.repeat(64)}`,
    ];
    knownGood.forEach(ref => expect(isValidImageRef(ref)).toBe(true));
  });

  it('rejects known-bad image refs', () => {
    const knownBad = ['', 'noregistry', '-bad/repo', '.bad/repo', '////', 'a:99999999/b'];
    knownBad.forEach(ref => expect(isValidImageRef(ref)).toBe(false));
  });

  it('accepts all generated valid image refs', () => {
    fc.assert(
      fc.property(validImageRefArb, ref => {
        expect(isValidImageRef(ref)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it('never hangs on arbitrary strings (ReDoS safety)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), input => {
        const start = performance.now();
        isValidImageRef(input);
        expect(performance.now() - start).toBeLessThan(50);
      }),
      { numRuns: 5000 }
    );
  });

  it('never hangs on adversarial dot-heavy strings', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 200 }),
        fc.constantFrom('.', '0.', '0.0', 'a.', '.a'),
        (len, pattern) => {
          const input = pattern.repeat(len);
          const start = performance.now();
          isValidImageRef(input);
          expect(performance.now() - start).toBeLessThan(50);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('isValidRegistry', () => {
  it('accepts known-good registries', () => {
    const knownGood = [
      'localhost',
      'localhost:5000',
      'registry.example.com',
      'ghcr.io',
      'my-registry.example.com:8080',
    ];
    knownGood.forEach(reg => expect(isValidRegistry(reg)).toBe(true));
  });

  it('rejects known-bad registries', () => {
    const knownBad = ['', '-bad', '.bad', 'bad..bad', ':5000', 'a:999999'];
    knownBad.forEach(reg => expect(isValidRegistry(reg)).toBe(false));
  });

  it('accepts all generated valid registries', () => {
    fc.assert(
      fc.property(validRegistryArb, reg => {
        expect(isValidRegistry(reg)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it('never hangs on arbitrary strings (ReDoS safety)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), input => {
        const start = performance.now();
        isValidRegistry(input);
        expect(performance.now() - start).toBeLessThan(50);
      }),
      { numRuns: 5000 }
    );
  });

  it('never hangs on adversarial dot-heavy strings', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 200 }), len => {
        const input = '0.' + '0'.repeat(len);
        const start = performance.now();
        isValidRegistry(input);
        expect(performance.now() - start).toBeLessThan(50);
      }),
      { numRuns: 500 }
    );
  });
});

describe('isValidRepo', () => {
  it('accepts known-good repos', () => {
    expect(isValidRepo('isf')).toBe(true);
    expect(isValidRepo('my-org/my-repo')).toBe(true);
    expect(isValidRepo('a.b.c')).toBe(true);
  });

  it('rejects known-bad repos', () => {
    expect(isValidRepo('')).toBe(false);
    expect(isValidRepo('-starts-with-dash')).toBe(false);
    expect(isValidRepo('.starts-with-dot')).toBe(false);
    expect(isValidRepo('a'.repeat(254))).toBe(false);
  });

  it('accepts all generated valid repos', () => {
    fc.assert(
      fc.property(validRepoArb, repo => {
        if (repo.length <= 253) {
          expect(isValidRepo(repo)).toBe(true);
        }
      }),
      { numRuns: 1000 }
    );
  });

  it('enforces 253-char limit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 254, max: 500 }), len => {
        const repo = 'a' + 'b'.repeat(len - 1);
        expect(isValidRepo(repo)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

describe('validateSettings (via getPluginSettings)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns defaults for arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.json(), jsonStr => {
        localStorage.setItem('headlamp-kubevirt-settings', jsonStr);
        const result = getPluginSettings();
        expect(result).toHaveProperty('customLabelColumns');
        expect(result).toHaveProperty('forensic');
        expect(Array.isArray(result.customLabelColumns)).toBe(true);
        expect(typeof result.forensic.toolboxImage).toBe('string');
        expect(typeof result.forensic.isfRegistry).toBe('string');
        expect(typeof result.forensic.isfRepo).toBe('string');
      }),
      { numRuns: 1000 }
    );
  });

  it('never throws on corrupted localStorage', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), garbage => {
        localStorage.setItem('headlamp-kubevirt-settings', garbage);
        expect(() => getPluginSettings()).not.toThrow();
      }),
      { numRuns: 1000 }
    );
  });

  it('round-trips valid settings', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            label: fc.string({ minLength: 1, maxLength: 20 }),
            labelKey: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        columns => {
          const settings: PluginSettings = {
            customLabelColumns: columns,
            forensic: {
              toolboxImage: 'sk4la/volatility3:2.26',
              isfRegistry: 'ghcr.io',
              isfRepo: 'genesary/kernel-isf-oci',
              isfSuffix: '-busybox',
            },
            guestfs: { image: '' },
          };
          savePluginSettings(settings);
          const loaded = getPluginSettings();
          expect(loaded.customLabelColumns).toEqual(columns);
          expect(loaded.forensic).toEqual(settings.forensic);
        }
      ),
      { numRuns: 200 }
    );
  });
});
