const ISSUE_CODES = {
  UNSUPPORTED_NODE: 'unsupported-node',
  IGNORED_SURFACE_INPUT: 'ignored-surface-input',
  MISSING_REFERENCE: 'missing-reference',
  MISSING_MATERIAL: 'missing-material',
  INVALID_VALUE: 'invalid-value',
};

class MaterialXIssueCollector {
  constructor(options = {}) {
    this.unsupportedPolicy = options.unsupportedPolicy || 'warn';
    this.onWarning = options.onWarning || null;
    this.issues = [];
  }

  addIssue(issue) {
    const normalizedIssue = {
      code: issue.code || ISSUE_CODES.INVALID_VALUE,
      message: issue.message || 'Unknown MaterialX issue.',
      category: issue.category,
      nodeName: issue.nodeName,
      severity: issue.severity || 'warning',
    };

    this.issues.push(normalizedIssue);

    if (normalizedIssue.severity === 'warning') {
      if (this.unsupportedPolicy === 'warn') {
        console.warn(`THREE.MaterialXLoader: ${normalizedIssue.message}`);
      }

      if (this.onWarning) {
        this.onWarning(normalizedIssue);
      }
    }
  }

  addUnsupportedNode(category, nodeName) {
    this.addIssue({
      code: ISSUE_CODES.UNSUPPORTED_NODE,
      category,
      nodeName,
      message: `Unsupported MaterialX node category "${category}"${nodeName ? ` on "${nodeName}"` : ''}.`,
    });
  }

  addIgnoredSurfaceInput(category, nodeName, inputName) {
    this.addIssue({
      code: ISSUE_CODES.IGNORED_SURFACE_INPUT,
      category,
      nodeName,
      message: `${category} input "${inputName}" is currently ignored in MaterialX translation.`,
    });
  }

  addMissingReference(nodeName, referencePath) {
    this.addIssue({
      code: ISSUE_CODES.MISSING_REFERENCE,
      nodeName,
      message: `Missing MaterialX reference "${referencePath}"${nodeName ? ` from "${nodeName}"` : ''}.`,
    });
  }

  addInvalidValue(nodeName, message) {
    this.addIssue({
      code: ISSUE_CODES.INVALID_VALUE,
      nodeName,
      message,
    });
  }

  addMissingMaterial(materialName) {
    this.addIssue({
      code: ISSUE_CODES.MISSING_MATERIAL,
      message: materialName
        ? `Could not find surfacematerial named "${materialName}".`
        : 'Document does not include a surfacematerial node.',
    });
  }

  buildReport() {
    const ignoredSurfaceInputs = this.issues.filter((issue) => issue.code === ISSUE_CODES.IGNORED_SURFACE_INPUT);
    const missingReferences = this.issues.filter((issue) => issue.code === ISSUE_CODES.MISSING_REFERENCE);
    const invalidValues = this.issues.filter((issue) => issue.code === ISSUE_CODES.INVALID_VALUE);

    return {
      issues: this.issues,
      warnings: this.issues,
      ignoredSurfaceInputs,
      missingReferences,
      invalidValues,
    };
  }

  throwIfNeeded() {
    if (this.unsupportedPolicy !== 'error') return;
    const unsupportedNodes = this.issues.filter((issue) => issue.code === ISSUE_CODES.UNSUPPORTED_NODE);
    const missingReferences = this.issues.filter((issue) => issue.code === ISSUE_CODES.MISSING_REFERENCE);
    const invalidValues = this.issues.filter((issue) => issue.code === ISSUE_CODES.INVALID_VALUE);

    if (unsupportedNodes.length === 0 && missingReferences.length === 0 && invalidValues.length === 0) return;

    const details = [];
    if (unsupportedNodes.length > 0) {
      const categoryList = [...new Set(unsupportedNodes.map((issue) => issue.category).filter(Boolean))].sort().join(', ');
      details.push(
        `unsupported node categories${categoryList ? `: ${categoryList}` : ''} (${unsupportedNodes.length})`,
      );
    }
    if (missingReferences.length > 0) {
      details.push(`missing references (${missingReferences.length})`);
    }
    if (invalidValues.length > 0) {
      details.push(`invalid values (${invalidValues.length})`);
    }

    throw new Error(`THREE.MaterialXLoader: MaterialX translation failed in error mode; ${details.join('; ')}.`);
  }
}

export { ISSUE_CODES, MaterialXIssueCollector };
