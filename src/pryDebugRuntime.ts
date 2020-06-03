import { DebyDebugRuntime, DebugCommand, DebyStacktraceEntry } from "./debyDebugRuntime";
import { InteractiveProcessHandler } from "./interactiveProcessHandler";
import { basename } from "path";

export class PryDebugRuntime implements DebyDebugRuntime {

	makeProcessHandler(): InteractiveProcessHandler {
		return new InteractiveProcessHandler('rvm', ['2.1.10', 'exec', 'pry-remote'], /^\[\d+\]/)
	}

	stacktraceCommand(): DebugCommand<DebyStacktraceEntry[]> {
		return new DebugCommand<DebyStacktraceEntry[]>('caller', str => {
			const lines = str.split('\n')
			var idx = 0
			var stackEntries: DebyStacktraceEntry[] = []
			var foundDebugger = false
			lines.forEach(line => {
				const matches = /"\[0m\[31m(.*):(\d+):in `(.*)'\[1;31m"/.exec(line)
				const isDebuggerEntry = matches != null && ['pry-remote.rb'].indexOf(basename(matches[1])) > -1
				if (matches && foundDebugger && !isDebuggerEntry) {
					stackEntries.push({idx: idx,
						file: matches[1],
						line: Number(matches[2]),
						context: matches[3]})
					idx++;
				} else if (matches && isDebuggerEntry) {
					foundDebugger = true
				}
			})
			return stackEntries
		})
	}
}