/**
 * The Create GitHub Repository dialog — `src/surfaces/github-publish.json` and its adapter, driven
 * through the real flow that `tests/github-publish.test.ts` bypasses with a canned answer.
 *
 * Everything is addressed by `part` and `data-field`, because the dialog is a document now: there
 * is no `#repo-name` to find, no `sp-dialog-wrapper` to dispatch at, and no
 * `.github-publish-dialog` to style — the box, the header, the two answer buttons and the backdrop
 * all belong to `jx-dialog`. A reader's edit is written to the NATIVE control inside the kit
 * element and dispatched from there, because that is what typing is: the element hears its own
 * control, writes the value into its state, and lets the event bubble on to the surface.
 */
import { flush } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import { resetActivities } from "../src/panels/activity-panel";
import { openGithubPublishSurface } from "../src/surfaces/github-publish";

let statusMessages: string[] = [];
let refreshCalls = 0;
let authToken: string | null = "ghp_gap_token";
let remoteCalls: unknown[][] = [];
let pushCalls: unknown[][] = [];

let fetchCalls: { url: string; opts: any }[] = [];
let fetchResponses: { ok: boolean; json: unknown }[] = [];
const originalFetch = globalThis.fetch;

/** The dialog layer, standing in for `#layer-dialog` without a shell to hang it off. */
const dialogLayer = document.createElement("div");
document.body.append(dialogLayer);

void mock.module("../src/ui/layers.js", () => ({
  layerHost: () => dialogLayer,
  showConfirmDialog: async () => true,
}));

void mock.module("../src/github/github-auth.js", () => ({
  authenticateGithub: async () => authToken,
  clearGithubToken: () => {},
  getGithubToken: () => authToken,
}));

void mock.module("../src/platform.js", () => ({
  getPlatform: () => ({
    gitAddRemote: (...args: unknown[]) => {
      remoteCalls.push(args);
      return Promise.resolve();
    },
    gitPush: (...args: unknown[]) => {
      pushCalls.push(args);
      return Promise.resolve();
    },
  }),
  registerPlatform: () => {},
}));

void mock.module("../src/panels/git-panel.js", () => ({
  cleanupGitPanel: () => {},
  cloneRepository: async () => {},
  platformSupportsClone: () => false,
  refreshGitStatus: async () => {
    refreshCalls += 1;
  },
  renderGitPanel: () => null,
}));

// `notify` in place of the deleted `statusMessage`: the publish flow's three progress lines and
// Its two failures are the same facts, now with a severity and a tier.
const details: string[] = [];
const record = (message: string, opts?: { detail?: string }) => {
  statusMessages.push(message);
  if (opts?.detail) {
    details.push(opts.detail);
  }
  return { id: "n", message } as never;
};
void mock.module("../src/services/notify.js", () =>
  notifyModule((call) => record(call.message, call.options)),
);

const { createGithubRepository } = await import("../src/github/github-publish.js");

function stubFetch(responses: { ok: boolean; json: unknown }[]) {
  fetchResponses = [...responses];
  fetchCalls = [];
  // @ts-expect-error -- minimal fetch mock does not implement the full fetch type
  globalThis.fetch = async (url: any, opts: any) => {
    fetchCalls.push({ opts, url: String(url) });
    const next = fetchResponses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch to ${url}`);
    }
    return { json: async () => next.json, ok: next.ok, status: next.ok ? 201 : 422 };
  };
}

/** The dialog the flow put up, or null. */
function dialogElement(): HTMLElement | null {
  return dialogLayer.querySelector<HTMLElement>('jx-dialog[part="github-publish"]');
}

/** One row's native control: the input a reader types into, or the switch's checkbox. */
function control(row: string): HTMLInputElement {
  return dialogElement()!.querySelector<HTMLInputElement>(
    `[data-field="${row}"] [part="input"]`,
  ) as HTMLInputElement;
}

/** Type into a field the way a reader does: the control moves, and the element hears it. */
function type(row: string, value: string): void {
  const input = control(row);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Start the flow and wait for the dialog.
 *
 * Two waits, not one: the mount resolving means the DOCUMENT rendered, and `jx-dialog`, `jx-field`,
 * `jx-textfield` and `jx-switch` each settle their own template one `connectedCallback` later — so
 * a single flush finds the dialog element with none of its controls inside it
 * (specs/studio-ui-guidelines.md §1.1).
 */
async function openPublishDialog(projectName = "proj") {
  const promise = createGithubRepository({ projectName });
  await flush();
  await flush();
  const dialog = dialogElement();
  expect(dialog).not.toBeNull();
  return { dialog: dialog!, promise };
}

beforeEach(() => {
  resetActivities();
  statusMessages = [];
  details.length = 0;
  refreshCalls = 0;
  remoteCalls = [];
  pushCalls = [];
  authToken = "ghp_gap_token";
  dialogLayer.replaceChildren();
  stubFetch([]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("the Create GitHub Repository dialog", () => {
  test("confirm with edited fields creates the repo with those values", async () => {
    stubFetch([
      {
        json: {
          clone_url: "https://github.com/u/custom-repo.git",
          html_url: "https://github.com/u/custom-repo",
        },
        ok: true,
      },
    ]);
    const { dialog, promise } = await openPublishDialog("proj");

    type("name", "custom-repo");
    type("description", "My description");
    const visibility = control("visibility");
    visibility.checked = false;
    visibility.dispatchEvent(new Event("change", { bubbles: true }));
    dialog.dispatchEvent(new Event("confirm"));

    const result = await promise;
    expect(result).toBe(true);
    expect(fetchCalls.length).toBe(1);
    const body = JSON.parse(fetchCalls[0]!.opts.body);
    expect(body).toEqual({
      auto_init: false,
      description: "My description",
      name: "custom-repo",
      private: false,
    });
    expect(fetchCalls[0]!.opts.headers.Authorization).toBe("Bearer ghp_gap_token");
    expect(remoteCalls).toEqual([["origin", "https://github.com/u/custom-repo.git"]]);
    expect(pushCalls).toEqual([[{ setUpstream: true }]]);
    expect(refreshCalls).toBe(1);
    expect(
      statusMessages.some((m) =>
        m.includes("Repository created: https://github.com/u/custom-repo"),
      ),
    ).toBe(true);
    // The document went with the answer: the layer is empty again.
    expect(dialogLayer.querySelector("jx-dialog")).toBeNull();
  });

  test("confirm with untouched fields falls back to project name and private repo", async () => {
    stubFetch([
      {
        json: { clone_url: "https://github.com/u/proj.git", html_url: "https://github.com/u/proj" },
        ok: true,
      },
    ]);
    const { dialog, promise } = await openPublishDialog("proj");

    // The name field starts on the project's name, and the switch starts on private.
    expect(control("name").value).toBe("proj");
    expect(control("description").value).toBe("");
    expect(control("visibility").checked).toBe(true);

    dialog.dispatchEvent(new Event("confirm"));
    const result = await promise;
    expect(result).toBe(true);
    const body = JSON.parse(fetchCalls[0]!.opts.body);
    expect(body.name).toBe("proj");
    expect(body.description).toBe("");
    expect(body.private).toBe(true);
  });

  test("an emptied name falls back to the project's, rather than creating a nameless repo", async () => {
    stubFetch([
      {
        json: { clone_url: "https://github.com/u/proj.git", html_url: "https://github.com/u/proj" },
        ok: true,
      },
    ]);
    const { dialog, promise } = await openPublishDialog("proj");
    type("name", "");
    dialog.dispatchEvent(new Event("confirm"));

    expect(await promise).toBe(true);
    expect(JSON.parse(fetchCalls[0]!.opts.body).name).toBe("proj");
  });

  test("cancel resolves false, takes the document down, and calls nothing", async () => {
    const { dialog, promise } = await openPublishDialog();
    dialog.dispatchEvent(new Event("cancel"));
    expect(await promise).toBe(false);
    expect(fetchCalls).toEqual([]);
    expect(remoteCalls).toEqual([]);
    expect(dialogLayer.querySelector("jx-dialog")).toBeNull();
  });

  test("the platform's own close resolves false, whatever closed it", async () => {
    const { dialog, promise } = await openPublishDialog();
    dialog.dispatchEvent(new Event("close"));
    expect(await promise).toBe(false);
    expect(fetchCalls).toEqual([]);
  });

  test("API error without field errors falls back to top-level message", async () => {
    stubFetch([{ json: { message: "nope" }, ok: false }]);
    const { dialog, promise } = await openPublishDialog();
    dialog.dispatchEvent(new Event("confirm"));
    expect(await promise).toBe(false);
    expect(statusMessages).toContain("Could not create the GitHub repository.");
    expect(details).toContain("nope");
    expect(remoteCalls).toEqual([]);
  });

  test("API error without any message uses the generic fallback", async () => {
    stubFetch([{ json: {}, ok: false }]);
    const { dialog, promise } = await openPublishDialog();
    dialog.dispatchEvent(new Event("confirm"));
    expect(await promise).toBe(false);
    expect(statusMessages).toContain("Could not create the GitHub repository.");
    expect(details.join("\n")).toContain("GitHub answered 422.");
  });

  test("no token short-circuits before showing the dialog", async () => {
    authToken = null;
    const result = await createGithubRepository({ projectName: "proj" });
    expect(result).toBe(false);
    expect(dialogElement()).toBeNull();
    expect(fetchCalls).toEqual([]);
  });
});

describe("the dialog's own markup", () => {
  test("the switch keeps the name printed beside it, rather than the row's label", async () => {
    /*
     * `jx-field` names the first thing slotted into it that observes `labelledby`, so a switch
     * slotted straight into the Visibility row would be announced "Visibility" over the top of the
     * words next to it. The row opens with a plain `div`, which observes no naming — asserted here
     * because the defect is silent: the dialog looks identical either way.
     */
    const { dialog, promise } = await openPublishDialog();
    const toggle = dialog.querySelector('[part="toggle"]') as HTMLElement;
    expect(toggle.getAttribute("labelledby")).toBeNull();
    expect(control("visibility").getAttribute("aria-labelledby")).toBeNull();
    expect(dialog.querySelector('[part="toggle"] [part="label"]')?.textContent).toBe(
      "Private repository",
    );

    dialog.dispatchEvent(new Event("cancel"));
    expect(await promise).toBe(false);
  });

  test("each text row's label names its own field", async () => {
    const { dialog, promise } = await openPublishDialog();
    for (const [row, label] of [
      ["name", "Repository name"],
      ["description", "Description (optional)"],
    ] as const) {
      const named = control(row).getAttribute("aria-labelledby");
      expect(named).not.toBeNull();
      expect(dialog.querySelector(`#${named}`)?.textContent).toBe(label);
    }

    dialog.dispatchEvent(new Event("cancel"));
    expect(await promise).toBe(false);
  });
});

describe("the surface on its own", () => {
  test("closing before the mount lands disposes it, and a second close says nothing twice", async () => {
    /*
     * The flow never reaches this: it opens the dialog and waits for an answer. But the mount is
     * asynchronous, so a caller CAN take the dialog down before the document has landed — and the
     * mount that arrives afterwards must be disposed rather than left showing over an app that has
     * moved on. `onClosed` fires once, because two paths reach it and either may be first.
     */
    const layer = document.createElement("div");
    document.body.append(layer);
    let closures = 0;
    const handle = openGithubPublishSurface({
      layer,
      name: "unmounted",
      onCancel: () => {},
      onClosed: () => {
        closures += 1;
      },
      onConfirm: () => {},
    });
    expect(layer.childElementCount).toBe(1);

    handle.close();
    expect(layer.childElementCount).toBe(0);
    handle.close();
    expect(closures).toBe(1);

    const element = await handle.ready;
    await flush();
    expect(element.isConnected).toBe(false);
    layer.remove();
  });
});
