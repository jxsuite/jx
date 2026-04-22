/**
 * Rpc-schema.js — Shared RPC type definitions for ElectroBun bridge
 *
 * Defines the contract between the Bun process (file I/O, native dialogs) and the webview (Studio
 * UI). Both sides import these typedefs so editors can verify handler signatures and proxy calls.
 *
 * See spec/desktop.md §7 for the architecture overview.
 */

// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   name: string;
 *   path: string;
 *   type: "file" | "directory";
 *   size?: number;
 *   modified?: string;
 * }} DirEntry
 */

/**
 * @typedef {{
 *   tagName: string;
 *   $id?: string | null;
 *   path: string;
 *   props?: { name: string; type?: string; default?: unknown }[];
 *   hasElements?: boolean;
 * }} ComponentMeta
 */

/** @typedef {{ name?: string; url?: string; [key: string]: unknown }} SiteConfig */

/** @typedef {{ root: string; name: string; projectConfig: SiteConfig }} ProjectHandle */

/** @typedef {{ config: SiteConfig; handle: ProjectHandle }} OpenProjectResult */

/** @typedef {{ code?: string; diagnostics?: unknown[]; [key: string]: unknown }} CodeServiceResult */

// ─── RPC Schema ───────────────────────────────────────────────────────────────
// ElectroBun's defineRPC is generic over a schema type. In JS we can't express
// the full generic, but we export the schema shape as a @typedef so that
// handler files and the platform adapter can reference the domain types above.

/**
 * @typedef {object} StudioRPCBunRequests
 * @property {{ params: void; response: OpenProjectResult | null }} openProject - Open a project via
 *   native dialog
 * @property {{ params: { dir: string }; response: DirEntry[] }} listDirectory - List directory
 *   contents
 * @property {{ params: { path: string }; response: string }} readFile - Read file contents as
 *   string
 * @property {{ params: { path: string; content: string }; response: void }} writeFile - Write
 *   content to a file
 * @property {{ params: { path: string }; response: void }} deleteFile - Delete a file
 * @property {{ params: { from: string; to: string }; response: void }} renameFile - Rename or move
 *   a file
 * @property {{ params: { path: string }; response: void }} createDirectory - Create a directory
 * @property {{ params: { dir?: string }; response: ComponentMeta[] }} discoverComponents - Discover
 *   available components
 * @property {{ params: { action: string; payload: unknown }; response: CodeServiceResult | null }} codeService -
 *   Run a code service action
 * @property {{ params: { name: string }; response: string | null }} locateFile - Locate a file by
 *   name
 * @property {{
 *   params: { src: string; prototype?: string; base?: string };
 *   response: unknown | null;
 * }} fetchPluginSchema
 *   - Fetch schema for a plugin
 */

export {};
