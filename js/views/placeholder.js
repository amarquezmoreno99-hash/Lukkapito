// Temporary screen for routes that are not built yet.

import { escapeHtml } from '../ui.js';

export function createPlaceholder(title, { adminOnly = false } = {}) {
  return {
    async render(container, { member } = {}) {
      const allowed = !adminOnly || member?.role === 'admin';
      container.innerHTML = `
        <a class="back-link" href="#/">← Volver al inicio</a>
        <div class="page-header">
          <h1>${escapeHtml(title)}</h1>
        </div>
        <section class="panel">
          <p class="empty-state">${allowed
            ? 'Esta pantalla todavía está en construcción.'
            : 'Esta sección solo está disponible para administradores.'}</p>
        </section>`;
    },
  };
}
