import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"

import arg from "arg"

import { Tokenizer, TokenKind } from "./tokenizer.ts"
import { Context } from "./vm.ts"
import { type FormattedError } from "./error.ts"
import { extractModuleParentPath } from "./utils.ts"

const args = arg({
  "--token-list": Boolean,

  "-t": "--token-list",
})

if (args._.length < 1) {
  console.error("Missing path")
  process.exit(1)
}

const filePath = args._[0]!
const [fileContent, rootModulePath] = readFile(filePath)

if (args["--token-list"]) {
  printTokenList(fileContent)
} else {
  evalFile(fileContent, rootModulePath)
}

function printTokenList(source: string) {
  const t = new Tokenizer(source)
  const tokens = t.extractTokens()

  for (const token of tokens) {
    console.log(`\n${token.string} = ${TokenKind[token.kind]};`)
  }
}

function evalFile(fileContent: string, rootModulePath: string) {
  const vmContext = new Context(rootModulePath)

  try {
    vmContext.evalString(fileContent)
  } catch (err) {
    const isFormattedError = (x: any): x is FormattedError =>
      "formattedMessage" in x

    const message = isFormattedError(err) ? err.formattedMessage() : String(err)

    console.error(message)
  }
}

function readFile(filePath: string): [string, string] {
  const fileContent = readFileSync(filePath, "utf-8")
  const rootModulePath = extractModuleParentPath(resolvePath(filePath))

  return [fileContent, rootModulePath]
}
