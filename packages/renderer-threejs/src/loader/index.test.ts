import { describe, expect, it } from 'vitest';
import { ISSUE_CODES, ISSUE_POLICIES, MaterialXLoader, normalizeIssuePolicy } from './index.js';

describe('renderer-threejs loader entrypoint', () => {
  it('exports MaterialXLoader and issue policy helpers', () => {
    expect(typeof MaterialXLoader).toBe('function');
    expect(ISSUE_CODES.UNSUPPORTED_NODE).toBe('unsupported-node');
    expect(ISSUE_POLICIES.ERROR_CORE).toBe('error-core');
    expect(normalizeIssuePolicy('error')).toBe(ISSUE_POLICIES.ERROR_CORE);
  });
});
