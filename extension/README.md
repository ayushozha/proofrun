# ProofRun browser capture

The extension sends the visible policy and scope text from the open [Vercel HackerOne program](https://hackerone.com/vercel) page to a local ProofRun server. It runs only when you click **Capture program**. It does not read cookies, tokens, form values, other tabs, or account pages.

1. Start ProofRun locally on `http://127.0.0.1:8787`.
2. In Edge, open `edge://extensions` (or `chrome://extensions` in Chrome), enable **Developer mode**, choose **Load unpacked**, and select this `extension` folder.
3. Open `https://hackerone.com/vercel` while signed in, wait for the policy to load, and click the extension icon → **Capture program**.
4. Return to ProofRun to review the captured scope before running any test.

The local API contract is `POST /api/capture` with `{ "programUrl": "https://hackerone.com/vercel", "visibleText": "...", "capturedAt": "ISO-8601" }`. Only the first 40,000 visible characters inside the page's main content are sent. This prototype supports the Vercel program page only; other HackerOne pages are rejected. It does not submit reports or perform testing by itself.
