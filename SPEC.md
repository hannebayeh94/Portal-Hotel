# Hotel Admin Portal - Modernization Spec

## Overview
Server-rendered (EJS) hotel administration portal in Spanish. Core features: guest management, room inventory, reservations with check-in/checkout, seasonal pricing and promotions, billing/invoicing, and OCR-based extraction of data from Colombian national ID cards (cédula de ciudadanía).

## Goals
- 100% functional modernized portal
- Unique design with best UI/UX practices
- Modern features and improved usability
- Clean, maintainable code following best practices
- Better logic flow and error handling

## Architecture

### Tech Stack
- **Framework**: Express.js with EJS templates
- **Database**: SQL.js (WASM-compiled SQLite) with serialized `hotel.db`
- **Authentication**: express-session (in-memory store, 8h cookie)
- **Frontend**: Inline styles in EJS (public/css/js empty) — will add TailwindCSS
- **OCR**: Tesseract.js + zxing-wasm for cédula parsing
- **Build**: None (direct `node app.js`)

### Folder Structure
```
app.js                  # Main entry, session auth, route wiring
models/database.js      # SQL.js wrapper, initialization, schema migrations
routes/                 # 1:1 mapped to app.use() mounts
  auth.js               # Login/logout
  guests.js             # /huespedes CRUD + search
  rooms.js              # /habitaciones CRUD
  reservations.js       # /reservas CRUD + pricing
  admin.js              # /admin: tarifas, temporadas, promociones, reportes, facturacion
  api.js                # /api: JSON endpoints, OCR upload
  checkin.js            # /checkin checkout flow
views/                  # EJS views
  layouts/              # header.ejs, footer.ejs
  auth/                 # login.ejs
  guests/               # index, nuevo, detalle
  rooms/                # index, nuevo, detalle
  reservations/         # index, nuevo, detalle
  admin/                # tarifas, temporadas, promociones, reportes, facturacion
  partials/             # header, footer, nav
public/                 # static assets (will add Tailwind, images)
  uploads/              # cedula uploads (multer disk storage)
scripts/                # set-admin-password.js
Dockerfile              # node:22-slim, npm ci --omit=dev, node app.js
```

### Route Mapping (app.js)
- `/` → authRoutes (login/logout) + dashboard (requires auth)
- `/api` → apiRoutes (JSON endpoints)
- `/checkin` → requireAuth + checkinRoutes
- `/huespedes` → requireAuth + guestRoutes
- `/habitaciones` → requireAuth + roomRoutes
- `/reservas` → requireAuth + reservationRoutes
- `/admin` → requireAuth + adminRoutes

## Database Schema (modernized)

### Tables (existing, with improvements)
- `usuarios` - user authentication (add `password_reset_token`, `password_reset_expires`)
- `huespedes` - guests (add `telegram_chat_id` for notifications, `fecha_alta`)
- `habitaciones` - rooms (add `ultima_mantenimiento`, `estado_limpieza`)
- `temporadas` - seasonal multipliers (keep, add `fecha_actualizacion`)
- `tarifas` - rate overrides (keep, add `activo` flag management)
- `promociones` - discount codes (keep, add `usos_maximos`)
- `reservas` - reservations (add `fecha_creacion`, mejorar control de `pagado`)
- `facturas` - invoices (keep, add `fecha_pago`)
- `checkins` - check-in records (keep)

### Migration Notes
- Follow conditional-ALTER pattern for existing `hotel.db` files
- Add indexes for query performance
- Preserve Spanish column names and enum values

## Modern Features Plan

### 1. Authentication & Session
- Add `passport-local` or keep simple session with bcrypt
- Remember me functionality
- Password reset flow
- Session security flags (httpOnly, sameSite)

### 2. Dashboard (modernized)
- KPI cards with sparkline charts
- Real-time occupancy graph (using Chart.js)
- Quick action buttons: Nueva reserva, Huéspedes, Habitaciones
- Today's check-ins/check-outs list
- Recent reservations table

### 3. Guests Management
- Search/filter by nombre, apellido, cédula
- Pagination
- Export to CSV
- Cédula OCR upload (already exists, improve UI)
- Validation on form fields

### 4. Rooms Management
- Visual room grid (available/occupied/maintenance colors)
- Quick state toggle
- Service amenities checklist
- Price configuration per type

### 5. Reservations (core modernization)
- **Pricing logic**: 
  - Base price from room `precio_base`
  - Highest active `temporada` multiplicador covering `fecha_entrada`
  - Promotion discount (percentage or fixed, normalized to percentage)
  - Display breakdown: base → season → promo → taxes
- **Availability check**: Use exact overlap predicate `fecha_entrada <= ? AND fecha_salida > ?`
- **Conflict prevention**: Check both directions before saving
- **Checkout**: Auto-generate unpaid `factura` with 19% tax if none exists
- **Status flow**: pendiente → confirmada → checkin → checkout
- **Search**: By fecha, estado, huesped, habitación

### 6. Admin Panel
- **Tarifas**: Override prices per room type per date range
- **Temporadas**: Seasonal date ranges with multipliers; UI with date picker
- **Promociones**: Códigos de descuento (porcentaje/fijo), usos máximos, fechas
- **Reportes**: 
  - Ingresos por mes (chart)
  - Ocupación por temporada
  - Top de huéspedes
  - Facturas pendientes
- **Facturación**: 
  - Listado con búsqueda
  - Marcar como pagada
  - Ver/descargar PDF
  - Filtrar por fecha, estado, método pago

### 7. API Endpoints (JSON for client-side)
- `GET /api/huespedes/autocomplete` - search huéspedes
- `GET /api/habitaciones-disponibles` - availability search (use overlap predicate)
- `POST /api/extraer-datos` - OCR cédula upload and parsing
- `GET /api/ocupacion` - occupation chart data
- `GET /api/ingresos-mensuales` - monthly income chart data

### 8. OCR Cédula Pipeline (modernize)
- Keep existing `cedulaOCR.js` and `cedulaParser.js`
- Improve UI: drag-and-drop upload, preview, success/error messages
- Better preprocessing: contrast adjustment, threshold options
- PDF417 barcode via zxing-wasm with multiple crop/scale combos
- Merge barcode data with OCR text (barcode preferred)
- Validate extracted fields against regex patterns
- Show parsed fields editable before saving

### 9. UI/UX Design
- **Framework**: Add TailwindCSS v3 for rapid, consistent styling
- **Color scheme**: Unique palette (not default blue-gray)
- **Typography**: System font stack, headings scaled
- **Responsive**: Mobile-first, works on tablets too
- **Components**: Buttons, inputs, modals, tables, forms styled consistently
- **Feedback**: Loading spinners, toast notifications (sweetalert2), error/success messages
- **Accessibility**: aria-labels, focus outlines, color contrast > 4.5:1
- **Animations**: Subtle fade-ins, hover effects, chart transitions

### 10. Code Quality & Best Practices
- **Parameterized SQL**: All queries use `dbAll`/`dbGet`/`dbRun` with params (already done)
- **Error handling**: Try/catch in routes, proper error views
- **Validation**: Express-validator or manual checks on form inputs
- **Modularization**: Extract SQL queries to separate constants/file
- **Comments**: Spanish comments where needed (convention)
- **No ORM**: Keep raw SQL but well-organized
- **Testing**: Manual verification; could add simple assertion scripts
- **Performance**: Indexes on foreign keys and frequently searched columns
- **Security**: 
  - Passwords bcrypt (already)
  - SQL injection prevented via parameterized queries
  - Session secret via env var
  - CORS not needed (server-rendered)
  - File upload validation (type, size) for cédula images

## Implementation Plan (phases)

### Phase 1: Foundation & Design
1. Add TailwindCSS to `package.json` and build setup
2. Create `public/css` with Tailwind directives
3. Update `views/layouts/header.ejs` and `footer.ejs` with responsive markup
4. Migrate inline styles to Tailwind classes
5. Add basic Toast/sweetalert2 integration

### Phase 2: Dashboard & Core Views
6. Modernize `views/dashboard.ejs` with KPI cards and charts (Chart.js)
7. Update nav highlighting in `header.ejs`
8. Create consistent form layouts for nuevo/detalle views

### Phase 3: Guests & Rooms
9. Refactor `routes/guests.js` and `views/guests/` with search, pagination, OCR UI
10. Refactor `routes/rooms.js` and `views/rooms/` with visual grid and state toggles

### Phase 4: Reservations & Pricing
11. Rewrite `routes/reservations.js` with modern pricing logic breakdown
12. Add availability check using exact overlap predicate
13. Improve checkout auto-invoice generation
14. Add reservation search/filter

### Phase 5: Admin & Reports
15. Modernize `routes/admin.js` with mejoradas UIs for tarifas, temporadas, promociones
16. Add report charts and export functionality
17. Improve invoice list/PDF view with filters

### Phase 6: API & OCR
18. Update `routes/api.js` endpoints with better JSON structures
19. Improve OCR upload UI and parsing feedback
20. Add validation and error handling on parsed data

### Phase 7: Polish & QA
21. Cross-device testing (desktop, tablet, mobile)
22. Browser compatibility (Chrome, Firefox, Edge)
3. Accessibility audit
4. Performance profiling
5. Bug fixes from eval passes

## Open Questions / Decisions Needed
1. **CSS framework**: Use TailwindCDN or install locally? (Recommended: install locally with PostCSS)
2. **Chart library**: Chart.js vs Chart.js-plugin-datalabels vs something else? (Use Chart.js core)
3. **OCR image validation**: Max size? Allowed types (jpg,png,pdf)? 
4. **Promotion discount stacking**: Can multiple promos apply per reservation? (Probably not; first one wins)
5. **Database persistence**: Should we migrate from sql.js to better-sqlite3 for performance? (Keep sql.js for now to avoid build complications; note as technical debt)

## Success Criteria
- Portal renders without errors on fresh `hotel.db`
- All CRUD operations work for huéspedes, habitaciones, reservas
- Pricing logic correctly applies season multiplier then promotion discount
- OCR extracts at least: nombre, apellido, número_cedula, fecha_nacimiento, dirección from cédula
- Dashboard shows reasonable KPI counts
- Mobile view is usable without horizontal scrolling
- No console errors on page load
- Spanish UI strings consistent throughout