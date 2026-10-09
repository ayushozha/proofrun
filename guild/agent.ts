"use agent"

import { agent, noTools } from "@guildai/agents-sdk"
import { z } from "zod"

const inputSchema = z.object({ type: z.literal("text"), text: z.string() })
const outputSchema = z.object({ type: z.literal("text"), text: z.string() })

// The API caller sends only normalized run metadata. This agent is a real
// Guild-executed gate; the local worker will not probe without its exact reply.
async function run(input: z.infer<typeof inputSchema>) {
  let decision: { allow: boolean; decision: string; verdict?: string } = { allow: false, decision: "stop" }
  try {
    const event = JSON.parse(input.text)
    const validRun = /^[a-zA-Z0-9_-]{8,80}$/.test(event.id)
    if (validRun && event.programHandle === "vercel") {
      if (event.phase === "start" && event.scopeApproved === true && event.check === "project_access") {
        decision = { allow: true, decision: "project_access" }
      } else if (event.phase === "complete" && ["candidate", "expected", "inconclusive"].includes(event.verdict)) {
        decision = { allow: true, decision: "recorded", verdict: event.verdict }
      }
    }
  } catch {
    // Invalid or unexpected input cannot authorize a probe.
  }
  return { type: "text" as const, text: JSON.stringify(decision) }
}

export default agent({
  description: "Gates one bounded owned-account Vercel authorization check and records its outcome.",
  inputSchema,
  outputSchema,
  tools: noTools,
  run,
})
