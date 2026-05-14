{
  inputs = {
    nixpkgs.url = "github:cachix/devenv-nixpkgs/rolling";
    flake-parts.url = "github:hercules-ci/flake-parts";
    devenv = {
      url = "github:cachix/devenv";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-electrobun.url = "github:wnix/nix-electrobun";
  };

  nixConfig = {
    extra-trusted-public-keys = "devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw=";
    extra-substituters = "https://devenv.cachix.org";
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
        { pkgs, lib, ... }:
        let
          # CEF runtime libs needed by the desktop app
          desktopLibs = with pkgs; [
            gtk3
            glib
            glib-networking
            pango
            cairo
            atk
            gdk-pixbuf
            harfbuzz
            nspr
            nss
            dbus
            cups
            libX11
            libXcomposite
            libXdamage
            libXext
            libXfixes
            libXrandr
            mesa
            expat
            libxcb
            libxkbcommon
            alsa-lib
            at-spi2-atk
            systemdMinimal
            webkitgtk_4_1
            libsoup_3
            libayatana-appindicator
          ];
          data = lib.importJSON ./package.json;
        in
        {
          packages = lib.optionalAttrs pkgs.stdenv.isLinux {
            default = pkgs.stdenv.mkDerivation {
              pname = "jx-studio";
              version = data.version;

              src = ./.;

              nativeBuildInputs = with pkgs; [
                bun
                autoPatchelfHook
                makeWrapper
                zstd
                patchelf
                which
              ];
              buildInputs = desktopLibs ++ [ pkgs.stdenv.cc.cc.lib ];

              autoPatchelfIgnoreMissingDeps = [
                "libcrypt.so.1"
              ];

              # ElectroBun downloads platform binaries at build time
              __noChroot = true;

              buildPhase = ''
                runHook preBuild

                export HOME="$TMPDIR"
                bun install --no-progress

                # Patch electrobun CLI for NixOS
                NIX_INTERP=$(patchelf --print-interpreter "$(which bun)")
                patchelf --set-interpreter "$NIX_INTERP" node_modules/electrobun/bin/electrobun || true

                # Build workspace packages (compiler, runtime, studio, schema)
                bun run build

                # Build the desktop app bundle
                bun run desktop:stable

                runHook postBuild
              '';

              installPhase = ''
                runHook preInstall

                # Extract the .tar.zst app bundle
                mkdir -p $out/opt/jx-studio
                tar --use-compress-program=zstd -xf packages/desktop/artifacts/stable-linux-x64-JxStudio.tar.zst -C $out/opt/jx-studio/
                mv $out/opt/jx-studio/JxStudio/* $out/opt/jx-studio/
                rmdir $out/opt/jx-studio/JxStudio

                mkdir -p $out/bin
                makeWrapper $out/opt/jx-studio/bin/launcher $out/bin/jx-studio \
                  --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath desktopLibs}" \
                  --set GDK_BACKEND wayland

                runHook postInstall
              '';

              meta = {
                description = "Jx Studio — visual JSON component editor";
                homepage = "https://jxsuite.com";
                platforms = [ "x86_64-linux" ];
              };
            };
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
                  nix build --option sandbox false
                '';
              };
            };
        };
    };
}
