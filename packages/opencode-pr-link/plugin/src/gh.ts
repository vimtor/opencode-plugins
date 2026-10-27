import { execFile } from "node:child_process"
import { existsSync } from "node:fs"

type ExecError = Error & { code?: string | number; stderr?: string }

export type Problem = { variant: "warning" | "error"; title: string; message: string }
export type Lookup = { url: string } | { problem: Problem }

function findPullRequest(directory: string, env?: NodeJS.ProcessEnv) {
  return new Promise<string>((resolve, reject) => {
    execFile("gh", ["pr", "view", "--json", "url", "--jq", ".url"], { cwd: directory, env, timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stderr }))
      resolve(stdout.trim())
    })
  })
}

function describe(error: ExecError, directory: string): Problem {
  if (error.code === "ENOENT") {
    return { variant: "error", title: "GitHub CLI not found", message: "Install gh to open pull requests." }
  }
  const stderr = error.stderr ?? ""
  const branch = stderr.match(/no pull requests found for branch "(.+)"/)?.[1]
  if (branch) return { variant: "warning", title: "No pull request", message: `Branch ${branch} has no pull request.` }
  if (/not a git repository/i.test(stderr)) {
    return { variant: "warning", title: "Not a Git repository", message: directory }
  }
  if (/not on any branch/i.test(stderr)) {
    return { variant: "warning", title: "No branch checked out", message: "Check out a branch to open its pull request." }
  }
  if (stderr.includes("gh auth login")) {
    return { variant: "error", title: "GitHub CLI not signed in", message: "Run gh auth login to open pull requests." }
  }
  const line = stderr.split("\n").map((line) => line.trim()).find(Boolean)
  return { variant: "error", title: "Could not open pull request", message: line || error.message }
}

// Finds the pull request of the branch checked out in `directory`. `format` shows the directory in messages.
export async function lookup(directory: string, format: (path: string) => string, env?: NodeJS.ProcessEnv): Promise<Lookup> {
  if (!existsSync(directory)) {
    return { problem: { variant: "warning", title: "Directory not found", message: format(directory) } }
  }
  let url: string
  try {
    url = await findPullRequest(directory, env)
  } catch (error) {
    return { problem: describe(error as ExecError, format(directory)) }
  }
  if (!url) return { problem: { variant: "error", title: "Could not open pull request", message: "GitHub CLI returned no URL." } }
  return { url }
}
