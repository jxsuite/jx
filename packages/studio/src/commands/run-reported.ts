/**
 * Run-reported.ts — run a command from a surface, and let a refusal land in Problems.
 *
 * `registry.run` refuses in two shapes, and a caller that catches one and not the other still lets
 * a refusal out. It throws SYNCHRONOUSLY — `CommandUnavailableError` when the gate refuses, a
 * `RangeError` when `coerceArgs` refuses the received record BEFORE `run` is entered, and whatever
 * a synchronous `run` body throws — and it REJECTS when an async `run` body does. A bare `void
 * registry.run(id, args)` lets the first shape out of the click, keydown or notice action it came
 * from, and a `.catch` on the promise alone catches nothing when `run` has already thrown; a
 * `Promise.resolve(registry.run(...))` around it is the same mistake with more characters, because
 * the argument is evaluated first. Three surfaces had grown the same six-line try/catch in reply
 * (the palette's `runCommand`, the Settings menu's `runRow` and the Languages panel's `runByName`)
 * while ten others still ran bare, which is the drift issue 333 names: a refusal reached Problems
 * or the console depending on which surface the person happened to be on.
 *
 * This is the one spelling. It catches both shapes, files the sentence in Problems — the tier
 * `notify.error` chooses, and the right one: a refusal names something the person has to fix or a
 * schema that drifted from its caller, and neither is a toast that may be taken away — and returns
 * a promise that never rejects, so a caller may `void` it or `await` it without a `.catch`.
 *
 * A refusal is the whole message; a CRASH is not. `CommandUnavailableError` and `RangeError` are
 * the two shapes the registry and `coerceArgs` refuse with, and each is a sentence written to be
 * read, so the Problems row is complete. Anything else out of a `run` body — a `TypeError` on a
 * node that was not there — is a bug, and its stack is the part that matters; the row still names
 * it, and the error object also goes to the console, where the palette used to send everything and
 * where a trace can be opened. Without that the helper would have made every surface quieter than
 * the keydown listener it replaced, which reached `window.onerror`.
 *
 * Two spellings, one rule. {@link runReported} takes the registry as a PARAMETER: `editor/
 * shortcuts.ts`, the block action bar and the registry's own `handleKeyEvent` are handed theirs,
 * and a helper that resolved the active registry for them would silently do nothing wherever a
 * test, or a second window kind, ran a registry that is not the published one.
 * {@link runActiveReported} is the same call for a surface that was spelled `void
 * activeRegistry()?.run(id, args)` — a footer row, a palette hit, a tab-strip chip — and it keeps
 * that spelling's one property: before the bootstrap has published a registry there is nothing to
 * run and nothing to report, exactly as the `?.` was silent.
 *
 * The sweep in `tests/run-reported.test.ts` walks `packages/studio/src` for any other `.run(` on a
 * registry. Two callers own their refusal and are named there as such — `services/automation.ts`
 * and `services/ai-command-tools.ts`, where the script or the model is the one who reads it — and
 * the `?.run(` spelling issue 333 did not list survives in a RATCHET of files the sweep names one
 * by one, each still holding a bare call; the list can only shrink, so a new surface cannot spell
 * it bare and an existing one converted must drop its entry.
 *
 * `runReported` does not pre-check `isEnabled`. A surface that renders a disabled control for a
 * refused record has already shown the `requires` sentence, and a click that arrives on one anyway
 * (state moved between the render and the click) is a refusal the person should read, not a
 * swallowed no-op. The callers that DO pre-check keep doing so for their own reasons — a chord on a
 * disabled command is claimed silently by `handleKeyEvent`, by design — and route what remains
 * through here.
 *
 * @docs studio/interface/problems-and-progress
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { notify } from "../services/notify";
import { activeRegistry } from "./active-registry";
import type { CommandArgs, CommandRegistry } from "./registry";

/**
 * Whether an error is one of the two REFUSAL shapes, whose message is written to be read whole.
 *
 * By name rather than `instanceof CommandUnavailableError`: `registry.ts` imports this module for
 * `handleKeyEvent`, and a value import back would close a cycle for one class whose constructor
 * sets exactly this name. `RangeError` is the shape `coerceArgs` and a `run` body refuse with.
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof RangeError ||
    (error instanceof Error && error.name === "CommandUnavailableError")
  );
}

/**
 * Run `id` with `args` on `registry`, and file whatever refuses it in Problems under `source`.
 *
 * `source` is the SURFACE the run came from ("Palette", "Keyboard", "Languages"), the column the
 * Problems panel groups by; it defaults to the command id, which is what the Settings menu filed
 * under before this helper existed and is still a true answer to "who reported it". The Problems
 * row is keyed by the command id, so a chord held down on a refusing record is one problem rather
 * than sixty — the file-watcher rule `services/notify.ts` writes down for `key`.
 *
 * The returned promise settles when the command does, and never rejects: an `await` on it is a
 * wait, not a second place the refusal could escape from.
 */
export function runReported(
  registry: CommandRegistry,
  id: string,
  args?: CommandArgs,
  source: string = id,
): Promise<void> {
  const report = (error: unknown) => {
    if (!isRefusal(error)) {
      // A crash, not a refusal: the row below carries the sentence, the console keeps the stack.
      console.error(`${source}: command "${id}" failed`, error);
    }
    notify.error(errorMessage(error), { key: `command.run:${id}`, source });
  };
  let result: void | Promise<void>;
  try {
    result = registry.run(id, args);
  } catch (error) {
    report(error);
    return Promise.resolve();
  }
  return Promise.resolve(result).catch(report);
}

/**
 * {@link runReported} on this window's registry, or nothing before the bootstrap has published one.
 *
 * The `?.` this replaces was the surfaces' answer to `active-registry.ts` returning `null` for the
 * frame before the bootstrap composes the registry; a click that lands in that frame has no
 * registry to refuse it, so there is no refusal to file. The resolved promise keeps the caller's
 * `void` honest either way.
 */
export function runActiveReported(id: string, args?: CommandArgs, source?: string): Promise<void> {
  const registry = activeRegistry();
  return registry ? runReported(registry, id, args, source) : Promise.resolve();
}
