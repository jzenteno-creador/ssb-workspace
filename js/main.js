/* Entry module de la modularización (PASO 0, 2026-07).
   Orden de imports = orden de ejecución. Los módulos corren DIFERIDOS:
   después de TODOS los <script> clásicos y antes de DOMContentLoaded —
   ningún símbolo publicado acá existe en parse-time de un script clásico
   (regla dura: CLAUDE.md "asimetría clásico/módulo"). */
import './shared/toast.js';
import './shared/autocomplete.js';
import './shared/nav.js';
import './shared/app-shell.js';
import './shared/mm-writes.js';

// features (balde 2)
import './features/schema.js';
import './features/workspace-ia.js';
import './features/agente.js';
import './features/cert-origen.js';
import './features/detention.js';
import './features/seguimiento.js';
import './features/control-bl.js';
import './features/mailing.js';
import './features/tt-dow.js';
import './features/vacaciones.js';
import './features/schedule-rt.js';

// features (balde 3 — B3.4 EL CARVE: tarifas + efa + admin-bid, ciclo ESM legal,
// cero lectura top-level de imports — ver plan §6.c)
import './features/tarifas.js';
import './features/efa.js';
import './features/admin-bid.js';

// E.1/T8 (2026-07-17): solapa Administración — solo flag CO
import './features/admin-co.js';
