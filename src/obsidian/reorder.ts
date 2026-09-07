import type { CronJob } from "./settings";

/**
 * Moves one job to another position in the list.
 *
 * The job list has no separate order field: the array order *is* the order, so
 * a reorder is a permutation of `settings.jobs` and nothing else. That is also
 * why the order survives a restart for free, and why a script discovered later
 * lands at the end — `reconcileJobs` appends.
 *
 * Returns null when nothing would change, so the caller can skip the settings
 * write and the crontab sync. `reconcileJobs` reports the same thing through
 * its `changed` flag.
 */
export function moveJob(
	jobs: readonly CronJob[],
	id: string,
	toIndex: number
): CronJob[] | null {
	const from = jobs.findIndex((job) => job.id === id);
	if (from === -1) return null;
	// A drop past the last card, or above the first, is an ordinary gesture
	// rather than an error, so the target is clamped rather than refused.
	if (!Number.isFinite(toIndex)) return null;
	const to = Math.min(Math.max(Math.trunc(toIndex), 0), jobs.length - 1);
	if (to === from) return null;

	const next = [...jobs];
	const [job] = next.splice(from, 1);
	next.splice(to, 0, job);
	return next;
}
