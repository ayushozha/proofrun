# ProofRun bounded verification policy

This is ProofRun's operating policy for its hackathon prototype. It does not replace the current HackerOne program rules or establish authorization to test a target.

- A policy watch run performs read-only HackerOne structured-scope monitoring. It may fetch the current Vercel program metadata and scopes through the HackerOne researcher API, compare normalized scope identifiers and submission eligibility with the prior ClickHouse snapshot, and publish a sourced change alert in ProofRun. Policy-watch data never authorizes a target request or a vulnerability report.
- The Vercel adapter requires a fresh capture of its program page in a signed-in browser and eligible structured scope confirmed through the HackerOne API.
- A live check uses two separate, researcher-owned Vercel accounts. The owner account holds the private test project; the other account is not a member of that project or team.
- The only permitted test request is `GET /v9/projects/{idOrName}` for that researcher-owned project. ProofRun may compare the owner and other-account responses and make an anonymous control request only if needed. No other tests, targets, mutations, fuzzing, or scanning are authorized by this policy.
- Respect the program limit of at most five requests per second. Stop after one confirmation; do not keep probing.
- Local lab results are synthetic training data and are never reportable as Vercel vulnerabilities.
- A live candidate is not a confirmed vulnerability. A researcher must independently reproduce the behavior, establish private-field impact, review every claim, attach the required unedited screenshot or video, and submit the report manually in HackerOne.

## Acronis public search marker

- An Acronis live run requires the HackerOne researcher API to confirm the program is open, `*.acronis.com` is eligible for submission, and the current program policy permits automated web testing with the researcher's `@wearehackerone.com` alias in User-Agent at no more than five requests per second per host.
- The only permitted Acronis target request is one unauthenticated `GET` to `https://www.acronis.com/en/search/` with a short, random alphanumeric `query` marker. Redirects outside this fixed request are refused. No cookies, credentials, scripts, mutations, fuzzing, or follow-up requests are permitted.
- The result records only the HTTP status and whether the inert marker appeared in the response body. Search-text reflection is normal behavior and does not establish a vulnerability, impact, or reportable finding. This check must always end inconclusive and never generate or submit a bounty report.
