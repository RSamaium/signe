import { spawn } from "node:child_process";

const commands = [
  ["world", ["tsx", "world-server.ts"]],
  ["room", ["tsx", "room-server.ts"]],
] as const;

const children = commands.map(([name, args]) => {
  const child = spawn("pnpm", ["exec", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
      stop();
    }
  });

  return child;
});

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function stop() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}
