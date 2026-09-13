/// <reference lib="dom" />
/**
 * The Publish panel as a mounted document.
 *
 * `publish/publish-panel.ts` is the flow — it asks the PAL whether Cloudflare can be reached at
 * all, runs the hosted OAuth round trip, stores a pasted token, creates the Pages project and
 * writes `build.deploy` — and this is the surface it draws into: the reactive scope the document
 * reads, the one discriminant it branches on, and the mount that lives in the modal layer until the
 * flow takes it down.
 *
 * **The flow states facts; the surface derives what the document branches on.** Whether a
 * connection exists, whether it has lapsed, whether a token is stored and whether the reader asked
 * to replace it are the flow's; that those add up to one of eight bodies is {@link derive}'s, so
 * neither the flow nor the document has to know that "connect your account" and "the connection you
 * already made has expired" are two sentences with two different remedies.
 *
 * **The token draft never enters the scope.** {@link PublishSurfaceOptions.onSaveToken} is handed
 * what the reader typed, and the value lives in this module's closure between the keystroke and
 * that call. A scope field would be a value the runtime could bind, and the whole point of the
 * field's missing `value` binding is that there is nothing for it to bind (`studio.md` §15 rule
 * 1).
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` rather than reimplemented.
 *
 * @docs studio/publish/cloudflare
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import publishDoc from "./publish.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("publish", publishDoc as unknown as JxDocument);

/** Where the Cloudflare Pages GitHub App is installed from. */
const PAGES_APP_INSTALL_URL = "https://github.com/apps/cloudflare-pages/installations/new";

/** One Cloudflare account, as the picker draws it. */
export interface PublishAccountRow {
  value: string;
  label: string;
}

/** The create-and-connect form, as the reader has filled it in so far. */
export interface PublishForm {
  accountId: string;
  projectName: string;
  owner: string;
  repo: string;
  branch: string;
}

/** The Pages project this site is connected to. */
export interface PublishDeploy {
  projectName: string;
  /** The site's own address, or empty when Cloudflare has not minted one yet. */
  productionUrl: string;
}

/** The last deployment Cloudflare reported. */
export interface PublishDeployment {
  stage: string;
  status: string;
  environment: string;
  url: string;
}

/**
 * What the flow knows. Every one of these may change while the panel is up, and not one of them is
 * a sentence: the words belong to the document.
 */
export interface PublishView {
  /** This platform can reach the Cloudflare API at all. */
  supported: boolean;
  /** The connection question is still in flight. */
  loading: boolean;
  /** A usable connection exists. */
  connected: boolean;
  /** A connection exists and has lapsed — `connected: true` with a reconnect required. */
  lapsed: boolean;
  /** The platform brokers OAuth, so there is no token for the reader to paste. */
  hosted: boolean;
  /** An API token is stored on this machine. */
  tokenStored: boolean;
  /** The reader asked to replace the stored token. */
  replacing: boolean;
  /** A request is in flight: every button that starts another one refuses. */
  busy: boolean;
  /** The last refusal, verbatim from whatever raised it. Empty draws nothing. */
  error: string;
  accounts: PublishAccountRow[];
  form: PublishForm;
  /** The connected Pages project, or null when this site has none yet. */
  deploy: PublishDeploy | null;
  /** The observed deployment, or null for "connected, nothing shipped yet". */
  deployment: PublishDeployment | null;
}

/** Which of the eight bodies the document draws. */
export type PublishBody =
  | "unsupported"
  | "loading"
  | "lapsed"
  | "hosted"
  | "stored"
  | "token"
  | "form"
  | "status";

export interface PublishSurfaceOptions {
  /** Where the panel is mounted — the modal layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  /** What to draw before anything has landed: the flow's own view, so there is one builder of it. */
  view: PublishView;
  /** Run the hosted OAuth flow — the invitation and the reconnect are the same request. */
  onConnect: () => void;
  /** The reader asked for an empty field to paste a replacement token into. */
  onReplaceToken: () => void;
  /** Verify was pressed: this is what the field held, on its way to storage. */
  onSaveToken: (token: string) => void;
  /** Open Preferences › Accounts, the one place a credential is listed and forgotten. */
  onOpenAccounts: () => void;
  /** One of the five connect-form controls moved. */
  onField: (field: keyof PublishForm, value: string) => void;
  /** Create the Pages project and connect it. */
  onSubmit: () => void;
  /** Ask Cloudflare again. */
  onRefresh: () => void;
  /** Remove `build.deploy` from the project. */
  onDisconnect: () => void;
  /** The panel closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

export interface PublishSurfaceHandle {
  /** The slot in the modal layer the document is mounted into. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Redraw from the flow's current view. */
  update: (view: PublishView) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** What the document discriminates on and reads. Derived here, never handed in. */
interface PublishFlags {
  body: PublishBody;
  /** The hosted button's whole wording, which is also whether a round trip is in flight. */
  connectLabel: string;
  submitLabel: string;
  hasFailure: boolean;
  failure: string;
  /**
   * The refusal names GitHub AND names a repository source, which is what Cloudflare says when the
   * Pages GitHub App is not installed. The one refusal on this surface with a remedy of its own.
   */
  needsPagesApp: boolean;
  pagesAppUrl: string;
  accountOptions: PublishAccountRow[];
  accountId: string;
  projectName: string;
  owner: string;
  repo: string;
  branch: string;
  deployProject: string;
  productionUrl: string;
  hasProductionUrl: boolean;
  hasDeployment: boolean;
  /** "deploy: success" — the stage and its status, which is the fact a reader acts on. */
  deploymentState: string;
  deploymentEnvironment: string;
  deploymentUrl: string;
  busy: boolean;
}

interface PublishScope extends Record<string, unknown>, PublishFlags {
  connect: () => void;
  replace: () => void;
  setToken: (value: string) => void;
  verify: () => void;
  openAccounts: () => void;
  setAccount: (value: string) => void;
  setProjectName: (value: string) => void;
  setOwner: (value: string) => void;
  setRepo: (value: string) => void;
  setBranch: (value: string) => void;
  submit: () => void;
  refresh: () => void;
  disconnect: () => void;
  closed: () => void;
}

/** Which body the eight facts add up to. */
function bodyOf(view: PublishView): PublishBody {
  if (!view.supported) {
    return "unsupported";
  }
  if (view.loading) {
    return "loading";
  }
  /* Before the credential branches, and that order is the fix: a lapsed connection arrives as
     `connected: true`, so neither branch below could ever have claimed it — the panel used to
     offer the first-time invitation to a reader who had already accepted it once. */
  if (view.connected && view.lapsed) {
    return "lapsed";
  }
  if (!view.connected) {
    if (view.hosted) {
      return "hosted";
    }
    return view.tokenStored && !view.replacing ? "stored" : "token";
  }
  return view.deploy ? "status" : "form";
}

/** The flags the document renders from. */
function derive(view: PublishView): PublishFlags {
  const { error } = view;
  return {
    accountId: view.form.accountId,
    accountOptions: view.accounts,
    body: bodyOf(view),
    branch: view.form.branch,
    busy: view.busy,
    connectLabel: view.busy ? "Reconnecting…" : "Reconnect Cloudflare",
    deploymentEnvironment: view.deployment?.environment ?? "",
    deploymentState: view.deployment ? `${view.deployment.stage}: ${view.deployment.status}` : "",
    deploymentUrl: view.deployment?.url ?? "",
    deployProject: view.deploy?.projectName ?? "",
    failure: error,
    hasDeployment: view.deployment !== null,
    hasFailure: error !== "",
    hasProductionUrl: (view.deploy?.productionUrl ?? "") !== "",
    needsPagesApp: /github/i.test(error) && /app|install|source|repo/i.test(error),
    owner: view.form.owner,
    pagesAppUrl: PAGES_APP_INSTALL_URL,
    productionUrl: view.deploy?.productionUrl ?? "",
    projectName: view.form.projectName,
    repo: view.form.repo,
    submitLabel: view.busy ? "Connecting…" : "Create & Connect",
  };
}

/**
 * Open the publish panel. The handle's `ready` resolves once the dialog is showing.
 *
 * @param options What to draw, and every decision a control can ask the flow for.
 * @returns The handle the flow updates and closes.
 */
export function openPublishSurface(options: PublishSurfaceOptions): PublishSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  options.layer.append(slot);

  /**
   * What the reader has typed into the token field, between the keystroke and Verify.
   *
   * A closure variable and not a scope field: the scope is what the document binds, and a secret
   * that a binding could read is one a repaint can paint.
   */
  let tokenDraft = "";

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close`, which `close()`
   * provokes, and `close()` on a dialog that never got as far as being shown.
   */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.onClosed();
  };

  const scope = reactive({
    ...derive(options.view),
    closed: finish,
    connect: () => {
      options.onConnect();
    },
    disconnect: () => {
      options.onDisconnect();
    },
    openAccounts: () => {
      options.onOpenAccounts();
    },
    refresh: () => {
      options.onRefresh();
    },
    replace: () => {
      tokenDraft = "";
      options.onReplaceToken();
    },
    setAccount: (value: string) => {
      /* What the control now holds, first and unconditionally. A binding only writes when the
         scope CHANGES, so a surface that decided a value without announcing the raw one would
         leave the control showing something the scope does not have (§9.3). */
      scope.accountId = value;
      options.onField("accountId", value);
    },
    setBranch: (value: string) => {
      scope.branch = value;
      options.onField("branch", value);
    },
    setOwner: (value: string) => {
      scope.owner = value;
      options.onField("owner", value);
    },
    setProjectName: (value: string) => {
      scope.projectName = value;
      options.onField("projectName", value);
    },
    setRepo: (value: string) => {
      scope.repo = value;
      options.onField("repo", value);
    },
    setToken: (value: string) => {
      tokenDraft = value;
    },
    submit: () => {
      options.onSubmit();
    },
    verify: () => {
      const token = tokenDraft;
      tokenDraft = "";
      options.onSaveToken(token);
    },
  }) as PublishScope;

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("publish", scope, slot).then(async (surface) => {
    mounted = surface;
    const element = surface.root as HTMLElement;
    if (closed) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (closed) {
      return element;
    }
    /* The region goes on the platform's own `<dialog>`, which is the one element here that HAS a
       box: `jx-dialog` is `display: contents`, and the slot wraps a dialog the top layer takes out
       of flow, so both measure 0×0 — and a region whose box is empty is refused outright by
       `scripts/screenshots/lib/shot.ts`. The kit treats that node as a seam already; its own
       behaviour sidecar finds it by exactly this selector. */
    const box = element.querySelector<HTMLElement>('dialog[part="dialog"]') ?? element;
    box.setAttribute(REGION_ATTR, overlayRegion("modal", "publish"));
    showModal(element);
    return element;
  });

  return {
    close() {
      /* Guarded on the WORK rather than on `closed`, and the difference is a slot that would
         otherwise be left behind: the platform's own `close` runs `finish()` before any caller
         reaches here, so a `close()` that returned early on `closed` would take the dialog down
         and leave its host div in the layer. Every line below is idempotent instead. */
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        closeDialog(element);
      }
      // A mount that has not landed yet is disposed by `ready` when it does — `finish` tells it so.
      mounted?.dispose();
      mounted = null;
      tokenDraft = "";
      slot.remove();
      finish();
    },
    host: slot,
    ready,
    update(view) {
      Object.assign(scope, derive(view));
    },
  };
}
