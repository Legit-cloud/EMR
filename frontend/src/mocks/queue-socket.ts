/**
 * A stand-in for the browser WebSocket, for tests and for developing the queue without a
 * backend: `vi.stubGlobal("WebSocket", MockWebSocket)`. It never touches the network. Tests
 * (or a developer in the console) drive it: `open()`, `receive(...)`, `drop()`.
 */
export class MockWebSocket {
  static instances: MockWebSocket[] = [];

  /** The most recent connection, which is the one the screen is using. */
  static get latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /** The server accepted the connection. */
  open(): void {
    this.onopen?.(new Event("open"));
  }

  /** The server sent a queue (or any message). */
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  /** The connection was lost, or the server closed it with `code`. */
  drop(code = 1006): void {
    this.closed = true;
    this.onclose?.({ code } as CloseEvent);
  }

  close(): void {
    this.closed = true;
  }
}
