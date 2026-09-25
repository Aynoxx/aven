import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomic } from "./atomic-file.js"

// Sans dépendance à Electron : testable avec Node seul.

function file(workspace: string) {
  return path.join(workspace, ".opencode-app", "archived.json")
}

function read(workspace: string): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(file(workspace), "utf8")) as string[])
  } catch {
    return new Set()
  }
}

function write(workspace: string, ids: Set<string>) {
  mkdirSync(path.dirname(file(workspace)), { recursive: true })
  writeJsonAtomic(file(workspace), [...ids])
}

export function isArchived(workspace: string, id: string): boolean {
  return read(workspace).has(id)
}

export function listArchived(workspace: string): Set<string> {
  return read(workspace)
}

export function setArchived(workspace: string, id: string, archived: boolean) {
  const ids = read(workspace)
  if (archived) ids.add(id)
  else ids.delete(id)
  write(workspace, ids)
}
