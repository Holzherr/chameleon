import { type ArgSpec, parseArgs } from "./args";
import {
	type CommandOutput,
	cmdAutozoom,
	cmdCaption,
	cmdCut,
	cmdExport,
	cmdFrame,
	cmdList,
	cmdNew,
	cmdOpen,
	cmdRemove,
	cmdSet,
	cmdShow,
	cmdSpeed,
	cmdText,
	cmdTranscript,
	cmdZoom,
} from "./commands";
import { CliError } from "./errors";
import { whisperWordsInProcess } from "./media";

const TIME_HELP = `Times: 12.5 | 12.5s | 1500ms | 1:02.25 (seconds by default).
Time domain: SOURCE video time by default, the same times the transcript reports
and the project file stores. --timeline reads <start>/<end> as times on the
edited output (after cuts and speed changes) and converts them to source time.`;

interface CommandDef {
	usage: string;
	summary: string;
	spec: ArgSpec;
	run: (args: ReturnType<typeof parseArgs>) => Promise<CommandOutput>;
}

const silenceFlags = ["noise", "min-silence"];

const COMMANDS: Record<string, CommandDef> = {
	new: {
		usage: "new <video> [-o <project.openscreen>] [--webcam <video>] [--force]",
		summary: "create a project for a video (default: next to the video)",
		spec: { strings: ["out", "webcam"], booleans: ["force"], aliases: { o: "out" } },
		run: cmdNew,
	},
	show: {
		usage: "show <project>",
		summary: "full state + summary: source/edited duration, regions with ids",
		spec: {},
		run: cmdShow,
	},
	transcript: {
		usage: "transcript <project|video> [--refresh] [--noise -35] [--min-silence 150ms]",
		summary: "word-level transcript (Whisper base) and silences, cached as <file>.transcript.json",
		spec: { booleans: ["refresh"], strings: silenceFlags },
		run: cmdTranscript,
	},
	cut: {
		usage:
			'cut <project> <start> <end> [--snap] [--timeline]\n       cut <project> --text "<phrase>" [--snap] [--all | --nth N]',
		summary: "remove a span (trim region); overlapping cuts merge",
		spec: {
			booleans: ["snap", "timeline", "all", "refresh"],
			strings: ["text", "nth", ...silenceFlags],
		},
		run: cmdCut,
	},
	speed: {
		usage: "speed <project> <start> <end> <factor> [--timeline]",
		summary: "play a span at 0.1–16x (overlapped speed regions are clipped)",
		spec: { booleans: ["timeline"] },
		run: cmdSpeed,
	},
	zoom: {
		usage: "zoom <project> <start> <end> [--depth 1-6] [--focus x,y|auto] [--replace] [--timeline]",
		summary: "zoom in on a span; focus x,y normalised 0–1 (default 0.5,0.5), depth default 3",
		spec: { booleans: ["timeline", "replace"], strings: ["depth", "focus"] },
		run: cmdZoom,
	},
	autozoom: {
		usage: "autozoom <project> [--replace] [--clicks-only | --dwell-only]",
		summary: "auto zooms from cursor telemetry (click clusters + dwells), like the editor's wand",
		spec: { booleans: ["replace", "clicks-only", "dwell-only"] },
		run: cmdAutozoom,
	},
	text: {
		usage:
			'text <project> <start> <end> "<text>" [--x 50 --y 50] [--width 30 --height 20] [--size 32]\n       [--color #fff] [--bg transparent] [--font Inter] [--weight bold|normal] [--align center]\n       [--animation none|fade|rise|pop|slide-left|typewriter|pulse] [--timeline]',
		summary: "text overlay; x,y = top-left corner, x/y/width/height in % of the canvas",
		spec: {
			booleans: ["timeline"],
			strings: [
				"x",
				"y",
				"width",
				"height",
				"size",
				"color",
				"bg",
				"font",
				"weight",
				"align",
				"animation",
			],
		},
		run: cmdText,
	},
	caption: {
		usage: "caption <project> [--min-words 2] [--max-words 7] [--replace] [--refresh]",
		summary: "add caption annotations from the word transcript, like the app's auto-captions",
		spec: {
			booleans: ["replace", "refresh"],
			strings: ["min-words", "max-words", ...silenceFlags],
		},
		run: cmdCaption,
	},
	list: {
		usage: "list <project> [trim|speed|zoom|annotation|text|caption]",
		summary: "list regions with ids (source and timeline times)",
		spec: {},
		run: cmdList,
	},
	remove: {
		usage: "remove <project> <id> [<id>...]",
		summary: "delete regions by id",
		spec: {},
		run: cmdRemove,
	},
	set: {
		usage: "set <project> <key>=<value>... (e.g. padding=20 aspectRatio=9:16 cropRegion.x=0.1)",
		summary: "change editor settings; values are JSON or plain strings, validated like the app",
		spec: {},
		run: cmdSet,
	},
	open: {
		usage: "open <project>",
		summary: "open the project in the Chameleon app",
		spec: {},
		run: cmdOpen,
	},
	export: {
		usage: "export <project> -o <out.mp4|out.gif>",
		summary: "render the edited video headlessly through the app",
		spec: { strings: ["out"], aliases: { o: "out" } },
		run: cmdExport,
	},
	frame: {
		usage: "frame <project> <time> -o <out.png> [--timeline]",
		summary: "render one still; <time> is source time (default) or edited-timeline time",
		spec: { strings: ["out"], booleans: ["timeline"], aliases: { o: "out" } },
		run: cmdFrame,
	},
};

function globalHelp(): string {
	const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
	return [
		"chameleon: edit Chameleon/OpenScreen projects (.openscreen) from the terminal",
		"",
		"Usage: chameleon <command> [args] [--json]",
		"",
		...Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`),
		"",
		TIME_HELP,
		"",
		"Every command takes --json for machine output. Edits rewrite the project file",
		"atomically. Run `chameleon <command> --help` for its options.",
	].join("\n");
}

function commandHelp(c: CommandDef): string {
	return [`Usage: chameleon ${c.usage} [--json]`, "", c.summary, "", TIME_HELP].join("\n");
}

export async function main(argv: string[]): Promise<number> {
	const [name, ...rest] = argv;

	if (name === "__whisper") {
		const words = await whisperWordsInProcess(rest[0], rest[1]);
		process.stdout.write(JSON.stringify(words));
		return 0;
	}

	if (!name || name === "help" || name === "--help" || name === "-h") {
		const topic = name === "help" ? rest[0] : undefined;
		const def = topic ? COMMANDS[topic] : undefined;
		process.stdout.write(`${def && topic ? commandHelp(def) : globalHelp()}\n`);
		return name ? 0 : 1;
	}

	const def = COMMANDS[name];
	const wantsJson = rest.includes("--json");
	try {
		if (!def) throw new CliError(`unknown command "${name}" (run chameleon --help)`);
		const args = parseArgs(rest, def.spec);
		if (args.flags.help) {
			process.stdout.write(`${commandHelp(def)}\n`);
			return 0;
		}
		const out = await def.run(args);
		process.stdout.write(
			args.flags.json ? `${JSON.stringify(out.json, null, 2)}\n` : `${out.human}\n`,
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (wantsJson)
			process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
		process.stderr.write(`chameleon ${name ?? ""}: ${message}\n`);
		if (!(error instanceof CliError) && process.env.CHAMELEON_DEBUG && error instanceof Error) {
			process.stderr.write(`${error.stack}\n`);
		}
		return 1;
	}
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error) => {
		process.stderr.write(`chameleon: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	},
);
