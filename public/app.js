const button = document.getElementById("get-code");
const errorMessage = document.getElementById("error-message");

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove("hidden");
}

function hideError() {
  errorMessage.textContent = "";
  errorMessage.classList.add("hidden");
}

function showActivationKey(key) {
  const existing =
    document.getElementById("activation-key-container");

  if (existing) {
    existing.remove();
  }

  const container = document.createElement("div");

  container.id = "activation-key-container";

  container.className =
    "mt-6 rounded-xl bg-slate-950/60 border border-slate-800 p-5";

  const title = document.createElement("h3");

  title.className =
    "text-sm font-semibold text-white mb-3";

  title.textContent = "Your Activation Key";

  const keyBox = document.createElement("div");

  keyBox.className =
    "rounded-lg bg-slate-900 border border-slate-800 px-4 py-3 text-center";

  const keyText = document.createElement("p");

  keyText.className =
    "text-blue-400 font-semibold tracking-wider break-all";

  keyText.textContent = key;

  const copyButton = document.createElement("button");

  copyButton.type = "button";

  copyButton.className =
    "w-full mt-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium py-2 transition";

  copyButton.textContent = "Copy key";

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(key);

      copyButton.textContent = "Copied";

      setTimeout(() => {
        copyButton.textContent = "Copy key";
      }, 1500);
    } catch {
      showError("Unable to copy key.");
    }
  });

  keyBox.appendChild(keyText);

  container.appendChild(title);
  container.appendChild(keyBox);
  container.appendChild(copyButton);

  button.parentElement.insertBefore(
    container,
    button
  );

  button.classList.add("hidden");
}

async function getActivationKey(code) {
  const response = await fetch(
    `/api/key?code=${encodeURIComponent(code)}`,
    {
      method: "GET",
      cache: "no-store"
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok || !data.key) {
    throw new Error(
      data.error ||
        "Activation key could not be retrieved."
    );
  }

  return data.key;
}

/*
 * Handle the hash returned by Linkvertise.
 *
 * Linkvertise returns:
 *
 * /?hash=...
 *
 * The Worker uses the secure session cookie
 * to identify the activation code.
 */
async function handleVerification(hash) {
  try {
    const response = await fetch(
      `/verify?hash=${encodeURIComponent(hash)}`,
      {
        method: "GET",
        redirect: "follow",
        cache: "no-store"
      }
    );

    /*
     * If the Worker redirected us to:
     *
     * /?code=123456
     *
     * follow that URL.
     */
    if (response.redirected) {
      window.location.replace(response.url);
      return;
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
            "Linkvertise verification failed."
        );
      }

      return;
    }

    if (!response.ok) {
      throw new Error(
        "Linkvertise verification failed."
      );
    }
  } catch (error) {
    console.error(error);

    showError(
      error.message ||
        "Verification failed."
    );

    button.disabled = false;
    button.textContent = "Get code";
  }
}

/*
 * Check whether the current session
 * already has an activation key.
 */
async function checkExistingKey(code) {
  try {
    const key =
      await getActivationKey(code);

    showActivationKey(key);

    return true;
  } catch {
    return false;
  }
}

/*
 * Get a new Linkvertise redirect.
 */
async function requestLinkvertise(code) {
  const response = await fetch(
    `/api/get-code?code=${encodeURIComponent(code)}`,
    {
      method: "POST",
      cache: "no-store"
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      data.error ||
        "Unable to continue."
    );
  }

  /*
   * Session already verified.
   */
  if (data.verified === true) {
    const key =
      data.activationKey ||
      await getActivationKey(code);

    showActivationKey(key);

    return;
  }

  /*
   * Send the user to Linkvertise.
   */
  if (data.redirect) {
    window.location.href = data.redirect;
    return;
  }

  throw new Error(
    "Linkvertise redirect was not provided."
  );
}

/*
 * Get code button.
 */
button.addEventListener("click", async () => {
  hideError();

  const params =
    new URLSearchParams(
      window.location.search
    );

  const code =
    params.get("code");

  if (!code || !/^\d{6}$/.test(code)) {
    showError(
      "Invalid activation session."
    );

    return;
  }

  button.disabled = true;
  button.textContent = "Processing...";

  try {
    /*
     * If the session already has a key,
     * display it instead of starting
     * Linkvertise again.
     */
    const alreadyHasKey =
      await checkExistingKey(code);

    if (alreadyHasKey) {
      return;
    }

    await requestLinkvertise(code);
  } catch (error) {
    console.error(error);

    showError(
      error.message ||
        "Something went wrong."
    );

    button.disabled = false;
    button.textContent = "Get code";
  }
});

/*
 * Automatically process Linkvertise
 * return URL:
 *
 * /?hash=...
 */
(async () => {
  const params =
    new URLSearchParams(
      window.location.search
    );

  const hash =
    params.get("hash");

  if (!hash) {
    return;
  }

  button.disabled = true;
  button.textContent = "Verifying...";

  await handleVerification(hash);
})();
