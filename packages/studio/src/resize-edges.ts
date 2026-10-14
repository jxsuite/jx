/// <reference lib="dom" />
import { isFunction, isNonNullObject } from "@jxsuite/schema/guards";
import type { SerializableRect } from "./canvas/iframe-protocol";

/** The desktop shell's frame controls; only desktop adapters add them to the platform. */
interface ResizeWindowControls {
  getFrame: () => Promise<SerializableRect>;
  setFrame: (x: number, y: number, w: number, h: number) => void;
}

/** True when `value` is a windowControls object that can at least read the window frame. */
function isResizeWindowControls(value: unknown): value is ResizeWindowControls {
  return isNonNullObject(value) && "getFrame" in value && isFunction(value.getFrame);
}

/** The registered platform's window controls, when it is a desktop shell that exposes them. */
function readWindowControls(): ResizeWindowControls | undefined {
  const platform = globalThis.__jxPlatform;
  if (platform == null || !("windowControls" in platform)) {
    return undefined;
  }
  const controls = platform.windowControls;
  return isResizeWindowControls(controls) ? controls : undefined;
}

const EDGES = [
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

let mounted = false;

export function mountResizeEdges() {
  const wc = readWindowControls();
  if (!wc || mounted) {
    return;
  }
  mounted = true;

  const container = document.createElement("div");
  container.id = "resize-edges";

  for (const edge of EDGES) {
    const el = document.createElement("div");
    el.className = `resize-edge ${edge}`;
    el.addEventListener("mousedown", (e) => startResize(e, edge, wc));
    container.append(el);
  }

  document.body.append(container);
}

async function startResize(e: MouseEvent, edge: string, wc: ResizeWindowControls) {
  e.preventDefault();
  e.stopPropagation();

  const startX = e.screenX;
  const startY = e.screenY;
  const frame = await wc.getFrame();
  const startFrame = { ...frame };

  /** @param {MouseEvent} me */
  function onMove(me: MouseEvent) {
    const dx = me.screenX - startX;
    const dy = me.screenY - startY;

    let { x, y, width, height } = startFrame;

    if (edge.includes("right")) {
      width = Math.max(MIN_WIDTH, width + dx);
    }
    if (edge.includes("left")) {
      const newW = Math.max(MIN_WIDTH, width - dx);
      x += width - newW;
      width = newW;
    }
    if (edge.includes("bottom")) {
      height = Math.max(MIN_HEIGHT, height + dy);
    }
    if (edge.includes("top")) {
      const newH = Math.max(MIN_HEIGHT, height - dy);
      y += height - newH;
      height = newH;
    }

    wc.setFrame(x, y, width, height);
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
