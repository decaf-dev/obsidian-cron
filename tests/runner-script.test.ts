import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRunnerScript, detectLoginShell } from "../src/obsidian/runner-script";
import { run } from "../src/obsidian/exec";

let dir: string;
let runner: string;

async function writeRunner(overrides: Partial<Parameters<typeof buildRunnerScript>[0]> = {}) {
	const script = buildRunnerScript({
		pluginVersion: "0.1.0",
		loginShell: process.env.SHELL || "/bin/sh",
		vaultPath: dir,
		logsDir: path.join(dir, "logs"),
		locksDir: path.join(dir, "locks"),
		extraPath: [],
		logMaxBytes: 1024 * 1024,
		...overrides,
	});
	await fs.writeFile(runner, script, { mode: 0o755 });
	return script;
}

async function job(name: string, body: string): Promise<string> {
	const file = path.join(dir, name);
	await fs.writeFile(file, body, { mode: 0o755 });
	return file;
}

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-cron-jobs-"));
	runner = path.join(dir, "_runner.sh");
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe("buildRunnerScript", () => {
	it("produces a syntactically valid POSIX script", async () => {
		await writeRunner();
		const result = await run("/bin/sh", ["-n", runner]);
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
	});

	it("stays valid when the vault path contains quotes and spaces", async () => {
		await writeRunner({ vaultPath: `/Users/t/Trey's "Vault" $HOME \`x\`` });
		const result = await run("/bin/sh", ["-n", runner]);
		expect(result.code).toBe(0);
		// The apostrophe survived as a literal rather than closing the quote.
		const text = await fs.readFile(runner, "utf8");
		expect(text).toContain(`'/Users/t/Trey'\\''s "Vault" $HOME \`x\`'`);
	});

	it("runs a job, logs it, and reports its exit code", async () => {
		await writeRunner();
		const script = await job("hello.sh", "#!/bin/sh\necho hello from job\nexit 0\n");

		const result = await run(runner, ["hello-1", script]);
		expect(result.code).toBe(0);

		const log = await fs.readFile(path.join(dir, "logs", "hello-1.log"), "utf8");
		expect(log).toContain("hello from job");
		expect(log).toContain("start hello-1");
		expect(log).toContain("exit 0");

		const status = await fs.readFile(path.join(dir, "logs", "hello-1.status"), "utf8");
		expect(status.trim()).toMatch(/^\d+ 0$/);
	});

	it("propagates a failing exit code and captures stderr", async () => {
		await writeRunner();
		const script = await job("fail.sh", "#!/bin/sh\necho oh no >&2\nexit 3\n");

		const result = await run(runner, ["fail-1", script]);
		expect(result.code).toBe(3);

		const log = await fs.readFile(path.join(dir, "logs", "fail-1.log"), "utf8");
		expect(log).toContain("oh no");
		expect(log).toContain("exit 3");
		const status = await fs.readFile(path.join(dir, "logs", "fail-1.status"), "utf8");
		expect(status.trim()).toMatch(/^\d+ 3$/);
	});

	it("runs the job with the vault as its working directory", async () => {
		await writeRunner();
		const script = await job("pwd.sh", "#!/bin/sh\npwd\n");

		await run(runner, ["pwd-1", script]);
		const log = await fs.readFile(path.join(dir, "logs", "pwd-1.log"), "utf8");
		// pwd reports the logical path the runner cd'd into, not the resolved one.
		expect(log).toContain(dir);
	});

	it("exposes the job id and vault path to the script", async () => {
		await writeRunner();
		const script = await job(
			"env.sh",
			'#!/bin/sh\necho "id=$OBSIDIAN_CRON_JOB_ID vault=$OBSIDIAN_VAULT_PATH"\n'
		);

		await run(runner, ["env-1", script]);
		const log = await fs.readFile(path.join(dir, "logs", "env-1.log"), "utf8");
		expect(log).toContain(`id=env-1 vault=${dir}`);
	});

	it("prepends extraPath so cron jobs can find non-default binaries", async () => {
		const binDir = path.join(dir, "bin");
		await fs.mkdir(binDir);
		await fs.writeFile(path.join(binDir, "only-here"), "#!/bin/sh\necho found it\n", {
			mode: 0o755,
		});
		await writeRunner({ extraPath: [binDir] });
		const script = await job("uses-bin.sh", "#!/bin/sh\nonly-here\n");

		await run(runner, ["bin-1", script]);
		const log = await fs.readFile(path.join(dir, "logs", "bin-1.log"), "utf8");
		expect(log).toContain("found it");
	});

	it("skips a run with exit 75 while another holds the lock", async () => {
		await writeRunner();
		const slow = await job("slow.sh", "#!/bin/sh\nsleep 2\n");

		const first = run(runner, ["slow-1", slow]);
		// Give the first run time to take the lock before racing it.
		await new Promise((resolve) => setTimeout(resolve, 400));
		const second = await run(runner, ["slow-1", slow]);

		expect(second.code).toBe(75);
		expect((await first).code).toBe(0);
	});

	it("never lets two runs of the same job overlap", async () => {
		await writeRunner();
		// Every run that gets through appends a byte, so the file length is the
		// number of runs that were not skipped.
		const script = await job(
			"race.sh",
			'#!/bin/sh\nprintf x >> "$OBSIDIAN_VAULT_PATH/hits"\nsleep 1\n'
		);

		// Started together, so they contend for the lock rather than finding it
		// already held: this is the window a two-step lock leaves open.
		const results = await Promise.all(
			Array.from({ length: 8 }, () => run(runner, ["race-1", script]))
		);

		expect(await fs.readFile(path.join(dir, "hits"), "utf8")).toBe("x");
		expect(results.filter((result) => result.code === 0)).toHaveLength(1);
		expect(results.filter((result) => result.code === 75)).toHaveLength(7);
	});

	it("publishes the holder's pid at the same moment as the lock", async () => {
		await writeRunner();
		const script = await job("held.sh", "#!/bin/sh\nsleep 1\n");
		const lock = path.join(dir, "locks", "held-1.lock");

		const running = run(runner, ["held-1", script]);
		// Poll from the instant the lock appears: it must never be readable
		// without a live pid in it, or a second run would call it stale.
		for (let i = 0; i < 200; i++) {
			const pid = await fs.readFile(lock, "utf8").catch(() => null);
			if (pid !== null) {
				expect(pid.trim()).toMatch(/^\d+$/);
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		await running;
		expect(await fs.readFile(lock, "utf8").catch(() => null)).toBeNull();
	});

	it("reclaims a stale lock left behind by a killed run", async () => {
		await writeRunner();
		const script = await job("ok.sh", "#!/bin/sh\necho ran\n");
		await fs.mkdir(path.join(dir, "locks"), { recursive: true });
		// A pid that cannot be running, so kill -0 fails and the lock is stale.
		await fs.writeFile(path.join(dir, "locks", "stale-1.lock"), "999999\n");

		const result = await run(runner, ["stale-1", script]);
		expect(result.code).toBe(0);
	});

	it("reclaims a lock directory left by an older version of the plugin", async () => {
		await writeRunner();
		const script = await job("ok.sh", "#!/bin/sh\necho ran\n");
		const lock = path.join(dir, "locks", "legacy-1.lock");
		await fs.mkdir(lock, { recursive: true });
		await fs.writeFile(path.join(lock, "pid"), "999999\n");

		const result = await run(runner, ["legacy-1", script]);
		expect(result.code).toBe(0);
	});

	it("releases the lock when the job finishes", async () => {
		await writeRunner();
		const script = await job("twice.sh", "#!/bin/sh\necho ran\n");

		expect((await run(runner, ["twice-1", script])).code).toBe(0);
		expect((await run(runner, ["twice-1", script])).code).toBe(0);
	});

	it("truncates a log that has grown past the cap", async () => {
		await writeRunner({ logMaxBytes: 2048 });
		await fs.mkdir(path.join(dir, "logs"), { recursive: true });
		const log = path.join(dir, "logs", "big-1.log");
		await fs.writeFile(log, "x".repeat(10_000));
		const script = await job("small.sh", "#!/bin/sh\necho after truncate\n");

		await run(runner, ["big-1", script]);
		const size = (await fs.stat(log)).size;
		expect(size).toBeLessThan(4096);
		expect(await fs.readFile(log, "utf8")).toContain("after truncate");
	});

	it("fails cleanly when the script is missing", async () => {
		await writeRunner();
		const result = await run(runner, ["gone-1", path.join(dir, "not-here.sh")]);
		expect(result.code).not.toBe(0);
	});

	it("requires both arguments", async () => {
		await writeRunner();
		expect((await run(runner, [])).code).not.toBe(0);
		expect((await run(runner, ["only-id"])).code).not.toBe(0);
	});
});

describe("detectLoginShell", () => {
	it("prefers an explicit override", () => {
		expect(detectLoginShell("/opt/homebrew/bin/fish")).toBe("/opt/homebrew/bin/fish");
		expect(detectLoginShell("  ")).toBe(detectLoginShell(null));
	});

	it("falls back to a platform default", () => {
		const previous = process.env.SHELL;
		delete process.env.SHELL;
		try {
			const expected = os.platform() === "darwin" ? "/bin/zsh" : "/bin/bash";
			expect(detectLoginShell(null)).toBe(expected);
		} finally {
			if (previous !== undefined) process.env.SHELL = previous;
		}
	});
});
