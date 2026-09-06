import type { CronJob } from "./settings";

export interface ReconcileResult {
	jobs: CronJob[];
	added: CronJob[];
	nowMissing: CronJob[];
	restored: CronJob[];
	changed: boolean;
}

export interface ReconcileDefaults {
	schedule: string;
}

/**
 * Reconciles saved jobs against the scripts currently on disk.
 *
 * Two rules matter here. A script with no job gets one, always disabled, so
 * nothing is ever scheduled without the user opting in. And a job whose script
 * has vanished is marked missing but *keeps* its `enabled` value, so a file
 * that is moved away and back returns with its schedule intact.
 *
 * `newId` is injected so this stays pure and testable.
 */
export function reconcileJobs(
	jobs: readonly CronJob[],
	fileNames: readonly string[],
	defaults: ReconcileDefaults,
	newId: (fileName: string) => string
): ReconcileResult {
	const present = new Set(fileNames);
	const seen = new Set<string>();

	const next: CronJob[] = [];
	const nowMissing: CronJob[] = [];
	const restored: CronJob[] = [];
	let changed = false;

	for (const job of jobs) {
		// Duplicate entries for one script would produce duplicate crontab
		// lines and colliding log files; keep the first.
		if (seen.has(job.fileName)) {
			changed = true;
			continue;
		}
		seen.add(job.fileName);

		const missing = !present.has(job.fileName);
		if (missing === job.missing) {
			next.push(job);
			continue;
		}

		const updated: CronJob = { ...job, missing };
		next.push(updated);
		changed = true;
		if (missing) nowMissing.push(updated);
		else restored.push(updated);
	}

	const added: CronJob[] = [];
	for (const fileName of fileNames) {
		if (seen.has(fileName)) continue;
		const job: CronJob = {
			id: newId(fileName),
			fileName,
			name: defaultNameFor(fileName),
			schedule: defaults.schedule,
			enabled: false,
			missing: false,
		};
		added.push(job);
		next.push(job);
		seen.add(fileName);
		changed = true;
	}

	return { jobs: next, added, nowMissing, restored, changed };
}

/** `nightly-backup.sh` becomes `Nightly backup`. */
export function defaultNameFor(fileName: string): string {
	const base = fileName.replace(/\.sh$/i, "").replace(/[_-]+/g, " ").trim();
	if (base === "") return fileName;
	return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Slug plus a short random suffix, kept safe for command ids and filenames. */
export function makeJobId(fileName: string, randomSuffix: () => string): string {
	const slug =
		fileName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "job";
	return `${slug}-${randomSuffix()}`;
}
