import type {
  UsageApiAuthorization,
  UsageApiAuthorizationRequest,
} from "./providers/bigmodelUsageQuotaProvider.js";
import {
  buildBigModelApiUrl,
  buildRuntimeZaiBusinessUrl,
  isCodingPlanModelProviderId,
  isStartPlanModelProviderId,
  resolveModelProviderFamilyIdByBaseURL,
} from "@zcode/shared";

const BIGMODEL_QUOTA_PATH = "/api/monitor/usage/quota/limit";

/**
 * 结构化的 Provider Registry 引用。这里只消费额度解析需要的字段，
 * 不 import @zcode/provider 的完整 Registry 类型，保持 usage-stats 域可单测。
 */
export interface QuotaApiKeyProviderRef {
  readonly providerId: string;
  readonly providerName?: string | null;
  readonly config: {
    readonly access?:
      | { readonly type: string; readonly apiKey?: string | null | undefined }
      | null
      | undefined;
    readonly api?: { readonly baseUrl?: string | null | undefined } | null | undefined;
  };
}

export interface ApiKeyProviderQuotaAuthorizationResolverOptions {
  resolveProvider: (providerId: string) => QuotaApiKeyProviderRef | undefined;
  env?: NodeJS.ProcessEnv;
}

function isManualApiKeyAccess(access: { readonly type: string } | null | undefined): boolean {
  // zhipu-coding-plan-api-key 是用户手动粘贴官方套餐 Key 的预置形态；
  // 两者都表示凭据由用户直填，而不是 OAuth 账号连接。
  return access?.type === "api-key" || access?.type === "zhipu-coding-plan-api-key";
}

/**
 * 为持有官方 Plan Key 的普通 API Key provider 解析额度查询凭据。
 *
 * Coding Plan 的 quota/limit 端点接受套餐 API Key 直接鉴权（与账号连接复制出的
 * Plan Key 同一凭据体系）。用户把套餐控制台复制的 Key 手动填进普通 provider 时，
 * 该 resolver 让 entitlement 快照（5 小时窗口 / 每周 / 月度额度）继续可用。
 *
 * 边界：
 * - 只放行手动 API Key access；Account provider 由 coding plan 分支处理，不得劫持。
 * - 只放行 baseURL 命中 Z.ai / BigModel 官方域名的 provider；第三方代理域名
 *   不能证明 Key 属于官方套餐，也绝不把用户 Key 发往未配置的域名。
 */
export function createApiKeyProviderQuotaAuthorizationResolver(
  options: ApiKeyProviderQuotaAuthorizationResolverOptions,
): (request: UsageApiAuthorizationRequest) => Promise<UsageApiAuthorization | null> {
  const env = options.env ?? process.env;
  return async (request) => {
    const providerId = request.preferredProviderId?.trim() ?? "";
    if (!providerId) {
      return null;
    }
    if (
      isCodingPlanModelProviderId(providerId) ||
      isStartPlanModelProviderId(providerId)
    ) {
      return null;
    }
    const provider = options.resolveProvider(providerId);
    if (!provider) {
      return null;
    }
    if (!isManualApiKeyAccess(provider.config.access)) {
      return null;
    }
    const apiKey = provider.config.access?.apiKey?.trim() ?? "";
    if (!apiKey) {
      return null;
    }
    const family = resolveModelProviderFamilyIdByBaseURL(provider.config.api?.baseUrl);
    if (!family) {
      return null;
    }
    return {
      authorization: apiKey,
      quotaUrl:
        family === "zai"
          ? buildRuntimeZaiBusinessUrl(env, BIGMODEL_QUOTA_PATH)
          : buildBigModelApiUrl(env, BIGMODEL_QUOTA_PATH),
      provider: {
        id: provider.providerId,
        name: provider.providerName?.trim() || provider.providerId,
      },
    };
  };
}
