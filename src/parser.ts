import { Tokenizer, TokenKind, TokenSpan } from "./tokenizer.ts"
import { type Token } from "./tokenizer.ts"

import { Unreachable, type FormattedError } from "./error.ts"

export class Parser {
  private readonly tokens: Array<Token>
  private currentTokenIndex: number

  private objects: Array<Object>

  // Used inside currentToken() method for throwing error in case of EOF
  private lastTokenSpan: TokenSpan | undefined

  constructor(source: string) {
    const t = new Tokenizer(source)

    this.tokens = t.extractTokens()
    this.currentTokenIndex = 0

    this.objects = new Array()
  }

  public parseAST(): Array<Object> {
    while (!this.isAtEOF()) {
      try {
        var currentToken = this.currentTokenAdvance()
      } catch {
        break
      }

      this.objects.push(this.parseObjectSingle(currentToken))
    }

    return this.objects
  }

  private parseObjectSingle(token: Token): Object {
    switch (token.kind) {
      case TokenKind.Numeric:
        return this.parseInteger(token)
      case TokenKind.Symbol:
        return this.parseProcedure(token)
      case TokenKind.String:
        return this.parseString(token)
      case TokenKind.LeftBracket:
        return this.parseList(token)
      case TokenKind.LeftParen:
        return this.parseTuple(token)
      case TokenKind.SingleQuote:
        return this.parseQuoted(token)
      case TokenKind.Hash:
        return this.parseBoolean(token)
      case TokenKind.At:
        return this.parseVariable(token)
      default:
        throw this.error(`Invalid token: ${token.string}`, token.span)
    }
  }

  private parseInteger(token: Token): Object {
    return {
      kind: ObjectKind.Integer,
      value: parseInt(token.string),
      span: token.span,
    }
  }

  private parseSymbol(
    name: string,
    span: TokenSpan,
    kind: SymbolKind,
    args = { isQuoted: false },
  ): Object {
    const value: Symbol = { name, kind, isQuoted: args.isQuoted }

    return { kind: ObjectKind.Symbol, value, span }
  }

  private parseProcedure(token: Token, args = { isQuoted: false }): Object {
    return this.parseSymbol(
      token.string,
      token.span,
      SymbolKind.Procedure,
      args,
    )
  }

  private parseVariable(atToken: Token): Object {
    const [nameToken, ok] = this.skipTokenIfIs(TokenKind.Symbol)

    const combinedSpan = atToken.span.combinedWith(nameToken.span)

    if (!ok) {
      throw this.error("Variable name must be of type Symbol", combinedSpan)
    }

    return this.parseSymbol(nameToken.string, combinedSpan, SymbolKind.Variable)
  }

  private parseString(token: Token): Object {
    const unquotedString = token.string.slice(1, -1)

    const escapeSequences: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
    }

    const unescapedString = unquotedString.replace(/\\(.)/g, (match, char) => {
      return escapeSequences[char] || match
    })

    return { kind: ObjectKind.String, value: unescapedString, span: token.span }
  }

  private parseQuoted(quoteToken: Token): Object {
    const [currentToken, ok] = this.skipTokenIfAny([
      TokenKind.Symbol,
      TokenKind.LeftParen,
    ])

    const combinedSpan = quoteToken.span.combinedWith(currentToken.span)

    if (!ok) {
      throw this.error(
        `Found invalid token inside quoted expression: ${currentToken.string}`,
        combinedSpan,
      )
    }

    switch (currentToken.kind) {
      case TokenKind.Symbol:
        return this.parseProcedure(currentToken, { isQuoted: true })
      case TokenKind.LeftParen:
        return this.parseTuple(currentToken, { isQuoted: true })
      default:
        throw new Unreachable()
    }
  }

  private parseBoolean(hashToken: Token): Object {
    const [stateToken, ok] = this.skipTokenIfIs(TokenKind.Symbol)

    const combinedSpan = hashToken.span.combinedWith(stateToken.span)

    if (!ok) {
      throw this.error("Boolean state must be of type Symbol", combinedSpan)
    }

    const state = { t: true, f: false }[stateToken.string]

    if (state === undefined) {
      throw this.error(
        "Boolean state must be either 't(rue)' or 'f(alse)'",
        combinedSpan,
      )
    }

    return { kind: ObjectKind.Boolean, value: state, span: combinedSpan }
  }

  private parseList(leftBracketToken: Token): Object {
    let objects = new Array<Object>()
    let rightBracketSpan: TokenSpan

    while (true) {
      const currentToken = this.currentTokenAdvance()

      if (currentToken.kind === TokenKind.RightBracket) {
        rightBracketSpan = currentToken.span

        break
      }

      objects.push(this.parseObjectSingle(currentToken))
    }

    const combinedSpan = leftBracketToken.span.combinedWith(rightBracketSpan)

    return { kind: ObjectKind.List, value: objects, span: combinedSpan }
  }

  private parseTuple(
    leftParenToken: Token,
    args = { isQuoted: false },
  ): Object {
    let objects = new Array<Object>()
    let rightParenSpan: TokenSpan

    outerLoop: while (true) {
      const currentToken = this.currentTokenAdvance()

      switch (currentToken.kind) {
        case TokenKind.Symbol:
          const { string, span } = currentToken

          const symbol = this.parseSymbol(string, span, SymbolKind.Variable)
          objects.push(symbol)

          break
        case TokenKind.RightParen:
          rightParenSpan = currentToken.span

          break outerLoop
        default:
          throw this.error(
            `Found invalid token inside Tuple: ${currentToken}`,
            currentToken.span,
          )
      }
    }

    const combinedSpan = leftParenToken.span.combinedWith(rightParenSpan)
    const value: Tuple = { objects, isQuoted: args.isQuoted }

    return { kind: ObjectKind.Tuple, value, span: combinedSpan }
  }

  private isAtEOF(): boolean {
    return this.currentTokenIndex >= this.tokens.length
  }

  private currentToken(args = { offset: 0 }): Token {
    const token = this.tokens[this.currentTokenIndex + args.offset]
    if (!token) {
      throw this.error("Unexpected EOF", this.lastTokenSpan!)
    }

    this.lastTokenSpan = token.span

    return token
  }

  private skipTokenIf(pred: (kind: TokenKind) => boolean): [Token, boolean] {
    const token = this.currentToken()

    if (pred(token.kind)) {
      this.skipToken()

      return [token, true]
    }

    return [token, false]
  }

  private skipTokenIfAny(kinds: Array<TokenKind>): [Token, boolean] {
    return this.skipTokenIf((kind) => kinds.includes(kind))
  }

  private skipTokenIfIs(kind: TokenKind): [Token, boolean] {
    return this.skipTokenIf((_kind) => _kind === kind)
  }

  private currentTokenAdvance(): Token {
    const token = this.currentToken()

    this.skipToken()

    return token
  }

  private skipToken() {
    ++this.currentTokenIndex
  }

  private error(message: string, span: TokenSpan): ParserError {
    return new ParserError(message, span.relativeStart, span.line)
  }
}

export enum ObjectKind {
  Integer,
  List,
  Tuple,
  String,
  Boolean,
  Symbol,
}

export enum SymbolKind {
  Variable,
  Procedure,
}

export type Symbol = {
  name: string
  kind: SymbolKind
  isQuoted: boolean
}

export type Tuple = {
  objects: Array<Object>
  isQuoted: boolean
}

export type ObjectData =
  | { kind: ObjectKind.Integer; value: number }
  | { kind: ObjectKind.List; value: Array<Object> }
  | { kind: ObjectKind.Tuple; value: Tuple }
  | { kind: ObjectKind.String; value: string }
  | { kind: ObjectKind.Boolean; value: boolean }
  | { kind: ObjectKind.Symbol; value: Symbol }

export type Object = ObjectData & { span: TokenSpan }

export type RootObject = Array<Object>

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
