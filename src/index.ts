import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"

import { Context } from "./vm.ts"
import { type FormattedError } from "./error.ts"
import { extractModuleParentPath } from "./utils.ts"

const args = process.argv.slice(2)

if (args.length < 1) {
  throw new Error("Not enough arguments: path is required")
}

const filePath = args[0]!
const fileContent = readFileSync(filePath, "utf-8")

const rootModulePath = extractModuleParentPath(resolvePath(filePath))

const vmContext = new Context(rootModulePath)

try {
  vmContext.eval(fileContent)
} catch (err) {
  const isFormattedError = (x: any): x is FormattedError =>
    "FormattedError" in x

  const message = isFormattedError(err) ? err.formattedMessage() : String(err)

  console.error(message)
}
