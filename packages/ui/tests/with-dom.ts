/** Register happy-dom before anything touches `document`. Import this first in every DOM test. */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

// The popover API happy-dom lacks, for the overlays built on it.
const { installPopoverShim } = await import("../src/testing/popover-shim.ts");
installPopoverShim();
