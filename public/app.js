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
  const sessionCode = params.get("code");

  if (!sessionCode || !/^\d+$/.test(sessionCode)) {
    showError("Invalid activation session.");
    return;
  }

  button.disabled = true;
  button.textContent = "Processing...";

  try {
    const response = await fetch(
      `/api/get-code?code=${encodeURIComponent(sessionCode)}`,
      {
        method: "POST"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    if (data.redirect) {
      window.location.href = data.redirect;
      return;
    }

    throw new Error("Invalid server response.");

  } catch (error) {
    console.error(error);

    showError(error.message || "Something went wrong.");

    button.disabled = false;
    button.textContent = "Get code";
  }
});
