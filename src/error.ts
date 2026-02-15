export class Unreachable extends Error {
  constructor() {
    super("Unreachable")
  }
}

export class Unimplemented extends Error {
  constructor() {
    super("Unimplemented")
  }
}

export interface FormattedError {
  formattedMessage(): string
}
