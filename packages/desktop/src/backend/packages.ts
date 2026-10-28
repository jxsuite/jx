import * as server from "@jxsuite/server/packages";
import type { PackageInfo, PackageOpResult, PackageVersionInfo } from "../shared/rpc-schema";

/** Build package operations bound to one project session (its projectRoot is the package cwd). */
export function createPackageOps(session: { readonly projectRoot: string | null }) {
  function requireRoot(): string {
    const root = session.projectRoot;
    if (!root) {
      throw new Error("No project open");
    }
    return root;
  }

  async function addPackage(params: { name: string }): Promise<void> {
    const res = await server.addPackage(requireRoot(), params.name);
    if (!res.ok) {
      throw new Error(`Failed to add package: ${res.log ?? "the installer gave no reason"}`);
    }
  }

  async function removePackage(params: { name: string }): Promise<void> {
    const res = await server.removePackage(requireRoot(), params.name);
    if (!res.ok) {
      throw new Error(`Failed to remove package: ${res.log ?? "the installer gave no reason"}`);
    }
  }

  async function listPackages(): Promise<PackageInfo[]> {
    const root = session.projectRoot;
    if (!root) {
      return [];
    }
    return server.listPackages(root);
  }

  async function installDependencies(): Promise<PackageOpResult> {
    return server.installDependencies(requireRoot());
  }

  async function dependenciesNeedInstall(): Promise<boolean> {
    const root = session.projectRoot;
    if (!root) {
      return false;
    }
    return server.dependenciesNeedInstall(root);
  }

  async function packageVersions(): Promise<PackageVersionInfo[]> {
    const root = session.projectRoot;
    if (!root) {
      return [];
    }
    return server.packageVersions(root);
  }

  async function setPackageVersions(params: {
    updates: { name: string; version: string; dev?: boolean }[];
  }): Promise<PackageOpResult> {
    return server.setPackageVersions(requireRoot(), params.updates);
  }

  return {
    addPackage,
    dependenciesNeedInstall,
    installDependencies,
    listPackages,
    packageVersions,
    removePackage,
    setPackageVersions,
  };
}
