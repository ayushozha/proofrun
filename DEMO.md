# ProofRun three-minute demo

Lead with the **owned-site audit of ayushojha.com**. ProofRun accepts that exact URL, checks a private local checkout of the owner's GitHub source with Semgrep CE, and makes one anonymous, read-only `GET /api/access` request to the live site. Senso supplies the pinned policy; Guild gates the run; AkashML chooses the bounded check and later reviews its result; ClickHouse stores and queries normalized finding metadata. The owner authorized testing their site. The source repository stays private and is not part of the public ProofRun repository.

The recorded owned-site run found **11 Semgrep source candidates** for broad signed-in-user access callbacks. The anonymous `/api/access` request returned **HTTP 200**. These facts do **not** prove that the same source revision is deployed, that any account can access another person's records, or that the permissions violate the site's intended policy. Label the result **source only**. ProofRun neither creates nor submits a HackerOne report for this run.

Keep the recording on the owned-site result for the full three minutes. If a paired training result has been recorded separately, it can be used as a brief cutaway: its intentionally exposed case produces a candidate and its protected case produces the expected denial. That proves the detector distinguishes those controlled cases, not that the hosted site has the same defect.

## Before recording

1. Open the verified local app at `http://127.0.0.1:8789/` (or the URL printed by `npm start` after a restart). Verify the owned-site intake and the current sponsor status. The private checkout, Senso policy content ID, Guild gate, AkashML, ClickHouse, and Semgrep must be configured for a fresh run. If a gate fails, show the failure rather than substituting a training result.
2. If the verified result remains open in Edge, show it there. Reloading clears the browser's result state; a fresh run repeats the Semgrep scan and the single public `GET /api/access`. If its finding count, status, or latency changes, narrate the actual values on screen.
3. Keep the ignored `.env`, terminals containing credentials, private GitHub source, browser password manager, and any personal records off-screen. Show only the ProofRun UI, normalized findings, sponsor trace, and public response metadata.
4. Record a shareable video of about three minutes. Check the video link in a signed-out browser before adding it to the hackathon submission.

## Shot list and exact narration

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:20 | ProofRun landing page; enter `https://ayushojha.com` | “ProofRun starts with a target URL. This is my own website, and I authorized this audit. I want an agent to investigate a concrete security question and keep its conclusions tied to evidence.” |
| 0:20–0:45 | Owned-site intake; source and bounded check | “For this target, ProofRun uses my private GitHub source checkout and allows one anonymous, read-only request to the site's public access endpoint. It does not fetch private records or mutate the site.” |
| 0:45–1:15 | Run or recorded run; sponsor trace in order | “Senso returns the pinned operating policy. Guild approves the bounded job. AkashML selects the source access-rule check. Semgrep scans the configured checkout; ClickHouse records and queries normalized findings. AkashML reviews the result, and Guild acknowledges completion.” |
| 1:15–1:50 | Eleven findings; highlight ContactSubmissions read/update and Products create/update | “Semgrep found eleven source-level candidates. Here are two worth reviewing: signed-in users appear broadly permitted to read or update contact submissions, and to create or update products. These are code matches, not yet confirmed exploits.” |
| 1:50–2:20 | Source revision, `/api/access` HTTP status, confidence label | “The live site returned HTTP 200 for an anonymous access-capability request. That only shows this public endpoint responded. I have not proven which source revision is deployed, and I have not shown an unauthorized account reading or changing data. ProofRun marks this source only.” |
| 2:20–2:40 | ClickHouse query timing and AkashML review note; no report state | “ClickHouse makes the run and its findings inspectable; the query time shown here comes from this run. The review note lists what a human should validate next. There is no HackerOne report or automatic submission.” |
| 2:40–3:00 | Stay on the validation questions and source-only label | “The next step is a controlled test with a low-privilege account and confirmation of the deployed revision. Until then, ProofRun stops at a source candidate. It does not turn a plausible code pattern into a vulnerability claim.” |

Speak to the screen if a new run differs. Do not read out a fixed query latency, commit SHA, or finding count unless it is visible in the recorded run. Use the paired training result only as an optional pre-recorded cutaway, never as evidence about the hosted site.

## Submission wording

“ProofRun audited an owner-authorized website from its private GitHub source checkout. A Senso policy and Guild agent gated a bounded plan selected and reviewed by AkashML. Semgrep found 11 source-level access-rule candidates; ClickHouse stored and queried normalized findings. One anonymous `GET /api/access` to the live site returned HTTP 200. The result is source only: no unauthorized read or write against the deployed site was demonstrated, and no HackerOne report was submitted. A separate paired training target demonstrates that the detector distinguishes an intentionally exposed authorization case from a protected one.”

Use the recorded run's actual values if they change. The earlier Acronis search probe and Vercel policy watch are separate ProofRun capabilities; they are not evidence for the owned-site finding. Select sponsor prizes only for integrations actually shown working in the recording.
