# Handoff sesión SSB Workspace · 2026-07-07 (F1/F2 CO+PE a PROD + schema viewer/grafo)

## Foco de la sesión
Multi-feature: merge fase ATD (`731a20c`) → solapa **Estructura DB** (F3, 13º módulo) → **vista Grafo ER** (Cytoscape lazy CDN+SRI) + fix hidden-tab → **F1/F2 adjuntos CO+PE en mailing** (PUT LIVE +3 nodos + front). Dos sesiones de CC en paralelo sobre el mismo checkout — estabilizado con worktree dedicada (ya removida) y cruce verificado sin conflicto.

## 1. mailing-docs (F1/F2) — EN PROD
- **master `01c1ff9` == origin**; Vercel sirviendo front F1/F2: chips CO ZIP / CO PDF / PE (data-driven), badge Trade/STO/Tipo?, línea de completitud "Documentos: N de M" en la card de envío.
- **Workflow LIVE `kh6TORgRg9R1Shj1`: versionId `bc45ff7b-83ed-4079-a691-cc2c6ab3301a`** (PIN para futuros PUTs), 28 nodos (+3: `GET certificados_origen`, `Buscar CO PDF`, `Buscar PE` — cadena PL→GETcert→COPDF→PE→Resolver), 16 cred-refs, **TEST_MODE ON**, Gmail ssbintn8n intacto. Espejo `sdk/code_mailing_resolver.js` == jsCode LIVE **byte-idéntico** (sha256 verificado).
- Diseño: CO **híbrido** (fila de `certificados_origen` GANA — zip+pdf por file_id directo — ?? búsqueda Drive por orden para el PDF manual; ZIP solo por tabla, irresoluble por nombre). **PE solo trade** (`order_kind` por formato: `^4` 10díg=STO / `^1` 9díg=trade / desconocido=conservador sin PE), gateado en el Resolver — punto único de enforcement.
- **Smoke LIVE 18/18**: trade `118959520` (co_zip+co_pdf por tabla + PE real adjunto) · STO `4010713063` (**PE existente en Drive IGNORADO — peor-bug probado contra el caso hostil** — y co_pdf por búsqueda, sin fila en tabla) · idempotencia de re-preview. Fila test `ZZTEST-F1F2-SMOKE` insertada y borrada. Gate local 63 asserts PASS.
- Cruce de las 2 sesiones (CRM git + mejora verify) verificado sin conflicto.

## 2. PENDIENTE — PUT-fix1 (NO urgente: latente, hoy NO disparable — verificado contra prod)
- **ALTA**: nodo `GET certificados_origen` **sin filtro `estado=eq.generado`** (`put_mailing_docs.py:51`) → una fila `error` de un Regenerar fallido (más nueva por `created_at`) pisa a la `generado` válida → el CO se pierde en silencio, indistinguible de "nunca se generó". **Fix = 1 parámetro** (`&estado=eq.generado` en la URL).
- **MEDIA**: el harness no verifica el status del PUT de rollback ni reintenta el `activate` (fire-and-forget) → hardening del script.
- **(aparte)** `order_number` sin normalizar en URL/queryStrings de los nodos nuevos — hoy inalcanzable (el padding muere antes en `GET mailing_orders`); si alguna vez aparece padding en la práctica, el fix correcto es **sistémico en `Validar request`**, no parche por nodo.
- **Plan**: fix ALTA+MEDIA en harness chico, **pin `bc45ff7b`**. **Lección**: el gate local mockea los nodos — NO ve bugs en los **PARÁMETROS (URLs)** de nodos nuevos; al agregar nodos, el gate debe cubrir también sus queries, no solo el jsCode del Resolver.

## 3. PENDIENTE John — send TEST en prod bajo TEST_MODE
Trade `118959520` (verás PE real adjunto; co_zip figurará "Falta" salvo que generes su CO por la solapa antes) + STO `4010713063` de contraste (CO PDF sí, PE jamás). Todo va a expoarpbb.

## 4. GOTCHA creds — API n8n
La API pública valida acceso a credenciales **solo al adjuntarlas a nodos NUEVOS**, y exige acceso **PERSONAL** del usuario de la key (los roles de proyecto NO cuentan). Resuelto: John compartió `aQoShf0TVYyf2lrt` (Supabase, era del proyecto "export proyect") y `Hdz3HCDRSA2GStDS` (Drive, era del usuario ssbintn8n) con el usuario de la key. **Regla nueva**: el probe de adjuntabilidad va ANTES del primer PUT que agregue nodos, y con autorización explícita de John (el clasificador de permisos frena el patrón "probar múltiples credenciales" — correctamente).

## 5. RIESGO operativo — sesiones paralelas
Múltiples sesiones de CC sobre ssb-workspace en paralelo: **verificar repo/branch (`git status` + `git rev-parse`) antes de ejecutar CUALQUIER git**; ante trabajo simultáneo, worktree propia por sesión. Esta sesión ya sufrió (y resolvió) un cruce de HEAD; el caso previo generó el commit huérfano `71ccac5`.

## También cerrado en esta sesión
- **F3 Estructura DB** (13º módulo): `api/schema.js` read-only sin input del usuario (queries fijas vía RPC F0), solapa con 25 tablas + 5 vistas + 411 columnas + 16 FKs navegables. En prod.
- **Vista Grafo ER**: Cytoscape 3.30.2 lazy por CDN con SRI, layout compuesto determinístico (cose + grilla de 14 aislados), elegida con render real contra vis-network y Mermaid. + fix hidden-tab (`2497503`). En prod.
- Fase ATD mergeada (`731a20c`) y asimetría prod (workflow Batch B vs front) cerrada.

## Identifiers
master `01c1ff9` · prod https://ssb-workspace.vercel.app · Supabase `xkppkzfxgtfsmfooozsm` · workflow mailing `kh6TORgRg9R1Shj1` **pin `bc45ff7b-83ed-4079-a691-cc2c6ab3301a`** · harness `validador-aduana/n8n/control_de_bill_of_lading/sdk/put_mailing_docs.py` · ramas conservadas: `feat/mailing-docs` (255a1bb), `feat/schema-viewer`, `feat/schema-graph`, `fix/schema-graph-hidden-tab`
