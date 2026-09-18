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

function createKeyElement(key) {
  const container = document.createElement("div");

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
      copyButton.textContent = "Copy failed";

      setTimeout(() => {
        copyButton.textContent = "Copy key";
      }, 1500);
    }
  });

  keyBox.appendChild(keyText);
  container.appendChild(title);
  container.appendChild(keyBox);
  container.appendChild(copyButton);

  return container;
}

function showActivationKey(key) {
  const existing = document.getElementById(
    "activation-key-container"
  );

  if (existing) {
    existing.remove();
  }

  const container = createKeyElement(key);

  container.id = "activation-key-container";

  button.parentElement.insertBefore(
    container,
    button
  );

  button.classList.add("hidden");
}

async function getActivationKey(code) {
  const response = await fetch(
    `/api/key?code=${encodeURIComponent(code)}`
  );

  const data = await response.json();

  if (!response.ok || !data.ok || !data.key) {
    throw new Error(
      data.error || "Activation key could not be retrieved."
    );
  }

  return data.key;
}

button.addEventListener("click", async () => {
  hideError();

  const params = new URLSearchParams(
    window.location.search
  );

  const code = params.get("code");

  if (!code || !/^\d{6}$/.test(code)) {
    showError("Invalid activation session.");
    return;
  }

  button.disabled = true;
  button.textContent = "Processing...";

  try {
    /*
     * Ask the Worker for the current session.
     */
    const response = await fetch(
      `/api/get-code?code=${encodeURIComponent(code)}`,
      {
        method: "POST"
      }
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error || "Unable to continue."
      );
    }

    /*
     * Already verified.
     */
    if (data.verified === true) {
      if (data.activationKey) {
        showActivationKey(data.activationKey);
        return;
      }

      const key = await getActivationKey(code);

      showActivationKey(key);
      return;
    }

    /*
     * Redirect to Linkvertise.
     */
    if (data.redirect) {
      window.location.href = data.redirect;
      return;
    }

    throw new Error(
      "Linkvertise redirect was not provided."
    );
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
