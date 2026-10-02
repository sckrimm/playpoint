import { spawn } from "node:child_process";

const processes = [
  spawn("npm", ["run", "api:start"], { stdio: "inherit", env: process.env }),
  spawn("npm", ["run", "start", "-w", "@playpoint/bot"], {
    stdio: "inherit",
    env: { ...process.env, DASHBOARD_PORT: process.env.BOT_INTERNAL_PORT ?? "4173" },
  }),
];

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill(signal);
}

for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`Production child exited (${signal ?? code ?? "unknown"})`);
      stop("SIGTERM");
      process.exitCode = code || 1;
    }
  });
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
