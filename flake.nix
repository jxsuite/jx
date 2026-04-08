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
            {
              packages = with pkgs; [
                bun
                pre-commit
                google-chrome
                procps
              ];

              processes = {
                chrome-debugging.exec = ''
                  # Ensure Chrome is running with remote debugging
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
              };
            };
        };
    };
}
