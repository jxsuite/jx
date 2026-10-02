/**
 * The action-required channel: every listener hears a report, and a report raised before anyone
 * listens is kept for the first one — because the boot-time `activate` can be refused before the
 * flow has subscribed, and dropping that report is the silent failure the channel exists to
 * prevent.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  onActionRequired,
  reportActionRequired,
  resetActionReports,
} from "../src/account/action-required";
import type { ActionRequiredReport } from "../src/account/action-required";

const START = { id: "start", label: "Start", primary: true };

afterEach(() => {
  resetActionReports();
});

describe("the action-required channel", () => {
  test("every listener hears every report, until it unsubscribes", () => {
    const first: ActionRequiredReport[] = [];
    const second: ActionRequiredReport[] = [];
    const stopFirst = onActionRequired((report) => first.push(report));
    onActionRequired((report) => second.push(report));

    reportActionRequired({ actions: [START], detail: "Saving needs a plan", retry: "repeat" });
    stopFirst();
    reportActionRequired({ actions: [START] });

    expect(first).toEqual([{ actions: [START], detail: "Saving needs a plan", retry: "repeat" }]);
    expect(second).toEqual([
      { actions: [START], detail: "Saving needs a plan", retry: "repeat" },
      { actions: [START] },
    ]);
  });

  test("a report raised before anyone listens reaches the first subscriber, once", () => {
    reportActionRequired({ actions: [START], detail: "older" });
    reportActionRequired({ actions: [START], detail: "latest", heading: "Example" });

    const heard: ActionRequiredReport[] = [];
    onActionRequired((report) => heard.push(report));
    // Only the latest is kept: they all say the same thing.
    expect(heard).toEqual([{ actions: [START], detail: "latest", heading: "Example" }]);

    const late: ActionRequiredReport[] = [];
    onActionRequired((report) => late.push(report));
    expect(late).toEqual([]);
  });

  test("reset drops a kept report as well as the listeners", () => {
    reportActionRequired({ actions: [START] });
    resetActionReports();
    const heard: ActionRequiredReport[] = [];
    onActionRequired((report) => heard.push(report));
    expect(heard).toEqual([]);
  });
});
