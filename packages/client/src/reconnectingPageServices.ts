import { Emitter, type IDisposable } from "@zcode/rpc";
import type {
  BroadcastMessage,
  IBroadcastService,
  IServiceAccessor,
  ISettingService,
} from "@zcode/services";
import { connectionClosedError } from "./websocket.js";

/** 保留同服务器的全局订阅和设置缓存身份；facade 不存事实、不排队写操作。 */
export function createReconnectingPageServices() {
  const messages = new Emitter<BroadcastMessage>();
  let current: IServiceAccessor | null = null;
  let upstream: IDisposable | undefined;
  const requireCurrent = () => {
    if (!current) throw connectionClosedError();
    return current;
  };
  const broadcastService: IBroadcastService = {
    send: async (message) => requireCurrent().broadcastService.send(message),
    acquireClaim: async (key) => requireCurrent().broadcastService.acquireClaim(key),
    commitClaim: async (lease) => requireCurrent().broadcastService.commitClaim(lease),
    releaseClaim: async (lease) => requireCurrent().broadcastService.releaseClaim(lease),
    tryClaim: async (key) => requireCurrent().broadcastService.tryClaim(key),
    onMessage: messages.event,
  };
  // Bug 原因：setting proxy 换代让 useSettings 的 owner cache 变空，onboarding 随即
  // 卸载工作区/编辑器。仅稳定同 URL 的 settings 身份，由 Root 原刷新入口重读新连接。
  const settingService: ISettingService = {
    get: async () => requireCurrent().settingService.get(),
    update: async (...args) => requireCurrent().settingService.update(...args),
    updateDataBaseDir: async (path) => requireCurrent().settingService.updateDataBaseDir(path),
    ensureDefaultProject: async (path) =>
      requireCurrent().settingService.ensureDefaultProject(path),
  };
  return {
    services: { broadcastService, settingService },
    replace(next: IServiceAccessor | null) {
      upstream?.dispose();
      upstream = undefined;
      current = next;
      if (next) upstream = next.broadcastService.onMessage((message) => messages.fire(message));
    },
    dispose() {
      upstream?.dispose();
      current = null;
      messages.dispose();
    },
  };
}
