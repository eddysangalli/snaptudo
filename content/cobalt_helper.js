/**
 * SnapTudo - Helper para Cobalt.tools
 * Preenche automaticamente o campo de download a partir do hash da URL (#https://www.youtube.com/watch?v=...)
 * e dispara a extração em 1 clique sem exigir que o usuário cole nada manualmente.
 */

(() => {
  function autoFillAndDownload() {
    const rawHash = window.location.hash;
    if (!rawHash || rawHash.length < 5) return;

    let targetUrl = rawHash.replace(/^#/, "").trim();
    if (targetUrl.startsWith("http%3A") || targetUrl.startsWith("https%3A")) {
      try {
        targetUrl = decodeURIComponent(targetUrl);
      } catch (e) {}
    }

    if (!targetUrl.startsWith("http")) return;

    // Localizar o campo de entrada no Cobalt
    const input = document.querySelector('input[type="url"], input[type="text"], input[name="url"], input');
    if (input) {
      if (!input.value || input.value !== targetUrl) {
        try {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(input, targetUrl);
          } else {
            input.value = targetUrl;
          }
        } catch (e) {
          input.value = targetUrl;
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Localizar o botão de download / salvar ou disparar Enter
      setTimeout(() => {
        const submitBtn = document.querySelector('button[type="submit"], button[aria-label*="download" i], button[aria-label*="salvar" i], form button, .button-download, button[title*="download" i]');
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.click();
        } else {
          try {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
          } catch (e) {}
        }
      }, 350);
    }
  }

  // Tentar no carregamento e em intervalos curtos para aguardar renderização SPA
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoFillAndDownload);
  } else {
    autoFillAndDownload();
  }

  setTimeout(autoFillAndDownload, 600);
  setTimeout(autoFillAndDownload, 1500);
  window.addEventListener("hashchange", autoFillAndDownload);
})();
