import { describe, expect, it } from "bun:test";
import {
	describeCronExpression,
	validateCronExpression,
} from "../src/obsidian/cron-expression";

function ok(expr: string) {
	const result = validateCronExpression(expr);
	expect(result.ok).toBe(true);
	return result;
}

function err(expr: string) {
	const result = validateCronExpression(expr);
	expect(result.ok).toBe(false);
	return result.ok ? "" : result.error;
}

describe("validateCronExpression", () => {
	it("accepts the vixie forms", () => {
		for (const expr of [
			"* * * * *",
			"0 3 * * *",
			"*/15 * * * *",
			"0 0-6/2 * * *",
			"0 9 1,15 * *",
			"30 8 * jan-mar mon-fri",
			"0 12 * * 7",
			"5,10,15 * * * *",
		]) {
			expect(validateCronExpression(expr).ok).toBe(true);
		}
	});

	it("accepts macros and normalizes case", () => {
		expect(ok("@Daily")).toEqual({ ok: true, normalized: "@daily" });
		expect(validateCronExpression("@reboot").ok).toBe(true);
	});

	it("collapses surrounding and interior whitespace", () => {
		expect(ok("  0   3  *  *  * ")).toEqual({ ok: true, normalized: "0 3 * * *" });
	});

	it("calls out a 6-field expression specifically", () => {
		expect(err("0 0 3 * * *")).toContain("6-field");
	});

	it("rejects out-of-range values", () => {
		expect(err("60 * * * *")).toContain("minute");
		expect(err("* 24 * * *")).toContain("hour");
		expect(err("* * 32 * *")).toContain("day of month");
		expect(err("* * * 13 *")).toContain("month");
		expect(err("* * * * 8")).toContain("day of week");
	});

	it("rejects Quartz extensions that system cron does not accept", () => {
		expect(validateCronExpression("0 0 ? * MON#1").ok).toBe(false);
		expect(validateCronExpression("0 0 L * *").ok).toBe(false);
	});

	it("rejects backwards ranges, zero steps and empty entries", () => {
		expect(err("0 10-2 * * *")).toContain("backwards");
		expect(err("*/0 * * * *")).toContain("step");
		expect(err("1,,2 * * * *")).toContain("empty");
		expect(err("")).toBe("Enter a schedule.");
	});
});

describe("describeCronExpression", () => {
	it("describes the common shapes", () => {
		expect(describeCronExpression("* * * * *")).toBe("Every minute");
		expect(describeCronExpression("*/15 * * * *")).toBe("Every 15 minutes");
		expect(describeCronExpression("0 3 * * *")).toBe("Every day at 03:00");
		expect(describeCronExpression("30 * * * *")).toBe("Every hour at :30");
		expect(describeCronExpression("0 9 * * 1-5")).toBe("Every weekday at 09:00");
		expect(describeCronExpression("0 9 * * 1")).toBe("Every Monday at 09:00");
		expect(describeCronExpression("@daily")).toBe("Every day at midnight");
	});

	it("returns nothing rather than guessing", () => {
		expect(describeCronExpression("0 9 1,15 * *")).toBe("");
		expect(describeCronExpression("nonsense")).toBe("");
	});
});
