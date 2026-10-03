import { CliError } from "./errors";

export interface ArgSpec {
	booleans?: string[];
	strings?: string[];
	aliases?: Record<string, string>;
}

export interface ParsedArgs {
	positionals: string[];
	flags: Record<string, string | boolean>;
}

const GLOBAL_BOOLEANS = ["json", "help"];

/** Minimal flag parser: `--flag`, `--key value`, `--key=value`, `-o value`, `--` ends flags. */
export function parseArgs(argv: string[], spec: ArgSpec = {}): ParsedArgs {
	const booleans = new Set([...GLOBAL_BOOLEANS, ...(spec.booleans ?? [])]);
	const strings = new Set(spec.strings ?? []);
	const aliases: Record<string, string> = { h: "help", ...(spec.aliases ?? {}) };
	const positionals: string[] = [];
	const flags: Record<string, string | boolean> = {};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--") {
			positionals.push(...argv.slice(i + 1));
			break;
		}
		const long = /^--([a-zA-Z][\w-]*)(?:=(.*))?$/s.exec(arg);
		const short = /^-([a-zA-Z])$/.exec(arg);
		if (!long && !short) {
			positionals.push(arg);
			continue;
		}
		const rawName = long ? long[1] : (short?.[1] ?? "");
		const name = aliases[rawName] ?? rawName;
		const inline = long?.[2];
		if (booleans.has(name)) {
			if (inline !== undefined) throw new CliError(`--${name} takes no value`);
			flags[name] = true;
		} else if (strings.has(name)) {
			const value = inline ?? argv[++i];
			if (value === undefined) throw new CliError(`--${name} needs a value`);
			flags[name] = value;
		} else {
			throw new CliError(`unknown option ${arg}`);
		}
	}
	return { positionals, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
	const v = args.flags[name];
	return typeof v === "string" ? v : undefined;
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
	const v = flagString(args, name);
	if (v === undefined) return undefined;
	const n = Number(v);
	if (!Number.isFinite(n)) throw new CliError(`--${name} must be a number, got "${v}"`);
	return n;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
	return args.flags[name] === true;
}
