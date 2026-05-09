import type { Span } from "./tokenizer"

export class Unreachable extends Error {
  public constructor() {
    super("Unreachable")
  }
}

export class Unimplemented extends Error {
  public constructor() {
    super("Unimplemented")
  }
}

export class UnexpectedEOF extends Error {
  public constructor() {
    super("Unexpected EOF")
  }
}

// TODO: Additional error info e.g. stack size on 'OutOfStack' or type A and type B on 'TypeMismatch'
export enum ErrorKind {
  UnknownPath,
  OutOfStack,
  TypeMismatch,
  SyntaxError,
  SemanticError,
  Undefined,
  User,
}

export type ErrorInfo = {
  readonly message?: string
  readonly kind: ErrorKind
  readonly lineRelativePos: Span
  readonly line: number
}

export class AoclaError extends Error {
  public constructor(private readonly info: ErrorInfo) {
    super(info.message)
  }

  public formattedString(): string {
    return `[${ErrorKind[this.info.kind]}] -- ${this.message ? this.message : "No message provided"} ${this.info.line}:${this.info.lineRelativePos.start + 1}`
  }
}
