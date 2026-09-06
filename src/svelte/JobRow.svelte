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
	const errors = $derived(view.diagnostics.filter((d) => d.level === "error"));
	const warnings = $derived(view.diagnostics.filter((d) => d.level === "warning"));
	const canEnable = $derived(!blocked && errors.length === 0);

	function onRename(event: Event) {
		const name = (event.currentTarget as HTMLInputElement).value.trim();
		if (name !== "" && name !== job.name) void service.updateJob(job.id, { name });
	}
</script>

<div class="cron-job" class:cron-job-inactive={!view.scheduled}>
	<div class="cron-job-main">
		<div class="cron-job-identity">
			<input
				type="text"
				class="cron-job-name"
				aria-label="Job name"
				value={job.name}
				onblur={onRename}
				onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
			/>
			<code class="cron-job-file">{job.fileName}</code>
		</div>

		<ScheduleInput
			value={job.schedule}
			disabled={job.missing}
			onCommit={(schedule) => void service.updateJob(job.id, { schedule })}
		/>

		<div class="cron-job-actions">
			<label class="cron-toggle" title={canEnable ? "Schedule this job" : "Fix the problems below first"}>
				<input
					type="checkbox"
					checked={job.enabled}
					disabled={!canEnable}
					onchange={(e) =>
						void service.updateJob(job.id, {
							enabled: (e.currentTarget as HTMLInputElement).checked,
						})}
				/>
				<span>Enabled</span>
			</label>

			<button
				type="button"
				disabled={view.running || job.missing}
				onclick={() => void service.runNow(job.id)}
			>
				{view.running ? "Running..." : "Run now"}
			</button>

			<button type="button" onclick={() => void service.openLog(job.id)}>Log</button>

			<button
				type="button"
				class="cron-remove"
				aria-label="Remove job"
				title="Remove this job. The script itself is left alone."
				onclick={() => void service.removeJob(job.id)}>Remove</button
			>
		</div>
	</div>

	<div class="cron-job-status">
		{#if view.status}
			<span class:cron-error={view.status.exitCode !== 0}>
				Last run {formatLastRun(view.status.ranAt)}
				{view.status.exitCode === 0 ? "succeeded" : `failed with exit code ${view.status.exitCode}`}
			</span>
		{:else}
			<span>Has not run yet.</span>
		{/if}
		{#if job.enabled && !view.scheduled}
			<span class="cron-error">Not scheduled.</span>
		{/if}
	</div>

	{#each errors as diagnostic (diagnostic.message)}
		<div class="cron-diagnostic cron-error">
			<span>{diagnostic.message}</span>
			{#if diagnostic.fix === "make-executable"}
				<button type="button" onclick={() => void service.makeJobExecutable(job.id)}>
					Make executable
				</button>
			{/if}
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
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.cron-job-inactive {
		background: var(--background-primary-alt);
	}

	.cron-job-main {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto;
		gap: 12px;
		align-items: start;
	}

	@media (max-width: 720px) {
		.cron-job-main {
			grid-template-columns: 1fr;
		}
	}

	.cron-job-identity {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.cron-job-name {
		width: 100%;
		font-weight: var(--font-semibold);
	}

	.cron-job-file {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.cron-job-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.cron-toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--font-ui-small);
		white-space: nowrap;
	}

	.cron-remove {
		color: var(--text-error);
	}

	.cron-job-status {
		display: flex;
		gap: 8px;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
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
