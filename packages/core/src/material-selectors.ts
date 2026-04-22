import path from 'node:path';

function parseMaterialSelectorAsRegex(selector: string): RegExp | undefined {
  const trimmedSelector = selector.trim();
  if (trimmedSelector.length === 0) {
    return undefined;
  }

  if (trimmedSelector.startsWith('re:')) {
    return new RegExp(trimmedSelector.slice(3), 'i');
  }

  const regexLiteralMatch = /^\/(.+)\/([dgimsuvy]*)$/.exec(trimmedSelector);
  if (regexLiteralMatch) {
    const expression = regexLiteralMatch[1];
    const flags = regexLiteralMatch[2] ?? '';
    if (!expression) {
      return undefined;
    }
    return new RegExp(expression, flags);
  }

  return undefined;
}

export function materialMatchesSelector(materialPath: string, selector: string): boolean {
  const regex = parseMaterialSelectorAsRegex(selector);
  const materialDirectory = path.dirname(materialPath);
  const materialDirectoryLeafName = path.basename(materialDirectory);
  const matchTargets = [materialDirectoryLeafName];

  if (regex) {
    return matchTargets.some((target) => {
      regex.lastIndex = 0;
      return regex.test(target);
    });
  }

  const normalizedSelector = selector.trim().toLowerCase();
  if (normalizedSelector.length === 0) {
    return false;
  }
  return matchTargets.some((target) => target.toLowerCase().includes(normalizedSelector));
}
