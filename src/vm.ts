import { Parser } from "./parser.ts"

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
  private currentProcedureName: string | undefined

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
        throw new Error("Only objects of type Symbol can be captured")
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

    this.procedures.set(name, {
      kind: ProcedureKind.Native,
      value: parser.parseObject(),
    })
  }

  public addVirtualProcedure(name: string, proc: VirtualProcedure) {
    this.procedures.set(name, {
      kind: ProcedureKind.Virtual,
      value: proc,
    })
  }

  private setupBuiltins() {
    this.addVirtualProcedure("print", procedurePrint)
    this.addVirtualProcedure("drop", procedureDrop)
    this.addVirtualProcedure("match", procedureMatch)
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

class Match {
  public readonly selector: Object
  public readonly branches: Map<any, Object>
  public readonly defaultBranch:
    | [pattern: Array<Object>, handler: Object]
    | undefined

  public constructor(ctx: Context) {
    this.branches = new Map()

    while (true) {
      const stackObject = ctx.stack.at(-1)
      if (!stackObject) {
        throw new Error("Cannot match due to empty stack")
      }

      if (stackObject.kind !== ObjectKind.List) {
        if (this.branches.size === 0 && !this.defaultBranch) {
          throw new Error("Cannot match due to missing branches")
        }

        this.selector = stackObject

        break
      }

      ctx.stack.pop()

      const [pattern, handler] = stackObject.value

      if (!pattern) {
        throw new Error("Match expression is missing pattern")
      }

      if (!handler) {
        throw new Error("Match expression is missing handler")
      }

      if (pattern.kind === ObjectKind.Tuple) {
        if (this.defaultBranch !== undefined) {
          throw new Error(
            "Match expression can have at most one default branch",
          )
        }

        const tuple = pattern.value[0]!

        this.defaultBranch = [tuple, handler]
      } else {
        this.branches.set(pattern.value, handler)
      }
    }
  }
}

function procedureMatch(ctx: Context) {
  const match = new Match(ctx)

  const branch = match.branches.get(match.selector.value)
  if (branch) {
    ctx.evalObject(branch)

    return
  }

  if (!match.defaultBranch) {
    return
  }

  const [captureTuple, handler] = match.defaultBranch

  ctx.evalTuple(captureTuple)
  ctx.evalObject(handler)
}
