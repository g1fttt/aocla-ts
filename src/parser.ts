import { extractTokens, TokenKind, TokenSpan } from "./tokenizer.ts"
import { type Token } from "./tokenizer.ts"

import { AoclaError, ErrorKind, UnexpectedEOF, Unreachable } from "./error.ts"
import { TokenIter } from "./utils.ts"

export function parseString(source: string): RootObject {
  const parser = new Parser(source)

  return parser.parsePrimitives()
}

class Parser {
  private iter: TokenIter<Token>
  private objects = new Array<Object>()

  public constructor(source: string) {
    this.iter = new TokenIter(extractTokens(source))
  }

  public parsePrimitives(): RootObject {
    while (true) {
      const token = this.iter.next()
      if (!token) {
        break
      }

      this.objects.push(this.parseObject(token))
    }

    return this.objects
  }

  private parseObject(token: Token): Object {
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
        throw this.error(token.span, `Invalid token: ${token.string}`)
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
    if (!nameToken) {
      throw new UnexpectedEOF()
    }

    const combinedSpan = atToken.span.combinedWith(nameToken.span)

    if (!ok) {
      throw this.error(combinedSpan, "Variable name must be of type Symbol")
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
    const [token, ok] = this.skipTokenIfAny([
      TokenKind.Symbol,
      TokenKind.LeftParen,
    ])

    if (!token) {
      throw new UnexpectedEOF()
    }

    const combinedSpan = quoteToken.span.combinedWith(token.span)

    if (!ok) {
      throw this.error(
        combinedSpan,
        `Found invalid token inside quoted expression: ${token.string}`,
      )
    }

    switch (token.kind) {
      case TokenKind.Symbol:
        return this.parseProcedure(token, { isQuoted: true })
      case TokenKind.LeftParen:
        return this.parseTuple(token, { isQuoted: true })
      default:
        throw new Unreachable()
    }
  }

  private parseBoolean(hashToken: Token): Object {
    const [stateToken, ok] = this.skipTokenIfIs(TokenKind.Symbol)
    if (!stateToken) {
      throw new UnexpectedEOF()
    }

    const combinedSpan = hashToken.span.combinedWith(stateToken.span)

    if (!ok) {
      throw this.error(combinedSpan, "Boolean state must be of type Symbol")
    }

    const state = { t: true, f: false }[stateToken.string]

    if (state === undefined) {
      throw this.error(
        combinedSpan,
        "Boolean state must be either 't(rue)' or 'f(alse)'",
      )
    }

    return { kind: ObjectKind.Boolean, value: state, span: combinedSpan }
  }

  private parseList(leftBracketToken: Token): Object {
    let objects = new Array<Object>()
    let rightBracketSpan: TokenSpan

    while (true) {
      const token = this.iter.next()
      if (!token) {
        throw new UnexpectedEOF()
      }

      if (token.kind === TokenKind.RightBracket) {
        rightBracketSpan = token.span

        break
      }

      objects.push(this.parseObject(token))
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
      const token = this.iter.next()
      if (!token) {
        throw new UnexpectedEOF()
      }

      switch (token.kind) {
        case TokenKind.Symbol:
          const { string, span } = token

          const symbol = this.parseSymbol(string, span, SymbolKind.Variable)
          objects.push(symbol)

          break
        case TokenKind.RightParen:
          rightParenSpan = token.span

          break outerLoop
        default:
          throw this.error(
            token.span,
            `Found invalid token inside Tuple: ${token.string}`,
          )
      }
    }

    const combinedSpan = leftParenToken.span.combinedWith(rightParenSpan)
    const value: Tuple = { objects, isQuoted: args.isQuoted }

    return { kind: ObjectKind.Tuple, value, span: combinedSpan }
  }

  private skipTokenIfAny(
    kinds: Array<TokenKind>,
  ): [Token | undefined, boolean] {
    return this.iter.skipTokenIf((t) => kinds.includes(t.kind))
  }

  private skipTokenIfIs(kind: TokenKind): [Token | undefined, boolean] {
    return this.iter.skipTokenIf((t) => t.kind === kind)
  }

  private error(span: TokenSpan, message: string): AoclaError {
    return new AoclaError({
      message,
      kind: ErrorKind.SyntaxError,
      lineRelativePos: span.relative,
      line: span.line,
    })
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
  readonly name: string
  readonly kind: SymbolKind
  readonly isQuoted: boolean
}

export type Tuple = {
  readonly objects: Array<Object>
  readonly isQuoted: boolean
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
