import "./with-dom.js";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { registerPlatform } from "../src/platform";
import { isFileTab } from "../src/tabs/tab";
import { closeTab, openTab } from "../src/workspace/workspace";
import { problems, resetNotifications } from "../src/services/notify";
import type { StudioPlatform } from "../src/types";
import type { GridSource } from "../src/grid/grid-source";

/* The confirm dialog is a real surface mounted into a layer; the test answers it directly. */
let confirmAnswer = true;
const confirmAsked: string[] = [];
const realLayers = await import("../src/ui/layers");
void mock.module("../src/ui/layers.ts", () => ({
  ...realLayers,
  showConfirmDialog: async (headline: string) => {
    confirmAsked.push(headline);
    return confirmAnswer;
  },
}));
const { downloadFile, uploadFile } = await import("../src/files/file-ops");
const { createGridController } = await import("../src/grid/grid-controller");

const JSON_DOC = { children: [], tagName: "div" };

let writes: [string, string][] = [];

function register(methods: Partial<StudioPlatform> = {}): void {
  /* SAFETY: download and upload reach the platform only for `writeFile` and, through the reload,
     `readFile`; a test supplies the ones its path calls and a missing member throws if called. */
  registerPlatform({
    readFile: async () => JSON.stringify(JSON_DOC),
    writeFile: async (path: string, text: string) => {
      writes.push([path, text]);
    },
    ...methods,
  } as StudioPlatform);
}

beforeEach(() => {
  confirmAnswer = true;
  confirmAsked.length = 0;
  writes = [];
  resetNotifications();
  register();
});

afterEach(() => {
  closeTab("data/page.json");
});

describe("isFileTab", () => {
  test("a project path is a file; a virtual id, an empty path and no path are not", () => {
    expect(isFileTab({ documentPath: "data/page.json" })).toBe(true);
    expect(isFileTab({ documentPath: "grid://collection/posts" })).toBe(false);
    expect(isFileTab({ documentPath: "" })).toBe(false);
    expect(isFileTab({ documentPath: null })).toBe(false);
  });
});

describe("downloadFile", () => {
  test("offers the file's name and writes nothing to the project", async () => {
    const tab = openTab({
      document: { ...JSON_DOC },
      documentPath: "data/page.json",
      id: "data/page.json",
    });
    const names: string[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function recordDownload(this: HTMLAnchorElement) {
        names.push(this.download);
      },
    );
    const create = spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      tab.doc.dirty = true;
      await downloadFile(tab);
      expect(names).toEqual(["page.json"]);
      expect(writes).toEqual([]);
      expect(tab.doc.dirty).toBe(true);
    } finally {
      click.mockRestore();
      create.mockRestore();
      revoke.mockRestore();
    }
  });

  test("does nothing for a tab that is not a file", async () => {
    const tab = openTab({ document: { ...JSON_DOC }, id: "data/page.json" });
    const clicks: string[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      clicks.push("click");
    });
    try {
      await downloadFile(tab);
      expect(clicks).toEqual([]);
    } finally {
      click.mockRestore();
    }
  });
});

describe("uploadFile", () => {
  /** Make the next file picker answer `file`, or be dismissed when it is null. */
  function pickerAnswers(file: File | null) {
    return spyOn(HTMLInputElement.prototype, "click").mockImplementation(function answerPicker(
      this: HTMLInputElement,
    ) {
      if (file) {
        Object.defineProperty(this, "files", { configurable: true, value: [file] });
        this.dispatchEvent(new Event("change"));
      } else {
        this.dispatchEvent(new Event("cancel"));
      }
    });
  }

  test("replaces the file with the picked one and says so", async () => {
    const tab = openTab({
      document: { ...JSON_DOC },
      documentPath: "data/page.json",
      id: "data/page.json",
    });
    const text = JSON.stringify({ children: [], tagName: "section" });
    const picker = pickerAnswers(new File([text], "other.json"));
    try {
      await uploadFile(tab);
      expect(writes).toEqual([["data/page.json", text]]);
      expect(tab.doc.dirty).toBe(false);
    } finally {
      picker.mockRestore();
    }
  });

  test("a dismissed picker changes nothing", async () => {
    const tab = openTab({
      document: { ...JSON_DOC },
      documentPath: "data/page.json",
      id: "data/page.json",
    });
    const picker = pickerAnswers(null);
    try {
      await uploadFile(tab);
      expect(writes).toEqual([]);
    } finally {
      picker.mockRestore();
    }
  });

  test("does nothing for a tab that is not a file", async () => {
    const tab = openTab({ document: { ...JSON_DOC }, id: "data/page.json" });
    const picker = pickerAnswers(new File(["x"], "x.json"));
    try {
      await uploadFile(tab);
      expect(writes).toEqual([]);
    } finally {
      picker.mockRestore();
    }
  });

  test("a failed write is reported, not thrown", async () => {
    register({
      writeFile: async () => {
        throw new Error("disk full");
      },
    });
    const tab = openTab({
      document: { ...JSON_DOC },
      documentPath: "data/page.json",
      id: "data/page.json",
    });
    const picker = pickerAnswers(new File(["{}"], "other.json"));
    try {
      await uploadFile(tab);
      expect(problems.some((p) => p.source === "Upload")).toBe(true);
    } finally {
      picker.mockRestore();
    }
  });
});

describe("downloadFile failures", () => {
  test("a failure to build the download is reported, not thrown", async () => {
    const tab = openTab({
      document: { ...JSON_DOC },
      documentPath: "data/page.json",
      id: "data/page.json",
    });
    const create = spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("no blobs");
    });
    try {
      await downloadFile(tab);
      expect(problems.some((p) => p.source === "Download")).toBe(true);
    } finally {
      create.mockRestore();
    }
  });
});

describe("uploadFile over unsaved changes", () => {
  function picks(file: File) {
    return spyOn(HTMLInputElement.prototype, "click").mockImplementation(function pick(
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, "files", { configurable: true, value: [file] });
      this.dispatchEvent(new Event("change"));
    });
  }

  function dirtyTab() {
    const tab = openTab({
      document: { ...JSON_DOC },
      documentPath: "data/page.json",
      id: "data/page.json",
    });
    tab.doc.dirty = true;
    return tab;
  }

  test("asks first, and declining leaves the file alone", async () => {
    const tab = dirtyTab();
    confirmAnswer = false;
    const picker = picks(new File(["{}"], "other.json"));
    try {
      await uploadFile(tab);
      expect(confirmAsked).toEqual(["Replace page.json"]);
      expect(writes).toEqual([]);
      expect(tab.doc.dirty).toBe(true);
    } finally {
      picker.mockRestore();
    }
  });

  test("confirming replaces the file and clears the dirty flag", async () => {
    const tab = dirtyTab();
    const picker = picks(new File(["{}"], "other.json"));
    try {
      await uploadFile(tab);
      expect(writes).toEqual([["data/page.json", "{}"]]);
      expect(tab.doc.dirty).toBe(false);
    } finally {
      picker.mockRestore();
    }
  });
});

describe("uploadFile into a grid", () => {
  test("drops pending edits and reloads the rows from the source", async () => {
    let loads = 0;
    const source: GridSource = {
      capabilities: { delete: false, insert: false, remotePaging: false, remoteSort: false },
      columns: async () => [{ editable: true, field: "title", kind: "string", title: "Title" }],
      commit: async () => ({ cells: [], deletes: [], inserts: [] }),
      id: "data/page.json",
      label: "page",
      rows: async () => {
        loads += 1;
        return { rows: [{ cells: { title: "One" }, key: "a" }], total: 1 };
      },
    };
    const tab = openTab({
      capabilities: { modes: ["grid"] },
      document: { tagName: "div" },
      documentPath: "data/page.json",
      id: "data/page.json",
    });
    const controller = createGridController(tab, source);
    await controller.load();
    controller.buffer.setCell("a", "title", "Edited");
    const before = loads;
    const picker = spyOn(HTMLInputElement.prototype, "click").mockImplementation(function pick(
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, "files", {
        configurable: true,
        value: [new File(["x"], "n.json")],
      });
      this.dispatchEvent(new Event("change"));
    });
    try {
      await uploadFile(tab);
      expect(confirmAsked).toEqual(["Replace page.json"]);
      expect(controller.buffer.isDirty()).toBe(false);
      expect(loads).toBeGreaterThan(before);
    } finally {
      picker.mockRestore();
    }
  });
});
