import { describe, expect, it } from "bun:test";
import { shellSingleQuote, UnquotableValueError } from "../src/obsidian/shell-quote";

describe("shellSingleQuote", () => {
	it("wraps a plain path", () => {
		expect(shellSingleQuote("/Users/t/Vault/backup.sh")).toBe("'/Users/t/Vault/backup.sh'");
	});

	it("keeps spaces and shell metacharacters literal", () => {
		expect(shellSingleQuote("/Users/t/My Vault/$x `y`.sh")).toBe(
			"'/Users/t/My Vault/$x `y`.sh'"
		);
	});

	it("escapes an embedded single quote", () => {
		expect(shellSingleQuote("/Users/t/Trey's Vault")).toBe("'/Users/t/Trey'\\''s Vault'");
	});

	it("rejects newlines, which cannot appear in a crontab line", () => {
		expect(() => shellSingleQuote("a\nb")).toThrow(UnquotableValueError);
		expect(() => shellSingleQuote("a\rb")).toThrow(UnquotableValueError);
	});
});
