# ProofRun bounded verification policy

This is ProofRun's operating policy for its hackathon prototype. It does not replace the current HackerOne program rules or establish authorization to test a target.

- The only supported program adapter is Vercel on HackerOne. A live run requires a fresh capture of the program page in a signed-in browser and eligible structured scope confirmed through the HackerOne API.
- A live check uses two separate, researcher-owned Vercel accounts. The owner account holds the private test project; the other account is not a member of that project or team.
- The only permitted test request is `GET /v9/projects/{idOrName}` for that researcher-owned project. ProofRun may compare the owner and other-account responses and make an anonymous control request only if needed. No other tests, targets, mutations, fuzzing, or scanning are authorized by this policy.
- Respect the program limit of at most five requests per second. Stop after one confirmation; do not keep probing.
- Local lab results are synthetic training data and are never reportable as Vercel vulnerabilities.
- A live candidate is not a confirmed vulnerability. A researcher must independently reproduce the behavior, establish private-field impact, review every claim, attach the required unedited screenshot or video, and submit the report manually in HackerOne.
