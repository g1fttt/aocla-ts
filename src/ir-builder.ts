import type { RootObject, Object, Symbol, Tuple } from "./parser.ts"
import { ObjectKind, SymbolKind } from "./parser.ts"

import { AoclaError, ErrorKind, Unimplemented } from "./error.ts"
import { type TokenSpan } from "./tokenizer.ts"

export function buildIR(root: RootObject): Array<Command> {
  const transformer = new CommandTransformer()

  return transformer.transform(root)
}

class CommandTransformer {
  // Used to store commands like Block or Symbol for further combining of them into the certain Commands.
  //
  // DeclProcedure for example is a combination of Block and Symbol,
  // but before we can surely say that one or another block belongs
  // to specific Command - we have to store them in a temporary storage.
  private readonly commandStack = new Array<Command>()

  public transform(objectList: Array<Object>): Array<Command> {
    objectList.forEach((object) => this.transformSingle(object))

    return this.commandStack
  }

  private transformSingle(object: Object) {
    switch (object.kind) {
      case ObjectKind.Number:
      case ObjectKind.String:
      case ObjectKind.Boolean:
      case ObjectKind.List:
        this.commandStack.push({
          kind: CommandKind.Value,
          value: { object },
          span: object.span,
        })

        break
      case ObjectKind.Tuple: {
        this.transformTuple(object.value, object.span)

        break
      }
      case ObjectKind.Symbol: {
        this.transformSymbol(object.value, object.span)

        break
      }
    }
  }

  private transformTuple({ objects, isQuoted }: Tuple, span: TokenSpan) {
    // TODO ------------------------^^^^^^^^

    if (isQuoted) {
      throw new Unimplemented()
      // -------^^^^^^^^^^^^^^^
    }

    // We don't have to care about types here because parser
    // has already validated all the necessary types for us.
    const names = objects.map((o) => (o.value as Symbol).name)

    this.commandStack.push({
      kind: CommandKind.DeclVariables,
      value: { names },
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

      this.commandStack.push({
        kind: CommandKind.Value,
        value: {
          object: {
            kind: ObjectKind.Symbol,
            value: { name, kind, isQuoted },
            span,
          },
        },
        span,
      })

      return
    }

    switch (kind) {
      case SymbolKind.Variable:
        this.commandStack.push({
          kind: CommandKind.PushVariableToStack,
          value: { name },
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
      case "match":
        this.handleMatch(symbolSpan)

        break
      default:
        this.commandStack.push({
          kind: CommandKind.CallProcedure,
          value: { name: symbolName },
          span: symbolSpan,
        })

        break
    }
  }

  private handleProc(parentSpan: TokenSpan) {
    const [procSymbol, _] = this.popSymbol(parentSpan)
    const [procBody, procBodySpan] = this.popList(parentSpan)
    const span = procBodySpan.combinedWith(parentSpan)

    this.commandStack.push({
      kind: CommandKind.DeclProcedure,
      value: {
        name: procSymbol.name,
        body: procBody,
      },
      span,
    })
  }

  private handleInclude(parentSpan: TokenSpan) {
    const [path, pathSpan] = this.popString(parentSpan)
    const span = pathSpan.combinedWith(parentSpan)

    this.commandStack.push({
      kind: CommandKind.IncludeModule,
      value: { path },
      span,
    })
  }

  private handleMatch(parentSpan: TokenSpan) {
    let branches = new Map<Command, LazyBlock>()

    let selector: Command | undefined
    let defaultBranch: MatchDefaultBranch | undefined

    outerLoop: while (true) {
      const command = this.commandStack.pop()
      if (!command) {
        throw this.error(ErrorKind.SemanticError, parentSpan)
      }

      switch (command.kind) {
        case CommandKind.Value:
          const object = command.value.object
          if (object.kind === ObjectKind.List) {
            break
          }

          selector = command

          break outerLoop
        case CommandKind.PushVariableToStack:
          selector = command

          break outerLoop
        default:
          throw this.error(ErrorKind.SemanticError, command.span)
      }

      const branchLazyBlock = command.value.object.value as LazyBlock
      if (branchLazyBlock.length !== 2) {
        throw this.error(ErrorKind.SemanticError, command.span)
      }

      // [10 ["Ten\n" print]]
      // ----^^^^^^^^^^^^^^^-
      const lazyHandler = branchLazyBlock[1]!

      if (lazyHandler.kind !== ObjectKind.List) {
        throw this.error(ErrorKind.TypeMismatch, lazyHandler.span)
      }

      // [10 ["Ten\n" print]]
      // -^^-----------------
      const pattern = buildIR(branchLazyBlock)[0]!

      switch (pattern.kind) {
        case CommandKind.Value:
        case CommandKind.PushVariableToStack:
          if (branches.has(pattern)) {
            throw this.error(
              ErrorKind.SemanticError,
              pattern.span,
              "Branch with the same pattern is already presented",
            )
          }

          branches.set(pattern, lazyHandler.value)

          break
        case CommandKind.DeclVariables:
          if (defaultBranch !== undefined) {
            throw this.error(
              ErrorKind.SemanticError,
              pattern.span,
              "Having more than two default branches is forbidden",
            )
          }

          defaultBranch = { pattern, handler: lazyHandler.value }

          break
        default:
          throw this.error(ErrorKind.SemanticError, pattern.span)
      }
    }

    const span = selector.span.combinedWith(parentSpan)

    this.commandStack.push({
      kind: CommandKind.Match,
      value: { selector, branches, defaultBranch },
      span,
    })
  }

  private popSymbol(parentSpan: TokenSpan): [Symbol, TokenSpan] {
    const symbolCommand = this.commandStack.pop()
    if (!symbolCommand) {
      throw this.error(ErrorKind.OutOfStack, parentSpan)
    }

    const commandValue = symbolCommand.value as Value
    const symbol = commandValue?.object?.value as Symbol | undefined

    if (!symbol) {
      throw this.error(ErrorKind.TypeMismatch, symbolCommand.span)
    }

    return [symbol, symbolCommand.span]
  }

  private popString(parentSpan: TokenSpan): [string, TokenSpan] {
    const stringCommand = this.commandStack.pop()
    if (!stringCommand) {
      throw this.error(ErrorKind.OutOfStack, parentSpan)
    }

    const commandValue = stringCommand.value as Value
    const string = commandValue?.object?.value as string | undefined

    if (!string) {
      throw this.error(ErrorKind.TypeMismatch, stringCommand.span)
    }

    return [string, stringCommand.span]
  }

  private popList(parentSpan: TokenSpan): [Array<Object>, TokenSpan] {
    const listCommand = this.commandStack.pop()
    if (!listCommand) {
      throw this.error(ErrorKind.OutOfStack, parentSpan)
    }

    const commandValue = listCommand.value as Value
    const list = commandValue?.object?.value as Array<Object> | undefined

    if (!list) {
      throw this.error(ErrorKind.TypeMismatch, listCommand.span)
    }

    return [list, listCommand.span]
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

export enum CommandKind {
  DeclProcedure,
  CallProcedure,
  DeclVariables,
  IncludeModule,
  PushVariableToStack,
  Match,
  Value,
}

export type DeclProcedure = {
  readonly name: string
  readonly body: LazyBlock
}

export type CallProcedure = {
  readonly name: string
}

export type DeclVariables = {
  readonly names: Array<string>
}

export type IncludeModule = {
  readonly path: string
}

export type PushVariableToStack = {
  readonly name: string
}

export type MatchDefaultBranch = {
  readonly pattern: Command
  readonly handler: LazyBlock
}

export type Match = {
  readonly selector: Command
  readonly branches: Map<Command, LazyBlock>
  readonly defaultBranch: MatchDefaultBranch | undefined
}

export type Value = {
  readonly object: Object
}

export type CommandData =
  | { kind: CommandKind.DeclProcedure; value: DeclProcedure }
  | { kind: CommandKind.CallProcedure; value: CallProcedure }
  | { kind: CommandKind.DeclVariables; value: DeclVariables }
  | { kind: CommandKind.IncludeModule; value: IncludeModule }
  | { kind: CommandKind.PushVariableToStack; value: PushVariableToStack }
  | { kind: CommandKind.Match; value: Match }
  | { kind: CommandKind.Value; value: Value }

export type Command = CommandData & { span: TokenSpan }

export type Block = Array<Command>
export type LazyBlock = Array<Object>
