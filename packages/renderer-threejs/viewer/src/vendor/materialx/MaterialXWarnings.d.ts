export const ISSUE_CODES: Record<string, string>;
export const ISSUE_POLICIES: Record<string, string>;
export function normalizeIssuePolicy(policy: string): string;

export class MaterialXIssueCollector {
  constructor(options?: { issuePolicy?: string; unsupportedPolicy?: string; onWarning?: ((issue: unknown) => void) | null });
  issues: unknown[];
  addIssue(issue: unknown): void;
  addUnsupportedNode(category: string, nodeName?: string): void;
  addIgnoredSurfaceInput(category: string, nodeName: string, inputName: string): void;
  addMissingReference(nodeName: string, referencePath: string): void;
  addInvalidValue(nodeName: string, message: string): void;
  addMissingMaterial(materialName?: string): void;
  buildReport(): unknown;
  throwIfNeeded(): void;
}
