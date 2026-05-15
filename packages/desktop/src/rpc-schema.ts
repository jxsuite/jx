import type { RPCSchema } from "electrobun/bun";

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
  props?: { name: string; type?: string; default?: unknown }[];
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
  projectConfig: SiteConfig;
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

export type StudioRPC = {
  bun: RPCSchema<{
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
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      fileChanged: { path: string };
    };
  }>;
};
