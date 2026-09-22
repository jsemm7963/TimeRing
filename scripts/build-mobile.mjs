import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const capacitorBin = fileURLToPath(new URL("../node_modules/@capacitor/cli/bin/capacitor", import.meta.url));

run("bash", [fileURLToPath(new URL("./prepare-font.sh", import.meta.url))]);
run(process.execPath, [nextBin, "build"], { ...process.env, MOBILE_BUILD: "1" });
run(process.execPath, [capacitorBin, "sync", "android"]);
