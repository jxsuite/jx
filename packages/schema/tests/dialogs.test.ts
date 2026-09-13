/** Dialog and invoker-command rules — one case per finding, plus the platform facts they encode. */
import { describe, expect, test } from "bun:test";

import {
  COMMAND_INVOKER_TAGS,
  DIALOG_CLOSEDBY,
  DIALOG_COMMANDS,
  INVOKER_COMMANDS,
  POPOVER_COMMANDS,
  dialogDisplayRepair,
  dialogIdsIn,
  documentHasDialog,
  findDialogDefects,
  isDialog,
} from "../src/dialogs";
import type { JxElement, JxStyle } from "../types";

/** A conforming modal: named, closes on Escape, and carries its own close button. */
function goodDialog(id = "confirm", extra: Partial<JxElement> = {}): JxElement {
  return {
    attributes: { "aria-labelledby": `${id}-title`, closedby: "closerequest" },
    children: [
      { id: `${id}-title`, tagName: "h2", textContent: "Sure?" },
      { attributes: { command: "close", commandfor: id }, tagName: "button", textContent: "Close" },
    ],
    id,
    style: { "&[open]": { display: "grid" } },
    tagName: "dialog",
    ...extra,
  };
}

function opener(target = "confirm", command = "show-modal"): JxElement {
  return { attributes: { command, commandfor: target }, tagName: "button", textContent: "Open" };
}

function panel(id = "menu"): JxElement {
  return { attributes: { popover: "auto" }, id, tagName: "nav" };
}

function doc(...children: JxElement[]): JxElement {
  return { children, tagName: "div" };
}

function rules(d: JxElement): string[] {
  return [...new Set(findDialogDefects(d).map((f) => f.rule))].toSorted();
}

function findRule(d: JxElement, rule: string) {
  return findDialogDefects(d).find((f) => f.rule === rule);
}

describe("constants", () => {
  test("the six built-in commands, split by what they act on", () => {
    expect([...INVOKER_COMMANDS]).toHaveLength(6);
    for (const command of INVOKER_COMMANDS) {
      expect(DIALOG_COMMANDS.has(command) !== POPOVER_COMMANDS.has(command)).toBe(true);
    }
  });

  test("closedby's three values, and the one invoker element", () => {
    expect([...DIALOG_CLOSEDBY]).toEqual(["any", "closerequest", "none"]);
    expect([...COMMAND_INVOKER_TAGS]).toEqual(["button"]);
  });

  test("isDialog reads the tag, lowercased, and nothing else", () => {
    expect(isDialog({ tagName: "DIALOG" })).toBe(true);
    expect(isDialog({ tagName: "div", attributes: { role: "dialog" } })).toBe(false);
    expect(isDialog({ tagName: { $expression: { operator: "?:" } } } as unknown as JxElement)).toBe(
      false,
    );
  });
});

describe("documentHasDialog", () => {
  test("answers for a dialog anywhere in the tree, and for none", () => {
    expect(documentHasDialog({ tagName: "div" } as never)).toBe(false);
    expect(
      documentHasDialog({
        children: [{ children: [{ tagName: "dialog" }], tagName: "section" }],
        tagName: "div",
      } as never),
    ).toBe(true);
  });
});

describe("dialogIdsIn", () => {
  test("collects dialog ids in document order, deduped, reaching into cases and templates", () => {
    const d = doc(
      goodDialog("a"),
      {
        $switch: { $ref: "#/state/x" },
        cases: { on: goodDialog("b") },
        tagName: "div",
      } as JxElement,
      { $prototype: "Array", items: { $ref: "#/state/items" }, map: goodDialog("c") } as never,
      goodDialog("a"),
      panel("not-a-dialog"),
    );
    expect(dialogIdsIn(d)).toEqual(["a", "b", "c"]);
  });
});

describe("a conforming document reports nothing", () => {
  test("a modal with its opener and close button, and a popover with a command button", () => {
    const modal = doc(opener(), goodDialog());
    expect(rules(modal)).toEqual([]);
    const popover = doc(opener("menu", "toggle-popover"), panel());
    expect(rules(popover)).toEqual([]);
  });

  test("a custom command with a handler on its target", () => {
    const handled = goodDialog("confirm", { oncommand: { $ref: "#/state/onCommand" } } as never);
    const d = doc(opener(), opener("confirm", "--rotate"), handled);
    expect(rules(d)).toEqual([]);
  });
});

describe("invoker-not-button", () => {
  test("command on a link is an error with a mechanical repair, and suppresses the target rules", () => {
    const d = doc(
      { attributes: { command: "show-modal", commandfor: "nowhere" }, tagName: "a" },
      goodDialog(),
    );
    const found = findDialogDefects(d).filter((f) => f.path.join("/") === "children/0");
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("invoker-not-button");
    expect(found[0]?.fix).toBe("invoker");
    expect(found[0]?.severity).toBe("error");
  });

  test("an <input> is not an invoker for commands, unlike for popovertarget", () => {
    const d = doc(
      {
        attributes: { command: "show-modal", commandfor: "confirm", type: "button" },
        tagName: "input",
      },
      goodDialog(),
    );
    expect(rules(d)).toContain("invoker-not-button");
  });

  test("a bound command on a non-button still counts as carrying it", () => {
    const d = doc(
      {
        attributes: { command: { $ref: "#/state/cmd" }, commandfor: "confirm" },
        tagName: "div",
      } as never,
      goodDialog(),
    );
    expect(rules(d)).toContain("invoker-not-button");
  });
});

describe("command-invalid", () => {
  test("a keyword the standard does not define is an error", () => {
    const found = findRule(doc(opener("confirm", "open"), goodDialog()), "command-invalid");
    expect(found?.severity).toBe("error");
    expect(found?.message).toContain('command="open"');
  });

  test("a --custom command is not", () => {
    const d = doc(
      opener("confirm", "--anything"),
      goodDialog("confirm", { oncommand: { $ref: "#/state/h" } } as never),
    );
    expect(rules(d)).not.toContain("command-invalid");
  });
});

describe("command-target-missing", () => {
  test("names the dialogs and popovers that do exist", () => {
    const found = findRule(doc(opener("nope"), goodDialog(), panel()), "command-target-missing");
    expect(found?.severity).toBe("error");
    expect(found?.detail).toContain('"confirm"');
    expect(found?.detail).toContain('"menu"');
  });

  test("stays silent in a document with no dialog or popover of its own", () => {
    const alone = doc(opener("elsewhere"));
    expect(rules(alone)).toEqual([]);
  });
});

describe("command-target-mismatch", () => {
  test("show-modal at a popover, and toggle-popover at a dialog", () => {
    const atPopover = doc(opener("menu", "show-modal"), panel());
    expect(findRule(atPopover, "command-target-mismatch")?.detail).toContain("toggle-popover");
    const atDialog = doc(opener("confirm", "toggle-popover"), goodDialog());
    expect(findRule(atDialog, "command-target-mismatch")?.detail).toContain("show-modal");
  });

  test("a dialog command at a plain element, and a popover command at one", () => {
    const plain: JxElement = { id: "box", tagName: "div" };
    const closeAtPlain = doc(opener("box", "close"), plain, goodDialog());
    expect(rules(closeAtPlain)).toContain("command-target-mismatch");
    const hideAtPlain = doc(opener("box", "hide-popover"), plain, goodDialog());
    expect(rules(hideAtPlain)).toContain("command-target-mismatch");
  });

  test("a bare commandfor with no command is judged for its target only", () => {
    const bare: JxElement = { attributes: { commandfor: "confirm" }, tagName: "button" };
    const case1 = doc(opener(), bare, goodDialog());
    expect(rules(case1)).toEqual([]);
  });
});

describe("custom-command-unhandled", () => {
  test("a --custom command whose target handles no command is a warning", () => {
    const found = findRule(
      doc(opener("confirm", "--rotate"), goodDialog()),
      "custom-command-unhandled",
    );
    expect(found?.severity).toBe("warn");
    expect(found?.detail).toContain("oncommand");
  });
});

describe("dialog-closedby-invalid", () => {
  test("a value outside any, closerequest and none", () => {
    const d = doc(opener(), goodDialog("confirm", { attributes: { closedby: "sometimes" } }));
    expect(findRule(d, "dialog-closedby-invalid")?.severity).toBe("error");
  });
});

describe("dialog-no-invoker", () => {
  test("a dialog no button opens is a warning — its own close button does not count", () => {
    const alone = doc(goodDialog());
    expect(findRule(alone, "dialog-no-invoker")?.severity).toBe("warn");
    const closer = doc(opener("confirm", "close"), goodDialog());
    expect(rules(closer)).toContain("dialog-no-invoker");
  });

  test("one that is open by declaration, or opened by a button, is not", () => {
    const declared = doc(goodDialog("confirm", { attributes: { open: "" } }));
    expect(rules(declared)).not.toContain("dialog-no-invoker");
    const property = doc(goodDialog("confirm", { open: true } as never));
    expect(rules(property)).not.toContain("dialog-no-invoker");
    const opened = doc(opener(), goodDialog());
    expect(rules(opened)).not.toContain("dialog-no-invoker");
  });

  test("an anonymous dialog is not judged — there is nothing to name it by", () => {
    const anonymous = goodDialog("x");
    delete (anonymous as { id?: string }).id;
    const d = doc(anonymous);
    expect(rules(d)).not.toContain("dialog-no-invoker");
  });
});

describe("modal-without-close", () => {
  const trapped = (children: JxElement[] = []): JxElement =>
    goodDialog("confirm", { attributes: { closedby: "none" }, children });

  test("opened modally, closes on nothing, nothing inside closes it", () => {
    const found = findRule(doc(opener(), trapped()), "modal-without-close");
    expect(found?.severity).toBe("error");
  });

  test("a close button inside, a form that closes it, or a closedby that lets Escape through, is enough", () => {
    const closeButton: JxElement = { attributes: { command: "close" }, tagName: "button" };
    const case2 = doc(opener(), trapped([closeButton]));
    expect(rules(case2)).not.toContain("modal-without-close");
    const requestClose: JxElement = {
      attributes: { command: "request-close", commandfor: "confirm" },
      tagName: "button",
    };
    const case3 = doc(opener(), trapped([requestClose]));
    expect(rules(case3)).not.toContain("modal-without-close");
    const form: JxElement = {
      attributes: { method: "dialog" },
      children: [{ tagName: "button" }],
      tagName: "form",
    };
    const case4 = doc(opener(), trapped([form]));
    expect(rules(case4)).not.toContain("modal-without-close");
    const escapable = goodDialog("confirm", { attributes: { closedby: "any" }, children: [] });
    const withEscape = doc(opener(), escapable);
    expect(rules(withEscape)).not.toContain("modal-without-close");
  });

  test("a close button aimed at ANOTHER dialog does not count", () => {
    const other: JxElement = {
      attributes: { command: "close", commandfor: "elsewhere" },
      tagName: "button",
    };
    const both = doc(opener(), trapped([other]), goodDialog("elsewhere"));
    expect(rules(both)).toContain("modal-without-close");
  });

  test("a non-modal opener does not trap", () => {
    const case5 = doc(opener("confirm", "close"), trapped());
    expect(rules(case5)).not.toContain("modal-without-close");
  });
});

describe("dialog-display, and its repair", () => {
  test("a base display is an error with a repair", () => {
    const found = findRule(
      doc(opener(), goodDialog("confirm", { style: { display: "grid" } })),
      "dialog-display",
    );
    expect(found?.severity).toBe("error");
    expect(found?.fix).toBe("display");
  });

  test("the repair moves the base display into the open rule, unless the open rule already has one", () => {
    expect(dialogDisplayRepair({ display: "grid" })).toEqual({
      base: ["display"],
      openDisplay: "grid",
    });
    expect(dialogDisplayRepair({ "&[open]": { display: "flex" }, display: "grid" })).toEqual({
      base: ["display"],
      openDisplay: null,
    });
    expect(
      dialogDisplayRepair({ ":open": { display: "flex" }, display: "grid" } as JxStyle),
    ).toEqual({ base: ["display"], openDisplay: null });
    const bracket = { "[open]": { display: "flex" }, display: "grid" } as JxStyle;
    expect(dialogDisplayRepair(bracket)).toEqual({ base: ["display"], openDisplay: null });
    const pseudo = { "&:open": { display: "flex" }, display: "grid" } as JxStyle;
    expect(dialogDisplayRepair(pseudo)).toEqual({ base: ["display"], openDisplay: null });
    expect(dialogDisplayRepair({ "&[open]": { display: "grid" } })).toBeNull();
    expect(dialogDisplayRepair()).toBeNull();
  });
});

describe("a command aimed at a custom element whose definition declares popover", () => {
  test("is a target mismatch without the scope and correct with it", () => {
    /* The measured consequence of the schema not knowing the kit: an author drops a jx-popover on
       a page, points a button at it the way the docs say to, and gets an error naming their own
       correct markup. */
    const page = {
      children: [
        { attributes: { command: "toggle-popover", commandfor: "p1" }, tagName: "button" },
        { attributes: { id: "p1" }, tagName: "jx-popover" },
      ],
      tagName: "div",
    } as unknown as JxElement;
    expect(findDialogDefects(page).map((d) => d.rule)).toEqual(["command-target-mismatch"]);
    expect(findDialogDefects(page, { popoverTags: new Set(["jx-popover"]) })).toEqual([]);
  });
});

describe("a custom element that forwards command and commandfor", () => {
  const scope = { invokerTags: new Set(["jx-button"]), popoverTags: new Set(["jx-popover"]) };
  const page = (tag: string): JxElement =>
    ({
      children: [
        { attributes: { command: "toggle-popover", commandfor: "p1" }, tagName: tag },
        { attributes: { id: "p1" }, tagName: "jx-popover" },
      ],
      tagName: "div",
    }) as unknown as JxElement;

  test("is an invoker with the scope, and a defect without it", () => {
    expect(findDialogDefects(page("jx-button")).map((d) => d.rule)).toEqual(["invoker-not-button"]);
    expect(findDialogDefects(page("jx-button"), scope)).toEqual([]);
  });

  test("a plain div is still refused", () => {
    expect(findDialogDefects(page("div"), scope).map((d) => d.rule)).toContain(
      "invoker-not-button",
    );
  });
});
