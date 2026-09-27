import { useSyncExternalStore, type ReactNode } from "react";
import { Button, ZCodeIntlProvider, useZCodeIntl } from "@zcode/ui";
import type { ReconnectingWebSocket, WebConnectionSnapshot } from "@zcode/client";

type WebServices = NonNullable<WebConnectionSnapshot["services"]>;

function ConnectionNotice({
  connection,
  status,
}: {
  connection: ReconnectingWebSocket;
  status: WebConnectionSnapshot["status"];
}) {
  const { intl } = useZCodeIntl();
  if (status === "connected" || status === "disposed") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="web-connection-status"
      className="fixed top-2 left-1/2 z-[200] flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-ui-sm text-foreground shadow-lg"
    >
      <span>{intl.formatMessage({ id: `web.connection.${status}` })}</span>
      <Button size="sm" variant="outline" onClick={connection.retry}>
        {intl.formatMessage({ id: "common.retry" })}
      </Button>
    </div>
  );
}

/** 保留同一棵 React 树，只替换服务依赖；不能用 generation key 重挂载编辑器和标签页。 */
export function WebConnectionBoundary({
  connection,
  children,
}: {
  connection: ReconnectingWebSocket;
  children: (services: WebServices) => ReactNode;
}) {
  const snapshot = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  return (
    <ZCodeIntlProvider
      settingService={snapshot.services?.settingService}
      broadcastService={snapshot.services?.broadcastService}
    >
      <ConnectionNotice connection={connection} status={snapshot.status} />
      {snapshot.services ? children(snapshot.services) : null}
    </ZCodeIntlProvider>
  );
}
