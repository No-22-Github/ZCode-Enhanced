import {
  Emitter,
  VSBuffer,
  SocketProtocol,
  ChannelClient,
  type IMessagePassingProtocol,
  type ISocket,
} from "@zcode/rpc";
import type { IServiceAccessor } from "@zcode/services";
import { RemoteServiceAccess } from "./remoteServiceAccess.js";

export interface WebSocketConnectionCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface WebSocketConnectionOptions {
  onClose?: (event: WebSocketConnectionCloseEvent) => void;
  onOpenSocket?: (socket: WebSocket) => void;
  timeoutMs?: number;
  createSocket?: (url: string) => WebSocket;
}

export interface WebSocketServiceConnection {
  ready: Promise<IServiceAccessor>;
  dispose(reason?: Error): void;
}

export function connectionClosedError(message = "WebSocket connection closed"): Error {
  const error = new Error(message);
  error.name = "ConnectionClosed";
  return error;
}

function wrapBrowserWebSocket(ws: WebSocket, fail: (error: Error) => void): ISocket {
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();

  ws.binaryType = "arraybuffer";
  const onMessage = (e: MessageEvent) => {
    onData.fire(VSBuffer.wrap(new Uint8Array(e.data as ArrayBuffer)));
  };
  ws.addEventListener("message", onMessage);

  return {
    onData: onData.event,
    onClose: onClose.event,
    onEnd: onEnd.event,
    write(buffer: VSBuffer) {
      // Bug 原因：旧实现对非 OPEN 静默丢包，RPC 永远等不到回复。
      // 写失败必须终结该代 client，统一 reject 全部挂起请求。
      if (ws.readyState !== 1) {
        fail(connectionClosedError());
        return;
      }
      try {
        ws.send(buffer.buffer as Uint8Array<ArrayBuffer>);
      } catch {
        fail(connectionClosedError("WebSocket write failed"));
      }
    },
    end() {
      ws.close();
    },
    drain() {
      return Promise.resolve();
    },
    dispose() {
      ws.removeEventListener("message", onMessage);
      onData.dispose();
      onClose.dispose();
      onEnd.dispose();
      ws.close();
    },
  };
}

export function createWebSocketServiceConnection(
  wsUrl: string,
  options: WebSocketConnectionOptions = {},
): WebSocketServiceConnection {
  const ws = (options.createSocket ?? ((url) => new WebSocket(url)))(wsUrl);
  let client: ChannelClient | undefined;
  let protocol: SocketProtocol | undefined;
  let socket: ISocket | undefined;
  let closed = false;
  let resolveReady!: (services: IServiceAccessor) => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<IServiceAccessor>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timer = setTimeout(
    () => finish(connectionClosedError("WebSocket initialization timed out")),
    options.timeoutMs ?? 10_000,
  );
  const finish = (reason = connectionClosedError(), event?: WebSocketConnectionCloseEvent) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    ws.removeEventListener("open", onOpen);
    ws.removeEventListener("error", onError);
    ws.removeEventListener("close", onClose);
    // Bug 原因：SocketProtocol 不传播 close；必须由连接 owner 主动清理 client。
    client?.dispose(reason);
    protocol?.dispose();
    socket?.dispose();
    if (!socket) ws.close();
    rejectReady(reason);
    options.onClose?.(event ?? { code: 1006, reason: reason.message, wasClean: false });
  };
  const onOpen = () => {
    if (closed) return;
    socket = wrapBrowserWebSocket(ws, finish);
    protocol = new SocketProtocol(socket);
    client = new ChannelClient(protocol);
    const services = new RemoteServiceAccess(client);
    client.onDidInitialize(() => {
      clearTimeout(timer);
      resolveReady(services);
    });
    options.onOpenSocket?.(ws);
  };
  const onError = () => finish(connectionClosedError("WebSocket connection failed"));
  const onClose = (event: CloseEvent) => finish(connectionClosedError(), event);
  ws.addEventListener("open", onOpen);
  ws.addEventListener("error", onError);
  ws.addEventListener("close", onClose);
  return { ready, dispose: finish };
}

export function connectViaWebSocket(
  wsUrl: string,
  options?: WebSocketConnectionOptions,
): Promise<IServiceAccessor> {
  return createWebSocketServiceConnection(wsUrl, options).ready;
}

export function connectViaProtocol(protocol: IMessagePassingProtocol): IServiceAccessor {
  const client = new ChannelClient(protocol);
  return new RemoteServiceAccess(client);
}
