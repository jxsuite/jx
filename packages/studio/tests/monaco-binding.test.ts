/**
 * The first-party Monaco↔Y.Text binding (`src/collab/monaco-binding.ts`).
 *
 * Yjs is REAL here — a real `Y.Doc`, a real `Y.Text`, real `RelativePosition`s — because every
 * interesting property of this module is a property of Yjs's own semantics: that a delta applies at
 * the right offsets, that a caret anchored before a remote insert moves with it, that a position
 * minted by one client resolves in another's document. Monaco is the half that is doubled, and it
 * can be, because the binding touches no Monaco VALUE: it feeds `IRange` / `ISelection` object
 * literals to interfaces, so a structural model and editor exercise the real code path rather than
 * a stub of it.
 *
 * The doubles are deliberately un-lenient: `applyEdits` and `setValue` fire `onDidChangeContent`
 * SYNCHRONOUSLY, exactly as Monaco does, which is what makes the re-entrancy guard testable at all.
 * A double that swallowed those events would let a binding with no guard pass every test here.
 */
import "./with-dom.js";
import { describe, expect, mock, test } from "bun:test";
import type { Mock } from "bun:test";
import {
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromTypeIndex,
  sourceText,
  YDoc,
} from "@jxsuite/collab";
import type { JsonValue } from "@jxsuite/schema/types";
import type * as Y from "yjs";
import type { editor } from "monaco-editor";
import { bindMonacoToYText } from "../src/collab/monaco-binding";
import type {
  BindingAwareness,
  MonacoYTextBindingOptions,
  RelativeSelection,
} from "../src/collab/monaco-binding";

// ─── Monaco doubles ───────────────────────────────────────────────────────────

interface RangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** 1-based (line, column) → 0-based character offset, counting the newline in each line. */
function offsetOf(value: string, lineNumber: number, column: number): number {
  const lines = value.split("\n");
  let offset = 0;
  for (let i = 0; i < lineNumber - 1; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset + column - 1;
}

/** The inverse. */
function positionOf(value: string, offset: number): PositionLike {
  const before = value.slice(0, offset);
  const lines = before.split("\n");
  return { column: (lines.at(-1)?.length ?? 0) + 1, lineNumber: lines.length };
}

/** A 1-based caret position, as Monaco's `IPosition` spells it. */
interface PositionLike {
  lineNumber: number;
  column: number;
}

/** One entry of a content event's `changes`, as Monaco's `IModelContentChange` spells it. */
interface ContentChange {
  range: RangeLike;
  rangeLength: number;
  rangeOffset: number;
  text: string;
}

/** A Monaco listener registration. */
interface Subscription {
  dispose: () => void;
}

/**
 * The `ITextModel` members the binding reaches, spelled so that a real `ITextModel` is assignable
 * to this interface (`applyEdits` is the one overload the binding calls). That direction is what
 * lets {@link asTextModel} hand a double over with a single assertion.
 */
interface ModelSurface {
  getValue: () => string;
  setValue: (next: string) => void;
  applyEdits: (ops: { range: RangeLike; text: string | null }[]) => void;
  getOffsetAt: (position: PositionLike) => number;
  getPositionAt: (offset: number) => PositionLike;
  onDidChangeContent: (cb: (event: { changes: ContentChange[] }) => void) => Subscription;
  onWillDispose: (cb: () => void) => Subscription;
}

interface FakeModel extends ModelSurface {
  /** Drives the Monaco-side disposal path. */
  dispose: () => void;
  /** Test observability: how many listeners are still attached. */
  listenerCount: () => number;
}

/** Hand a model double to the binding, which is typed against the full `ITextModel`. */
function asTextModel(model: ModelSurface): editor.ITextModel {
  /* SAFETY: bindMonacoToYText touches the model only through the ModelSurface members (getValue,
     setValue, applyEdits, getOffsetAt, getPositionAt, onDidChangeContent, onWillDispose) and
     compares it by identity; the double implements each with Monaco's runtime behaviour, synchronous
     content events included, so no other ITextModel member is ever read. */
  return model as editor.ITextModel;
}

function createModel(initial = ""): FakeModel {
  let value = initial;
  const content: ((event: { changes: ContentChange[] }) => void)[] = [];
  const willDispose: (() => void)[] = [];
  const fire = (changes: ContentChange[]): void => {
    // A copy: a listener disposing itself mid-fire is exactly what teardown does.
    const listening = [...content];
    for (const cb of listening) {
      cb({ changes });
    }
  };
  const drop =
    <T>(list: T[], item: T) =>
    () => {
      const index = list.indexOf(item);
      if (index !== -1) {
        list.splice(index, 1);
      }
    };
  return {
    applyEdits(ops) {
      const changes: ContentChange[] = [];
      for (const op of ops) {
        const start = offsetOf(value, op.range.startLineNumber, op.range.startColumn);
        const end = offsetOf(value, op.range.endLineNumber, op.range.endColumn);
        changes.push({
          range: op.range,
          rangeLength: end - start,
          rangeOffset: start,
          text: op.text ?? "",
        });
        value = value.slice(0, start) + (op.text ?? "") + value.slice(end);
      }
      fire(changes);
    },
    dispose() {
      const pending = [...willDispose];
      for (const cb of pending) {
        cb();
      }
    },
    getOffsetAt: (position) => offsetOf(value, position.lineNumber, position.column),
    getPositionAt: (offset) => positionOf(value, offset),
    getValue: () => value,
    listenerCount: () => content.length + willDispose.length,
    onDidChangeContent(cb) {
      content.push(cb);
      return { dispose: drop(content, cb) };
    },
    onWillDispose(cb) {
      willDispose.push(cb);
      return { dispose: drop(willDispose, cb) };
    },
    setValue(next) {
      const previous = value;
      value = next;
      fire([
        {
          range: { endColumn: 1, endLineNumber: 1, startColumn: 1, startLineNumber: 1 },
          rangeLength: previous.length,
          rangeOffset: 0,
          text: next,
        },
      ]);
    },
  };
}

interface SelectionLike {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}

/** The `IEditorDecorationsCollection` members the binding reaches. */
interface DecorationsSurface {
  set: (decorations: readonly editor.IModelDeltaDecoration[]) => string[];
  clear: () => void;
}

interface FakeDecorations extends DecorationsSurface {
  current: readonly editor.IModelDeltaDecoration[];
  cleared: number;
}

/**
 * The `ICodeEditor` members the binding reaches, spelled so that a real `ICodeEditor` is assignable
 * to this interface. That direction is what lets {@link asCodeEditor} use a single assertion.
 */
interface EditorSurface {
  getModel: () => ModelSurface | null;
  getSelection: () => SelectionLike | null;
  setSelection: (selection: SelectionLike) => void;
  createDecorationsCollection: () => DecorationsSurface;
  onDidChangeCursorSelection: (cb: () => void) => Subscription;
}

interface FakeEditor extends EditorSurface {
  getModel: () => FakeModel | null;
  createDecorationsCollection: () => FakeDecorations;
  /** Test controls. */
  _model: FakeModel | null;
  _selection: SelectionLike | null;
  _applied: SelectionLike[];
  _decorations: FakeDecorations[];
  _cursorListeners: (() => void)[];
  _moveCursor: (selection: SelectionLike | null) => void;
  _collection: () => FakeDecorations | undefined;
}

/** Hand an editor double to the binding, which is typed against the full `ICodeEditor`. */
function asCodeEditor(editorDouble: EditorSurface): editor.ICodeEditor {
  /* SAFETY: bindMonacoToYText touches an editor only through the EditorSurface members (getModel,
     getSelection, setSelection, createDecorationsCollection, onDidChangeCursorSelection) and keys
     its maps on the editor's identity; the double implements each, so no other ICodeEditor member
     is ever read. */
  return editorDouble as editor.ICodeEditor;
}

function createEditor(model: FakeModel | null): FakeEditor {
  const editorDouble: FakeEditor = {
    _applied: [],
    _collection: () => editorDouble._decorations.at(-1),
    _cursorListeners: [],
    _decorations: [],
    _model: model,
    _moveCursor(selection) {
      editorDouble._selection = selection;
      const listening = [...editorDouble._cursorListeners];
      for (const cb of listening) {
        cb();
      }
    },
    _selection: null,
    createDecorationsCollection() {
      const collection: FakeDecorations = {
        clear() {
          collection.current = [];
          collection.cleared += 1;
        },
        cleared: 0,
        current: [],
        set(decorations) {
          collection.current = decorations;
          return decorations.map((_, i) => `d${i}`);
        },
      };
      editorDouble._decorations.push(collection);
      return collection;
    },
    getModel: () => editorDouble._model,
    getSelection: () => editorDouble._selection,
    onDidChangeCursorSelection(cb) {
      editorDouble._cursorListeners.push(cb);
      return {
        dispose: () => {
          const index = editorDouble._cursorListeners.indexOf(cb);
          if (index !== -1) {
            editorDouble._cursorListeners.splice(index, 1);
          }
        },
      };
    },
    setSelection(selection) {
      editorDouble._applied.push(selection);
      editorDouble._selection = selection;
    },
  };
  return editorDouble;
}

/** A caret with no extent, at a character offset in `value`. */
function caretAt(value: string, offset: number): SelectionLike {
  const { column, lineNumber } = positionOf(value, offset);
  return {
    positionColumn: column,
    positionLineNumber: lineNumber,
    selectionStartColumn: column,
    selectionStartLineNumber: lineNumber,
  };
}

/** A selection running from `anchor` to `head`, in that order — RTL when head < anchor. */
function spanFrom(value: string, anchor: number, head: number): SelectionLike {
  const a = positionOf(value, anchor);
  const h = positionOf(value, head);
  return {
    positionColumn: h.column,
    positionLineNumber: h.lineNumber,
    selectionStartColumn: a.column,
    selectionStartLineNumber: a.lineNumber,
  };
}

// ─── Awareness double ─────────────────────────────────────────────────────────

/** This client's published state: the binding owns exactly the `selection` field of it. */
interface PublishedState {
  selection?: RelativeSelection | null;
}

interface FakeAwareness extends BindingAwareness {
  local: PublishedState;
  states: Map<number, unknown>;
  emit: () => void;
  listenerCount: () => number;
  setLocalStateField: Mock<BindingAwareness["setLocalStateField"]>;
}

function createAwareness(clientID = 1): FakeAwareness {
  const states = new Map<number, unknown>();
  const listeners: (() => void)[] = [];
  const local: PublishedState = {};
  const awareness: FakeAwareness = {
    clientID,
    emit: () => {
      const listening = [...listeners];
      for (const cb of listening) {
        cb();
      }
    },
    getStates: () => states,
    listenerCount: () => listeners.length,
    local,
    off: (_event, cb) => {
      const index = listeners.indexOf(cb);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    },
    on: (_event, cb) => listeners.push(cb),
    setLocalStateField: mock((field: "selection", value: RelativeSelection | null) => {
      local[field] = value;
      states.set(clientID, { ...local });
    }),
    states,
  };
  return awareness;
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Bound {
  doc: InstanceType<typeof YDoc>;
  text: Y.Text;
  model: FakeModel;
  editorDouble: FakeEditor;
  awareness: FakeAwareness;
  unbind: () => void;
}

function bind(
  options: { seed?: string; modelValue?: string; withAwareness?: boolean; origin?: unknown } = {},
): Bound {
  const doc = new YDoc();
  const text = sourceText(doc);
  if (options.seed) {
    doc.transact(() => text.insert(0, options.seed!));
  }
  const model = createModel(options.modelValue ?? "");
  const editorDouble = createEditor(model);
  const awareness = createAwareness();
  const bindingOptions: MonacoYTextBindingOptions = {
    editors: [asCodeEditor(editorDouble)],
    model: asTextModel(model),
    origin: options.origin,
    text,
  };
  if (options.withAwareness !== false) {
    bindingOptions.awareness = awareness;
  }
  const unbind = bindMonacoToYText(bindingOptions);
  return { awareness, doc, editorDouble, model, text, unbind };
}

// ─── Outbound: the author typed ───────────────────────────────────────────────

describe("Monaco → Y.Text", () => {
  test("an insert reaches the shared text", () => {
    const { model, text, unbind } = bind();
    model.applyEdits([
      {
        range: { endColumn: 1, endLineNumber: 1, startColumn: 1, startLineNumber: 1 },
        text: "abc",
      },
    ]);
    expect(text.toString()).toBe("abc");
    unbind();
  });

  test("a delete and a replace reach it too", () => {
    const { model, text, unbind } = bind({ modelValue: "hello world", seed: "hello world" });
    // Delete " world".
    model.applyEdits([
      {
        range: { endColumn: 12, endLineNumber: 1, startColumn: 6, startLineNumber: 1 },
        text: null,
      },
    ]);
    expect(text.toString()).toBe("hello");
    // Replace "hello" with "bye".
    model.applyEdits([
      {
        range: { endColumn: 6, endLineNumber: 1, startColumn: 1, startLineNumber: 1 },
        text: "bye",
      },
    ]);
    expect(text.toString()).toBe("bye");
    unbind();
  });

  /**
   * The multi-change case, and the reason the binding sorts.
   *
   * Every `rangeOffset` in one content event indexes the PRE-edit text (Monaco says so on
   * `IModelContentChangedEvent`), so applying them left-to-right shifts every offset after the
   * first. A multi-cursor edit is the ordinary way to produce one.
   */
  test("a multi-cursor edit applies right-to-left and lands character-exact", () => {
    const { model, text, unbind } = bind({ modelValue: "a b c", seed: "a b c" });
    model.applyEdits([
      // Deliberately given in ASCENDING offset order — the binding is what re-orders them.
      { range: { endColumn: 2, endLineNumber: 1, startColumn: 1, startLineNumber: 1 }, text: "A" },
      { range: { endColumn: 4, endLineNumber: 1, startColumn: 3, startLineNumber: 1 }, text: "B" },
      { range: { endColumn: 6, endLineNumber: 1, startColumn: 5, startLineNumber: 1 }, text: "C" },
    ]);
    expect(model.getValue()).toBe("A B C");
    expect(text.toString()).toBe("A B C");
    unbind();
  });

  test("local edits transact under the origin the caller named", () => {
    const origin = Symbol("local");
    const seen: unknown[] = [];
    const { doc, model, unbind } = bind({ origin });
    doc.on("afterTransaction", (transaction: { origin: unknown }) => seen.push(transaction.origin));
    model.applyEdits([
      { range: { endColumn: 1, endLineNumber: 1, startColumn: 1, startLineNumber: 1 }, text: "x" },
    ]);
    expect(seen).toContain(origin);
    unbind();
  });
});

// ─── Inbound: a peer typed ────────────────────────────────────────────────────

describe("Y.Text → Monaco", () => {
  test("a remote insert reaches the model", () => {
    const { model, text, unbind } = bind();
    text.insert(0, "hello");
    expect(model.getValue()).toBe("hello");
    unbind();
  });

  test("a remote delete reaches the model", () => {
    const { model, text, unbind } = bind({ modelValue: "hello world", seed: "hello world" });
    text.delete(5, 6);
    expect(model.getValue()).toBe("hello");
    unbind();
  });

  /** One transaction, several ops — the delta is walked with a running index. */
  test("a multi-op delta applies as one sequence", () => {
    const { doc, model, text, unbind } = bind({
      modelValue: "one two three",
      seed: "one two three",
    });
    doc.transact(() => {
      text.delete(0, 3);
      text.insert(0, "ONE");
      text.insert(7, "!");
    });
    const value = model.getValue();
    expect(value).toBe(text.toString());
    expect(value).toBe("ONE two! three");
    unbind();
  });

  test("a multi-line document keeps its offsets", () => {
    const seed = "alpha\nbeta\ngamma";
    const { model, text, unbind } = bind({ modelValue: seed, seed });
    text.insert(seed.indexOf("beta"), "the ");
    const value = model.getValue();
    expect(value).toBe("alpha\nthe beta\ngamma");
    expect(value).toBe(text.toString());
    unbind();
  });

  /**
   * THE GUARD, which is the whole reason this module is not four lines long.
   *
   * `model.applyEdits` fires `onDidChangeContent` synchronously, so without the re-entrancy guard
   * the remote insert below would be written straight back into the Y.Text as if the local author
   * had typed it — doubling it, and publishing the duplicate to the room.
   */
  test("applying a remote delta does not echo back into the shared text", () => {
    const origin = Symbol("local");
    const { doc, model, text, unbind } = bind({ origin });
    const origins: unknown[] = [];
    /* Counting transactions would not work and the reason is worth knowing: `YTextEvent.delta` is a
       lazy getter that computes itself inside `transact()`, so merely READING the delta opens an
       empty transaction. What "did not echo" means is that nothing was written back under the LOCAL
       origin, and that the text did not double. */
    doc.on(
      "afterTransaction",
      (transaction: { origin: unknown; changed: Map<unknown, unknown> }) => {
        if (transaction.changed.size > 0) {
          origins.push(transaction.origin);
        }
      },
    );
    text.insert(0, "hi");
    expect(model.getValue()).toBe("hi");
    expect(text.toString()).toBe("hi");
    expect(origins).not.toContain(origin);
    unbind();
  });

  test("a non-string insert throws a named error rather than stringifying an embed", () => {
    const { text, unbind } = bind();
    expect(() => text.insertEmbed(0, { image: "x.png" })).toThrow(
      /a text buffer can only apply string inserts/,
    );
    unbind();
  });
});

// ─── Two clients ──────────────────────────────────────────────────────────────

describe("convergence", () => {
  test("two bindings over one shared text converge", () => {
    const doc = new YDoc();
    const text = sourceText(doc);
    const modelA = createModel();
    const modelB = createModel();
    const editorA = createEditor(modelA);
    const editorB = createEditor(modelB);
    const unbindA = bindMonacoToYText({
      editors: [asCodeEditor(editorA)],
      model: asTextModel(modelA),
      text,
    });
    const unbindB = bindMonacoToYText({
      editors: [asCodeEditor(editorB)],
      model: asTextModel(modelB),
      text,
    });

    modelA.applyEdits([
      {
        range: { endColumn: 1, endLineNumber: 1, startColumn: 1, startLineNumber: 1 },
        text: "from A",
      },
    ]);
    expect(modelB.getValue()).toBe("from A");
    expect(text.toString()).toBe("from A");

    modelB.applyEdits([
      {
        range: { endColumn: 7, endLineNumber: 1, startColumn: 7, startLineNumber: 1 },
        text: " and B",
      },
    ]);
    expect(modelA.getValue()).toBe("from A and B");
    expect(text.toString()).toBe("from A and B");

    unbindA();
    unbindB();
  });
});

// ─── Initial sync ─────────────────────────────────────────────────────────────

describe("initial sync", () => {
  test("seeds the model from the shared text and does not publish the seed", () => {
    const doc = new YDoc();
    const text = sourceText(doc);
    doc.transact(() => text.insert(0, "already here"));
    const model = createModel("");
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });
    const unbind = bindMonacoToYText({
      model: asTextModel(model),
      text,
    });
    expect(model.getValue()).toBe("already here");
    // The seed goes model-ward only: registering the change handler AFTER `setValue` is what stops
    // The whole document being republished as if the author had typed it.
    expect(transactions).toBe(0);
    unbind();
  });

  test("leaves a model that already agrees untouched", () => {
    const { model, unbind } = bind({ modelValue: "same", seed: "same" });
    expect(model.getValue()).toBe("same");
    unbind();
  });

  test("a Y.Text with no document is refused with a real message", () => {
    const detached = new YDoc().getText("orphan");
    // A type read off a doc is always attached, so construct the detached case directly.
    /* SAFETY: an object on Y.Text's own prototype carries every Y.Text method; its `doc` is set to
       null on the next line, and that field is all bindMonacoToYText reads before it refuses. */
    const orphan = Object.create(Object.getPrototypeOf(detached)) as Y.Text;
    Object.assign(orphan, { doc: null });
    expect(() =>
      bindMonacoToYText({
        model: asTextModel(createModel()),
        text: orphan,
      }),
    ).toThrow(/has no Y.Doc/);
  });
});

// ─── Selections ───────────────────────────────────────────────────────────────

describe("caret preservation", () => {
  test("a caret survives a remote insert before it", () => {
    const seed = "hello world";
    const { editorDouble, model, text, unbind } = bind({ modelValue: seed, seed });
    // Caret between "hello" and " world".
    editorDouble._selection = caretAt(seed, 5);
    text.insert(0, ">> ");
    expect(model.getValue()).toBe(">> hello world");
    // It moved with the text: offset 5 → offset 8.
    const restored = editorDouble._applied.at(-1)!;
    expect(
      model.getOffsetAt({
        column: restored.positionColumn,
        lineNumber: restored.positionLineNumber,
      }),
    ).toBe(8);
    unbind();
  });

  test("an RTL selection keeps its direction — the head stays the head", () => {
    const seed = "abcdefgh";
    const { editorDouble, model, text, unbind } = bind({ modelValue: seed, seed });
    // Anchor at 6, head at 2: selected leftwards.
    editorDouble._selection = spanFrom(seed, 6, 2);
    text.insert(0, "XY");
    const restored = editorDouble._applied.at(-1)!;
    const anchor = model.getOffsetAt({
      column: restored.selectionStartColumn,
      lineNumber: restored.selectionStartLineNumber,
    });
    const head = model.getOffsetAt({
      column: restored.positionColumn,
      lineNumber: restored.positionLineNumber,
    });
    expect(anchor).toBe(8);
    expect(head).toBe(4);
    unbind();
  });

  test("an editor with no caret is simply not restored", () => {
    const seed = "text";
    const { editorDouble, text, unbind } = bind({ modelValue: seed, seed });
    editorDouble._selection = null;
    text.insert(0, "!");
    expect(editorDouble._applied).toHaveLength(0);
    unbind();
  });

  test("an editor showing a different model is left alone", () => {
    const seed = "shared";
    const { editorDouble, model, text, unbind } = bind({ modelValue: seed, seed });
    editorDouble._selection = caretAt(seed, 3);
    editorDouble._model = createModel("elsewhere");
    text.insert(0, "!");
    expect(editorDouble._applied).toHaveLength(0);
    // The bound model still received the edit — the binding is to the MODEL, not the editor.
    expect(model.getValue()).toBe("!shared");
    unbind();
  });
});

// ─── Presence ─────────────────────────────────────────────────────────────────

describe("awareness", () => {
  test("moving the caret publishes it as {anchor, head} relative positions", () => {
    const seed = "abcdef";
    const { awareness, text, editorDouble, unbind } = bind({ modelValue: seed, seed });
    editorDouble._moveCursor(spanFrom(seed, 1, 4));
    expect(awareness.setLocalStateField).toHaveBeenCalled();
    const published = awareness.local.selection;
    if (!published) {
      throw new Error("moving the caret published no selection");
    }
    // The published pair resolves back to the offsets it was minted from, anchor first.
    expect(resolveIndex(published.anchor, text)).toBe(1);
    expect(resolveIndex(published.head, text)).toBe(4);
    unbind();
  });

  test("an editor showing another model publishes nothing", () => {
    const seed = "abcdef";
    const { awareness, editorDouble, unbind } = bind({ modelValue: seed, seed });
    editorDouble._model = createModel("elsewhere");
    editorDouble._moveCursor(caretAt(seed, 2));
    expect(awareness.setLocalStateField.mock.calls).toEqual([]);
    unbind();
  });

  test("an editor with no caret publishes nothing", () => {
    const { awareness, editorDouble, unbind } = bind({ modelValue: "abc", seed: "abc" });
    editorDouble._moveCursor(null);
    expect(awareness.setLocalStateField.mock.calls).toEqual([]);
    unbind();
  });

  test("a peer's forward selection decorates with the caret AFTER the band", () => {
    const seed = "abcdefgh";
    const { awareness, editorDouble, text, unbind } = bind({ modelValue: seed, seed });
    awareness.states.set(7, peerSelection(text, 2, 5));
    awareness.emit();
    const [decoration] = editorDouble._collection()!.current;
    expect(decoration!.options.className).toBe("yRemoteSelection yRemoteSelection-7");
    expect(decoration!.options.afterContentClassName).toBe(
      "yRemoteSelectionHead yRemoteSelectionHead-7",
    );
    expect(decoration!.options.beforeContentClassName).toBeUndefined();
    expect(decoration!.range).toEqual({
      endColumn: 6,
      endLineNumber: 1,
      startColumn: 3,
      startLineNumber: 1,
    });
    unbind();
  });

  /**
   * The same peer selecting backwards, and carried over the wire the way the real one is.
   *
   * Y-protocols encodes awareness state with `JSON.stringify`, so what a peer's client actually
   * receives is a PLAIN OBJECT, not a `RelativePosition` instance. Round-tripping it here is what
   * proves the resolve path does not quietly depend on the class.
   */
  test("a peer's RTL selection puts the caret BEFORE the band, over the wire shape", () => {
    const seed = "abcdefgh";
    const { awareness, editorDouble, text, unbind } = bind({ modelValue: seed, seed });
    awareness.states.set(7, overTheWire(peerSelection(text, 5, 2)));
    awareness.emit();
    const [decoration] = editorDouble._collection()!.current;
    expect(decoration!.options.beforeContentClassName).toBe(
      "yRemoteSelectionHead yRemoteSelectionHead-7",
    );
    expect(decoration!.options.afterContentClassName).toBeUndefined();
    expect(decoration!.range).toEqual({
      endColumn: 6,
      endLineNumber: 1,
      startColumn: 3,
      startLineNumber: 1,
    });
    unbind();
  });

  test("this client's own state never decorates, and neither does a peer with no caret", () => {
    const seed = "abcdefgh";
    const { awareness, editorDouble, text, unbind } = bind({ modelValue: seed, seed });
    awareness.states.set(awareness.clientID, peerSelection(text, 0, 3));
    awareness.states.set(8, { user: { color: "#fff", login: "idle" } });
    awareness.states.set(9, { selection: null });
    awareness.emit();
    expect(editorDouble._collection()!.current).toHaveLength(0);
    unbind();
  });

  test("a position minted against another document resolves to nothing, not a wrong caret", () => {
    const seed = "abcdefgh";
    const { awareness, editorDouble, unbind } = bind({ modelValue: seed, seed });
    const foreign = sourceText(new YDoc());
    foreign.doc!.transact(() => foreign.insert(0, "elsewhere"));
    awareness.states.set(7, peerSelection(foreign, 1, 4));
    awareness.emit();
    expect(editorDouble._collection()!.current).toHaveLength(0);
    unbind();
  });

  test("peers already in the buffer are painted at bind time, not on their next keystroke", () => {
    const doc = new YDoc();
    const text = sourceText(doc);
    doc.transact(() => text.insert(0, "abcdefgh"));
    const model = createModel("abcdefgh");
    const editorDouble = createEditor(model);
    const awareness = createAwareness();
    awareness.states.set(7, peerSelection(text, 1, 3));
    const unbind = bindMonacoToYText({
      awareness,
      editors: [asCodeEditor(editorDouble)],
      model: asTextModel(model),
      text,
    });
    expect(editorDouble._collection()!.current).toHaveLength(1);
    unbind();
  });

  test("a remote edit repaints the peer carets it moved", () => {
    const seed = "abcdefgh";
    const { awareness, editorDouble, text, unbind } = bind({ modelValue: seed, seed });
    awareness.states.set(7, peerSelection(text, 2, 5));
    awareness.emit();
    text.insert(0, "XY");
    const [decoration] = editorDouble._collection()!.current;
    expect(decoration!.range.startColumn).toBe(5);
    expect(decoration!.range.endColumn).toBe(8);
    unbind();
  });

  test("an editor that moved to another model has its decorations cleared", () => {
    const seed = "abcdefgh";
    const { awareness, editorDouble, text, unbind } = bind({ modelValue: seed, seed });
    awareness.states.set(7, peerSelection(text, 2, 5));
    awareness.emit();
    expect(editorDouble._collection()!.current).toHaveLength(1);
    editorDouble._model = createModel("elsewhere");
    awareness.emit();
    expect(editorDouble._collection()!.current).toHaveLength(0);
    expect(editorDouble._collection()!.cleared).toBeGreaterThan(0);
    unbind();
  });

  test("without an awareness there is nothing to publish and nothing to draw", () => {
    const doc = new YDoc();
    const text = sourceText(doc);
    const model = createModel();
    const editorDouble = createEditor(model);
    const unbind = bindMonacoToYText({
      awareness: null,
      editors: [asCodeEditor(editorDouble)],
      model: asTextModel(model),
      text,
    });
    text.insert(0, "abc");
    expect(model.getValue()).toBe("abc");
    expect(editorDouble._decorations).toHaveLength(0);
    expect(editorDouble._cursorListeners).toHaveLength(0);
    unbind();
  });
});

// ─── Teardown ─────────────────────────────────────────────────────────────────

describe("the disposer", () => {
  test("stops publishing this client's caret — the stale-cursor fix", () => {
    const seed = "abcdef";
    const { awareness, editorDouble, unbind } = bind({ modelValue: seed, seed });
    editorDouble._moveCursor(caretAt(seed, 3));
    expect(awareness.local.selection).not.toBeNull();
    unbind();
    /* Left set, every peer still in Code view keeps drawing this caret and name flag at its last
       position for the life of the session. `null` is a legal value for the field. */
    expect(awareness.local.selection).toBeNull();
  });

  test("clears decorations and releases every listener", () => {
    const seed = "abcdefgh";
    const { awareness, editorDouble, model, text, unbind } = bind({ modelValue: seed, seed });
    awareness.states.set(7, peerSelection(text, 2, 5));
    awareness.emit();
    const collection = editorDouble._collection()!;
    expect(collection.current).toHaveLength(1);

    unbind();

    expect(collection.current).toHaveLength(0);
    expect(model.listenerCount()).toBe(0);
    expect(editorDouble._cursorListeners).toHaveLength(0);
    expect(awareness.listenerCount()).toBe(0);
  });

  test("stops syncing in both directions", () => {
    const seed = "abc";
    const { model, text, unbind } = bind({ modelValue: seed, seed });
    unbind();
    text.insert(0, "remote ");
    expect(model.getValue()).toBe("abc");
    model.applyEdits([
      { range: { endColumn: 1, endLineNumber: 1, startColumn: 1, startLineNumber: 1 }, text: "!" },
    ]);
    expect(text.toString()).toBe("remote abc");
  });

  test("is idempotent", () => {
    const { awareness, unbind } = bind();
    unbind();
    const calls = awareness.setLocalStateField.mock.calls.length;
    expect(() => {
      unbind();
      unbind();
    }).not.toThrow();
    expect(awareness.setLocalStateField.mock.calls).toHaveLength(calls);
  });

  test("a disposed model tears the binding down exactly once", () => {
    const { awareness, model, unbind } = bind();
    model.dispose();
    expect(awareness.local.selection).toBeNull();
    const calls = awareness.setLocalStateField.mock.calls.length;
    model.dispose();
    unbind();
    expect(awareness.setLocalStateField.mock.calls).toHaveLength(calls);
  });
});

// ─── Helpers that need the module under test's own yjs instance ───────────────

/**
 * A peer awareness state carrying a caret from `anchor` to `head` in `text`. Only the `selection`
 * field of a `CollabAwarenessState`, because that is the one field the binding reads off a peer.
 */
function peerSelection(text: Y.Text, anchor: number, head: number): PublishedState {
  return {
    selection: {
      anchor: createRelativePositionFromTypeIndex(text, anchor),
      head: createRelativePositionFromTypeIndex(text, head),
    },
  };
}

/**
 * A state as a peer's client actually receives it.
 *
 * Y-protocols encodes awareness with `JSON.stringify`, and `RelativePosition` has no `toJSON`, so
 * what arrives is a plain `{type, tname, item, assoc}` object with plain `{client, clock}` ids —
 * not an instance of anything. Nothing in the resolve path may depend on the class.
 */
function overTheWire(state: PublishedState): JsonValue {
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip IS the wire format under test; structuredClone is a different transform
  return JSON.parse(JSON.stringify(state));
}

/** Resolve a published relative position back to an index in `text`. */
function resolveIndex(relative: Y.RelativePosition, text: Y.Text): number | null {
  const absolute = createAbsolutePositionFromRelativePosition(relative, text.doc!);
  return absolute && absolute.type === text ? absolute.index : null;
}
