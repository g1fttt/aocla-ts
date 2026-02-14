import type { ParserSpan } from "./parser"

export class Unreachable extends Error {
  constructor() {
    super("Unreachable")
  }
}

export class Unimplemented extends Error {
  constructor() {
    super("Unimplemented")
  }
}

export class PosError extends Error {
  public readonly span: ParserSpan
  private readonly shouldIncrement: boolean

  public constructor(
    message: string,
    span: ParserSpan,
    shouldIncrement = false,
  ) {
    super(message)

    this.span = structuredClone(span)
    this.shouldIncrement = shouldIncrement
  }

  public formattedMessage(): string {
    throw new Unimplemented()
  }

  protected position(): string {
    let start = this.span.relativeStart

    if (this.shouldIncrement) {
      ++start
    }

    return `${this.span.line}:${start}`
  }
}
