import { describe, expect, it } from "bun:test";
import { defaultNameFor, makeJobId, reconcileJobs } from "../src/obsidian/reconcile";
import type { CronJob } from "../src/obsidian/settings";

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
		const result = reconcileJobs([], ["backup.sh"], ids);
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
		const result = reconcileJobs(existing, ["backup.sh"], ids);
		expect(result.changed).toBe(false);
		expect(result.jobs[0]).toBe(existing[0]);
	});

	it("deletes a job whose script has vanished", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", enabled: true, schedule: "*/5 * * * *" })],
			[],
			ids
		);
		expect(result.removed).toHaveLength(1);
		expect(result.removed[0]).toMatchObject({ fileName: "backup.sh" });
		expect(result.jobs).toHaveLength(0);
		expect(result.changed).toBe(true);
	});

	it("keeps a job whose script is only excluded by the ignore settings", () => {
		const result = reconcileJobs(
			[job({ fileName: "lib/backup.sh", enabled: true, schedule: "*/5 * * * *" })],
			[],
			ids,
			(fileName) => fileName === "lib/backup.sh"
		);
		expect(result.removed).toHaveLength(0);
		expect(result.jobs[0]).toMatchObject({
			missing: true,
			enabled: true,
			schedule: "*/5 * * * *",
		});
	});

	it("restores an un-ignored job with its name and schedule intact", () => {
		const result = reconcileJobs(
			[job({ fileName: "lib/backup.sh", name: "Nightly", missing: true, enabled: true })],
			["lib/backup.sh"],
			ids
		);
		expect(result.added).toHaveLength(0);
		expect(result.jobs[0]).toMatchObject({
			name: "Nightly",
			missing: false,
			enabled: true,
			schedule: "0 3 * * *",
		});
	});

	it("restores a job when its script comes back", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", missing: true, enabled: true })],
			["backup.sh"],
			ids
		);
		expect(result.restored).toHaveLength(1);
		expect(result.jobs[0]).toMatchObject({ missing: false, enabled: true });
	});

	it("deletes rather than parks a job when the folder still reads fine", () => {
		const result = reconcileJobs([job({ fileName: "gone.sh" })], ["other.sh"], ids);
		expect(result.jobs.map((entry) => entry.fileName)).toEqual(["other.sh"]);
	});

	it("preserves a customized name and id across reconciliation", () => {
		const existing = [job({ fileName: "backup.sh", name: "Renamed by hand", id: "custom-1" })];
		const result = reconcileJobs(existing, ["backup.sh"], ids);
		expect(result.jobs[0]).toMatchObject({ name: "Renamed by hand", id: "custom-1" });
	});

	it("drops duplicate entries for one script", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", id: "a" }), job({ fileName: "backup.sh", id: "b" })],
			["backup.sh"],
			ids
		);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs[0].id).toBe("a");
		expect(result.changed).toBe(true);
	});
});

describe("reconcileJobs following a moved script", () => {
	it("re-links a job whose script moved to another folder", () => {
		const existing = [job({ fileName: "backup.sh", name: "Nightly", schedule: "*/5 * * * *" })];
		const result = reconcileJobs(existing, ["archive/backup.sh"], ids);

		expect(result.jobs).toHaveLength(1);
		expect(result.moved).toHaveLength(1);
		expect(result.added).toHaveLength(0);
		expect(result.removed).toHaveLength(0);
		expect(result.jobs[0]).toMatchObject({
			id: existing[0].id,
			fileName: "archive/backup.sh",
			name: "Nightly",
			schedule: "*/5 * * * *",
			enabled: true,
			missing: false,
		});
		expect(result.changed).toBe(true);
	});

	it("re-links a job that was already missing", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", missing: true, enabled: true })],
			["archive/backup.sh"],
			ids
		);
		expect(result.moved).toHaveLength(1);
		expect(result.jobs[0]).toMatchObject({ fileName: "archive/backup.sh", missing: false });
	});

	it("follows a move between two subfolders", () => {
		const result = reconcileJobs(
			[job({ fileName: "old/backup.sh" })],
			["new/nested/backup.sh"],
			ids
		);
		expect(result.jobs[0].fileName).toBe("new/nested/backup.sh");
	});

	it("refuses when two jobs lost the same filename", () => {
		const result = reconcileJobs(
			[job({ fileName: "a/backup.sh" }), job({ fileName: "b/backup.sh" })],
			["c/backup.sh"],
			ids
		);
		expect(result.moved).toHaveLength(0);
		expect(result.removed).toHaveLength(2);
		expect(result.added).toHaveLength(1);
	});

	it("refuses when two new scripts carry the same filename", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh" })],
			["a/backup.sh", "b/backup.sh"],
			ids
		);
		expect(result.moved).toHaveLength(0);
		expect(result.removed).toHaveLength(1);
		expect(result.added).toHaveLength(2);
	});

	it("does not follow a rename within the same folder", () => {
		const result = reconcileJobs([job({ fileName: "backup.sh" })], ["archive.sh"], ids);
		expect(result.moved).toHaveLength(0);
		expect(result.removed).toHaveLength(1);
		expect(result.added).toHaveLength(1);
	});

	it("does not claim a script another job already owns", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh" }), job({ fileName: "archive/backup.sh" })],
			["archive/backup.sh"],
			ids
		);
		expect(result.moved).toHaveLength(0);
		expect(result.removed).toHaveLength(1);
	});

	it("deletes a script that was replaced by an unrelated one", () => {
		const result = reconcileJobs([job({ fileName: "backup.sh" })], ["unrelated.sh"], ids);
		expect(result.moved).toHaveLength(0);
		expect(result.removed).toHaveLength(1);
		expect(result.jobs.map((entry) => entry.fileName)).toEqual(["unrelated.sh"]);
	});

	it("follows a move rather than deleting and rediscovering", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", name: "Nightly", enabled: true })],
			["archive/backup.sh"],
			ids
		);
		expect(result.removed).toHaveLength(0);
		expect(result.added).toHaveLength(0);
		expect(result.jobs[0]).toMatchObject({
			fileName: "archive/backup.sh",
			name: "Nightly",
			enabled: true,
		});
	});

	it("re-links after duplicate entries are dropped, not before", () => {
		const result = reconcileJobs(
			[job({ fileName: "backup.sh", id: "a" }), job({ fileName: "backup.sh", id: "b" })],
			["archive/backup.sh"],
			ids
		);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs[0]).toMatchObject({ id: "a", fileName: "archive/backup.sh" });
		expect(result.moved).toHaveLength(1);
	});
});

describe("defaultNameFor", () => {
	it("humanizes the filename", () => {
		expect(defaultNameFor("nightly-backup.sh")).toBe("Nightly backup");
		expect(defaultNameFor("sync_notes.sh")).toBe("Sync notes");
		expect(defaultNameFor("backup.sh")).toBe("Backup");
	});

	it("names the folders a nested script sits in", () => {
		expect(defaultNameFor("backup/nightly-sync.sh")).toBe("Backup / Nightly sync");
		expect(defaultNameFor("archive/2024/purge_old_logs.sh")).toBe(
			"Archive / 2024 / Purge old logs"
		);
	});

	it("only strips .sh from the script itself", () => {
		expect(defaultNameFor("tools.sh/run.sh")).toBe("Tools.sh / Run");
	});

	it("skips a segment nothing survives", () => {
		expect(defaultNameFor("_/backup.sh")).toBe("Backup");
	});
});

describe("makeJobId", () => {
	it("produces an id safe for command ids, filenames and lock dirs", () => {
		expect(makeJobId("Nightly Backup!.sh", () => "k3f9d2")).toBe("nightly-backup-sh-k3f9d2");
		expect(makeJobId("...", () => "k3f9d2")).toBe("job-k3f9d2");
		expect(makeJobId("a".repeat(80) + ".sh", () => "k3f9d2")).toMatch(/^[a-z0-9-]{1,64}$/);
		expect(makeJobId("backup/nightly.sh", () => "k3f9d2")).toBe("backup-nightly-sh-k3f9d2");
		// The 48-character slice must not leave the slug ending on a separator.
		expect(makeJobId("a".repeat(47) + "/b.sh", () => "k3f9d2")).toBe(
			"a".repeat(47) + "-k3f9d2"
		);
	});
});
