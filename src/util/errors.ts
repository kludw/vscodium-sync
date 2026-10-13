/** Normalizes a caught value into an Error. */
export const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));
