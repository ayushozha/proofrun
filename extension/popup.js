const CAPTURE_ENDPOINT = "http://127.0.0.1:8787/api/capture";
const PROGRAM_URL = "https://hackerone.com/vercel";
const MAX_VISIBLE_CHARS = 40_000;

const button = document.querySelector("#capture");
const status = document.querySelector("#status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function isProgramUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:"
      && url.hostname === "hackerone.com"
      && /^\/vercel\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function readVisibleProgramText() {
  if (location.protocol !== "https:" || location.hostname !== "hackerone.com" || !/^\/vercel\/?$/.test(location.pathname)) {
    throw new Error("Open the Vercel HackerOne program page first.");
  }

  const main = document.querySelector("main") || document.querySelector('[role="main"]');
  if (!main) {
    throw new Error("Could not locate the program policy on this page.");
  }

  const text = main.innerText.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (text.length < 100) {
    throw new Error("Program policy has not loaded. Wait for the page and try again.");
  }
  return text.slice(0, 40_000);
}

button.addEventListener("click", async () => {
  button.disabled = true;
  setStatus("Reading the visible program page…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !isProgramUrl(tab.url)) {
      throw new Error("Open https://hackerone.com/vercel in this browser first.");
    }

    const [{ result: visibleText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readVisibleProgramText,
    });
    if (!visibleText || visibleText.length > MAX_VISIBLE_CHARS) {
      throw new Error("The program page could not be captured.");
    }

    const response = await fetch(CAPTURE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        programUrl: PROGRAM_URL,
        visibleText,
        capturedAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(`ProofRun rejected the capture (HTTP ${response.status}).`);
    }
    setStatus("Program captured. Return to ProofRun to review its scope.");
  } catch (error) {
    setStatus(error.message || "Capture failed. Check that ProofRun is running.", true);
  } finally {
    button.disabled = false;
  }
});
