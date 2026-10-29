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

  # The packages the backend bundle leaves external because they load files of their own by path
  # (`BACKEND_NATIVES` in scripts/lib/backend-bundle.ts, held equal by tests/backend-bundle.test.ts).
  # The installers stage them beside the bundle; here they resolve from the production install the
  # bundle sits in, and the install check proves they do.
  backendNatives = [
    "esbuild"
    "sharp"
    "@npmcli/arborist"
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
    # nothing from node_modules at runtime. The backend is bundled here too, by the function the
    # installers use (scripts/lib/backend-bundle.ts), and runs on Electron's own Node as a utility
    # process (specs/desktop.md §7.1); its native packages resolve from the production install below.
    bun build \
      packages/desktop/src/main/app-main.ts \
      packages/desktop/src/preload/preload.ts \
      --target=node --format=cjs --external electron \
      --entry-naming '[name].[ext]' \
      --outdir packages/desktop/assets/electron
    # `--entry-naming` keeps the two flat: the entry points live in different directories
    # (src/main, src/preload), and Bun's default `[dir]/[name]` would nest them under `main/` and
    # `preload/`, where neither the wrapper below nor the install check looks.
    # Electron loads `app-main.js` as Node does, by the nearest package.json, and the desktop
    # package's own says `"type": "module"`: without this the CJS bundle is read as ESM and the app
    # dies on its first `require` before opening a window. electron-builder stages a package.json
    # into `build/app` for the same reason, and a checkout bundles into a temporary directory.
    echo '{ "type": "commonjs" }' > packages/desktop/assets/electron/package.json
    bun run --cwd packages/desktop scripts/bundle-backend.ts assets/backend

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

    # `extensions/` is not copied: the app depends on no extension. A project resolves
    # every extension it enables, first-party ones included, from its own install.

    # bun links every workspace member into node_modules, including ones the
    # desktop app doesn't ship (examples, sites/*, extensions/*). We copy `packages`,
    # so prune what is left dangling rather than haul in dev-only
    # code. Anything a shipped package DEPENDS ON must be copied above first:
    # this line deletes, it does not warn.
    find $out/lib/jx-studio/node_modules -xtype l -delete

    ${lib.concatMapStringsSep "\n    " (p: "rm -rf $out/lib/jx-studio/node_modules/${p}") bundledIntoStudio}

    # sharp's prebuilt glibc binaries (the addon and the libvips it links) need libstdc++ and
    # libgcc_s, which a generic Linux finds in /usr/lib and NixOS has nowhere global. The addon's
    # RUNPATH only names libvips beside it, so the backend's `import("sharp")` failed with
    # ERR_DLOPEN_FAILED under Electron's Node and image optimization was silently off. Adding the
    # compiler's runtime library to just these files fixes them without putting an
    # LD_LIBRARY_PATH on Electron and every process it starts. The musl builds are never loaded on
    # glibc and are left alone.
    find $out/lib/jx-studio/node_modules -type f \( \
      -path '*/@img/sharp-linux-*/lib/*.node' -o -path '*/@img/sharp-libvips-linux-*/lib/*.so*' \
    \) -print0 | while IFS= read -r -d "" binary; do
      patchelf --add-rpath ${lib.getLib stdenv.cc.cc}/lib "$binary"
    done
    rm -rf $out/lib/jx-studio/packages/*/tests

    # Electron is the root process and owns every window; the backend is its utility process, on
    # Electron's own Node, and owns every project (specs/desktop.md §9.7). The windows are frameless, so Studio draws its own
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
      --add-flags "--jx-backend=$out/lib/jx-studio/packages/desktop/assets/backend/index.js" \
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
  # backend still finds what it loads at run time: the bundle is self-contained except for the
  # packages it leaves external, which must resolve from the bundle's own directory through this
  # tree. That is how a too-eager prune, or a native package nobody declared, surfaces here rather
  # than on a user's machine. Its data must be beside it, and it must hold no Bun code.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    backend=$out/lib/jx-studio/packages/desktop/assets/backend
    test -s $backend/index.js
    grep -q '"type":"module"' $backend/package.json
    test -d $backend/templates
    if grep -Eq '\bBun\.[A-Za-z]+' $backend/index.js; then
      echo "the backend bundle calls a Bun API; it runs on Electron's Node" >&2
      exit 1
    fi
    bun -e '
      const { createRequire } = require("node:module");
      const load = createRequire(process.argv[1] + "/index.js");
      for (const name of process.argv.slice(2)) load.resolve(name);
    ' $backend ${lib.concatStringsSep " " backendNatives}
    # Resolving is not loading: sharp resolves fine and then fails to dlopen its binary. Load it on
    # the Node the backend actually runs on, which is Electron's.
    ELECTRON_RUN_AS_NODE=1 ${electron}/bin/electron -e '
      const { createRequire } = require("node:module");
      createRequire(process.argv[1] + "/index.js")("sharp");
    ' $backend
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
