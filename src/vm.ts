import { Parser } from "./parser.ts"

import procedureMatch from "./vm/match.ts"

export enum ObjectKind {
  Integer,
  List,
  Tuple,
  String,
  Boolean,
  Symbol,
}

export type Object =
  | { kind: ObjectKind.Integer; value: number }
  | { kind: ObjectKind.List; value: Array<Object> }
  | { kind: ObjectKind.Tuple; value: [Array<Object>, isQuoted: boolean] }
  | { kind: ObjectKind.String; value: string }
  | { kind: ObjectKind.Boolean; value: boolean }
  | { kind: ObjectKind.Symbol; value: [string, isQuoted: boolean] }

export type VirtualProcedure = (ctx: Context) => void

enum ProcedureKind {
  Native,
  Virtual,
}

type Procedure =
  | { kind: ProcedureKind.Native; value: Object }
  | { kind: ProcedureKind.Virtual; value: VirtualProcedure }

export class Context {
  public stack: Array<Object>
  private procedures: Map<string, Procedure>
  private currentFrame: Map<string, Object>
  public currentProcedureName: string | undefined

  public constructor() {
    this.stack = []
    this.procedures = new Map()
    this.currentFrame = new Map()
    this.setupBuiltins()
  }

  public eval(source: string) {
    const parser = new Parser(source)

    this.evalObject(parser.parseObject())
  }

  public evalObject(rootObject: Object) {
    if (rootObject.kind !== ObjectKind.List) {
      throw new Error("Root object must be of type List")
    }

    for (const object of rootObject.value) {
      switch (object.kind) {
        case ObjectKind.Tuple: {
          const [tuple, isQuoted] = object.value

          if (isQuoted) this.dequoteAndPushToStack(object)
          else this.evalTuple(tuple)

          break
        }
        case ObjectKind.Symbol: {
          const [symbolName, isQuoted] = object.value

          if (isQuoted) this.dequoteAndPushToStack(object)
          else this.evalSymbol(symbolName)

          break
        }
        default:
          this.stack.push(object)

          break
      }
    }
  }

  public evalTuple(tuple: Array<Object>) {
    if (tuple.length > this.stack.length) {
      throw new Error("Out of stack while capturing local variable")
    }

    for (const object of tuple.toReversed()) {
      if (object.kind !== ObjectKind.Symbol) {
        throw new Error("Only objects of type Symbol can be used for capture")
      }

      const symbolName = object.value[0]!
      const stackObject = this.stack.pop()!

      this.currentFrame.set(symbolName, stackObject)
    }
  }

  public evalSymbol(symbolName: string) {
    if (symbolName.startsWith("@")) {
      const strippedSymbolName = symbolName.slice(1)

      const variable = this.currentFrame.get(strippedSymbolName)
      if (!variable) {
        throw new Error(`Unbound local variable: ${strippedSymbolName}`)
      }

      this.stack.push(variable)
    } else {
      const procedure = this.procedures.get(symbolName)
      if (!procedure) {
        throw new Error(`Unbound procedure: ${symbolName}`)
      }

      switch (procedure.kind) {
        case ProcedureKind.Native:
          this.callNativeProcedure(symbolName, procedure.value)

          break
        case ProcedureKind.Virtual:
          this.callVirtualProcedure(symbolName, procedure.value)

          break
      }
    }
  }

  public addNativeProcedure(name: string, bodySource: string) {
    const parser = new Parser(bodySource)

    this.addNativeProcedureObject(name, parser.parseObject())
  }

  public addNativeProcedureObject(name: string, bodyObject: Object) {
    this.procedures.set(name, {
      kind: ProcedureKind.Native,
      value: bodyObject,
    })
  }

  public addVirtualProcedure(name: string, procedure: VirtualProcedure) {
    this.procedures.set(name, {
      kind: ProcedureKind.Virtual,
      value: procedure,
    })
  }

  private setupBuiltins() {
    this.addVirtualProcedure("print", procedurePrint)
    this.addVirtualProcedure("drop", procedureDrop)
    this.addVirtualProcedure("swap", procedureSwap)
    this.addVirtualProcedure("match", procedureMatch)
    this.addVirtualProcedure("proc", procedureProc)
    this.addVirtualProcedure("eval", procedureEval)
    this.addVirtualProcedure("+", procedureArithmetic)
    this.addVirtualProcedure("-", procedureArithmetic)
    this.addVirtualProcedure("*", procedureArithmetic)
    this.addVirtualProcedure("/", procedureArithmetic)
  }

  private callNativeProcedure(name: string, procedureBody: Object) {
    const frameTemp = structuredClone(this.currentFrame)

    this.callVirtualProcedure(name, (ctx) => ctx.evalObject(procedureBody))
    this.currentFrame = frameTemp
  }

  private callVirtualProcedure(name: string, procedure: VirtualProcedure) {
    const procedureNameTemp = this.currentProcedureName

    this.currentProcedureName = name
    {
      procedure(this)
    }
    this.currentProcedureName = procedureNameTemp
  }

  private dequoteAndPushToStack(object: Object) {
    const isQuoted = false

    switch (object.kind) {
      case ObjectKind.Tuple:
        const tuple = object.value[0]!

        this.stack.push({ kind: ObjectKind.Tuple, value: [tuple, isQuoted] })

        break
      case ObjectKind.Symbol:
        const name = object.value[0]!

        this.stack.push({
          kind: ObjectKind.Symbol,
          value: [name, isQuoted],
        })

        break
      default: // Unreachable
    }
  }
}

function procedurePrint(ctx: Context) {
  function printObject(object: Object) {
    switch (object.kind) {
      case ObjectKind.List:
      case ObjectKind.Tuple:
        // prettier-ignore
        const sequenceValue = object.kind === ObjectKind.List
          ? object.value
          : object.value[0]!

        for (const elementObject of sequenceValue) {
          printObject(elementObject)
          process.stdout.write(" ")
        }

        break
      default:
        process.stdout.write(`${object.value}`)

        break
    }
  }

  const stackObject = ctx.stack.at(-1)
  if (!stackObject) {
    throw new Error("Cannot print from empty stack")
  }

  printObject(stackObject)
}

function procedureDrop(ctx: Context) {
  if (ctx.stack.pop() === undefined) {
    throw new Error("Cannot drop from empty stack")
  }
}

function procedureSwap(ctx: Context) {
  const a = ctx.stack.pop()
  const b = ctx.stack.pop()

  if (!a || !b) {
    throw new Error("Cannot swap due to empty stack")
  }

  ctx.stack.push(a)
  ctx.stack.push(b)
}

function procedureProc(ctx: Context) {
  const procedureName = ctx.stack.pop()
  if (!procedureName) {
    throw new Error("Cannot obtain a procedure name due to empty stack")
  }

  if (procedureName.kind !== ObjectKind.Symbol) {
    throw new Error("Only Symbols are allowed to be used as a procedure name")
  }

  const procedureBody = ctx.stack.pop()
  if (!procedureBody) {
    throw new Error("Cannot obtain a procedure body due to empty stack")
  }

  if (procedureBody.kind !== ObjectKind.List) {
    throw new Error("Only Lists are allowed to be used a procedure body")
  }

  const name = procedureName.value[0]!

  ctx.addNativeProcedureObject(name, procedureBody)
}

function procedureEval(ctx: Context) {
  const stackObject = ctx.stack.at(-1)
  if (!stackObject) {
    throw new Error("Cannot eval due to empty stack")
  }

  if (stackObject.kind !== ObjectKind.List) {
    throw new Error(
      "Only Lists are allowed to be evaluated using eval procedure",
    )
  }

  ctx.evalObject(stackObject)
}

function procedureArithmetic(ctx: Context) {
  const b = ctx.stack.at(-1)
  const a = ctx.stack.at(-2)

  if (!a || !b) {
    throw new Error(
      `Cannot perform '${ctx.currentProcedureName}' operation due to empty stack`,
    )
  }

  if (a.kind !== ObjectKind.Integer || b.kind !== ObjectKind.Integer) {
    throw new Error(
      `Only Integers are allowed to perform ${ctx.currentProcedureName} operation`,
    )
  }

  let result: number

  switch (ctx.currentProcedureName) {
    case "+":
      result = a.value + b.value
      break
    case "-":
      result = a.value - b.value
      break
    case "*":
      result = a.value * b.value
      break
    case "/":
      result = Math.round(a.value / b.value)
      break
    default:
      throw new Error("Unreachable")
  }

  ctx.stack.push({ kind: ObjectKind.Integer, value: result })
}
