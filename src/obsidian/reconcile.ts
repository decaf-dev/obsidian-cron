import { DEFAULT_SCHEDULE } from "./settings";
import type { CronJob } from "./settings";

export interface ReconcileResult {
	jobs: CronJob[];
	added: CronJob[];
	/** Jobs dropped because their script is gone from the cron folder. */
	removed: CronJob[];
	restored: CronJob[];
	/** Jobs re-pointed at the same script under a new path. */
	moved: CronJob[];
	changed: boolean;
}

/**
 * Reconciles saved jobs against the scripts currently on disk.
 *
 * Three rules matter here. A script with no job gets one, always disabled, so
 * nothing is ever scheduled without the user opting in. A job whose script is
 * gone is dropped, so the list only ever describes scripts that exist. And a
 * script that has simply moved is followed rather than treated as one deletion
 * and one discovery, which would otherwise throw away the name and schedule the
 * user gave it — the re-link pass runs first for exactly that reason.
 *
 * `isIgnored` is what keeps the deletion rule honest. A scan leaves out both
 * the scripts that are gone and the scripts the ignore settings exclude, and
 * only the first kind is actually missing. Deleting the second would mean
 * adding a folder to the ignore list silently destroyed the names and schedules
 * of everything inside it, and taking it back out would return bare defaults.
 * So an ignored job is kept and marked missing, as before.
 *
 * `newId` and `isIgnored` are injected so this stays pure and testable.
 */
export function reconcileJobs(
	jobs: readonly CronJob[],
	filePaths: readonly string[],
	newId: (fileName: string) => string,
	isIgnored: (fileName: string) => boolean = () => false
): ReconcileResult {
	const present = new Set(filePaths);
	let changed = false;

	// Duplicate entries for one script would produce duplicate crontab lines
	// and colliding log files; keep the first.
	const kept: CronJob[] = [];
	const claimed = new Set<string>();
	for (const job of jobs) {
		if (claimed.has(job.fileName)) {
			changed = true;
			continue;
		}
		claimed.add(job.fileName);
		kept.push(job);
	}

	// A job whose path is gone might have moved rather than been deleted, so
	// nothing is deleted until the re-link pass has had a look.
	const orphansByName = new Map<string, CronJob[]>();
	for (const job of kept) {
		if (present.has(job.fileName)) continue;
		push(orphansByName, baseName(job.fileName), job);
	}

	const unclaimedByName = new Map<string, string[]>();
	for (const filePath of filePaths) {
		if (claimed.has(filePath)) continue;
		push(unclaimedByName, baseName(filePath), filePath);
	}

	// Only an unambiguous pairing is followed: one job missing that name, one
	// new script carrying it. Anything else could pair the wrong two, and the
	// old missing-plus-added behaviour is the safe answer.
	const movedTo = new Map<string, string>();
	for (const [name, candidates] of orphansByName) {
		if (candidates.length !== 1) continue;
		const paths = unclaimedByName.get(name);
		if (paths === undefined || paths.length !== 1) continue;
		movedTo.set(candidates[0].fileName, paths[0]);
		claimed.add(paths[0]);
	}

	const next: CronJob[] = [];
	const removed: CronJob[] = [];
	const restored: CronJob[] = [];
	const moved: CronJob[] = [];

	for (const job of kept) {
		const destination = movedTo.get(job.fileName);
		if (destination !== undefined) {
			// The id is kept deliberately: it names this job's log, its lock and
			// its command palette entry, none of which the move invalidates.
			const updated: CronJob = { ...job, fileName: destination, missing: false };
			next.push(updated);
			moved.push(updated);
			changed = true;
			continue;
		}

		const missing = !present.has(job.fileName);
		if (missing && !isIgnored(job.fileName)) {
			// The script is not on disk and nothing is hiding it, so the job
			// describes a file that no longer exists. Its crontab line goes with
			// it, because the caller syncs from this list.
			removed.push(job);
			changed = true;
			continue;
		}

		if (missing === job.missing) {
			next.push(job);
			continue;
		}

		const updated: CronJob = { ...job, missing };
		next.push(updated);
		changed = true;
		if (!missing) restored.push(updated);
	}

	const added: CronJob[] = [];
	for (const filePath of filePaths) {
		if (claimed.has(filePath)) continue;
		claimed.add(filePath);
		const job: CronJob = {
			id: newId(filePath),
			fileName: filePath,
			name: defaultNameFor(filePath),
			schedule: DEFAULT_SCHEDULE,
			enabled: false,
			missing: false,
		};
		added.push(job);
		next.push(job);
		changed = true;
	}

	return { jobs: next, added, removed, restored, moved, changed };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
	const existing = map.get(key);
	if (existing === undefined) map.set(key, [value]);
	else existing.push(value);
}

function baseName(filePath: string): string {
	const slash = filePath.lastIndexOf("/");
	return slash === -1 ? filePath : filePath.slice(slash + 1);
}

/**
 * `backup/nightly-backup.sh` becomes `Backup / Nightly backup`.
 *
 * The folder is part of the name because the command palette shows the name on
 * its own, and a tree of scripts makes two called `backup.sh` likely.
 */
export function defaultNameFor(filePath: string): string {
	const segments = filePath.split("/").filter((segment) => segment !== "");
	const last = segments.length - 1;
	const parts = segments
		.map((segment, index) => humanize(index === last ? segment.replace(/\.sh$/i, "") : segment))
		.filter((part) => part !== "");
	if (parts.length === 0) return filePath;
	return parts.join(" / ");
}

function humanize(segment: string): string {
	const base = segment.replace(/[_-]+/g, " ").trim();
	if (base === "") return "";
	return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Slug plus a short random suffix, kept safe for command ids and filenames. */
export function makeJobId(fileName: string, randomSuffix: () => string): string {
	const slug =
		fileName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48)
			// The slice can land on a separator, and nested paths make long
			// slugs ordinary rather than rare.
			.replace(/-+$/, "") || "job";
	return `${slug}-${randomSuffix()}`;
}
