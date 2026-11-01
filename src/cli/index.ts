import { text } from "node:stream/consumers";
import { version } from "../../package.json";
import { run } from "./run";

process.exitCode = await run(process.argv.slice(2), version, {
  stdin: () => text(process.stdin),
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
});
