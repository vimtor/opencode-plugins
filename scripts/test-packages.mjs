import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const directory = mkdtempSync(join(tmpdir(), "opencode-plugins-packages-"))

try {
  const manifests = [...new Bun.Glob("packages/*/package.json").scanSync({ cwd: root, absolute: true })].sort()
  const dependencies = {}
  for (const manifest of manifests) {
    const workspace = dirname(manifest)
    const { name } = JSON.parse(readFileSync(manifest, "utf8"))
    const tarball = join(directory, `${name.replaceAll("/", "-")}.tgz`)
    execFileSync(process.execPath, ["pm", "pack", "--ignore-scripts", "--filename", tarball], {
      cwd: workspace,
      stdio: "inherit",
    })
    dependencies[name] = `file:${tarball}`
    cpSync(join(workspace, "test"), join(directory, "test", name), { recursive: true })
  }
  writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }))
  execFileSync(process.execPath, [
    "install", "--ignore-scripts", "--linker", "hoisted",
  ], { cwd: directory, stdio: "inherit" })
  execFileSync(process.execPath, ["test", "./test"], { cwd: directory, stdio: "inherit" })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
