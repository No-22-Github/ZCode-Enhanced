# Browser service connection lifecycle

`createWebSocketServiceConnection(url, options)` owns a single socket, SocketProtocol and
ChannelClient. Its `ready` promise resolves after RPC Initialize. `dispose()` and transport
failure reject pending calls and release listeners. The optional close callback runs once.
`connectViaWebSocket` preserves the existing one-shot accessor API.

`createReconnectingWebSocket(url, options)` owns browser connection generations. Consumers
subscribe to immutable snapshots and read `status`, `generation`, `services`. Call `start()`
once and `dispose()` when the page owner ends. `retry()` checks the active socket or accelerates
the next attempt. Browser visibility/online/pageshow and timed probes use the same path.

Each ready generation creates a fresh service accessor; consumers must replace their service
dependencies and connection-scoped subscriptions. Broadcast and settings have stable facades
within this one server URL, so global subscriptions and the existing settings cache retain
their identity. Accessor changes still trigger Root's settings refresh. Neither facade owns a
second cache or buffers writes; disconnected calls reject.
Business RPCs are never queued/replayed. Command IDs and result reconciliation belong to
the existing UI/runtime command contract. Desktop MessagePort delivery is unaffected.

Example:

```ts
const connection = createReconnectingWebSocket(url);
const unsubscribe = connection.subscribe(() => render(connection.getSnapshot()));
connection.start();
// On page teardown:
unsubscribe();
connection.dispose();
```
