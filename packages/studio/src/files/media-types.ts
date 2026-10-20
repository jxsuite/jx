/**
 * Which files are project media, by extension — the classification alone, with nothing imported.
 *
 * `files/media-upload.ts` owns uploading and re-exports these; they live here so a module that only
 * needs to ask "is this file media" (the collection matcher behind the Content workspace, which the
 * canvas resolver reads too) does not pull the upload core, the platform and the reference index in
 * behind the question.
 *
 * @docs studio/projects/media
 */

/** Extensions rendered as a thumbnail (media picker, cards, file-tree icons). */
export const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
]);

/** Extensions an upload places as a `<video>`. */
export const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

/** Extensions an upload places as an `<audio>`. */
export const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac"]);

/**
 * Every extension Studio treats as project media: a superset of {@link IMAGE_EXTENSIONS} and of
 * every extension classified as video or audio, so a file it classifies is one the media listing
 * shows.
 */
export const MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

/** Lowercased extension including the dot, or `""` when the name carries none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Whether a file extension (with or without the leading dot) is a previewable image. */
export function isImage(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
}
