import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"

import arg from "arg"

import { extractParentPath } from "./utils.ts"

const args = arg({
  "--command": String,

  "-c": "--command",
})

const command = args["--command"]

if (command) {
  // evalContent(command, null)

  process.exit(0)
}

if (args._.length < 1) {
  console.error("Missing path")

  process.exit(1)
}

const filePath = args._[0]!
const [fileContent, rootModulePath] = readFile(filePath)

// evalContent(fileContent, rootModulePath)

// function evalContent(content: string, rootModulePath: string | null) {
//   const virtualMachine = new VirtualMachine(rootModulePath)
//
//   try {
//     virtualMachine.evalString(content)
//   } catch (err) {
//     const isFormattedError = (x: any): x is AoclaError => "formattedString" in x
//
//     const message = isFormattedError(err) ? err.formattedString() : String(err)
//
//     console.error(message)
//   }
// }

function readFile(filePath: string): [string, string] {
  const fileContent = readFileSync(filePath, "utf-8")
  const rootModulePath = extractParentPath(resolvePath(filePath))

  return [fileContent, rootModulePath]
}
