/**
 * The **Show developer panels** preference (`src/settings/developer-panels.ts`, specs/studio.md
 * §5.1): off by default, persisted through the settings kernel, and read reactively so the rail
 * follows a flip made here or in another window.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { effect } from "../src/reactivity";
import { SETTINGS } from "../src/services/settings/definitions";
import { adoptRemoteSettings, readStoredSetting } from "../src/services/settings/kernel";
import { developerPanelsShown, setDeveloperPanelsShown } from "../src/settings/developer-panels";

describe("Show developer panels", () => {
  test("is off by default", () => {
    expect(developerPanelsShown()).toBe(false);
    expect(readStoredSetting(SETTINGS.developerPanels)).toBe("");
  });

  test("a flip is stored, and an effect reading it re-runs", () => {
    const seen: boolean[] = [];
    const runner = effect(() => {
      seen.push(developerPanelsShown());
    });
    setDeveloperPanelsShown(true);
    expect(readStoredSetting(SETTINGS.developerPanels)).toBe("true");
    setDeveloperPanelsShown(false);
    // Off is the ABSENCE of the setting's "true", stored as the empty string.
    expect(readStoredSetting(SETTINGS.developerPanels)).toBe("");
    expect(seen).toEqual([false, true, false]);
    runner.effect.stop();
  });

  test("another window's flip reaches this one", () => {
    adoptRemoteSettings({ [SETTINGS.developerPanels.key]: "true" });
    expect(developerPanelsShown()).toBe(true);
    adoptRemoteSettings({});
    expect(developerPanelsShown()).toBe(false);
  });
});
