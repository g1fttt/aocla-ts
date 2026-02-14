import { readFileSync } from "node:fs"

import { Context } from "./vm.ts"
import { PosError } from "./error.ts"

const args = process.argv.slice(2)

if (args.length < 1) {
  throw new Error("Not enough arguments: path is required")
}

const filePath = args[0]!
const fileContent = readFileSync(filePath, "utf-8")

const vmContext = new Context()

try {
  vmContext.eval(fileContent)
} catch (err) {
  // prettier-ignore
  const message = (err instanceof PosError)
    ? err.formattedMessage()
    : String(err)

  console.error(`${message}.`)
}
