export async function openFileDialog(): Promise<string | null> {
  // 1. Generate a unique token so we dictate the exact request object path
  const uniqueToken = `bun_portal_${Math.random().toString(36).substring(2, 11)}`;

  // 2. Fetch our D-Bus sender ID to reconstruct the predictable request path
  const idCall = Bun.spawn(
    [
      "gdbus",
      "call",
      "--session",
      "--dest",
      "org.freedesktop.DBus",
      "--object-path",
      "/org/freedesktop/DBus",
      "--method",
      "org.freedesktop.DBus.GetNameOwner",
      "org.freedesktop.portal.Desktop",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  await idCall.exited;
  const idStdout = (await new Response(idCall.stdout).text()).trim();
  const senderNumber = idStdout.match(/:(\d+)\.(\d+)/);
  if (!senderNumber) throw new Error("Could not resolve D-Bus sender ID");

  const formattedSender = `${senderNumber[1]}_${senderNumber[2]}`;
  const targetRequestPath = `/org/freedesktop/portal/desktop/request/${formattedSender}/${uniqueToken}`;

  // 3. Start the monitor FIRST so it's listening before the dialog opens
  const monitor = Bun.spawn(
    [
      "gdbus",
      "monitor",
      "--session",
      "--dest",
      "org.freedesktop.portal.Desktop",
      "--object-path",
      targetRequestPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  // 4. Fire the OpenFile call with our handle_token
  const call = Bun.spawn(
    [
      "gdbus",
      "call",
      "--session",
      "--dest",
      "org.freedesktop.portal.Desktop",
      "--object-path",
      "/org/freedesktop/portal/desktop",
      "--method",
      "org.freedesktop.portal.FileChooser.OpenFile",
      "",
      "Select Project",
      `{'directory': <boolean true>, 'modal': <boolean true>, 'handle_token': <'${uniqueToken}'>}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  await call.exited;

  // 5. Read the monitor output until we get a Response signal
  const reader = monitor.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = setTimeout(() => monitor.kill(), 60_000);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (buffer.includes("Response")) {
        const statusMatch = buffer.match(/uint32\s+([1-2])/);
        if (statusMatch) return null;

        const uriMatch = buffer.match(/file:\/\/([^']+)/);
        if (uriMatch) return decodeURIComponent(uriMatch[1]);
      }
    }
  } finally {
    clearTimeout(timeout);
    monitor.kill();
  }

  return null;
}
