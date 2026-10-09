import assert from "node:assert/strict";
import test from "node:test";
import {
  createApiKeyProviderQuotaAuthorizationResolver,
  type QuotaApiKeyProviderRef,
} from "../src/usage-stats/apiKeyProviderQuotaAuthorization.js";
import { isCodingPlanModelProviderId } from "@zcode/shared";

function buildProvider(overrides: Partial<QuotaApiKeyProviderRef> = {}): QuotaApiKeyProviderRef {
  return {
    providerId: "my-zai",
    providerName: "Z.ai",
    config: {
      access: { type: "api-key", apiKey: "sk-plan-key" },
      api: { baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    },
    ...overrides,
  };
}

test("manual api-key provider on official domain resolves plan quota authorization", async () => {
  const resolver = createApiKeyProviderQuotaAuthorizationResolver({
    resolveProvider: (providerId) =>
      providerId === "my-zai" ? buildProvider() : undefined,
    env: {},
  });
  const resolved = await resolver({
    preferredProviderId: "my-zai",
    requirePreferredProvider: true,
  });
  assert.ok(resolved);
  assert.equal(resolved.authorization, "sk-plan-key");
  assert.equal(resolved.provider.id, "my-zai");
  assert.equal(resolved.provider.name, "Z.ai");
  assert.ok(resolved.quotaUrl.includes("/api/monitor/usage/quota/limit"));
  // bigmodel 域名命中 bigmodel 端点
  assert.ok(resolved.quotaUrl.includes("bigmodel.cn"));
});

test("zai domain provider resolves to zai business quota endpoint", async () => {
  const resolver = createApiKeyProviderQuotaAuthorizationResolver({
    resolveProvider: () =>
      buildProvider({
        config: {
          access: { type: "zhipu-coding-plan-api-key", apiKey: " sk-zai-plan-key " },
          api: { baseUrl: "https://api.z.ai/api/paas/v4" },
        },
      }),
    env: {},
  });
  const resolved = await resolver({
    preferredProviderId: "my-zai",
    requirePreferredProvider: true,
  });
  assert.ok(resolved);
  // apiKey 原样透传给 monitor 鉴权头（监控端点不加 Bearer），但空白必须裁掉
  assert.equal(resolved.authorization, "sk-zai-plan-key");
  assert.ok(resolved.quotaUrl.includes("z.ai"));
});

test("builtin coding plan provider ids are never hijacked by the api-key resolver", async () => {
  assert.ok(isCodingPlanModelProviderId("account:zai-individual-coding-plan"));
  const resolver = createApiKeyProviderQuotaAuthorizationResolver({
    resolveProvider: () => buildProvider(),
    env: {},
  });
  const resolved = await resolver({
    preferredProviderId: "account:zai-individual-coding-plan",
    requirePreferredProvider: true,
  });
  assert.equal(resolved, null);
});

test("non-official base URLs and missing keys are rejected", async () => {
  const proxyResolver = createApiKeyProviderQuotaAuthorizationResolver({
    resolveProvider: () =>
      buildProvider({
        config: {
          access: { type: "api-key", apiKey: "sk-reseller-key" },
          api: { baseUrl: "https://proxy.example.com/v4" },
        },
      }),
    env: {},
  });
  assert.equal(
    await proxyResolver({ preferredProviderId: "my-zai", requirePreferredProvider: true }),
    null,
  );

  const emptyKeyResolver = createApiKeyProviderQuotaAuthorizationResolver({
    resolveProvider: () =>
      buildProvider({
        config: {
          access: { type: "api-key", apiKey: "   " },
          api: { baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
        },
      }),
    env: {},
  });
  assert.equal(
    await emptyKeyResolver({ preferredProviderId: "my-zai", requirePreferredProvider: true }),
    null,
  );
});

test("zhipu-account access and unknown providers are rejected", async () => {
  const accountResolver = createApiKeyProviderQuotaAuthorizationResolver({
    resolveProvider: () =>
      buildProvider({
        config: {
          access: { type: "zhipu-account", apiKey: null },
          api: { baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
        },
      }),
    env: {},
  });
  assert.equal(
    await accountResolver({ preferredProviderId: "my-zai", requirePreferredProvider: true }),
    null,
  );

  const missingResolver = createApiKeyProviderQuotaAuthorizationResolver({
    resolveProvider: () => undefined,
    env: {},
  });
  assert.equal(
    await missingResolver({ preferredProviderId: "ghost", requirePreferredProvider: true }),
    null,
  );

  const emptyIdResolver = createApiKeyProviderQuotaAuthorizationResolver({
    resolveProvider: () => buildProvider(),
    env: {},
  });
  assert.equal(
    await emptyIdResolver({ preferredProviderId: "  ", requirePreferredProvider: true }),
    null,
  );
});
