import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	CrontabCommandError,
	readCrontab,
	readCrontabSync,
	writeCrontab,
	writeCrontabSync,
} from "../src/obsidian/crontab-io";
import { buildManagedBlock, spliceManagedBlock } from "../src/obsidian/crontab-block";

let dir: string;
let bin: string;
let store: string;

/**
 * A stand-in for the crontab binary, backed by a file. Supports the three
 * forms the plugin uses: -l, -r and reading a new crontab from stdin.
 */
const stubFor = (storePath: string) => `#!/bin/sh
STORE='${storePath}'
case "\${1:-}" in
	-l)
		if [ -f "$STORE" ]; then cat "$STORE"; exit 0; fi
		echo "crontab: no crontab for $(whoami)" >&2
		exit 1
		;;
	-r)
		if [ -f "$STORE" ]; then rm -f "$STORE"; exit 0; fi
		echo "crontab: no crontab for $(whoami)" >&2
		exit 1
		;;
	-)
		cat > "$STORE"
		exit 0
		;;
esac
echo "crontab: unexpected arguments: $*" >&2
exit 2
`;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "crontab-io-"));
	bin = path.join(dir, "crontab");
	store = path.join(dir, "store");
	await fs.writeFile(bin, stubFor(store), { mode: 0o755 });
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

const BLOCK = buildManagedBlock([
	{ jobId: "b-1", jobName: "Backup", schedule: "0 3 * * *", command: "'/r.sh' 'b-1' '/b.sh'" },
]);

describe("readCrontab", () => {
	it("reports an absent crontab as empty rather than an error", async () => {
		expect(await readCrontab(bin)).toEqual({ text: "", existed: false });
	});

	it("returns the crontab when there is one", async () => {
		await fs.writeFile(store, "0 4 * * * /a\n");
		expect(await readCrontab(bin)).toEqual({ text: "0 4 * * * /a\n", existed: true });
	});

	it("surfaces stderr verbatim on a real failure", async () => {
		await fs.writeFile(
			bin,
			'#!/bin/sh\necho "crontab: you are not allowed to use this program" >&2\nexit 1\n',
			{ mode: 0o755 }
		);
		const error = (await readCrontab(bin).catch((e: unknown) => e)) as CrontabCommandError;
		expect(error).toBeInstanceOf(CrontabCommandError);
		expect(error.stderr).toContain("not allowed to use this program");
	});
});

describe("writeCrontab", () => {
	it("round-trips a managed block into an empty crontab and back out", async () => {
		const empty = await readCrontab(bin);
		const added = spliceManagedBlock(empty.text, BLOCK);
		await writeCrontab(bin, added, empty.existed);

		const afterAdd = await readCrontab(bin);
		expect(afterAdd.existed).toBe(true);
		expect(afterAdd.text).toContain("# BEGIN obsidian-cron");

		const removed = spliceManagedBlock(afterAdd.text, null);
		await writeCrontab(bin, removed, afterAdd.existed);
		expect(await readCrontab(bin)).toEqual({ text: "", existed: false });
	});

	it("leaves the user's own jobs byte for byte intact", async () => {
		const original = "# mine\nMAILTO=me@example.com\n0 4 * * * /usr/local/bin/rsync\n";
		await fs.writeFile(store, original);

		const before = await readCrontab(bin);
		await writeCrontab(bin, spliceManagedBlock(before.text, BLOCK), before.existed);

		const withBlock = await readCrontab(bin);
		const restored = spliceManagedBlock(withBlock.text, null);
		await writeCrontab(bin, restored, withBlock.existed);

		expect((await readCrontab(bin)).text).toBe(original);
	});

	it("removes the crontab rather than writing an empty one", async () => {
		await fs.writeFile(store, "0 4 * * * /a\n");
		await writeCrontab(bin, "", true);
		// -r deleted the file, so the stub reports no crontab at all.
		expect(await readCrontab(bin)).toEqual({ text: "", existed: false });
	});

	it("does nothing when asked to clear a crontab that never existed", async () => {
		await writeCrontab(bin, "", false);
		expect(await readCrontab(bin)).toEqual({ text: "", existed: false });
	});

	it("raises the stderr from a rejected write", async () => {
		await fs.writeFile(bin, '#!/bin/sh\necho "crontab: errors in file" >&2\nexit 1\n', {
			mode: 0o755,
		});
		const error = (await writeCrontab(bin, "junk\n", true).catch((e: unknown) => e)) as CrontabCommandError;
		expect(error).toBeInstanceOf(CrontabCommandError);
		expect(error.stderr).toContain("errors in file");
	});
});

describe("synchronous teardown", () => {
	it("strips the block the same way the async path does", async () => {
		const original = "0 4 * * * /a\n";
		await fs.writeFile(store, original);

		const before = await readCrontab(bin);
		await writeCrontab(bin, spliceManagedBlock(before.text, BLOCK), before.existed);

		// This is the path onunload takes on a real plugin disable.
		const current = readCrontabSync(bin);
		writeCrontabSync(bin, spliceManagedBlock(current.text, null), current.existed);

		expect((await readCrontab(bin)).text).toBe(original);
	});
});
