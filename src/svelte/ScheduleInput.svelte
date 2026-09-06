<script lang="ts">
	import {
		describeCronExpression,
		validateCronExpression,
	} from "../obsidian/cron-expression";

	interface Props {
		value: string;
		disabled?: boolean;
		onCommit: (schedule: string) => void;
	}

	let { value, disabled = false, onCommit }: Props = $props();

	// While editing, the field holds a local draft so an invalid intermediate
	// value never reaches the service, and therefore never reaches the crontab.
	// null means "not editing", and the saved value shows through.
	let draft = $state<string | null>(null);

	const shown = $derived(draft ?? value);
	const validation = $derived(validateCronExpression(shown));
	const description = $derived(validation.ok ? describeCronExpression(shown) : "");

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
	<input
		type="text"
		class="cron-schedule-input"
		class:cron-invalid={!validation.ok}
		spellcheck="false"
		placeholder="0 3 * * *"
		aria-label="Cron schedule"
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
</div>

<style>
	.cron-schedule {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
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
