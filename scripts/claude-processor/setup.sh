#!/usr/bin/env bash
# =============================================================================
# setup.sh — Claude_Conversation_Processor
# Configura variables n8n, credencial Claude API y activa el workflow
#
# SELF-CRITIQUE:
# ✅ Email destino: expoarpbb@ssbint.com
# ✅ Storage: Google Drive (no OneDrive)
# ✅ Claude API: configura httpHeaderAuth con x-api-key
# ✅ Workflow ID fijo: 9vo6Vuc7uyOjx7PI (ya creado en n8n)
#
# USO:
#   export N8N_URL=https://jzenteno.app.n8n.cloud
#   export N8N_API_KEY=n8n_api_...
#   export CLAUDE_API_KEY=sk-ant-...
#   export RAW_EXPORTS_FOLDER_ID=<ID de carpeta Google Drive>
#   export PROCESSED_FOLDER_ID=<ID de carpeta Google Drive>
#   export ARCHIVE_FOLDER_ID=<ID de carpeta Google Drive>
#   bash setup.sh
#
# Cómo obtener IDs de carpetas de Google Drive:
#   1. Abrir la carpeta en drive.google.com
#   2. El ID es la parte final de la URL:
#      https://drive.google.com/drive/folders/1ABC_DEF_GHI  →  ID = 1ABC_DEF_GHI
# =============================================================================

set -euo pipefail

# ── Variables ─────────────────────────────────────────────────────────────────
N8N_URL="${N8N_URL:-https://jzenteno.app.n8n.cloud}"
N8N_API_KEY="${N8N_API_KEY:?Variable N8N_API_KEY es requerida}"
CLAUDE_API_KEY="${CLAUDE_API_KEY:?Variable CLAUDE_API_KEY es requerida}"
RAW_EXPORTS_FOLDER_ID="${RAW_EXPORTS_FOLDER_ID:?Variable RAW_EXPORTS_FOLDER_ID es requerida}"
PROCESSED_FOLDER_ID="${PROCESSED_FOLDER_ID:?Variable PROCESSED_FOLDER_ID es requerida}"
ARCHIVE_FOLDER_ID="${ARCHIVE_FOLDER_ID:?Variable ARCHIVE_FOLDER_ID es requerida}"

WORKFLOW_ID="9vo6Vuc7uyOjx7PI"

# Exportar para n8n-cli
export N8N_URL
export N8N_API_KEY

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        Claude_Conversation_Processor — Setup                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Verificar n8n-cli ──────────────────────────────────────────────────────
if ! command -v n8n-cli &>/dev/null; then
  echo "❌ n8n-cli no encontrado."
  echo "   Instalar con: npm install -g @ssbint/n8n-cli"
  echo "   O verificar que esté en PATH."
  exit 1
fi
echo "✅ n8n-cli disponible: $(n8n-cli --version 2>/dev/null || echo 'ok')"

# ── 2. Verificar conexión a n8n ───────────────────────────────────────────────
echo "🔗 Verificando conexión a $N8N_URL ..."
if ! n8n-cli workflow get "$WORKFLOW_ID" --quiet 2>/dev/null; then
  echo "❌ No se pudo conectar a n8n. Verificar N8N_URL y N8N_API_KEY."
  exit 1
fi
echo "✅ Conexión OK — workflow $WORKFLOW_ID encontrado"

# ── 3. Crear variables n8n ────────────────────────────────────────────────────
echo ""
echo "📁 Configurando variables n8n..."

create_or_skip_var() {
  local key="$1"
  local val="$2"
  if n8n-cli variable create --key="$key" --value="$val" --quiet 2>/dev/null; then
    echo "   ✅ Variable creada: $key"
  else
    echo "   ⚠️  Variable $key ya existe — omitida (actualizar manualmente si cambió el ID)"
  fi
}

create_or_skip_var "CLAUDE_RAW_EXPORTS_FOLDER" "$RAW_EXPORTS_FOLDER_ID"
create_or_skip_var "CLAUDE_PROCESSED_FOLDER"   "$PROCESSED_FOLDER_ID"
create_or_skip_var "CLAUDE_ARCHIVE_FOLDER"     "$ARCHIVE_FOLDER_ID"

# ── 4. Crear credencial Claude API Key ───────────────────────────────────────
echo ""
echo "🔑 Configurando credencial 'Claude API Key' (httpHeaderAuth)..."
CRED_DATA="{\"name\":\"x-api-key\",\"value\":\"${CLAUDE_API_KEY}\"}"

CRED_RESULT=$(n8n-cli credential create \
  --type=httpHeaderAuth \
  --name="Claude API Key" \
  --data="$CRED_DATA" --format=json 2>/dev/null || echo "")

if echo "$CRED_RESULT" | grep -q '"id"'; then
  CRED_ID=$(echo "$CRED_RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "   ✅ Credencial creada: ID $CRED_ID"
  echo "   ⚠️  Asignar manualmente en el nodo 'Claude API Analysis' en n8n UI"
else
  echo "   ⚠️  No se pudo crear automáticamente (puede ya existir)."
  echo "   → Crear manualmente: Credentials → New → Header Auth"
  echo "     Name: Claude API Key | Header Name: x-api-key | Value: \$CLAUDE_API_KEY"
fi

# ── 5. Activar workflow ───────────────────────────────────────────────────────
echo ""
echo "⚡ Activando workflow $WORKFLOW_ID ..."
if n8n-cli workflow activate "$WORKFLOW_ID" --quiet 2>/dev/null; then
  echo "   ✅ Workflow activado"
else
  echo "   ⚠️  No se pudo activar automáticamente."
  echo "   → Razón probable: falta asignar credenciales OAuth (Google Drive / Gmail)."
  echo "   → Completar paso 6 y luego activar desde n8n UI."
fi

# ── Output final ──────────────────────────────────────────────────────────────
WORKFLOW_URL="$N8N_URL/workflow/$WORKFLOW_ID"

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "  ID del workflow : $WORKFLOW_ID"
echo "  URL del workflow: $WORKFLOW_URL"
echo "══════════════════════════════════════════════════════════════════"
echo ""
echo "⚠️  PASOS MANUALES RESTANTES (OAuth no se puede automatizar):"
echo ""
echo "  6. Abrir: $WORKFLOW_URL"
echo ""
echo "  7. Credencial Google Drive (4 nodos: Watch, Read, Save, Move):"
echo "     → Click en nodo → Credentials → 'Google Drive account 3'"
echo "        (o crear nueva OAuth2 para jzenteno@ssbint.com)"
echo ""
echo "  8. Credencial Gmail (nodo 'Send Notification'):"
echo "     → Click en nodo → Credentials → 'Gmail account'"
echo "        (o crear nueva OAuth2 para jzenteno@ssbint.com)"
echo ""
echo "  9. Credencial Claude API Key (nodo 'Claude API Analysis'):"
echo "     → Click en nodo → Credentials → 'Claude API Key'"
echo "        (la que se acaba de crear en paso 4)"
echo ""
echo " 10. Activar workflow desde UI (toggle en header del canvas)"
echo ""
echo "  → Test: subir un .md a Google Drive/SSB_International/Claude_Work/Raw_Exports/"
echo ""
echo "  Notificación se enviará a: expoarpbb@ssbint.com"
echo "  Archivos procesados en:    Google Drive/SSB_International/Claude_Work/Processed/"
echo "  Archivos archivados en:    Google Drive/SSB_International/Claude_Work/Archive/"
