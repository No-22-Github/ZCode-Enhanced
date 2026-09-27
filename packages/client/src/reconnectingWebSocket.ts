import type { IServiceAccessor } from "@zcode/services";
import {
  connectionClosedError,
  createWebSocketServiceConnection,
  type WebSocketServiceConnection,
  type WebSocketConnectionOptions,
} from "./websocket.js";
import { createReconnectingPageServices } from "./reconnectingPageServices.js";

export interface WebConnectionSnapshot {
  status: "connecting" | "connected" | "reconnecting" | "offline" | "disposed";
  generation: number;
  services: IServiceAccessor | null;
}

interface ReconnectingWebSocketOptions extends Pick<
  WebSocketConnectionOptions,
  "createSocket" | "timeoutMs"
> {
  heartbeatIntervalMs?: number;
  probeTimeoutMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  windowTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget?: Pick<Document, "addEventListener" | "removeEventListener"> & {
    readonly visibilityState: string;
  };
  isOnline?: () => boolean;
}

/** Web 页面的唯一连接 owner；不缓存/重发业务命令，不修改 runtime 生命周期。 */
export function createReconnectingWebSocket(
  wsUrl: string,
  options: ReconnectingWebSocketOptions = {},
) {
  const windowTarget = options.windowTarget ?? (typeof window === "undefined" ? undefined : window);
  const documentTarget =
    options.documentTarget ?? (typeof document === "undefined" ? undefined : document);
  const isOnline =
    options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const listeners = new Set<() => void>();
  const pageServices = createReconnectingPageServices();
  let snapshot: WebConnectionSnapshot = { status: "connecting", services: null, generation: 0 };
  let active: WebSocketServiceConnection | null = null;
  let activeServices: IServiceAccessor | null = null;
  let started = false;
  let disposed = false;
  let epoch = 0;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let probeDeadline = 0;
  let probing = false;

  const publish = (update: Partial<WebConnectionSnapshot>) => {
    snapshot = { ...snapshot, ...update };
    for (const listener of listeners) listener();
  };
  const clearTimers = () => {
    clearTimeout(retryTimer);
    clearTimeout(heartbeatTimer);
    clearTimeout(probeTimer);
    retryTimer = heartbeatTimer = probeTimer = undefined;
    probing = false;
  };
  const scheduleHeartbeat = () => {
    clearTimeout(heartbeatTimer);
    if (documentTarget?.visibilityState === "hidden") return;
    heartbeatTimer = setTimeout(probe, options.heartbeatIntervalMs ?? 15_000);
  };
  const disconnect = () => {
    epoch++;
    clearTimers();
    const previous = active;
    active = null;
    activeServices = null;
    pageServices.replace(null);
    previous?.dispose(connectionClosedError());
  };
  const failed = (failedEpoch: number) => {
    if (disposed || failedEpoch !== epoch) return;
    disconnect();
    publish({ status: isOnline() ? "reconnecting" : "offline" });
    if (!isOnline()) return;
    const cap = options.retryMaxMs ?? 15_000;
    const backoff = Math.min(cap, (options.retryBaseMs ?? 500) * 2 ** Math.min(failures++, 8));
    retryTimer = setTimeout(connect, backoff * (0.8 + Math.random() * 0.2));
  };
  function probe() {
    if (disposed || !activeServices || probing) return;
    probing = true;
    clearTimeout(heartbeatTimer);
    const probingEpoch = epoch;
    probeDeadline = Date.now() + (options.probeTimeoutMs ?? 8_000);
    probeTimer = setTimeout(() => failed(probingEpoch), options.probeTimeoutMs ?? 8_000);
    // 同一业务 socket 的轻量 RPC 同时验证双向传输与 ChannelServer，不用 HTTP 假冒在线。
    void activeServices.systemService.info().then(
      () => {
        if (disposed || epoch !== probingEpoch) return;
        clearTimeout(probeTimer);
        probing = false;
        if (snapshot.status !== "connected") {
          failures = 0;
          pageServices.replace(activeServices!);
          publish({
            status: "connected",
            generation: snapshot.generation + 1,
            services: { ...activeServices!, ...pageServices.services },
          });
        }
        scheduleHeartbeat();
      },
      () => failed(probingEpoch),
    );
  }
  function connect() {
    if (disposed || active) return;
    clearTimeout(retryTimer);
    if (!isOnline()) {
      publish({ status: "offline" });
      return;
    }
    publish({ status: snapshot.services ? "reconnecting" : "connecting" });
    const connectingEpoch = ++epoch;
    try {
      active = createWebSocketServiceConnection(wsUrl, {
        createSocket: options.createSocket,
        timeoutMs: options.timeoutMs,
        onClose: () => failed(connectingEpoch),
      });
      void active.ready.then(
        (services) => {
          if (disposed || epoch !== connectingEpoch) return;
          activeServices = services;
          probe();
        },
        () => failed(connectingEpoch),
      );
    } catch {
      failed(connectingEpoch);
    }
  }
  const retry = () => {
    if (!started || disposed) return;
    if (!isOnline()) {
      disconnect();
      publish({ status: "offline" });
      return;
    }
    if (!active) {
      connect();
      return;
    }
    // 手机后台会冻结 timer；回前台必须按墙钟判断已过期的探活，不能重新续期。
    if (probing && Date.now() >= probeDeadline) {
      disconnect();
      connect();
    } else {
      probe();
    }
  };
  const visibility = () => {
    if (documentTarget?.visibilityState === "hidden") clearTimeout(heartbeatTimer);
    else retry();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started || disposed) return;
      started = true;
      windowTarget?.addEventListener("online", retry);
      windowTarget?.addEventListener("offline", retry);
      windowTarget?.addEventListener("pageshow", retry);
      documentTarget?.addEventListener("visibilitychange", visibility);
      connect();
    },
    retry,
    dispose() {
      if (disposed) return;
      disposed = true;
      disconnect();
      windowTarget?.removeEventListener("online", retry);
      windowTarget?.removeEventListener("offline", retry);
      windowTarget?.removeEventListener("pageshow", retry);
      documentTarget?.removeEventListener("visibilitychange", visibility);
      pageServices.dispose();
      publish({ status: "disposed" });
      listeners.clear();
    },
  };
}

export type ReconnectingWebSocket = ReturnType<typeof createReconnectingWebSocket>;
