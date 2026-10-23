// Home screen: main action cards plus a compact list of active projects.

import { escapeHtml } from '../ui.js';

const ICONS = {
  open: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  todos: '<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  close: '<path d="M5 12l4 4 10-10"/>',
  ask: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
};

const ACTIONS = [
  { href: '#/proyecto/nuevo', icon: 'open', title: 'Abrir un proyecto', text: 'Registra un nuevo proyecto de cliente con su equipo y fechas.' },
  { href: '#/reunion', icon: 'upload', title: 'Subir transcript o notas de reunión', text: 'Genera el acta de una reunión a partir del transcript o tus notas.' },
  { href: '#/todos', icon: 'todos', title: "Consultar to-do's", text: 'Revisa, actualiza y exporta las tareas de un proyecto.' },
  { href: '#/cierre', icon: 'close', title: 'Finalizar un proyecto', text: 'Cierra un proyecto y genera su resumen de cierre.' },
  { href: '#/preguntar', icon: 'ask', title: 'Preguntar sobre un proyecto', text: 'Haz preguntas libres sobre la información guardada de un proyecto.' },
];

function renderCard(action) {
  return `
    <li>
      <a class="action-card" href="${action.href}">
        <span class="action-card__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[action.icon]}</svg>
        </span>
        <span class="action-card__title">${escapeHtml(action.title)}</span>
        <span class="action-card__text">${escapeHtml(action.text)}</span>
      </a>
    </li>`;
}

// projects: [{ code, client, name, pendingCount, overdueCount }]
function renderProjects(projects) {
  if (!projects.length) {
    return '<p class="empty-state">Todavía no hay proyectos. Empieza abriendo uno.</p>';
  }
  const items = projects.map((p) => `
    <li class="project-list__item">
      <div>
        <strong>${escapeHtml(p.code)}</strong> · ${escapeHtml(p.name)}
        <div class="project-list__meta">${escapeHtml(p.client)}</div>
      </div>
      <div class="badges">
        <span class="badge">${p.pendingCount} pendientes</span>
        ${p.overdueCount ? `<span class="badge badge--danger">${p.overdueCount} vencidos</span>` : ''}
      </div>
    </li>`).join('');
  return `<ul class="project-list">${items}</ul>`;
}

export async function render(container) {
  // Project data arrives in phase 3 (storage.js). Until then the list is empty.
  const projects = [];

  container.innerHTML = `
    <div class="page-header">
      <h1>¿Qué quieres hacer?</h1>
      <p>Elige una acción para empezar.</p>
    </div>
    <ul class="action-grid">${ACTIONS.map(renderCard).join('')}</ul>
    <section class="panel" aria-labelledby="active-projects-title">
      <h2 id="active-projects-title">Proyectos activos</h2>
      ${renderProjects(projects)}
    </section>`;
}
