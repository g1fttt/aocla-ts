import { ObjectKind } from "./vm.ts"
import type { Object } from "./vm.ts"

export class Parser {
  source: string
  currentIndex: number

  constructor(source: string) {
    this.source = "[" + source + "]"
    this.currentIndex = 0
  }

  parseObject(): Object {
    this.skipWhitespace()

    const currentChar = this.currentChar()
    if (!currentChar || this.currentIndex >= this.source.length) {
      throw new Error("Out of bound")
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
      throw new Error(`Invalid symbol: ${currentChar}`)
    }
  }

  parseQuoted(): Object {
    const nextChar = this.nextCharAdvance()
    if (!nextChar) {
      throw new Error("Nothing to quote")
    }

    if (Parser.isSymbol(nextChar)) {
      return this.parseSymbol({ isQuoted: true })
    } else if (nextChar === "(") {
      return this.parseSequence({ isQuoted: true })
    } else {
      throw new Error("Only Symbol and Tuple are allowed to be quoted")
    }
  }

  parseSymbol(args: { isQuoted: boolean }): Object {
    const startIndex = this.currentIndex

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

    const symbol = this.source.slice(startIndex, this.currentIndex)

    return { kind: ObjectKind.Symbol, value: [symbol, args.isQuoted] }
  }

  parseInteger(): Object {
    const startIndex = this.currentIndex

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

    const integerAsString = this.source.slice(startIndex, this.currentIndex)

    return { kind: ObjectKind.Integer, value: parseInt(integerAsString) }
  }

  parseBoolean(): Object {
    const state = this.nextCharAdvance()
    if (state !== "t" && state !== "f") {
      throw new Error("Booleans are either #t or #f")
    }

    this.skipChar()

    return { kind: ObjectKind.Boolean, value: state === "t" }
  }

  parseString(): Object {
    const startIndex = this.currentIndex

    while (true) {
      const currentChar = this.nextCharAdvance()
      if (!currentChar) {
        throw new Error("String never closed")
      }

      if (currentChar === '"') {
        this.skipChar()

        break
      }
    }

    const string = this.source.slice(startIndex + 1, this.currentIndex - 1)

    return { kind: ObjectKind.String, value: string }
  }

  parseSequence(args: { isQuoted: boolean }): Object {
    const leftBracket = this.currentCharAdvance()

    let rightBracket: string | undefined

    switch (leftBracket) {
      case "(":
        rightBracket = ")"
        break
      case "[":
        rightBracket = "]"
        break
      default: // Unreachable
    }

    let innerObjects: Array<Object> = []

    while (true) {
      this.skipWhitespace()

      const currentChar = this.currentChar()
      if (!currentChar) {
        throw new Error("Sequence never closed")
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

  skipWhitespace() {
    while (true) {
      const currentChar = this.currentChar()
      if (!currentChar || ![" ", "\n"].includes(currentChar)) {
        break
      }

      this.skipChar()
    }
  }

  currentChar(): string | undefined {
    return this.source[this.currentIndex]
  }

  currentCharAdvance(): string | undefined {
    return this.source[this.currentIndex++]
  }

  nextCharAdvance(): string | undefined {
    return this.source[++this.currentIndex]
  }

  nextChar(): string | undefined {
    return this.source[this.currentIndex + 1]
  }

  skipChar() {
    ++this.currentIndex
  }

  static isNumeric(char: string): boolean {
    // TODO: negative numbers
    return char >= "0" && char <= "9"
  }

  static isSymbol(char: string): boolean {
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
