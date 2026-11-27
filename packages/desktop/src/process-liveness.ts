/** Whether a process id still resolves, shared by the lockfile and anything else asking. */

/**
 * Whether `pid` names a live process. Our own pid is alive, and `EPERM` means the process exists
 * but belongs to someone else.
 */
export function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
