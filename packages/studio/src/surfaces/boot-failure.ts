/// <reference lib="dom" />
/**
 * The boot-failure surface: what Studio draws instead of its frame when the platform adapter a
 * launcher was supposed to register never arrived.
 *
 * `platforms/default-platform.ts` decides WHETHER to refuse the dev-server fallback; this decides
 * what to SAY about it. The difference matters because the reader is a customer, not a developer
 * with a console open: desktop 5.0.0 to 5.1.3 failed this way silently for months, and the only
 * report that reached anyone was "Create Project says Failed to fetch". So the screen names the
 * failure in one sentence, prints the error the launcher recorded, and carries the facts a support
 * thread asks for first — which bundle, which launcher, which page — behind a Copy button, so the
 * next report arrives with them attached.
 *
 * The error is read LAZILY, from `launcherSignal()` at the moment the view is built, and not from
 * the refusal. The launcher's boot module records the first page error it sees; reading it late
 * costs nothing and cannot miss one that landed after the refusal was decided.
 *
 * The page's query string is never printed. The Chromium launcher authenticates its window with a
 * `?token=` in the URL, and "copy details" is an invitation to paste the result somewhere public.
 *
 * @docs studio/desktop
 */

import { reactive } from "../reactivity";
import { launcherSignal } from "../platform";
import { mountSurface, registerSurface } from "../ui/surface";
import { APP_NAME, GIT_COMMIT, VERSION } from "../version";
import bootFailureDoc from "./boot-failure.json";
import type { BootRefusal } from "../platforms/default-platform";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("boot-failure", bootFailureDoc as unknown as JxDocument);

/** The page the failure happened on — `location`, or a stand-in with the one field read. */
export interface BootFailurePage {
  href: string;
}

/** What the document draws, with every sentence already decided. */
export interface BootFailureView {
  title: string;
  lead: string;
  /** The launcher's recorded error: its message, then its stack when it has one. */
  detail: string;
  hasDetail: boolean;
  /** One line of support facts: bundle version and commit, launcher, page (no query string). */
  facts: string;
}

/** The scope `boot-failure.json` reads. */
interface BootFailureScope extends Record<string, unknown>, BootFailureView {
  /** The last Copy landed on the clipboard; the button says so. */
  copied: boolean;
  reload: () => void;
  copy: () => Promise<void>;
}

/** One sentence per refusal: what failed, in the words of someone who only saw the window. */
function leadFor(refusal: BootRefusal): string {
  if (refusal.kind === "launcher") {
    return "The desktop app's bridge to its backend failed to start, so nothing can be opened, saved or created; reinstalling the latest release from the download page fixes this.";
  }
  if (refusal.kind === "declared") {
    return "This page's startup script never ran, so Studio has no backend to open, save or create projects with.";
  }
  return `This page was opened from a ${refusal.protocol} URL, which has no Studio backend behind it; open Studio through the desktop app or a Jx dev server instead.`;
}

/**
 * The error text, message first.
 *
 * A V8 stack already begins with the message, so printing both would say it twice; a stack that
 * does not contain it (a non-Error throw, a WebKit stack of bare frames) gets the message above
 * it.
 */
function detailFor(): string {
  const error = launcherSignal()?.error;
  if (!error) {
    return "";
  }
  const { message, stack } = error;
  if (!stack) {
    return message;
  }
  return stack.includes(message) ? stack : `${message}\n${stack}`;
}

/**
 * Everything the screen says, decided from the refusal and the live launcher signal.
 *
 * Pure apart from reading that signal, which is the point: see the header on why it is read here.
 *
 * @param refusal Why the dev-server fallback was refused.
 * @param page The page to name in the facts line. Only its path survives; see the header.
 */
export function bootFailureView(
  refusal: BootRefusal,
  page: BootFailurePage = location,
): BootFailureView {
  const detail = detailFor();
  const launcher =
    (refusal.kind === "launcher" ? refusal.launcher : undefined) ??
    launcherSignal()?.launcher ??
    "none";
  // Cut at the first `?` or `#`: the query is where the Chromium launcher's token lives.
  const [where] = page.href.split(/[?#]/u);
  return {
    detail,
    // Labelled as the STUDIO bundle's version, not the app's: the desktop app wraps a Studio bundle
    // Whose version moves on its own schedule, and a support thread that reads "5.3.0" as the
    // Desktop release is chasing a build that does not exist.
    facts: `${APP_NAME} bundle ${VERSION} (${GIT_COMMIT}) · launcher ${launcher} · ${where}`,
    hasDetail: detail !== "",
    lead: leadFor(refusal),
    title: "Jx Studio couldn't connect to its backend",
  };
}

/** The plain-text report Copy puts on the clipboard: everything the screen says, in order. */
export function bootFailureReport(view: BootFailureView): string {
  return [view.title, view.lead, view.detail, view.facts].filter(Boolean).join("\n\n");
}

/**
 * Mount the boot-failure screen into `host`.
 *
 * @param host The container it owns — `#shell-root`, via `shell/tree.ts`'s `mountBootFailureTree`.
 * @param refusal Why the dev-server fallback was refused.
 * @param page The page to name in the facts line; `location` by default.
 */
export function mountBootFailureSurface(
  host: HTMLElement,
  refusal: BootRefusal,
  page: BootFailurePage = location,
): Promise<SurfaceHandle> {
  const view = bootFailureView(refusal, page);
  const scope = reactive<BootFailureScope>({
    ...view,
    copied: false,
    async copy() {
      try {
        await navigator.clipboard.writeText(bootFailureReport(view));
        scope.copied = true;
      } catch {
        /* No clipboard: an insecure context, a denied permission, or a webview without the API.
           The button stays "Copy details", and the text it would have copied is on the screen,
           selectable, directly above it — so the failure costs one drag rather than the report. */
      }
    },
    reload() {
      location.reload();
    },
  }) as BootFailureScope;
  return mountSurface("boot-failure", scope, host);
}
