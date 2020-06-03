import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, StoppedEvent, OutputEvent, TerminatedEvent,
	Thread, StackFrame, Scope, Source, Handles
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { basename } from 'path';
import { InteractiveProcessHandler } from './interactiveProcessHandler';
import { PortMonitor } from './portMonitor';
import { DebyDebugRuntime, DebyDebugRuntimeFactory, DebyBreakpoint, DebugCommand } from './debyDebugRuntime';
const { Subject } = require('await-notify');

/**
 * This interface describes the deby-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the deby-debug extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
}

export class DebyDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	private runtime: DebyDebugRuntime

	private processHandler: InteractiveProcessHandler;

	private portMonitor: PortMonitor

	private active: Boolean

	private _variableHandles = new Handles<string>();

	private _configurationDone = new Subject();

	private _cancelationTokens = new Map<number, boolean>();

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("deby-debug.txt")

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(true)
		this.setDebuggerColumnsStartAt1(true)

		this.runtime = new DebyDebugRuntimeFactory().makeRuntime('pry', 9876)

		this.processHandler = this.runtime.makeProcessHandler()
		//new InteractiveProcessHandler('rvm', ['2.1.10', 'exec', 'pry-remote'], /^\[\d+\]/);

		this.processHandler.onTerminate = () => {
			if (this.active) {
				this.portMonitor.start()
			}
		}

		this.processHandler.onUnexpectedOutput = () => {
			//this.processHandler.breakpoints.forEach(breakpoint => this.registerBreakpoint(breakpoint));
			this.sendEvent(new OutputEvent('Found a Pry session\n'));
			this.sendEvent(new StoppedEvent('entry', DebyDebugSession.THREAD_ID));
		}

		this.portMonitor = new PortMonitor(9876, () => this.processHandler.launch())

		// setup event handlers
		this.processHandler.on('stopOnEntry', () => {
			this.sendEvent(new StoppedEvent('entry', DebyDebugSession.THREAD_ID));
		});
		this.processHandler.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', DebyDebugSession.THREAD_ID));
		});
		this.processHandler.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', DebyDebugSession.THREAD_ID));
		});
		this.processHandler.on('stopOnDataBreakpoint', () => {
			this.sendEvent(new StoppedEvent('data breakpoint', DebyDebugSession.THREAD_ID));
		});
		this.processHandler.on('stopOnException', () => {
			this.sendEvent(new StoppedEvent('exception', DebyDebugSession.THREAD_ID));
		});
		// this._runtime.on('breakpointValidated', (bp: DebyBreakpoint) => {
		// 	this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
		// });
		this.processHandler.on('output', (text, filePath, line, column) => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}\n`);

			if (text === 'start' || text === 'startCollapsed' || text === 'end') {
				e.body.group = text;
				e.body.output = `group-${text}\n`;
			}
			this.sendEvent(e);
		});
		this.processHandler.on('end', () => {
			//this.sendEvent(new TerminatedEvent());
		});
	}

	sendEvent(event: DebugProtocol.Event): void {
		console.log(`Sending event ${event.event}`);
		super.sendEvent(event);
	}

	sendResponse(response: DebugProtocol.Response): void {
		console.log(`Sending response for ${response.command}`);
		super.sendResponse(response);
	}

	private sendCommand<T>(cmd: DebugCommand<T>): Promise<T> {
		return this.processHandler.send(cmd.cmd).then(cmd.responseParser)
	}

	private sendGenericCommand(cmd: string): Promise<string> {
		return this.processHandler.send(cmd)
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		if (args.supportsProgressReporting) {
			// this._reportProgress = true;
		}

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code to show a 'step back' button
		response.body.supportsStepBack = false;

		// make VS Code to support data breakpoints
		response.body.supportsDataBreakpoints = false;

		// make VS Code to support completion in REPL
		response.body.supportsCompletionsRequest = false;
		response.body.completionTriggerCharacters = [ ".", "[" ];

		// make VS Code to send cancelRequests
		response.body.supportsCancelRequest = true;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = false;

		// make VS Code send the terminate request
		response.body.supportsTerminateRequest = true;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {

		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		// wait until configuration has finished (and configurationDoneRequest has been called)
		await this._configurationDone.wait(1000)

		const self = this;
		self.processHandler.onUnexpectedOutput = (str) => self.sendEvent(new StoppedEvent('entry', DebyDebugSession.THREAD_ID));

		self.sendResponse(response)
		this.sendEvent(new OutputEvent('Waiting for a Pry session...\n'))
		this.portMonitor.start()
		this.active = true
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): void {
		//this._paused = true;
		//this.connect();
	}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments, request?: DebugProtocol.Request): void {
		this.portMonitor.stop()
		this.sendGenericCommand('continue');
		this.sendResponse(response);
		this.sendEvent(new OutputEvent('Stopping debug session...\n'));
		this.sendEvent(new TerminatedEvent());
		this.active = false
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		// pry-debugger doesn't cope very well with breakpoints, disabling support for now
		response.body = { breakpoints: [] };
		// (args.lines || []).forEach(line => {
		// 	let breakpoint: DebyBreakpoint = { id: this._runtime.breakpoints.length + 1, file: args.source.path || '', line: line };
		// 	this._runtime.breakpoints.push(breakpoint);
		// 	this.registerBreakpoint(breakpoint);
		// 	(response.body.breakpoints || []).push({id: breakpoint.id, verified: true, source: new Source(basename(breakpoint.file), breakpoint.file, breakpoint.line) });
		// });
		this.sendResponse(response);
	}

	private registerBreakpoint(breakpoint: DebyBreakpoint): Promise<any> {
		return Promise.resolve();
		// if (this.processHandler.isConnected()) {
		// 	return this.processHandler.send(`break ${breakpoint.file} ${breakpoint.line}`);
		// } else {
		// 	return Promise.resolve();
		// }
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		// currently supporting one thread only.
		response.body = {
			threads: [
				new Thread(DebyDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		const self = this
		// TODO: make these await's
	 	self.sendCommand(self.runtime.stacktraceCommand()).then(stackEntries => {
			const stackFrames = stackEntries.map(stackEntry => {
				return new StackFrame(stackEntry.idx,
					stackEntry.context,
					new Source(basename(stackEntry.file), stackEntry.file),
					self.convertDebuggerLineToClient(stackEntry.line))
			})
			response.body = {
				stackFrames: stackFrames,
				totalFrames: stackFrames.length
			}
			self.sendResponse(response)
		})
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		response.body = {
			scopes: [
				new Scope("Local", this._variableHandles.create("local"), false),
				new Scope("Global", this._variableHandles.create("global"), true)
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {
		const self = this;
		//this.sendCommand('ls -lic').then ( str => {
			self.sendResponse(response);
		//});
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		const self = this;
		//self._paused = false;
		this.sendGenericCommand('continue');
		self.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		response.success = false
		this.sendResponse(response)
		//const self = this
		//this.sendGenericCommand('next').then(str => {
		//	self.sendResponse(response)
	//		self.sendEvent(new StoppedEvent('step', DebyDebugSession.THREAD_ID))
	//	})
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.StepInRequest): void {
		response.success = false
		this.sendResponse(response)
		// const self = this
		// this.sendGenericCommand('step').then(str => {
		// 	self.sendResponse(response)
		// 	self.sendEvent(new StoppedEvent('step', DebyDebugSession.THREAD_ID))
		// })
	}

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.StepOutRequest): void {
		response.success = false
		this.sendResponse(response)
		// const self = this;
		// this.sendGenericCommand('finish').then(str => {
		// 	self.sendResponse(response)
		// 	self.sendEvent(new StoppedEvent('step', DebyDebugSession.THREAD_ID))
		// })
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		const self = this
		this.sendGenericCommand(args.expression).then(str => {
			response.body = {
				result: str.replace(/=> |\x1B|\[[[0-9;]*m/g,''),
				variablesReference: 0
			};
			self.sendResponse(response)
		})
	}

	protected completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments): void {

		response.body = {
			targets: [
				{
					label: "item 10",
					sortText: "10"
				},
				{
					label: "item 1",
					sortText: "01"
				},
				{
					label: "item 2",
					sortText: "02"
				},
				{
					label: "array[]",
					selectionStart: 6,
					sortText: "03"
				},
				{
					label: "func(arg)",
					selectionStart: 5,
					selectionLength: 3,
					sortText: "04"
				}
			]
		};
		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
		if (args.requestId) {
			this._cancelationTokens.set(args.requestId, true);
		}
		if (args.progressId) {
			// this._cancelledProgressId= args.progressId;
		}
	}
}
