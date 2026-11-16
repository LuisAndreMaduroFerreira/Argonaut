// The ways a request can end other than well, each with the status it answers with. Anything
// else that is thrown is a fault in the server: it is logged and answered with a 500.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Sent beside the message, for answers that carry more than words.
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// Bad input from a request or from the assistant's actions: reported back, never a crash.
export class InputError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(what: string) {
    super(404, `${what} not found`);
  }
}
