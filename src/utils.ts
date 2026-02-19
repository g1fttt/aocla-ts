import { resolve as resolvePath } from "node:path"

export function extractModuleName(modulePath: string): string {
  const moduleFilename = modulePath.split("/").at(-1)?.split(".")!

  if (moduleFilename.length > 2 || !moduleFilename[0]) {
    throw new Error("Module name has invalid naming style")
  }

  return moduleFilename[0]!
}

export function extractModuleParentPath(modulePath: string): string {
  const lastSlashIndex = modulePath.lastIndexOf("/")

  // prettier-ignore
  const parentPath = lastSlashIndex === -1
      ? "./" + modulePath
      : modulePath.slice(0, lastSlashIndex)

  return resolvePath(parentPath)
}
