import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"

import arg from "arg"

import { extractTokens, TokenKind } from "./tokenizer.ts"
import { VirtualMachine } from "./vm.ts"
import { extractModuleParentPath } from "./utils.ts"
import type { AoclaError } from "./error.ts"

const args = arg({
  "--token-list": Boolean,
  "--command": String,

  "-t": "--token-list",
  "-c": "--command",
})

const command = args["--command"]

if (command) {
  evalContent(command, null)

  process.exit(0)
}

if (args._.length < 1) {
  console.error("Missing path")
  process.exit(1)
}

const filePath = args._[0]!
const [fileContent, rootModulePath] = readFile(filePath)

const tokenList = args["--token-list"]

if (tokenList) {
  printTokenList(fileContent)
} else {
  evalContent(fileContent, rootModulePath)
}

function printTokenList(source: string) {
  const tokens = extractTokens(source)

  for (const token of tokens) {
    console.log(`\n${token.string} = ${TokenKind[token.kind]};`)
  }
}

function evalContent(content: string, rootModulePath: string | null) {
  const virtualMachine = new VirtualMachine(rootModulePath)

  try {
    virtualMachine.evalString(content)
  } catch (err) {
    const isFormattedError = (x: any): x is AoclaError => "formattedString" in x

    const message = isFormattedError(err) ? err.formattedString() : String(err)

    console.error(message)
  }
}

function readFile(filePath: string): [string, string] {
  const fileContent = readFileSync(filePath, "utf-8")
  const rootModulePath = extractModuleParentPath(resolvePath(filePath))

  return [fileContent, rootModulePath]
}
