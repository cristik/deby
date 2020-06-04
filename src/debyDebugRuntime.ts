import { InteractiveProcessHandler } from "./interactiveProcessHandler"
import { PryDebugRuntime } from "./pryDebugRuntime"

export class DebyBreakpoint {
	public id: number
	public file: string
	public line: number
}

export class DebyStacktraceEntry {
	idx: number
	file: string
	line: number
	context: string
}

export class DebugCommand<T> {
	constructor(public readonly cmd: string, public readonly responseParser: (str: string) => T) { }
}

export interface DebyDebugRuntime {

	makeProcessHandler(): InteractiveProcessHandler

	stacktraceCommand(): DebugCommand<DebyStacktraceEntry[]>

	stepOverCommand(): DebugCommand<void>

	stepIntoCommand(): DebugCommand<void>

	stepOutCommand(): DebugCommand<void>

	continueCommand(): DebugCommand<void>

	pauseCommand(): DebugCommand<void>

	evalCommand(expr: string): DebugCommand<string>

	variablesCommand(): DebugCommand<string[]>

	setBreakpointCommand(breakpoint: DebyBreakpoint): DebugCommand<void>
}

export class DebyDebugRuntimeFactory {

	makeRuntime(type: string, port: number): DebyDebugRuntime {
		return new PryDebugRuntime()
	}
}