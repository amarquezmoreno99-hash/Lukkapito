// Temporary screen for routes that are not built yet.

import { escapeHtml } from '../ui.js';

export function createPlaceholder(title) {
  return {
    async render(container) {
      container.innerHTML = `
        <a class="back-link" href="#/">← Volver al inicio</a>
        <div class="page-header">
          <h1>${escapeHtml(title)}</h1>
        </div>
        <section class="panel">
          <p class="empty-state">Esta pantalla todavía está en construcción.</p>
        </section>`;
    },
  };
}
