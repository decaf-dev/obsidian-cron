import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createIgnoreRules } from "../src/obsidian/ignore-rules";
import { scanScripts } from "../src/obsidian/script-scanner";
import type { CronPaths } from "../src/obsidian/vault-paths";

const NO_RULES = createIgnoreRules([], []);

let root: string;
let paths: CronPaths;

function cronPaths(folder: string): CronPaths {
	return {
		vault: path.dirname(folder),
		folder,
		runner: path.join(folder, "_runner.sh"),
		logs: path.join(folder, "logs"),
		locks: path.join(folder, "locks"),
	};
}

async function write(relative: string, contents = "#!/bin/sh\n", mode = 0o755): Promise<void> {
	const full = path.join(root, relative);
	await fs.mkdir(path.dirname(full), { recursive: true });
	await fs.writeFile(full, contents, { mode });
	// writeFile only applies the mode when it creates the file.
	await fs.chmod(full, mode);
}

/** Names only, in the order the scan returned them. */
async function scan(rules = NO_RULES): Promise<string[]> {
	return (await scanScripts(paths, rules)).map((script) => script.fileName);
}

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "cron-scan-"));
	paths = cronPaths(root);
});

afterEach(async () => {
	// A test that dropped a mode to 0 would otherwise leave an undeletable tree.
	await fs.chmod(root, 0o755).catch(() => undefined);
	for (const entry of await fs.readdir(root).catch(() => [])) {
		await fs.chmod(path.join(root, entry), 0o755).catch(() => undefined);
	}
	await fs.rm(root, { recursive: true, force: true });
});

describe("scanScripts", () => {
	it("finds scripts in nested folders, keyed by their relative path", async () => {
		await write("top.sh");
		await write("backup/nightly.sh");
		await write("a/b/c/deep.sh");

		expect(await scan()).toEqual(["top.sh", "a/b/c/deep.sh", "backup/nightly.sh"]);
	});

	it("sorts by folder, then by name", async () => {
		await write("zebra.sh");
		await write("alpha.sh");
		await write("backup/b.sh");
		await write("backup/a.sh");

		expect(await scan()).toEqual(["alpha.sh", "zebra.sh", "backup/a.sh", "backup/b.sh"]);
	});

	it("skips the plugin's own files at the top level", async () => {
		await write("_runner.sh");
		await write("logs/stray.sh");
		await write("locks/stray.sh");
		await write("keep.sh");

		expect(await scan()).toEqual(["keep.sh"]);
	});

	it("scans a nested folder that happens to be called logs", async () => {
		await write("backup/logs/rotate.sh");
		await write("tools/_runner.sh");

		expect(await scan()).toEqual(["backup/logs/rotate.sh", "tools/_runner.sh"]);
	});

	it("skips dotted names at any depth", async () => {
		await write(".hidden.sh");
		await write(".git/hooks/pre-commit.sh");
		await write("backup/.draft.sh");
		await write("backup/keep.sh");

		expect(await scan()).toEqual(["backup/keep.sh"]);
	});

	it("skips anything that is not a .sh file", async () => {
		await write("notes.md");
		await write("backup/README");
		await write("backup/run.sh");

		expect(await scan()).toEqual(["backup/run.sh"]);
	});

	it("reports the executable bit and the shebang for a nested script", async () => {
		await write("backup/plain.sh", "echo hi\n", 0o644);
		await write("backup/ready.sh", "#!/bin/sh\necho hi\n", 0o755);

		const scripts = await scanScripts(paths, NO_RULES);
		expect(scripts).toEqual([
			{ fileName: "backup/plain.sh", executable: false, hasShebang: false, readError: null },
			{ fileName: "backup/ready.sh", executable: true, hasShebang: true, readError: null },
		]);
	});

	// Reporting an unreadable script as gone is what marks its job missing,
	// takes it out of the crontab and offers to remove it, only for the next
	// scan to add it back as a new job.
	it.skipIf(process.getuid?.() === 0)(
		"keeps a script it cannot read instead of dropping it from the scan",
		async () => {
			await write("backup/locked.sh", "#!/bin/sh\n", 0o311);

			const scripts = await scanScripts(paths, NO_RULES);
			expect(scripts).toHaveLength(1);
			expect(scripts[0]).toMatchObject({
				fileName: "backup/locked.sh",
				executable: true,
				hasShebang: false,
			});
			expect(scripts[0].readError).toBeTruthy();
		}
	);

	it("prunes an ignored folder by name at any depth", async () => {
		await write("lib/helper.sh");
		await write("backup/lib/helper.sh");
		await write("backup/nightly.sh");

		expect(await scan(createIgnoreRules(["lib"], []))).toEqual(["backup/nightly.sh"]);
	});

	it("prunes an ignored folder path without touching its siblings", async () => {
		await write("archive/2024/old.sh");
		await write("archive/2025/new.sh");
		await write("backup/archive/2024/kept.sh");

		expect(await scan(createIgnoreRules(["archive/2024"], []))).toEqual([
			"archive/2025/new.sh",
			"backup/archive/2024/kept.sh",
		]);
	});

	it("skips an ignored file by name at any depth, and by path exactly", async () => {
		await write("_shared.sh");
		await write("backup/_shared.sh");
		await write("tools/wip.sh");
		await write("other/wip.sh");

		expect(await scan(createIgnoreRules([], ["_shared.sh", "tools/wip.sh"]))).toEqual([
			"other/wip.sh",
		]);
	});

	it("follows a symlinked folder", async () => {
		await write("elsewhere/linked.sh");
		await fs.symlink(path.join(root, "elsewhere"), path.join(root, "shortcut"));

		expect(await scan()).toEqual(["elsewhere/linked.sh", "shortcut/linked.sh"]);
	});

	it("does not loop on a symlink cycle", async () => {
		await write("a/inner.sh");
		await fs.symlink(path.join(root, "a"), path.join(root, "a", "loop"));

		expect(await scan()).toEqual(["a/inner.sh"]);
	});

	it("does not list the same script twice through a symlink back to the root", async () => {
		await write("top.sh");
		await fs.symlink(root, path.join(root, "self"));

		expect(await scan()).toEqual(["top.sh"]);
	});

	it("skips a broken symlink", async () => {
		await write("real.sh");
		await fs.symlink(path.join(root, "nothing.sh"), path.join(root, "dangling.sh"));

		expect(await scan()).toEqual(["real.sh"]);
	});

	it("does not descend past the depth cap of eight folders", async () => {
		await write("a/b/c/d/e/f/g/h/deep.sh");
		await write("a/b/c/d/e/f/g/h/i/too-deep.sh");

		expect(await scan()).toEqual(["a/b/c/d/e/f/g/h/deep.sh"]);
	});

	it("throws rather than reporting an unreadable folder as empty", async () => {
		// Running as root defeats the permission bits entirely.
		if (process.getuid?.() === 0) return;
		await write("backup/nightly.sh");
		await fs.chmod(path.join(root, "backup"), 0o000);

		expect(scanScripts(paths, NO_RULES)).rejects.toThrow(/backup:/);
	});

	it("throws when the cron folder itself cannot be read", async () => {
		await fs.rm(root, { recursive: true, force: true });
		await fs.writeFile(root, "not a folder");

		expect(scanScripts(paths, NO_RULES)).rejects.toThrow();
	});
});
