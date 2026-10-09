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
    // Guild prepends session metadata; the caller's compact JSON is the final block.
    const event = JSON.parse(input.text.slice(input.text.lastIndexOf("{")))
    const validRun = /^[a-zA-Z0-9_-]{8,80}$/.test(event.id)
    if (validRun && event.programHandle === "owned_site" &&
      event.mode === "owned" && event.targetUrl === "https://ayushojha.com") {
      if (event.phase === "start" && event.check === "source_acl") {
        decision = { allow: true, decision: "source_acl" }
      } else if (event.phase === "complete" &&
        ["source_candidate", "none", "inconclusive"].includes(event.verdict)) {
        decision = { allow: true, decision: "recorded", verdict: event.verdict }
      }
    } else if (validRun && event.programHandle === "acronis") {
      if (event.phase === "start" && event.mode === "live" &&
        event.check === "search_reflection" && event.scopeApproved === true) {
        decision = { allow: true, decision: "search_reflection" }
      } else if (event.phase === "complete" && event.mode === "live" && event.verdict === "inconclusive") {
        decision = { allow: true, decision: "recorded", verdict: "inconclusive" }
      }
    } else if (validRun && event.programHandle === "vercel") {
      const boundedStart = event.phase === "start" && event.check === "project_access" &&
        (event.mode === "lab" || (event.mode === "live" && event.scopeApproved === true))
      const watchStart = event.phase === "start" && event.mode === "watch" && event.check === "policy_watch"
      if (watchStart) {
        decision = { allow: true, decision: "policy_watch" }
      } else if (boundedStart) {
        decision = { allow: true, decision: "project_access" }
      } else if (event.phase === "complete" && event.mode === "watch" &&
        ["baseline", "changed", "unchanged"].includes(event.verdict)) {
        decision = { allow: true, decision: "recorded", verdict: event.verdict }
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
  description: "Gates bounded Vercel, Acronis, and owned-site checks plus read-only HackerOne scope monitoring, then records outcomes.",
  inputSchema,
  outputSchema,
  tools: noTools,
  run,
})
