# ProofRun

ProofRun watches the live [Vercel HackerOne program](https://hackerone.com/vercel) structured scope. Give it the program URL and it fetches the current scope through HackerOne's researcher API, compares it with a snapshot persisted in ClickHouse, and displays a sourced baseline or change alert. This is read-only monitoring of the open web; it sends no test request to Vercel. A separate project-access lab shows the bounded verification workflow with synthetic observations.

Both paths require the four sponsor services: Senso supplies a versioned passage from ProofRun's pinned operating policy, Guild gates the action, AkashML selects and explains the bounded action, and ClickHouse persists and queries the evidence. Policy watch compares each scope snapshot with the previous ClickHouse record and stores the new snapshot. The project-access lab stores normalized observations and computes a candidate/expected/inconclusive verdict. A missing sponsor connection stops the run; lab results are never reportable.

## Run locally

Node.js 24 or newer is required. In PowerShell:

```powershell
Copy-Item .env.example .env
# Fill .env locally; do not commit it or paste keys into chat.
npm start
```

Open `http://127.0.0.1:8787`, enter `https://hackerone.com/vercel`, and select **Watch HackerOne policy**. Policy watch needs the HackerOne API token and all four sponsor connections, but no browser extension or Vercel test accounts. With no previous ClickHouse snapshot, it records a baseline; later watches compare complete structured-scope snapshots with that stored history.

For the separate project-access path, load the [Edge/Chrome capture extension](extension/README.md), visit the Vercel program while signed in, click the extension's **Capture program** button, then return to ProofRun and select **Capture program** in the app. The browser login reads the visible policy; the HackerOne API uses its own researcher token.

For a safe walkthrough before browser setup, choose **Use local sample for a lab walkthrough** in the app. It creates a synthetic, lab-only intake and cannot authorize a live Vercel request. The lab run still requires real Guild, Senso, AkashML, and ClickHouse connections; its observations are never reportable.

The `.env.example` file lists every required variable. For Guild, publish and install the narrow [gate agent](guild/README.md) first. Set `AKASHML_MODEL` in `.env`; the application contains no fixed model ID. The ClickHouse URL must be its HTTP endpoint. For a live check, `VERCEL_PROJECT_ID` must belong to the account behind `VERCEL_OWNER_TOKEN`; `VERCEL_OTHER_TOKEN` must belong to a separate account you own that is not a member of the owner's team. Set optional `VERCEL_TEAM_ID` for a team-owned project; ProofRun sends the same team ID in all three control requests.

[Vercel's program policy](https://hackerone.com/vercel?type=team) requires two owned accounts for cross-tenant testing and a visible HackerOne researcher alias on test accounts. Register them with distinct aliases such as `HACKERONE_API_USERNAME+owner@wearehackerone.com` and `HACKERONE_API_USERNAME+other@wearehackerone.com`; [HackerOne supports multiple aliases](https://docs.hackerone.com/en/articles/8404308-hacker-email-alias). Before any live project request, ProofRun checks both Vercel user IDs and emails through `/v2/user` and blocks duplicate identities or non-alias emails. The current `@wasmer.io` owner account is therefore gated from live checks until replaced with a compliant test account.

For Senso, create an API key, set `SENSO_API_KEY` in the ignored `.env`, then run `npm run senso:seed`. The script uploads [ProofRun's operating policy](docs/proofrun-policy.md) to your Senso knowledge base, waits for indexing, and prints its `content_id`. Set that value as `SENSO_POLICY_CONTENT_ID` in `.env` and restart the app. Each run retrieves context scoped to that document and shows the returned version in its sponsor trace. Senso tracks ProofRun's own policy; the current HackerOne API scope is the watch source, and live project checks also require the signed-in program page. Senso ingestion and retrieval use credits. Until a real key and document are configured, runs stop.

The demo's [ClickHouse Cloud service](https://console.clickhouse.cloud/services/7cec452a-7fa4-419a-82c3-1710d18aca49/console/database/default/table/proofrun_checks) is `proofrun` on the Basic plan in AWS Oregon. Policy watch uses a native MergeTree table for persistent scope snapshots and compares each fetch with the previous record. The project-access path writes normalized lab/live checks to another MergeTree table over HTTPS SQL and queries its verdict. [Recorded lab rows](docs/assets/clickhouse-proofrun.png) show the Cloud path; they are not evidence of a completed policy watch. The service idles after 15 minutes and allows the current browser and local-app egress IPs; update its IP access list if the demo moves networks.

## Workflow and limits

Policy watch accepts only `https://hackerone.com/vercel`. It reads the program and all structured-scope pages, normalizes asset identifiers and submission/bounty eligibility, and compares the complete snapshot with ClickHouse history. With no previous snapshot, it records a baseline; later runs report exact additions/removals or no change. The displayed alert links to the source and includes the fetch time. The watch does not detect changes to free-text program policy or per-asset instructions. A scope change does not authorize testing or establish a vulnerability.

The separate project-access adapter checks only `GET /v9/projects/{idOrName}`. A live run requires a fresh signed-in browser capture, eligible structured scope from the HackerOne API, all four sponsor services, and two distinct, alias-registered Vercel accounts. It makes one owner request, one other-account request, and an anonymous control only if needed. No Vercel response bodies, access tokens, project IDs, raw HackerOne policy text, or report details leave the local worker. AkashML receives the ProofRun-owned Senso policy passage and normalized observations; Guild and ClickHouse receive normalized run metadata.

A `candidate` is a prompt for investigation, not a confirmed vulnerability. Vercel requires a complete, reproducible impact demonstration and a screenshot or unedited video attached for platform findings. The report editor gives the researcher a draft to check against the raw evidence and revise after independently reproducing the issue. Lab runs cannot be submitted. HackerOne bug-bounty submissions also require approved ID verification; `.env` keeps `HACKERONE_ID_VERIFIED=false` until the researcher confirms that status.

**API submission is blocked in this prototype.** The documented [direct HackerOne report API](https://api.hackerone.com/hacker-resources/) has no media-attachment field. HackerOne documents media upload for report intents, but that route requires a program to enable Report Assistant; Vercel's signed-in page says to submit without Report Assistant. Copy the reviewed draft into HackerOne and attach the required media there before submitting. ProofRun does not claim to have submitted a report.

## Verification

```powershell
npm run smoke
```

This smoke check exercises the capture, intake, Guild/Senso/AkashML/ClickHouse HTTP adapters, local lab probe, verdict, and submission guard against mock service endpoints. It does not prove live sponsor access, a Vercel vulnerability, HackerOne submission, or bounty eligibility. No license file is currently checked in.
