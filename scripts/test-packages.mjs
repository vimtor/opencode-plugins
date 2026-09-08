import { execFileSync } from "node:child_process"
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const directory = mkdtempSync(join(tmpdir(), "opencode-plugins-v2-"))

try {
  const packed = JSON.parse(execFileSync("npm", [
    "pack", "--workspaces", "--ignore-scripts", "--json", "--pack-destination", directory,
  ], { cwd: root, encoding: "utf8" }))
  writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }))
  execFileSync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund",
    ...packed.map((item) => join(directory, item.filename)),
  ], { cwd: directory, stdio: "inherit" })
  copyFileSync(join(root, "tests/plugins.test.mjs"), join(directory, "plugins.test.mjs"))
  execFileSync(process.execPath, ["--test", "plugins.test.mjs"], { cwd: directory, stdio: "inherit" })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
