import { AoclaError, ErrorKind } from "./error.ts"

export function extractTokens(source: string): Array<Token> {
  const tokenizer = new Tokenizer(source)

  return tokenizer.extractTokens()
}

class Tokenizer {
  private globalIndex = 0
  private tokens = new Array<Token>()

  private relativeIndex = 0
  private line = 1

  public constructor(private readonly source: string) {}

  public extractTokens(): Array<Token> {
    while (true) {
      const currentChar = this.currentChar()
      if (!currentChar) {
        break
      }

      if (Tokenizer.isInteger(currentChar, this.nextChar())) {
        this.extractInteger()
      } else if (Tokenizer.isSymbol(currentChar)) {
        this.extractSymbol()
      } else if (Tokenizer.isString(currentChar)) {
        this.extractString()
      } else if (Tokenizer.isWhitespace(currentChar)) {
        this.skipWhitespace()

        continue
      } else {
        this.matchChar(currentChar)
        this.skipChar()
      }
    }
    return this.tokens
  }

  private matchChar(currentChar: string) {
    switch (currentChar) {
      case "[":
        this.pushToken(TokenKind.LeftBracket)
        break
      case "(":
        this.pushToken(TokenKind.LeftParen)
        break
      case "]":
        this.pushToken(TokenKind.RightBracket)
        break
      case ")":
        this.pushToken(TokenKind.RightParen)
        break
      case "#":
        this.pushToken(TokenKind.Hash)
        break
      case "@":
        this.pushToken(TokenKind.At)
        break
      case "'":
        this.pushToken(TokenKind.SingleQuote)
        break
      default:
        throw this.error(`Invalid symbol: ${currentChar}`)
    }
  }

  private extractInteger() {
    const startPos = this.tokenStartPos()

    // Infinite loop prevention
    if (this.currentChar() === "-") {
      this.skipChar()
    }

    while (true) {
      const currentChar = this.currentChar()
      if (!currentChar) {
        break
      }

      if (!Tokenizer.isNumeric(currentChar)) {
        break
      }

      this.skipChar()
    }

    this.pushToken(TokenKind.Numeric, startPos)
  }

  private extractSymbol() {
    const startPos = this.tokenStartPos()

    while (true) {
      let currentChar = this.currentChar()
      if (!currentChar) {
        break
      }

      const isSymbol = Tokenizer.isSymbol(currentChar)
      const isNumeric = Tokenizer.isNumeric(currentChar)

      if (!isSymbol && !isNumeric) {
        break
      }

      this.skipChar()
    }

    this.pushToken(TokenKind.Symbol, startPos)
  }

  private extractString() {
    const startPos = this.tokenStartPos()

    this.skipChar()

    while (true) {
      const currentChar = this.currentChar()
      if (!currentChar) {
        throw this.error("String was never closed")
      }

      this.skipChar()

      if (currentChar === '"') {
        break
      }
    }

    this.pushToken(TokenKind.String, startPos)
  }

  private currentChar(): string | undefined {
    return this.source[this.globalIndex]
  }

  private nextChar(): string | undefined {
    return this.source[this.globalIndex + 1]
  }

  private skipChar(args = { onlyGlobal: false }) {
    ++this.globalIndex

    if (!args.onlyGlobal) {
      ++this.relativeIndex
    }
  }

  private skipWhitespace() {
    outerLoop: while (true) {
      const currentChar = this.currentChar()
      if (!currentChar) {
        break
      }

      switch (currentChar) {
        case " ":
          break
        case "\n":
          if (this.globalIndex < this.source.length - 1) {
            ++this.line
            this.relativeIndex = 0
          }

          // Already at the end of a line: new-line symbol become "invisible".
          this.skipChar({ onlyGlobal: true })

          continue
        default:
          break outerLoop
      }

      this.skipChar()
    }
  }

  private tokenStartPos(): [number, number, number] {
    return [this.globalIndex, this.relativeIndex, this.line]
  }

  private pushToken(kind: TokenKind, startPos?: [number, number, number]) {
    const [globalStart, relativeStart, line] = startPos || this.tokenStartPos()

    let globalEnd = this.globalIndex

    if (!startPos) {
      ++globalEnd
    }

    const length = globalEnd - globalStart

    const tokenString = this.source.slice(globalStart, globalEnd)
    const tokenSpan = new TokenSpan(globalStart, relativeStart, length, line)

    this.tokens.push({ string: tokenString, kind, span: tokenSpan })
  }

  private static isInteger(
    currentChar: string,
    nextChar: string | undefined,
  ): boolean {
    const isNumeric = Tokenizer.isNumeric(currentChar)

    if (!nextChar) {
      return isNumeric
    }

    return isNumeric || Tokenizer.isNegativeNumeric(currentChar, nextChar)
  }

  private static isWhitespace(char: string): boolean {
    return [" ", "\n"].includes(char)
  }

  private static isNegativeNumeric(char: string, nextChar: string): boolean {
    return char === "-" && Tokenizer.isNumeric(nextChar)
  }

  private static isNumeric(char: string): boolean {
    return char >= "0" && char <= "9"
  }

  private static isString(char: string): boolean {
    return char === '"'
  }

  private static isSymbol(char: string): boolean {
    // prettier-ignore
    const specialSymbols = [
      "_", "$", ".", "~",
      "+", "-", "*", "/",
      "=", "?", "!", "%",
      ">", "<", "&", "|",
    ]

    return (
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      specialSymbols.includes(char)
    )
  }

  private error(message: string): AoclaError {
    return new AoclaError({
      message,
      kind: ErrorKind.SyntaxError,
      lineRelativePos: { start: this.relativeIndex, end: -1 },
      line: this.line,
    })
  }
}

export type Span = { start: number; end: number }

export class TokenSpan {
  public readonly global: Span
  public readonly relative: Span
  public readonly line: number

  public constructor(
    globalStart: number,
    relativeStart: number,
    length: number,
    line: number,
  ) {
    this.global = { start: globalStart, end: globalStart + length }
    this.relative = { start: relativeStart, end: relativeStart + length }
    this.line = line
  }

  public combinedWith(other: TokenSpan): TokenSpan {
    const globalStart = Math.min(this.global.start, other.global.start)
    const relativeStart = Math.min(this.relative.start, other.relative.start)
    const length =
      Math.max(this.global.start, other.global.start) -
      Math.min(this.global.start, other.global.start)
    const line = Math.min(this.line, other.line)

    return new TokenSpan(globalStart, relativeStart, length, line)
  }
}

export type Token = {
  readonly string: string
  readonly kind: TokenKind
  readonly span: TokenSpan
}

export enum TokenKind {
  Numeric,
  Symbol,
  String,
  LeftBracket,
  RightBracket,
  LeftParen,
  RightParen,
  SingleQuote,
  Hash,
  At,
}
