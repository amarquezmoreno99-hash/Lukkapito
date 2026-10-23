// Login screen: request a magic link by email.

import { sendMagicLink } from '../storage.js';
import { escapeHtml, iconWarning } from '../ui.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function renderAlert(message) {
  return message
    ? `<div class="alert alert--error" role="alert">${iconWarning()}<p>${escapeHtml(message)}</p></div>`
    : '';
}

function renderForm(container, { error = '', email = '' } = {}) {
  container.innerHTML = `
    <section class="auth-panel panel" aria-labelledby="login-title">
      <h1 id="login-title">Accede a tu espacio</h1>
      <p>Escribe tu email de trabajo y te enviaremos un enlace para entrar. No necesitas contraseña.</p>
      <div id="login-alert">${renderAlert(error)}</div>
      <form id="login-form" class="stack" novalidate>
        <div class="field">
          <label for="login-email">Email</label>
          <input id="login-email" name="email" type="email" autocomplete="email"
                 inputmode="email" required value="${escapeHtml(email)}"
                 aria-describedby="login-email-error">
          <p class="field__error" id="login-email-error" hidden></p>
        </div>
        <button class="btn btn--primary" type="submit">Enviar enlace de acceso</button>
      </form>
    </section>`;

  const form = container.querySelector('#login-form');
  const input = form.querySelector('#login-email');
  const fieldError = form.querySelector('#login-email-error');
  const button = form.querySelector('button');

  function showFieldError(message) {
    fieldError.innerHTML = message ? `${iconWarning()}${escapeHtml(message)}` : '';
    fieldError.hidden = !message;
    input.setAttribute('aria-invalid', String(Boolean(message)));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim().toLowerCase();
    container.querySelector('#login-alert').innerHTML = '';

    const problem = !value
      ? 'Escribe tu email.'
      : !EMAIL_PATTERN.test(value) ? 'Revisa el email: el formato no es válido.' : '';
    showFieldError(problem);
    if (problem) {
      input.focus();
      return;
    }

    button.disabled = true;
    button.textContent = 'Enviando…';
    try {
      await sendMagicLink(value);
      renderSent(container, value);
    } catch (err) {
      container.querySelector('#login-alert').innerHTML = renderAlert(err.userMessage);
      button.disabled = false;
      button.textContent = 'Enviar enlace de acceso';
    }
  });
}

function renderSent(container, email) {
  container.innerHTML = `
    <section class="auth-panel panel" aria-labelledby="sent-title">
      <h1 id="sent-title" tabindex="-1">Revisa tu correo</h1>
      <p>Hemos enviado un enlace de acceso a <strong>${escapeHtml(email)}</strong>.</p>
      <p>Ábrelo desde este ordenador para entrar. Puede tardar un par de minutos; si no lo ves, mira en la carpeta de correo no deseado.</p>
      <button class="btn" type="button" id="login-retry">Usar otro email</button>
    </section>`;
  container.querySelector('#sent-title').focus();
  container.querySelector('#login-retry').addEventListener('click', () => renderForm(container, { email }));
}

export function render(container, { error } = {}) {
  renderForm(container, { error });
}
