/// <reference lib="dom" />
/**
 * Extension settings sections — bridges the extensions payload (platform `listExtensions`) into the
 * Project Settings section registry. Every project-section contribution whose class declares a
 * `$studio.settings` block (specs/extensions.md §9.1) gets a section rendered generically by
 * renderContributedSection; sections vanish again when their extension is disabled. The studio
 * hard-codes nothing per extension — parser's Content Types section arrives through this exact
 * path.
 */

import { isNonNullObject } from "@jxsuite/schema/guards";
import { getFormats, loadExtensions, loadFormats } from "../format/format-host";
import { registerSettingsSection, unregisterSettingsSection } from "./section-registry";
import { renderContributedSection } from "./contributed-section";
import { dataSectionActions } from "../panels/data-grid";
import type { ExtensionContributionInfo } from "../types";
import type { JsonSchema } from "../ui/schema-form";
import type { ContributedSectionOptions, SettingsContribution } from "./contributed-section";

/** The `$studio.settings` block shape consumed here (nav metadata + the renderer inputs). */
interface StudioSettingsBlock {
  icon?: string;
  label?: string;
  order?: number;
  layout?: "map" | "form";
  entry?: SettingsContribution["settings"]["entry"];
}

/** A contribution resolved into section-registry registration inputs. */
export interface DerivedSettingsSection {
  key: string;
  label: string;
  icon?: string | undefined;
  order: number;
  contribution: SettingsContribution;
}

/** Default sort position for contributed sections without an explicit `order`. */
const DEFAULT_SECTION_ORDER = 100;

/**
 * Derive the section registration for one contribution, or null when its class declares no
 * `$studio.settings` block. The wire `entrySchema` is the SECTION value schema (`properties[<key>]`
 * of the project fragment); map layouts edit one entry at a time, so their form schema is that
 * section schema's `additionalProperties`.
 *
 * @param {ExtensionContributionInfo} info
 * @returns {DerivedSettingsSection | null}
 */
export function deriveSettingsSection(
  info: ExtensionContributionInfo,
): DerivedSettingsSection | null {
  /* SAFETY: `$studio.settings` is the extensions.md §9.1 vocabulary, served verbatim from the
     class descriptor; every member read below is optional and falls back through `??`, so an
     omitted member degrades to the section defaults rather than reaching the renderer. */
  const settings = info.studio?.settings as StudioSettingsBlock | null | undefined;
  if (!settings) {
    return null;
  }
  const { key } = info.project;
  const layout = settings.layout ?? "form";
  /* SAFETY: the backend fills `entrySchema` with `properties[<key>]` of the extension's shipped
     project fragment (compiler `site/format-host.ts`), which is a JSON Schema by construction. */
  const sectionSchema = (info.entrySchema ?? {}) as JsonSchema & {
    additionalProperties?: JsonSchema | boolean;
  };
  const entrySchema =
    layout === "map"
      ? isNonNullObject(sectionSchema.additionalProperties)
        ? sectionSchema.additionalProperties
        : {}
      : sectionSchema;
  const label = settings.label ?? info.project.title ?? key;
  const sectionSettings: SettingsContribution["settings"] = {};
  if (settings.entry !== undefined) {
    sectionSettings.entry = settings.entry;
  }
  if (settings.layout !== undefined) {
    sectionSettings.layout = settings.layout;
  }
  return {
    contribution: {
      entrySchema,
      key,
      settings: sectionSettings,
      title: label,
    },
    icon: settings.icon,
    key,
    label,
    order: settings.order ?? DEFAULT_SECTION_ORDER,
  };
}

/** Section keys this module registered, so stale ones unregister on project/extension change. */
const registeredKeys = new Set<string>();

/**
 * The sync currently running, so concurrent callers join it instead of racing it.
 *
 * This is half of the deep-link fix (`settings.open { section, entry }`, §17.1).
 * `refreshExtensionUi` (`format/format-host.ts`) fires this function **fire-and-forget** on project
 * activation and after every `project.json` write, and the settings surface used to start a SECOND,
 * interleaved run and await only its own. The two runs share {@link registeredKeys} and both reach
 * {@link unregisterSettingsSection}, so a key one run had just registered could be seen as stale by
 * the other and unregistered — after the awaited promise had already resolved. Coalescing makes
 * "the sections are ready" one fact about the registry rather than one fact per caller.
 */
let _inFlight: Promise<void> | null = null;

/**
 * Await whatever contribution sync is in flight. Resolves immediately when none is.
 *
 * @returns {Promise<void>}
 */
export function extensionSectionsReady(): Promise<void> {
  return _inFlight ?? Promise.resolve();
}

/**
 * Load the extensions payload and (re)register a settings section per `$studio.settings`
 * contribution, unregistering sections whose extension is no longer enabled. Formats load alongside
 * so the `$formats` context root has data at render time. Call on project activation and after
 * project.json `extensions` changes; loadExtensions caches, so repeat calls are cheap.
 *
 * Concurrent calls share one run — see {@link _inFlight}.
 */
export function syncExtensionSettingsSections(): Promise<void> {
  _inFlight ??= runSync().finally(() => {
    _inFlight = null;
  });
  return _inFlight;
}

/** One pass over the extensions payload. Never called concurrently with itself. */
async function runSync(): Promise<void> {
  const [extensions] = await Promise.all([loadExtensions(), loadFormats()]);
  const next = new Set<string>();
  for (const ext of extensions) {
    for (const info of ext.contributions) {
      const derived = deriveSettingsSection(info);
      if (!derived) {
        continue;
      }
      const { contribution } = derived;
      registerSettingsSection({
        icon: derived.icon,
        key: derived.key,
        label: derived.label,
        order: derived.order,
        render: (container) => {
          // Data-domain sections get the Test/Push/Data-grid actions slot when the platform
          // Implements the protocol's data routes; every other section renders actions-free.
          const actions = dataSectionActions(derived.key);
          const opts: ContributedSectionOptions = { formats: getFormats() };
          if (actions !== null) {
            opts.actions = actions;
          }
          renderContributedSection(container, contribution, opts);
        },
      });
      next.add(derived.key);
    }
  }
  for (const key of registeredKeys) {
    if (!next.has(key)) {
      unregisterSettingsSection(key);
    }
  }
  registeredKeys.clear();
  for (const key of next) {
    registeredKeys.add(key);
  }
}

/** Unregister every section this module added and forget them (project close / tests). */
export function resetExtensionSettingsSections(): void {
  for (const key of registeredKeys) {
    unregisterSettingsSection(key);
  }
  registeredKeys.clear();
}

/** The section keys currently registered by this module (diagnostics/tests). */
export function extensionSectionKeys(): string[] {
  return [...registeredKeys];
}
