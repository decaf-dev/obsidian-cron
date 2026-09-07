<script lang="ts">
	import type { CronService, JobView } from "../obsidian/cron-service";
	import ScheduleInput from "./ScheduleInput.svelte";
	import { formatLastRun } from "./store.svelte";

	interface Props {
		view: JobView;
		service: CronService;
		blocked: boolean;
		index: number;
		count: number;
		dragging: boolean;
		onGrab: () => void;
		onRelease: () => void;
		onMove: (toIndex: number) => void;
	}

	let {
		view,
		service,
		blocked,
		index,
		count,
		dragging,
		onGrab,
		onRelease,
		onMove,
	}: Props = $props();

	let card: HTMLDivElement;

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

	function onDragStart(event: DragEvent) {
		// Without a payload Firefox refuses to start the drag at all. The id is
		// not read back: the list already knows which row was grabbed.
		event.dataTransfer?.setData("text/plain", job.id);
		if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
		// Dragging the handle would otherwise show the handle alone. The card
		// is what the user is moving, so the card is what should follow.
		event.dataTransfer?.setDragImage(card, 24, 24);
		onGrab();
	}

	// Arrow keys on the focused handle do the same job as a drag. The each block
	// is keyed, so the button moves with its card and keeps focus.
	function onGripKeydown(event: KeyboardEvent) {
		const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
		if (delta === 0) return;
		event.preventDefault();
		onMove(index + delta);
	}
</script>

<div bind:this={card} class="cron-job" class:cron-job-dragging={dragging}>
	<button
		type="button"
		class="cron-grip"
		draggable="true"
		aria-label="Reorder {job.name}, {index + 1} of {count}"
		title="Drag to reorder, or use the arrow keys"
		ondragstart={onDragStart}
		ondragend={onRelease}
		onkeydown={onGripKeydown}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="currentColor"
			stroke="none"
			aria-hidden="true"
		>
			<circle cx="9" cy="5" r="1.6" />
			<circle cx="9" cy="12" r="1.6" />
			<circle cx="9" cy="19" r="1.6" />
			<circle cx="15" cy="5" r="1.6" />
			<circle cx="15" cy="12" r="1.6" />
			<circle cx="15" cy="19" r="1.6" />
		</svg>
	</button>

	<div class="cron-job-body">
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
				<!-- Obsidian's own toggle, hand-rolled rather than mounted through
				     ToggleComponent: the classes are all its stylesheet needs, and
				     a real checkbox keeps the keyboard and label behaviour the API
				     would otherwise have to re-implement. The label has to wrap the
				     switch, because the input inside it is transparent and covers
				     only the left edge. -->
				<label class="cron-toggle" title={toggleTitle}>
					<span
						class="checkbox-container"
						class:is-enabled={job.enabled}
						class:is-disabled={toggleDisabled}
					>
						<input
							type="checkbox"
							checked={job.enabled}
							disabled={toggleDisabled}
							onchange={(e) =>
								void service.updateJob(job.id, {
									enabled: (e.currentTarget as HTMLInputElement).checked,
								})}
						/>
					</span>
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
</div>

<style>
	/* The grip owns a column of its own rather than sitting inside the card
	   body, so it stays put however tall the diagnostics below make the row. */
	.cron-job {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		background: var(--background-secondary);
		padding: 16px;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 12px;
	}

	.cron-job-body {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}

	/* The card being dragged is dimmed rather than hidden: taking it out of
	   the flow would make the list jump under the pointer. */
	.cron-job-dragging {
		opacity: 0.4;
	}

	/* Obsidian styles bare buttons, so the chrome has to come back off. */
	.cron-grip {
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		padding: 0;
		border: none;
		box-shadow: none;
		background: transparent;
		border-radius: var(--radius-s);
		color: var(--text-faint);
		cursor: grab;
	}

	.cron-grip:hover {
		color: var(--text-muted);
		background: var(--background-modifier-hover);
	}

	.cron-grip:active {
		cursor: grabbing;
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
	   them rather than relying on whitespace alone. The body's own gap is all
	   the space the rule gets above it, and the padding below matches it, so
	   the rule sits evenly between the two halves. */
	.cron-job-footer {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 10px;
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

	/* Focus lands on the transparent checkbox, so the ring it would draw is
	   invisible. Obsidian puts the same outline on the switch itself, which is
	   the part that can actually be seen. */
	.cron-toggle .checkbox-container:has(input:focus-visible) {
		outline: var(--toggle-s-border-width) solid var(--background-modifier-border-focus);
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
