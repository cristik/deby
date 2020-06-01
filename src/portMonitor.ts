export class PortMonitor {
	public readonly port: number
	public readonly onPortAvailable: () => void

	private connectionTimer: any

	constructor(port: number, onPortAvailable: () => void) {
		this.port = port
		this.onPortAvailable = onPortAvailable
	}

	public start() {
		if (this.connectionTimer !== undefined) {
			return
		}

		const self = this
		this.connectionTimer = setInterval(() => {
			var net = require('net')
			var server = net.createServer()

			server.on('error', () => {
				self.stop()
				self.onPortAvailable()
			})
			server.on('listening', () => server.close())
			server.listen(self.port, '127.0.0.1')
		}, 100)
	}

	public stop() {
		clearInterval(this.connectionTimer)
		this.connectionTimer = undefined
	}
}