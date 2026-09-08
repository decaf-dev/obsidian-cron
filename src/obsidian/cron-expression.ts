export type CronValidation =
	| { ok: true; normalized: string }
	| { ok: false; error: string };

/**
 * Macros understood by vixie cron. `@reboot` is accepted but noted in the UI,
 * since it fires when the machine boots rather than on a schedule.
 */
const MACROS = new Set([
	"@yearly",
	"@annually",
	"@monthly",
	"@weekly",
	"@daily",
	"@midnight",
	"@hourly",
	"@reboot",
]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

interface FieldSpec {
	name: string;
	min: number;
	max: number;
	/** Lowercase three-letter names, where index 0 maps to `min`. */
	names?: readonly string[];
}

const FIELDS: readonly FieldSpec[] = [
	{ name: "minute", min: 0, max: 59 },
	{ name: "hour", min: 0, max: 23 },
	{ name: "day of month", min: 1, max: 31 },
	{ name: "month", min: 1, max: 12, names: MONTHS },
	// 0 and 7 both mean Sunday in vixie cron.
	{ name: "day of week", min: 0, max: 7, names: DAYS },
];

function parseValue(raw: string, field: FieldSpec): number | null {
	const token = raw.toLowerCase();
	if (field.names) {
		const index = field.names.indexOf(token);
		if (index !== -1) return index + field.min;
	}
	if (!/^\d+$/.test(token)) return null;
	const value = Number(token);
	return value >= field.min && value <= field.max ? value : null;
}

/** Validates one comma-separated list for a single field. */
function validateField(raw: string, field: FieldSpec): string | null {
	if (raw === "") return `The ${field.name} field is empty.`;

	for (const part of raw.split(",")) {
		if (part === "") return `The ${field.name} field has an empty list entry.`;

		const [range, step, ...extra] = part.split("/");
		if (extra.length > 0) {
			return `"${part}" in the ${field.name} field has more than one step.`;
		}
		if (step !== undefined) {
			if (!/^\d+$/.test(step) || Number(step) === 0) {
				return `"${part}" in the ${field.name} field needs a step of 1 or more.`;
			}
		}

		if (range === "*") continue;

		const bounds = range.split("-");
		if (bounds.length > 2) {
			return `"${part}" in the ${field.name} field is not a valid range.`;
		}

		const start = parseValue(bounds[0], field);
		if (start === null) {
			return `"${bounds[0]}" is not a valid ${field.name} (expected ${field.min}-${field.max}).`;
		}
		if (bounds.length === 2) {
			const end = parseValue(bounds[1], field);
			if (end === null) {
				return `"${bounds[1]}" is not a valid ${field.name} (expected ${field.min}-${field.max}).`;
			}
			if (end < start) {
				return `"${part}" in the ${field.name} field runs backwards.`;
			}
		}
	}
	return null;
}

/**
 * Validates a schedule against the dialect vixie cron actually accepts.
 *
 * Deliberately stricter than most cron libraries: no seconds field, and none
 * of the Quartz extensions (`?`, `L`, `W`, `#`), because anything this accepts
 * has to survive `crontab -`.
 */
export function validateCronExpression(input: string): CronValidation {
	const trimmed = input.trim();
	if (trimmed === "") return { ok: false, error: "Enter a schedule." };

	if (trimmed.startsWith("@")) {
		const macro = trimmed.toLowerCase();
		if (MACROS.has(macro)) return { ok: true, normalized: macro };
		return {
			ok: false,
			error: `"${trimmed}" is not a recognized macro. Try @daily, @hourly, or @weekly.`,
		};
	}

	const fields = trimmed.split(/\s+/);
	if (fields.length === 6) {
		return {
			ok: false,
			error: "This looks like a 6-field expression with seconds. System cron takes 5 fields, starting with the minute.",
		};
	}
	if (fields.length !== 5) {
		return {
			ok: false,
			error: `Expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}.`,
		};
	}

	for (let i = 0; i < FIELDS.length; i++) {
		const error = validateField(fields[i], FIELDS[i]);
		if (error) return { ok: false, error };
	}

	return { ok: true, normalized: fields.join(" ") };
}

const MACRO_DESCRIPTIONS: Record<string, string> = {
	"@yearly": "Once a year, at midnight on 1 January",
	"@annually": "Once a year, at midnight on 1 January",
	"@monthly": "Once a month, at midnight on the 1st",
	"@weekly": "Once a week, at midnight on Sunday",
	"@daily": "Every day at midnight",
	"@midnight": "Every day at midnight",
	"@hourly": "Every hour, on the hour",
	"@reboot": "Once each time the machine boots",
};

/**
 * A short human description for the settings UI. Covers the common shapes
 * exactly and falls back to naming the fields, which is still more use than
 * showing the raw expression twice.
 */
export function describeCronExpression(expression: string): string {
	const validation = validateCronExpression(expression);
	if (!validation.ok) return "";

	const expr = validation.normalized;
	const macro = MACRO_DESCRIPTIONS[expr];
	if (macro) return macro;

	const [minute, hour, dom, month, dow] = expr.split(" ");
	const everyDate = dom === "*" && month === "*" && dow === "*";

	if (everyDate) {
		if (minute === "*" && hour === "*") return "Every minute";
		const stepMinutes = /^\*\/(\d+)$/.exec(minute);
		if (stepMinutes && hour === "*") return `Every ${stepMinutes[1]} minutes`;
		if (/^\d+$/.test(minute) && hour === "*") return `Every hour at :${pad(minute)}`;
		if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
			return `Every day at ${pad(hour)}:${pad(minute)}`;
		}
		const stepHours = /^\*\/(\d+)$/.exec(hour);
		if (stepHours && /^\d+$/.test(minute)) {
			return `Every ${stepHours[1]} hours at :${pad(minute)}`;
		}
	}

	if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*") {
		const day = describeDayOfWeek(dow);
		if (day) return `${day} at ${pad(hour)}:${pad(minute)}`;
	}

	return "";
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function describeDayOfWeek(dow: string): string | null {
	if (dow === "*") return null;
	if (dow === "1-5") return "Every weekday";
	if (dow === "0,6" || dow === "6,0") return "Every weekend day";
	const parts = dow.split(",");
	const labels: string[] = [];
	for (const part of parts) {
		const value = parseValue(part, FIELDS[4]);
		if (value === null) return null;
		labels.push(DAY_LABELS[value === 7 ? 0 : value]);
	}
	if (labels.length === 1) return `Every ${labels[0]}`;
	return `Every ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function pad(value: string): string {
	return value.padStart(2, "0");
}

export interface SchedulePreset {
	label: string;
	expression: string;
}

/** The schedules offered in the settings dropdown, in the order shown. */
export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
	{ label: "Every 5 minutes", expression: "*/5 * * * *" },
	{ label: "Every 10 minutes", expression: "*/10 * * * *" },
	{ label: "Every 15 minutes", expression: "*/15 * * * *" },
	{ label: "Every 30 minutes", expression: "*/30 * * * *" },
	{ label: "Every hour", expression: "0 * * * *" },
	{ label: "Every 6 hours", expression: "0 */6 * * *" },
	{ label: "Every 12 hours", expression: "0 */12 * * *" },
	{ label: "Every day at midnight", expression: "0 0 * * *" },
	{ label: "Every Sunday at midnight", expression: "0 0 * * 0" },
];

/**
 * The preset a schedule corresponds to, or null when it needs the custom
 * field. Matching is done on the normalized form, so extra whitespace in a
 * hand-written expression still resolves to its preset.
 */
export function matchSchedulePreset(expression: string): SchedulePreset | null {
	const validation = validateCronExpression(expression);
	if (!validation.ok) return null;
	return SCHEDULE_PRESETS.find((preset) => preset.expression === validation.normalized) ?? null;
}
