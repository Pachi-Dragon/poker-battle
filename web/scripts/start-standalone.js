/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const standaloneDir = path.join(rootDir, ".next", "standalone");
const staticSrc = path.join(rootDir, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
const publicSrc = path.join(rootDir, "public");
const publicDest = path.join(standaloneDir, "public");

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

copyRecursive(staticSrc, staticDest);
copyRecursive(publicSrc, publicDest);

const serverPath = path.join(standaloneDir, "server.js");
const env = {
  ...process.env,
  HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
  PORT: process.env.PORT || "3000",
};

const child = spawn(process.execPath, [serverPath], {
  stdio: "inherit",
  env,
  cwd: rootDir,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
