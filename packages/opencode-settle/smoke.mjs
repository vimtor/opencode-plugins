import { readFileSync } from "node:fs"

const server = await import("./dist/server.js")
if (!server.default?.id || typeof server.default.setup !== "function") throw new Error("missing V2 plugin export")

// Evaluates the panel's bundle as the desktop app's main process does: solid-js/web, which needs a window, is an
// inert placeholder there.
const placeholder = new Proxy(function () {}, { get: () => placeholder, apply: () => placeholder, construct: () => placeholder })
const provided = {
  "solid-js": await import("solid-js"),
  "solid-js/web": placeholder,
  "@opencode/plugin/gui": await import("@opencode/plugin/gui"),
  "@opencode/plugin/rpc": await import("@opencode/plugin/rpc"),
}
const module = { exports: {} }
const require = (id) => {
  if (id in provided) return provided[id]
  throw new Error(`The app does not provide ${id}`)
}
new Function("module", "exports", "require", readFileSync(new URL("./dist/gui-experimental.cjs", import.meta.url), "utf8"))(
  module,
  module.exports,
  require,
)
if (typeof module.exports.default?.setup !== "function") throw new Error("missing GUI plugin export")
