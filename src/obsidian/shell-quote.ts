/**
 * Thrown when a value cannot be represented inside a crontab line at all.
 *
 * A crontab is line-oriented, so a value containing a newline or carriage
 * return has no valid encoding. Callers surface this as an invalid job rather
 * than writing something that would corrupt the file.
 */
export class UnquotableValueError extends Error {
	constructor(readonly value: string) {
		super("Value contains a newline and cannot be used in a crontab line");
		this.name = "UnquotableValueError";
	}
}

/**
 * Wraps a value in single quotes for POSIX shells, escaping embedded single
 * quotes as `'\''` (close, escaped literal, reopen).
 *
 * Single quoting is used deliberately: inside single quotes no character is
 * special to the shell, so paths containing spaces, `$`, backticks or
 * apostrophes are all safe.
 */
export function shellSingleQuote(value: string): string {
	if (value.includes("\n") || value.includes("\r")) {
		throw new UnquotableValueError(value);
	}
	return `'${value.split("'").join(`'\\''`)}'`;
}
