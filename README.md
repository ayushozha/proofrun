# ProofRun

ProofRun is a hackathon prototype for one bounded bug-bounty workflow: capture the signed-in [Vercel HackerOne program](https://hackerone.com/vercel) policy, compare a private Vercel project read from two researcher-owned accounts, and prepare an evidence-based report for human review.

Guild must approve each run, AkashML must select the allowed check, and ClickHouse stores normalized observations with a lab/live label and computes the candidate/expected/inconclusive verdict. A missing sponsor connection stops the run. The local lab is deliberately vulnerable and is labeled as training data; it is never reportable.

## Run locally

Node.js 24 or newer is required. In PowerShell:

```powershell
Copy-Item .env.example .env
# Fill .env locally; do not commit it or paste keys into chat.
npm start
```

Open `http://127.0.0.1:8787`. Load the [Edge/Chrome capture extension](extension/README.md), visit the Vercel program while signed in, click the extension's **Capture program** button, then return to ProofRun and select **Capture program** in the app. The browser login is used only to read the visible policy. The HackerOne API uses its own researcher API token.

The `.env.example` file lists every required variable. For Guild, publish and install the narrow [gate agent](guild/README.md) first. Set `AKASHML_MODEL` in `.env`; the application contains no fixed model ID. The ClickHouse URL must be its HTTP endpoint. For a live check, `VERCEL_PROJECT_ID` must belong to the account behind `VERCEL_OWNER_TOKEN`; `VERCEL_OTHER_TOKEN` must belong to a separate account you own that is not a member of the owner's team. Set optional `VERCEL_TEAM_ID` for a team-owned project; ProofRun sends the same team ID in all three control requests. Use Vercel's required researcher alias when registering test accounts.

The demo's [ClickHouse Cloud service](https://console.clickhouse.cloud/services/7cec452a-7fa4-419a-82c3-1710d18aca49/console/database/default/table/proofrun_checks) is `proofrun` on the Basic plan in AWS Oregon. The app writes normalized lab/live checks to a native MergeTree table over HTTPS SQL, then queries ClickHouse for its verdict. [Recorded lab rows](docs/assets/clickhouse-proofrun.png) show the Cloud path. The service idles after 15 minutes and allows the current browser and local-app egress IPs; update its IP access list if the demo moves networks.

## Workflow and limits

The first adapter accepts only `https://hackerone.com/vercel` and checks only `GET /v9/projects/{idOrName}`. A live run requires a fresh signed-in browser capture, eligible structured scope from the HackerOne API, all three sponsor services, and the two Vercel credentials. It makes one owner request, one other-account request, and an anonymous control only if needed. No response bodies, access tokens, project IDs, raw policy text, or report details are sent to Guild, AkashML, or ClickHouse; only normalized run metadata reaches them.

A `candidate` is a prompt for investigation, not a confirmed vulnerability. Vercel requires a complete, reproducible impact demonstration and a screenshot or unedited video attached for platform findings. The report editor gives the researcher a draft to check against the raw evidence and revise after independently reproducing the issue. Lab runs cannot be submitted. HackerOne bug-bounty submissions also require approved ID verification; `.env` keeps `HACKERONE_ID_VERIFIED=false` until the researcher confirms that status.

**API submission is blocked in this prototype.** The documented [direct HackerOne report API](https://api.hackerone.com/hacker-resources/) has no media-attachment field. HackerOne documents media upload for report intents, but that route requires a program to enable Report Assistant; Vercel's signed-in page says to submit without Report Assistant. Copy the reviewed draft into HackerOne and attach the required media there before submitting. ProofRun does not claim to have submitted a report.

## Verification

```powershell
npm run smoke
```

This smoke check exercises the capture, intake, Guild/AkashML/ClickHouse HTTP adapters, local lab probe, verdict, and submission guard against mock service endpoints. It does not prove live sponsor access, a Vercel vulnerability, HackerOne submission, or bounty eligibility. No license file is currently checked in.
