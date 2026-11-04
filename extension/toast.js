(() => {
  "use strict";

  globalThis.khanShowToast = (message, success = false) => {
    document.getElementById("khan-auto-login-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "khan-auto-login-toast";
    toast.setAttribute("role", success ? "status" : "alert");
    toast.setAttribute("aria-live", success ? "polite" : "assertive");
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      zIndex: "2147483647",
      maxWidth: "min(420px, 90vw)",
      padding: "16px",
      borderRadius: "8px",
      background: success ? "#176b37" : "#a32222",
      color: "#fff",
      font: "16px/1.5 sans-serif",
      whiteSpace: "pre-wrap",
      boxShadow: "0 4px 16px #0004",
    });
    document.body.appendChild(toast);
  };
})();
