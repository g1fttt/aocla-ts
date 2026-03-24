import { expect, test, describe } from "bun:test"

import { buildIR } from "@/ir-builder.ts"
import { Parser } from "@/parser.ts"

describe("transformation into commands", () => {
  test("integer", () => {
    const parser = new Parser("1 3 3 7")
    const ir = buildIR(parser.parsePrimitives())

    // console.log(JSON.stringify(ir, null, 2))

    expect(ir).pass()
  })

  test("list", () => {
    const parser = new Parser('10 [20 30] ["Hello!"]')
    const ir = buildIR(parser.parsePrimitives())

    // console.log(JSON.stringify(ir, null, 2))

    expect(ir).pass()
  })

  test("proc", () => {
    const parser = new Parser("[2 +] 'plus-two proc 2")
    const ir = buildIR(parser.parsePrimitives())

    // console.log(JSON.stringify(ir, null, 2))

    expect(ir).pass()
  })

  test("match", () => {
    const parser = new Parser(`
      @n
        [0   ["Zero branch"]]
        [1   ["One branch"]]
        [(n) ["Default branch"]]
      match
    `)
    const ir = buildIR(parser.parsePrimitives())

    // console.log(JSON.stringify(ir, null, 2))

    expect(ir).pass()
  })
})
