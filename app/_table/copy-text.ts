"use client";
// Text to the clipboard: the async Clipboard API where the page may use it (a secure origin), else, or when
// it refuses, the older selected-textarea copy, which the tailnet's plain-http address still allows.

function textareaCopy(text: string): void {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed"; area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("the browser refused to copy");
  } finally {
    area.remove();
  }
}

export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // refused (a permission, a lost focus): the selected-textarea copy may still be allowed
    }
  }
  textareaCopy(text);
}
