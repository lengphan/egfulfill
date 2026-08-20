// Metro only watches the project root, so web/shared/ — the order rules, imported by the
// web app as `@/shared/*` — is invisible to it without this. It lives under web/ because
// Turbopack CANNOT import across its pinned root (next.config.ts pins it to web/, and
// re-pinning it at the repo root is the config that silently broke hydration); Metro has no
// such limit, so the file sits where the stricter bundler needs it and the phone reaches out. watchFolders makes the files
// resolvable AND hot-reloadable; nodeModulesPaths keeps resolution pointed at the app's own
// node_modules so the shared file cannot drag in a second copy of react.
const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "..")

const config = getDefaultConfig(projectRoot)
config.watchFolders = [path.resolve(workspaceRoot, "web/shared")]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")]

module.exports = config
