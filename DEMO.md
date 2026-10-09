# ProofRun three-minute demo

The primary demo is a bounded Acronis HackerOne check. ProofRun reads the current program scope, asks the four sponsor services to evaluate a fixed plan, then sends **one inert, read-only search-marker request** to the public search endpoint. A reflected marker alone is inconclusive, so the result creates no vulnerability report and submits nothing.

Observed live result: the HackerOne scope check passed; one Acronis search GET returned HTTP 200; the response exceeded ProofRun's 256 KiB read cap; the marker was **not seen in the captured first 256 KiB**. The ClickHouse query took 96 ms. This does not establish whether the marker appears later in the response, and no vulnerability report was generated.

Record a new live run only after the updated Senso policy and Guild gate are published and the H1 API, AkashML, and ClickHouse connections are configured. Do not rerun the target request just to improve the recording. If a gate fails, show the failure honestly; the previously verified Vercel policy watch is a separate fallback demonstration, not evidence of an Acronis probe.

## Before recording

1. Seed the updated ProofRun policy in Senso, point the local configuration at its content ID, publish the Guild gate, and restart the local server. Check that the Acronis plan is accepted before any target request.
2. Open the local app at http://127.0.0.1:8787/ and confirm the Acronis URL is selected. The intake should identify its source as the HackerOne API and show eligible Acronis scope.
3. Keep the terminal, browser password manager, and ignored .env off-screen. The video should show only the app, sourced policy, execution trace, and result.
4. If recording a new execution, run the live check once and save its result and source links. If showing the prior result, call it a recorded run. A failed gate or unreachable search page is a truthful result; do not substitute a synthetic lab trace.

## Shot list

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:20 | Acronis URL, supported checks, single-request boundary | “Give ProofRun a HackerOne program URL. Today it supports this bounded Acronis check and a separate Vercel adapter.” |
| 0:20–0:45 | Review current scope and policy, with HackerOne API source | “The target and permitted action come from the live program scope and a fixed policy; reviewing scope sends no target request.” |
| 0:45–1:10 | Start one live check; show Senso, Guild, and AkashML gates | “The services evaluate the plan before the request. A deny stops execution.” |
| 1:10–1:40 | Public-search evidence: HTTP 200, 256 KiB cap, marker field, inconclusive verdict | “One inert search-marker request returned HTTP 200. The response exceeded our 256 KiB cap; the marker was not seen in the bytes we read. We cannot infer what the rest of the response contained.” |
| 1:40–2:05 | ClickHouse event, 96 ms query, and sponsor trace | “The observation and sponsor decisions are recorded for review. This query took 96 milliseconds.” |
| 2:05–2:25 | Result and report panel | “This check is inconclusive. ProofRun produces no report and does not submit one.” |
| 2:25–2:45 | Optional Vercel policy-watch history | “Separately, ProofRun monitors structured program-scope changes. This is monitoring, not a vulnerability finding.” |
| 2:45–3:00 | Vercel account-check gate and repo link | “The Vercel project-access check remains gated until two distinct owned accounts are available.” |

If a new run differs from the observed result, narrate its actual status and latency. Keep the distinction between an attempted request, a bounded HTTP response observation, and a verified finding clear.

## Submission wording

Use the recorded run's actual evidence. A suitable description of the observed run is: “ProofRun accepted the Acronis HackerOne URL, verified current scope through the HackerOne API, gated one read-only public-search marker request through Senso, Guild, and AkashML, and stored the observed outcome in ClickHouse. The target returned HTTP 200; its response exceeded the 256 KiB read cap, and no marker appeared in the captured prefix. The check is inconclusive and produced no report.” If a new run differs or a provider fails, name that outcome instead.

List sponsor prize categories only for real integrations shown in the trace. A Semgrep prize claim requires a genuine Semgrep finding; running a scan alone is not a finding.
