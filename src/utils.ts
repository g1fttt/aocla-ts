import { resolve as resolvePath } from "node:path"

export function extractFilename(path: string): string | undefined {
  return path.split("/").at(-1)?.split(".").at(0)
}

export function extractParentPath(path: string): string {
  const lastSlashIndex = path.lastIndexOf("/")

  // prettier-ignore
  const parentPath = lastSlashIndex === -1
      ? "./" + path 
      : path.slice(0, lastSlashIndex)

  return resolvePath(parentPath)
}

export interface AbstractIter<T> {
  next(): T | undefined
}

export class FlatIter<T> implements AbstractIter<T> {
  protected index: number = 0

  public constructor(private readonly tokens: Array<T>) {}

  public next(): T | undefined {
    return this.tokens[this.index++]
  }
}

export class TokenIter<T> extends FlatIter<T> {
  public skipTokenIf(pred: (token: T) => boolean): [T | undefined, boolean] {
    const token = this.next()
    if (!token) {
      return [undefined, false]
    }

    if (pred(token)) {
      return [token, true]
    }

    return [token, false]
  }
}
