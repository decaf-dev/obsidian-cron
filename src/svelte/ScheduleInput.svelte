<script lang="ts">
	import {
		SCHEDULE_PRESETS,
		describeCronExpression,
		matchSchedulePreset,
		validateCronExpression,
	} from "../obsidian/cron-expression";

	interface Props {
		/** Ties the dropdown to the caller's visible label. */
		id: string;
		value: string;
		disabled?: boolean;
		onCommit: (schedule: string) => void;
	}

	let { id, value, disabled = false, onCommit }: Props = $props();

	/** Sentinel option value; no preset can collide with it. */
	const CUSTOM = "custom";

	// Set when the user picks Custom for a schedule that *does* match a preset,
	// which is the only case the saved value cannot tell us about on its own.
	let customChosen = $state(false);

	const preset = $derived(matchSchedulePreset(value));
	const isCustom = $derived(preset === null || customChosen);

	// While editing, the field holds a local draft so an invalid intermediate
	// value never reaches the service, and therefore never reaches the crontab.
	// null means "not editing", and the saved value shows through.
	let draft = $state<string | null>(null);

	const shown = $derived(draft ?? value);
	const validation = $derived(validateCronExpression(shown));
	const description = $derived(validation.ok ? describeCronExpression(shown) : "");

	function onSelect(event: Event) {
		const choice = (event.currentTarget as HTMLSelectElement).value;
		if (choice === CUSTOM) {
			customChosen = true;
			return;
		}
		customChosen = false;
		draft = null;
		if (choice !== value) onCommit(choice);
	}

	function commit() {
		if (draft !== null && validation.ok && validation.normalized !== value) {
			onCommit(validation.normalized);
		}
		draft = null;
	}

	function onInput(event: Event) {
		draft = (event.currentTarget as HTMLInputElement).value;
	}

	function onKeydown(event: KeyboardEvent) {
		const input = event.currentTarget as HTMLInputElement;
		if (event.key === "Enter") input.blur();
		if (event.key === "Escape") {
			draft = null;
			input.blur();
		}
	}
</script>

<div class="cron-schedule">
	<div class="cron-schedule-select-wrap">
		<select
			{id}
			class="dropdown cron-schedule-select"
			{disabled}
			value={isCustom ? CUSTOM : preset?.expression}
			onchange={onSelect}
		>
			{#each SCHEDULE_PRESETS as option (option.expression)}
				<option value={option.expression}>{option.label}</option>
			{/each}
			<option value={CUSTOM}>Custom</option>
		</select>

		<svg
			class="cron-schedule-arrow"
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="m7 15 5 5 5-5" />
			<path d="m7 9 5-5 5 5" />
		</svg>
	</div>

	{#if isCustom}
		<input
			type="text"
			class="cron-schedule-input"
			class:cron-invalid={!validation.ok}
			spellcheck="false"
			placeholder="0 3 * * *"
			aria-label="Custom cron expression"
			value={shown}
			{disabled}
			oninput={onInput}
			onblur={commit}
			onkeydown={onKeydown}
		/>
		{#if !validation.ok}
			<div class="cron-schedule-note cron-error">{validation.error}</div>
		{:else if description}
			<div class="cron-schedule-note">{description}</div>
		{/if}
	{/if}
</div>

<style>
	/* Matches the gap the surrounding field uses between control and note. */
	.cron-schedule {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.cron-schedule-select-wrap {
		position: relative;
		display: flex;
		min-width: 0;
	}

	/*
	 * Obsidian's .dropdown is kept for its theme colours, border and height, so
	 * the control still matches the custom input stacked beneath it. Everything
	 * about the label's placement is taken over here: a natively rendered
	 * select ignores text-align outright, which is what left the label pinned
	 * to the right edge. Turning the appearance off makes alignment work, at
	 * the cost of having to draw the arrow ourselves.
	 */
	.cron-schedule-select-wrap .cron-schedule-select {
		width: 100%;
		appearance: none;
		-webkit-appearance: none;
		text-align: left;
		text-align-last: left;
		padding-right: 28px;
		background-image: none;
	}

	.cron-schedule-arrow {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-muted);
		pointer-events: none;
	}

	.cron-schedule-input {
		font-family: var(--font-monospace);
		width: 100%;
	}

	.cron-schedule-input.cron-invalid {
		border-color: var(--text-error);
	}

	.cron-schedule-note {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}

	.cron-schedule-note.cron-error {
		color: var(--text-error);
	}
</style>
