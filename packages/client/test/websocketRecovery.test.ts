import assert from "node:assert/strict";
import test from "node:test";
import { ChannelServer, Emitter, SocketProtocol, VSBuffer } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";
import { createWebSocketServiceConnection } from "../src/websocket.js";
import { createReconnectingWebSocket } from "../src/reconnectingWebSocket.js";

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail("condition did not become true");
}

class SocketFixture extends EventTarget {
  readyState = 0;
  binaryType = "";
  writes = 0;
  blackhole = false;
  accepted = 0;
  server?: ChannelServer;
  readonly incoming = new Emitter<VSBuffer>();
  readonly closed = new Emitter<void>();
  readonly broadcast = new Emitter<unknown>();
  send(data: Uint8Array) {
    assert.equal(this.readyState, 1);
    this.writes++;
    if (!this.blackhole) this.incoming.fire(VSBuffer.wrap(data));
  }
  open(initialize = true) {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
    if (!initialize) return;
    const protocol = new SocketProtocol({
      onData: this.incoming.event,
      onClose: this.closed.event,
      onEnd: this.closed.event,
      write: (data) => {
        if (this.blackhole || this.readyState !== 1) return;
        this.dispatchEvent(
          new MessageEvent("message", {
            data: data.buffer.slice().buffer,
          }),
        );
      },
      end: () => {},
      drain: async () => {},
      dispose: () => {},
    });
    this.server = new ChannelServer(protocol, "fixture");
    this.server.registerChannel(ServiceChannels.System, {
      call: async () => ({ platform: "test", homedir: "/fixture" }),
      listen: () => this.broadcast.event,
    });
    this.server.registerChannel(ServiceChannels.Broadcast, {
      call: async (_ctx, _name, arg) => {
        this.broadcast.fire(arg[0]);
      },
      listen: () => this.broadcast.event,
    });
    this.server.registerChannel(ServiceChannels.ZCodeAgent, {
      call: async (_ctx, name) => {
        if (name === "queryConversationCommandsV4") return { accepted: this.accepted };
        this.accepted++;
        this.blackhole = true; // accepted command, lost ACK
        return { status: "accepted" };
      },
      listen: () => this.broadcast.event,
    });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closed.fire();
    this.server?.dispose();
    const event = Object.assign(new Event("close"), { code: 1006, reason: "", wasClean: false });
    this.dispatchEvent(event);
  }
}

test("single socket waits for Initialize, closes pending RPC and refuses later calls", async () => {
  const socket = new SocketFixture();
  let closes = 0;
  const connection = createWebSocketServiceConnection("ws://fixture/ws", {
    createSocket: () => socket as unknown as WebSocket,
    onClose: () => {
      closes++;
    },
  });
  socket.open();
  const services = await connection.ready;
  assert.equal((await services.systemService.info()).platform, "test");
  socket.blackhole = true;
  const pending = services.systemService.info();
  const failed = assert.rejects(pending, { name: "ConnectionClosed" });
  socket.close();
  await failed;
  await assert.rejects(services.systemService.info());
  connection.dispose();
  assert.equal(closes, 1);
});

test("OPEN without Initialize has a bounded deadline", async () => {
  const socket = new SocketFixture();
  const connection = createWebSocketServiceConnection("ws://fixture/ws", {
    createSocket: () => socket as unknown as WebSocket,
    timeoutMs: 10,
  });
  socket.open(false);
  await assert.rejects(connection.ready, /timed out/);
  assert.equal(socket.readyState, 3);
});

test("lost ACK and blackholed socket recover with new services, stable broadcast, no resend", async () => {
  const sockets: SocketFixture[] = [];
  const connection = createReconnectingWebSocket("ws://fixture/ws", {
    createSocket: () => {
      const socket = new SocketFixture();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket as unknown as WebSocket;
    },
    heartbeatIntervalMs: 10,
    probeTimeoutMs: 15,
    retryBaseMs: 5,
    retryMaxMs: 10,
  });
  try {
    connection.start();
    await until(() => connection.getSnapshot().status === "connected");
    const first = connection.getSnapshot().services!;
    const broadcasts: unknown[] = [];
    const listener = first.broadcastService.onMessage((message) => broadcasts.push(message));
    const pending = first.zcodeAgentService.sendConversationCommandV4({} as never);
    await assert.rejects(pending);
    await until(() => connection.getSnapshot().generation === 2);
    const second = connection.getSnapshot().services!;
    assert.notEqual(first.zcodeAgentService, second.zcodeAgentService);
    assert.equal(first.broadcastService, second.broadcastService);
    assert.equal(first.settingService, second.settingService);
    assert.equal(
      sockets.reduce((n, socket) => n + socket.accepted, 0),
      1,
    );
    await first.broadcastService.send({ channel: "test", payload: "rebound" });
    assert.deepEqual(broadcasts, [{ channel: "test", payload: "rebound" }]);
    listener.dispose();
  } finally {
    connection.dispose();
  }
});

test("offline pauses retries, online resumes once, foreground keeps healthy connection", async () => {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let online = false;
  const sockets: SocketFixture[] = [];
  const connection = createReconnectingWebSocket("ws://fixture/ws", {
    windowTarget,
    documentTarget,
    isOnline: () => online,
    createSocket: () => {
      const socket = new SocketFixture();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket as unknown as WebSocket;
    },
    heartbeatIntervalMs: 1000,
    retryBaseMs: 5,
  });
  connection.start();
  assert.equal(connection.getSnapshot().status, "offline");
  assert.equal(sockets.length, 0);
  online = true;
  windowTarget.dispatchEvent(new Event("online"));
  windowTarget.dispatchEvent(new Event("online"));
  await until(() => connection.getSnapshot().status === "connected");
  documentTarget.visibilityState = "hidden";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  documentTarget.visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  windowTarget.dispatchEvent(new Event("pageshow"));
  await delay(10);
  assert.equal(sockets.length, 1);
  connection.dispose();
  windowTarget.dispatchEvent(new Event("online"));
  await delay(10);
  assert.equal(sockets.length, 1);
});

test("initial error retries and stale socket events cannot replace a newer generation", async () => {
  const sockets: SocketFixture[] = [];
  const connection = createReconnectingWebSocket("ws://fixture/ws", {
    createSocket: () => {
      const socket = new SocketFixture();
      sockets.push(socket);
      queueMicrotask(() =>
        sockets.length === 1 ? socket.dispatchEvent(new Event("error")) : socket.open(),
      );
      return socket as unknown as WebSocket;
    },
    retryBaseMs: 5,
    retryMaxMs: 10,
  });
  try {
    connection.start();
    await until(() => connection.getSnapshot().status === "connected");
    const generation = connection.getSnapshot().generation;
    const services = connection.getSnapshot().services;
    sockets[0].open();
    sockets[0].dispatchEvent(new Event("error"));
    assert.equal(connection.getSnapshot().services, services);
    assert.equal(connection.getSnapshot().generation, generation);
    assert.equal(sockets.length, 2);
  } finally {
    connection.dispose();
  }
});

test("foreground immediately replaces a probe whose wall deadline expired while suspended", async () => {
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const sockets: SocketFixture[] = [];
  const connection = createReconnectingWebSocket("ws://fixture/ws", {
    documentTarget,
    createSocket: () => {
      const socket = new SocketFixture();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket as unknown as WebSocket;
    },
    probeTimeoutMs: 1000,
    heartbeatIntervalMs: 5000,
  });
  const now = Date.now;
  try {
    connection.start();
    await until(() => connection.getSnapshot().status === "connected");
    sockets[0].blackhole = true;
    connection.retry();
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    // Simulate suspended timers with wall time advanced; no timer callback has run yet.
    Date.now = () => now() + 2000;
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    assert.equal(sockets.length, 2);
    await until(() => connection.getSnapshot().generation === 2);
  } finally {
    Date.now = now;
    connection.dispose();
  }
});

test("dispose during initialization rejects ready and removes all retry work", async () => {
  const socket = new SocketFixture();
  const connection = createWebSocketServiceConnection("ws://fixture/ws", {
    createSocket: () => socket as unknown as WebSocket,
  });
  const rejected = assert.rejects(connection.ready, { name: "ConnectionClosed" });
  connection.dispose();
  socket.open();
  await rejected;
  assert.equal(socket.writes, 0);
});
