/**
 * The project being opened right now, if any — the one record the Start pane reads to stop looking
 * idle while a project loads.
 *
 * Opening is a sequence (sync, install dependencies, read, open the home page) that can take tens
 * of seconds. The Start pane stays on screen throughout, so without this it looked frozen, and its
 * links stayed live: a second click started a second open over the first. The pane now swaps its
 * actions for this record's progress, and every entry point that would begin another open asks
 * {@link isOpeningProject} first.
 *
 * @docs studio/interface/welcome-screen
 */

import { reactive } from "./reactivity";

export interface OpeningStep {
  label: string;
  state: "pending" | "running" | "done";
}

export interface ProjectOpening {
  /** What is being opened: the project's folder name, or the repository for a cloud project. */
  name: string;
  /** The line under the heading: the step running now. */
  status: string;
  steps: OpeningStep[];
}

/** The reactive scope: `current` is null while nothing is opening. */
export const projectOpening: { current: ProjectOpening | null } = reactive({ current: null });

/** Whether a project open is in flight in this window. */
export function isOpeningProject(): boolean {
  return projectOpening.current !== null;
}

/** The handle one open drives its progress through. */
export interface OpeningHandle {
  /** Mark `label` running and every step before it done. */
  step: (label: string) => void;
  /** Clear the record, success or not. Safe to call twice. */
  end: () => void;
}

/**
 * Record that a project is opening.
 *
 * @param name What the pane calls the project.
 * @param steps The plan, shown as a checklist.
 * @returns The handle, or `null` when another open is already in flight (the caller must stop).
 */
export function beginProjectOpening(
  name: string,
  steps: readonly string[] = [],
): OpeningHandle | null {
  if (projectOpening.current) {
    return null;
  }
  const record: ProjectOpening = {
    name,
    status: "Starting…",
    steps: steps.map((label) => ({ label, state: "pending" as const })),
  };
  projectOpening.current = record;
  // The proxy, not the literal: writes through the raw object skip every effect reading it.
  // SAFETY: `projectOpening.current` was assigned `record` on the line above, so it is non-null.
  const live = projectOpening.current as ProjectOpening;
  return {
    end() {
      if (projectOpening.current === live) {
        projectOpening.current = null;
      }
    },
    step(label: string) {
      if (projectOpening.current !== live) {
        return;
      }
      let at = live.steps.findIndex((s) => s.label === label);
      if (at === -1) {
        live.steps.push({ label, state: "pending" });
        at = live.steps.length - 1;
      }
      for (const [index, s] of live.steps.entries()) {
        s.state = index < at ? "done" : index === at ? "running" : s.state;
      }
      live.status = label;
    },
  };
}
