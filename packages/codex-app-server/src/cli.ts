import { connect } from "./client"
import { inspect, parseManifest, verify } from "./inspect"

async function main() {
  const [command = "help", ...args] = Bun.argv.slice(2)
  if (command === "inspect") {
    console.log(JSON.stringify(await inspect(), null, 2))
    return
  }
  if (command === "verify") {
    const path = args[0]
    if (!path) throw new Error("Usage: verify <manifest.json>")
    const expected = parseManifest(await Bun.file(path).json())
    const actual = await inspect()
    verify(actual, expected)
    console.log(JSON.stringify({ compatible: true, ...actual }, null, 2))
    return
  }

  const client = await connect({
    cwd: process.cwd(),
    onStderr: (text) => process.stderr.write(text),
  })
  try {
    if (command === "status") {
      console.log(JSON.stringify(await client.account(), null, 2))
      return
    }
    if (command === "rate-limits") {
      console.log(JSON.stringify(await client.rateLimits(), null, 2))
      return
    }
    if (command === "login-browser" || command === "login-device") {
      const login = await client.startLogin(command === "login-browser" ? "chatgpt" : "chatgptDeviceCode")
      if (login.authUrl) console.log(`Open: ${login.authUrl}`)
      if (login.verificationUrl) console.log(`Open: ${login.verificationUrl}`)
      if (login.userCode) console.log(`Code: ${login.userCode}`)
      console.log(JSON.stringify(await client.waitForLogin(login), null, 2))
      return
    }
    if (command === "turn") {
      const prompt = args.join(" ").trim()
      if (!prompt) throw new Error("Usage: turn <prompt>")
      const thread = await client.startThread({ cwd: process.cwd() })
      const result = await client.runTurn(thread.threadId, prompt)
      console.log(JSON.stringify({ threadId: thread.threadId, status: result.status, text: result.text }, null, 2))
      return
    }
    if (command === "resume") {
      const [threadId, ...words] = args
      const prompt = words.join(" ").trim()
      if (!threadId || !prompt) throw new Error("Usage: resume <thread-id> <prompt>")
      const thread = await client.resumeThread(threadId)
      const result = await client.runTurn(thread.threadId, prompt)
      console.log(JSON.stringify({ threadId: thread.threadId, status: result.status, text: result.text }, null, 2))
      return
    }
    console.log("Commands: inspect, verify, status, rate-limits, login-browser, login-device, turn, resume")
  } finally {
    await client.close()
  }
}

if (import.meta.main) await main()
