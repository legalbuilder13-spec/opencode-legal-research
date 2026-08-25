import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { OAUTH_DUMMY_KEY } from "../../auth"
import os from "os"
import { OpenAIWebSocketPool } from "./ws-pool"
import { connect, type Client } from "@legalbuilder/codex-app-server-spike"

const ALLOWED_MODELS = new Set(["gpt-5.5", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini"])
const DISALLOWED_MODELS = new Set(["gpt-5.5-pro"])

interface CodexAuthPluginOptions {
  experimentalWebSockets?: boolean
  appServerCommand?: string[]
}

const APP_SERVER_AUTH_MARKER = "codex-app-server-managed"

export async function CodexAuthPlugin(_input: PluginInput, options: CodexAuthPluginOptions = {}): Promise<Hooks> {
  let websocketFetchInstalled = false
  const websocketFetches: Array<ReturnType<typeof OpenAIWebSocketPool.createWebSocketFetch>> = []
  const loginClients = new Set<Client>()

  async function authorizeWithAppServer(type: "chatgpt" | "chatgptDeviceCode") {
    const client = await connect({
      command: options.appServerCommand,
      requireSubscription: false,
      env: { OPENAI_API_KEY: undefined },
    })
    loginClients.add(client)
    const login = await client.startLogin(type)
    const url = login.authUrl ?? login.verificationUrl
    if (!url) {
      loginClients.delete(client)
      await client.close()
      throw new Error("Codex app-server did not return a login URL")
    }

    return {
      url,
      instructions: login.userCode
        ? `Enter code: ${login.userCode}. Codex app-server will keep and refresh the subscription credentials.`
        : "Complete authorization in your browser. Codex app-server will keep and refresh the subscription credentials.",
      method: "auto" as const,
      callback: async () => {
        try {
          const completed = await client.waitForLogin(login)
          if (!completed.success) return { type: "failed" as const }
          return {
            type: "success" as const,
            refresh: APP_SERVER_AUTH_MARKER,
            access: APP_SERVER_AUTH_MARKER,
            expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
          }
        } finally {
          loginClients.delete(client)
          await client.close()
        }
      },
    }
  }

  return {
    async dispose() {
      for (const websocketFetch of websocketFetches) websocketFetch.close()
      websocketFetches.length = 0
      await Promise.allSettled([...loginClients].map((client) => client.close()))
      loginClients.clear()
    },
    async event(input) {
      if (input.event.type !== "session.deleted") return
      for (const websocketFetch of websocketFetches) websocketFetch.remove(input.event.properties.info.id)
    },
    provider: {
      id: "openai",
      async models(provider, ctx) {
        if (ctx.auth?.type !== "oauth") return provider.models

        return Object.fromEntries(
          Object.entries(provider.models)
            .filter(([, model]) => {
              if (model.options.reasoningMode === "pro") return false
              if (ALLOWED_MODELS.has(model.api.id)) return true
              if (DISALLOWED_MODELS.has(model.api.id)) return false
              if (model.api.id === "gpt-5.6") return false
              const match = model.api.id.match(/^gpt-(\d+\.\d+)/)
              return match ? parseFloat(match[1]) > 5.4 : false
            })
            .map(([modelID, model]) => [
              modelID,
              {
                ...model,
                cost: {
                  input: 0,
                  output: 0,
                  cache: { read: 0, write: 0 },
                },
                limit:
                  model.id.includes("gpt-5.5") || model.id.includes("gpt-5.6")
                    ? {
                        context: 400_000,
                        input: 272_000,
                        output: 128_000,
                      }
                    : model.limit,
              },
            ]),
        )
      },
    },
    auth: {
      provider: "openai",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type === "oauth") {
          // Subscription credentials live exclusively in Codex app-server. The
          // dummy key satisfies provider catalog construction; session/llm.ts
          // routes every OpenAI OAuth request to CodexAppServerRuntime before
          // the AI SDK can perform network I/O.
          return { apiKey: OAUTH_DUMMY_KEY }
        }
        const websocketFetch = options.experimentalWebSockets
          ? OpenAIWebSocketPool.createWebSocketFetch({ httpFetch: fetch })
          : undefined
        if (websocketFetch) {
          websocketFetches.push(websocketFetch)
          websocketFetchInstalled = true
        }
        return websocketFetch ? { fetch: websocketFetch } : {}
      },
      methods: [
        {
          label: "ChatGPT subscription (Codex app-server)",
          type: "oauth",
          authorize: () => authorizeWithAppServer("chatgpt"),
        },
        {
          label: "ChatGPT subscription (device code)",
          type: "oauth",
          authorize: () => authorizeWithAppServer("chatgptDeviceCode"),
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
    "chat.headers": async (input, output) => {
      if (input.model.providerID !== "openai") return
      output.headers.originator = "opencode"
      output.headers["User-Agent"] = `opencode/${InstallationVersion} (${os.platform()} ${os.release()}; ${os.arch()})`
      output.headers["session-id"] = input.sessionID
      // Temporary fetch-layer hack: title generation currently shares the conversation
      // session ID, so the OpenAI plugin marks it for HTTP fallback until transport
      // context can be passed directly instead of smuggled through headers.
      if (websocketFetchInstalled && input.agent === "title") output.headers[OpenAIWebSocketPool.TITLE_HEADER] = "true"
    },
    "chat.params": async (input, output) => {
      if (input.model.providerID !== "openai") return
      // Match codex cli
      output.maxOutputTokens = undefined
    },
  }
}
