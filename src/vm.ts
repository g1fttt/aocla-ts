import { readFileSync } from "node:fs"

import type {
  Command,
  Block,
  Match,
  DeclProcedure,
  CallProcedure,
  DeclVariables,
  PushVariableToStack,
  IncludeModule,
} from "./ir-builder.ts"
import { buildIR, CommandKind } from "./ir-builder.ts"

import { AoclaError, ErrorKind, Unimplemented, Unreachable } from "./error.ts"
import { type TokenSpan } from "./tokenizer.ts"
import { parseString, ObjectKind, type Object } from "./parser.ts"
import { extractModuleName, extractModuleParentPath } from "./utils.ts"

export class VirtualMachine {
  private objectStack = new Array<Object>()

  private procedures = new Map<string, Procedure>()
  private scope = new Map<string, Object>()
  private currentProcedureInfo: ProcedureInfo | undefined

  public constructor(private modulePath: string | null) {
    this.setupBuiltins()
  }

  public evalString(source: string) {
    const ir = buildIR(parseString(source))

    this.evalCommandList(ir)
  }

  public evalCommandList(commandList: Array<Command>) {
    commandList.forEach((command) => this.evalCommand(command))
  }

  public evalCommand(command: Command) {
    switch (command.kind) {
      case CommandKind.Value:
        this.objectStack.push(command.value.object)

        break
      case CommandKind.DeclProcedure:
        this.addNativeProcedure(command.value)

        break
      case CommandKind.CallProcedure:
        this.evalCallProcedure(command.value, command.span)

        break
      case CommandKind.DeclVariables:
        this.evalDeclVariables(command.value, command.span)

        break

      case CommandKind.PushVariableToStack:
        this.evalPushVariableToStack(command.value, command.span)

        break
      case CommandKind.Match:
        this.evalMatch(command.value)

        break
      case CommandKind.IncludeModule:
        this.evalIncludeModule(command.value, command.span)

        break
      case CommandKind.Block:
        this.evalCommandList(command.value)

        break
      default:
        throw new Unreachable()
    }
  }

  public addNativeProcedure({ name, body }: DeclProcedure) {
    this.addNativeProcedureCommand(name, body)
  }

  public addNativeProcedureCommand(name: string, body: Block) {
    this.procedures.set(name, {
      kind: ProcedureKind.Native,
      value: body,
    })
  }

  public addNativeProcedureString(name: string, source: string) {
    this.procedures.set(name, {
      kind: ProcedureKind.Native,
      value: buildIR(parseString(source)),
    })
  }

  public addVirtualProcedure(name: string, procedure: VirtualProcedure) {
    this.procedures.set(name, {
      kind: ProcedureKind.Virtual,
      value: procedure,
    })
  }

  private callNativeProcedure(info: ProcedureInfo, body: Block) {
    const scopeTemp = new Map(this.scope)
    {
      this.callVirtualProcedure(info, (vm) => vm.evalCommandList(body))
    }
    this.scope = scopeTemp
  }

  private callVirtualProcedure(info: ProcedureInfo, proc: VirtualProcedure) {
    const procedureInfoTemp = this.currentProcedureInfo

    this.currentProcedureInfo = info
    {
      proc(this)
    }
    this.currentProcedureInfo = procedureInfoTemp
  }

  private evalCallProcedure({ name }: CallProcedure, symbolSpan: TokenSpan) {
    const procedureInfo: ProcedureInfo = { name, callKeywordSpan: symbolSpan }

    const procedure = this.procedures.get(name)

    switch (procedure?.kind) {
      case ProcedureKind.Native:
        this.callNativeProcedure(procedureInfo, procedure.value)

        break
      case ProcedureKind.Virtual:
        this.callVirtualProcedure(procedureInfo, procedure.value)

        break
      default:
        throw this.error(
          ErrorKind.SemanticError,
          symbolSpan,
          "Unbound procedure",
        )
    }
  }

  private evalDeclVariables({ names }: DeclVariables, tupleSpan: TokenSpan) {
    if (names.length > this.objectStack.length) {
      throw this.error(ErrorKind.OutOfStack, tupleSpan)
    }

    for (const name of names.toReversed()) {
      const object = this.objectStack.pop()!

      // Single underscore symbol discards value from stack
      if (name !== "_") {
        this.scope.set(name, object)
      }
    }
  }

  private evalPushVariableToStack(
    { name }: PushVariableToStack,
    symbolSpan: TokenSpan,
  ) {
    const object = this.scope.get(name)
    if (!object) {
      throw this.error(ErrorKind.SemanticError, symbolSpan, "Unbound variable")
    }

    this.objectStack.push(object)
  }

  private evalMatch({ selector, branches, defaultBranch }: Match) {
    this.evalCommand(selector)

    const selectorResult = this.objectStack.pop()!
    if (!selectorResult) {
      throw this.error(ErrorKind.OutOfStack, selector.span)
    }

    for (const [pattern, handler] of branches) {
      this.evalCommand(pattern)

      const patternResult = this.objectStack.pop()
      if (!patternResult) {
        throw this.error(ErrorKind.OutOfStack, pattern.span)
      }

      if (compareObjects(selectorResult, patternResult) === Ordering.Equal) {
        this.evalCommandList(handler)

        return
      }
    }

    if (!defaultBranch) {
      return
    }

    // FIXME: Is there any better way to save selectorResult rather than pushing it again later?
    this.objectStack.push(selectorResult)

    const { pattern, handler } = defaultBranch

    this.evalCommand(pattern)
    this.evalCommandList(handler)
  }

  private evalIncludeModule({ path }: IncludeModule, symbolSpan: TokenSpan) {
    const moduleName = extractModuleName(path)
    const moduleParentPath = extractModuleParentPath(
      this.modulePath + "/" + path,
    )

    try {
      var moduleContent = readFileSync(
        `${moduleParentPath}/${moduleName}.aocla`,
        "utf-8",
      )
    } catch (err) {
      throw this.error(
        ErrorKind.UnknownPath,
        symbolSpan,
        `No module was found in the provided path: ${path} (${err})`,
      )
    }

    const moduleVm = new VirtualMachine(moduleParentPath)
    moduleVm.evalString(moduleContent)

    for (const [procName, proc] of moduleVm.procedures) {
      // Most likely internal procedure. No need to copy it.
      if (proc.kind === ProcedureKind.Virtual) {
        continue
      }

      const NAMESPACE_SEPARATOR = "/"
      const prefixedProcName = moduleName + NAMESPACE_SEPARATOR + procName

      this.addNativeProcedureCommand(prefixedProcName, proc.value)
    }
  }

  private handleArithmetic(op: (a: number, b: number) => number) {
    const b = this.objectStack.pop()
    const a = this.objectStack.pop()

    if (!a || !b) {
      throw this.error(
        ErrorKind.OutOfStack,
        this.currentProcedureInfo!.callKeywordSpan,
      )
    }

    const span = a.span.combinedWith(b.span)

    if (a.kind !== ObjectKind.Integer || b.kind !== ObjectKind.Integer) {
      throw this.error(ErrorKind.TypeMismatch, span)
    }

    this.objectStack.push({
      kind: ObjectKind.Integer,
      value: op(a.value, b.value),
      span,
    })
  }

  private setupBuiltins() {
    this.addVirtualProcedure("print", (vm) => vm.procPrint())
    this.addVirtualProcedure("+", (vm) => vm.handleArithmetic((a, b) => a + b))
    this.addVirtualProcedure("-", (vm) => vm.handleArithmetic((a, b) => a - b))
    this.addVirtualProcedure("*", (vm) => vm.handleArithmetic((a, b) => a * b))
    this.addVirtualProcedure("/", (vm) => vm.handleArithmetic((a, b) => a / b))

    this.addNativeProcedureString("drop", "(_)")
    this.addNativeProcedureString("swap", "(_a _b) @_b @_a")
    this.addNativeProcedureString("dup", "(_v) @_v @_v")
    this.addNativeProcedureString("rot", "(_a _b _c) @_b @_a @_c")
  }

  private error(
    kind: ErrorKind,
    span: TokenSpan,
    message?: string,
  ): AoclaError {
    return new AoclaError({
      message,
      kind,
      lineRelativePos: span.relative,
      line: span.line,
    })
  }

  // ==== BUILTINS ====

  public procPanic() {
    const parentSpan = this.currentProcedureInfo!.callKeywordSpan

    const messageObject = this.objectStack.pop()
    if (!messageObject) {
      throw this.error(ErrorKind.OutOfStack, parentSpan)
    }

    throw this.error(ErrorKind.User, parentSpan, objectToString(messageObject))
  }

  public procPrint() {
    const object = this.objectStack.at(-1)
    if (!object) {
      throw this.error(
        ErrorKind.OutOfStack,
        this.currentProcedureInfo!.callKeywordSpan,
      )
    }

    process.stdout.write(objectToString(object))
  }
}

function objectToString(object: Object): string {
  switch (object.kind) {
    case ObjectKind.Integer:
    case ObjectKind.Boolean:
    case ObjectKind.String:
      return String(object.value)
    case ObjectKind.Symbol:
      return object.value.name
    case ObjectKind.List:
    case ObjectKind.Tuple:
      // prettier-ignore
      const sequenceValue = object.kind === ObjectKind.List
        ? object.value
        : object.value.objects

      let result = String()

      for (const elementObject of sequenceValue) {
        result += objectToString(elementObject)

        if (elementObject !== sequenceValue.at(-1)) {
          result += " "
        }
      }

      return result
  }
}

function compareObjects(a: Object, b: Object): Ordering {
  if ([a.kind, b.kind].every((k) => k === ObjectKind.Integer)) {
    if (a.value === b.value) {
      return Ordering.Equal
    } else if (a.value > b.value) {
      return Ordering.Greater
    } else {
      return Ordering.Less
    }
  }

  // FIXME: Only integers support comparing ATM
  throw new Unimplemented()
}

enum Ordering {
  Equal,
  Greater,
  Less,
}

type ProcedureInfo = {
  name: string
  // Used for error logging during procedure call
  callKeywordSpan: TokenSpan
}

export type VirtualProcedure = (vm: VirtualMachine) => void

enum ProcedureKind {
  Native,
  Virtual,
}

type Procedure =
  | { kind: ProcedureKind.Native; value: Block }
  | { kind: ProcedureKind.Virtual; value: VirtualProcedure }
