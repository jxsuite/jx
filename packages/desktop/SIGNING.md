# Windows Store package signing, for local testing

This guide explains how to sign and install the Jx Studio Store package (an appx) locally for testing. Releases do not use it: the Microsoft Store signs the package it distributes, and the release lane submits the unsigned one.

## Prerequisites

- Windows 10/11
- [Windows SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/) installed (required for `signtool` and `makeappx`)
- Run commands from `packages/desktop/`

## One-time setup

### 1. Generate a self-signed certificate

```bash
bun run sign:cert
```

This creates a self-signed code-signing certificate at `packages/desktop/certs/jx-studio-dev.pfx` with password `dev-cert-password`.

The certificate's **Subject must exactly match** the package's `Identity Publisher`: MSIX compares them as raw strings, and any difference fails both `signtool sign` and `Add-AppxPackage`. The three Partner Center values are written once in [`scripts/msix-identity.ts`](scripts/msix-identity.ts), currently `CN=118A192A-BE3D-4B35-A22B-EA889CD1D0B4` for the publisher. `electron-builder.yml`'s `appx` block repeats them as literals, because a YAML file cannot import them, and `tests/msix-identity.test.ts` fails when the two disagree. The package cannot use a friendlier name without breaking Store submission, so the certificate follows the package.

### 2. Trust the certificate locally

```bash
bun run sign:trust
```

This installs the certificate to your Windows trusted root store, allowing packages signed with it to install without SmartScreen warnings.

## Building and installing

### 3. Build the signed package

```bash
CSC_LINK=certs/jx-studio-dev.pfx CSC_KEY_PASSWORD=dev-cert-password bun run package --target win --arch x64 -- --publish never
```

electron-builder builds the installer and the appx, and signs with the certificate in `CSC_LINK`. Look for `win-x64-JxStudio.appx` in `artifacts/`.

### 4. Install it

Option A: double-click the appx in `artifacts/`.

Option B: use PowerShell:

```powershell
Add-AppxPackage -Path ".\artifacts\win-x64-JxStudio.appx"
```

## Troubleshooting

### "signtool not found"

- Ensure the Windows SDK is installed and `signtool.exe` is in your PATH
- Typical location: `C:\Program Files (x86)\Windows Kits\10\bin\10.0.XXXXX.0\x64\`

### Certificate issues

- Delete `packages/desktop/certs/jx-studio-dev.pfx` and regenerate with `bun run sign:cert`
- Check trusted certs: `certmgr.msc` → Trusted Root Certification Authorities

### Signing fails

Confirm the certificate's Subject:

```powershell
certutil -dump -p dev-cert-password .\certs\jx-studio-dev.pfx
```

If it is not exactly `CN=118A192A-BE3D-4B35-A22B-EA889CD1D0B4`, the certificate predates the shared `MSIX_PUBLISHER` constant: delete it and re-run `bun run sign:cert`, then `bun run sign:trust`.

### Installation fails with "This app couldn't be installed"

- Ensure the certificate is in the trusted root store (`bun run sign:trust`)
- Check the event viewer for the detailed error (Event Viewer → Windows Logs → System)

## Notes

- The certificate password is hardcoded to `dev-cert-password` (dev-only; change it in `scripts/msix-identity.ts` and `scripts/trust-cert.ps1` if needed)
- The certificate is valid for 10 years from generation
- The Windows lane's smoke test and this signing path are not yet proven on a Windows runner; treat the first release that runs them as their test
