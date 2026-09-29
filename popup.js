const btn = document.getElementById("fillBtn");
const status = document.getElementById("status");
const apiKeyInput = document.getElementById("apiKey");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keyStatus = document.getElementById("keyStatus");

const SIMPLELOGIN_API_BASE = "https://app.simplelogin.io/api";

// ---------- API key persistence (chrome.storage.local, never hardcoded) ----------
(async function loadStoredKey() {
  const { simpleLoginApiKey } = await chrome.storage.local.get("simpleLoginApiKey");
  if (simpleLoginApiKey) {
    apiKeyInput.value = simpleLoginApiKey;
    keyStatus.textContent = "Key loaded from storage";
  }
})();

saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "Enter a key first";
    return;
  }
  await chrome.storage.local.set({ simpleLoginApiKey: key });
  keyStatus.textContent = "Key saved";
});

// ---------- Real alias creation via SimpleLogin API ----------
async function createSimpleLoginAlias(apiKey) {
  const res = await fetch(`${SIMPLELOGIN_API_BASE}/alias/random/new`, {
    method: "POST",
    headers: {
      "Authentication": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ note: `Created by Fake Form Filler on ${new Date().toISOString()}` })
  });

  if (res.status === 401) {
    throw new Error("Invalid or expired API key");
  }
  if (!res.ok) {
    // SimpleLogin returns { "error": "..." } with a human-readable reason
    // (e.g. alias quota reached). Surface it instead of just the status code.
    let detail = "";
    try {
      const body = await res.json();
      detail = body.error || body.message || "";
    } catch (_) {}
    throw new Error(`SimpleLogin API error (${res.status})${detail ? ": " + detail : ""}`);
  }

  const data = await res.json();
  // Response includes: { alias, id, mailbox: {...}, enabled, ... }
  return data.alias;
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  status.textContent = "Filling...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      status.textContent = "No active tab found";
      btn.disabled = false;
      return;
    }

    // 1. Try to get a real, receivable email alias from SimpleLogin
    let emailAlias = null;
    let emailErrorMessage = null;
    const { simpleLoginApiKey } = await chrome.storage.local.get("simpleLoginApiKey");

    if (!simpleLoginApiKey) {
      emailErrorMessage = "no SimpleLogin API key saved";
    } else {
      try {
        emailAlias = await createSimpleLoginAlias(simpleLoginApiKey);
        if (!emailAlias) {
          emailErrorMessage = "SimpleLogin API returned no alias";
        }
      } catch (apiErr) {
        console.warn("SimpleLogin alias creation failed:", apiErr.message);
        emailErrorMessage = apiErr.message;
      }
    }

    // 2. Expose the alias to content.js via a page-scoped global,
    //    set in an isolated injection that runs before content.js.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (alias) => { window.__fakeFormFillerEmail = alias; },
      args: [emailAlias]
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"]
    });

    // Sum the filled-in fields across all frames on the page
    const total = results.reduce((sum, r) => sum + (typeof r.result === "number" ? r.result : 0), 0);

    if (total > 0) {
      if (emailAlias) {
        status.textContent = `${total} fields filled in (email: ${emailAlias})`;
      } else if (emailErrorMessage) {
        status.textContent = `${total} fields filled in — email skipped (${emailErrorMessage})`;
      } else {
        status.textContent = `${total} fields filled in`;
      }
    } else {
      status.textContent = "No compatible fields found on this page";
    }
  } catch (err) {
    status.textContent = "Unable to perform actions on this page";
  } finally {
    btn.disabled = false;
  }
});