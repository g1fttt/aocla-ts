import { type FormattedError } from "./error.ts"

export class Tokenizer {
  private readonly source: string
  private globalIndex: number
  private tokens: Array<Token>

  private relativeIndex: number
  private line: number

  public constructor(source: string) {
    this.source = source
    this.globalIndex = 0
    this.tokens = new Array()

    this.relativeIndex = 0
    this.line = 1
  }

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
      } else if (Tokenizer.isWhitespace(currentChar)) {
        this.skipWhitespace()

        continue
      } else {
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
          case '"':
            this.extractString()
            break
          default:
            throw this.error(`Invalid symbol: ${currentChar}`)
        }

        this.skipChar()
      }
    }
    return this.tokens
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

  private error(message: string): TokenizerError {
    return new TokenizerError(message, this.relativeIndex, this.line)
  }

  private tokenStartPos(): [number, number, number] {
    return [this.globalIndex, this.relativeIndex, this.line]
  }

  private pushToken(kind: TokenKind, startPos?: [number, number, number]) {
    const [globalStart, relativeStart, line] = startPos || this.tokenStartPos()

    let globalEnd = this.globalIndex
    let relativeEnd = this.relativeIndex

    if (!startPos) {
      ++globalEnd
      ++relativeEnd
    }

    const tokenString = this.source.slice(globalStart, globalEnd)
    const tokenSpan = new TokenSpan(
      globalStart,
      globalEnd,
      relativeStart,
      relativeEnd,
      line,
    )

    const token = new Token(tokenString, kind, tokenSpan)
    this.tokens.push(token)
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
}

export class TokenSpan {
  public constructor(
    public readonly globalStart: number,
    public readonly globalEnd: number,

    public readonly relativeStart: number,
    public readonly relativeEnd: number,

    public readonly line: number,
  ) {}

  public combinedWith(other: TokenSpan): TokenSpan {
    const globalStart = Math.min(this.globalStart, other.globalStart)
    const globalEnd = Math.max(this.globalEnd, other.globalEnd)

    const relativeStart = Math.min(this.relativeStart, other.relativeStart)
    const relativeEnd = Math.max(this.relativeEnd, other.relativeEnd)

    const line = Math.min(this.line, other.line)

    return new TokenSpan(
      globalStart,
      globalEnd,
      relativeStart,
      relativeEnd,
      line,
    )
  }
}

export class Token {
  public constructor(
    public readonly string: string,
    public readonly kind: TokenKind,
    public readonly span: TokenSpan,
  ) {}

  //   // TODO
  //   public errorIfNot(kind: TokenKind, spanToCombineWith?: TokenSpan) {
  //     // prettier-ignore
  //     const span = spanToCombineWith !== undefined
  //       ? this.span.combinedWith(spanToCombineWith)
  //       : this.span
  //
  //     // if (this.kind !== kind) {
  //     // }
  //   }
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

export class TokenizerError implements FormattedError {
  private readonly message: string
  private readonly relativeIndex: number
  private readonly line: number

  public constructor(message: string, relativeIndex: number, line: number) {
    this.message = message
    this.relativeIndex = relativeIndex
    this.line = line
  }

  public formattedMessage(): string {
    return `Error occured during tokenizing phase at ${this.line}:${this.relativeIndex}. ${this.message}.`
  }
}
