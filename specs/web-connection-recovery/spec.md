# Web connection recovery

## Scope and ownership

Server-deployed Web clients own one reconnecting WebSocket connection manager per page.
It owns connection generation, retry/probe timers, lifecycle listeners and connection status.
Each successful generation publishes a fresh service accessor so connection-scoped V4
handshakes, conversation and sessions-index subscriptions are rebuilt by their existing owners.
The React application stays mounted: tabs, editor state and unsent drafts survive recovery.
Broadcast and settings are stable forwarding services scoped to this one server URL. The
global Zustand store captures broadcast once; its upstream event subscription is rebound
exactly once per generation. Settings identity keeps the existing per-service settings cache:
discarding it during reconnect makes onboarding temporarily unmount the entire workspace.
Root's existing refresh reloads settings after the accessor generation changes. These facades
store no server facts, never retry writes, and reject while disconnected.

Server/runtime remain the sole owners of accepted commands and sessions. Browser transport
never buffers or retries business RPCs. Existing pending-command registry and query/reconcile
paths resolve uncertain command outcomes after subscriptions become live. A lost ACK is not
evidence that a command was rejected, and must not trigger an automatic resend.

## Contract and event order

`@zcode/client.createWebSocketServiceConnection` exposes ready/services lifecycle and dispose.
Ready means RPC Initialize received; open alone is insufficient. Close, error, failed write,
initialization timeout and explicit disposal reject all pending calls and detach the old socket.
`connectViaWebSocket` remains the one-shot compatibility entrypoint; desktop MessagePort
connections and desktop-continuous stream semantics are unchanged.

`@zcode/client.createReconnectingWebSocket` exposes start, dispose, retry, getSnapshot and
subscribe. A snapshot includes status, generation and the latest services (null before first
success). Failed attempts cannot publish services. Only one attempt/probe/retry is live at once.

```text
Web lifecycle/heartbeat -> connection manager -> dispose old RPC generation
                                             -> bounded reconnect + same-socket RPC probe
                                             -> new services -> existing UI subscription owners
                                                            -> V4 handshake + snapshot/resume
                                                            -> existing command query reconciliation
Desktop continuous -> existing transport -> unchanged runtime/owner/lease
```

## Product rules

- Connect and Initialize have a 10s deadline; same-socket `system.info()` probes have an 8s
  deadline. Healthy visible connections are probed every 15s. HTTP reachability is not proof
  that the business socket is alive. No new server API or wire protocol is required.
- Retry indefinitely with jittered exponential backoff capped at 15s; offline pauses attempts.
  Online, pageshow and hidden-to-visible trigger immediate recovery/probe. A probe whose wall
  deadline expired while backgrounded is failed immediately on resume, not extended.
- UI shows connecting/offline/reconnecting and a retry button. Previously mounted app and
  editor remain present. Calls on a dead generation reject promptly so sending cannot hang.
- Retry requests and repeated foreground events coalesce; stale opens, messages, probe
  results and close callbacks never overwrite a newer generation. Disposal stops all timers
  and removes browser listeners. Authentication failures remain visible as connection failure;
  no credential or complete WebSocket URL is logged.
- First-load connection failures retry too. Successful recovery uses the existing workspace
  identity and current UI selection, without rerunning startup selection or reloading the page.
- An uncertain send keeps its draft and existing command-recovery record. Recovery does not
  automatically reissue commands or pretend unknown outcomes were failures.

## Acceptance and evidence

1. Close/error during RPC: current and subsequent calls reject; no closed-socket writes.
2. OPEN without Initialize and blackholed OPEN connection: bounded failure and auto-retry.
3. Initial failure and repeated failures: eventual successful generation without reload;
   backoff bounded, repeated events never create concurrent attempts.
4. Mobile hidden/visible and pageshow: healthy socket retained; expired probe replaced;
   offline/online resumes immediately. Late results from old generations ignored.
5. React integration: draft/tab state preserved, status visible in mobile and desktop widths,
   events and calls use new services after recovery; global broadcast still works.
6. Lost command ACK: request rejects, no automatic duplicate command, existing command query
   can observe server acceptance after recovery. Active conversation and sessions-index
   resubscribe via new service identity; no stale frame updates.
7. Desktop one-shot/MessagePort remain compatible. Run focused tests, browser fault-injection
   scenarios, typecheck, lint and changed architecture check. Real phone OS suspension is
   separately reported from browser lifecycle simulation.
