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

button.addEventListener("click", async () => {
  hideError();

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  if (!code || !/^\d{6}$/.test(code)) {
    showError("Invalid activation session.");
    return;
  }

  button.disabled = true;
  button.textContent = "Processing...";

  try {
    const response = await fetch(
      `/api/get-code?code=${encodeURIComponent(code)}`,
      {
        method: "POST"
      }
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to continue.");
    }

    if (data.verified === true) {
      window.location.href =
        `/?code=${encodeURIComponent(code)}`;
      return;
    }

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
      error.message || "Something went wrong."
    );

    button.disabled = false;
    button.textContent = "Get code";
  }
});
