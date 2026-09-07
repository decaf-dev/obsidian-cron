<script lang="ts">
	import { flip } from "svelte/animate";
	import type { CronService } from "../obsidian/cron-service";
	import DiagnosticsPanel from "./DiagnosticsPanel.svelte";
	import JobRow from "./JobRow.svelte";
	import type { JobStore } from "./store.svelte";

	interface Props {
		service: CronService;
		store: JobStore;
	}

	let { service, store }: Props = $props();
	const folder = $derived(service.getPaths()?.folder ?? null);

	// Drag state is local, and the service is called once on drop. Same shape as
	// ScheduleInput's draft: a half-finished gesture never reaches settings.
	let draggingId = $state<string | null>(null);
	let overIndex = $state<number | null>(null);
	const fromIndex = $derived(store.views.findIndex((view) => view.job.id === draggingId));

	/**
	 * Which side of the hovered card the drop line goes on.
	 *
	 * `moveJob` inserts at the target index *after* lifting the job out, so a
	 * card dragged downwards lands below the one it is over and a card dragged
	 * upwards lands above it. Drawing the line on one fixed side would promise
	 * the wrong position for half the drags.
	 */
	function lineSide(index: number): "above" | "below" | null {
		if (draggingId === null || overIndex !== index || fromIndex === -1) return null;
		if (fromIndex > index) return "above";
		if (fromIndex < index) return "below";
		return null;
	}

	function move(id: string, toIndex: number) {
		void service.moveJob(id, toIndex);
	}

	function drop() {
		if (draggingId !== null && overIndex !== null) move(draggingId, overIndex);
		release();
	}

	function release() {
		draggingId = null;
		overIndex = null;
	}
</script>

<div class="cron-job-list">
	<DiagnosticsPanel diagnostics={store.diagnostics} />

	{#if store.views.length === 0}
		<div class="cron-empty">
			<p>No scripts yet.</p>
			<p class="cron-empty-hint">
				Put a shell script in the cron folder, or any folder inside it, and it will show
				up here, disabled until you give it a schedule and turn it on.
			</p>
			{#if folder}
				<code>{folder}</code>
			{/if}
		</div>
	{:else}
		<div class="cron-jobs" role="list">
			{#each store.views as view, index (view.job.id)}
				<!-- The slot is the drop target, not the card: it also covers the
				     gap above the card, so there is no dead strip between rows. -->
				<div
					class="cron-job-slot"
					role="listitem"
					animate:flip={{ duration: 180 }}
					ondragover={(event) => {
						// The drop never fires without this.
						event.preventDefault();
						overIndex = index;
					}}
					ondrop={(event) => {
						event.preventDefault();
						drop();
					}}
				>
					{#if lineSide(index) === "above"}
						<div class="cron-drop-line cron-drop-line-above"></div>
					{/if}
					<JobRow
						{view}
						{service}
						{index}
						blocked={store.blocked}
						count={store.views.length}
						dragging={draggingId === view.job.id}
						onGrab={() => (draggingId = view.job.id)}
						onRelease={release}
						onMove={(toIndex) => move(view.job.id, toIndex)}
					/>
					{#if lineSide(index) === "below"}
						<div class="cron-drop-line cron-drop-line-below"></div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.cron-job-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
	}

	.cron-jobs {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	/* The slot exists so the drop line can sit above its card without the
	   flex gap opening up around it. */
	.cron-job-slot {
		position: relative;
	}

	/* Centred in the 10px gap between cards, so it reads as belonging to
	   neither and pointing at the space the card will drop into. */
	.cron-drop-line {
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		border-radius: 1px;
		background: var(--text-accent);
		pointer-events: none;
	}

	.cron-drop-line-above {
		top: -6px;
	}

	.cron-drop-line-below {
		bottom: -6px;
	}

	.cron-empty {
		border: 1px dashed var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 16px;
		text-align: center;
		color: var(--text-muted);
	}

	.cron-empty p {
		margin: 0 0 4px;
	}

	.cron-empty-hint {
		font-size: var(--font-ui-smaller);
	}

	.cron-empty code {
		font-size: var(--font-ui-smaller);
		overflow-wrap: anywhere;
	}
</style>
