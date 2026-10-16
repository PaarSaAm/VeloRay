// Accessible subscription copying without inline scripts or third-party libraries.
(() => {
  const attach = () => {
    const button = document.getElementById("copy-subscription");
    const input = document.getElementById("subscription");
    const result = document.getElementById("copy-feedback");
    if (!(button instanceof HTMLButtonElement) || !(input instanceof HTMLInputElement) || !result) {
      return;
    }
    button.dataset.originalLabel = button.textContent || "Copy link";
    button.addEventListener("click", async () => {
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(input.value);
          copied = true;
        }
      } catch {
        // Fall back for clients with restrictive clipboard permissions.
      }
      if (!copied) {
        input.focus();
        input.select();
        try {
          copied = document.execCommand("copy");
        } catch {
          copied = false;
        }
        input.setSelectionRange(0, 0);
      }
      result.textContent = copied
        ? button.dataset.success || "Copied"
        : button.dataset.error || "Select and copy the link";
      button.textContent = copied
        ? button.dataset.success || "Copied"
        : button.dataset.error || "Copy manually";
      window.setTimeout(() => {
        button.textContent = button.dataset.originalLabel || "Copy link";
      }, 2200);
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach, { once: true });
  } else {
    attach();
  }
})();
