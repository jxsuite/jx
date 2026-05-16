{
  inputs = {
    nixpkgs.url = "github:cachix/devenv-nixpkgs/rolling";
    flake-parts.url = "github:hercules-ci/flake-parts";
    devenv = {
      url = "github:cachix/devenv";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    bun2nix = {
      url = "github:nix-community/bun2nix";
    };
  };

  nixConfig = {
    extra-trusted-public-keys = "devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw= nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs=";
    extra-substituters = "https://devenv.cachix.org https://nix-community.cachix.org";
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.devenv.flakeModule
      ];

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      perSystem =
        { pkgs, lib, system, ... }:
        let
          # CEF runtime libs needed by Electrobun dev mode (X11)
          desktopLibs = with pkgs; [
            alsa-lib
            at-spi2-atk
            atk
            cairo
            cups
            dbus
            expat
            gdk-pixbuf
            glib
            glib-networking
            gtk3
            harfbuzz
            libayatana-appindicator
            libgbm
            libsoup_3
            libX11
            libxcb
            libXcomposite
            libXdamage
            libXext
            libXfixes
            libxkbcommon
            libXrandr
            mesa
            nspr
            nss
            pango
            stdenv.cc.cc.lib
            systemdMinimal
            vips
            webkitgtk_4_1
          ];
          data = lib.importJSON ./package.json;
          nixpkgsWithBun2nix = import inputs.nixpkgs {
            inherit system;
            overlays = [ inputs.bun2nix.overlays.default ];
          };
        in
        {
          packages = lib.optionalAttrs pkgs.stdenv.isLinux {
            default = nixpkgsWithBun2nix.callPackage (
              { bun2nix, stdenv, bun, makeWrapper, chromium, lib }:
              stdenv.mkDerivation {
                pname = "jx-studio";
                version = data.version;

                src = lib.cleanSource ./.;

                nativeBuildInputs = [
                  bun
                  makeWrapper
                ];

                bunDeps = bun2nix.fetchBunDeps {
                  bunNix = ./bun.nix;
                };

                configurePhase = ''
                  export HOME="$TMPDIR"
                  export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
                  cp -r "$bunDeps"/share/bun-cache/. "$BUN_INSTALL_CACHE_DIR"
                  bun install --frozen-lockfile
                '';

                buildPhase = ''
                  runHook preBuild

                  bun run build
                  bun run --cwd packages/desktop scripts/pre-build.ts

                  runHook postBuild
                '';

                installPhase = ''
                  runHook preInstall

                  mkdir -p $out/lib/jx-studio $out/bin

                  cp -r packages/desktop/assets $out/lib/jx-studio/
                  cp packages/desktop/src/chromium-mode.ts $out/lib/jx-studio/

                  # Copy node_modules, dereferencing workspace symlinks
                  cp -rL node_modules $out/lib/jx-studio/

                  makeWrapper ${bun}/bin/bun $out/bin/jx-studio \
                    --add-flags "run $out/lib/jx-studio/chromium-mode.ts" \
                    --set CHROMIUM_BIN "${chromium}/bin/chromium" \
                    --set JX_STUDIO_ASSETS "$out/lib/jx-studio/assets/studio"

                  runHook postInstall
                '';

                meta = {
                  description = "Jx Studio — visual JSON component editor";
                  homepage = "https://jxsuite.com";
                  platforms = [ "x86_64-linux" "aarch64-linux" ];
                };
              }
            ) {};
          };

          devenv.shells.default =
            { pkgs, ... }:
            {
              packages =
                with pkgs;
                [
                  bun
                  google-chrome
                  husky
                  patchelf
                  pre-commit
                  procps
                ]
                ++ desktopLibs;

              env.LD_LIBRARY_PATH = lib.makeLibraryPath desktopLibs;

              env.ELECTROBUN_SKIP_CEF_CHECK = "1";

              processes = {
                chrome-debugging.exec = ''
                  # Ensure Chrome is running with remote debugging
                  rm -rf "$DEVENV_STATE/chrome-devtools"
                  if ! lsof -Pi :9222 -sTCP:LISTEN -t >/dev/null 2>&1; then
                    mkdir -p "$DEVENV_STATE/chrome-devtools"
                    google-chrome \
                      --remote-debugging-port=9222 \
                      --user-data-dir="$DEVENV_STATE/chrome-devtools" \
                      --no-first-run \
                      --no-default-browser-check \
                      --headless=new &
                    sleep 2  # Give Chrome time to start
                  fi
                '';
                dev-server.exec = ''
                  # run the bun dev server
                  bun run dev
                '';
              };

              enterShell = ''
                echo $GREET
                # load the .env file if it exists
                if [ -f "$DEVENV_ROOT/.env" ]; then
                  set -a; source "$DEVENV_ROOT/.env"; set +a
                fi

                # Patch electrobun CLI binary for NixOS
                NIX_INTERP=$(patchelf --print-interpreter "$(which bun)" 2>/dev/null)
                if [ -n "$NIX_INTERP" ]; then
                  for bin in \
                    "$DEVENV_ROOT/node_modules/electrobun/bin/electrobun" \
                    "$DEVENV_ROOT/packages/desktop/node_modules/electrobun/bin/electrobun"; do
                    if [ -f "$bin" ] && ! patchelf --print-interpreter "$bin" 2>/dev/null | grep -q nix; then
                      patchelf --set-interpreter "$NIX_INTERP" "$bin" 2>/dev/null || true
                    fi
                  done
                fi
              '';

              # ─────────────────────────────────────────────────────────────
              # Scripts (convenience commands)
              # ─────────────────────────────────────────────────────────────
              scripts = {
                build-desktop.exec = ''
                  nix build
                '';
                generate-icons = {
                  exec = ''
                    #!/usr/bin/env bash
                    set -e
                    cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

                    SRC="branding/jx_flattened.svg"
                    ICONSET="packages/desktop/icon.iconset"

                    rm -rf "$ICONSET"
                    mkdir -p "$ICONSET"

                    # macOS iconset (required by Electrobun)
                    for size in 16 32 128 256 512; do
                      rsvg-convert -w $size -h $size "$SRC" -o "$ICONSET/icon_''${size}x''${size}.png"
                      double=$((size * 2))
                      rsvg-convert -w $double -h $double "$SRC" -o "$ICONSET/icon_''${size}x''${size}@2x.png"
                    done

                    # Windows/Linux icon (reuse 512x512 from iconset)
                    cp "$ICONSET/icon_512x512.png" "packages/desktop/icon.png"

                    echo "Generated icons in $ICONSET/ and packages/desktop/icon.png"
                  '';
                  packages = [ pkgs.librsvg ];
                  description = "Generate desktop app icons from branding/jx_flattened.svg";
                };
              };
            };
        };
    };
}
