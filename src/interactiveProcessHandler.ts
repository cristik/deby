import { EventEmitter } from 'events'
import { ChildProcess } from 'child_process'

class Command {
	public readonly cmd: string
	public readonly onResponse: (response: string) => void
	public readonly date: number

	constructor(cmd: string, onResponse: (response: string) => void) {
		this.cmd = cmd
		this.onResponse = onResponse
		this.date = Date.now()
	}
}

/**
 * The Deby runtime.
 */
export class InteractiveProcessHandler extends EventEmitter {

	private readonly program: string
	private readonly args: string[]
	private readonly responseMarker: RegExp
	private spawnedProcess?: ChildProcess

	private commandQueue: Command[] = []
	private accumulatedStdout = ''
	private accumulatedStderr = ''
	private lastCommandDate: number = 0

	public onTerminate: (exitCode: number, stderr: string) => void = () => { }
	public onUnexpectedOutput: (str: string) => void = () => { }

	constructor(program: string, args: string[], responseMarker: RegExp) {
		super()
		this.program = program
		this.args = args
		this.responseMarker = responseMarker
	}

	public isProcessRunning(): boolean {
		return this.spawnedProcess != null
	}

	/**
	 * Start executing the given program.
	 */
	public launch(): void {
		const self = this
		if (self.spawnedProcess !== undefined) {
			return
		}

		const { spawn } = require('child_process')
		const spawnedProcess = spawn(this.program, this.args)
		spawnedProcess.on('error', (err) => {
			console.error(`Failed to start subprocess: ${err}`)
			self.onTerminate(-1, self.accumulatedStderr)
			self.spawnedProcess = undefined
			self.commandQueue = []
		})
		spawnedProcess.addListener('exit', (code: number) => {
			console.log(`process exited with code ${code}`)
			self.onTerminate(code, self.accumulatedStderr)
			self.spawnedProcess = undefined
			self.commandQueue = []
		})
		spawnedProcess.stdout.on('data', (data) => {
			const str = data.toString();
			//const msg = JSON.stringify({str: str});
			self.accumulatedStdout += str
			if (self.responseMarker.exec(str)) {
				// this is a little bit brutal approach, but we know the last line contains only the
				// marker, so we remove it
				const lastNewlinePos = self.accumulatedStdout.lastIndexOf('\n')
				self.accumulatedStdout = self.accumulatedStdout.slice(0, lastNewlinePos)

				console.log(`Received output: ${self.accumulatedStdout.substr(self.accumulatedStdout.length-100,100)}`)
				const cmd = self.commandQueue.shift()
				if (cmd !== undefined) {
					console.log(`Reporting success for ${cmd.cmd}`)
					cmd.onResponse(self.accumulatedStdout);
					self.dequeue();
				} else {
					console.log('Reporting unexpected output')
					self.onUnexpectedOutput(str);
				}
			}
		})
		spawnedProcess.stderr.on('data', (data) => {
			console.log(`Received err: ${data}`)
			self.accumulatedStderr = self.accumulatedStderr + data.toString()
		})
		this.spawnedProcess = spawnedProcess
	}

	public send(cmd: string): Promise<string> {
		const self = this
		return new Promise(resolve => {
			console.log(`Enqueueing command: ${cmd}, queue size: ${self.commandQueue.length}`)
			self.commandQueue.push(new Command(cmd, resolve))
			if (self.commandQueue.length == 1) {
				self.dequeue()
			}
		})
	}

	private dequeue(): void {
		const self = this
		if (self.commandQueue.length == 0) {
			return
		}

		const now = Date.now();
		if (now - self.lastCommandDate < 100) {
			// let's make sure we don't overwhelm Pry, making at most 10 requests
			// per second
			setTimeout(() => self.dequeue(), 100 - now - self.lastCommandDate);
			return;
		}

		const cmd = self.commandQueue[0].cmd
		console.log(`Sending command: ${cmd}`)
		self.accumulatedStdout = ''
		self.lastCommandDate = now
		if (self.spawnedProcess !== undefined) {
			self.spawnedProcess.stdin.write(`${cmd}\n`)
		}
	}
}