import { DebyDebugRuntime, DebugCommand, DebyStacktraceEntry, DebyBreakpoint } from "./debyDebugRuntime";
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

	stepOverCommand(): DebugCommand<void> {

		return new DebugCommand<void>('' /*'next'*/, () => { throw 'Not implemented' })
	}

	stepIntoCommand(): DebugCommand<void> {

		return new DebugCommand<void>('' /*'step'*/, () => { throw 'Not implemented' })
	}

	stepOutCommand(): DebugCommand<void> {
		return new DebugCommand<void>('' /*'finish'*/, () => { throw 'Not implemented' })
	}

	continueCommand(): DebugCommand<void> {

		return new DebugCommand<void>('continue', () => { })
	}

	pauseCommand(): DebugCommand<void> {
		return new DebugCommand<void>('', () => { throw 'Not implemented' })
	}

	evalCommand(expr: string): DebugCommand<string> {
		return new DebugCommand<string>(expr, str => str.replace(/=> |\x1B|\[[[0-9;]*m/g,''))
	}

	variablesCommand(): DebugCommand<string[]> {

		return new DebugCommand<string[]>('' /*'ls -lic'*/, str => { throw 'Not implemented' })
	}

	setBreakpointCommand(breakpoint: DebyBreakpoint): DebugCommand<void> {
		return new DebugCommand<void>('' /*`break ${breakpoint.file} ${breakpoint.line}`*/, str => { throw 'Not implemented' })
	}
}