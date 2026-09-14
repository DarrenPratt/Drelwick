export class ApplicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApplicationError";
    this.code = code;
  }
}
