import { describe, expect, it } from "bun:test";
import { defaultNameFor, makeJobId, reconcileJobs } from "../src/obsidian/reconcile";
import type { CronJob } from "../src/obsidian/settings";

const defaults = { schedule: "0 * * * *" };
const ids = (fileName: string) => `${fileName.replace(/[^a-z0-9]+/gi, "-")}-fixed`;

function job(overrides: Partial<CronJob> & Pick<CronJob, "fileName">): CronJob {
	return {
		id: ids(overrides.fileName),
		name: defaultNameFor(overrides.fileName),
		schedule: "0 3 * * *",
		enabled: true,
		missing: false,
		...overrides,
	};
}

describe("reconcileJobs", () => {
	it("adds a discovered script as a disabled job", () => {
		const result = reconcileJobs([], ["backup.sh"], defaults, ids);
		expect(result.added).toHaveLength(1);
		expect(result.changed).toBe(true);
		expect(result.jobs[0]).toMatchObject({
			fileName: "backup.sh",
			name: "Backup",
			schedule: "0 * * * *",
			enabled: false,
			missing: false,
		});
	});

	it("reports no change when nothing moved", () => {
		const existing = [job({ fileName: "backup.sh" })];
		const result = reconcileJobs(existing, ["backup.sh"], defaults, ids);
		expect(result.changed).toBe(false);
		expect(result.jobs[0]).toBe(existing[0]);
	});

	it("marks a vanished script missing but keeps the user's intent", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", enabled: true, schedule: "*/5 * * * *" })],
			[],
			defaults,
			ids
		);
		expect(result.nowMissing).toHaveLength(1);
		expect(result.jobs[0]).toMatchObject({
			missing: true,
			enabled: true,
			schedule: "*/5 * * * *",
		});
	});

	it("restores a job when its script comes back", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", missing: true, enabled: true })],
			["backup.sh"],
			defaults,
			ids
		);
		expect(result.restored).toHaveLength(1);
		expect(result.jobs[0]).toMatchObject({ missing: false, enabled: true });
	});

	it("never deletes a job entry on its own", () => {
		const result = reconcileJobs([job({ fileName: "gone.sh" })], [], defaults, ids);
		expect(result.jobs).toHaveLength(1);
	});

	it("preserves a customized name and id across reconciliation", () => {
		const existing = [job({ fileName: "backup.sh", name: "Renamed by hand", id: "custom-1" })];
		const result = reconcileJobs(existing, ["backup.sh"], defaults, ids);
		expect(result.jobs[0]).toMatchObject({ name: "Renamed by hand", id: "custom-1" });
	});

	it("drops duplicate entries for one script", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", id: "a" }), job({ fileName: "backup.sh", id: "b" })],
			["backup.sh"],
			defaults,
			ids
		);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs[0].id).toBe("a");
		expect(result.changed).toBe(true);
	});
});

describe("defaultNameFor", () => {
	it("humanizes the filename", () => {
		expect(defaultNameFor("nightly-backup.sh")).toBe("Nightly backup");
		expect(defaultNameFor("sync_notes.sh")).toBe("Sync notes");
		expect(defaultNameFor("backup.sh")).toBe("Backup");
	});
});

describe("makeJobId", () => {
	it("produces an id safe for command ids, filenames and lock dirs", () => {
		expect(makeJobId("Nightly Backup!.sh", () => "k3f9d2")).toBe("nightly-backup-sh-k3f9d2");
		expect(makeJobId("...", () => "k3f9d2")).toBe("job-k3f9d2");
		expect(makeJobId("a".repeat(80) + ".sh", () => "k3f9d2")).toMatch(/^[a-z0-9-]{1,64}$/);
	});
});
