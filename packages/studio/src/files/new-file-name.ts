/**
 * The rules a new file's name is held to, with no dialog and no write attached.
 *
 * `createFileIn` (`files/files.ts`) used to keep these inside one closure over its prompt, which
 * was right while the prompt was the only creation flow there was. Add new (`create/add-new.ts`,
 * `specs/studio.md` §9.1.1) composes a name the same way and must refuse the same things — a blank
 * name, a name that escapes the destination, a name that is already taken — and a second copy of
 * those rules would disagree with the first the first time either was fixed. So the composing and
 * the judging live here, DOM-free, and both flows call them; only the write, and what each flow
 * does around it, differs.
 *
 * Nothing here lists a directory. The caller supplies the `taken` names it listed, because when
 * that listing happens is the caller's concern: before the prompt opens for New File, and once per
 * destination directory for Add new, whose destination moves as the reader types.
 *
 * @docs studio/interface
 */

/**
 * The picker row meaning "I will type the whole name myself".
 *
 * It is what keeps the format picker from being a cage. `New File…` is the only generic
 * file-creation affordance in Studio and both backends create intermediate directories on write, so
 * without this row `styles/main.css`, `public/robots.txt`, `.gitignore` and a `credits.txt` beside
 * a collection's images all become uncreatable — and the picker would have taken away more than it
 * gave. The picker stays the authority on the extension; this is one of its answers.
 */
export const OTHER_FORMAT = "__other__";

/** How the extension of a new file is settled. */
export type FormatChoice =
  /** Picker over every creatable format, plus Other…. The field is a NAME, taken verbatim. */
  | { kind: "choose"; defaultExt?: string; docKind?: "page" | "component" | "content" }
  /**
   * Picker holding ONE format, plus Other… — the collection's own extension. The field is a NAME.
   * `because` is the sentence a refusal quotes when Other… would smuggle a foreign document in.
   */
  | { kind: "locked"; ext: string; because: string }
  /** No picker. The field is a DISPLAY NAME, slugified, and `ext` is appended. */
  | { kind: "fixed"; ext: string };

/** A display name, reduced to a file stem. Lowercase by design: this is a slug. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-z\d-]/g, "");
}

/** The extension of a file name, including the dot, or `""`. */
export function extensionOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/**
 * The file name a field value and a pick compose to — three modes, not two.
 *
 * The verbatim STEM mode is not a convenience. The slugifier lowercases and strips everything
 * outside `[a-z0-9-]`, which turns `[slug]` into `slug` — and eight shipped starters carry
 * `pages/[slug].json`, `[sku].json`, `[...slug].json`. A picker that slugified would make a dynamic
 * route uncreatable and would say nothing about it.
 *
 * @param input What the reader typed.
 * @param picked The picker's value: an extension, {@link OTHER_FORMAT}, or `""` with no picker.
 * @param choice How the extension is settled; absent takes the whole name verbatim.
 */
export function composeNewFileName(input: string, picked: string, choice?: FormatChoice): string {
  const trimmed = input.trim();
  if (choice === undefined || picked === OTHER_FORMAT) {
    return trimmed;
  }
  if (choice.kind === "fixed") {
    const slug = slugify(trimmed);
    return slug === "" ? "" : `${slug}${choice.ext}`;
  }
  return trimmed.toLowerCase().endsWith(picked.toLowerCase()) ? trimmed : `${trimmed}${picked}`;
}

/** What a name is judged against: where it is going, and what is already there. */
export interface NewFileNameCheck {
  /** Destination directory, project-relative. `"."` is the project root. */
  dir: string;
  choice?: FormatChoice | undefined;
  /** The destination's entries, LOWER-CASED: APFS and NTFS compare without case, and so does this. */
  taken: ReadonlySet<string>;
  /** Extensions that are documents, lower-cased (`knownDocumentExtensions()`). */
  known?: ReadonlySet<string>;
  /** The picker's rows, for naming a pick in a refusal. */
  rows?: readonly { label: string; value: string }[] | null;
}

/**
 * The refusal a name earns, or `""` when it is usable.
 *
 * In order: blank, a display name that slugifies to nothing, a path that starts or ends with a
 * slash, a `..` segment, a subfolder where the field is a name rather than a whole file name, an
 * extension that contradicts the pick, a document smuggled through Other… past a collection's lock,
 * and finally a name already taken in the destination. The first that applies is the sentence.
 *
 * @param value What the reader typed.
 * @param picked The picker's value, as {@link composeNewFileName} takes it.
 * @param check The destination and what it already holds.
 */
export function validateNewFileName(
  value: string,
  picked: string,
  check: NewFileNameCheck,
): string {
  const { choice, dir, known = new Set<string>(), rows = null, taken } = check;
  const trimmed = value.trim();
  if (!trimmed) {
    return choice?.kind === "fixed" ? "Enter a name." : "Enter a file name.";
  }
  if (choice?.kind === "fixed" && slugify(trimmed) === "") {
    return "Enter at least one letter or number.";
  }
  const normalized = trimmed.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.endsWith("/")) {
    return "Enter a name, not a path that starts or ends with a slash.";
  }
  if (normalized.split("/").includes("..")) {
    return "A name cannot step outside the destination folder.";
  }
  // A slash is the tree's ONLY way to make a directory — both backends create them on write — so
  // It is allowed exactly where the field is a whole file name, and refused where it is a name.
  if (normalized.includes("/") && choice !== undefined && picked !== OTHER_FORMAT) {
    return `Pick Other… to create a file in a subfolder of ${dir === "." ? "the project root" : dir}.`;
  }
  /* A name whose extension MATCHES the pick is fine and is composed once, never doubled;
     refusing every trailing extension would reject this dialog's own `untitled.json` default.
     A name ending in an extension no format claims is a stem that happens to have a dot. */
  const typedExt = extensionOfName(normalized);
  if (
    picked !== "" &&
    picked !== OTHER_FORMAT &&
    typedExt !== "" &&
    typedExt.toLowerCase() !== picked.toLowerCase() &&
    known.has(typedExt.toLowerCase())
  ) {
    const label = rows?.find((row) => row.value === picked)?.label ?? picked;
    return `You picked ${label}; this name ends in ${typedExt}.`;
  }
  if (choice?.kind === "locked" && picked === OTHER_FORMAT) {
    const foreign = typedExt !== "" && typedExt.toLowerCase() !== choice.ext.toLowerCase();
    if (foreign && known.has(typedExt.toLowerCase())) {
      return choice.because;
    }
  }
  /* No emptiness check here: every way `composeNewFileName` can answer "" is already refused
     above — a blank field by the first rule, a display name that slugifies to nothing by the
     second. */
  const candidate = composeNewFileName(value, picked, choice);
  return taken.has(candidate.toLowerCase()) ? `${candidate} already exists in ${dir}/.` : "";
}
