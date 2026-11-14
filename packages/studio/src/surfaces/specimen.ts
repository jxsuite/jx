/**
 * The surface specimen contract (studio.md §4.6, studio-ui-guidelines.md §9.4).
 *
 * A surface document projects a host scope: `#/state/rows`, `#/state/run`, a record per field. In
 * the shell its adapter builds that scope from the registry, the workspace and the open project. On
 * the canvas there is no adapter, so a surface opened as a document had nothing to read and drew as
 * a skeleton. A specimen is the fixture that stands in for the adapter there: a module beside the
 * surface, `<name>.specimen.ts`, whose scope is typed against the adapter's own scope interface, so
 * a member the adapter renames or retypes fails the typecheck here.
 *
 * A specimen is DATA and plain functions. It imports the adapter's types and nothing of the shell
 * (`scripts/check-surface-purity.ts`), because its chunk is loaded by the canvas frame, where no
 * shell exists.
 *
 * @docs extending/ui-kit
 */
import type { JxHostScope, JxScope } from "@jxsuite/runtime/types";

/** What a specimen module declares, typed against its adapter's scope `S`. */
export interface SpecimenSource<S> {
  /** A fresh host scope per render. Reactive, so a function that writes it redraws the surface. */
  scope: () => S;
  /** Other states of the same surface, by name. `default` is {@link scope} and may not be a key. */
  variants?: Readonly<Record<string, () => S>>;
  /**
   * Reach every function the scope offers through the rendered surface: press the button, type in
   * the field. The suite mounts the surface as the shell does and holds each function to a call,
   * which is what proves a handler in the document names something the scope supplies.
   */
  drive?: (root: HTMLElement, scope: S) => void | Promise<void>;
}

/** One scope a specimen made, and the gesture run that exercises it. */
export interface SpecimenInstance {
  /** The host scope, as the runtime merges it. */
  scope: JxScope;
  /** Run the specimen's `drive` over a surface mounted with {@link scope}. */
  drive: (root: HTMLElement) => Promise<void>;
}

/** A specimen as the canvas frame and the suite read it: its variant names and a scope factory. */
export interface SurfaceSpecimen {
  /** The declared variant names, in declaration order. Never holds `default`. */
  variants: readonly string[];
  /** Make the scope of a variant; null, `default` or an undeclared name makes the default scope. */
  make: (variant?: string | null) => SpecimenInstance;
}

/**
 * A host's record as the scope the runtime merges it into.
 *
 * @param {S} scope - The specimen's scope, held to scope values member by member by its type
 * @returns {JxScope}
 */
function hostScope<S extends JxHostScope<S>>(scope: S): JxScope {
  /* SAFETY: `JxHostScope<S>` holds every member of `S` to `JxScopeValue`, recursively. What it
     cannot give an interface is an index signature, so the record is not assignable to `JxScope`
     however its members are typed. Nothing is copied: this is the record, read by member name, the
     same widening the runtime's own `mount()` performs on a host's scope. */
  return scope as JxScope;
}

/**
 * Declare a surface's specimen.
 *
 * @param {SpecimenSource<S>} source - The scope factory, its variants and its gesture run
 * @returns {SurfaceSpecimen}
 */
export function defineSpecimen<S extends JxHostScope<S>>(
  source: SpecimenSource<S>,
): SurfaceSpecimen {
  const variants = source.variants ?? {};
  return {
    make: (variant = null) => {
      const made = (variant === null ? undefined : variants[variant]) ?? source.scope;
      const scope = made();
      return {
        drive: async (root) => {
          await source.drive?.(root, scope);
        },
        scope: hostScope(scope),
      };
    },
    variants: Object.keys(variants),
  };
}
