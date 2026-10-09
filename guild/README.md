# ProofRun Guild gate

`agent.ts` is a deterministic Guild agent. It accepts a normalized JSON text
message for the `start` or `complete` phase. The local worker requires its
`start` decision before making any target request and checks its completion
acknowledgment afterward. The agent receives no access tokens, project IDs,
response bodies, or confidential program text.

To run it on Guild, [install and sign in with the Guild CLI](https://docs.guild.ai/cli/getting-started), create an `AUTO_MANAGED_STATE` agent with `guild agent init`, replace the scaffold's `agent.ts` with this file, then test, save, publish, and install that agent in a workspace. Keep the Guild-generated `guild.json` and package files in that scaffold; they are managed by the CLI. The published agent and workspace supply `GUILD_AGENT_ID` and `GUILD_WORKSPACE` for the local app.

Create an [account API key](https://docs.guild.ai/api-reference/introduction) with `sessions:write`, `workspaces:read`, and `agents:read`; set it as `GUILD_API_KEY` outside the repo. The local app uses the [Guild Conversations API](https://docs.guild.ai/api-reference/conversations) to start a session and read the agent's JSON decision. Without a published agent and working credentials, ProofRun stops before the probe.
