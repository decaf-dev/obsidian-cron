import { describe, expect, it } from "bun:test";
import { moveJob } from "../src/obsidian/reorder";
import type { CronJob } from "../src/obsidian/settings";

function job(fileName: string): CronJob {
	return {
		id: `${fileName.replace(/[^a-z0-9]+/gi, "-")}-fixed`,
		fileName,
		name: fileName,
		schedule: "0 3 * * *",
		enabled: false,
		missing: false,
	};
}

const names = (jobs: readonly CronJob[]) => jobs.map((entry) => entry.fileName);

/** a.sh, b.sh, c.sh, d.sh */
function list(): CronJob[] {
	return ["a.sh", "b.sh", "c.sh", "d.sh"].map(job);
}

function idOf(fileName: string): string {
	return job(fileName).id;
}

describe("moveJob", () => {
	it("moves a job down the list", () => {
		const result = moveJob(list(), idOf("a.sh"), 2);
		expect(names(result ?? [])).toEqual(["b.sh", "c.sh", "a.sh", "d.sh"]);
	});

	it("moves a job up the list", () => {
		const result = moveJob(list(), idOf("d.sh"), 1);
		expect(names(result ?? [])).toEqual(["a.sh", "d.sh", "b.sh", "c.sh"]);
	});

	it("moves a job to the front", () => {
		const result = moveJob(list(), idOf("c.sh"), 0);
		expect(names(result ?? [])).toEqual(["c.sh", "a.sh", "b.sh", "d.sh"]);
	});

	it("moves a job to the end", () => {
		const result = moveJob(list(), idOf("a.sh"), 3);
		expect(names(result ?? [])).toEqual(["b.sh", "c.sh", "d.sh", "a.sh"]);
	});

	it("clamps a drop past the end rather than refusing it", () => {
		const result = moveJob(list(), idOf("b.sh"), 99);
		expect(names(result ?? [])).toEqual(["a.sh", "c.sh", "d.sh", "b.sh"]);
	});

	it("clamps a drop above the first row", () => {
		const result = moveJob(list(), idOf("c.sh"), -5);
		expect(names(result ?? [])).toEqual(["c.sh", "a.sh", "b.sh", "d.sh"]);
	});

	it("reports no change when the job is already there", () => {
		expect(moveJob(list(), idOf("b.sh"), 1)).toBeNull();
	});

	it("reports no change when a clamped target is where the job already is", () => {
		expect(moveJob(list(), idOf("d.sh"), 12)).toBeNull();
	});

	it("reports no change for an unknown id", () => {
		expect(moveJob(list(), "not-a-job", 0)).toBeNull();
	});

	it("reports no change for a target that is not a number", () => {
		expect(moveJob(list(), idOf("a.sh"), Number.NaN)).toBeNull();
	});

	it("keeps every job, exactly once", () => {
		const result = moveJob(list(), idOf("b.sh"), 3) ?? [];
		expect(names(result).slice().sort()).toEqual(["a.sh", "b.sh", "c.sh", "d.sh"]);
	});

	it("leaves the jobs it did not move in their relative order", () => {
		const result = moveJob(list(), idOf("a.sh"), 3) ?? [];
		expect(names(result).filter((name) => name !== "a.sh")).toEqual([
			"b.sh",
			"c.sh",
			"d.sh",
		]);
	});

	it("does not modify the array it was given", () => {
		const jobs = list();
		moveJob(jobs, idOf("a.sh"), 3);
		expect(names(jobs)).toEqual(["a.sh", "b.sh", "c.sh", "d.sh"]);
	});

	it("reports no change for a single-job list", () => {
		expect(moveJob([job("a.sh")], idOf("a.sh"), 5)).toBeNull();
	});

	it("reports no change for an empty list", () => {
		expect(moveJob([], "anything", 0)).toBeNull();
	});
});
