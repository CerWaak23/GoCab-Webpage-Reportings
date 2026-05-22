# GoCab Portal de Reportes — Documentación Completa

> Última actualización: 2026-05-22  
> Redactado para traspasar el proyecto a Claude Code y desplegarlo en **gobillschile.lat**

---

## 1. Qué es esto

Portal web privado de GoCab Chile para ver reportes financieros y de flota. Solo accesible con emails `@gocab.io`. Construido en **Next.js 14** con Tailwind CSS. Autenticación propia (sin OAuth externo): el usuario ingresa su email `@gocab.io`, el servidor valida contra una lista hardcodeada y emite una cookie HMAC-SHA256 firmada.

---

## 2. Dominio objetivo

**gobillschile.lat** — dominio comprado por el usuario. El proyecto debe quedar corriendo ahí.

Stack recomendado de despliegue: **Vercel** (gratis para Next.js, zero-config). Alternativa: cualquier VPS con `npm run build && npm start` detrás de Nginx.

---

## 3. Estructura de archivos

```
C:\Users\andre\OneDrive\Escritorio\GoCab\Dashboard\
├── src/
│   ├── app/
│   │   ├── page.js                          ← Login (ruta /)
│   │   ├── layout.js
│   │   ├── globals.css
│   │   ├── dashboard/
│   │   │   └── page.js                      ← Dashboard principal (lista de reportes)
│   │   ├── reports/
│   │   │   ├── financial/
│   │   │   │   └── page.js                  ← Reporte Financiero (solo gerentes)
│   │   │   └── bills/
│   │   │       └── page.js                  ← Reporte de Deudas de Flota (todos)
│   │   └── api/
│   │       └── auth/
│   │           ├── login/route.js           ← POST /api/auth/login
│   │           └── logout/route.js          ← POST /api/auth/logout
│   ├── components/
│   │   ├── LoginButton.js                   ← Formulario de login (client component)
│   │   ├── LogoutButton.js
│   │   ├── LangSwitcher.js                  ← Botones ES/EN/RU, sincroniza iframe
│   │   ├── CurrencySwitcher.js              ← Botones CLP/USD, sincroniza iframe
│   │   └── LocalizedDashboard.js            ← Dashboard con i18n
│   └── lib/
│       ├── session.js                       ← HMAC-SHA256 cookie auth
│       └── users.js                         ← Lista de usuarios permitidos
├── public/
│   └── reports/
│       ├── financial-dashboard.html         ← HTML standalone del reporte financiero
│       └── fleet-debt-report.html           ← HTML standalone del reporte de flota
├── middleware.js                            ← Protege /dashboard y /reports
├── next.config.mjs
├── package.json
├── tailwind.config.js
└── postcss.config.js
```

---

## 4. Cómo funciona la autenticación

1. Usuario escribe `nombre@gocab.io` en la página `/`
2. `LoginButton.js` hace `POST /api/auth/login` con el email
3. `login/route.js` llama `getUserByEmail(email)` de `src/lib/users.js`
4. Si el usuario existe → crea token HMAC-SHA256 con `createSessionToken()` → lo guarda en cookie `gocab_session` (httpOnly, secure en prod)
5. Frontend hace `router.push('/dashboard')`
6. `middleware.js` protege todas las rutas bajo `/dashboard` y `/reports`: si no hay cookie → redirige a `/`
7. Server Components llaman `getAppSession()` para leer y verificar el token

**Variable de entorno requerida:**
```
NEXTAUTH_SECRET=cualquier_string_largo_y_secreto
```

---

## 5. Usuarios registrados

Definidos en `src/lib/users.js`. **Para agregar usuarios, editar ese archivo.**

| Nombre | Email | Rol | ¿Acceso financiero? |
|--------|-------|-----|---------------------|
| Joy Varela | joy.varela@gocab.io | Coordinador de Flota | ❌ |
| Shamil Tokarev | shamil.tokarev@gocab.io | Gerente de Producto | ✅ |
| Andrés Cerda | andres.cerda@gocab.io | Gerente de Operaciones | ✅ |
| Felipe Catalan | felipe.catalan@gocab.io | Gerente de Pais | ✅ |

Regla: cualquier rol que contenga "gerente" (case-insensitive) → `isManager: true` → acceso a `/reports/financial`.

Un `@gocab.io` no registrado obtiene rol "Colaborador" con `isManager: false` (acceso básico al dashboard y reporte de flota).

---

## 6. Páginas y rutas

| Ruta | Archivo | Quién accede |
|------|---------|-------------|
| `/` | `app/page.js` | Público (login) |
| `/dashboard` | `app/dashboard/page.js` | Todos los usuarios autenticados |
| `/reports/financial` | `app/reports/financial/page.js` | Solo `isManager: true` |
| `/reports/bills` | `app/reports/bills/page.js` | Todos los usuarios autenticados |
| `POST /api/auth/login` | `app/api/auth/login/route.js` | Público |
| `POST /api/auth/logout` | `app/api/auth/logout/route.js` | Autenticados |

---

## 7. Los reportes HTML (los archivos más importantes)

Los reportes son **archivos HTML autocontenidos** en `public/reports/`. Se sirven estáticos y se muestran dentro de un `<iframe>` en las páginas de Next.js. No dependen de ningún componente React.

### 7.1 Dashboard Financiero (`public/reports/financial-dashboard.html`)

**Qué hace:** Lee el Google Sheet de pagos de GoCab, muestra KPIs (ingresos, egresos, flujo de caja), gráficos de líneas (operaciones SumUp por mes, ingresos totales), gráfico de barras (top proveedores), tabla filtrable de transacciones. Soporta 3 idiomas (ES/EN/RU) y 2 monedas (CLP/USD).

**IDs de Google Drive:**
- Google Sheet principal: `19DJ_O0CoNir8_ESgnct_fo-z_q0mbxzjejHvQ0A_ZtY`
- Carpeta SumUp en Drive: `1IR7ETMtvoi-LF4AXbfalbO2th_b_ImNi`

**Cómo carga datos:** Usa `window.cowork.callMcpTool('read_file_content', { file_id: FILE_ID })` — esto es la API de Cowork (Claude Desktop). En producción web, este mecanismo NO existe. **Ver sección 9 para la migración necesaria.**

**Idiomas:** ES (default), EN, RU — baked directamente en el HTML como objetos JS `LANGS`.

**Monedas:** CLP (default), USD — conversion con tasa hardcodeada `USD_RATE = 950`.

**Botones de idioma/moneda:** Usan `onclick="setLang('es')"` / `onclick="setCurrency('CLP')"` directamente en el HTML para que funcionen incluso si hay un modal de permisos activo. Los iframes reciben el cambio vía `postMessage` desde `LangSwitcher.js` y `CurrencySwitcher.js`.

### 7.2 Reporte de Flota (`public/reports/fleet-debt-report.html`)

**Qué hace:** Carga el último archivo de bills de conductores desde Google Drive, calcula KPIs de cobranza (deuda total, % recuperado, activos vs despedidos), muestra evolución histórica semanal (gráfico de líneas), distribución de deuda por tipo (doughnut), tabla de conductores con deuda pendiente.

**IDs de Google Drive:**
- Carpeta de bills: `1Fd3sia5XyN1tXuk2pvQfbrIbmV_o-sKh` (contiene subcarpetas semanales)

**Mismo problema:** Usa `window.cowork.callMcpTool`. Necesita migración. **Ver sección 9.**

**Fixes recientes aplicados (mayo 2026):**
- Gráfico de recuperación: envuelto en `<div style="position:relative;height:200px;width:100%">` para evitar crecimiento infinito (bug de Chart.js con `maintainAspectRatio:false`)
- Doughnut card: restaurado con `display:flex;flex-direction:column;align-items:center` + container interno `width:240px;height:240px`

---

## 8. Componentes clave

### `LangSwitcher.js`
- Client component, guarda lang en `localStorage('gocab_lang')`
- Dispara `CustomEvent('gocab_lang_change', { detail: lang })`
- Si recibe prop `iframeSelector="iframe"`, también llama `iframe.contentWindow.setLanguage(lang)` directamente

### `CurrencySwitcher.js`
- Client component, guarda en `localStorage('gocab_currency')`
- Dispara `CustomEvent('gocab_currency_change', { detail: currency })`
- Si recibe prop `iframeSelector="iframe"`, llama `iframe.contentWindow.setCurrency(currency)` directamente

### `LocalizedDashboard.js`
- Escucha los eventos de lang para re-renderizar el dashboard en el idioma correcto
- Strings de i18n definidos en `LangSwitcher.js` en el objeto `LANGS`

---

## 9. ⚠️ Problema crítico para producción: `window.cowork` no existe en la web

Los archivos HTML en `public/reports/` usan `window.cowork.callMcpTool(...)` para leer Google Drive. Esto es un API de Claude Desktop (Cowork). **En gobillschile.lat esto no existe y los reportes cargarán vacíos.**

### Solución recomendada

Crear una API route en Next.js que actúe de proxy hacia Google Drive/Sheets usando la **Google Sheets API** y una **Service Account**:

```
/api/sheets/[fileId]/route.js   ← lee un Google Sheet y devuelve filas JSON
/api/drive/[folderId]/route.js  ← lista archivos en una carpeta de Drive
```

Luego en los HTML, reemplazar:
```js
// ANTES (solo funciona en Cowork/Claude Desktop)
const data = await window.cowork.callMcpTool('read_file_content', { file_id: FILE_ID });

// DESPUÉS (funciona en producción web)
const data = await fetch(`/api/sheets/${FILE_ID}`).then(r => r.json());
```

**Credenciales necesarias para Google API:**
- Crear un proyecto en Google Cloud Console
- Habilitar Google Sheets API y Google Drive API
- Crear Service Account → descargar JSON de credenciales
- Compartir los sheets/folders con el email de la service account
- Variables de entorno: `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON stringificado) o `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`

---

## 10. Variables de entorno requeridas

```env
# Obligatoria — firma las cookies de sesión
NEXTAUTH_SECRET=un_string_largo_y_aleatorio_minimo_32_chars

# Para producción en Vercel
NEXTAUTH_URL=https://gobillschile.lat

# Para Google API (necesario para que los reportes funcionen en web)
GOOGLE_CLIENT_EMAIL=service-account@proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

---

## 11. Cómo desplegar en Vercel (paso a paso)

1. Subir el proyecto a un repositorio GitHub (solo la carpeta `Dashboard/`)
2. Ir a [vercel.com](https://vercel.com) → New Project → importar el repo
3. Framework preset: **Next.js** (autodetectado)
4. Agregar las variables de entorno en Vercel Dashboard → Settings → Environment Variables
5. En el DNS de gobillschile.lat (panel del registrador), agregar un registro CNAME:
   - Nombre: `@` o `www`
   - Valor: `cname.vercel-dns.com`
6. En Vercel → Settings → Domains → agregar `gobillschile.lat`
7. Deploy automático en cada push a main

---

## 12. Cómo desplegar en VPS (alternativa)

```bash
# En el servidor (Ubuntu)
git clone <repo> /var/www/gocab
cd /var/www/gocab
npm install
npm run build

# Variables de entorno
echo "NEXTAUTH_SECRET=..." >> .env.local
echo "NEXTAUTH_URL=https://gobillschile.lat" >> .env.local

# Iniciar con PM2
npm install -g pm2
pm2 start npm --name "gocab" -- start
pm2 save

# Nginx reverse proxy
# server { listen 443 ssl; server_name gobillschile.lat; location / { proxy_pass http://localhost:3000; } }
```

---

## 13. Cowork Artifacts (contexto — no parte del portal web)

Los artifacts son páginas HTML que viven **dentro de Claude Desktop** (Cowork), no en la web. Son independientes del portal Next.js pero muestran los mismos datos.

| Artifact ID | Nombre | Archivo fuente |
|-------------|--------|----------------|
| `gocab-financial-dashboard` | Gocab Financial Dashboard | `outputs/financial-dashboard.html` |
| `fleet-debt-report` | Fleet Debt Report | `outputs/fleet-debt-report.html` |

Los scheduled tasks que publican datos al portal:
- `gocab-publish-financial` — publica el HTML financiero
- `gocab-publish-fleet` — publica el HTML de flota

Los archivos en `public/reports/` del portal Next.js son copias de los HTML de los artifacts, publicadas por estos scheduled tasks.

---

## 14. Dependencias del proyecto

```json
{
  "next": "14.2.3",
  "react": "^18",
  "react-dom": "^18",
  "next-auth": "^4.24.7"
}
```

> `next-auth` está en package.json como dependencia legacy (de una versión anterior). La autenticación actual NO usa NextAuth — usa el sistema HMAC propio en `src/lib/session.js`. Se puede eliminar `next-auth` del package.json sin romper nada.

---

## 15. Resumen de tareas para Claude Code

- [ ] Crear API route `/api/sheets/[fileId]` con Google Sheets API + Service Account
- [ ] Crear API route `/api/drive/[folderId]` para listar archivos en carpeta Drive
- [ ] Modificar `public/reports/financial-dashboard.html` para usar `/api/sheets/...` en lugar de `window.cowork.callMcpTool`
- [ ] Modificar `public/reports/fleet-debt-report.html` para usar `/api/drive/...` + `/api/sheets/...`
- [ ] Configurar variables de entorno para producción
- [ ] Desplegar en Vercel con dominio gobillschile.lat
- [ ] Verificar que login, rutas protegidas, y ambos reportes funcionen en producción
