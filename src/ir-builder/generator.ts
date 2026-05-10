import { CompCommandKind, CommandKind, ValueKind } from "@/ir-builder.ts"
import type {
  CompCommand,
  Command,
  DeclProcedure,
  Match,
} from "@/ir-builder.ts"

import { AoclaError, ErrorKind } from "@/error"
import type { TokenSpan } from "@/tokenizer.ts"

export class ByteCodeGenerator {
  private commandSequence = new Array<Command>()
  private procedures = new Map<string, number>()

  public generate(transformedAst: Array<CompCommand>): Array<Command> {
    this.generateList(transformedAst)

    return this.commandSequence
  }

  private generateList(commandList: Array<CompCommand>) {
    commandList.forEach((command) => this.generateSingle(command))
  }

  private generateSingle(command: CompCommand) {
    switch (command.kind) {
      case CompCommandKind.CallProcedure: {
        const { value, span } = command
        this.unwrapCallProcedure(value, span)

        break
      }
      case CompCommandKind.DeclProcedure: {
        const { value, span } = command
        this.unwrapDeclProcedure(value, span)

        break
      }
      case CompCommandKind.Match: {
        const { value, span } = command
        this.unwrapMatch(value, span)

        break
      }
      case CompCommandKind.AtomicCommand: {
        const { kind, value } = command.value

        if (kind === CommandKind.PushValueToStack) {
          if (value.kind === ValueKind.CommandList) {
            this.unwrapCommandList(value.value, value.span)

            return
          }
        }

        this.commandSequence.push(command.value)

        break
      }
    }
  }

  private unwrapCommandList(list: Array<CompCommand>, span: TokenSpan) {
    const generator = new ByteCodeGenerator()
    const commandSequence = generator.generate(list)

    const pushCommandListInfoToStack: Command = {
      kind: CommandKind.PushCommandListInfoToStack,
      value: commandSequence.length,
      span,
    }

    const relativeJump: Command = {
      kind: CommandKind.RelativeJump,
      value: commandSequence.length + 1,
      span,
    }

    this.commandSequence.push(
      pushCommandListInfoToStack,
      relativeJump,
      ...commandSequence,
    )
  }

  private unwrapCallProcedure(name: string, span: TokenSpan) {
    const procedureAddr = this.procedures.get(name)
    if (!procedureAddr) {
      throw new AoclaError({
        kind: ErrorKind.Undefined,
        lineRelativePos: span.relative,
        line: span.line,
      })
    }

    this.commandSequence.push({
      kind: CommandKind.Call,
      value: procedureAddr,
      span,
    })
  }

  private unwrapDeclProcedure({ name, body }: DeclProcedure, span: TokenSpan) {
    const generator = new ByteCodeGenerator()
    const commandSequence = generator.generate(body)

    this.procedures.set(name, this.commandSequence.length + 1)

    const relativeJump: Command = {
      kind: CommandKind.RelativeJump,
      value: commandSequence.length + 2 /* due to return command */,
      span,
    }

    const returnCommand: Command = {
      kind: CommandKind.Return,
      value: undefined,
      span,
    }

    this.commandSequence.push(relativeJump, ...commandSequence, returnCommand)
  }

  private unwrapMatch(
    { selector, branches, defaultBranch }: Match,
    span: TokenSpan,
  ) {
    const reversedBranches = branches.entries().toArray().toReversed()

    for (const [pattern, handler] of reversedBranches) {
      const generator = new ByteCodeGenerator()
      const commandSequence = generator.generate(handler)

      const compare: Command = {
        kind: CommandKind.Compare,
        value: undefined,
        span,
      }

      const relativeJumpNeq: Command = {
        kind: CommandKind.RelativeJumpNeq,
        value: commandSequence.length + 1,
        span,
      }

      this.commandSequence.push(
        selector,
        pattern,
        compare,
        relativeJumpNeq,
        ...commandSequence,
      )
    }

    if (!defaultBranch) {
      return
    }

    const { pattern, handler } = defaultBranch

    const generator = new ByteCodeGenerator()
    const commandSequence = generator.generate(handler)

    this.commandSequence.push(selector, pattern, ...commandSequence)
  }
}
