/* Entry module de la modularización (PASO 0, 2026-07).
   Orden de imports = orden de ejecución. Los módulos corren DIFERIDOS:
   después de TODOS los <script> clásicos y antes de DOMContentLoaded —
   ningún símbolo publicado acá existe en parse-time de un script clásico
   (regla dura: CLAUDE.md "asimetría clásico/módulo"). */
import './shared/toast.js';
