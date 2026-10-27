{
  stdenv,
  bun,
  makeWrapper,
  chromium,
  electron,
  lib,
  runCommand,
  fetchurl,
  fetchFromGitHub,
  fetchgit,
}:
let
  # Version comes from the desktop package (the app this derivation actually builds), not the
  # monorepo root — they drift independently.
  version = (lib.importJSON ./package.json).version;

  # Import the bun2nix-generated package set, but wrap each fetcher so we learn
  # which entries are plain registry tarballs (the only ones the offline
  # registry needs to serve). Workspace packages come through `copyPathToStore`
  # and are resolved locally by Bun via the `workspace:` protocol, so we drop
  # them here.
  bunSet = import ../../bun.nix {
    fetchurl = args: {
      drv = fetchurl args;
      serve = true;
    };
    fetchFromGitHub = args: {
      drv = fetchFromGitHub args;
      serve = false;
    };
    fetchgit = args: {
      drv = fetchgit args;
      serve = false;
    };
    copyPathToStore = _path: {
      drv = null;
      serve = false;
    };
  };
  # `bun install` only ever downloads the optional native sidecars whose `os`
  # and `cpu` match the host, but bun.lock pins every platform npm publishes —
  # Windows and macOS esbuild/sharp/oxlint/tsgo binaries included. Served
  # unconditionally they become build inputs of `registryTree`, so `nix build`
  # fetches hundreds of megabytes it will never hand to Bun. Filter on the same
  # two fields Bun filters on; libc deliberately is not one of them, which is
  # why the `linuxmusl` sharp builds stay (Bun installs those on glibc too).
  #
  # A package name that mentions no platform at all is always kept, and a
  # wrongly-dropped tarball fails loudly — the shim answers its fetch with a
  # 404 and `bun install` aborts — so the filter can never silently ship a
  # half-installed tree.
  osTokens = [
    "aix"
    "android"
    "darwin"
    "freebsd"
    "linux"
    "linuxmusl"
    "netbsd"
    "openbsd"
    "openharmony"
    "sunos"
    "webcontainers"
    "win32"
  ];
  cpuTokens = [
    "arm"
    "arm64"
    "ia32"
    "loong64"
    "mips64el"
    "ppc64"
    "riscv64"
    "s390x"
    "wasm32"
    "x64"
  ];
  hostOs = if stdenv.hostPlatform.isDarwin then "darwin" else "linux";
  hostCpu =
    let
      cpu = stdenv.hostPlatform.parsed.cpu.name;
    in
    {
      x86_64 = "x64";
      aarch64 = "arm64";
      armv7l = "arm";
      i686 = "ia32";
    }
    .${cpu} or cpu;
  forThisHost =
    key:
    let
      toks = lib.splitString "-" (unscopedOf (nameOf key));
      os = lib.intersectLists toks osTokens;
      cpu = lib.intersectLists toks cpuTokens;
    in
    (os == [ ] || lib.elem hostOs os || lib.elem "${hostOs}musl" os)
    && (cpu == [ ] || lib.elem hostCpu cpu);

  tarballs = lib.filterAttrs (key: e: e.serve && forThisHost key) bunSet;

  # Split a "name@version" key (handles scoped names like "@scope/pkg@1.2.3").
  nameOf =
    key:
    let
      segs = lib.splitString "@" key;
    in
    if lib.hasPrefix "@" key then
      "@" + lib.concatStringsSep "@" (lib.init (lib.tail segs))
    else
      lib.concatStringsSep "@" (lib.init segs);
  versionOf = key: lib.last (lib.splitString "@" key);
  unscopedOf = name: lib.last (lib.splitString "/" name);

  # A directory tree mirroring npm registry tarball URLs
  # (<name>/-/<basename>-<version>.tgz), populated from the lockfile-pinned
  # tarballs bun2nix already fetches. No network and no extra hash to maintain:
  # every tarball's integrity comes from bun.lock via bun.nix.
  registryTree = runCommand "jx-bun-registry-tree" { } (
    "mkdir -p $out\n"
    + lib.concatStrings (
      lib.mapAttrsToList (
        key: e:
        let
          name = nameOf key;
          ver = versionOf key;
          dir = "$out/${name}/-";
          dest = "${dir}/${unscopedOf name}-${ver}.tgz";
        in
        ''
          mkdir -p "${dir}"
          cp "${e.drv}" "${dest}"
        ''
      ) tarballs
    )
  );

  registryPort = "48732";

  # Optional imports the backend's graph names but never needs installed: oxfmt probes the Prettier
  # plugins and the Astro compiler (@astrojs/compiler-rs, an optional peer since oxfmt 0.73) only for
  # languages a project actually formats. This is `BACKEND_EXTERNALS` in scripts/lib/backend-bundle.ts, which the packaged
  # application's backend bundle leaves out too, and tests/backend-bundle.test.ts holds the two equal.
  resolveExternals = [
    "@prettier/plugin-oxc"
    "@prettier/plugin-hermes"
    "@prettier/plugin-pug"
    "prettier-plugin-astro"
    "prettier-plugin-svelte"
    "prettier-plugin-marko"
    "@zackad/prettier-plugin-twig"
    "@shopify/prettier-plugin-liquid"
    "@astrojs/compiler-rs"
  ];

  # Browser-only libraries the studio build has already bundled into `assets/studio`. They are
  # real dependencies of @jxsuite/studio, because that package publishes its sources to npm, so the
  # production install keeps them; the launcher never loads them (installCheckPhase proves it), and
  # together they are ~130 MB of the closure.
  bundledIntoStudio = [
    "monaco-editor"
    "tabulator-tables"
  ];

  # The source is whatever tree was fetched, cleaned. `$out` must be a function of that tree's
  # CONTENT and not of how it arrived: a consumer of `github:jxsuite/jx/release` fetches GitHub's
  # tarball, while CI builds a git checkout, and the two have to be byte-identical or one commit gets
  # two store paths and the cache is complete at an address nobody asks for (desktop-v5.0.0, #250,
  # when an uninitialised submodule's gitlink made them differ by two empty directories). There is
  # no submodule now, and nix.yml's publish leg still asserts the two addresses agree.
  src = lib.cleanSource ../..;
in
stdenv.mkDerivation {
  pname = "jx-studio";
  inherit version src;

  nativeBuildInputs = [
    bun
    makeWrapper
  ];

  dontConfigure = true;

  # `bun install` re-resolves a workspace's directly declared dependencies
  # against the registry even with a full cache and `--frozen-lockfile`
  # (it sees a phantom "updated N dependencies" diff for the workspace
  # packages). That needs the network, which the sandbox forbids. So instead of
  # bun2nix's offline cache we stand up a throwaway registry on loopback that
  # serves lockfile-derived manifests plus the pre-fetched tarballs, and point
  # Bun at it. See scripts/registry-shim.ts for the why and how.
  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR"

    bun ${./scripts/registry-shim.ts} bun.lock ${registryTree} ${registryPort} &
    shimPid=$!
    trap 'kill $shimPid 2>/dev/null || true' EXIT

    # Wait for the shim to accept connections before installing.
    for _ in $(seq 1 100); do
      if bun -e 'await fetch("http://localhost:${registryPort}/lit-html").then(() => process.exit(0)).catch(() => process.exit(1))' 2>/dev/null; then
        break
      fi
      sleep 0.2
    done

    bun install \
      --registry "http://localhost:${registryPort}" \
      --frozen-lockfile \
      --linker=hoisted \
      --ignore-scripts

    # studio's build bundles monaco-editor's web workers via the literal path
    # ./node_modules/monaco-editor. The hoisted linker keeps monaco at the repo
    # root (no per-package node_modules), so expose it where the script looks.
    # Removed again before install — the runtime resolves deps from the root.
    mkdir -p packages/studio/node_modules
    ln -srf node_modules/monaco-editor packages/studio/node_modules/monaco-editor

    bun run build
    bun run --cwd packages/desktop scripts/pre-build-rpc.ts

    # The Electron application's main process and preload (specs/desktop.md §9.7). Electron runs
    # JavaScript, and a sandboxed preload must be CommonJS whose only `require` is `electron`, so
    # both are bundled here, where the workspace's full tree still resolves them. The result needs
    # nothing from node_modules at runtime. The backend it spawns is NOT bundled: it runs from
    # source under Bun against the production install below, as the launcher always has.
    bun build \
      packages/desktop/src/electron-shell/app-main.ts \
      packages/desktop/src/electron-shell/preload.ts \
      --target=node --format=cjs --external electron \
      --outdir packages/desktop/assets/electron
    # Electron loads `app-main.js` as Node does, by the nearest package.json, and the desktop
    # package's own says `"type": "module"`: without this the CJS bundle is read as ESM and the app
    # dies on its first `require` before opening a window. electron-builder stages a package.json
    # into `build/app` for the same reason, and a checkout bundles into a temporary directory.
    echo '{ "type": "commonjs" }' > packages/desktop/assets/electron/package.json

    # The tree above is the WORKSPACE's: every member's dependencies plus the root's dev tooling
    # (release-please, oxlint, typescript, ts-migrate, …), which is what the app used to ship
    # — a ~950 MB store path that every `nix run`, Cachix push and snap carried. What the app runs
    # needs only @jxsuite/desktop's production graph, so it is installed again from the same
    # lockfile, against the same registry shim, with nothing else in it. The build outputs are
    # files under packages/, untouched by this.
    find . -maxdepth 3 -name node_modules -type d -prune -exec rm -rf {} +
    bun install \
      --registry "http://localhost:${registryPort}" \
      --frozen-lockfile \
      --linker=hoisted \
      --ignore-scripts \
      --production \
      --filter '@jxsuite/desktop'

    kill $shimPid 2>/dev/null || true
    trap - EXIT

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/jx-studio $out/bin

    # Preserve workspace structure so Bun's symlink-based resolution works
    cp -r node_modules $out/lib/jx-studio/
    cp -r packages $out/lib/jx-studio/packages

    # `extensions/` is RUNTIME, not dev-only. @jxsuite/{parser,auth,connector,search}
    # live there and node_modules/@jxsuite/parser is a symlink to
    # ../../extensions/parser; `packages/desktop` declares it as a dependency.
    # Copying only `packages` left that link dangling, the prune below then
    # deleted it, and the schema loader — which by design refuses to read a
    # first-party @jxsuite/* schema from the PROJECT's node_modules — had
    # nowhere left to read the parser's project fragment from. Every project
    # declaring any extension lost its per-project Monaco schemas with a stack
    # trace in the log.
    cp -r extensions $out/lib/jx-studio/extensions

    # bun links every workspace member into node_modules, including ones the
    # desktop app doesn't ship (examples, sites/*). We copy `packages` and
    # `extensions`, so prune what is left dangling rather than haul in dev-only
    # code. Anything a shipped package DEPENDS ON must be copied above first:
    # this line deletes, it does not warn.
    find $out/lib/jx-studio/node_modules -xtype l -delete

    ${lib.concatMapStringsSep "\n    " (p: "rm -rf $out/lib/jx-studio/node_modules/${p}") bundledIntoStudio}
    rm -rf $out/lib/jx-studio/packages/*/tests $out/lib/jx-studio/extensions/*/tests

    # Electron is the root process and owns every window; the Bun backend is its child and owns
    # every project (specs/desktop.md §9.7). The windows are frameless, so Studio draws its own
    # titlebar and window buttons (§9.5). Chromium stays for the site import's headless browser,
    # which puppeteer cannot drive in Electron.
    #
    # `--class` is X11's WM_CLASS; the Wayland app_id comes from the app itself. Electron 38 and
    # later run native Wayland in a Wayland session without being asked, so there is no Ozone flag.
    # A project path the user gives (`jx-studio ./site`) lands after these flags, which is where
    # the app reads it from.
    makeWrapper ${electron}/bin/electron $out/bin/jx-studio \
      --add-flags "--class=jx-studio" \
      --add-flags "$out/lib/jx-studio/packages/desktop/assets/electron/app-main.js" \
      --add-flags "--jx-bun=${bun}/bin/bun" \
      --add-flags "--jx-backend=$out/lib/jx-studio/packages/desktop/src/hub/main.ts" \
      --add-flags "--jx-preload=$out/lib/jx-studio/packages/desktop/assets/electron/preload.js" \
      --add-flags "--jx-icon=$out/lib/jx-studio/packages/desktop/icon.png" \
      --set CHROMIUM_BIN "${chromium}/bin/chromium" \
      --set JX_STUDIO_ASSETS "$out/lib/jx-studio/packages/desktop/assets/studio"

    # Installed by hand rather than through `desktopItems`, because that hook takes the STORE PATH's
    # basename — so the entry shipped as `<hash>-jx-studio.desktop`, an id that changed with every
    # rebuild and matched no window. A launcher reads the file and shows Name + Icon either way,
    # which is why the icon appeared there and nowhere else; anything resolving a window to an entry
    # by id had nothing stable to find.
    install -Dm644 packages/desktop/jx-studio.desktop $out/share/applications/jx-studio.desktop

    install -Dm644 packages/desktop/icon.png $out/share/icons/hicolor/512x512/apps/jx-studio.png
    install -Dm644 branding/jx_flattened.svg $out/share/icons/hicolor/scalable/apps/jx-studio.svg

    runHook postInstall
  '';

  # The installed tree is a production install with two libraries pruned by hand, so prove the
  # backend still resolves against it: Bun's bundler walks every static import from the entry and
  # fails on the first one with nothing on disk to answer it. That is how an undeclared runtime
  # dependency surfaces (@jxsuite/server imported oxfmt without declaring it, and only the root's
  # dev tooling ever provided it) and how a too-eager prune would, here rather than on a user's
  # machine. The backend runs from source against this tree: it is the process every window's
  # project lives in, and an undeclared dependency would otherwise fail on the first window a user
  # opens.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    bun build $out/lib/jx-studio/packages/desktop/src/hub/main.ts \
      --target=bun \
      ${lib.concatMapStringsSep " " (e: "--external ${e}") resolveExternals} \
      --outfile "$TMPDIR/hub-check.js"
    # The application's bundle was made at build time; prove it is the app and not an empty file,
    # and that nothing of this repository's was left outside it for the runtime to look for.
    app=$out/lib/jx-studio/packages/desktop/assets/electron
    test -s $app/app-main.js
    test -s $app/preload.js
    grep -q second-instance $app/app-main.js
    grep -q '"type": "commonjs"' $app/package.json
    bun -e '
      const { builtinModules } = require("node:module");
      const { readFileSync } = require("node:fs");
      const code = process.argv.slice(1).map((file) => readFileSync(file, "utf8")).join("\n");
      const outside = [...new Set([...code.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))]
        .filter((name) => name !== "electron" && !builtinModules.includes(name.replace(/^node:/, "")));
      if (outside.length > 0) {
        console.error("the Electron bundle requires modules that are not electron or a Node builtin: " + outside.join(", "));
        process.exit(1);
      }
    ' $app/app-main.js $app/preload.js
    runHook postInstallCheck
  '';

  meta = {
    description = "Jx Studio — visual JSON component editor";
    homepage = "https://jxsuite.com";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
