/**
 * A live project state subscription for a cache's test (`project-state.md` §11.1): a host on the
 * protocol's reference log, subscribed through `startProjectStateSync` so the window's content
 * store follows it and `projectStateLive()` is true, as Studio runs it.
 */
import {
  answerSubscribe,
  contentHash,
  createMemoryEventLog,
} from "@jxsuite/protocol/project-state";
import type { IndexedFile, ProjectEventInit } from "@jxsuite/protocol/project-state";
import type { ProjectStateListener } from "@jxsuite/protocol/project-state-frames";
import {
  projectStateLive,
  startProjectStateSync,
  stopProjectStateSync,
} from "../src/project-state/subscription";
import { contentStore } from "../src/project-state/store";

/** Let the subscription apply what it was sent. */
export async function settleLive(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resume) => {
      setTimeout(resume, 0);
    });
  }
}

/** Start a host holding `files` (path → [docId, text]) and subscribe the window's store to it. */
export async function startLiveProjectState(
  files: Record<string, [docId: string, text: string]>,
  options: { formats?: string } = {},
) {
  const log = createMemoryEventLog({ epoch: "e1" });
  const index = new Map<string, IndexedFile>();
  let formats = options.formats ?? "f1";
  for (const [path, [docId, text]] of Object.entries(files)) {
    index.set(path, {
      docId,
      hash: await contentHash(text),
      indexed: true,
      isDir: false,
      kind: "other",
      path,
    });
  }
  let listener: ProjectStateListener | null = null;
  const emit = (init: ProjectEventInit) => {
    const event = log.append(init);
    listener?.events({ epoch: log.epoch, events: [event] });
  };
  contentStore.reset();
  startProjectStateSync({
    subscribeProjectState: async (request, next) => {
      listener = next;
      return answerSubscribe(log, request, () => ({
        components: [],
        files: [...index.values()],
        formats,
        readiness: "ready",
      }));
    },
  });
  await settleLive();
  if (!projectStateLive()) {
    throw new Error("the subscription did not go live");
  }
  return {
    /** Another writer rewrote `path`: its file event and its `docChanged`. */
    async change(path: string, text: string) {
      const { docId } = index.get(path)!;
      const hash = await contentHash(text);
      index.set(path, { ...index.get(path)!, hash });
      emit({ docId, hash, origin: "external", path, type: "fileChanged" });
      emit({
        docId,
        hash,
        indexed: true,
        kind: "other",
        origin: "external",
        path,
        type: "docChanged",
      });
      await settleLive();
    },
    /** The same bytes, newly indexed: the host filling in what it learned. */
    async refill(path: string) {
      const file = index.get(path)!;
      emit({
        docId: file.docId,
        hash: file.hash!,
        indexed: true,
        kind: "other",
        origin: "external",
        path,
        type: "docChanged",
      });
      await settleLive();
    },
    async rename(from: string, to: string) {
      const file = index.get(from)!;
      index.delete(from);
      index.set(to, { ...file, path: to });
      emit({ docId: file.docId, from, isDir: false, origin: "external", to, type: "fileRenamed" });
      await settleLive();
    },
    async remove(path: string) {
      const file = index.get(path)!;
      index.delete(path);
      emit({ docId: file.docId, isDir: false, origin: "external", path, type: "fileRemoved" });
      await settleLive();
    },
    async formatsChanged(next: string) {
      formats = next;
      emit({ formats: next, origin: "external", type: "formatsChanged" });
      await settleLive();
    },
    stop() {
      stopProjectStateSync();
      contentStore.reset();
    },
  };
}
