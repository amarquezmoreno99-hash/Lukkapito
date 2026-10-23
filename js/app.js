// Entry point: auth guard, header menu and hash router.

import * as storage from './storage.js';
import * as home from './views/home.js';
import * as login from './views/login.js';
import { createPlaceholder } from './views/placeholder.js';
import { escapeHtml } from './ui.js';

const routes = {
  '/': home,
  '/proyecto/nuevo': createPlaceholder('Abrir un proyecto'),
  '/reunion': createPlaceholder('Subir transcript o notas de reunión'),
  '/todos': createPlaceholder("Consultar to-do's"),
  '/cierre': createPlaceholder('Finalizar un proyecto'),
  '/preguntar': createPlaceholder('Preguntar sobre un proyecto'),
  '/admin': createPlaceholder('Administración', { adminOnly: true }),
};

const notFound = createPlaceholder('Página no encontrada');

const main = document.getElementById('main');
const userNav = document.getElementById('user-nav');

// Signed-in allowlist entry ({ email, name, role }); null while signed out.
let member = null;

function renderUserNav() {
  if (!member) {
    userNav.innerHTML = '';
    return;
  }
  userNav.innerHTML = `
    ${member.role === 'admin' ? '<a class="btn" href="#/admin">Administración</a>' : ''}
    <span>${escapeHtml(member.name)}</span>
    <button class="btn" type="button" id="logout-btn">Cerrar sesión</button>`;
  userNav.querySelector('#logout-btn').addEventListener('click', async () => {
    try {
      await storage.signOut();
    } catch {
      // Even if the server call fails, the local session is cleared.
    }
    showLogin();
  });
}

function showLogin(error) {
  member = null;
  renderUserNav();
  login.render(main, { error });
}

function showNotConfigured() {
  main.innerHTML = `
    <section class="auth-panel panel">
      <h1>Configuración pendiente</h1>
      <p>La aplicación todavía no está conectada a su base de datos. Un administrador debe completar el archivo <code>js/config.js</code> siguiendo el README.</p>
    </section>`;
}

// Magic-link failures come back as "#error=...&error_code=...". supabase-js
// leaves them in the URL, so read them here and clean the URL.
function takeAuthErrorFromUrl() {
  const params = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  if (!params.has('error') && !params.has('error_code')) return null;
  history.replaceState(null, '', `${location.pathname}#/`);
  return params.get('error_code') === 'otp_expired' ? storage.MESSAGES.linkExpired : storage.MESSAGES.generic;
}

function currentPath() {
  const path = location.hash.replace(/^#/, '');
  return path.startsWith('/') ? path : '/';
}

async function navigate() {
  if (!member) return;
  const view = routes[currentPath()] ?? notFound;
  try {
    await view.render(main, { member });
  } catch (err) {
    console.error(err);
    main.innerHTML = `<section class="panel"><p class="empty-state">${escapeHtml(err.userMessage ?? 'Ha ocurrido un error al cargar la pantalla. Recarga la página e inténtalo de nuevo.')}</p></section>`;
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function start() {
  if (!storage.isConfigured) {
    showNotConfigured();
    return;
  }

  const urlError = takeAuthErrorFromUrl();
  try {
    const session = await storage.getSession();
    if (!session) {
      showLogin(urlError);
      return;
    }
    member = await storage.getCurrentMember(session);
    if (!member) {
      // Signed in, but no longer on the allowlist.
      await storage.signOut().catch(() => {});
      showLogin(storage.MESSAGES.notAllowed);
      return;
    }
  } catch (err) {
    showLogin(err.userMessage ?? storage.MESSAGES.generic);
    return;
  }

  renderUserNav();
  storage.onSignedOut(() => showLogin());
  navigate();
}

window.addEventListener('hashchange', navigate);
start();
