/**
 * The preview realm's message protocol (`project-state.md` §11.2, `studio.md` §9.1.2).
 *
 * The shell and the realm share nothing but these messages. The shell names a document by its
 * `DocId` (`project-state.md` §2.2), with the path it has now as an attribute, and hands the realm
 * the document as the content store holds it, already parsed: the realm never reads a project file
 * the shell has not given it, apart from the definitions a document names by URL (`$elements`,
 * `$src`), which it fetches from the host as the canvas does. The realm answers each request with a
 * snapshot of what it drew, or a reason it drew nothing, and with the custom element names its
 * registry holds, so the shell knows which changed definitions make the realm stale.
 *
 * Plain data only: every message crosses `postMessage`, which clones it.
 *
 * @docs studio/interface
 */

import type { AssetContext } from "../canvas/asset-resolve";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

/** The canvas document's query parameter, and its value, that make the frame a preview realm. */
export const PREVIEW_REALM_PARAM = "realm";
export const PREVIEW_REALM_VALUE = "preview";

/** Marks the box drawn for an element the realm cannot draw; the shell's preview rules style it. */
export const PREVIEW_FALLBACK_CLASS = "jx-preview-fallback";

/** A document the shell hands the realm: its identity, its place, and its content. */
export interface RealmDocument {
  /** The document's `DocId`, or its path when the host indexes no document there. */
  readonly docId: string;
  /** The document's project path now; a relabelable attribute, as in the content store. */
  readonly path: string;
  /** The URL the document's relative references resolve against: its own URL under the project. */
  readonly base: string;
  /** The document, parsed by the shell from the bytes the content store holds. */
  readonly document: JxDocument;
}

/** Draw a page, a layout or a content document as the file holds it. */
export interface RenderDocumentRequest {
  readonly kind: "document";
  readonly id: number;
  readonly target: RealmDocument;
  /** How the document's media resolve (`canvas/asset-resolve.ts`), or null when nothing needs to. */
  readonly assets: AssetContext | null;
}

/**
 * Draw one instance of a project component, given its sample props, after checking that its
 * definition renders with them; a definition that does not is answered `failed`.
 */
export interface RenderInstanceRequest {
  readonly kind: "instance";
  readonly id: number;
  readonly target: RealmDocument;
  /** Set as the instance's own properties before it connects. */
  readonly props: Readonly<Record<string, JsonValue>>;
  /** Attribute defaults the registry lists for the component, set before the props. */
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * Draw an element a package defines, if the realm has it; otherwise a box that names its tag. The
 * realm never imports a package to answer this.
 */
export interface RenderPackageRequest {
  readonly kind: "package";
  readonly id: number;
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * Ask whether a definition renders given `props`, without drawing an instance: answered `trialed`
 * when it does, `failed` with the reason when it does not.
 */
export interface TrialRequest {
  readonly kind: "trial";
  readonly id: number;
  readonly target: RealmDocument;
  readonly props: Readonly<Record<string, JsonValue>>;
}

/** Every message the shell sends the realm. */
export type ToRealm =
  | RenderDocumentRequest
  | RenderInstanceRequest
  | RenderPackageRequest
  | TrialRequest;

/** A request as the shell's caller writes it; the host numbers it. */
export type RealmRequest =
  | Omit<RenderDocumentRequest, "id">
  | Omit<RenderInstanceRequest, "id">
  | Omit<RenderPackageRequest, "id">
  | Omit<TrialRequest, "id">;

/**
 * What the realm drew: its markup, shadow roots included as declarative shadow DOM, and the text of
 * every rule the runtime wrote for it into the realm's document.
 */
export interface RealmSnapshot {
  readonly html: string;
  readonly css: string;
}

/** The realm's answers. Each names the request it answers, and the tags the realm defines now. */
export type FromRealm =
  | { readonly kind: "ready" }
  | {
      readonly kind: "rendered";
      readonly id: number;
      readonly snapshot: RealmSnapshot;
      readonly tags: readonly string[];
    }
  | { readonly kind: "trialed"; readonly id: number; readonly tags: readonly string[] }
  | {
      readonly kind: "failed";
      readonly id: number;
      readonly message: string;
      readonly tags: readonly string[];
    };

/** An answer to one request: everything but `ready`. */
export type RealmReply = Exclude<FromRealm, { kind: "ready" }>;
