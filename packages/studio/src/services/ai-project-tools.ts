/**
 * Ai-project-tools.ts — project-level tools for the AI assistant.
 *
 * Two tiers registered here (document tools live in ai-tools.ts):
 *
 * - Bootstrap (no project open): `create_project` scaffolds through the platform's shared
 *   `createProject` pipeline (`@jxsuite/create` server-side) and adopts the result into this
 *   window; `list_starters` enumerates starter templates.
 * - Cross-file (project open): `list_files` / `read_file` / `write_file` / `search_files` are the
 *   portable file tools of `@jxsuite/ai/jx-tools` (specs/ai.md §3.14), run over this window's
 *   project (`harness/studio-project.ts`), so the agent can develop across many files without
 *   touching the tab strip. Studio's host pre-validates Jx documents (no undo exists for disk
 *   writes, so validation blocks instead of optimistically applying) and reconciles with open
 *   tabs.
 *
 * @license MIT
 */

import { JX_TOOL_FACTS, projectToolEntries } from "@jxsuite/ai/jx-tools";
import { createToolDefinition } from "@jxsuite/ai/tools";
import type { CreateProjectDestination, StudioPlatform } from "../types";
import type { ToolRegistry } from "@jxsuite/ai/tools";
import type { JsonValue, ProjectConfig } from "@jxsuite/schema/types";
import { getPlatform } from "../platform";
import { workspace } from "../workspace/workspace";
import { adoptCreatedProject } from "./project-adoption";
import { validateDoc, validateProjectConfig } from "./jx-validate";
import type { CandidateDocument, RenderProbe } from "./ai-write-report";
import { studioProjectHost } from "./harness/studio-project";
import type { Tab } from "../tabs/tab";

export interface ProjectToolsCtx {
  validate?: (doc: CandidateDocument) => Promise<string[]>;
  /**
   * Gate for `project.json` writes — the per-project entry document, not the document schema. It
   * judges the live configuration and a candidate parsed from the model's text alike.
   */
  validateProject?: (config: ProjectConfig | JsonValue) => Promise<string[]>;
  renderCheck?: RenderProbe;
  /** Live getter — the project style appears only after a project is open/bootstrapped. */
  getProjectStyle?: () => Record<string, string> | undefined;
  /** The open tab whose `documentPath` equals the given project-relative path, if any. */
  findOpenTab: (path: string) => Tab | null;
  /** Reload an open tab's document from disk (files.ts `reloadFileInTab`). */
  reloadTab: (path: string) => Promise<void>;
  /** Open the project at an absolute root in this window (project-adoption.ts). */
  adoptProject: (root: string) => Promise<void>;
  /** Fired after adoption is verified — the session store re-keys the live chat here. */
  onProjectAdopted?: (root: string) => void;
  /**
   * Fired after a successful `project.json` write so the configuration DOCUMENT holds what was
   * written. The config has passed the project-schema gate by then, which is what makes the type
   * honest.
   *
   * AWAITED, and the only thing that reconciles this write with the rest of the app:
   * `tabs/project-config.ts` owns `project.json`, and a write that does not reach its document
   * leaves that document holding the PREVIOUS configuration for the next settings edit to persist
   * back over this one. It used to be fire-and-forget, and the write survived only because an open
   * tab happened to be re-read from disk afterwards ({@link ProjectToolsCtx.reloadTab}); that
   * re-read is gone, because a second parse of `project.json` is the very rival object the
   * configuration document exists to prevent.
   *
   * `text` is the bytes that reached the file, of which `config` is the parse. The document keeps a
   * layout record for the file it holds (§9.4), and the assistant's write replaces the file — so
   * the record has to travel with the write, or the next settings commit re-lays the file the model
   * just formatted with the record of the file it had read before (issue 331). Handing the text
   * over is what lets the document derive that record without reading the file back.
   */
  onProjectConfigWritten?: (config: ProjectConfig, text: string) => void | Promise<void>;
}

/**
 * Register the project-level tools into a tool registry.
 *
 * @param {Pick<ToolRegistry, "register">} registry
 * @param {ProjectToolsCtx} ctx
 */
export function registerProjectTools(
  registry: Pick<ToolRegistry, "register">,
  {
    validate = validateDoc,
    validateProject = validateProjectConfig,
    renderCheck,
    getProjectStyle,
    findOpenTab,
    reloadTab,
    adoptProject,
    onProjectAdopted,
    onProjectConfigWritten,
  }: ProjectToolsCtx,
) {
  /* The four file tools are `@jxsuite/ai/jx-tools`'s, over this window's platform: what the model
     is told about them, their caps and their containment check are the same wherever the assistant
     runs (specs/ai.md §3.14). What Studio adds is in the host: what must hold before a file is
     overwritten, and what an open editor is told afterwards. */
  const host = studioProjectHost({
    findOpenTab,
    getProjectStyle,
    onProjectConfigWritten,
    reloadTab,
    renderCheck,
    validate,
    validateProject,
  });
  for (const entry of projectToolEntries(host)) {
    registry.register(entry);
  }

  // ── create_project ─────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "create_project",
      title: "Create a project",
      annotations: JX_TOOL_FACTS.create_project.annotations,
      description:
        "Create a new Jx project (a project file, conventional directories, starter pages) and open " +
        "it in the studio. Only available while no project is open. After it succeeds, the file " +
        "and document tools become available for building out the project. If the directory " +
        "already exists, retry with a different directory slug. Requires an explicit destination: " +
        'on a filesystem platform pass "location" (an absolute parent folder); on the cloud pass ' +
        '"owner" (a GitHub account or organization). Ask the user where to put it rather than ' +
        "guessing — nothing is created without one.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: 'Human project name, e.g. "Acme Bakery".' },
          description: { type: "string", description: "Short project description." },
          template: {
            type: "string",
            description:
              'Scaffold variant: "blank" (default), "desktop-first", "mobile-first", or "mobile-app".',
            enum: ["blank", "desktop-first", "mobile-first", "mobile-app"],
          },
          directory: {
            type: "string",
            description:
              "Folder (or repository) name to create the project as. Defaults to a slug of the name.",
          },
          location: {
            type: "string",
            description:
              "Absolute path of the EXISTING parent folder to create the project folder inside, " +
              'e.g. "/home/you/Sites". Required on filesystem platforms (desktop, dev server).',
          },
          owner: {
            type: "string",
            description:
              "GitHub account or organization to create the repository under. Required on the " +
              "cloud platform.",
          },
          private: {
            type: "boolean",
            description: "Cloud only: repository visibility. Defaults to private.",
          },
          design: {
            type: "object",
            description:
              "Optional design quickstart: { accent, background, text, bodyFont, headingFont } — " +
              "CSS colors and font-family names applied to the scaffold's design tokens.",
          },
        },
        required: ["name"],
      },
      async execute(args, ctx) {
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `name` is a
           present string, the optional strings and `private` have their declared types when
           present, and `design` is an object. Its colour and font members are not checked here;
           the platform's scaffold receives them as given. */
        const {
          name,
          description,
          template,
          directory,
          design,
          location,
          owner,
          private: isPrivate,
        } = args as {
          name: string;
          description?: string;
          template?: string;
          directory?: string;
          design?: Record<string, string>;
          location?: string;
          owner?: string;
          private?: boolean;
        };
        if (workspace.projectRoot) {
          return {
            success: false,
            error:
              "A project is already open in this window — create_project is only for bootstrapping.",
          };
        }
        const slug =
          directory?.trim() ||
          name
            .toLowerCase()
            .replaceAll(/[^a-z0-9]+/g, "-")
            .replaceAll(/^-|-$/g, "");
        if (!slug) {
          return { success: false, error: 'Could not derive a directory slug — pass "directory".' };
        }

        // No destination, no project. The backend refuses one anyway; failing here gives the model
        // A message it can act on instead of a wire error.
        const platform = getPlatform();
        let destination: CreateProjectDestination;
        if (platform.createDestination === "repo") {
          if (!owner?.trim()) {
            return {
              success: false,
              error:
                'Pass "owner" — the GitHub account or organization to create the repository under. ' +
                "Ask the user which one to use.",
            };
          }
          destination = {
            kind: "repo",
            owner: owner.trim(),
            private: isPrivate ?? true,
            repo: slug,
          };
        } else {
          if (!location?.trim()) {
            return {
              success: false,
              error:
                'Pass "location" — the absolute path of the folder to create the project inside. ' +
                "Ask the user where the project should live.",
            };
          }
          if (!/^(?:[a-zA-Z]:[/\\]|\/)/.test(location.trim())) {
            return { success: false, error: `"location" must be an absolute path: ${location}` };
          }
          destination = { kind: "path", parent: location.trim().replace(/[/\\]+$/, "") };
        }

        let result: { root: string; config: object };
        try {
          const request: Parameters<StudioPlatform["createProject"]>[0] = {
            name,
            destination,
            directory: slug,
          };
          if (description) {
            request.description = description;
          }
          if (template) {
            request.template = template;
          }
          if (design) {
            request.design = design;
          }
          result = await platform.createProject(request);
        } catch (error) {
          return {
            success: false,
            error: `Failed to create project: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
        /* The project is on disk from here, whether or not this window goes on to open it, and no
           undo reaches it. Recorded, it is what the turn changed: without it a turn that bootstrapped
           a project and then only read reported that it had applied nothing. */
        ctx.ledger.record({ disk: true, ok: true, path: result.root, tool: "create_project" });

        /*
         * Git init, then the full project-open flow, then a check that it landed — all three in
         * `services/project-adoption.ts`, because `import_site` is the same act with a different
         * backend. Git init in particular was missing here: `specs/desktop.md` §4.5 promises every
         * create path initialises a repository, and only the New Project modal was keeping it.
         */
        const { adopted, error: adoptionError } = await adoptCreatedProject(result.root, {
          adopt: adoptProject,
        });
        if (adopted) {
          onProjectAdopted?.(result.root);
          return {
            success: true,
            summary:
              `Created project "${name}" at ${result.root} and opened it. The file tools ` +
              `(list_files, read_file, write_file) and document tools are now available — start ` +
              `with list_files to see the scaffolded pages, layouts, and components.`,
          };
        }
        return {
          success: true,
          summary:
            `Created project "${name}" at ${result.root}, but it was not opened in this window` +
            `${adoptionError ? ` (${adoptionError})` : " (it may have opened in another window)"}. ` +
            `Ask the user to open it from the welcome screen or recent projects.`,
        };
      },
    }),
  );

  // ── list_starters ──────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "list_starters",
      title: "List starters",
      annotations: JX_TOOL_FACTS.list_starters.annotations,
      description:
        "List the starter templates available for new projects (id, name, description). " +
        "Currently informational — create_project scaffolds from built-in template variants.",
      parameters: { type: "object", properties: {}, required: [] },
      async execute() {
        try {
          const starters = (await getPlatform().listStarters?.()) ?? [];
          return {
            success: true,
            data: { starters },
            summary: `${starters.length} starter(s) available.`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to list starters: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  );
}
