export type ExportErrorCode =
  | "INVALID_URL"
  | "INVALID_SELECTION"
  | "GUILD_NOT_ALLOWED"
  | "CONFIGURATION_ERROR"
  | "AUTHENTICATION_FAILED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "DISCORD_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "EXPORT_FAILED";

export class ExportError extends Error {
  constructor(
    public readonly code: ExportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExportError";
  }
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof ExportError) return error.message;
  return "The export failed unexpectedly. Check the server's stderr for details.";
}
