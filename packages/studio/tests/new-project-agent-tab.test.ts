/**
 * The New Project wizard's Agent flow: the credentials gate and prompt validation on the source
 * step, then the scaffold-then-seed flow from the second step (createProject with the blank
 * template + a pending agent prompt stored for the opening window's assistant).
 *
 * The Agent submit runs the same destination validation as a normal create, so a project is only
 * ever scaffolded under the Location the user chose.
 *
 * The gate is two ISLANDS now: the keyless Cloudflare offer and the key form are each a mounted
 * document of their own, placed into boxes `surfaces/new-project.json` renders empty. So the gate
 * is `[part="creds"]` with `[part="managed-connect"]` and `[part="ai-creds-form"]` inside it, and
 * it takes more turns to settle than the wizard around it does.
 */
import {
  clearSeededSettings,
  flush,
  installMockPlatform,
  mountOverlayLayers,
  npFillLocation,
  npDismiss,
  npFooter,
  npName,
  npPart,
  npPickTab,
  npPress,
  npPreview,
  npType,
  seedSettings,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetModelCache } from "../src/services/ai-models";

const { openNewProjectModal } = await import("../src/new-project/new-project-modal");
const { initLayers } = await import("../src/ui/layers");

mountOverlayLayers(document.body);
initLayers();

/** The multiline prompt field on the Agent source step. */
function promptField(): HTMLInputElement {
  return npPart("prompt")!.querySelector('[part="input"]') as HTMLInputElement;
}

/** The inline destination-validation message under the Location fields. */
function inlineError(): string {
  return npPart("destination-failure")?.textContent?.trim() ?? "";
}

/** The wizard's global refusal strip, which is a different sentence in a different place. */
function globalError(): string {
  return npPart("failure")?.textContent?.trim() ?? "";
}

/* The credentials gate probes the AI proxy for backend-held credentials. Stub it: the default is an
   unmanaged, unconfigured backend (BYOK-only), and managed tests override `proxyState`. */
let proxyState: { configured: boolean; managed: boolean } = { configured: false, managed: false };
(globalThis as Record<string, unknown>).fetch = async () =>
  Response.json({ models: [], ...proxyState }, { status: 200 });

beforeEach(() => {
  localStorage.clear();
  clearSeededSettings();
  proxyState = { configured: false, managed: false };
  resetModelCache(); // Re-arms the one-shot probe between tests.
});

afterEach(() => {
  npDismiss();
});

describe("Agent flow", () => {
  test("shows the AI credentials form when no key is stored, with no Next button", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    await flush(4);
    expect(npPart("creds")).toBeTruthy();
    expect(npPart("ai-creds-form")).toBeTruthy();
    expect(npFooter()).toEqual(["Cancel"]);
  });

  test("offers Connect Cloudflare beside the key form on a managed platform", async () => {
    /* Regression: the cloud SaaS brokers Workers AI on the user's own account, so a gate that
       renders only the BYOK form leaves them with no key and no way to get one. */
    proxyState = { configured: false, managed: true };
    const { platform } = installMockPlatform();
    platform.cfConnect = async () => ({
      status: "connected" as const,
      connection: { connected: true },
    });
    void openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    /* The Cloudflare offer beside the key form is a mounted Jx document of its own, so it is
       addressed by `part` and it is not there on the turn the gate renders. */
    await flush(6);

    const gate = npPart("creds");
    expect(gate?.querySelector('[part="managed-connect"]')).toBeTruthy();
    expect(gate!.textContent).toContain("Connect Cloudflare");
    // The BYOK form stays — both are real paths.
    expect(gate!.querySelector('[part="ai-creds-form"]')).toBeTruthy();
    expect(npPart("blurb")?.textContent).toContain(
      "Connect Cloudflare, or add an OpenAI-compatible API key",
    );
  });

  test("lets a managed platform with AI already connected past the gate without a key", async () => {
    /* Regression: gating on hasOpenAiKey() alone suppressed the Next button for users whose
       Cloudflare account was already brokering working AI. */
    proxyState = { configured: true, managed: true };
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    await flush(3);

    expect(localStorage.getItem("jx.ai.openaiKey")).toBeNull();
    expect(npPart("creds")).toBeNull();
    expect(promptField()).toBeTruthy();
    expect(npFooter()).toContain("Next");
  });

  test("shows the prompt once a key is stored and requires it before Next", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-agent-test" });
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    await flush(3);
    expect(npPart("creds")).toBeNull();
    expect(promptField()).toBeTruthy();

    npPress("Confirm");
    await flush(2);
    expect(globalError()).toContain("Describe the site");
    // Still on the source step.
    expect(npPart("tabs")).toBeTruthy();
  });

  test("requires a name on the second step", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-agent-test" });
    const { state } = installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    await flush(3);
    npType(promptField(), "A cozy site");
    npPress("Confirm");
    await flush(3);
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush(2);
    // The message renders inline at the name field, not in the global strip.
    expect(npPart("name-failure")?.textContent?.trim()).toBe("Project name is required");
    expect(state.calls.filter((c) => c[0] === "createProject")).toHaveLength(0);
  });

  test("blocks the agent create until a Location is chosen", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-agent-test" });
    const { state } = installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    await flush(3);
    npType(promptField(), "A cozy site");
    npPress("Confirm");
    await flush(3);
    // Everything but the destination is filled in — the wizard never guesses where to write.
    npType(npName(), "Agent Site");
    await flush();
    npPress("Confirm");
    await flush(2);

    expect(inlineError()).toBe("Choose a location for the project folder");
    expect(state.calls.filter((c) => c[0] === "createProject")).toHaveLength(0);
    // The prompt is only stored once a project exists to key it on.
    expect(
      Object.keys(localStorage).filter((k) => k.startsWith("jx.ai.pendingAgentPrompt:")),
    ).toHaveLength(0);
  });

  test("scaffolds a blank project at the chosen location and stores the pending agent prompt", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-agent-test" });
    const created: Record<string, unknown>[] = [];
    installMockPlatform({
      createProject: (async (opts: Record<string, unknown>) => {
        created.push(opts);
        return { config: { name: "Agent Site" }, root: "/projects/agent-site" };
      }) as never,
    });

    const promise = openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    await flush(3);
    npType(promptField(), "A landing page for a coffee roastery");
    npPress("Confirm");
    await flush(3);
    // The agent scaffolds from the blank template; its breakpoint preset prefills the editor.
    expect(npPart("context")?.textContent).toContain("Agent");
    npType(npName(), "Agent Site");
    await flush();
    npFillLocation("/home/dev/Sites");
    await flush();
    expect(npPreview()).toBe("Creates: /home/dev/Sites/agent-site");
    npPress("Confirm");

    const result = await promise;
    expect(result).toEqual({
      config: { name: "Agent Site" },
      root: "/projects/agent-site",
    } as never);

    expect(created[0]).toMatchObject({
      destination: { kind: "path", parent: "/home/dev/Sites" },
      directory: "agent-site",
      name: "Agent Site",
      template: "blank",
    });
    // Untouched design prefills are not sent.
    expect((created[0] as { design?: unknown }).design).toBeUndefined();

    // The prompt is keyed on the root the platform reported, not on the destination the modal sent.
    const stored = localStorage.getItem("jx.ai.pendingAgentPrompt:/projects/agent-site");
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).prompt).toBe("A landing page for a coffee roastery");
  });
});
