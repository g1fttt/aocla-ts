import { Context, ObjectKind } from "../vm.ts"
import type { Object } from "../vm.ts"

type MatchedBranch = [captureTuple: Array<Object> | undefined, handler: Object]

class Match {
  private readonly selector: Object
  private readonly branches: Map<any, Object>
  private readonly defaultBranch:
    | [captureTuple: Array<Object>, handler: Object]
    | undefined

  public constructor(ctx: Context) {
    this.branches = new Map()

    while (true) {
      const stackObject = ctx.stack.at(-1)
      if (!stackObject) {
        throw new Error("Cannot match due to empty stack")
      }

      // NOTE: Lists are not allowed to be used as selectors. Bug or feature? Hmmm...
      if (stackObject.kind !== ObjectKind.List) {
        if (this.branches.size === 0 && !this.defaultBranch) {
          throw new Error("Cannot match due to missing branches")
        }

        this.selector = stackObject

        break
      }

      ctx.stack.pop()

      const [pattern, handler] = stackObject.value

      if (!pattern) {
        throw new Error("Match expression is missing pattern")
      }

      if (!handler) {
        throw new Error("Match expression is missing handler")
      }

      if (pattern.kind === ObjectKind.Tuple) {
        if (this.defaultBranch !== undefined) {
          throw new Error(
            "Match expression can have at most one default branch",
          )
        }

        const tuple = pattern.value[0]!

        this.defaultBranch = [tuple, handler]
      } else {
        this.branches.set(pattern.value, handler)
      }
    }
  }

  public matchedBranch(): MatchedBranch | undefined {
    const handler = this.branches.get(this.selector.value)
    if (handler) {
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

  const [captureTuple, handler] = matchedBranch

  if (captureTuple) {
    ctx.evalTuple(captureTuple)
  }

  ctx.evalObject(handler)
}
