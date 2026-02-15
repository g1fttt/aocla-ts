import { type FormattedError } from "./error.ts"
import { ObjectKind, type Object } from "./vm.ts"

export class Parser {
  private readonly source: string
  private globalIndex: number

  private relativeIndex: number
  private line: number

  public constructor(source: string) {
    this.source = source
    this.globalIndex = 0
    this.relativeIndex = 0
    this.line = 1
  }

  public parseObject(): Object {
    return this.parseList({ isRoot: true })
  }

  private parseQuoted(): Object {
    const nextChar = this.nextCharAdvance()
    if (!nextChar) {
      throw this.error("Nothing to quote")
    }

    if (Parser.isSymbol(nextChar)) {
      return this.parseSymbol({ isQuoted: true })
    } else if (nextChar === "(") {
      return this.parseTuple({ isQuoted: true })
    } else {
      throw this.error("Only Symbol and Tuple are allowed to be quoted")
    }
  }

  private parseSymbol(args: { isQuoted: boolean }): Object {
    const startPos = this.objectStartPos()
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

    return this.object(ObjectKind.Symbol, [symbol, args.isQuoted], startPos)
  }

  private parseInteger(): Object {
    const startPos = this.objectStartPos()
    const startIndex = this.globalIndex

    // Infinite loop prevention
    if (this.currentChar() === "-") {
      this.skipChar()
    }

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

    return this.object(ObjectKind.Integer, parseInt(integerAsString), startPos)
  }

  private parseBoolean(): Object {
    const startPos = this.objectStartPos()

    const state = this.nextCharAdvance()
    if (state !== "t" && state !== "f") {
      throw this.error("Booleans can be either #t or #f")
    }

    this.skipChar()

    return this.object(ObjectKind.Boolean, state === "t", startPos)
  }

  private parseString(): Object {
    const startPos = this.objectStartPos()

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

    return this.object(ObjectKind.String, unescapedString, startPos)
  }

  public parseList(args = { isRoot: false }): Object {
    const startPos = this.objectStartPos()

    if (!args.isRoot) {
      this.skipChar()
    }

    let objects = new Array<Object>()

    while (true) {
      const currentChar = this.currentChar()
      if (!currentChar) {
        if (args.isRoot) break
        else throw this.error("List was never closed")
      }

      if (currentChar === "]" && !args.isRoot) {
        this.skipChar()

        break
      }

      let object: Object

      if (Parser.isInteger(currentChar, this.nextChar())) {
        object = this.parseInteger()
      } else if (Parser.isSymbol(currentChar)) {
        object = this.parseSymbol({ isQuoted: false })
      } else if (Parser.isWhitespace(currentChar)) {
        this.skipWhitespace()

        continue
      } else {
        switch (currentChar) {
          case "[":
            object = this.parseList()
            break
          case "(":
            object = this.parseTuple({ isQuoted: false })
            break
          case "#":
            object = this.parseBoolean()
            break
          case '"':
            object = this.parseString()
            break
          case "'":
            object = this.parseQuoted()
            break
          default:
            throw this.error(`Invalid symbol: ${currentChar}`)
        }
      }

      objects.push(object)
    }

    return this.object(ObjectKind.List, objects, startPos)
  }

  private parseTuple(args: { isQuoted: boolean }): Object {
    const startPos = this.objectStartPos()

    this.skipChar()

    let objects = new Array<Object>()

    while (true) {
      const currentChar = this.currentChar()
      if (!currentChar) {
        throw this.error("Tuple was never closed")
      }

      if (Parser.isWhitespace(currentChar)) {
        this.skipWhitespace()

        continue
      } else if (Parser.isSymbol(currentChar)) {
        objects.push(this.parseSymbol({ isQuoted: false }))
      } else if (currentChar === ")") {
        this.skipChar()

        break
      }
    }

    return this.object(ObjectKind.Tuple, [objects, args.isQuoted], startPos)
  }

  private currentChar(): string | undefined {
    return this.source[this.globalIndex]
  }

  private nextChar(): string | undefined {
    return this.source[this.globalIndex + 1]
  }

  private nextCharAdvance(): string | undefined {
    this.skipChar()

    return this.source[this.globalIndex]
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

  private error(message: string): ParserError {
    return new ParserError(message, this.relativeIndex, this.line)
  }

  private objectStartPos(): [number, number] {
    return [this.relativeIndex, this.line]
  }

  private object(
    kind: ObjectKind,
    value: any,
    start: [number, number],
  ): Object {
    const [relativeStart, line] = start

    return {
      kind,
      value,
      span: {
        relativeStart: relativeStart,
        relativeEnd: this.relativeIndex,
        line: line,
      },
    }
  }

  private static isInteger(
    currentChar: string,
    nextChar: string | undefined,
  ): boolean {
    const isNumeric = Parser.isNumeric(currentChar)

    if (!nextChar) {
      return isNumeric
    }

    return isNumeric || Parser.isNegativeNumeric(currentChar, nextChar)
  }

  private static isWhitespace(char: string): boolean {
    return [" ", "\n"].includes(char)
  }

  private static isNegativeNumeric(char: string, nextChar: string): boolean {
    return char === "-" && Parser.isNumeric(nextChar)
  }

  private static isNumeric(char: string): boolean {
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

export type ParserSpan = {
  relativeStart: number
  relativeEnd: number
  line: number
}

export class ParserError implements FormattedError {
  private readonly message: string
  private readonly relativeIndex: number
  private readonly line: number

  public constructor(message: string, relativeIndex: number, line: number) {
    this.message = message
    this.relativeIndex = relativeIndex
    this.line = line
  }

  public formattedMessage(): string {
    return `Error occured during parsing phase at ${this.line}:${this.relativeIndex}. ${this.message}.`
  }
}
