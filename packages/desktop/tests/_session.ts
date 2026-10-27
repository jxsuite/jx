/**
 * One project session for tests that drive the backend's handlers as free functions over a single
 * root: the session's handlers, its git operations and its package operations, all bound to it.
 *
 * The application never works this way. The hub creates a session per window
 * (`backend/window-hub.ts`); this is the test suite's shorthand for "a window, already open".
 */
import { createGitOps } from "../src/backend/git";
import { createPackageOps } from "../src/backend/packages";
import { createProjectSession } from "../src/backend/project-session";

export { pickProjectFile, setDirectoryDialog, setFileDialog } from "../src/backend/project-session";
export type { ProjectSession, ProxyResult, StudioSchema } from "../src/backend/project-session";

const session = createProjectSession(null);

export function setProjectRoot(root: string | null): void {
  session.setProjectRoot(root);
}

export function getProjectRoot(): string | null {
  return session.projectRoot;
}

export const {
  buildSite,
  clearPreviewOverlay,
  codeService,
  createProject,
  dataConnections,
  dataConnectionTest,
  dataDeleteRow,
  dataInsertRow,
  dataPush,
  dataRows,
  dataUpdateRow,
  discoverComponents,
  fetchPluginSchema,
  fetchProjectSchemas,
  findReferences,
  formatAction,
  handleCreateDirectory,
  handleDeleteFile,
  handleReadFile,
  handleReadFileBytes,
  handleRenameFile,
  handleResolveSiteContext,
  handleUploadFile,
  handleWriteFile,
  jxResolve,
  jxServerFunction,
  listDirectory,
  listExtensionCatalog,
  listExtensions,
  listFormats,
  listSecrets,
  locateFile,
  openExternal,
  openProject,
  previewSite,
  searchFiles,
  setFileEventSink,
  setPreviewOverlay,
  setSecrets,
} = session;

export const {
  gitAddRemote,
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitFetch,
  gitInit,
  gitLog,
  gitPull,
  gitPush,
  gitShow,
  gitStage,
  gitStatus,
  gitUnstage,
} = createGitOps(session);

export const {
  addPackage,
  dependenciesNeedInstall,
  installDependencies,
  listPackages,
  packageVersions,
  removePackage,
  setPackageVersions,
} = createPackageOps(session);
