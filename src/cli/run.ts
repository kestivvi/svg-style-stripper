import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { optimizeSvg, type OptimizeWarning } from "../core/optimize";
import { formatBytes, minifiedName, warningText } from "../core/format";

export interface Io {
  stdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const HELP = `Usage: claude-svg-optimizer [options] <file...>
       claude-svg-optimizer -  (read stdin, write stdout)

Writes <name>.min.svg next to each input file. Input files are never changed.

Options:
  -o, --out-dir <dir>  Write output files to this directory
  -f, --force          Overwrite output files that exist
  -h, --help           Show this help
  -v, --version        Show the version
`;

function reportWarnings(warnings: OptimizeWarning[], io: Io, prefix: string): void {
  for (const w of warnings) io.stderr(`${prefix}warning: ${warningText[w]}\n`);
}

async function runStdin(io: Io): Promise<number> {
  try {
    const result = optimizeSvg(await io.stdin());
    io.stdout(result.output);
    reportWarnings(result.warnings, io, "");
    return 0;
  } catch (error) {
    io.stderr(`Error: ${(error as Error).message}\n`);
    return 1;
  }
}

async function writeOutput(output: string, text: string, force: boolean): Promise<void> {
  try {
    await writeFile(output, text, { flag: force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${output} exists, use --force to overwrite it`);
    }
    throw error;
  }
}

/** Runs the CLI and returns the process exit code. */
export async function run(argv: string[], version: string, io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "out-dir": { type: "string", short: "o" },
        force: { type: "boolean", short: "f", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${HELP}`);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    io.stderr(HELP);
    return 0;
  }
  if (values.version) {
    io.stderr(`${version}\n`);
    return 0;
  }
  if (positionals.length === 0) {
    io.stderr(HELP);
    return 1;
  }

  if (positionals.includes("-")) {
    if (positionals.length > 1 || values["out-dir"]) {
      io.stderr("Error: '-' cannot be used with other files or --out-dir.\n");
      return 1;
    }
    return runStdin(io);
  }

  let failed = 0;
  let done = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  const written = new Set<string>();

  for (const input of positionals) {
    if (input.endsWith(".min.svg")) {
      io.stderr(`${input}: skipped, already has the .min.svg name\n`);
      continue;
    }
    try {
      const dir = values["out-dir"] ?? path.dirname(input);
      const output = path.join(dir, minifiedName(path.basename(input)));
      const key = path.resolve(output);
      if (written.has(key)) throw new Error(`another input already wrote ${output}`);

      const result = optimizeSvg(await readFile(input, "utf8"));
      if (values["out-dir"]) await mkdir(dir, { recursive: true });
      await writeOutput(output, result.output, values.force);
      written.add(key);

      done++;
      totalBefore += result.originalBytes;
      totalAfter += result.optimizedBytes;
      io.stderr(
        `${input}: ${formatBytes(result.originalBytes)} -> ${formatBytes(result.optimizedBytes)} (-${result.reducedPercent.toFixed(1)}%)\n`,
      );
      reportWarnings(result.warnings, io, `${input}: `);
    } catch (error) {
      failed++;
      io.stderr(`${input}: error: ${(error as Error).message}\n`);
    }
  }

  const saved = totalBefore === 0 ? 0 : ((totalBefore - totalAfter) / totalBefore) * 100;
  io.stderr(
    `${done} optimized, ${failed} failed: ${formatBytes(totalBefore)} -> ${formatBytes(totalAfter)} (-${saved.toFixed(1)}%)\n`,
  );
  return failed > 0 ? 1 : 0;
}
