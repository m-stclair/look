import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function* jsFiles(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* jsFiles(path);
    } else if (entry.isFile() && path.endsWith(".js")) {
      yield path;
    }
  }
}

const roots = ["app.js", "src", "tests", "tools"];
const checks = [];
for (const root of roots) {
  if (root.endsWith(".js")) checks.push(root);
  else for await (const file of jsFiles(root)) checks.push(file);
}

let failed = false;
for (const file of checks) {
  const result = spawnSync(process.execPath, ["--check", file], {stdio: "inherit"});
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
