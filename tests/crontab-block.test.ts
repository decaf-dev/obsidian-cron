import { describe, expect, it } from "bun:test";
import {
	buildManagedBlock,
	escapeCronPercent,
	extractManagedBlock,
	MalformedManagedBlockError,
	spliceManagedBlock,
} from "../src/obsidian/crontab-block";

const USER_CRONTAB = [
	"# my own stuff",
	"MAILTO=me@example.com",
	"0 4 * * * /usr/local/bin/rsync-home",
	"*/5 * * * * /Users/t/bin/ping-check # keep",
	"",
].join("\n");

const BLOCK = buildManagedBlock([
	{
		jobId: "backup-sh-a1b2",
		jobName: "Nightly backup",
		schedule: "0 3 * * *",
		command: "'/vault/.obsidian/cron/_runner.sh' 'backup-sh-a1b2' '/vault/.obsidian/cron/backup.sh' > /dev/null 2>&1",
	},
]);

describe("buildManagedBlock", () => {
	it("emits sentinels, a notice, and a comment per job", () => {
		expect(BLOCK.split("\n")[0]).toBe("# BEGIN obsidian-cron-jobs");
		expect(BLOCK.split("\n").at(-1)).toBe("# END obsidian-cron-jobs");
		expect(BLOCK).toContain("# job: Nightly backup (backup-sh-a1b2)");
		expect(BLOCK).toContain("0 3 * * * '/vault/.obsidian/cron/_runner.sh'");
	});

	it("keeps a multi-line job name from breaking the comment", () => {
		const block = buildManagedBlock([
			{ jobId: "x-1", jobName: "line one\nline two", schedule: "@daily", command: "'/x'" },
		]);
		expect(block.split("\n").filter((l) => l.startsWith("# job:"))).toHaveLength(1);
	});
});

describe("escapeCronPercent", () => {
	it("escapes percent, which vixie cron reads as a newline", () => {
		expect(escapeCronPercent("date +%Y-%m-%d")).toBe("date +\\%Y-\\%m-\\%d");
	});

	it("is applied by buildManagedBlock", () => {
		const block = buildManagedBlock([
			{ jobId: "x-1", jobName: "x", schedule: "@daily", command: "'/a%b'" },
		]);
		expect(block).toContain("'/a\\%b'");
	});
});

describe("spliceManagedBlock", () => {
	it("appends to an existing crontab and preserves every user line", () => {
		const result = spliceManagedBlock(USER_CRONTAB, BLOCK);
		for (const line of USER_CRONTAB.split("\n").filter((l) => l !== "")) {
			expect(result).toContain(line);
		}
		expect(result.indexOf("# my own stuff")).toBeLessThan(result.indexOf("# BEGIN"));
		expect(result.endsWith("\n")).toBe(true);
	});

	it("is idempotent across repeated syncs", () => {
		const once = spliceManagedBlock(USER_CRONTAB, BLOCK);
		const twice = spliceManagedBlock(once, BLOCK);
		expect(twice).toBe(once);
	});

	it("replaces the block in place rather than moving it to the end", () => {
		const withBlock = spliceManagedBlock(
			["FOO=1", BLOCK, "0 6 * * * /trailing-job", ""].join("\n"),
			BLOCK
		);
		const updated = spliceManagedBlock(
			withBlock,
			buildManagedBlock([
				{ jobId: "other-1", jobName: "Other", schedule: "@hourly", command: "'/x'" },
			])
		);
		expect(updated.indexOf("FOO=1")).toBeLessThan(updated.indexOf("# BEGIN"));
		expect(updated.indexOf("# END")).toBeLessThan(updated.indexOf("0 6 * * * /trailing-job"));
		expect(updated).not.toContain("backup-sh-a1b2");
	});

	it("round-trips back to the original when removed", () => {
		const added = spliceManagedBlock(USER_CRONTAB, BLOCK);
		expect(spliceManagedBlock(added, null)).toBe(USER_CRONTAB);
	});

	it("preserves CRLF line endings on unmanaged lines", () => {
		const crlf = "0 4 * * * /a\r\n0 5 * * * /b\r\n";
		const added = spliceManagedBlock(crlf, BLOCK);
		expect(added).toContain("0 4 * * * /a\r\n");
		expect(spliceManagedBlock(added, null)).toBe(crlf);
	});

	it("returns the input identically when there is nothing to remove", () => {
		const odd = "0 4 * * * /a";
		expect(spliceManagedBlock(odd, null)).toBe(odd);
		expect(spliceManagedBlock("", null)).toBe("");
	});

	it("handles an empty crontab", () => {
		expect(spliceManagedBlock("", BLOCK)).toBe(`${BLOCK}\n`);
		expect(spliceManagedBlock("\n\n", BLOCK)).toBe(`${BLOCK}\n`);
	});

	it("empties the crontab when the block was all it contained", () => {
		const only = spliceManagedBlock("", BLOCK);
		expect(spliceManagedBlock(only, null)).toBe("");
	});

	it("refuses to guess when the end sentinel is missing", () => {
		const broken = `${USER_CRONTAB}# BEGIN obsidian-cron-jobs\n0 3 * * * /x\n`;
		expect(() => spliceManagedBlock(broken, BLOCK)).toThrow(MalformedManagedBlockError);
		expect(() => spliceManagedBlock(broken, null)).toThrow(MalformedManagedBlockError);
	});

	it("refuses to guess when there are two begin sentinels", () => {
		const doubled = [BLOCK, BLOCK, ""].join("\n");
		expect(() => spliceManagedBlock(doubled, BLOCK)).toThrow(MalformedManagedBlockError);
	});
});

describe("extractManagedBlock", () => {
	it("finds the block and returns null when absent", () => {
		expect(extractManagedBlock(spliceManagedBlock(USER_CRONTAB, BLOCK))).toBe(BLOCK);
		expect(extractManagedBlock(USER_CRONTAB)).toBeNull();
	});
});
