/**
 * rpc-schema.ts — Shared RPC type definitions for ElectroBun bridge
 *
 * Defines the contract between the Bun process (file I/O, native dialogs)
 * and the webview (Studio UI). Both sides import this schema so TypeScript
 * can verify handler signatures and proxy calls at compile time.
 *
 * See spec/desktop.md §7 for the architecture overview.
 */

import type { ElectrobunRPCSchema } from "electrobun";

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
}

export interface ComponentMeta {
  tagName: string;
  $id?: string | null;
  path: string;
  props?: Array<{ name: string; type?: string; default?: unknown }>;
  hasElements?: boolean;
}

export interface SiteConfig {
  name?: string;
  url?: string;
  [key: string]: unknown;
}

export interface ProjectHandle {
  root: string;
  name: string;
  siteConfig: SiteConfig;
}

export interface OpenProjectResult {
  config: SiteConfig;
  handle: ProjectHandle;
}

export interface CodeServiceResult {
  code?: string;
  diagnostics?: unknown[];
  [key: string]: unknown;
}

// ─── RPC Schema ───────────────────────────────────────────────────────────────

export type StudioRPCSchema = ElectrobunRPCSchema & {
  /**
   * Bun-side handlers — requests the webview can call on the Bun process.
   * These map 1:1 to the StudioPlatform interface from spec/desktop.md §3.
   */
  bun: {
    requests: {
      openProject: {
        params: void;
        response: OpenProjectResult | null;
      };
      listDirectory: {
        params: { dir: string };
        response: DirEntry[];
      };
      readFile: {
        params: { path: string };
        response: string;
      };
      writeFile: {
        params: { path: string; content: string };
        response: void;
      };
      deleteFile: {
        params: { path: string };
        response: void;
      };
      renameFile: {
        params: { from: string; to: string };
        response: void;
      };
      createDirectory: {
        params: { path: string };
        response: void;
      };
      discoverComponents: {
        params: { dir?: string };
        response: ComponentMeta[];
      };
      codeService: {
        params: { action: string; payload: unknown };
        response: CodeServiceResult | null;
      };
      locateFile: {
        params: { name: string };
        response: string | null;
      };
      fetchPluginSchema: {
        params: { src: string; prototype?: string; base?: string };
        response: unknown | null;
      };
    };
    messages: {};
  };

  /**
   * Webview-side handlers — requests the Bun process can call on the webview.
   * Currently empty — the Bun process does not initiate calls to the UI.
   * Reserved for future features like file-watcher notifications.
   */
  webview: {
    requests: {};
    messages: {
      fileChanged: { path: string };
    };
  };
};
