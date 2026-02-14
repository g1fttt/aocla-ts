import { PosError, Unreachable } from "./error.ts"
import { Parser, type ParserSpan } from "./parser.ts"

import procedureMatch from "./vm/match.ts"

export enum ObjectKind {
  Integer,
  List,
  Tuple,
  String,
  Boolean,
  Symbol,
}

export type ObjectData =
  | { kind: ObjectKind.Integer; value: number }
  | { kind: ObjectKind.List; value: Array<Object> }
  | { kind: ObjectKind.Tuple; value: [Array<Object>, isQuoted: boolean] }
  | { kind: ObjectKind.String; value: string }
  | { kind: ObjectKind.Boolean; value: boolean }
  | { kind: ObjectKind.Symbol; value: [string, isQuoted: boolean] }

export type Object = ObjectData & { span: ParserSpan }

export type VirtualProcedure = (ctx: Context) => void

enum ProcedureKind {
  Native,
  Virtual,
}

type Procedure =
  | { kind: ProcedureKind.Native; value: Object }
  | { kind: ProcedureKind.Virtual; value: VirtualProcedure }

type ProcedureInfo = {
  name: string
  // Used for error logging during procedure call
  callKeywordSpan: ParserSpan
}

export class Context {
  public stack: Array<Object>
  public currentProcedureInfo: ProcedureInfo | undefined
  private procedures: Map<string, Procedure>
  private currentScope: Map<string, Object>

  public constructor() {
    this.stack = []
    this.procedures = new Map()
    this.currentScope = new Map()
    this.setupBuiltins()
  }

  public eval(source: string) {
    const parser = new Parser(source)

    const object = parser.parseObject()

    // console.log(JSON.stringify(object, null, 2))

    this.evalObject(object)
  }

  public evalObject(rootObject: Object) {
    if (rootObject.kind !== ObjectKind.List) {
      throw this.error("Root object must be of type List", rootObject.span)
    }

    for (const object of rootObject.value) {
      switch (object.kind) {
        case ObjectKind.Tuple: {
          const [tuple, isQuoted] = object.value

          if (isQuoted) this.dequoteAndPushToStack(object)
          else this.evalTuple(tuple, object.span)

          break
        }
        case ObjectKind.Symbol: {
          const [symbolName, isQuoted] = object.value

          if (isQuoted) this.dequoteAndPushToStack(object)
          else this.evalSymbol(symbolName, object.span)

          break
        }
        default:
          this.stack.push(object)

          break
      }
    }
  }

  public evalTuple(tuple: Array<Object>, tupleSpan: ParserSpan) {
    if (tuple.length > this.stack.length) {
      throw this.error("Out of stack while capturing local variable", tupleSpan)
    }

    for (const object of tuple.toReversed()) {
      if (object.kind !== ObjectKind.Symbol) {
        throw this.error(
          "Only objects of type Symbol can be used for capture",
          object.span,
        )
      }

      const symbolName = object.value[0]!
      const stackObject = this.stack.pop()!

      this.currentScope.set(symbolName, stackObject)
    }
  }

  public evalSymbol(symbolName: string, symbolSpan: ParserSpan) {
    if (symbolName.startsWith("@")) {
      const strippedSymbolName = symbolName.slice(1)

      const variable = this.currentScope.get(strippedSymbolName)
      if (!variable) {
        throw this.error(
          `Unbound local variable: ${strippedSymbolName}`,
          symbolSpan,
        )
      }

      this.stack.push(variable)
    } else {
      const procedure = this.procedures.get(symbolName)
      if (!procedure) {
        throw this.error(`Unbound procedure: ${symbolName}`, symbolSpan)
      }

      const procedureInfo = { name: symbolName, callKeywordSpan: symbolSpan }

      switch (procedure.kind) {
        case ProcedureKind.Native:
          this.callNativeProcedure(procedureInfo, procedure.value)

          break
        case ProcedureKind.Virtual:
          this.callVirtualProcedure(procedureInfo, procedure.value)

          break
      }
    }
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

  public currentProcedureName(): string | undefined {
    return this.currentProcedureInfo?.name
  }

  public callKeywordSpan(): ParserSpan | undefined {
    return this.currentProcedureInfo?.callKeywordSpan
  }

  public error(message: string, span: ParserSpan): VmError {
    return new VmError(message, span)
  }

  public errorProcedureCall(message: string): VmError {
    return this.error(message, this.callKeywordSpan()!)
  }

  private setupBuiltins() {
    this.addVirtualProcedure("print", procedurePrint)
    this.addVirtualProcedure("drop", procedureDrop)
    this.addVirtualProcedure("swap", procedureSwap)
    this.addVirtualProcedure("rot", procedureRot)
    this.addVirtualProcedure("dup", procedureDup)
    this.addVirtualProcedure("match", procedureMatch)
    this.addVirtualProcedure("proc", procedureProc)
    this.addVirtualProcedure("eval", procedureEval)
    this.addVirtualProcedure("panic", procedurePanic)
    this.addVirtualProcedure("type", procedureType)
    this.addVirtualProcedure("+", procedureArithmetic)
    this.addVirtualProcedure("-", procedureArithmetic)
    this.addVirtualProcedure("*", procedureArithmetic)
    this.addVirtualProcedure("/", procedureArithmetic)
    this.addVirtualProcedure("and", procedureLogical)
    this.addVirtualProcedure("or", procedureLogical)
    this.addVirtualProcedure("=", procedureComparison)
    this.addVirtualProcedure("<>", procedureComparison)
    this.addVirtualProcedure("<=", procedureComparison)
    this.addVirtualProcedure(">=", procedureComparison)
    this.addVirtualProcedure("<", procedureComparison)
    this.addVirtualProcedure(">", procedureComparison)
  }

  private callNativeProcedure(info: ProcedureInfo, procBody: Object) {
    const scopeTemp = structuredClone(this.currentScope)

    this.callVirtualProcedure(info, (ctx) => ctx.evalObject(procBody))
    this.currentScope = scopeTemp
  }

  private callVirtualProcedure(info: ProcedureInfo, proc: VirtualProcedure) {
    const procedureInfoTemp = structuredClone(this.currentProcedureInfo)

    this.currentProcedureInfo = info
    {
      proc(this)
    }
    this.currentProcedureInfo = procedureInfoTemp
  }

  private dequoteAndPushToStack(object: Object) {
    const isQuoted = false

    switch (object.kind) {
      case ObjectKind.Tuple:
        const tuple = object.value[0]!

        this.stack.push({ ...object, value: [tuple, isQuoted] })

        break
      case ObjectKind.Symbol:
        const name = object.value[0]!

        this.stack.push({ ...object, value: [name, isQuoted] })

        break
      default:
        throw new Unreachable()
    }
  }
}

export class VmError extends PosError {
  public constructor(message: string, span: ParserSpan) {
    super(message, span, true /* shouldIncrement */)
  }

  public override formattedMessage(): string {
    return `Error occured during evaluating phase at ${this.position()}. ${this.message}`
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
    throw ctx.errorProcedureCall("Cannot print from empty stack")
  }

  printObject(stackObject)
}

function procedureDrop(ctx: Context) {
  if (ctx.stack.pop() === undefined) {
    throw ctx.errorProcedureCall("Cannot drop from empty stack")
  }
}

function procedureSwap(ctx: Context) {
  const a = ctx.stack.pop()
  const b = ctx.stack.pop()

  if (!a || !b) {
    throw ctx.errorProcedureCall(
      "Not enough values on stack to perform swap operation",
    )
  }

  ctx.stack.push(a)
  ctx.stack.push(b)
}

function procedureRot(ctx: Context) {
  const stackObject = ctx.stack.at(-3)
  if (!stackObject) {
    throw ctx.errorProcedureCall(
      "Not enough values on stack to perform rot operation",
    )
  }

  ctx.stack.push(stackObject)
}

function procedureDup(ctx: Context) {
  const stackObject = ctx.stack.at(-1)
  if (!stackObject) {
    throw ctx.errorProcedureCall(
      "Not enough values on stack perform dup operation",
    )
  }

  ctx.stack.push(stackObject)
}

function procedureProc(ctx: Context) {
  const procedureName = ctx.stack.pop()
  if (!procedureName) {
    throw ctx.errorProcedureCall(
      "Cannot obtain a procedure name due to empty stack",
    )
  }

  if (procedureName.kind !== ObjectKind.Symbol) {
    throw ctx.error(
      "Only Symbols are allowed to be used as a procedure name",
      procedureName.span,
    )
  }

  const procedureBody = ctx.stack.pop()
  if (!procedureBody) {
    throw ctx.errorProcedureCall(
      "Cannot obtain a procedure body due to empty stack",
    )
  }

  if (procedureBody.kind !== ObjectKind.List) {
    throw ctx.error(
      "Only Lists are allowed to be used a procedure body",
      procedureBody.span,
    )
  }

  const name = procedureName.value[0]!

  ctx.addNativeProcedureObject(name, procedureBody)
}

function procedureEval(ctx: Context) {
  const stackObject = ctx.stack.pop()
  if (!stackObject) {
    throw ctx.errorProcedureCall("Cannot eval due to empty stack")
  }

  if (stackObject.kind !== ObjectKind.List) {
    throw ctx.error(
      "Only Lists are allowed to be evaluated using eval procedure",
      stackObject.span,
    )
  }

  ctx.evalObject(stackObject)
}

function procedurePanic(ctx: Context) {
  const stackObject = ctx.stack.pop()
  if (!stackObject) {
    throw ctx.errorProcedureCall(
      "Cannot panic due to empty stack. No message provided",
    )
  }

  if (stackObject.kind !== ObjectKind.String) {
    throw ctx.error(
      "Only Strings are allowed to be used as panic message",
      stackObject.span,
    )
  }

  throw ctx.errorProcedureCall(`Panic occured. ${stackObject.value}`)
}

function procedureType(ctx: Context) {
  const stackObject = ctx.stack.at(-1)
  if (!stackObject) {
    throw ctx.errorProcedureCall("Cannot push type due to empty stack")
  }

  ctx.stack.push({
    ...stackObject,
    kind: ObjectKind.String,
    value: ObjectKind[stackObject.kind],
  })
}

type BinaryOpKindConstraint = (a: ObjectKind, b: ObjectKind) => boolean
type BinaryOp = (a: any, b: any) => void

function performBinaryOp(
  ctx: Context,
  kindConstraint: ObjectKind | BinaryOpKindConstraint,
  op: BinaryOp,
) {
  const procName = ctx.currentProcedureName()

  const b = ctx.stack.pop()
  const a = ctx.stack.pop()

  if (!a || !b) {
    throw ctx.errorProcedureCall(
      `Cannot perform '${procName}' operation due to empty stack`,
    )
  }

  if (typeof kindConstraint === "function") {
    if (!kindConstraint(a.kind, b.kind)) {
      const aKindStr = ObjectKind[a.kind]
      const bKindStr = ObjectKind[b.kind]

      throw ctx.errorProcedureCall(
        `${aKindStr} and ${bKindStr} is a disallowed combination to perform ${procName} operation`,
      )
    }
  } else if (a.kind !== kindConstraint || b.kind !== kindConstraint) {
    const kindStr = ObjectKind[kindConstraint]

    throw ctx.errorProcedureCall(
      `Only ${kindStr}s are allowed to perform ${procName} operation`,
    )
  }

  op(a.value, b.value)
}

function procedureComparison(ctx: Context) {
  const kindConstraint = (a: ObjectKind, b: ObjectKind) => {
    const forbiddenKinds = [ObjectKind.List, ObjectKind.Tuple]
    const hasForbiddenKinds =
      forbiddenKinds.includes(a) || forbiddenKinds.includes(b)

    if (hasForbiddenKinds) {
      return false
    }

    const hasLessOrGreater = [">=", "<=", ">", "<"].some(
      (op) => ctx.currentProcedureName() === op,
    )
    const tryingToCompareNonInteger =
      a !== ObjectKind.Integer || b !== ObjectKind.Integer

    if (hasLessOrGreater && tryingToCompareNonInteger) {
      return false
    }

    return true
  }

  performBinaryOp(ctx, kindConstraint, (a: any, b: any) => {
    let result: boolean

    switch (ctx.currentProcedureName()) {
      case "=":
        result = a === b
        break
      case "<>":
        result = a !== b
        break
      case ">=":
        result = a >= b
        break
      case "<=":
        result = a <= b
        break
      case "<":
        result = a < b
        break
      case ">":
        result = a > b
        break
      default:
        throw new Unreachable()
    }

    ctx.stack.push({
      kind: ObjectKind.Boolean,
      value: result,
      span: ctx.callKeywordSpan()!,
    })
  })
}

function procedureLogical(ctx: Context) {
  performBinaryOp(ctx, ObjectKind.Boolean, (a: boolean, b: boolean) => {
    let result: boolean

    switch (ctx.currentProcedureName()) {
      case "and":
        result = a && b
        break
      case "or":
        result = a || b
        break
      default:
        throw new Unreachable()
    }

    ctx.stack.push({
      kind: ObjectKind.Boolean,
      value: result,
      span: ctx.callKeywordSpan()!,
    })
  })
}

function procedureArithmetic(ctx: Context) {
  performBinaryOp(ctx, ObjectKind.Integer, (a: number, b: number) => {
    let result: number

    switch (ctx.currentProcedureName()) {
      case "+":
        result = a + b
        break
      case "-":
        result = a - b
        break
      case "*":
        result = a * b
        break
      case "/":
        result = Math.round(a / b)
        break
      default:
        throw new Unreachable()
    }

    ctx.stack.push({
      kind: ObjectKind.Integer,
      value: result,
      span: ctx.callKeywordSpan()!,
    })
  })
}
