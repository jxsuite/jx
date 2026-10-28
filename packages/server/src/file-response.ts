/**
 * File responses on `node:fs`, answering what `new Response(Bun.file(path))` answered.
 *
 * The desktop backend runs on Electron's Node (specs/desktop.md §7.1), so the servers it reaches
 * cannot hand `Bun.file` to a `Response`. `openAsBlob` is the shared equivalent: a lazily read,
 * file-backed `Blob` whose `type` becomes the response's `Content-Type`. What it lacks is Bun's
 * inference of that type from the extension, which {@link HOST_MEDIA_TYPES} reproduces for every
 * extension a project or the Studio assets serve; `tests/file-response.test.ts` holds each entry
 * equal to `Bun.file(...).type`. The corrections Jx makes to a host's table (`mediaTypeForPath`)
 * are applied by callers on top of this, exactly as they were on top of Bun's.
 *
 * @docs studio/desktop
 */
import { openAsBlob, statSync } from "node:fs";
import { extname } from "node:path";

/** The type `Bun.file` infers for an extension, where it is not `application/octet-stream`. */
export const HOST_MEDIA_TYPES = new Map<string, string>([
  [".7z", "application/x-7z-compressed"],
  [".aac", "audio/x-aac"],
  [".ai", "application/postscript"],
  [".apng", "image/apng"],
  [".atom", "application/atom+xml"],
  [".avif", "image/avif"],
  [".bmp", "image/x-ms-bmp"],
  [".cjs", "text/javascript;charset=utf-8"],
  [".class", "application/java-vm"],
  [".css", "text/css;charset=utf-8"],
  [".csv", "text/csv"],
  [".dmg", "application/x-apple-diskimage"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".eot", "application/vnd.ms-fontobject"],
  [".eps", "application/postscript"],
  [".epub", "application/epub+zip"],
  [".exe", "application/x-msdownload"],
  [".flac", "audio/x-flac"],
  [".gif", "image/gif"],
  [".glb", "model/gltf-binary"],
  [".gltf", "model/gltf+json"],
  [".gz", "application/gzip"],
  [".hbs", "text/x-handlebars-template"],
  [".heic", "image/heic"],
  [".htm", "text/html;charset=utf-8"],
  [".html", "text/html;charset=utf-8"],
  [".ico", "image/x-icon"],
  [".ics", "text/calendar"],
  [".iso", "application/x-iso9660-image"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript;charset=utf-8"],
  [".json", "application/json;charset=utf-8"],
  [".jsonld", "application/ld+json"],
  [".jsx", "text/javascript;charset=utf-8"],
  [".log", "text/plain;charset=utf-8"],
  [".m4a", "audio/x-m4a"],
  [".map", "application/json;charset=utf-8"],
  [".markdown", "text/markdown"],
  [".md", "text/markdown"],
  [".mdx", "text/mdx"],
  [".mjs", "text/javascript;charset=utf-8"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".mts", "text/javascript;charset=utf-8"],
  [".oga", "audio/ogg"],
  [".ogg", "audio/ogg"],
  [".ogv", "video/ogg"],
  [".opus", "audio/ogg"],
  [".otf", "font/otf"],
  [".pdf", "application/pdf"],
  [".php", "application/x-httpd-php"],
  [".png", "image/png"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".psd", "image/vnd.adobe.photoshop"],
  [".rar", "application/x-rar-compressed"],
  [".rss", "application/rss+xml"],
  [".rtf", "text/rtf"],
  [".sh", "application/x-sh"],
  [".srt", "application/x-subrip"],
  [".svg", "image/svg+xml"],
  [".tar", "application/x-tar"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".toml", "application/toml"],
  [".ts", "text/javascript;charset=utf-8"],
  [".tsv", "text/tab-separated-values"],
  [".tsx", "text/javascript;charset=utf-8"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain;charset=utf-8"],
  [".vtt", "text/vtt"],
  [".wasm", "application/wasm"],
  [".wav", "audio/x-wav"],
  [".weba", "audio/webm"],
  [".webm", "video/webm"],
  [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xml", "application/xml"],
  [".yaml", "text/yaml"],
  [".yml", "text/yaml"],
  [".zip", "application/zip"],
]);

const FALLBACK_MEDIA_TYPE = "application/octet-stream";

/** The media type Bun would infer for `path` from its extension (case-insensitive). */
export function hostMediaType(path: string): string {
  return HOST_MEDIA_TYPES.get(extname(path).toLowerCase()) ?? FALLBACK_MEDIA_TYPE;
}

/** True when `path` names a regular file (Bun's `exists()` is false for a directory). */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The file at `path` as a lazily read `Blob` typed by its extension, or null when there is no
 * regular file there.
 */
export async function openFile(path: string): Promise<Blob | null> {
  if (!isFile(path)) {
    return null;
  }
  return openAsBlob(path, { type: hostMediaType(path) });
}

/** A response streaming the file at `path`, or null when there is no regular file there. */
export async function fileResponse(path: string, init?: ResponseInit): Promise<Response | null> {
  const blob = await openFile(path);
  return blob ? new Response(blob, init) : null;
}
