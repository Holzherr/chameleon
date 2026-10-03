/** An expected, user-facing failure: printed without a stack trace, exits 1. */
export class CliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliError";
	}
}
