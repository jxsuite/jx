/**
 * A project file as an editing host answers it, which for a `.jxn` document is JSON.
 *
 * The runtime fetches a `$ref`, a `Jx()` source or an `$elements` entry and reads the body as JSON
 * on every origin (`spec.md` §23.2), so every host that serves a project's documents answers a
 * `.jxn` one as the JSON it parses to, exactly as a site origin does (`@jxsuite/site` `serve.ts`).
 * The dev server did and the desktop loopback did not: it streamed the KDL source typed
 * `application/octet-stream`, and a component preview in Studio's own window, which installs no KDL
 * parser of its own until it asks for one, failed on every starter component.
 *
 * Editing a file's SOURCE never goes through this lane. Studio reads text through the platform
 * (`/__studio/file` on the dev server, the `readFile` RPC on desktop), so answering JSON here takes
 * nothing away from the Code view.
 *
 * @docs framework/concepts/jxn-files
 */
import { isJxnPath } from "@jxsuite/schema/jxn";
import { jxnAsJson } from "@jxsuite/site/serve";
import { fileResponse, openFile } from "./file-response.ts";

/**
 * The response for the project file at `path`, or null when there is no regular file there. A
 * `.jxn` document answers JSON (422 with the reason when it does not parse); anything else streams
 * as {@link fileResponse} does.
 *
 * @param path An absolute path the caller has already contained.
 * @param headers The headers for a `.jxn` answer of a media type; the site origin's by default.
 */
export async function projectFileResponse(
  path: string,
  headers?: (type: string) => HeadersInit,
): Promise<Response | null> {
  if (!isJxnPath(path)) {
    return fileResponse(path);
  }
  const blob = await openFile(path);
  if (!blob) {
    return null;
  }
  return jxnAsJson(new Uint8Array(await blob.arrayBuffer()), path, headers);
}
