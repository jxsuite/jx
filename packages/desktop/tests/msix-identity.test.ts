/**
 * The Store package identity (scripts/msix-identity.ts) and the places that repeat it.
 *
 * Signing an appx enforces a byte-for-byte match between the package's publisher and the signing
 * certificate's Subject, and a YAML file and a PowerShell script cannot import the constants, so
 * each place that spells one of them out is held equal to the constant here.
 */
import { describe, expect, test } from "bun:test";
import {
  DEV_CERT_FILENAME,
  DEV_CERT_PASSWORD,
  MSIX_IDENTITY_NAME,
  MSIX_PUBLISHER,
  MSIX_PUBLISHER_DISPLAY_NAME,
} from "../scripts/msix-identity";

describe("the Partner Center identity", () => {
  test("is the assigned publisher ID, not a friendly name the Store would reject", () => {
    expect(MSIX_PUBLISHER).toBe("CN=118A192A-BE3D-4B35-A22B-EA889CD1D0B4");
    expect(MSIX_IDENTITY_NAME).toBe("AvunuLLC.JxStudio");
    expect(MSIX_PUBLISHER_DISPLAY_NAME).toBe("Avunu");
  });
});

describe("electron-builder.yml's appx block", () => {
  /* The Store checks the package's publisher against Partner Center and signing checks it against the
     certificate, so a YAML literal that has drifted from the constant fails a release, not a test. */
  test("spells the Partner Center identity exactly as the constants do", async () => {
    const yaml = await Bun.file(new URL("../electron-builder.yml", import.meta.url)).text();
    const block = /^appx:\n((?:  .*\n)+)/m.exec(yaml)?.[1] ?? "";
    const read = (key: string): string | undefined =>
      new RegExp(`^  ${key}: (.+)$`, "m").exec(block)?.[1]?.trim();
    expect(read("identityName")).toBe(MSIX_IDENTITY_NAME);
    expect(read("publisher")).toBe(MSIX_PUBLISHER);
    expect(read("publisherDisplayName")).toBe(MSIX_PUBLISHER_DISPLAY_NAME);
  });
});

describe("dev certificate constants", () => {
  test("match the literals scripts/trust-cert.ps1 repeats in PowerShell", async () => {
    // The .ps1 cannot import this module, so the duplication is real and worth pinning.
    const ps1 = await Bun.file(new URL("../scripts/trust-cert.ps1", import.meta.url)).text();
    expect(ps1).toContain(DEV_CERT_FILENAME);
    expect(ps1).toContain(DEV_CERT_PASSWORD);
  });
});
