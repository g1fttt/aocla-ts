import { Unreachable } from "./error.ts"
import { ObjectKind } from "./vm.ts"
import type { Object } from "./vm.ts"

export class Parser {
  private readonly source: string
  private globalIndex: number
  private relativeIndex: number
  private line: number

  public constructor(source: string) {
    this.source = "[" + source + "]"
    this.globalIndex = 0
    this.relativeIndex = 0
    this.line = 0
  }

  public parseObject(): Object {
    this.skipWhitespace()

    const currentChar = this.currentChar()
    if (!currentChar || this.globalIndex >= this.source.length) {
      throw this.error("Out of bound")
    }

    if (Parser.isSymbol(currentChar)) {
      return this.parseSymbol({ isQuoted: false })
    } else if (Parser.isNumeric(currentChar)) {
      return this.parseInteger()
    } else if (currentChar === "(" || currentChar === "[") {
      return this.parseSequence({ isQuoted: false })
    } else if (currentChar === "#") {
      return this.parseBoolean()
    } else if (currentChar === '"') {
      return this.parseString()
    } else if (currentChar === "'") {
      return this.parseQuoted()
    } else {
      throw this.error(`Invalid symbol: ${currentChar}`)
    }
  }

  private parseQuoted(): Object {
    const nextChar = this.nextCharAdvance()
    if (!nextChar) {
      throw this.error("Nothing to quote")
    }

    if (Parser.isSymbol(nextChar)) {
      return this.parseSymbol({ isQuoted: true })
    } else if (nextChar === "(") {
      return this.parseSequence({ isQuoted: true })
    } else {
      throw this.error("Only Symbol and Tuple are allowed to be quoted")
    }
  }

  private parseSymbol(args: { isQuoted: boolean }): Object {
    const startIndex = this.globalIndex

    while (true) {
      let currentChar = this.currentChar()
      if (!currentChar) {
        break
      }

      if (!Parser.isSymbol(currentChar) && !Parser.isNumeric(currentChar)) {
        break
      }

      this.skipChar()
    }

    const symbol = this.source.slice(startIndex, this.globalIndex)

    return { kind: ObjectKind.Symbol, value: [symbol, args.isQuoted] }
  }

  private parseInteger(): Object {
    const startIndex = this.globalIndex

    while (true) {
      const currentChar = this.currentChar()
      if (!currentChar) {
        break
      }

      if (!Parser.isNumeric(currentChar)) {
        break
      }

      this.skipChar()
    }

    const integerAsString = this.source.slice(startIndex, this.globalIndex)

    return { kind: ObjectKind.Integer, value: parseInt(integerAsString) }
  }

  private parseBoolean(): Object {
    const state = this.nextCharAdvance()
    if (state !== "t" && state !== "f") {
      throw this.error("Booleans are either #t or #f")
    }

    this.skipChar()

    return { kind: ObjectKind.Boolean, value: state === "t" }
  }

  private parseString(): Object {
    const startIndex = this.globalIndex

    while (true) {
      const currentChar = this.nextCharAdvance()
      if (!currentChar) {
        throw this.error("String was never closed")
      }

      if (currentChar === '"') {
        this.skipChar()

        break
      }
    }

    const string = this.source.slice(startIndex + 1, this.globalIndex - 1)

    const escapeSequences: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
    }

    const unescapedString = string.replace(/\\(.)/g, (match, char) => {
      return escapeSequences[char] || match
    })

    return { kind: ObjectKind.String, value: unescapedString }
  }

  private parseSequence(args: { isQuoted: boolean }): Object {
    const leftBracket = this.currentCharAdvance()

    let rightBracket: string | undefined

    switch (leftBracket) {
      case "(":
        rightBracket = ")"
        break
      case "[":
        rightBracket = "]"
        break
      default:
        throw new Unreachable()
    }

    let innerObjects: Array<Object> = []

    while (true) {
      this.skipWhitespace()

      const currentChar = this.currentChar()
      if (!currentChar) {
        throw this.error("Sequence was never closed")
      }

      if (currentChar === rightBracket) {
        this.skipChar()

        switch (rightBracket) {
          case "]":
            return { kind: ObjectKind.List, value: innerObjects }
          case ")":
            return {
              kind: ObjectKind.Tuple,
              value: [innerObjects, args.isQuoted],
            }
        }
      }

      innerObjects.push(this.parseObject())
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
          ++this.line
          this.relativeIndex = 0

          break
        default:
          break outerLoop
      }

      this.skipChar()
    }
  }

  private currentChar(): string | undefined {
    return this.source[this.globalIndex]
  }

  private currentCharAdvance(): string | undefined {
    return this.source[this.globalIndex++]
  }

  private nextCharAdvance(): string | undefined {
    return this.source[++this.globalIndex]
  }

  private skipChar() {
    ++this.globalIndex
    ++this.relativeIndex
  }

  private error(message: string): ParserError {
    return new ParserError(message, this.line + 1, this.relativeIndex + 1)
  }

  private static isNumeric(char: string): boolean {
    // TODO: negative numbers
    return char >= "0" && char <= "9"
  }

  private static isSymbol(char: string): boolean {
    // prettier-ignore
    const specialSymbols = [
      "_", "@", "$", "+",
      "-", "*", "/", "=",
      "?", "!", "%", ">",
      "<", "&", "|", "~",
    ]

    return (
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      specialSymbols.includes(char)
    )
  }
}

export class ParserError extends Error {
  public readonly row: number
  public readonly column: number

  public constructor(message: string, row: number, column: number) {
    super(message)

    this.row = row
    this.column = column
  }

  public formattedMessage(): string {
    return `Error occured during parsing phase at ${this.row}:${this.column}. ${this.message}.`
  }
}
