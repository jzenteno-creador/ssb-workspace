/* === BULK PASTE — componente reusable de pegado masivo (js/shared/bulk-paste.js — ES Module) ===
   TANDA C (Certificados de Origen). Reusable por cualquier feature que necesite
   "pegar desde Excel → previsualizar → validar → confirmar fila a fila" (primer
   consumidor: js/features/cert-origen.js; consumidor futuro anunciado: Tarifas
   Terrestres). NO tiene conocimiento de ningún dominio — orden/certificado/tarifa
   son 100% responsabilidad del consumidor via `columns`/`onValidate`/`onConfirm`.

   Import: `import { createBulkPaste, parseBulkPasteText } from '../shared/bulk-paste.js';`
   (import ES estándar módulo→módulo — NO es un símbolo de script clásico, no aplica
   la regla de "identificador pelado vía window").

   ── CONTRATO EXACTO ──────────────────────────────────────────────────────────
   createBulkPaste(opts) → { el, setText(text), reset() }

   opts = {
     columns: [{ key, label, normalize?(raw:string):string, validate?(value:string):string|null }],
       // obligatorio, ≥1 columna. Orden del array = orden esperado de las columnas
       // pegadas Y orden de las columnas de la tabla de preview.
     maxRows: number = 200,
       // filas no-vacías más allá de este límite se IGNORAN (no se procesan ni se
       // muestran) — se avisa con un hint arriba de la tabla.
     onValidate?: async (rows) => [{status, detail?}],
       // rows = SOLO las filas que ya pasaron el validate() sincrónico por columna
       // (formato). Las que fallan formato NUNCA llegan acá — no pierdas tiempo
       // filtrándolas de nuevo. El array de vuelta debe tener EXACTAMENTE el mismo
       // largo y orden que `rows` (si no matchea, el componente bloquea TODO el
       // lote por seguridad — falla cerrado, no assumeas 'valid').
       //   status === 'valid' | 'warning'  → la fila queda confirmable
       //   cualquier otro string           → la fila queda BLOQUEADA (se pinta con
       //                                      el `detail` dado; label genérico
       //                                      "Bloqueada" — el detail es lo que
       //                                      importa, ponelo descriptivo)
       // rows[i] = { line: number, values: {[colKey]: valorNormalizado} }
     onConfirm(rows, reportProgress): async (rows, reportProgress) => any,
       // obligatorio. rows = filas confirmables (status 'valid'|'warning' tras el
       // Validar), MISMA forma que en onValidate: { line, values }. El LOOP
       // secuencial es responsabilidad del consumidor (regla dura: "N llamadas
       // secuenciales al endpoint existente", nunca Promise.all/concurrencia acá).
       // reportProgress(i, status, detail?): i = índice dentro de ESTE array
       // `rows` (0-based, NO es `line`). status:
       //   'confirming' → en curso (pinta neutro + label "Cargando i+1/N…" en el botón)
       //   'ok'         → éxito (badge success + detail)
       //   cualquier otro string → falla (badge danger + detail)
       // El resumen final (N ok / M error) lo calcula el COMPONENTE contando los
       // reportProgress recibidos — el valor de retorno de onConfirm se ignora.
     confirmTitle?: string,               // default: 'Cargar filas'
     confirmBody?: (n:number) => string,  // default genérico con el conteo
     confirmButtonLabel?: string,         // default: 'Confirmar y cargar'
   }

   Devuelve:
     el          → HTMLElement raíz, montalo donde quieras (createElement puro).
     setText(s)  → precarga el textarea con `s` (p.ej. "118828606\tAR004A18…") y
                   re-parsea al toque (invalida cualquier validación/confirm previo).
                   NO hace scroll ni foco — eso es responsabilidad del consumidor.
     reset()     → limpia textarea + estado completo (igual que el botón Limpiar).

   ── DISEÑO ──
   - Parser puro exportado aparte (`parseBulkPasteText`) — testeable sin DOM/browser.
   - DOM 100% vía createElement/textContent — CERO innerHTML con datos dinámicos.
   - Estilos: SOLO clases globales del design system (`badge`/`badge--*`) + estilos
     inline mínimos con `var(--token)` (custom properties son globales a :root/body,
     visibles sin importar dónde se monte el componente) — CERO CSS nuevo en islas
     (este módulo no vive scoped a ningún panel: el mismo componente se monta en
     paneles distintos).
   - Helpers clásicos (ssbConfirm/ssbToast) se consumen como identificador PELADO —
     shim window.X publicado por js/shared/toast.js, mismo patrón que mailing.js/
     seguimiento.js (grep confirmado: ningún import explícito ahí tampoco). */

// ── Parser puro (testeable sin DOM) ──────────────────────────────────────────
// Separadores tolerados: tabulación, ';' o 2+ espacios (mismo molde que
// parseAtdGrid/parseGiGrid de mailing.js/seguimiento.js) — NUNCA un solo espacio
// (rompería valores con espacios internos). Con 1 sola columna no se separa nada:
// toda la línea trimeada es el valor.
export function parseBulkPasteText(text, columns, maxRows = 200) {
  if (!Array.isArray(columns) || !columns.length)
    throw new Error('parseBulkPasteText: columns debe ser un array no vacío.');
  const cap = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 200;
  const lines = String(text || '').split(/\r?\n/);
  const rows = [];
  let totalNonEmpty = 0;
  let truncated = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue; // líneas vacías: se ignoran, no son error
    totalNonEmpty++;
    if (rows.length >= cap) { truncated = true; continue; } // sigue contando totalNonEmpty para el hint

    const line = i + 1;
    const tokens = columns.length === 1
      ? [raw.trim()]
      : raw.split(/[\t;]+|\s{2,}/).map(s => s.trim()).filter(Boolean);

    const row = { line, raw: raw.trim(), values: {}, status: 'invalid', detail: null, confirmStatus: null, confirmDetail: null };

    if (tokens.length !== columns.length) {
      row.detail = `Se esperaban ${columns.length} columna(s) (${columns.map(c => c.label).join(', ')}) — se encontraron ${tokens.length}. Revisá los separadores (tabulación, ; o 2+ espacios).`;
      rows.push(row);
      continue;
    }

    const msgs = [];
    columns.forEach((col, ci) => {
      const rawCell = tokens[ci];
      let value = rawCell;
      try {
        if (typeof col.normalize === 'function') value = col.normalize(rawCell);
      } catch (e) {
        msgs.push(`${col.label}: normalize() falló — ${e.message}`);
      }
      row.values[col.key] = value;
      if (typeof col.validate === 'function') {
        try {
          const msg = col.validate(value);
          if (msg) msgs.push(`${col.label}: ${msg}`);
        } catch (e) {
          msgs.push(`${col.label}: validate() falló — ${e.message}`);
        }
      }
    });

    if (msgs.length) row.detail = msgs.join(' · ');
    else row.status = 'pending'; // formato OK — pendiente del pase de Validar (onValidate)
    rows.push(row);
  }

  return { rows, truncated, totalNonEmpty };
}

// ── Badges de estado (mapeo genérico, sin vocabulario de dominio) ──
const STATUS_BADGE = {
  pending:    ['badge badge--neutral', 'Sin validar'],
  invalid:    ['badge badge--danger',  'Formato inválido'],
  valid:      ['badge badge--success', 'Válida'],
  warning:    ['badge badge--warning', 'Atención'],
  confirming: ['badge badge--neutral', 'Procesando…'],
  ok:         ['badge badge--success', 'Cargada'],
  error:      ['badge badge--danger',  'Error'],
};
function badgeFor(status) {
  return STATUS_BADGE[status] || ['badge badge--danger', 'Bloqueada'];
}

function mk(tag, { cls, text, style, attrs, type } = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (type) n.type = type;
  if (style) Object.assign(n.style, style);
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

export function createBulkPaste(opts) {
  const o = opts || {};
  const columns = Array.isArray(o.columns) && o.columns.length ? o.columns : null;
  if (!columns) throw new Error('createBulkPaste: opts.columns debe ser un array no vacío.');
  if (typeof o.onConfirm !== 'function') throw new Error('createBulkPaste: opts.onConfirm es obligatorio.');
  const onValidate = typeof o.onValidate === 'function' ? o.onValidate : null;
  const onConfirm = o.onConfirm;
  const maxRows = Number.isFinite(o.maxRows) && o.maxRows > 0 ? Math.floor(o.maxRows) : 200;
  const confirmTitle = o.confirmTitle || 'Cargar filas';
  const confirmBody = typeof o.confirmBody === 'function'
    ? o.confirmBody
    : (n) => `Vas a cargar ${n} fila(s). El servidor se llama una vez por fila, en orden — no se puede deshacer en lote.`;
  const confirmButtonLabel = o.confirmButtonLabel || 'Confirmar y cargar';

  // ── estado interno ──
  let _rows = [];
  let _truncated = false;
  let _totalNonEmpty = 0;
  let _validated = false;   // hubo un pase de Validar sobre el _rows actual
  let _confirmDone = false; // ya se corrió onConfirm sobre ese pase — bloquea re-envío accidental
  let _busy = false;

  // ── DOM ──
  const root = mk('div', { cls: 'bp-root', style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 16px' } });

  const hint = mk('p', {
    text: `Pegá desde Excel — una fila por línea. Columnas esperadas, en este orden: ${columns.map(c => c.label).join(' · ')}. Separador: tabulación (o ; / 2+ espacios). Máximo ${maxRows} fila(s) por lote.`,
    style: { fontSize: '12.5px', color: 'var(--muted)', margin: '0 0 8px', lineHeight: '1.5' },
  });
  root.appendChild(hint);

  const truncHint = mk('p', { style: { fontSize: '12px', color: 'var(--amber)', margin: '0 0 8px', display: 'none' } });
  root.appendChild(truncHint);

  const ta = mk('textarea', {
    attrs: { 'aria-label': 'Pegado masivo', spellcheck: 'false', rows: '6', placeholder: columns.map(c => c.label).join('\t') },
    style: {
      width: '100%', boxSizing: 'border-box', fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: '12.5px',
      color: 'var(--text)', background: 'var(--faint)', border: '1px solid var(--border)', borderRadius: '9px',
      padding: '10px 12px', resize: 'vertical', minHeight: '110px',
    },
  });
  root.appendChild(ta);

  const toolbar = mk('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '10px 0' } });
  const rowCountEl = mk('span', { text: '0 fila(s)', style: { fontSize: '12px', color: 'var(--muted)', marginRight: 'auto' } });
  const btnStyle = (primary) => ({
    display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font)', fontSize: '13px', fontWeight: '700',
    padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
    color: primary ? '#06251f' : 'var(--text)',
    background: primary ? 'var(--teal)' : 'var(--surface)',
    border: primary ? 'none' : '1px solid var(--border)',
  });
  const btnValidar = mk('button', { type: 'button', text: 'Validar', style: btnStyle(false) });
  const btnConfirmar = mk('button', { type: 'button', text: confirmButtonLabel, style: btnStyle(true) });
  const btnLimpiar = mk('button', { type: 'button', text: 'Limpiar', style: btnStyle(false) });
  btnConfirmar.disabled = true;
  toolbar.append(rowCountEl, btnValidar, btnConfirmar, btnLimpiar);
  root.appendChild(toolbar);

  const previewWrap = mk('div', { style: { overflowX: 'auto', display: 'none' } });
  const table = mk('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '520px' } });
  const thead = mk('thead');
  const trh = mk('tr');
  const thStyle = { textAlign: 'left', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', padding: '7px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  trh.appendChild(mk('th', { text: 'Línea', style: thStyle }));
  for (const c of columns) trh.appendChild(mk('th', { text: c.label, style: thStyle }));
  trh.appendChild(mk('th', { text: 'Estado', style: thStyle }));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = mk('tbody');
  table.appendChild(tbody);
  previewWrap.appendChild(table);
  root.appendChild(previewWrap);

  const summaryEl = mk('p', { style: { fontSize: '13px', fontWeight: '700', margin: '10px 0 0', display: 'none' } });
  root.appendChild(summaryEl);

  // ── render ──
  function fillStatusTd(td, row) {
    while (td.firstChild) td.removeChild(td.firstChild);
    const displayStatus = row.confirmStatus || row.status;
    const [cls, lbl] = badgeFor(displayStatus);
    td.appendChild(mk('span', { cls, text: lbl }));
    const detail = row.confirmStatus ? row.confirmDetail : row.detail;
    if (detail) td.appendChild(mk('div', { text: detail, style: { fontSize: '11px', color: 'var(--muted)', marginTop: '2px', maxWidth: '360px', overflowWrap: 'anywhere' } }));
  }

  function tdStyle() { return { padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text)', verticalAlign: 'top' }; }

  function buildRowTr(row) {
    const tr = document.createElement('tr');
    tr.appendChild(mk('td', { text: String(row.line), style: { ...tdStyle(), fontFamily: 'var(--mono, monospace)', color: 'var(--muted)' } }));
    for (const c of columns) {
      const rawTok = row.values[c.key];
      const td = mk('td', { text: rawTok == null || rawTok === '' ? '—' : String(rawTok), style: tdStyle() });
      tr.appendChild(td);
    }
    const stTd = document.createElement('td');
    Object.assign(stTd.style, tdStyle());
    fillStatusTd(stTd, row);
    tr.appendChild(stTd);
    row._statusTd = stTd;
    return tr;
  }

  function renderPreview() {
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    rowCountEl.textContent = _rows.length
      ? `${_rows.length} fila(s) pegada(s)`
      : '0 fila(s)';
    if (_truncated) {
      truncHint.textContent = `Se pegaron ${_totalNonEmpty} línea(s) — se procesan solo las primeras ${maxRows} (límite del lote). Cargá el resto en otra tanda.`;
      truncHint.style.display = '';
    } else {
      truncHint.style.display = 'none';
    }
    if (!_rows.length) { previewWrap.style.display = 'none'; return; }
    previewWrap.style.display = '';
    for (const row of _rows) tbody.appendChild(buildRowTr(row));
  }

  function confirmableRows() {
    return _rows.filter(r => r.status === 'valid' || r.status === 'warning');
  }

  function refreshButtons() {
    const n = confirmableRows().length;
    btnConfirmar.disabled = _busy || !_validated || _confirmDone || n < 1;
    btnValidar.disabled = _busy || !_rows.length;
    btnLimpiar.disabled = _busy;
    if (!_busy) btnConfirmar.textContent = confirmButtonLabel;
  }

  // ── parse (live, solo formato — barato) ──
  function doParse() {
    const { rows, truncated, totalNonEmpty } = parseBulkPasteText(ta.value, columns, maxRows);
    _rows = rows;
    _truncated = truncated;
    _totalNonEmpty = totalNonEmpty;
    _validated = false;
    _confirmDone = false;
    summaryEl.style.display = 'none';
    renderPreview();
    refreshButtons();
  }
  const debouncedParse = typeof debounce === 'function' ? debounce(doParse, 250) : doParse;

  // ── Validar (formato ya corrido en doParse; acá corre onValidate) ──
  async function runValidate() {
    if (_busy) return;
    doParse(); // por si quedó un debounce sin flushear
    if (!_rows.length) { ssbToast('Pegá al menos una fila antes de validar.', 'warning'); return; }
    _busy = true;
    refreshButtons();
    btnValidar.textContent = 'Validando…';
    const candidates = _rows.filter(r => r.status === 'pending');
    try {
      if (onValidate && candidates.length) {
        const publicRows = candidates.map(r => ({ line: r.line, values: { ...r.values } }));
        let results = null;
        try {
          results = await onValidate(publicRows);
        } catch (e) {
          candidates.forEach(r => { r.status = 'invalid'; r.detail = 'Error de validación: ' + e.message; });
          results = null;
        }
        if (results !== null) {
          if (!Array.isArray(results) || results.length !== candidates.length) {
            // Falla cerrado: si onValidate no respeta el contrato, NO se asume 'valid'.
            candidates.forEach(r => {
              r.status = 'invalid';
              r.detail = 'La validación extra no devolvió un resultado por fila (contrato roto) — revisá onValidate.';
            });
          } else {
            candidates.forEach((r, i) => {
              const res = results[i] || {};
              const st = res.status || 'valid';
              r.status = st;
              r.detail = res.detail || (st === 'valid' ? null : r.detail);
            });
          }
        }
      } else {
        candidates.forEach(r => { r.status = 'valid'; });
      }
    } finally {
      _validated = true;
      _busy = false;
      btnValidar.textContent = 'Validar';
      renderPreview();
      refreshButtons();
    }
  }

  // ── Confirmar/Cargar ──
  async function runConfirm() {
    if (_busy || !_validated || _confirmDone) return;
    const confirmable = confirmableRows();
    if (!confirmable.length) return;
    const ok = await ssbConfirm({ title: confirmTitle, body: confirmBody(confirmable.length), confirmText: 'Cargar' });
    if (!ok) return;
    _busy = true;
    refreshButtons();
    const publicRows = confirmable.map(r => ({ line: r.line, values: { ...r.values } }));
    const reportProgress = (i, status, detail) => {
      const row = confirmable[i];
      if (!row) return; // índice fuera de rango — defensivo
      row.confirmStatus = status;
      row.confirmDetail = detail || null;
      if (row._statusTd) fillStatusTd(row._statusTd, row);
      if (status === 'confirming') btnConfirmar.textContent = `Cargando ${i + 1}/${confirmable.length}…`;
    };
    try {
      await onConfirm(publicRows, reportProgress);
    } catch (e) {
      confirmable.forEach(r => {
        if (r.confirmStatus !== 'ok') {
          r.confirmStatus = 'error';
          r.confirmDetail = 'onConfirm no terminó: ' + e.message;
          if (r._statusTd) fillStatusTd(r._statusTd, r);
        }
      });
    }
    // Defensivo: cualquier fila sin resultado final (onConfirm no llamó reportProgress
    // para ella) se marca error explícito — nunca queda en un estado ambiguo.
    confirmable.forEach(r => {
      if (!r.confirmStatus) {
        r.confirmStatus = 'error';
        r.confirmDetail = 'Sin resultado del servidor.';
        if (r._statusTd) fillStatusTd(r._statusTd, r);
      }
    });
    const nOk = confirmable.filter(r => r.confirmStatus === 'ok').length;
    const nErr = confirmable.length - nOk;
    summaryEl.textContent = `${nOk} cargada(s) · ${nErr} con error`;
    summaryEl.style.color = nErr ? 'var(--amber)' : 'var(--green)';
    summaryEl.style.display = '';
    ssbToast(`${nOk} cargada(s) · ${nErr} con error`, nErr ? 'warning' : 'success');
    _busy = false;
    _confirmDone = true;
    refreshButtons();
  }

  function clearAll() {
    if (_busy) return;
    ta.value = '';
    _rows = []; _truncated = false; _totalNonEmpty = 0; _validated = false; _confirmDone = false;
    summaryEl.style.display = 'none';
    renderPreview();
    refreshButtons();
    ta.focus();
  }

  ta.addEventListener('input', debouncedParse);
  btnValidar.addEventListener('click', runValidate);
  btnConfirmar.addEventListener('click', runConfirm);
  btnLimpiar.addEventListener('click', clearAll);

  refreshButtons();

  return {
    el: root,
    setText(text) {
      ta.value = text == null ? '' : String(text);
      doParse();
    },
    reset() { clearAll(); },
  };
}
