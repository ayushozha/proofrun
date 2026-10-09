# ProofRun demo and submission copy

Lead the three-minute video with a **completed live structured-scope watch** at `http://127.0.0.1:8787/`. The watch fetches Vercel's current HackerOne structured scope, stores a baseline in ClickHouse, and compares later snapshots. It makes no Vercel target request. A first run is a baseline, not a discovered scope change. The watch tracks asset identifiers and submission/bounty eligibility; it does not detect edits to free-text program policy or per-asset instructions. Record the watch result and four-service trace only after a real run succeeds; the status panel shows configuration, and `npm run smoke` uses mocks. The project-access demo that follows is a synthetic local lab, never a Vercel finding.

Guild dispatch can take a few minutes. Record the watch click, then cut to its completed result in the same browser tab. Pre-run the watch before a stage demo. Refresh the pinned Senso policy content ID after seeding the current [policy](docs/proofrun-policy.md); a stale passage can stop the watch.

Observed on October 9 at 2:19 PM PT: the live Vercel HackerOne API returned 25 structured-scope entries. ProofRun compared them with the earlier ClickHouse baseline and displayed **unchanged**, a 121 ms ClickHouse query, and a completed eight-step sponsor/source trace. This is a recorded scope observation, not a vulnerability finding.

## Three-minute shot list

| Time | Screen and action | Narration |
| --- | --- | --- |
| 0:00–0:20 | Show the live monitor and enter `https://hackerone.com/vercel`; click **Watch HackerOne policy**. | “ProofRun monitors a real bounty program through HackerOne's structured-scope API. This action is read-only and does not probe a target.” |
| 0:20–0:55 | Cut to the completed watch: source link, fetch time, scope count, and baseline/unchanged/changed label. | “ClickHouse stores each snapshot and compares it with the previous one when present. This result is a baseline if it is the first observation; later runs show exact scope additions and removals.” |
| 0:55–1:25 | Show the watch trace and ClickHouse query latency. | “Senso supplied our pinned policy passage, Guild approved this bounded action, AkashML selected the policy watch and wrote a sourced alert, and ClickHouse compared and stored the scope. Every sponsor call is visible.” |
| 1:25–1:50 | Move to the project-access workbench; select **Use local sample for a lab walkthrough**. | “The second path demonstrates the project-access workflow. These account and project observations are synthetic, clearly marked as a local lab.” |
| 1:50–2:20 | Show the completed lab result, evidence timeline, sponsor trace, and verdict. | “The lab fixture deliberately returns the owner marker to both simulated accounts. That creates a lab-only candidate, not a Vercel vulnerability.” |
| 2:20–2:40 | Show the report draft and blocked submission; briefly show the live prerequisites. | “Live project access stays gated on signed-in policy capture and two distinct researcher-owned alias accounts. A candidate still needs independent reproduction and impact evidence.” |
| 2:40–3:00 | End on the source-linked watch alert and repository README. | “The useful action today is persistent, sourced policy monitoring. The lab teaches the verification flow; no bounty or HackerOne report is claimed.” |

If the live watch fails, show the error honestly and do not describe the watch as exercised. The completed real-service lab can still demonstrate Guild, Senso, AkashML, and ClickHouse. Never present mock smoke results as live service usage. Do not stage a fake scope change or present a baseline as one. Redact tokens and account identifiers in the recording.

## Submission blurb

Use this wording only after a completed real-service policy watch is visible in the recording:

> **ProofRun** is a read-only bounty-policy monitor and bounded verification workbench. Given the Vercel HackerOne URL, it fetches current structured scope through the HackerOne researcher API, stores a persistent snapshot in ClickHouse, and displays a source-linked baseline or exact scope delta. Senso supplies versioned policy context, Guild gates the action, and AkashML selects the allowed watch and explains the comparison. A separate synthetic lab demonstrates a project-access check and a draft for human review. The live Vercel project check remains gated on current signed-in policy capture and two compliant owned accounts. We do not claim a Vercel vulnerability or an automated HackerOne submission.

**Prize claims:** Tick ClickHouse, Guild, Akash, and Senso categories only when their real calls appear in the recorded watch or completed lab trace. Tick Semgrep's vulnerability prize only with an actual, interesting Semgrep finding in AI-generated code and its reproducible evidence. Pi's overall category can be entered on the strength of the finished demo; no prize is guaranteed. Add the public repository URL, shareable video link, team names, and contact emails after checking them.
