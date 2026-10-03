/**
 * Launches the Electron app for open/export/frame. STUB: the app-side agent
 * replaces this file wholesale.
 *
 * Contract: the app prints one stdout line `CHAMELEON_RESULT <json>`, which
 * `launchApp` parses into `result`.
 */
export async function launchApp(
	_args: string[],
	_opts: { wait: boolean },
): Promise<{ code: number; stdout: string; result?: unknown }> {
	throw new Error("app launcher not implemented yet");
}
