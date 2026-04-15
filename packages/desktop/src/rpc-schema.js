/**
 * rpc-schema.js — Shared RPC type definitions for ElectroBun bridge
 *
 * Defines the contract between the Bun process (file I/O, native dialogs)
 * and the webview (Studio UI). Both sides import these typedefs so editors
 * can verify handler signatures and proxy calls.
 *
 * See spec/desktop.md §7 for the architecture overview.
 */

// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string; path: string; type: "file" | "directory"; size?: number; modified?: string }} DirEntry
 */

/**
 * @typedef {{ tagName: string; $id?: string | null; path: string; props?: Array<{ name: string; type?: string; default?: unknown }>; hasElements?: boolean }} ComponentMeta
 */

/**
 * @typedef {{ name?: string; url?: string; [key: string]: unknown }} SiteConfig
 */

/**
 * @typedef {{ root: string; name: string; siteConfig: SiteConfig }} ProjectHandle
 */

/**
 * @typedef {{ config: SiteConfig; handle: ProjectHandle }} OpenProjectResult
 */

/**
 * @typedef {{ code?: string; diagnostics?: unknown[]; [key: string]: unknown }} CodeServiceResult
 */

// ─── RPC Schema ───────────────────────────────────────────────────────────────
// ElectroBun's defineRPC is generic over a schema type. In JS we can't express
// the full generic, but we export the schema shape as a @typedef so that
// handler files and the platform adapter can reference the domain types above.

/**
 * @typedef {object} StudioRPCBunRequests
 * @property {{ params: void; response: OpenProjectResult | null }} openProject
 * @property {{ params: { dir: string }; response: DirEntry[] }} listDirectory
 * @property {{ params: { path: string }; response: string }} readFile
 * @property {{ params: { path: string; content: string }; response: void }} writeFile
 * @property {{ params: { path: string }; response: void }} deleteFile
 * @property {{ params: { from: string; to: string }; response: void }} renameFile
 * @property {{ params: { path: string }; response: void }} createDirectory
 * @property {{ params: { dir?: string }; response: ComponentMeta[] }} discoverComponents
 * @property {{ params: { action: string; payload: unknown }; response: CodeServiceResult | null }} codeService
 * @property {{ params: { name: string }; response: string | null }} locateFile
 * @property {{ params: { src: string; prototype?: string; base?: string }; response: unknown | null }} fetchPluginSchema
 */

export {};
