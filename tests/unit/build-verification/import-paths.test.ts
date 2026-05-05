/**
 * Verifies that the post-build fix-imports.js script has correctly resolved
 * all path aliases and produced valid forward-slash import paths in dist/.
 *
 * Requires a prior `npm run build` — skips gracefully if dist/ is absent.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist');

/** Recursively collect all .js files under a directory */
function collectJsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

const SKIP = !existsSync(distDir);

const itif = (cond: boolean) => (cond ? it.skip : it);

describe('dist/ import paths (fix-imports.js output)', () => {
  let jsFiles: string[];

  beforeAll(() => {
    if (SKIP) return;
    jsFiles = collectJsFiles(distDir);
  });

  itif(SKIP)('dist/ must exist and contain compiled output', () => {
    expect(jsFiles.length).toBeGreaterThan(0);
  });

  itif(SKIP)('no Windows backslash separators in import/export statements', () => {
    const violations: string[] = [];

    for (const file of jsFiles) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (
          /from\s+['"].*\\.*['"]/.test(line) ||
          /import\s*\(\s*['"].*\\.*['"]/.test(line) ||
          /export\s+.*\s+from\s+['"].*\\.*['"]/.test(line)
        ) {
          const rel = file.replace(distDir, '').replace(/^[/\\]/, '');
          violations.push(`${rel}:${idx + 1} — ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  itif(SKIP)('no unresolved @-prefixed path aliases remain in dist/', () => {
    const aliasPattern = /from\s+['"]@(api|auth|core|tools|utils|middleware|types)\//;
    const unresolvedFiles: string[] = [];

    for (const file of jsFiles) {
      const content = readFileSync(file, 'utf8');
      if (aliasPattern.test(content)) {
        unresolvedFiles.push(file.replace(distDir, '').replace(/^[/\\]/, ''));
      }
    }

    expect(unresolvedFiles).toEqual([]);
  });

  itif(SKIP)('all import paths that start with ./ or ../ use forward slashes only', () => {
    const violations: string[] = [];

    for (const file of jsFiles) {
      const content = readFileSync(file, 'utf8');
      const importMatches = content.matchAll(/from\s+['"](\.[^'"]+)['"]/g);
      for (const match of importMatches) {
        if (match[1].includes('\\')) {
          const rel = file.replace(distDir, '').replace(/^[/\\]/, '');
          violations.push(`${rel}: import path "${match[1]}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
