// Entry point: hash router, header menu and (from phase 2) auth guard.

import * as home from './views/home.js';
import { createPlaceholder } from './views/placeholder.js';
import { escapeHtml } from './ui.js';

const routes = {
  '/': home,
  '/proyecto/nuevo': createPlaceholder('Abrir un proyecto'),
  '/reunion': createPlaceholder('Subir transcript o notas de reunión'),
  '/todos': createPlaceholder("Consultar to-do's"),
  '/cierre': createPlaceholder('Finalizar un proyecto'),
  '/preguntar': createPlaceholder('Preguntar sobre un proyecto'),
  '/admin': createPlaceholder('Administración'),
};

const notFound = createPlaceholder('Página no encontrada');

// Replaced by Supabase Auth in phase 2.
function getCurrentUser() {
  return { name: 'Vista previa', role: 'admin' };
}

function renderUserNav(user) {
  const nav = document.getElementById('user-nav');
  if (!user) {
    nav.innerHTML = '';
    return;
  }
  nav.innerHTML = `
    ${user.role === 'admin' ? '<a class="btn" href="#/admin">Administración</a>' : ''}
    <span>${escapeHtml(user.name)}</span>
    <button class="btn" type="button" id="logout-btn" disabled title="Disponible cuando se active el inicio de sesión">Cerrar sesión</button>`;
}

function currentPath() {
  return location.hash.replace(/^#/, '') || '/';
}

async function navigate() {
  const main = document.getElementById('main');
  const view = routes[currentPath()] ?? notFound;
  try {
    await view.render(main);
  } catch (err) {
    console.error(err);
    main.innerHTML = '<section class="panel"><p class="empty-state">Ha ocurrido un error al cargar la pantalla. Recarga la página e inténtalo de nuevo.</p></section>';
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

renderUserNav(getCurrentUser());
window.addEventListener('hashchange', navigate);
navigate();
