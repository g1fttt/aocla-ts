import type { Object, Symbol, ObjectTuple } from "@/parser.ts"
import { ObjectKind, SymbolKind } from "@/parser.ts"

import type {
  Command,
  CompCommand,
  MatchDefaultBranch,
  Tuple,
  Value,
} from "@/ir-builder.ts"
import { CommandKind, CompCommandKind, ValueKind } from "@/ir-builder.ts"

import { AoclaError, ErrorKind, Unreachable } from "@/error.ts"
import { type TokenSpan } from "@/tokenizer.ts"

export class AstTransformer {
  // Used to store commands like PushValueToStack or RelativeJump
  // for further combining of them into the certain CompCommands.
  //
  // DeclProcedure for example is a combination of CompCommandList and Symbol,
  // but before we can surely say that one or another list belongs
  // to specific CompCommand - we have to store them in a temporary storage.
  private commandStack = new CommandStack()

  public transform(objectList: Array<Object>): Array<CompCommand> {
    objectList.forEach((object) => this.transformSingle(object))

    return this.commandStack.commands
  }

  private transformSingle(object: Object) {
    switch (object.kind) {
      case ObjectKind.Number:
      case ObjectKind.String:
      case ObjectKind.Boolean:
        this.transformPrimitive(object)

        break
      case ObjectKind.List:
        this.transformList(object.value, object.span)

        break
      case ObjectKind.Tuple:
        this.transformTuple(object.value, object.span)

        break
      case ObjectKind.Symbol:
        this.transformSymbol(object.value, object.span)

        break
    }
  }

  private transformPrimitive(object: Object) {
    const primitiveKind = (() => {
      switch (object.kind) {
        case ObjectKind.Number:
          return ValueKind.Number
        case ObjectKind.String:
          return ValueKind.String
        case ObjectKind.Boolean:
          return ValueKind.Boolean
        default:
          throw new Unreachable()
      }
    })()

    const span = object.span

    this.commandStack.pushAtomic({
      kind: CommandKind.PushValueToStack,
      value: { kind: primitiveKind, value: object.value, span } as Value,
      span,
    })
  }

  private transformList(objectList: Array<Object>, span: TokenSpan) {
    const transformer = new AstTransformer()

    this.commandStack.pushAtomic({
      kind: CommandKind.PushValueToStack,
      value: {
        kind: ValueKind.CommandList,
        value: transformer.transform(objectList),
        span,
      },
      span,
    })
  }

  private transformTuple({ objects, isQuoted }: ObjectTuple, span: TokenSpan) {
    const values = objects.map((o) => {
      return { kind: ValueKind.Symbol, value: o.value } as Value
    })

    if (isQuoted) {
      this.commandStack.pushAtomic({
        kind: CommandKind.PushValueToStack,
        value: {
          kind: ValueKind.Tuple,
          value: { values, isQuoted: true } as Tuple,
          span,
        },
        span,
      })

      return
    }

    // We don't have to care about types here because parser
    // has already validated all the necessary types for us.
    const names = values.map((v) => (v.value as Symbol).name)

    this.commandStack.pushAtomic({
      kind: CommandKind.DeclVariables,
      value: names,
      span,
    })
  }

  private transformSymbol({ name, kind, isQuoted }: Symbol, span: TokenSpan) {
    if (isQuoted) {
      if (kind === SymbolKind.Variable) {
        throw this.error(
          ErrorKind.SemanticError,
          span,
          "Variables cannot be quoted",
        )
      }

      this.commandStack.pushAtomic({
        kind: CommandKind.PushValueToStack,
        value: {
          kind: ValueKind.Symbol,
          value: { name, kind, isQuoted },
          span,
        },
        span,
      })

      return
    }

    switch (kind) {
      case SymbolKind.Variable:
        this.commandStack.pushAtomic({
          kind: CommandKind.PushVariableToStack,
          value: name,
          span,
        })

        break
      case SymbolKind.Procedure:
        this.transformProcedure(name, span)

        break
    }
  }

  private transformProcedure(symbolName: string, symbolSpan: TokenSpan) {
    switch (symbolName) {
      case "proc":
        this.handleProc(symbolSpan)

        break
      case "include":
        this.handleInclude(symbolSpan)

        break
      case "proc-ffi":
        this.handleProcFFI(symbolSpan)

        break
      case "match":
        this.handleMatch(symbolSpan)

        break
      case "+":
      case "-":
      case "*":
      case "/":
        this.handleArithmetic(symbolName, symbolSpan)

        break
      case "print":
      case "eval":
        this.commandStack.pushAtomic({
          kind: CommandKind.CallBuiltin,
          value: symbolName,
          span: symbolSpan,
        })

        break
      default:
        this.commandStack.push({
          kind: CompCommandKind.CallProcedure,
          value: symbolName,
          span: symbolSpan,
        })

        break
    }
  }

  // [(a b) a b + 2 +] 'sum-plus-two proc
  private handleProc(parentSpan: TokenSpan) {
    const [procSymbol, _] = this.commandStack.popSymbol()

    const [procBody, procBodySpan] = this.commandStack.popList()
    const span = procBodySpan.combinedWith(parentSpan)

    this.commandStack.push({
      kind: CompCommandKind.DeclProcedure,
      value: { name: procSymbol.name, body: procBody },
      span,
    })
  }

  // "std/io"       include
  // "std/fs.aocla" include
  private handleInclude(parentSpan: TokenSpan) {
    const [path, pathSpan] = this.commandStack.popString()
    const span = pathSpan.combinedWith(parentSpan)

    this.commandStack.pushAtomic({
      kind: CommandKind.IncludeModule,
      value: path,
      span,
    })
  }

  // ["int" ["int" "int"]] 'sum "sum" "cool_lib" proc-ffi
  private handleProcFFI(parentSpan: TokenSpan) {
    const [libraryPath] = this.commandStack.popString()
    const [libraryName] = this.commandStack.popString()

    const [nameSymbol] = this.commandStack.popSymbol()
    const name = nameSymbol.name

    const [signature, signatureSpan] = this.commandStack.popList()

    if (signature.length !== 2) {
      throw this.error(
        ErrorKind.SemanticError,
        signatureSpan,
        "FFI procedure signature is invalid. Allowed pattern: [T [A B ...]]",
      )
    }

    const [returnType, params] = signature

    const areAtomic =
      returnType?.kind === CompCommandKind.AtomicCommand &&
      params?.kind === CompCommandKind.AtomicCommand

    if (!areAtomic) {
      throw this.error(ErrorKind.SemanticError, signatureSpan)
    }

    const returnTypeAtomic = returnType.value
    if (returnTypeAtomic.kind !== CommandKind.PushValueToStack) {
      throw this.error(ErrorKind.SemanticError, returnType.span)
    }

    if (returnTypeAtomic.value.kind !== ValueKind.String) {
      throw this.error(ErrorKind.TypeMismatch, returnType.span)
    }

    const { value: returnTypeAtomicValue } = returnTypeAtomic.value

    const paramsAtomic = params.value
    if (paramsAtomic.kind !== CommandKind.PushValueToStack) {
      throw this.error(ErrorKind.SemanticError, params.span)
    }

    if (paramsAtomic.value.kind !== ValueKind.CommandList) {
      throw this.error(ErrorKind.TypeMismatch, params.span)
    }

    const paramsList = paramsAtomic.value

    const typeCheckedParamValues = paramsList.value.map((paramCommand) => {
      if (paramCommand.kind !== CompCommandKind.AtomicCommand) {
        throw this.error(ErrorKind.SemanticError, paramCommand.span)
      }

      const paramAtomic = paramCommand.value
      if (paramAtomic.kind !== CommandKind.PushValueToStack) {
        throw this.error(ErrorKind.TypeMismatch, paramAtomic.span)
      }

      const { kind, value, span } = paramAtomic.value
      if (kind !== ValueKind.String) {
        throw this.error(ErrorKind.TypeMismatch, span)
      }

      return value
    })

    const span = signatureSpan.combinedWith(parentSpan)

    this.commandStack.pushAtomic({
      kind: CommandKind.DeclProcedureFFI,
      value: {
        libraryPath,
        libraryName,
        name,
        returnType: returnTypeAtomicValue,
        parameters: typeCheckedParamValues,
      },
      span,
    })
  }

  // 1
  //   [0 ["Zero"]]
  //   [1 ["One"]]
  //   [(n) ["Default"]]
  // match
  private handleMatch(parentSpan: TokenSpan) {
    let branches = new Map<Command, Array<CompCommand>>()

    let selector: Command | undefined
    let defaultBranch: MatchDefaultBranch | undefined

    outerLoop: while (true) {
      const command = this.commandStack.popAtomic()
      if (!command) {
        throw this.error(ErrorKind.SemanticError, parentSpan)
      }

      const { kind, value, span } = command

      switch (kind) {
        case CommandKind.PushValueToStack:
          if (value.kind === ValueKind.CommandList) {
            break
          }

          selector = command

          break outerLoop
        case CommandKind.PushVariableToStack:
          selector = command

          break outerLoop
        default:
          throw this.error(ErrorKind.SemanticError, span)
      }

      if (value.kind !== ValueKind.CommandList) {
        throw this.error(ErrorKind.TypeMismatch, span)
      }

      const branchCommandStack = new CommandStack(value.value)
      if (branchCommandStack.length() !== 2) {
        throw this.error(ErrorKind.SemanticError, span)
      }

      // [10 ["Ten\n" print]]
      // ----^^^^^^^^^^^^^^^-
      const [handler, _] = branchCommandStack.popList()

      // [10 ["Ten\n" print]]
      // -^^-----------------
      const pattern = branchCommandStack.popAtomic()
      if (!pattern) {
        throw this.error(ErrorKind.SemanticError, command.span)
      }

      switch (pattern.kind) {
        case CommandKind.PushValueToStack:
        case CommandKind.PushVariableToStack:
          if (branches.has(pattern)) {
            throw this.error(
              ErrorKind.SemanticError,
              pattern.span,
              "Branch with the same pattern is already presented",
            )
          }

          branches.set(pattern, handler)

          break
        case CommandKind.DeclVariables:
          if (defaultBranch !== undefined) {
            throw this.error(
              ErrorKind.SemanticError,
              pattern.span,
              "Having more than two default branches is forbidden",
            )
          }

          defaultBranch = { pattern, handler }

          break
        default:
          throw this.error(ErrorKind.SemanticError, pattern.span)
      }
    }

    const span = selector.span.combinedWith(parentSpan)

    this.commandStack.push({
      kind: CompCommandKind.Match,
      value: { selector, branches, defaultBranch },
      span,
    })
  }

  private handleArithmetic(symbol: string, span: TokenSpan) {
    const kind = (() => {
      switch (symbol) {
        case "+":
          return CommandKind.Add
        case "-":
          return CommandKind.Subtract
        case "*":
          return CommandKind.Multiply
        case "/":
          return CommandKind.Divide
        default:
          throw new Unreachable()
      }
    })()

    this.commandStack.pushAtomic({ kind, value: undefined, span })
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
}

class CommandStack {
  public constructor(public readonly commands = new Array<CompCommand>()) {}

  public popList(): [Array<CompCommand>, TokenSpan] {
    return this.popValueAs(ValueKind.CommandList)
  }

  public popSymbol(): [Symbol, TokenSpan] {
    return this.popValueAs(ValueKind.Symbol)
  }

  public popString(): [string, TokenSpan] {
    return this.popValueAs(ValueKind.String)
  }

  public popValue(): Value {
    const command = this.popAtomic()
    if (!command) {
      throw "Command list is empty"
    }

    if (command.kind !== CommandKind.PushValueToStack) {
      throw new AoclaError({
        message: "Is not a Value",
        kind: ErrorKind.TypeMismatch,
        lineRelativePos: command.span.relative,
        line: command.span.line,
      })
    }

    return command.value as Value
  }

  public push(command: CompCommand) {
    this.commands.push(command)
  }

  public pushAtomic(command: Command) {
    this.push({
      kind: CompCommandKind.AtomicCommand,
      value: command,
      span: command.span,
    })
  }

  public pop(): CompCommand | undefined {
    return this.commands.pop()
  }

  public popAtomic(): Command | undefined {
    const compCommand = this.pop()
    if (compCommand?.kind !== CompCommandKind.AtomicCommand) {
      return undefined
    }

    return compCommand?.value
  }

  public length(): number {
    return this.commands.length
  }

  private popValueAs<T>(requiredKind: ValueKind): [T, TokenSpan] {
    const { kind, value, span } = this.popValue()

    if (kind !== requiredKind) {
      throw new AoclaError({
        message: `Is not a ${ValueKind[requiredKind]}`,
        kind: ErrorKind.TypeMismatch,
        lineRelativePos: span.relative,
        line: span.line,
      })
    }

    return [value as T, span]
  }
}
