<script lang="ts">
	import type { CronService, JobView } from "../obsidian/cron-service";
	import ScheduleInput from "./ScheduleInput.svelte";
	import { formatLastRun } from "./store.svelte";

	interface Props {
		view: JobView;
		service: CronService;
		blocked: boolean;
	}

	let { view, service, blocked }: Props = $props();

	const job = $derived(view.job);
	// Job ids are slug-safe, so they make usable element ids.
	const nameId = $derived(`cron-name-${job.id}`);
	const scheduleId = $derived(`cron-schedule-${job.id}`);
	const errors = $derived(view.diagnostics.filter((d) => d.level === "error"));
	const warnings = $derived(view.diagnostics.filter((d) => d.level === "warning"));
	const canEnable = $derived(!blocked && errors.length === 0);
	// A job that develops a problem after it was turned on must still be
	// switchable off, so the guard covers turning one on and nothing else.
	const toggleDisabled = $derived(!job.enabled && !canEnable);
	const toggleTitle = $derived(
		toggleDisabled
			? "Fix the problems below first"
			: job.enabled
				? "Stop scheduling this job"
				: "Schedule this job"
	);

	function onRename(event: Event) {
		const name = (event.currentTarget as HTMLInputElement).value.trim();
		if (name !== "" && name !== job.name) void service.updateJob(job.id, { name });
	}
</script>

<div class="cron-job" class:cron-job-inactive={!view.scheduled}>
	<div class="cron-job-fields">
		<div class="cron-field">
			<label class="cron-field-label" for={nameId}>Name</label>
			<input
				id={nameId}
				type="text"
				class="cron-job-name"
				value={job.name}
				onblur={onRename}
				onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
			/>
			<span class="cron-field-note">{job.fileName}</span>
		</div>

		<div class="cron-field">
			<label class="cron-field-label" for={scheduleId}>Schedule</label>
			<ScheduleInput
				id={scheduleId}
				value={job.schedule}
				disabled={job.missing}
				onCommit={(schedule) => void service.updateJob(job.id, { schedule })}
			/>
		</div>
	</div>

	<div class="cron-job-footer">
		<div class="cron-job-status">
			{#if view.status}
				<span class:cron-error={view.status.exitCode !== 0}>
					Last run {formatLastRun(view.status.ranAt)}
					{view.status.exitCode === 0
						? "succeeded"
						: `failed with exit code ${view.status.exitCode}`}
				</span>
			{:else}
				<span>Has not run yet.</span>
			{/if}
			{#if job.enabled && !view.scheduled}
				<span class="cron-error">Not scheduled.</span>
			{/if}
		</div>

		<div class="cron-job-controls">
			<label class="cron-toggle" title={toggleTitle}>
				<input
					type="checkbox"
					checked={job.enabled}
					disabled={toggleDisabled}
					onchange={(e) =>
						void service.updateJob(job.id, {
							enabled: (e.currentTarget as HTMLInputElement).checked,
						})}
				/>
				<span>Enabled</span>
			</label>

			<div class="cron-job-buttons">
				<button
					type="button"
					disabled={view.running || job.missing}
					onclick={() => void service.runNow(job.id)}
				>
					{view.running ? "Running..." : "Run now"}
				</button>

				<button type="button" onclick={() => void service.openLog(job.id)}>Log</button>

				{#if job.missing}
					<!-- Only offered for a script the scan cannot see. A script that
					     is gone is removed by the next rescan on its own, so this is
					     here for the ignored one: still on disk, so it would come
					     back from scratch otherwise, and only the user can say
					     whether the job should go with it. -->
					<button
						type="button"
						class="cron-remove"
						title="Forget this job. Its script is not in the cron folder's scan."
						onclick={() => void service.removeJob(job.id)}>Remove</button
					>
				{/if}
			</div>
		</div>
	</div>

	{#each errors as diagnostic (diagnostic.message)}
		<div class="cron-diagnostic cron-error">
			<span>{diagnostic.message}</span>
			{#if diagnostic.detail}<div class="cron-detail">{diagnostic.detail}</div>{/if}
		</div>
	{/each}

	{#each warnings as diagnostic (diagnostic.message)}
		<div class="cron-diagnostic cron-warning">
			<span>{diagnostic.message}</span>
			{#if diagnostic.detail}<div class="cron-detail">{diagnostic.detail}</div>{/if}
		</div>
	{/each}
</div>

<style>
	.cron-job {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.cron-job-inactive {
		background: var(--background-primary-alt);
	}

	.cron-job-fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 22px;
	}

	@media (max-width: 720px) {
		.cron-job-fields {
			grid-template-columns: 1fr;
		}
	}

	.cron-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.cron-field-label {
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-medium);
		color: var(--text-muted);
	}

	/* Deliberately not a <code> element: Obsidian's code styling would make
	   this larger and darker than the schedule's note sitting beside it. */
	.cron-field-note {
		font-family: var(--font-monospace);
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.cron-job-name {
		width: 100%;
		font-weight: var(--font-semibold);
	}

	/* The fields and the action bar are separate concerns, so a rule divides
	   them rather than relying on whitespace alone. */
	.cron-job-footer {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 18px;
		border-top: 1px solid var(--background-modifier-border);
	}

	.cron-job-controls {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	/* Pinned right whether or not the row wraps onto its own line. */
	.cron-job-buttons {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		flex-wrap: wrap;
		margin-left: auto;
	}

	.cron-job-status {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}

	.cron-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--font-ui-small);
		white-space: nowrap;
	}

	.cron-remove {
		color: var(--text-error);
	}

	.cron-diagnostic {
		font-size: var(--font-ui-smaller);
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.cron-detail {
		flex-basis: 100%;
		color: var(--text-muted);
	}

	.cron-error {
		color: var(--text-error);
	}

	.cron-warning {
		color: var(--text-warning);
	}
</style>
