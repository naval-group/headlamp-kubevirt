import { isValidImageRef, isValidRegistry, isValidRepo } from './pluginSettings';
import {
  assertK8sName,
  isValidColumnName,
  isValidK8sLabelKey,
  isValidK8sLabelValue,
  isValidK8sName,
  isValidMdevSelector,
  isValidPciSelector,
  isValidResourceName,
  safeError,
  sanitizeFeatureGateSearch,
  sanitizePromQL,
} from './sanitize';

// --- Helpers for property-based / fuzz testing ---

/** Generate a random string of given length from full Unicode range */
function randomString(maxLen: number): string {
  const len = Math.floor(Math.random() * maxLen);
  return Array.from({ length: len }, () =>
    String.fromCharCode(Math.floor(Math.random() * 0xffff))
  ).join('');
}

/** Generate a string biased toward adversarial characters */
function adversarialString(maxLen: number): string {
  const chars = '{}()[]<>|\\\'";`$!@#%^&*=+~\n\r\t\0\x00\x1b../../../etc/passwd';
  const len = Math.floor(Math.random() * maxLen);
  return Array.from({ length: len }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('');
}

const FUZZ_ITERATIONS = 1000;

// --- sanitizeFeatureGateSearch ---

describe('sanitizeFeatureGateSearch', () => {
  it('passes through valid gate names', () => {
    expect(sanitizeFeatureGateSearch('LiveMigration')).toBe('LiveMigration');
    expect(sanitizeFeatureGateSearch('GPU-passthrough')).toBe('GPU-passthrough');
    expect(sanitizeFeatureGateSearch('SRIOV')).toBe('SRIOV');
  });

  it('strips special characters', () => {
    expect(sanitizeFeatureGateSearch('test<script>')).toBe('testscript');
    expect(sanitizeFeatureGateSearch("'; DROP TABLE--")).toBe('DROPTABLE--');
    expect(sanitizeFeatureGateSearch('foo bar')).toBe('foobar');
    expect(sanitizeFeatureGateSearch('test\x00null')).toBe('testnull');
  });

  it('returns empty string for all-invalid input', () => {
    expect(sanitizeFeatureGateSearch('!@#$%^&*()')).toBe('');
    expect(sanitizeFeatureGateSearch('   ')).toBe('');
    expect(sanitizeFeatureGateSearch('\n\t\r')).toBe('');
  });

  it('fuzz: output only contains [a-zA-Z0-9-]', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(100);
      const output = sanitizeFeatureGateSearch(input);
      expect(output).toMatch(/^[a-zA-Z0-9-]*$/);
    }
  });

  it('fuzz: adversarial input only contains [a-zA-Z0-9-]', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = adversarialString(200);
      const output = sanitizeFeatureGateSearch(input);
      expect(output).toMatch(/^[a-zA-Z0-9-]*$/);
    }
  });
});

// --- sanitizePromQL ---

describe('sanitizePromQL', () => {
  it('passes through valid label values', () => {
    expect(sanitizePromQL('my-namespace')).toBe('my-namespace');
    expect(sanitizePromQL('pod_name:v1.2.3')).toBe('pod_name:v1.2.3');
  });

  it('strips injection characters', () => {
    expect(sanitizePromQL('ns"} or up{')).toBe('nsorup');
    expect(sanitizePromQL('value\nmetric')).toBe('valuemetric');
  });

  it('fuzz: output only contains [a-zA-Z0-9._\\-:]', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(100);
      const output = sanitizePromQL(input);
      expect(output).toMatch(/^[a-zA-Z0-9._\-:]*$/);
    }
  });
});

// --- assertK8sName / isValidK8sName ---

describe('isValidK8sName', () => {
  it('accepts valid names', () => {
    expect(isValidK8sName('my-vm')).toBe(true);
    expect(isValidK8sName('test.pod-1')).toBe(true);
    expect(isValidK8sName('0abc')).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(isValidK8sName('')).toBe(false);
    expect(isValidK8sName('-start')).toBe(false);
    expect(isValidK8sName('.dot')).toBe(false);
    expect(isValidK8sName('UPPER')).toBe(false);
    expect(isValidK8sName('a'.repeat(254))).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(300);
      expect(() => isValidK8sName(input)).not.toThrow();
    }
  });
});

describe('assertK8sName', () => {
  it('returns valid names', () => {
    expect(assertK8sName('my-vm')).toBe('my-vm');
  });

  it('throws on invalid names', () => {
    expect(() => assertK8sName('<script>')).toThrow();
    expect(() => assertK8sName('')).toThrow();
  });

  it('fuzz: never throws unexpected errors', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(300);
      try {
        const result = assertK8sName(input);
        expect(typeof result).toBe('string');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain('Invalid Kubernetes');
      }
    }
  });
});

// --- isValidK8sLabelValue ---

describe('isValidK8sLabelValue', () => {
  it('accepts valid label values', () => {
    expect(isValidK8sLabelValue('')).toBe(true);
    expect(isValidK8sLabelValue('prometheus')).toBe(true);
    expect(isValidK8sLabelValue('my-release.v1')).toBe(true);
    expect(isValidK8sLabelValue('A')).toBe(true);
    expect(isValidK8sLabelValue('a1')).toBe(true);
  });

  it('rejects invalid label values', () => {
    expect(isValidK8sLabelValue('-start')).toBe(false);
    expect(isValidK8sLabelValue('end-')).toBe(false);
    expect(isValidK8sLabelValue('.dot')).toBe(false);
    expect(isValidK8sLabelValue('a'.repeat(64))).toBe(false);
    expect(isValidK8sLabelValue('has space')).toBe(false);
    expect(isValidK8sLabelValue('<script>')).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(100);
      expect(() => isValidK8sLabelValue(input)).not.toThrow();
    }
  });

  it('fuzz: ReDoS resilience', () => {
    const payloads = ['a'.repeat(63) + '!', 'a-'.repeat(31) + 'a!', '.'.repeat(63) + '!'];
    for (const payload of payloads) {
      const start = performance.now();
      isValidK8sLabelValue(payload);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});

// --- isValidPciSelector ---

describe('isValidPciSelector', () => {
  it('accepts valid PCI selectors', () => {
    expect(isValidPciSelector('10DE:1DB6')).toBe(true);
    expect(isValidPciSelector('8086:1521')).toBe(true);
    expect(isValidPciSelector('abcd:ef01')).toBe(true);
  });

  it('rejects invalid PCI selectors', () => {
    expect(isValidPciSelector('')).toBe(false);
    expect(isValidPciSelector('10DE')).toBe(false);
    expect(isValidPciSelector('10DE:1DB6:extra')).toBe(false);
    expect(isValidPciSelector('ZZZZ:0000')).toBe(false);
    expect(isValidPciSelector('<script>')).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(50);
      expect(() => isValidPciSelector(input)).not.toThrow();
    }
  });
});

// --- isValidResourceName ---

describe('isValidResourceName', () => {
  it('accepts valid resource names', () => {
    expect(isValidResourceName('nvidia.com/GP102GL')).toBe(true);
    expect(isValidResourceName('intel.com/sriov')).toBe(true);
    expect(isValidResourceName('mydevice')).toBe(true);
  });

  it('rejects invalid resource names', () => {
    expect(isValidResourceName('')).toBe(false);
    expect(isValidResourceName('-start/name')).toBe(false);
    expect(isValidResourceName('<script>')).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(100);
      expect(() => isValidResourceName(input)).not.toThrow();
    }
  });

  it('fuzz: ReDoS resilience', () => {
    const payloads = ['a.'.repeat(125) + '!', 'a'.repeat(253) + '/a!'];
    for (const payload of payloads) {
      const start = performance.now();
      isValidResourceName(payload);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});

// --- isValidK8sLabelKey ---

describe('isValidK8sLabelKey', () => {
  it('accepts valid label keys', () => {
    expect(isValidK8sLabelKey('app')).toBe(true);
    expect(isValidK8sLabelKey('app.kubernetes.io/name')).toBe(true);
    expect(isValidK8sLabelKey('version')).toBe(true);
  });

  it('rejects invalid label keys', () => {
    expect(isValidK8sLabelKey('')).toBe(false);
    expect(isValidK8sLabelKey('123')).toBe(false);
    expect(isValidK8sLabelKey('<script>')).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(100);
      expect(() => isValidK8sLabelKey(input)).not.toThrow();
    }
  });

  it('fuzz: ReDoS resilience', () => {
    const payloads = ['a.'.repeat(125) + '!', 'a'.repeat(63) + '!'];
    for (const payload of payloads) {
      const start = performance.now();
      isValidK8sLabelKey(payload);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});

// --- isValidColumnName ---

describe('isValidColumnName', () => {
  it('accepts valid column names', () => {
    expect(isValidColumnName('App')).toBe(true);
    expect(isValidColumnName('My Column')).toBe(true);
    expect(isValidColumnName('pod-name')).toBe(true);
    expect(isValidColumnName('col_1')).toBe(true);
  });

  it('rejects invalid column names', () => {
    expect(isValidColumnName('')).toBe(false);
    expect(isValidColumnName('a'.repeat(65))).toBe(false);
    expect(isValidColumnName('<script>alert(1)</script>')).toBe(false);
    expect(isValidColumnName('col;DROP')).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(100);
      expect(() => isValidColumnName(input)).not.toThrow();
    }
  });
});

// --- isValidMdevSelector ---

describe('isValidMdevSelector', () => {
  it('accepts valid mdev selectors', () => {
    expect(isValidMdevSelector('GRID T4-2A')).toBe(true);
    expect(isValidMdevSelector('nvidia-468')).toBe(true);
    expect(isValidMdevSelector('simple')).toBe(true);
  });

  it('rejects invalid mdev selectors', () => {
    expect(isValidMdevSelector('')).toBe(false);
    expect(isValidMdevSelector('a'.repeat(129))).toBe(false);
    expect(isValidMdevSelector('<script>')).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(200);
      expect(() => isValidMdevSelector(input)).not.toThrow();
    }
  });
});

// --- safeError ---

describe('safeError', () => {
  it('extracts friendly messages from errors', () => {
    expect(safeError(new Error('403 Forbidden'), 'test')).toBe('Permission denied');
    expect(safeError(new Error('404 Not Found'), 'test')).toBe('Resource not found');
    expect(safeError(new Error('500 Internal'), 'test')).toBe('Server error');
  });

  it('caps long messages at 120 chars', () => {
    const long = 'x'.repeat(200);
    const result = safeError(new Error(long), 'test');
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it('handles string values directly', () => {
    expect(safeError('string error', 'test')).toBe('string error');
    expect(safeError('403 Forbidden', 'test')).toBe('Permission denied');
    expect(safeError('404 Not Found', 'test')).toBe('Resource not found');
  });

  it('handles non-string, non-Error values', () => {
    expect(safeError(null, 'test')).toBe('An unexpected error occurred');
    expect(safeError(undefined, 'test')).toBe('An unexpected error occurred');
    expect(safeError(42, 'test')).toBe('An unexpected error occurred');
  });

  it('fuzz: never throws on random input', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = Math.random() > 0.5 ? new Error(randomString(200)) : randomString(100);
      expect(() => safeError(input, 'fuzz')).not.toThrow();
    }
  });
});

// --- pluginSettings validators ---

describe('isValidImageRef', () => {
  it('accepts valid refs', () => {
    expect(isValidImageRef('docker.io/library/nginx:latest')).toBe(true);
    expect(isValidImageRef('registry.example.com:5000/repo/image:v1')).toBe(true);
    expect(isValidImageRef('localhost:5000/isf:latest')).toBe(true);
  });

  it('rejects invalid refs', () => {
    expect(isValidImageRef('')).toBe(false);
    expect(isValidImageRef('just-a-name')).toBe(false);
    expect(isValidImageRef('<script>alert(1)</script>')).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(200);
      expect(() => isValidImageRef(input)).not.toThrow();
    }
  });

  it('fuzz: ReDoS resilience (completes in <100ms per call)', () => {
    // Known ReDoS payloads for nested quantifiers over dot-separated patterns
    const payloads = [
      'a'.repeat(50) + '!',
      '.'.repeat(50) + '!',
      'a.'.repeat(25) + '!',
      'a-'.repeat(50) + '!',
      'aaaaaaaaaaaaaaa.aaaaaaaaaaaaaaa.aaaaaaaaaaaaaaa.aaaaaaaaaaaaaaa!',
    ];
    for (const payload of payloads) {
      const start = performance.now();
      isValidImageRef(payload);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});

describe('isValidRegistry', () => {
  it('accepts valid registries', () => {
    expect(isValidRegistry('localhost:5000')).toBe(true);
    expect(isValidRegistry('registry.example.com')).toBe(true);
  });

  it('rejects invalid registries', () => {
    expect(isValidRegistry('')).toBe(false);
    expect(isValidRegistry('/etc/passwd')).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(200);
      expect(() => isValidRegistry(input)).not.toThrow();
    }
  });

  it('fuzz: ReDoS resilience', () => {
    const payloads = ['a'.repeat(50) + '!', '.'.repeat(50) + '!', 'a.'.repeat(25) + '!'];
    for (const payload of payloads) {
      const start = performance.now();
      isValidRegistry(payload);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});

describe('isValidRepo', () => {
  it('accepts valid repos', () => {
    expect(isValidRepo('isf')).toBe(true);
    expect(isValidRepo('my-org/my-repo')).toBe(true);
  });

  it('rejects invalid repos', () => {
    expect(isValidRepo('')).toBe(false);
    expect(isValidRepo('-start')).toBe(false);
    expect(isValidRepo('a'.repeat(254))).toBe(false);
  });

  it('fuzz: never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(300);
      expect(() => isValidRepo(input)).not.toThrow();
    }
  });
});
