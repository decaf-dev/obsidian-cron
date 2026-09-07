import { describe, expect, it } from "bun:test";
import { getJobDiagnostics, isSchedulable } from "../src/obsidian/diagnostics";
import type { CronJob } from "../src/obsidian/settings";
import type { ScriptInfo } from "../src/obsidian/script-scanner";

function job(overrides: Partial<CronJob> = {}): CronJob {
	return {
		id: "backup-sh-k3f9d2",
		fileName: "backup/nightly.sh",
		name: "Backup / Nightly",
		schedule: "0 3 * * *",
		enabled: true,
		missing: false,
		...overrides,
	};
}

function script(overrides: Partial<ScriptInfo> = {}): ScriptInfo {
	return {
		fileName: "backup/nightly.sh",
		executable: true,
		hasShebang: true,
		readError: null,
		...overrides,
	};
}

describe("getJobDiagnostics", () => {
	it("passes a healthy nested script", () => {
		expect(getJobDiagnostics(job(), script())).toEqual([]);
		expect(isSchedulable(job(), script())).toBe(true);
	});

	it("says a script is ignored rather than missing", () => {
		const diagnostics = getJobDiagnostics(job({ missing: true }), undefined, true);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toMatch(/ignore settings/);
		expect(isSchedulable(job({ missing: true }), undefined, true)).toBe(false);
	});

	it("still says missing when nothing is ignoring it", () => {
		const diagnostics = getJobDiagnostics(job({ missing: true }), undefined);
		expect(diagnostics[0].message).toMatch(/not found/);
	});

	it("refuses a path that reaches outside the cron folder", () => {
		for (const fileName of ["../secrets.sh", "/etc/evil.sh", "a/../../x.sh", "a\\b.sh", ""]) {
			const diagnostics = getJobDiagnostics(job({ fileName }), script({ fileName }));
			expect(diagnostics[0]?.message).toMatch(/not inside the cron folder/);
			expect(isSchedulable(job({ fileName }), script({ fileName }))).toBe(false);
		}
	});

	it("accepts an ordinary nested path", () => {
		for (const fileName of ["a.sh", "a/b.sh", "a/b/c.sh", "with space/c.sh"]) {
			expect(getJobDiagnostics(job({ fileName }), script({ fileName }))).toEqual([]);
		}
	});

	it("still reports the executable bit and the shebang", () => {
		expect(getJobDiagnostics(job(), script({ executable: false }))[0]).toMatchObject({
			level: "error",
			fix: "make-executable",
		});
		expect(getJobDiagnostics(job(), script({ hasShebang: false }))[0]).toMatchObject({
			level: "warning",
		});
	});

	it("warns about a script it could not read, and keeps it schedulable", () => {
		const unreadable = script({ readError: "EACCES: permission denied" });
		const diagnostics = getJobDiagnostics(job(), unreadable);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			level: "warning",
			message: "This script could not be read, so it was not checked.",
		});
		expect(isSchedulable(job(), unreadable)).toBe(true);
	});
});
