// oxlint-disable typescript-eslint/no-unsafe-type-assertion -- focused partial plugin fixtures
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { CodexAuthPlugin } from "../../src/plugin/openai/codex"

describe("plugin.codex", () => {
  test("delegates ChatGPT login and credential refresh ownership to Codex app-server", async () => {
    const fixture = fileURLToPath(new URL("../../../codex-app-server/test/fixture/fake-app-server.ts", import.meta.url))
    const hooks = await CodexAuthPlugin({} as never, {
      appServerCommand: [process.execPath, fixture, "app-server"],
    })
    const method = hooks.auth!.methods[0]
    if (method.type !== "oauth") throw new Error("Expected subscription OAuth method")

    const pending = await method.authorize({} as never)
    expect(method.label).toBe("ChatGPT subscription (Codex app-server)")
    expect(pending.url).toContain("example.com/login")
    expect(pending.instructions).toContain("app-server will keep and refresh")
    expect(await pending.callback({} as never)).toMatchObject({
      type: "success",
      refresh: "codex-app-server-managed",
      access: "codex-app-server-managed",
    })
    await hooks.dispose?.()
  })

  test("does not expose a direct HTTP transport for subscription credentials", async () => {
    const hooks = await CodexAuthPlugin({} as never, { experimentalWebSockets: true })
    const loaded = await hooks.auth!.loader!(
      async () => ({ type: "oauth", refresh: "stale", access: "stale", expires: 0 }) as never,
      {} as never,
    )

    expect(loaded.apiKey).toBeDefined()
    expect(loaded.fetch).toBeUndefined()
    await hooks.dispose?.()
  })

  test("keeps the optional WebSocket transport for API-key OpenAI", async () => {
    const disabled = await CodexAuthPlugin({} as never)
    const enabled = await CodexAuthPlugin({} as never, { experimentalWebSockets: true })

    const disabledOptions = await disabled.auth!.loader!(
      async () => ({ type: "api", key: "sk-test" }) as never,
      {} as never,
    )
    const enabledOptions = await enabled.auth!.loader!(
      async () => ({ type: "api", key: "sk-test" }) as never,
      {} as never,
    )

    expect(disabledOptions.fetch).toBeUndefined()
    expect(enabledOptions.fetch).toBeFunction()
    await enabled.dispose?.()
  })

  test("filters unsupported modes and uses Codex context limits for subscription models", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const limit = { context: 1_050_000, input: 922_000, output: 128_000 }
    const provider = {
      models: {
        ...Object.fromEntries(
          ["gpt-5.4", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.7-pro"].map((id) => [
            id,
            { id, api: { id }, limit, cost: {}, options: {} },
          ]),
        ),
        "gpt-5.4-pro": {
          id: "gpt-5.4-pro",
          api: { id: "gpt-5.4" },
          limit,
          cost: {},
          options: { reasoningMode: "pro" },
        },
        "gpt-5.6-sol-high": {
          id: "gpt-5.6-sol-high",
          api: { id: "gpt-5.6-sol" },
          limit,
          cost: {},
          options: { reasoningEffort: "high" },
        },
      },
    }

    const models = await hooks.provider!.models!(provider as never, { auth: { type: "oauth" } } as never)

    expect(models["gpt-5.4"]?.limit).toEqual(limit)
    expect(models["gpt-5.5"]?.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(models["gpt-5.6-sol"]?.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(models["gpt-5.6-terra"]?.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(models["gpt-5.6-luna"]?.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(models["gpt-5.4-pro"]).toBeUndefined()
    expect(models["gpt-5.7-pro"]).toBeDefined()
    expect(models["gpt-5.6-sol-high"]).toBeDefined()
    expect(await hooks.provider!.models!(provider as never, { auth: { type: "api" } } as never)).toBe(
      provider.models as never,
    )
  })
})
