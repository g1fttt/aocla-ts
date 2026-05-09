import { expect, test } from "vitest"

import { AstTransformer } from "@/ir-builder/transformer.ts"

import { CommandKind, CompCommandKind, ValueKind } from "@/ir-builder.ts"
import type { CompCommand } from "@/ir-builder.ts"

import { parseString } from "@/parser.ts"

function transformAst(sourceCode: string): Array<CompCommand> {
  const astSample = parseString(sourceCode)

  const transformer = new AstTransformer()

  return transformer.transform(astSample)
}

test("procedure transformation", () => {
  const ast = transformAst("[(a b) @a @b + 2 +] 'sum-plus-two proc")

  expect(ast).toMatchObject([
    {
      kind: CompCommandKind.DeclProcedure,
      value: {
        name: "sum-plus-two",
        body: [
          A({
            kind: CommandKind.DeclVariables,
            value: ["a", "b"],
          }),
          A({
            kind: CommandKind.PushVariableToStack,
            value: "a",
          }),
          A({
            kind: CommandKind.PushVariableToStack,
            value: "b",
          }),
          A({ kind: CommandKind.Add }),
          A({
            kind: CommandKind.PushValueToStack,
            value: {
              kind: ValueKind.Number,
              value: 2,
            },
          }),
          A({ kind: CommandKind.Add }),
        ],
      },
    },
  ])
})

test("match value transformation", () => {
  const ast = transformAst(`
    1
      [0 ["Zero"]]
      [1 ["One"]]
      [(n) ["Default"]]
    match
  `)

  expect(ast).toMatchObject([
    {
      kind: CompCommandKind.Match,
      value: {
        selector: {
          kind: CommandKind.PushValueToStack,
          value: {
            kind: ValueKind.Number,
            value: 1,
          },
        },
        branches: new Map([
          [
            {
              kind: CommandKind.PushValueToStack,
              value: {
                kind: ValueKind.Number,
                value: 0,
              },
            },
            [
              A({
                kind: CommandKind.PushValueToStack,
                value: {
                  kind: ValueKind.String,
                  value: "Zero",
                },
              }),
            ],
          ],
          [
            {
              kind: CommandKind.PushValueToStack,
              value: {
                kind: ValueKind.Number,
                value: 1,
              },
            },
            [
              A({
                kind: CommandKind.PushValueToStack,
                value: {
                  kind: ValueKind.String,
                  value: "One",
                },
              }),
            ],
          ],
        ]),
        defaultBranch: {
          pattern: {
            kind: CommandKind.DeclVariables,
            value: ["n"],
          },
          handler: [
            A({
              kind: CommandKind.PushValueToStack,
              value: {
                kind: ValueKind.String,
                value: "Default",
              },
            }),
          ],
        },
      },
    },
  ])
})

test("match variable transformation", () => {
  const ast = transformAst(`
    3 (n)

    @n
      [0 ["Zero"]]
      [1 ["One"]]
      [(x) ["Default"]]
    match
  `)

  expect(ast).toMatchObject([
    A({
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.Number,
        value: 3,
      },
    }),
    A({
      kind: CommandKind.DeclVariables,
      value: ["n"],
    }),
    {
      kind: CompCommandKind.Match,
      value: {
        selector: {
          kind: CommandKind.PushVariableToStack,
          value: "n",
        },
        branches: new Map([
          [
            {
              kind: CommandKind.PushValueToStack,
              value: {
                kind: ValueKind.Number,
                value: 0,
              },
            },
            [
              A({
                kind: CommandKind.PushValueToStack,
                value: {
                  kind: ValueKind.String,
                  value: "Zero",
                },
              }),
            ],
          ],
          [
            {
              kind: CommandKind.PushValueToStack,
              value: {
                kind: ValueKind.Number,
                value: 1,
              },
            },
            [
              A({
                kind: CommandKind.PushValueToStack,
                value: {
                  kind: ValueKind.String,
                  value: "One",
                },
              }),
            ],
          ],
        ]),
        defaultBranch: {
          pattern: {
            kind: CommandKind.DeclVariables,
            value: ["x"],
          },
          handler: [
            A({
              kind: CommandKind.PushValueToStack,
              value: {
                kind: ValueKind.String,
                value: "Default",
              },
            }),
          ],
        },
      },
    },
  ])
})

test("ffi procedure transformation", () => {
  const ast = transformAst(
    `["int" ["int" "int"]] 'sum "sum" "cool_lib" proc-ffi`,
  )

  expect(ast).toMatchObject([
    A({
      kind: CommandKind.DeclProcedureFFI,
      value: {
        libraryPath: "cool_lib",
        libraryName: "sum",
        name: "sum",
        returnType: "int",
        parameters: ["int", "int"],
      },
    }),
  ])
})

// Atomic command creation helper
function A(value: any): CompCommand {
  return { kind: CompCommandKind.AtomicCommand, value } as CompCommand
}
