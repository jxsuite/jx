import { resolve } from "node:path";
import { getProjectRoot } from "./handlers";
import type { PackageInfo } from "./rpc-schema";

export async function addPackage(params: { name: string }): Promise<void> {
  const proc = Bun.spawn(["bun", "add", params.name], {
    cwd: getProjectRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to add package: ${stderr.trim()}`);
  }
}

export async function removePackage(params: { name: string }): Promise<void> {
  const proc = Bun.spawn(["bun", "remove", params.name], {
    cwd: getProjectRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to remove package: ${stderr.trim()}`);
  }
}

export async function listPackages(): Promise<PackageInfo[]> {
  const pkgPath = resolve(getProjectRoot(), "package.json");
  const file = Bun.file(pkgPath);
  if (!(await file.exists())) return [];

  const pkg = await file.json();
  const deps = pkg.dependencies || {};
  return Object.entries(deps).map(([name, version]) => ({
    name,
    version: version as string,
  }));
}
