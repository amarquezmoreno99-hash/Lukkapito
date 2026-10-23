// Small DOM and formatting helpers shared by the views.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// ISO "YYYY-MM-DD" -> "DD/MM/YYYY". Returns "" for empty input.
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// Today as ISO "YYYY-MM-DD" in local time.
export function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Inline warning icon (the brand forbids emojis such as "⚠").
export function iconWarning() {
  return `<svg class="icon icon--warning" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3 2 21h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M12 10v5M12 18v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
