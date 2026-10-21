// v10.3.2 : helper pour brancher un WebSocket sur la cible DevTools d'une page,
// sans jongler avec sock.url manuellement.
export class WSURL {
  constructor(url, onOpen) {
    this.url = url
    this.ws = new WebSocket(url)
    this.ws.binaryType = "arraybuffer"
    if (onOpen) this.ws.onopen = onOpen
  }
  get readyState() { return this.ws.readyState }
  send(data) { this.ws.send(data) }
  onmessage(fn) { this.ws.onmessage = fn }
  once(fn) { this.ws.once("message", fn) }
}
