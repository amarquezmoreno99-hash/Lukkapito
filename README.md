# Asistente de Proyectos

Aplicación web interna de Lukkap para registrar proyectos de cliente, generar actas de reunión con IA, gestionar to-do's y cerrar proyectos.

> Documento en construcción: se completa al final de cada fase. La guía de despliegue en GitHub Pages y la configuración de la IA llegarán en sus fases.

## Cómo funciona

- **GitHub Pages** sirve la web (HTML, CSS y JavaScript, sin compilación).
- **Supabase** guarda los datos de todo el equipo y gestiona el acceso por email.
- **Claude (Anthropic)** genera las actas y resúmenes a través de una función de Supabase, con una única clave de empresa.

## Configuración de Supabase

Solo hay que hacerlo una vez. Tiempo estimado: 20 minutos. Los nombres de los menús pueden variar ligeramente si Supabase actualiza su panel.

### 1. Crear el proyecto

1. Entra en https://supabase.com y crea una cuenta (puedes usar tu cuenta de GitHub).
2. Pulsa **New project** y rellena:
   - **Name:** `lukkapito`
   - **Database password:** genera una y guárdala en un lugar seguro (no la necesitará la aplicación).
   - **Region:** una de Europa, por ejemplo *West EU (Ireland)* o *Central EU (Frankfurt)*.
3. Pulsa **Create new project** y espera un par de minutos.

> **Plan gratuito:** los proyectos gratuitos se pausan tras una semana sin actividad (se reactivan desde el panel). Para el uso diario del equipo se recomienda el plan Pro.

### 2. Crear las tablas y las reglas de acceso

1. En el menú izquierdo, abre **SQL Editor** y pulsa **New query**.
2. Copia **todo** el contenido de [`supabase/migrations/20261023120000_init.sql`](supabase/migrations/20261023120000_init.sql), pégalo y pulsa **Run**.
3. Debe aparecer *Success. No rows returned*.

### 3. Darte de alta como primer administrador

En una nueva consulta del **SQL Editor**, cambia el email y el nombre y pulsa **Run**:

```sql
insert into public.allowed_users (email, name, role)
values (lower('tu.email@lukkap.com'), 'Tu Nombre', 'admin');
```

A partir de aquí, el resto de usuarios se darán de alta desde la pantalla **Administración** de la aplicación.

### 4. Bloquear el acceso a emails no autorizados

1. Ve a **Authentication → Hooks** y pulsa **Add hook**.
2. Elige **Before User Created**.
3. Tipo **Postgres**, esquema `public`, función `hook_before_user_created`.
4. Guarda.

Con esto, Supabase no crea cuentas ni envía enlaces a emails que no estén en la lista.

### 5. Ajustes de inicio de sesión

1. **Authentication → Sign In / Providers:**
   - **Email** debe estar activado.
   - **Allow new users to sign up** debe estar **activado** (el paso 4 ya limita quién puede entrar).
2. **Authentication → URL Configuration:**
   - **Site URL:** `https://amarquezmoreno99-hash.github.io/Lukkapito/`
   - **Redirect URLs:** añade `https://amarquezmoreno99-hash.github.io/Lukkapito/` y, para pruebas en local, `http://localhost:8000/`.

### 6. Emails en español

En **Authentication → Emails → Templates**, cambia estas dos plantillas (la primera se envía la primera vez que alguien entra; la segunda, las siguientes):

**Confirm signup** y **Magic Link**

- **Subject:** `Tu enlace de acceso al Asistente de Proyectos`
- **Body:**

```html
<h2>Hola:</h2>
<p>Pulsa el siguiente enlace para entrar en el Asistente de Proyectos de Lukkap:</p>
<p><a href="{{ .ConfirmationURL }}">Entrar en el Asistente de Proyectos</a></p>
<p>El enlace caduca en una hora y solo puede usarse una vez. Si no has pedido este acceso, ignora este mensaje.</p>
```

### 7. Servidor de correo propio (antes de dar acceso al equipo)

El correo que incluye Supabase **solo envía emails a los miembros de tu organización de Supabase** y unos pocos por hora. Sirve para probar con tu propio email, pero no para el equipo.

Antes de dar de alta a más personas:

1. Crea una cuenta en un servicio de envío, por ejemplo [Resend](https://resend.com) o [Brevo](https://www.brevo.com) (ambos con plan gratuito), y verifica el dominio desde el que se enviarán los emails.
2. En **Authentication → Emails → SMTP Settings**, activa **Enable custom SMTP** y copia los datos que te da ese servicio.
3. En **Authentication → Rate Limits**, sube el límite de emails por hora (por ejemplo, a 100).

### 8. Conectar la aplicación con Supabase

1. Pulsa el botón **Connect** (arriba en el panel) o ve a **Project Settings → API Keys**.
2. Copia:
   - **Project URL** (algo como `https://abcdefgh.supabase.co`).
   - **Publishable key** (empieza por `sb_publishable_`) o, si solo ves claves *legacy*, la **anon public**.
3. Pégalos en [`js/config.js`](js/config.js).

Estos dos valores son públicos por diseño: los datos están protegidos por las reglas de acceso. **Nunca** pegues en la aplicación la clave *secret* / *service_role* ni la clave de Anthropic.

## Probar en local

La app no necesita compilación. Desde la carpeta del proyecto:

```bash
python3 -m http.server 8000
```

y abre http://localhost:8000 en el navegador.

## Pruebas automáticas de las reglas de acceso

[`supabase/tests/test_rls.py`](supabase/tests/test_rls.py) comprueba, contra un PostgreSQL local, que solo los usuarios de la lista pueden leer o escribir datos y que solo los administradores pueden borrar proyectos o gestionar usuarios.
