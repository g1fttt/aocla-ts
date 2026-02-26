import { readFileSync } from "node:fs"

import type { Object, RootObject, Symbol } from "./parser.ts"
import { Parser, ObjectKind, SymbolKind } from "./parser.ts"

import { Unreachable, type FormattedError } from "./error.ts"
import { type TokenSpan } from "./tokenizer.ts"
import { extractModuleName, extractModuleParentPath } from "./utils.ts"

import procedureMatch from "./vm/match.ts"

export class Context {
  public modulePath: string | null
  public stack: Array<Object>
  public currentProcedureInfo: ProcedureInfo | undefined
  public procedures: Map<string, Procedure>
  public currentScope: Map<string, Object>

  public constructor(modulePath: string | null) {
    this.modulePath = modulePath
    this.stack = new Array()
    this.procedures = new Map()
    this.currentScope = new Map()
    this.setupBuiltins()
  }

  public evalString(source: string) {
    const parser = new Parser(source)

    this.evalObjectArray(parser.parseAST())
  }

  public evalObjectArray(rootObject: RootObject) {
    rootObject.forEach((object) => this.evalObjectSingle(object))
  }

  public evalObjectSingle(object: Object) {
    switch (object.kind) {
      case ObjectKind.Tuple: {
        const { objects, isQuoted } = object.value

        if (isQuoted) this.dequoteAndPushToStack(object)
        else this.evalTuple(objects, object.span)

        break
      }
      case ObjectKind.Symbol: {
        const { name, kind, isQuoted } = object.value

        if (isQuoted) this.dequoteAndPushToStack(object)
        else this.evalSymbol(name, kind, object.span)

        break
      }
      default:
        this.stack.push(object)

        break
    }
  }

  public evalTuple(objects: Array<Object>, span: TokenSpan) {
    if (objects.length > this.stack.length) {
      throw this.error("Out of stack while capturing local variable", span)
    }

    for (const object of objects.toReversed()) {
      const { name } = object.value as Symbol
      const stackObject = this.stack.pop()!

      this.currentScope.set(name, stackObject)
    }
  }

  public evalSymbol(name: string, kind: SymbolKind, span: TokenSpan) {
    switch (kind) {
      case SymbolKind.Variable:
        this.evalVariable(name, span)

        break
      case SymbolKind.Procedure:
        this.evalProcedure(name, span)

        break
    }
  }

  public evalVariable(name: string, span: TokenSpan) {
    const variable = this.currentScope.get(name)
    if (!variable) {
      throw this.error(`Unbound local variable: '${name}'`, span)
    }

    this.stack.push(variable)
  }

  public evalProcedure(name: string, span: TokenSpan) {
    const procedure = this.procedures.get(name)
    if (!procedure) {
      throw this.error(`Unbound procedure: '${name}'`, span)
    }

    const procedureInfo: ProcedureInfo = { name, callKeywordSpan: span }

    switch (procedure.kind) {
      case ProcedureKind.Native:
        this.callNativeProcedure(procedureInfo, procedure.value)

        break
      case ProcedureKind.Virtual:
        this.callVirtualProcedure(procedureInfo, procedure.value)

        break
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

  public callKeywordSpan(): TokenSpan | undefined {
    return this.currentProcedureInfo?.callKeywordSpan
  }

  public error(message: string, span: TokenSpan): VmError {
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
    this.addVirtualProcedure("include", procedureInclude)
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
    if (procBody.kind !== ObjectKind.List) {
      throw new Unreachable()
    }

    const scopeTemp = new Map(this.currentScope)

    this.callVirtualProcedure(info, (ctx) =>
      ctx.evalObjectArray(procBody.value),
    )
    this.currentScope = scopeTemp
  }

  private callVirtualProcedure(info: ProcedureInfo, proc: VirtualProcedure) {
    const procedureInfoTemp = this.currentProcedureInfo

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
        this.stack.push({ ...object, value: { ...object.value, isQuoted } })

        break
      case ObjectKind.Symbol:
        this.stack.push({ ...object, value: { ...object.value, isQuoted } })

        break
      default:
        throw new Unreachable()
    }
  }
}

function procedurePrint(ctx: Context) {
  function printObject(object: Object) {
    const stdout = process.stdout

    switch (object.kind) {
      case ObjectKind.List:
      case ObjectKind.Tuple:
        // prettier-ignore
        const sequenceValue = object.kind === ObjectKind.List
          ? object.value
          : object.value.objects

        for (const elementObject of sequenceValue) {
          printObject(elementObject)
          stdout.write(" ")
        }

        break
      case ObjectKind.Symbol:
        stdout.write(object.value.name)

        break
      default:
        stdout.write(String(object.value))

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
  if (!ctx.stack.pop()) {
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
      "Cannot define procedure due to missing procedure name at the stack",
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

  const { name } = procedureName.value

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

  ctx.evalObjectSingle(stackObject)
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

function procedureInclude(ctx: Context) {
  const modulePath = ctx.stack.at(-1)
  if (!modulePath) {
    throw ctx.errorProcedureCall("No module path was found on the stack")
  }

  if (modulePath.kind !== ObjectKind.String) {
    throw ctx.error("Module path must be of type String", modulePath.span)
  }

  const moduleName = extractModuleName(modulePath.value)
  const moduleParentPath = extractModuleParentPath(
    ctx.modulePath + "/" + modulePath.value,
  )

  try {
    var moduleContent = readFileSync(
      `${moduleParentPath}/${moduleName}.aocla`,
      "utf-8",
    )
  } catch (err) {
    throw ctx.error(
      `No module was found in the provided path: ${err}`,
      modulePath.span,
    )
  }

  const moduleContext = new Context(moduleParentPath)
  moduleContext.evalString(moduleContent)

  for (const [procName, proc] of moduleContext.procedures) {
    if (proc.kind === ProcedureKind.Virtual) {
      continue
    }

    const prefixedProcName = moduleName + "." + procName

    ctx.addNativeProcedureObject(prefixedProcName, proc.value)
  }
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
  callKeywordSpan: TokenSpan
}

export class VmError implements FormattedError {
  private readonly message: string
  private readonly span: TokenSpan

  public constructor(message: string, span: TokenSpan) {
    this.message = message
    this.span = span
  }

  public formattedMessage(): string {
    const { relative, line } = this.span

    return `Error occured during evaluating phase at ${line}:${relative.start + 1}. ${this.message}.`
  }
}
