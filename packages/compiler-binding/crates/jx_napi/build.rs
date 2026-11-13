//! Links the addon against Node-API.

fn main() {
    napi_build::setup();
    println!("cargo:rerun-if-env-changed=JX_ADDON_VERSION");
}
