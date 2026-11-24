import { afterEach, describe, expect, it } from 'vitest';
import {
  clearClusterConfigCache,
  DEFAULT_KUBEVIRT_NAMESPACE,
  initialClusterConfigState,
} from './clusterConfig';

describe('initialClusterConfigState', () => {
  afterEach(() => clearClusterConfigCache());

  it('starts empty and not loaded for a cluster that was not read yet', () => {
    expect(initialClusterConfigState('site-b')).toEqual({
      data: {},
      namespace: DEFAULT_KUBEVIRT_NAMESPACE,
      loaded: false,
      error: null,
    });
    expect(initialClusterConfigState(null).loaded).toBe(false);
  });
});
