/**
 * Which scripts and folders the scan leaves alone.
 *
 * Two lists, both edited as comma-separated text in the settings tab. An entry
 * with no slash matches by name at any depth, so `lib` covers `lib/` and
 * `backup/lib/` alike; an entry with a slash has to match the whole path from
 * the cron folder, so `archive/2024` leaves `archive/2025` alone.
 */

export interface IgnoreRules {
	/** `relativePath` is `/`-separated and relative to the cron folder. */
	ignoresFolder(relativePath: string): boolean;
	ignoresFile(relativePath: string): boolean;
	/**
	 * Whether a script at this path is excluded, by its own name or by any
	 * folder above it. The scan never reaches such a path, so this answers the
	 * question the other way round: for a saved job, why its script is not
	 * in the scan's results.
	 */
	ignoresPath(relativePath: string): boolean;
}

/**
 * Puts one entry into the form the matcher compares against, or returns null
 * for one that cannot mean anything.
 *
 * `..` is rejected rather than resolved. Nothing here builds a path — the
 * scanner only ever compares — but an entry that reads as "escape the cron
 * folder" is a mistake worth refusing rather than quietly matching nothing.
 */
export function normalizeIgnoreEntry(entry: string): string | null {
	const cleaned = entry
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\//, "")
		.replace(/\/+/g, "/")
		.replace(/^\/+|\/+$/g, "");

	if (cleaned === "" || cleaned === ".") return null;
	if (cleaned.split("/").includes("..")) return null;
	return cleaned;
}

/** Parses the settings field. The counterpart of `list.join(", ")`. */
export function parseIgnoreList(raw: string): string[] {
	const seen = new Set<string>();
	for (const part of raw.split(",")) {
		const entry = normalizeIgnoreEntry(part);
		if (entry !== null) seen.add(entry);
	}
	return [...seen];
}

/** True when any entry in `raw` names a parent directory. */
export function hasParentSegment(raw: string): boolean {
	return raw
		.split(",")
		.some((part) => part.trim().replace(/\\/g, "/").split("/").includes(".."));
}

/**
 * Matching is case-insensitive. macOS filenames are case-insensitive anyway,
 * and on Linux an entry that differs only in case is far more likely to be a
 * typo than a deliberate second folder — silently matching nothing would be
 * the worse of the two failures.
 */
function matcher(entries: readonly string[]): (relativePath: string) => boolean {
	const exact = new Set<string>();
	const names = new Set<string>();
	for (const entry of entries) {
		const normalized = normalizeIgnoreEntry(entry);
		if (normalized === null) continue;
		(normalized.includes("/") ? exact : names).add(normalized.toLowerCase());
	}

	if (exact.size === 0 && names.size === 0) return () => false;

	return (relativePath: string) => {
		const lower = relativePath.toLowerCase();
		if (exact.has(lower)) return true;
		const slash = lower.lastIndexOf("/");
		return names.has(slash === -1 ? lower : lower.slice(slash + 1));
	};
}

/** Tolerates non-arrays: `data.json` is a file the user can edit by hand. */
export function createIgnoreRules(folders: unknown, files: unknown): IgnoreRules {
	const ignoresFolder = matcher(asList(folders));
	const ignoresFile = matcher(asList(files));

	function ignoresPath(relativePath: string): boolean {
		if (ignoresFile(relativePath)) return true;
		const segments = relativePath.split("/");
		for (let end = 1; end < segments.length; end++) {
			if (ignoresFolder(segments.slice(0, end).join("/"))) return true;
		}
		return false;
	}

	return { ignoresFolder, ignoresFile, ignoresPath };
}

function asList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
}
