import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import { resetDocumentStyles } from "@jxsuite/runtime";
import { fakeChannelPair } from "../src/canvas/iframe-channel";
import { flush } from "./harness";
import { startCanvasIframe } from "../src/canvas/iframe-entry";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { IframeToParent, ParentToIframe } from "../src/canvas/iframe-protocol";

/*
 * A document's own script in the frame (`spec.md` §23.2). The document arrives naming a module by
 * its `jx-script:` specifier and carrying no `$script`; the module's text arrives beside it, and
 * the frame has it loaded by the time an entry reads it.
 */

/* A frame is at its canvas URL; happy-dom starts at about:blank, which is no base for a module.
   SAFETY: with-dom's GlobalRegistrator copies happy-dom's window members onto globalThis,
   `happyDOM` among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (url: string) => void };
};
happyDOM.setURL("http://localhost:3000/packages/studio/canvas.html");

type RenderMsg = Extract<ParentToIframe, { kind: "render" }>;

const PAGE = "jx-script:http://localhost:3000/pages/home.json#client";
const LAYOUT = "jx-script:http://localhost:3000/layouts/base.json#client";

function renderMsg(gen: number, doc: JxMutableNode, scripts?: Record<string, string>): RenderMsg {
  const msg: RenderMsg = {
    colorScheme: null,
    doc,
    docBase: "http://localhost:3000/pages/home.json",
    gen,
    kind: "render",
    mapperCtx: {
      arrayPaths: [],
      canvasMode: "preview",
      layoutWrapped: false,
      pageContentOffset: null,
      pageContentPrefix: null,
    },
    mode: "preview",
    shadowDoc: doc,
    siteStyle: null,
  };
  if (scripts) {
    msg.scripts = scripts;
  }
  return msg;
}

/** A page merged into its layout: two entries named `greet` in two modules, read by two elements. */
function merged(): JxMutableNode {
  return {
    children: [
      { tagName: "header", textContent: "${state.site()}" },
      { tagName: "p", textContent: "${state.greet()}" },
    ],
    state: {
      greet: { $export: "greet", $prototype: "Function", $src: PAGE },
      site: { $export: "greet", $prototype: "Function", $src: LAYOUT },
    },
    tagName: "div",
  };
}

let teardown: (() => void) | undefined;
afterEach(() => {
  teardown?.();
  teardown = undefined;
  document.body.innerHTML = "";
});

async function boot() {
  resetDocumentStyles();
  const pair = fakeChannelPair<ParentToIframe, IframeToParent>();
  const acks: IframeToParent[] = [];
  pair.parent.onMessage((m) => acks.push(m));
  const container = document.createElement("div");
  document.body.append(container);
  teardown = startCanvasIframe({ channel: pair.iframe, container });
  const render = async (msg: RenderMsg) => {
    pair.parent.post(msg);
    pair.flush();
    for (let turn = 0; turn < 20; turn += 1) {
      await flush();
      pair.flush();
    }
  };
  return { acks, container, render };
}

describe("a render's scripts", () => {
  test("each entry runs the function of the document it was written in", async () => {
    const { container, render } = await boot();

    await render(
      renderMsg(1, merged(), {
        [LAYOUT]: "export const greet = (): string => 'from the layout';",
        [PAGE]: "export const greet = (): string => 'from the page';",
      }),
    );

    expect(container.querySelector("header")?.textContent).toBe("from the layout");
    expect(container.querySelector("p")?.textContent).toBe("from the page");
  });

  test("a later render with a saved script draws the new module", async () => {
    const { container, render } = await boot();
    const layout = "export const greet = () => 'layout';";

    await render(
      renderMsg(1, merged(), { [LAYOUT]: layout, [PAGE]: "export const greet = () => 'one';" }),
    );
    expect(container.querySelector("p")?.textContent).toBe("one");

    await render(
      renderMsg(2, merged(), { [LAYOUT]: layout, [PAGE]: "export const greet = () => 'two';" }),
    );
    expect(container.querySelector("p")?.textContent).toBe("two");
    expect(container.querySelector("header")?.textContent).toBe("layout");
  });
});
