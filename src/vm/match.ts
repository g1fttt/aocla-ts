import type { ParserSpan } from "../parser.ts"
import { Context, ObjectKind, type Object } from "../vm.ts"

type DefaultBranchPattern = [captureTuple: Array<Object>, tupleSpan: ParserSpan]

type MatchedBranch = [
  pattern: DefaultBranchPattern | undefined,
  handler: Object,
]

class Match {
  private readonly selector: Object
  private readonly branches: Map<any, Object>
  private readonly defaultBranch:
    | [pattern: DefaultBranchPattern, handler: Object]
    | undefined

  public constructor(ctx: Context) {
    this.branches = new Map()

    while (true) {
      const stackObject = ctx.stack.at(-1)
      if (!stackObject) {
        throw ctx.errorProcedureCall("Cannot match due to empty stack")
      }

      // NOTE: Lists are not allowed to be used as selectors. Bug or feature? Hmmm...
      if (stackObject.kind !== ObjectKind.List) {
        if (this.branches.size === 0 && !this.defaultBranch) {
          throw ctx.errorProcedureCall("Cannot match due to missing branches")
        }

        this.selector = stackObject

        break
      }

      ctx.stack.pop()

      const [pattern, handler] = stackObject.value
      const branchSpan = stackObject.span

      if (!pattern) {
        throw ctx.error("Match expression is missing pattern", branchSpan)
      }

      if (!handler) {
        throw ctx.error("Match expression is missing handler", branchSpan)
      }

      if (pattern.kind === ObjectKind.Tuple) {
        if (this.defaultBranch !== undefined) {
          throw ctx.error(
            "Match expression can have at most one default branch",
            pattern.span,
          )
        }

        const captureTuple = pattern.value[0]!
        const defaultBranchPattern: DefaultBranchPattern = [
          captureTuple,
          pattern.span,
        ]

        this.defaultBranch = [defaultBranchPattern, handler]
      } else {
        this.branches.set(pattern.value, handler)
      }
    }
  }

  public matchedBranch(): MatchedBranch | undefined {
    const handler = this.branches.get(this.selector.value)
    if (handler) {
      // We don't need to return any patterns here since we're already matched it before.
      // Return handler to callee in order to interpret it and get desired result.
      return [undefined, handler]
    }

    if (this.defaultBranch) {
      return this.defaultBranch
    }
  }
}

export default function procedureMatch(ctx: Context) {
  const match = new Match(ctx)

  const matchedBranch = match.matchedBranch()
  if (!matchedBranch) {
    return
  }

  const [pattern, handler] = matchedBranch

  if (pattern) {
    const [captureTuple, tupleSpan] = pattern

    ctx.evalTuple(captureTuple, tupleSpan)
  }

  ctx.evalObject(handler)
}
