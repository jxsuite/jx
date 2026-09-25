/// <reference lib="dom" />
/**
 * Overview — the project's identity: name, description, production URL, favicon, global styles.
 *
 * It has lost a field twice for the same reason. Breakpoints were one of **four** places `$media`
 * could be defined (plan §4.2) and this was the only one that named them; they live in Contexts
 * now, beside the colour schemes and feature queries they share a map with. The platform adapter
 * has moved to Deploy in P6.2, because §2 principle 5 says a definition site is a LEVEL, not a
 * field on some other level's form — and "what this site is" and "where it ships" are two levels.
 *
 * **The markup left too.** The section is the `settings-overview` surface
 * (`surfaces/settings-overview.json`), mounted by `surfaces/settings-overview.ts`; what is here is
 * the section itself — what a value means, what is refused, what reaches `project.json`, and what a
 * failed write says. `renderGeneralSettings` is unchanged as a contract: the registry hands a
 * container to a `render`, and this one mounts a document into it instead of rendering lit.
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { projectState } from "../store";
import { updateSiteConfig } from "../site-context";
import { activeRegistry } from "../commands/active-registry";
import { getPlatform } from "../platform";
import { mountOverviewSurface } from "../surfaces/settings-overview";

import type {
  OverviewActions,
  OverviewError,
  OverviewErrorField,
  OverviewSurfaceHandle,
  OverviewValues,
} from "../surfaces/settings-overview";
import type { JxHeadEntry, ProjectConfig } from "@jxsuite/schema/types";

/**
 * The last failed write, per rendered section.
 *
 * A `project.json` write can fail — the disk is full, the file is read-only, the desktop RPC is
 * gone — and every other settings editor in the tree drops that rejection on the floor with a bare
 * `void updateSiteConfig(...)`, so the field silently snaps back to its old value. Every write in
 * this section goes through {@link persist} instead, which parks the failure here and re-renders so
 * the user sees it. Keyed by container so two mounted copies (and two tests) never share a
 * message.
 */
const errors = new WeakMap<HTMLElement, OverviewError>();

/** The surface mounted in each container, so a redraw updates one rather than making another. */
const mounted = new WeakMap<HTMLElement, OverviewSurfaceHandle>();

/** The live project configuration, read at the moment it is needed rather than at render time. */
function config(): ProjectConfig {
  return (projectState?.projectConfig || {}) as ProjectConfig;
}

// ─── Site description ($head meta) ───────────────────────────────────────────

/** True for the `<meta name="description">` entry the site description lives in. */
function isDescriptionMeta(entry: JxHeadEntry): boolean {
  return entry.tagName === "meta" && entry.attributes?.name === "description";
}

/**
 * The site description. It is not a top-level `project.json` key — the composed project schema is
 * closed (`unevaluatedProperties: false`) — so it lives where `@jxsuite/create` writes it and where
 * the browser reads it: the `<meta name="description">` entry of `$head`.
 */
function readDescription(cfg: ProjectConfig): string {
  const entry = (cfg.$head ?? []).find((e) => isDescriptionMeta(e));
  return typeof entry?.attributes?.content === "string" ? entry.attributes.content : "";
}

/** `$head` with the description meta upserted (or dropped, when cleared). */
function headWithDescription(head: JxHeadEntry[], text: string): JxHeadEntry[] {
  const trimmed = text.trim();
  if (!head.some((e) => isDescriptionMeta(e))) {
    return trimmed
      ? [...head, { attributes: { content: trimmed, name: "description" }, tagName: "meta" }]
      : [...head];
  }
  if (!trimmed) {
    return head.filter((entry) => !isDescriptionMeta(entry));
  }
  return head.map((entry) =>
    isDescriptionMeta(entry)
      ? { ...entry, attributes: { ...entry.attributes, content: trimmed } }
      : entry,
  );
}

/**
 * The patch that _removes_ `url`. `undefined` survives the object spread inside `updateSiteConfig`
 * and `JSON.stringify` then drops the key, so clearing the field clears the setting instead of
 * persisting an empty string the build would have to special-case (`site-build.ts` gates the
 * sitemap on `Boolean(url)` but still forwards `""` into the render context). The cast is the price
 * of `exactOptionalPropertyTypes` — `ProjectConfig["url"]` is `string`, never `string |
 * undefined`.
 */
const CLEAR_URL = { url: undefined } as unknown as Partial<ProjectConfig>;

// ─── Projection ──────────────────────────────────────────────────────────────

/**
 * What the surface should be showing, from the configuration and the registry as they stand now.
 *
 * The Project Styles button is rendered FROM the `styles.open` record, so it is disabled rather
 * than absent when it cannot act (§12.3) and it cannot drift from the palette row or the gear menu.
 * The record's TITLE, and nothing else off the registry: `disabledReason` would be the §12.3 shape
 * for a control that can be inapplicable, but this one cannot be — `styles.open` is gated on
 * `ctx.project.open` and Overview is a section of the project's own configuration document, so by
 * the time this renders the answer is always yes. Asking anyway would also be a FOCUS read inside a
 * function that was handed a container, which is what `scripts/check-pane-singletons.ts` rule 4
 * forbids: a pane-scoped surface must not report the focused pane's state. A project-level verb
 * happens to read the same in every pane, but the way to be right about that is not to ask. The one
 * thing that can genuinely be missing is the registry itself (bootstrap order, a test), and that is
 * an existence check, not a state read.
 */
function values(container: HTMLElement): OverviewValues {
  const cfg = config();
  const command = activeRegistry()?.get("styles.open");
  return {
    description: readDescription(cfg),
    error: errors.get(container) ?? null,
    favicon: typeof cfg.favicon === "string" ? cfg.favicon : "",
    name: cfg.name ?? "",
    stylesDisabled: command === undefined,
    stylesTitle: command?.title ?? "",
    url: cfg.url ?? "",
  };
}

/** The decisions, bound to one container's surface. Made once, when that surface is mounted. */
function actions(container: HTMLElement): OverviewActions {
  /**
   * What the control now holds, told to the scope before anything is decided about it.
   *
   * Without this a refusal leaves the refused text in the field: the binding writes the value the
   * scope names, and the scope never said anything but the value on disk — so re-stating it is not
   * a change and nothing is written back. Echoing first makes the snap-back a real move, which is
   * the job `live()` did in the template this replaced.
   */
  const echo = (patch: Partial<OverviewValues>): void => {
    mounted.get(container)?.update(patch);
  };

  /** Persist a patch, surfacing the rejection instead of swallowing it. */
  const persist = async (
    patch: Partial<ProjectConfig>,
    field: OverviewErrorField = "section",
  ): Promise<void> => {
    try {
      await updateSiteConfig(patch);
      errors.delete(container);
    } catch (error) {
      errors.set(container, {
        field,
        message: `Could not save project.json — ${errorMessage(error)}`,
      });
    }
    renderGeneralSettings(container);
  };

  /** Park a validation failure under `field` without writing anything. */
  const reject = (field: OverviewErrorField, message: string): void => {
    errors.set(container, { field, message });
    renderGeneralSettings(container);
  };

  const uploadFavicon = (): void => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.ico,.svg";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      try {
        await getPlatform().uploadFile("public/favicon.ico", file);
      } catch (error) {
        reject("favicon", `Could not upload the favicon — ${errorMessage(error)}`);
        return;
      }
      await persist({ favicon: "/favicon.ico" }, "favicon");
    });
    input.click();
  };

  return {
    /*
     * Project Styles is the SAME document in a different editor, and `styles.open` is the one place
     * that says so. This used to write `session.ui.canvasMode` here directly — a second
     * implementation of a capability, §12.5's defect in miniature: the button and the command could
     * disagree about what "open Project Styles" means, and only one of them was reachable by name.
     * The mode is still a fact about the TAB, and there is exactly one `project.json` tab, so
     * `revealTab`'s `focusPane` puts the keyboard on whichever pane holds it.
     */
    openStyles: () => {
      void activeRegistry()?.run("styles.open");
    },
    setDescription: (value: string) => {
      echo({ description: value });
      void persist({ $head: headWithDescription(config().$head ?? [], value) }, "description");
    },
    setName: (value: string) => {
      echo({ name: value });
      const name = value.trim();
      if (!name) {
        reject("name", "A project name is required.");
        return;
      }
      void persist({ name }, "name");
    },
    setUrl: (value: string) => {
      echo({ url: value });
      const url = value.trim();
      if (url && !/^https?:\/\/\S+$/.test(url)) {
        reject("url", "Enter a full address starting with http:// or https://");
        return;
      }
      void persist(url ? { url } : CLEAR_URL, "url");
    },
    uploadFavicon,
  };
}

// ─── Render ──────────────────────────────────────────────────────────────────

/**
 * Draw the section into `container`, or bring the surface already there up to date.
 *
 * The pane calls this again whenever something it cannot see may have changed, and a remount would
 * take the caret out of whatever field the reader is in — so a standing surface is updated and only
 * a container the document has left is mounted into again.
 *
 * @param {HTMLElement} container
 */
export function renderGeneralSettings(container: HTMLElement): void {
  const standing = mounted.get(container);
  if (standing?.connected()) {
    standing.update(values(container));
    return;
  }
  standing?.dispose();
  mounted.set(container, mountOverviewSurface(container, values(container), actions(container)));
}
