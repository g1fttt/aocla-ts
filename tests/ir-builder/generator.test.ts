import { expect, test } from "vitest"

import { ByteCodeGenerator } from "@/ir-builder/generator.ts"
import { AstTransformer } from "@/ir-builder/transformer.ts"

import { CommandKind, ValueKind, type Command } from "@/ir-builder.ts"
import { parseString } from "@/parser.ts"

function generateByteCode(sourceCode: string): Array<Command> {
  const astSample = parseString(sourceCode)

  const transformer = new AstTransformer()
  const transformedAst = transformer.transform(astSample)

  const generator = new ByteCodeGenerator()

  return generator.generate(transformedAst)
}

test("linear generation", () => {
  const byteCode = generateByteCode("1337 #t 'symbol")

  expect(byteCode).toMatchObject([
    {
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.Number,
        value: 1337,
      },
    },
    {
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.Boolean,
        value: true,
      },
    },
    {
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.Symbol,
        value: { name: "symbol" },
      },
    },
  ])
})

test("recursive generation with jumps", () => {
  const byteCode = generateByteCode("2 [2 * [2 *] eval] eval")

  expect(byteCode).toMatchObject([
    {
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.Number,
        value: 2,
      },
    },
    {
      kind: CommandKind.PushCommandListInfoToStack,
      value: 7, // flattened commands + PushCommandListInfoToStack + RelativeJump
    },
    {
      kind: CommandKind.RelativeJump,
      value: 8,
    },
    {
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.Number,
        value: 2,
      },
    },
    { kind: CommandKind.Multiply },
    {
      kind: CommandKind.PushCommandListInfoToStack,
      value: 2,
    },
    {
      kind: CommandKind.RelativeJump,
      value: 3,
    },
    {
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.Number,
        value: 2,
      },
    },
    { kind: CommandKind.Multiply },
    {
      kind: CommandKind.CallBuiltin,
      value: "eval",
    },
    {
      kind: CommandKind.CallBuiltin,
      value: "eval",
    },
  ])
})

test("procedure decl-call generation", () => {
  const byteCode = generateByteCode(
    `["Hello, World!\n" print] 'print-hello-world proc print-hello-world`,
  )

  expect(byteCode).toMatchObject([
    {
      kind: CommandKind.RelativeJump,
      value: 4,
    },
    {
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.String,
        value: "Hello, World!\n",
      },
    },
    {
      kind: CommandKind.CallBuiltin,
      value: "print",
    },
    { kind: CommandKind.Return },
    {
      kind: CommandKind.Call,
      value: 1,
    },
  ])
})

// test("match expression generation", () => {
//   const byteCode = generateByteCode(`
//     3 (n)
//
//     @n
//       [0 ["Zero"]]
//       [1 ["One"]]
//       [(x) ["Default"]]
//     match
//   `)
//
//   expect(byteCode).toMatchObject([
//     {
//       kind: CommandKind.PushValueToStack,
//       value: {
//         kind: ValueKind.Number,
//         value: 3,
//       },
//     },
//     {
//       kind: CommandKind.DeclVariables,
//       value: ["n"],
//     },
//     {
//       kind: CommandKind.PushVariableToStack,
//       value: "n",
//     },
//     {
//       kind: CommandKind.PushValueToStack,
//       value: {
//         kind: ValueKind.Number,
//         value: 0,
//       },
//     },
//     {
//       kind: CommandKind.RelativeJumpIfNot,
//       value: 2,
//     },
//   ])
// })
