import { type Symbol } from "./parser.ts"
import { type TokenSpan } from "./tokenizer.ts"

export type DeclProcedure = {
  readonly name: string
  readonly body: Array<CompCommand>
}

export type DeclProcedureFFI = {
  readonly libraryPath: string
  // Name of the procedure inside the library
  readonly libraryName: string
  // User-defined sort of "alias"
  readonly name: string
  readonly returnType: string
  readonly parameters: Array<string>
}

export type Tuple = {
  readonly values: Array<Value>
  readonly isQuoted: boolean
}

export type CommandListInfo = {
  readonly address: number
  readonly length: number
}

export type Match = {
  readonly selector: Command
  readonly branches: Map<Command, Array<CompCommand>>
  readonly defaultBranch: MatchDefaultBranch | undefined
}

export type MatchDefaultBranch = {
  readonly pattern: Command
  readonly handler: Array<CompCommand>
}

export enum ValueKind {
  Number,
  CommandList,
  CommandListInfo,
  Tuple,
  String,
  Boolean,
  Symbol,
}

type ValueData =
  | { kind: ValueKind.Number; value: number }
  | { kind: ValueKind.CommandList; value: Array<CompCommand> }
  | { kind: ValueKind.CommandListInfo; value: CommandListInfo }
  | { kind: ValueKind.Tuple; value: Tuple }
  | { kind: ValueKind.String; value: string }
  | { kind: ValueKind.Boolean; value: boolean }
  | { kind: ValueKind.Symbol; value: Symbol }

export type Value = ValueData & { span: TokenSpan }

export enum CompCommandKind {
  CallProcedure,
  DeclProcedure,
  Match,
  AtomicCommand,
}

type CompCommandData =
  | { kind: CompCommandKind.CallProcedure; value: string }
  | { kind: CompCommandKind.DeclProcedure; value: DeclProcedure }
  | { kind: CompCommandKind.Match; value: Match }
  | { kind: CompCommandKind.AtomicCommand; value: Command }

// NOTE: Comp means Composite. Consists of non-atomic types like Match
export type CompCommand = CompCommandData & { span: TokenSpan }

export enum CommandKind {
  DeclProcedureFFI,
  DeclVariables,
  IncludeModule,
  PushVariableToStack,
  PushValueToStack,
  Call,
  CallBuiltin,
  Return,
  Compare,
  RelativeJump,
  RelativeJumpEq,
  RelativeJumpNeq,
  // RelativeJumpGtr,
  // RelativeJumpLss,
  // RelativeJumpGeq,
  // RelativeJumpLeq,
  Add,
  Subtract,
  Multiply,
  Divide,
  PushCommandListInfoToStack,
}

type CommandData =
  | { kind: CommandKind.DeclProcedureFFI; value: DeclProcedureFFI }
  | { kind: CommandKind.DeclVariables; value: Array<string> }
  | { kind: CommandKind.IncludeModule; value: string }
  | { kind: CommandKind.PushVariableToStack; value: string }
  | { kind: CommandKind.PushValueToStack; value: Value }
  | { kind: CommandKind.Call; value: number } // Same as RelativeJump but saves return address
  | { kind: CommandKind.CallBuiltin; value: string }
  | { kind: CommandKind.Return; value: undefined }
  | { kind: CommandKind.Compare; value: undefined }
  | { kind: CommandKind.RelativeJump; value: number }
  | { kind: CommandKind.RelativeJumpEq; value: number }
  | { kind: CommandKind.RelativeJumpNeq; value: number }
  | { kind: CommandKind.Add; value: undefined }
  | { kind: CommandKind.Subtract; value: undefined }
  | { kind: CommandKind.Multiply; value: undefined }
  | { kind: CommandKind.Divide; value: undefined }
  | { kind: CommandKind.PushCommandListInfoToStack; value: number /* length */ }

export type Command = CommandData & { span: TokenSpan }
