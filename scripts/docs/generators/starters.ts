// Generates docs/studio/projects/starters.md from packages/starters/registry.json —
// The same registry Studio's New Project template gallery reads.

import { listStarters } from "@jxsuite/starters";

import { BANNER, frontmatter } from "./shared.ts";

/** Render the starter-templates reference page. */
export function generateStarters(): string {
  const registry = listStarters();

  const lines: string[] = [
    frontmatter({
      description:
        "The starter templates that ship with Jx Studio — what each includes and who it's for.",
      title: "Starter templates",
    }),
    BANNER,
    "",
    "# Starter templates",
    "",
    `Jx Studio ships ${registry.length} starter templates. Pick one in the **New Project** dialog — Studio copies it into your project folder as a complete, editable site with real content, components, and styles. Nothing about a starter is special afterward: it is plain Jx files you own.`,
    "",
  ];

  for (const starter of registry) {
    lines.push(
      `## ${starter.name}`,
      "",
      `**${starter.industry}** — ${starter.tagline}`,
      "",
      starter.description,
      "",
      ...starter.features.map((f) => `- ${f}`),
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
