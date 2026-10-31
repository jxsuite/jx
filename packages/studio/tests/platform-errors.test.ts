/**
 * Reading a structured platform failure, from either shape a backend may send.
 *
 * The reconciliation this file pins: **a problem's `type` IS the code.** A backend answering `type:
 * ".../needs-installation-access"` says exactly what `code: "needs_installation_access"` said, so
 * every surface above this module keeps branching on `code` without knowing which shape arrived.
 * Getting that wrong would not throw — it would silently stop rendering the install link, and the
 * user would see flattened text with no way forward.
 */

import { describe, expect, test } from "bun:test";
import {
  installUrlOf,
  isActionRequired,
  offeredActions,
  platformErrorInfo,
  remoteConflictsOf,
  retryHint,
} from "../src/platform-errors";
import { JOIN_OFFER } from "./shared-fixtures";

const INSTALL_URL = "https://github.com/apps/jx/installations/new";

describe("platformErrorInfo", () => {
  test("derives the code from a problem type", () => {
    const error = Object.assign(new Error("blocked"), {
      installUrl: INSTALL_URL,
      type: "https://jxsuite.com/problems/needs-installation-access",
    });
    expect(platformErrorInfo(error)).toEqual({
      code: "needs-installation-access",
      installUrl: INSTALL_URL,
    });
  });

  /*
   * The two spellings exist because the type is a URI path segment and the code was a JS-ish
   * identifier. Normalizing one to the other is what lets a migrated and an unmigrated backend
   * reach the same branch, which is the whole point of keeping both readable for a release.
   */
  test("normalizes a legacy underscored code to the same slug", () => {
    const error = Object.assign(new Error("blocked"), {
      code: "needs_installation_access",
      installUrl: INSTALL_URL,
    });
    expect(platformErrorInfo(error).code).toBe("needs-installation-access");
  });

  test("a problem type wins over a legacy code", () => {
    const error = Object.assign(new Error("blocked"), {
      code: "something_else",
      type: "https://jxsuite.com/problems/forbidden",
    });
    expect(platformErrorInfo(error).code).toBe("forbidden");
  });

  // A `type` that is not one of ours says nothing about a Jx problem.
  test("ignores a type outside the Jx namespace", () => {
    const error = Object.assign(new Error("x"), { type: "https://example.com/errors/other" });
    expect(platformErrorInfo(error)).toEqual({});
  });

  test("an unstructured failure carries nothing", () => {
    expect(platformErrorInfo(new Error("plain"))).toEqual({});
    expect(platformErrorInfo("a string")).toEqual({});
    expect(platformErrorInfo(null)).toEqual({});
  });
});

describe("installUrlOf", () => {
  test("answers for either shape, and only with a URL to offer", () => {
    const encodings = [
      { installUrl: INSTALL_URL, type: "https://jxsuite.com/problems/needs-installation-access" },
      { code: "needs_installation_access", installUrl: INSTALL_URL },
    ];
    for (const structured of encodings) {
      const error = Object.assign(new Error("blocked"), structured);
      expect(installUrlOf(error)).toBe(INSTALL_URL);
    }

    // The right code with no URL is not an offer.
    const noUrl = Object.assign(new Error("blocked"), { code: "needs_installation_access" });
    expect(installUrlOf(noUrl)).toBeNull();

    // A different failure never renders an install link, however it is spelled.
    const otherFailure = Object.assign(new Error("nope"), {
      installUrl: INSTALL_URL,
      type: "https://jxsuite.com/problems/forbidden",
    });
    expect(installUrlOf(otherFailure)).toBeNull();
  });
});

describe("the action-required refusal", () => {
  test("carries its actions, heading and retry hint through, from either shape", () => {
    const encodings = [
      { type: "https://jxsuite.com/problems/action-required" },
      { code: "action_required" },
    ];
    for (const structured of encodings) {
      const error = Object.assign(new Error("needs a step"), structured, {
        actions: [JOIN_OFFER],
        heading: "Join first",
        retry: "repeat",
      });
      expect(platformErrorInfo(error)).toEqual({
        actions: [JOIN_OFFER],
        code: "action-required",
        heading: "Join first",
        retry: "repeat",
      });
      expect(isActionRequired(error)).toBe(true);
    }
  });

  test("members of the wrong type are not reported", () => {
    const error = Object.assign(new Error("x"), {
      actions: "join",
      code: "action_required",
      heading: 7,
      retry: "later",
    });
    expect(platformErrorInfo(error)).toEqual({ actions: [], code: "action-required" });
  });

  test("the code alone is a refusal", () => {
    const error = Object.assign(new Error("x"), { code: "action_required" });
    expect(isActionRequired(error)).toBe(true);
  });

  test("any other failure is not one, whatever members it carries", () => {
    const error = Object.assign(new Error("x"), { actions: [JOIN_OFFER], code: "forbidden" });
    expect(isActionRequired(error)).toBe(false);
    expect(isActionRequired(null)).toBe(false);
  });
});

describe("offeredActions", () => {
  test("keeps each well-formed action, and only the members of the right type", () => {
    expect(
      offeredActions([
        JOIN_OFFER,
        { href: 3, id: "ask", label: "Ask", primary: "yes" },
        { href: "", id: "plain", label: "Plain" },
        { id: "", label: "No id" },
        { id: "no-label", label: "" },
        { id: 1, label: "Numeric id" },
        null,
        "join",
      ]),
    ).toEqual([JOIN_OFFER, { id: "ask", label: "Ask" }, { id: "plain", label: "Plain" }]);
  });

  test("anything but a list is no actions", () => {
    expect(offeredActions(null)).toEqual([]);
    expect(offeredActions({ id: "join", label: "Join" })).toEqual([]);
  });
});

describe("retryHint", () => {
  test("names only the hints the contract defines", () => {
    expect(retryHint("reload")).toBe("reload");
    expect(retryHint("repeat")).toBe("repeat");
    expect(retryHint("none")).toBe("none");
    expect(retryHint("later")).toBeUndefined();
    expect(retryHint(1)).toBeUndefined();
  });
});

describe("remoteConflictsOf", () => {
  test("names the shared files of a refused pull or commit, in either shape", () => {
    const legacy = Object.assign(new Error("conflict"), {
      code: "pull_conflict",
      conflicts: ["a.md", 3, "b.md"],
    });
    expect(remoteConflictsOf(legacy)).toEqual(["a.md", "b.md"]);
    const problem = Object.assign(new Error("conflict"), {
      conflicts: ["c.md"],
      type: "https://jxsuite.com/problems/conflict",
    });
    expect(remoteConflictsOf(problem)).toEqual(["c.md"]);
  });

  test("is null for every other failure, and for a conflict that names no files", () => {
    expect(remoteConflictsOf(new Error("down"))).toBeNull();
    const unnamed = Object.assign(new Error("x"), { code: "pull_conflict" });
    expect(remoteConflictsOf(unnamed)).toBeNull();
    const other = Object.assign(new Error("x"), { code: "branch_exists", conflicts: ["a.md"] });
    expect(remoteConflictsOf(other)).toBeNull();
  });
});
