/**
 * The plan-refusal channel: every listener hears a report, and a report raised before anyone
 * listens is kept for the first one — because the boot-time `activate` can be refused before the
 * upgrade flow has subscribed, and dropping that report is the silent failure the channel exists to
 * prevent.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  onUpgradeRequired,
  reportUpgradeRequired,
  resetUpgradeReports,
} from "../src/account/upgrade-required";
import type { UpgradeRequiredReport } from "../src/account/upgrade-required";

afterEach(() => {
  resetUpgradeReports();
});

describe("the upgrade-required channel", () => {
  test("every listener hears every report, until it unsubscribes", () => {
    const first: UpgradeRequiredReport[] = [];
    const second: UpgradeRequiredReport[] = [];
    const stopFirst = onUpgradeRequired((report) => first.push(report));
    onUpgradeRequired((report) => second.push(report));

    reportUpgradeRequired({ kind: "save", detail: "Saving needs a plan" });
    stopFirst();
    reportUpgradeRequired({ kind: "other" });

    expect(first).toEqual([{ kind: "save", detail: "Saving needs a plan" }]);
    expect(second).toEqual([{ kind: "save", detail: "Saving needs a plan" }, { kind: "other" }]);
  });

  test("a report raised before anyone listens reaches the first subscriber, once", () => {
    reportUpgradeRequired({ kind: "open", detail: "older" });
    reportUpgradeRequired({ kind: "open", detail: "latest", trialAvailable: true });

    const heard: UpgradeRequiredReport[] = [];
    onUpgradeRequired((report) => heard.push(report));
    // Only the latest is kept: they all say the same thing.
    expect(heard).toEqual([{ kind: "open", detail: "latest", trialAvailable: true }]);

    const late: UpgradeRequiredReport[] = [];
    onUpgradeRequired((report) => late.push(report));
    expect(late).toEqual([]);
  });

  test("reset drops a kept report as well as the listeners", () => {
    reportUpgradeRequired({ kind: "open" });
    resetUpgradeReports();
    const heard: UpgradeRequiredReport[] = [];
    onUpgradeRequired((report) => heard.push(report));
    expect(heard).toEqual([]);
  });
});
