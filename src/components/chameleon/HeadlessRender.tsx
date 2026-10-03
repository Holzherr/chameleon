import { useEffect } from "react";
import { runHeadlessRender } from "@/lib/chameleon/headlessRender";

/** Window body for `--chameleon-render`; the window is never shown. */
export default function HeadlessRender() {
	useEffect(() => {
		void runHeadlessRender();
	}, []);
	return null;
}
