const button = document.querySelector("#get-code");

if (button) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Processing...";

    try {
      const params = new URLSearchParams(window.location.search);
      const sessionCode = params.get("code");

      if (!sessionCode) {
        throw new Error("Missing session code.");
      }

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

      button.disabled = false;
      button.textContent = "Get code";
    }
  });
}
