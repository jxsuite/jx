// Fixture server module for runtime-gaps-resolve.test.ts (timing: "server"). Loading it at all
// Trips the flag, so a test can prove the runtime posted the call to the proxy without ever
// Importing the module in the browser.

(globalThis as { __jxTripwire?: boolean }).__jxTripwire = true;

export async function trip(args: Record<string, unknown>) {
  return { ranInProcess: true, args };
}
