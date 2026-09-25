/// <reference lib="dom" />
/**
 * Chat-panel.ts — the assistant, as the Inspector dock's fourth tab.
 *
 * **It is not a column and it is not a dock.** `#chat-panel` was a fifth permanent grid column
 * ~300px wide; then it was a node sharing the Inspector's cell; it is now the body of one tab
 * beside Content, Style and Logic. Nothing about the chat UI changed for any of those moves, which
 * is what {@link mount} taking a host rather than finding one has bought: `right-panel.ts` builds
 * the four tab containers and hands this module the fourth.
 *
 * The `inspector.assistant` region is stamped HERE, on the container this module owns, rather than
 * in `ui/regions.ts`'s shell table — the assistant no longer has a shell host to name. Three
 * screenshot shots address that id and none of them changed.
 *
 * Hosts the assistant machinery from ai-panel.ts unconditionally: with no project (welcome screen),
 * with a project but no open document, and with a document open. The machinery is mounted once at
 * studio boot and never tears down on tab switches — the assistant's module state (composer draft,
 * scroll position, transcript) persists.
 *
 * **The assistant's SURFACE document is what this module defers.** Mounting `surfaces/ai-chat.ts`
 * costs a traced 100–290 ms of connectedCallback at boot (its island projections; see
 * `scripts/perf/REPORT.md`), paid on every window open although the document is invisible until
 * the tab is picked. Binding is the same seam (`bindAiPanelHost`) and it is now deferred to the
 * first time the Assistant tab is actually shown or revealed: `renderAiPanel` no-ops while the
 * surface is null, and the surface's own watcher projects whatever the machinery wrote before that
 * point, so a prompt seeded into a boot the reader never spends in the tab is not lost — it is one
 * more message waiting when the body first appears.
 *
 * **This module is the SEAM, and it has no markup of its own.** The assistant is a Jx document
 * (`surfaces/ai-chat.json`), and a document CLEARS the host it is given — so it needs a container
 * nobody else writes into. That container is the one thing created here; `.ai-panel-host` is its
 * layout rule in `styles/inspector.css`, which is why the class stays on a node the surface does
 * not own. Everything below it is the surface's, and `ai-panel.ts` drives it from one effect —
 * there is no scheduler, and there is no frame loop, because a document's bindings re-run per
 * property and a streaming token never reaches the composer.
 *
 * @license MIT
 */

import { effect, effectScope } from "../reactivity";
import { workspace } from "../workspace/workspace";
import { consumePendingAgentPrompt, hasPendingAgentPrompt } from "../services/agent-seed";
import { REGION_ATTR } from "../ui/regions";
import { inspectorTab } from "./right-panel";
import {
  bindAiPanelHost,
  mountAiPanel,
  renderAiPanel,
  revealAssistant,
  seedAssistantPrompt,
} from "./ai-panel";

import type { EffectScope } from "@vue/reactivity";

/** The region id every assistant screenshot crops to. Stamped on the container, not on a div. */
const ASSISTANT_REGION = "inspector.assistant";

let _host: HTMLElement | null = null;
let _container: HTMLElement | null = null;
let _scope: EffectScope | null = null;
/** Whether the surface document has been bound. One bind per host; a remount resets it. */
let _surfaceBound = false;

/**
 * Bind the assistant's surface document the first time its tab is shown or revealed.
 *
 * The container, the region attribute and every prompt path are ready before this; the surface is
 * the expensive part and is invisible until the tab is picked, so this is the earliest moment its
 * cost is worth paying. A restore that lands on the Assistant tab binds on the same tick.
 */
function ensureAssistantSurface(): void {
  if (_surfaceBound || !_container) {
    return;
  }
  _surfaceBound = true;
  bindAiPanelHost(_container);
}

/**
 * Mount the assistant into the host the Inspector hands it. Idempotent per host: the persistent
 * `.ai-panel-host` container is created once and handed to `ai-panel.ts` as the surface's mount
 * point. A missing host (a reduced test fixture with no inspector) is a no-op.
 *
 * @param {HTMLElement | null} host
 */
export function mount(host: HTMLElement | null) {
  if (!host || (_host === host && _container)) {
    return;
  }
  _host = host;
  _container = document.createElement("div");
  _container.className = "ai-panel-host";
  _container.setAttribute(REGION_ATTR, ASSISTANT_REGION);
  host.textContent = "";
  host.append(_container);

  mountAiPanel();
  _surfaceBound = false;

  _scope?.stop();
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      // The surface's bind follows the TAB: a session restored onto the Assistant is bound by
      // One re-run of this effect, not by anyone remembering to call the seam directly.
      if (inspectorTab() === "assistant") {
        ensureAssistantSurface();
      }
    });
    effect(() => {
      // A pending agent prompt (stored by the New Project flow, possibly from another window) is
      // Keyed by the absolute project root — consume it as soon as this window adopts that root.
      const root = workspace.projectRoot;
      if (!root || !hasPendingAgentPrompt(root)) {
        return;
      }
      // Reveal the assistant the way any other inspector tab is revealed: open the dock it lives
      // In, then select it. There is no assistant dock left to open. Those two lines live in
      // `ai-panel.ts` now, because the `Assistant:` command family needs the same pair.
      revealAssistant();
      const prompt = consumePendingAgentPrompt(root);
      if (prompt) {
        // Defer past the current render so the assistant machinery is in place before the send.
        requestAnimationFrame(() => {
          void seedAssistantPrompt(prompt);
        });
      }
    });
  });
}

export function unmount() {
  _scope?.stop();
  _scope = null;
  _surfaceBound = false;
  // `null` unbinds the surface: the document is disposed and the chat-state watcher stopped.
  bindAiPanelHost(null);
  if (_host) {
    _host.textContent = "";
  }
  _host = null;
  _container = null;
}

/**
 * Recompute the assistant's projection now (no-op before mount).
 *
 * Kept because `store.ts`'s `registerRenderer("chatPanel", …)` compat registry still names it. The
 * surface follows the projection, so this is one function call rather than a repaint.
 */
export function render() {
  if (_container) {
    renderAiPanel();
  }
}
