{
  inputs = {
    nixpkgs.url = "github:cachix/devenv-nixpkgs/rolling";
    flake-parts.url = "github:hercules-ci/flake-parts";
    devenv = {
      url = "github:cachix/devenv";
      inputs.nixpkgs.follows = "nixpkgs";
    };
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
        { config, pkgs, ... }:
        {
          devenv.shells.default =
            { config, pkgs, ... }:
            let
              desktopLibs = with pkgs; [
                gtk3
                glib
                pango
                cairo
                atk
                gdk-pixbuf
                harfbuzz
              ];
            in
            {
              # dotenv = {
              #   enable = true;
              #   filename = "$DEVENV_ROOT/.env";
              # };
              packages = with pkgs; [
                bun
                google-chrome
                husky
                patchelf
                pre-commit
                procps
              ] ++ desktopLibs;

              env.LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath desktopLibs;

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
            };
        };
    };
}
