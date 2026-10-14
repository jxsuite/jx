/**
 * Token-lint.js — flags hard-coded values in a Jx document that match a project design token.
 *
 * Soft hints: findings are surfaced in tool-result summaries so the model can self-correct. Does
 * NOT fail mutations — see docs/ai-assistant-premium-components-plan.md §5 Phase 4.
 */

import type { JxMutableNode } from "@jxsuite/schema/types";
import { displayTagName, isNonNullObject, isString } from "@jxsuite/schema/guards";

interface TokenLintFinding {
  path: string;
  property: string;
  value: string;
  suggestedToken: string;
}

/**
 * Build a reverse lookup from token values to token names. Normalizes hex colors to lowercase for
 * case-insensitive matching.
 *
 * @param {Record<string, string>} projectStyle
 * @returns {Map<string, string>}
 */
function buildTokenIndex(projectStyle: Record<string, string>) {
  const index = new Map<string, string>();
  for (const [key, value] of Object.entries(projectStyle)) {
    // The style object comes from `project.json`, where a key can also hold a nested block.
    if (!key.startsWith("--") || !isString(value)) {
      continue;
    }
    const norm = value.toLowerCase().trim();
    if (!index.has(norm)) {
      index.set(norm, key);
    }
  }
  return index;
}

/**
 * Check whether a CSS value is already a token reference.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isTokenRef(value: string) {
  return value.includes("var(--");
}

/**
 * Check whether a CSS value is a template expression (dynamic).
 *
 * @param {string} value
 * @returns {boolean}
 */
function isTemplate(value: string) {
  return value.includes("${");
}

/**
 * Scan a Jx document for hard-coded style values that match a project design token.
 *
 * @param {object} doc - The Jx document (or subtree)
 * @param {Record<string, string>} projectStyle - The project.json style object
 * @returns {TokenLintFinding[]}
 */
export function flagHardcodedTokens(
  doc: JxMutableNode | null | undefined,
  projectStyle: Record<string, string> | null | undefined,
): TokenLintFinding[] {
  if (!doc || !projectStyle) {
    return [];
  }

  const tokenIndex = buildTokenIndex(projectStyle);
  if (tokenIndex.size === 0) {
    return [];
  }

  const findings: TokenLintFinding[] = [];

  /* Every member is re-checked rather than trusted: callers hand over model output parsed from
     JSON, so a "node" may be a primitive, a `style` may be a string, and a child may be anything. */
  function walk(el: JxMutableNode, pathPrefix: string) {
    if (!isNonNullObject(el)) {
      return;
    }

    if (isNonNullObject(el.style)) {
      for (const [prop, val] of Object.entries(el.style)) {
        if (prop.startsWith("@")) {
          continue;
        }
        if (!isString(val)) {
          continue;
        }
        if (isTokenRef(val) || isTemplate(val)) {
          continue;
        }

        const norm = val.toLowerCase().trim();
        const token = tokenIndex.get(norm);
        if (token) {
          findings.push({
            path: pathPrefix,
            property: prop,
            value: val,
            suggestedToken: token,
          });
        }
      }
    }

    if (Array.isArray(el.children)) {
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (isNonNullObject(child)) {
          walk(child, `${pathPrefix} > ${displayTagName(child.tagName) || `[${i}]`}`);
        }
      }
    }
  }

  const tag = doc.tagName || "root";
  walk(doc, displayTagName(tag));
  return findings;
}

/**
 * Format findings as a human/model-readable hint string.
 *
 * @param {TokenLintFinding[]} findings
 * @returns {string}
 */
export function formatTokenHints(findings: TokenLintFinding[]) {
  if (findings.length === 0) {
    return "";
  }
  const lines = findings.map(
    (f) => `- ${f.path} → ${f.property}: "${f.value}" — use var(${f.suggestedToken}) instead`,
  );
  return `Token hints (prefer design tokens over hard-coded values):\n${lines.join("\n")}`;
}
