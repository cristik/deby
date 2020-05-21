import { EventEmitter } from 'events';

export enum RuntimeState {
	Disconnected,
	Connecting,
	Connected
};

export class DebyBreakpoint {
	public id: number
	public file: string
	public line: number
}

/**
 * The Deby runtime.
 */
export class DebyRuntime extends EventEmitter {

	private _pryRemoteProcess;
	private _queue: any[] = [];
	private _lastStdOut = '';
	private _lastStdErr = '';
	private _lastCommandDate = Date.now()
	private _state: RuntimeState = RuntimeState.Disconnected;

	public onTerminate: (exitCode: number) => void = () => { };
	public onUnexpectedOutput: (str: string) => void = () => { };

	public breakpoints: DebyBreakpoint[] = []

	constructor() {
		super();
	}

	public getState(): RuntimeState {
		return this._state;
	}

	public isConnected(): boolean {
		return this._state == RuntimeState.Connected;
	}

	/**
	 * Start executing the given program.
	 */
	public connect(): Promise<string> {
		const self = this;
		self._state = RuntimeState.Connecting;
		const { spawn } = require('child_process');
		this._pryRemoteProcess = spawn('rvm', ['2.1.10', 'exec', 'pry-remote']);
		console.log(`Process: ${this._pryRemoteProcess}`);
		this._pryRemoteProcess.on('error', (err) => {
			console.error(`Failed to start subprocess: ${err}`);
			self._state = RuntimeState.Disconnected;
		  });
		self._pryRemoteProcess.addListener('exit', (code) => {
			console.log(`pry-remote exited with code ${code}`);
			const cmd = self._queue.shift();
			if (cmd !== undefined) {
				cmd[2]([code, self._lastStdErr]);
				self.dequeue();
			}
			if (self.onTerminate !== undefined) {
				self.onTerminate(code);
			}
			self._state = RuntimeState.Disconnected;
		});
		self._pryRemoteProcess.stdout.on('data', (data) => {
			const str = data.toString();
			//const msg = JSON.stringify({str: str});
			if (/^\[\d+\]/.exec(str)) {
				console.log(`Received output: ${self._lastStdOut.substr(0,100)}`);
				const cmd = self._queue.shift();
				if (cmd !== undefined) {
					console.log(`Reporting success for ${cmd}`);
					cmd[1](self._lastStdOut);
					self.dequeue();
				} else {
					console.log('Reporting unexpected output');
					self.onUnexpectedOutput(str);
				}
			} else {
				self._lastStdOut += str;
			}
			self._state = RuntimeState.Connected;
		});
		this._pryRemoteProcess.stderr.on('data', (data) => {
			console.log(`Received err: ${data}`);
			self._lastStdErr = self._lastStdErr + data.toString();
		});
		return new Promise(function (resolve, reject) {
			self._queue.push(["", resolve, reject]);
		});
	}

	public send(cmd: string): Promise<string> {
		const self = this;
		return new Promise(function (resolve, reject) {
			console.log(`Enqueueing command: ${cmd}, queue size: ${self._queue.length}`);
			self._queue.push([cmd, resolve, reject]);
			if (self._queue.length == 1) {
				self.dequeue();
			}
		});
	}

	private dequeue(): void {
		const self = this;
		if (self._queue.length == 0) {
			return;
		}

		const now = Date.now();
		if (now - self._lastCommandDate < 100) {
			// let's make sure we don't overwhelm Pry, making at most 10 requests
			// per second
			setTimeout(() => self.dequeue(), 100 - now - self._lastCommandDate);
			return;
		}

		const cmd = self._queue[0][0];
		console.log(`Sending command: ${cmd}`);
		self._lastStdOut = '';
		self._lastCommandDate = now;
		self._pryRemoteProcess.stdin.write(`${cmd}\n`);
	}
}