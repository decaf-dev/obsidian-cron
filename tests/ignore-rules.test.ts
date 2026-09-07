import { describe, expect, it } from "bun:test";
import {
	createIgnoreRules,
	hasParentSegment,
	normalizeIgnoreEntry,
	parseIgnoreList,
} from "../src/obsidian/ignore-rules";

describe("normalizeIgnoreEntry", () => {
	it("trims and strips decoration", () => {
		expect(normalizeIgnoreEntry("  lib  ")).toBe("lib");
		expect(normalizeIgnoreEntry("./lib/")).toBe("lib");
		expect(normalizeIgnoreEntry("/archive/2024/")).toBe("archive/2024");
		expect(normalizeIgnoreEntry("archive//2024")).toBe("archive/2024");
	});

	it("accepts a pasted Windows-style path", () => {
		expect(normalizeIgnoreEntry("archive\\2024")).toBe("archive/2024");
	});

	it("rejects an entry that cannot mean anything", () => {
		expect(normalizeIgnoreEntry("")).toBeNull();
		expect(normalizeIgnoreEntry("   ")).toBeNull();
		expect(normalizeIgnoreEntry(".")).toBeNull();
		expect(normalizeIgnoreEntry("/")).toBeNull();
	});

	it("rejects an entry that points above the cron folder", () => {
		expect(normalizeIgnoreEntry("..")).toBeNull();
		expect(normalizeIgnoreEntry("../secrets")).toBeNull();
		expect(normalizeIgnoreEntry("archive/../..")).toBeNull();
	});
});

describe("parseIgnoreList", () => {
	it("splits on commas and drops the blanks", () => {
		expect(parseIgnoreList("lib, archive/2024")).toEqual(["lib", "archive/2024"]);
		expect(parseIgnoreList("lib,,  ,archive/2024,")).toEqual(["lib", "archive/2024"]);
		expect(parseIgnoreList("")).toEqual([]);
	});

	it("removes duplicates left by normalization", () => {
		expect(parseIgnoreList("lib, ./lib/, lib")).toEqual(["lib"]);
	});

	it("round-trips what the settings field renders", () => {
		const entries = ["lib", "archive/2024"];
		expect(parseIgnoreList(entries.join(", "))).toEqual(entries);
	});
});

describe("hasParentSegment", () => {
	it("spots the entry the settings field refuses", () => {
		expect(hasParentSegment("lib, ../secrets")).toBe(true);
		expect(hasParentSegment("archive\\..\\2024")).toBe(true);
		expect(hasParentSegment("lib, archive/2024")).toBe(false);
		// A name that merely starts with dots is not a parent reference.
		expect(hasParentSegment("..hidden.sh")).toBe(false);
	});
});

describe("createIgnoreRules", () => {
	const rules = createIgnoreRules(["lib", "archive/2024"], ["_shared.sh", "tools/wip.sh"]);

	it("matches a bare folder name at any depth", () => {
		expect(rules.ignoresFolder("lib")).toBe(true);
		expect(rules.ignoresFolder("backup/lib")).toBe(true);
		expect(rules.ignoresFolder("a/b/lib")).toBe(true);
	});

	it("does not match a bare name against part of a segment", () => {
		expect(rules.ignoresFolder("library")).toBe(false);
		expect(rules.ignoresFolder("backup/libs")).toBe(false);
	});

	it("matches a folder path only in full", () => {
		expect(rules.ignoresFolder("archive/2024")).toBe(true);
		expect(rules.ignoresFolder("archive/2025")).toBe(false);
		expect(rules.ignoresFolder("backup/archive/2024")).toBe(false);
		expect(rules.ignoresFolder("archive")).toBe(false);
	});

	it("matches a bare file name at any depth", () => {
		expect(rules.ignoresFile("_shared.sh")).toBe(true);
		expect(rules.ignoresFile("backup/_shared.sh")).toBe(true);
	});

	it("matches a file path only in full", () => {
		expect(rules.ignoresFile("tools/wip.sh")).toBe(true);
		expect(rules.ignoresFile("other/wip.sh")).toBe(false);
		expect(rules.ignoresFile("a/tools/wip.sh")).toBe(false);
	});

	it("keeps the two lists apart", () => {
		expect(rules.ignoresFile("lib")).toBe(false);
		expect(rules.ignoresFolder("_shared.sh")).toBe(false);
	});

	it("matches without regard to case", () => {
		expect(rules.ignoresFolder("Backup/LIB")).toBe(true);
		expect(rules.ignoresFile("Backup/_Shared.SH")).toBe(true);
	});

	it("ignores nothing when both lists are empty", () => {
		const none = createIgnoreRules([], []);
		expect(none.ignoresFolder("lib")).toBe(false);
		expect(none.ignoresFile("_shared.sh")).toBe(false);
		expect(none.ignoresPath("lib/_shared.sh")).toBe(false);
	});

	it("tolerates a hand-edited data.json", () => {
		const broken = createIgnoreRules(null, ["ok.sh", 7, undefined]);
		expect(broken.ignoresFolder("lib")).toBe(false);
		expect(broken.ignoresFile("ok.sh")).toBe(true);
	});
});

describe("ignoresPath", () => {
	const rules = createIgnoreRules(["lib", "archive/2024"], ["_shared.sh"]);

	it("covers a script excluded by its own name", () => {
		expect(rules.ignoresPath("backup/_shared.sh")).toBe(true);
	});

	it("covers a script excluded by a folder above it", () => {
		expect(rules.ignoresPath("lib/helper.sh")).toBe(true);
		expect(rules.ignoresPath("backup/lib/helper.sh")).toBe(true);
		expect(rules.ignoresPath("archive/2024/old.sh")).toBe(true);
		expect(rules.ignoresPath("archive/2024/deep/old.sh")).toBe(true);
	});

	it("leaves a script nothing excludes alone", () => {
		expect(rules.ignoresPath("backup/nightly.sh")).toBe(false);
		expect(rules.ignoresPath("archive/2025/old.sh")).toBe(false);
	});

	it("does not read the script's own name as a folder", () => {
		expect(rules.ignoresPath("lib.sh")).toBe(false);
	});
});
