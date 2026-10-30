import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";

// Opt-in test fixture: no installer, host mount, SSH key, or guest port forwarding.
const runFile = promisify(execFile);
const binary = process.env.QUALIFY_QEMU_BINARY;
const disk = process.env.QUALIFY_LINUX_IMAGE;
assert(
  binary && disk,
  "Set QUALIFY_QEMU_BINARY and QUALIFY_LINUX_IMAGE (verified Debian nocloud qcow2)."
);
await access(binary);
await access(disk);
const git = async (...args) => (await runFile("git", args, { timeout: 30000 })).stdout.trim();
assert.equal(
  await git("branch", "--show-current"),
  "main",
  "Qualification must use existing main."
);
const commit = await git("rev-parse", "HEAD");
const directory = await mkdtemp(join(tmpdir(), "of-linux-qualification-"));
const archive = join(directory, "source.tar");
await git("archive", "--format=tar", "HEAD", "-o", archive);
console.log(`Committed source: ${commit}; working-tree edits are excluded.`);
console.log(`Fixture and console log: ${directory}`);
const guest = (
  await readFile(new URL("./linux-qualification-guest.sh", import.meta.url), "utf8")
).replaceAll("\r\n", "\n");
const payload = Buffer.from(guest)
  .toString("base64")
  .match(/.{1,76}/g)
  .join("\n");
let serial;
const consoleServer = createServer((socket) => {
  serial = socket;
  consoleServer.close();
  socket.on("data", consume);
  socket.on("error", (error) => {
    // Windows can reset the console socket when QEMU powers off normally.
    if (result === undefined) {
      console.error("Guest console failed:", error);
      child.kill();
    }
  });
});
await new Promise((ready, reject) => {
  consoleServer.once("error", reject);
  consoleServer.listen(0, "127.0.0.1", ready);
});
const port = consoleServer.address().port;
const child = spawn(
  binary,
  [
    "-machine",
    "q35,accel=whpx:tcg",
    "-smp",
    "2",
    "-m",
    "4096",
    "-display",
    "none",
    "-serial",
    "chardev:console",
    "-chardev",
    `socket,id=console,host=127.0.0.1,port=${port}`,
    "-monitor",
    "none",
    "-no-reboot",
    "-drive",
    `file=${resolve(disk).replaceAll("\\", "/")},format=qcow2,if=virtio,snapshot=on`,
    "-drive",
    `file=${archive.replaceAll("\\", "/")},format=raw,if=virtio,readonly=on`,
    "-netdev",
    "user,id=net0",
    "-device",
    "virtio-net-pci,netdev=net0",
    "-rtc",
    "base=utc"
  ],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
);
const log = createWriteStream(join(directory, "console.log"));
let tail = "";
let loggedIn = false;
let started = false;
let result;
let timedOut = false;
const timer = setTimeout(
  () => {
    timedOut = true;
    child.kill();
  },
  20 * 60 * 1000
);
const stop = () => child.kill();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
function consume(chunk) {
  log.write(chunk);
  process.stdout.write(chunk);
  tail = stripVTControlCharacters(tail + chunk.toString()).slice(-8192);
  if (!loggedIn && /login:\s*$/.test(tail)) {
    loggedIn = true;
    serial.write("root\n");
  }
  if (loggedIn && !started && /root@[^\r\n]*#\s*$/.test(tail)) {
    started = true;
    serial.write(
      `stty -echo\nbase64 -d > /tmp/qualify.sh <<'OF_GUEST_SCRIPT'\n${payload}\nOF_GUEST_SCRIPT\nQUALIFY_COMMIT=${commit} bash /tmp/qualify.sh\n`
    );
  }
  const match = tail.match(/OF_QUALIFICATION_RESULT=([0-9]+)\r?\n/);
  if (match) result = Number(match[1]);
}
child.stdout.on("data", consume);
child.stderr.on("data", consume);
try {
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  assert(!timedOut, "Linux VM exceeded its 20-minute limit.");
  assert.equal(result, 0, `Guest did not report success (QEMU exit ${code}, result ${result}).`);
  assert.equal(code, 0, "QEMU failed after guest qualification.");
} finally {
  clearTimeout(timer);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  if (child.exitCode === null && child.signalCode === null) child.kill();
  child.stdin.destroy();
  serial?.destroy();
  consoleServer.close();
  log.end();
}
