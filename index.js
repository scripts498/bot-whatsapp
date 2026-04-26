const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  getContentType
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
ffmpeg.setFfmpegPath(ffmpegPath);

// ─────────────────────────────────────────
// CONFIGURAÇÕES DO STICKER
// ─────────────────────────────────────────
const STICKER_NOME = "Isaac Bot";
const STICKER_AUTOR = "@isaac";

// ─────────────────────────────────────────
// CONFIGURAÇÃO DA IA (Claude API)
// ─────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || ""; // Defina sua chave no ambiente

// Histórico de conversa por usuário: { jid: [{role, content}] }
const historicoIA = {};

async function perguntarIA(jid, pergunta) {
  if (!historicoIA[jid]) historicoIA[jid] = [];

  historicoIA[jid].push({ role: "user", content: pergunta });

  if (historicoIA[jid].length > 20) {
    historicoIA[jid] = historicoIA[jid].slice(-20);
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content: "Você é o Isaac Bot, um assistente simpático e divertido para grupos do WhatsApp. Responda de forma clara, objetiva e em português brasileiro. Use emojis ocasionalmente para deixar as respostas mais animadas."
          },
          ...historicoIA[jid]
        ]
      })
    });

    const data = await response.json();
    const resposta = data.choices?.[0]?.message?.content || "❌ Não consegui gerar uma resposta agora.";

    historicoIA[jid].push({ role: "assistant", content: resposta });

    return resposta;
  } catch (e) {
    console.log("Erro na API da IA:", e.message);
    return "❌ Erro ao consultar a IA. Tente novamente mais tarde.";
  }
}

// ─────────────────────────────────────────
// LISTAS DE CONTEÚDO (Diversão)
// ─────────────────────────────────────────
const PIADAS = [
  "Por que o livro de matemática se suicidou?\nPorque tinha muitos problemas! 😂",
  "O que o zero disse para o oito?\nBonito cinto! 😄",
  "Por que o esqueleto não briga?\nPorque não tem estômago para isso! 💀",
  "O que é um pontinho amarelo no canto da sala?\nUm milho de castigo! 🌽",
  "Por que o elétron ficou triste?\nPorque perdeu seu par de elétrons... ficou sozinho! ⚡",
  "O que o pato disse para a pata?\nVem cá, pateta! 🦆",
  "Por que o professor levou escada para a aula?\nPorque a matéria era de alto nível! 📚",
  "O que acontece quando você cruza um vampiro com um computador?\nAmore de byte! 🧛‍♂️💻",
  "Por que o café foi preso?\nPorque era um expresso! ☕",
  "O que o oceano disse para a praia?\nNada, só deu uma onda! 🌊"
];

const CURIOSIDADES = [
  "🧠 O cérebro humano tem cerca de 86 bilhões de neurônios, e cada um pode ter até 10.000 conexões!",
  "🐙 Polvos têm três corações, dois dos quais param de bater quando nadam — por isso preferem rastejar!",
  "🍯 O mel nunca estraga. Foram encontrados potes de mel em tumbas egípcias de 3.000 anos atrás, e ainda estava comestível!",
  "🌍 A Terra não é perfeitamente esférica — ela tem um 'barrigão' no equador por causa da rotação!",
  "🦷 Os dentes de tubarão se renovam constantemente. Um tubarão pode ter mais de 30.000 dentes ao longo da vida!",
  "🐘 Elefantes são os únicos animais que não conseguem pular. Mas também são um dos poucos que reconhecem a si mesmos no espelho!",
  "⚡ Um raio é 5x mais quente que a superfície do Sol, atingindo 30.000°C!",
  "🦋 As borboletas provam a comida com os pés — elas têm sensores gustativos nas patas!",
  "🌙 A Lua está se afastando da Terra cerca de 3,8 cm por ano.",
  "🐬 Golfinhos dormem com metade do cérebro acordada para continuar respirando e ficarem alertas a predadores!"
];

const MOTIVACOES = [
  "💪 Cada dia é uma nova chance de ser melhor do que você foi ontem. Aproveite!",
  "🌟 Grandes conquistas começam com um único passo. Dê o seu hoje!",
  "🔥 A diferença entre o possível e o impossível está na sua determinação.",
  "🚀 Você não precisa ser perfeito para começar, mas precisa começar para ser melhor!",
  "🌈 Depois de toda tempestade, vem a calmaria. Continue firme!",
  "💡 Seu único limite é a história que você conta para si mesmo. Reescreva-a!",
  "⭐ Acredite em você mesmo. Você é capaz de muito mais do que imagina!",
  "🎯 Foque no progresso, não na perfeição. Cada passo conta!",
  "🦁 Seja corajoso. A coragem não é a ausência do medo, mas agir apesar dele!",
  "🌱 Crescimento exige desconforto. O que te desafia hoje te fortalece amanhã!"
];

const ELOGIOS = [
  "✨ Você ilumina qualquer ambiente que entra! Que pessoa incrível!",
  "🌟 Sua inteligência e criatividade são verdadeiramente inspiradoras!",
  "💎 Você é uma pessoa rara — autêntica, gentil e especial!",
  "🔥 Você tem uma energia contagiante que faz todos ao redor se sentirem melhor!",
  "🌈 Sua presença torna o mundo um lugar mais bonito!",
  "💪 Você é mais forte do que pensa e mais capaz do que acredita!",
  "⭐ Sua dedicação e esforço são dignos de admiração!",
  "🌺 Você tem um coração enorme e uma bondade genuína — isso é raro!",
  "🚀 Você tem tudo para ir muito longe. Continue assim!",
  "🎯 Você não apenas sonha — você realiza. Isso te torna extraordinário(a)!"
];

const ZOEIRAS = [
  "😂 Você chegou tarde demais... já existia um burro antes de você!",
  "🤣 Se inteligência fosse gasolina, você não teria nem para sair do lugar!",
  "😜 Você é tão lento(a) que até seu sombra te abandona!",
  "😂 Eu já vi tartaruga com mais agilidade que você no WhatsApp!",
  "🤣 Você confunde tanto as coisas que GPS te manda voltar pro útero!",
  "😅 Você é tão esquecido(a) que provavelmente nem lembra que nasceu!",
  "😂 Se fosse pago pra não pensar, você seria rico(a)!",
  "🤣 Você demora tanto pra responder que quando chega já perdeu o contexto!",
  "😜 Você é aquele tipo de pessoa que apaga o histórico do browser... sem nunca ter pesquisado nada!",
  "😂 Seu Wi-Fi deve ser igual ao seu raciocínio: cai toda hora!"
];

// ─────────────────────────────────────────
// ESTADO DOS JOGOS POR GRUPO
// ─────────────────────────────────────────
const estadoJogo = {}; // { groupJid: { tipo: "quiz"|"mito"|"vod"|"desafio", dados: {} } }

const QUIZ_PERGUNTAS = [
  { p: "Qual é a capital do Brasil?", r: "brasília", d: "🏛️ A capital do Brasil é Brasília!" },
  { p: "Quantos planetas tem o sistema solar?", r: "8", d: "🪐 O sistema solar tem 8 planetas (Plutão foi reclassificado em 2006)!" },
  { p: "Qual animal é conhecido como o rei da selva?", r: "leão", d: "🦁 O leão é o rei da selva!" },
  { p: "Em que ano o homem pisou na Lua pela primeira vez?", r: "1969", d: "🌙 Neil Armstrong pisou na Lua em 1969!" },
  { p: "Qual é o maior oceano do mundo?", r: "pacífico", d: "🌊 O Oceano Pacífico é o maior do mundo!" },
  { p: "Quantos lados tem um hexágono?", r: "6", d: "⬡ Um hexágono tem 6 lados!" },
  { p: "Qual é o elemento químico mais abundante no universo?", r: "hidrogênio", d: "⚛️ O hidrogênio é o elemento mais abundante no universo!" },
  { p: "Quem escreveu Dom Quixote?", r: "cervantes", d: "📚 Dom Quixote foi escrito por Miguel de Cervantes!" },
  { p: "Qual país tem a maior população do mundo?", r: "índia", d: "🌍 A Índia é o país mais populoso do mundo desde 2023!" },
  { p: "Quantos ossos tem o corpo humano adulto?", r: "206", d: "🦴 O corpo humano adulto tem 206 ossos!" }
];

const MITOS = [
  { m: "Humanos usam apenas 10% do cérebro.", v: false, d: "❌ MITO! Usamos praticamente todas as regiões do cérebro, apenas não todas ao mesmo tempo." },
  { m: "Raios nunca caem no mesmo lugar duas vezes.", v: false, d: "❌ MITO! Raios podem e frequentemente caem no mesmo lugar várias vezes." },
  { m: "A Grande Muralha da China é visível do espaço a olho nu.", v: false, d: "❌ MITO! Ela é muito estreita para ser vista a olho nu do espaço." },
  { m: "Água fervendo resfria mais rápido que água fria.", v: true, d: "✅ VERDADE! É o Efeito Mpemba — em certas condições, isso pode acontecer." },
  { m: "Os polvos têm três corações.", v: true, d: "✅ VERDADE! Polvos têm três corações: dois branquiais e um sistêmico." },
  { m: "Gatos enxergam no escuro total.", v: false, d: "❌ MITO! Gatos precisam de pelo menos um pouco de luz para enxergar, mas são muito eficientes com pouca luz." },
  { m: "O açúcar causa hiperatividade em crianças.", v: false, d: "❌ MITO! Estudos científicos não encontraram relação entre açúcar e hiperatividade." },
  { m: "Bananas crescem em árvores.", v: false, d: "❌ MITO! Bananas crescem em bananeiras, que são tecnicamente uma erva gigante, não uma árvore!" },
  { m: "O coração para quando você espirra.", v: false, d: "❌ MITO! O ritmo cardíaco pode mudar brevemente, mas o coração não para." },
  { m: "Polvos podem mudar de cor.", v: true, d: "✅ VERDADE! Polvos têm células chamadas cromatóforos que permitem mudar de cor e textura." }
];

const VERDADE_OU_DESAFIO = [
  { tipo: "V", texto: "Qual foi o maior medo que você já enfrentou?" },
  { tipo: "V", texto: "Já mentiu para alguém neste grupo?" },
  { tipo: "V", texto: "Qual é sua maior conquista pessoal?" },
  { tipo: "V", texto: "O que você nunca contou para ninguém aqui?" },
  { tipo: "V", texto: "Já teve uma crush em alguém deste grupo?" },
  { tipo: "D", texto: "Mande uma selfie fazendo uma careta feia agora!" },
  { tipo: "D", texto: "Escreva uma mensagem para seu contato mais recente no WhatsApp dizendo que vai começar a academia!" },
  { tipo: "D", texto: "Imite um animal por 30 segundos em áudio!" },
  { tipo: "D", texto: "Mande 5 emojis que descrevem sua personalidade!" },
  { tipo: "D", texto: "Marque 3 pessoas e diga algo positivo sobre cada uma!" }
];

const DESAFIOS = [
  "🏋️ Faça 20 flexões agora e mande o vídeo!",
  "🎤 Cante 15 segundos de uma música no áudio!",
  "✍️ Escreva uma história de 5 linhas com as palavras: gato, nave espacial e queijo!",
  "🤸 Tente tocar o cotovelo na ponta do nariz (é impossível, mas tente)!",
  "📸 Mande uma foto do item mais esquisito que você tem na sua casa!",
  "🗣️ Diga um trava-língua 3 vezes em áudio: 'O rato roeu a roupa do rei de Roma'",
  "😂 Conte a pior piada que você sabe!",
  "🎭 Imite o participante mais ativo do grupo em um áudio de 30 segundos!",
  "🔢 Conte de 1 a 20 pulando os múltiplos de 3 (diga 'pula' no lugar)!",
  "📱 Mande o décimo print do seu rolo de câmera agora!"
];

const BOLA8_RESPOSTAS = [
  "🎱 Com certeza!", "🎱 É definitivamente assim!", "🎱 Pode contar com isso!",
  "🎱 Sem dúvida!", "🎱 Sim, com certeza!", "🎱 Os sinais apontam que sim!",
  "🎱 Provavelmente sim.", "🎱 As perspectivas são boas.", "🎱 Talvez...",
  "🎱 Difícil de dizer agora.", "🎱 Melhor não contar com isso.", "🎱 Não parece provável.",
  "🎱 Minhas fontes dizem não.", "🎱 As perspectivas não são boas.", "🎱 Definitivamente não!",
  "🎱 Nem em sonho! 😂"
];

// ─────────────────────────────────────────
// INJETA EXIF NO WEBP
// ─────────────────────────────────────────
function injetarExifNoWebP(webpBuffer, nome, autor) {
  try {
    const json = JSON.stringify({
      "sticker-pack-id": "isaacbot",
      "sticker-pack-name": nome,
      "sticker-pack-publisher": autor,
      "emojis": ["🤖"],
    });
    const jsonBuf = Buffer.from(json, "utf-8");
    const chunkId = Buffer.from("EXIF");
    const chunkSize = Buffer.alloc(4);
    chunkSize.writeUInt32LE(jsonBuf.length, 0);
    const exifChunk = Buffer.concat([chunkId, chunkSize, jsonBuf]);
    const padding = jsonBuf.length % 2 !== 0 ? Buffer.alloc(1) : Buffer.alloc(0);
    const riff = webpBuffer.slice(0, 4);
    const webpMagic = webpBuffer.slice(8, 12);
    const rest = webpBuffer.slice(12);
    const newBody = Buffer.concat([webpMagic, exifChunk, padding, rest]);
    const newSize = Buffer.alloc(4);
    newSize.writeUInt32LE(newBody.length, 0);
    return Buffer.concat([riff, newSize, newBody]);
  } catch (e) {
    console.warn("Aviso: falha ao injetar EXIF:", e.message);
    return webpBuffer;
  }
}

// ─────────────────────────────────────────
// BANCO DE DADOS LOCAL (JSON)
// ─────────────────────────────────────────
const DB_PATH = "./db.json";
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      autorizados: [],
      silenciados: {},
      bloqueioFrases: [],
      bloqueioAudios: false,
      antispam: {},
      spyAtivo: {},
      mensagensSalvas: {},
      linksBloqueados: true,
      avisosBloqueio: {},
      modoSoLeitura: {},
      bemVindo: {},
      despedida: {},
      reputacao: {},
      figurinhasBloqueadas: {},
      registroEntradas: {}
    }));
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH));
  if (!data.antispam) data.antispam = {};
  if (!data.spyAtivo) data.spyAtivo = {};
  if (!data.mensagensSalvas) data.mensagensSalvas = {};
  if (!data.avisosBloqueio) data.avisosBloqueio = {};
  if (data.linksBloqueados === undefined) data.linksBloqueados = true;
  if (!data.modoSoLeitura) data.modoSoLeitura = {};
  if (!data.bemVindo) data.bemVindo = {};
  if (!data.despedida) data.despedida = {};
  if (!data.reputacao) data.reputacao = {};
  if (!data.figurinhasBloqueadas) data.figurinhasBloqueadas = {};
  if (!data.registroEntradas) data.registroEntradas = {};
  return data;
}
function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────
// SISTEMA DE DETECÇÃO DE FRASES BLOQUEADAS
// ─────────────────────────────────────────
function normalizarLeet(texto) {
  let t = texto.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const leet = {"0":"o","1":"i","3":"e","4":"a","5":"s","6":"g","7":"t","8":"b","9":"g","@":"a","$":"s","!":"i","+":"t","|":"i"};
  for (const [de, para] of Object.entries(leet)) {
    t = t.split(de).join(para);
  }
  t = t.replace(/[^a-z]/g, "");
  t = t.replace(/(.){2,}/g, "$1$1");
  return t;
}

function extrairConsoantes(palavra) {
  return palavra.replace(/[aeiou]/g, "");
}

function ehSubsequencia(abrev, original) {
  if (abrev.length < 2) return false;
  if (abrev.length < Math.ceil(original.length / 2)) return false;
  let idx = 0;
  for (const letra of abrev) {
    idx = original.indexOf(letra, idx);
    if (idx === -1) return false;
    idx++;
  }
  return true;
}

function contemFraseBloqueada(texto, frasesBloqueadas) {
  const textoNorm = normalizarLeet(texto);
  const textoJuntado = texto.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])[^a-z0-9]+(?=[a-z0-9])/g, "$1")
    .replace(/[^a-z0-9]/g, "");
  const textoJuntadoNorm = normalizarLeet(textoJuntado);

  for (const frase of frasesBloqueadas) {
    const fraseNorm = normalizarLeet(frase);
    if (!fraseNorm) continue;
    if (textoNorm.includes(fraseNorm)) return frase;
    if (textoJuntadoNorm.includes(fraseNorm)) return frase;
    const palavras = textoNorm.match(/[a-z]+/g) || [];
    const consFrase = extrairConsoantes(fraseNorm);
    for (const palavra of palavras) {
      const consPalavra = extrairConsoantes(palavra);
      if (ehSubsequencia(palavra, fraseNorm)) return frase;
      if (consPalavra.length >= 2 && consPalavra === consFrase) return frase;
      if (consPalavra.length >= 2 && ehSubsequencia(consPalavra, consFrase)) return frase;
    }
  }
  return null;
}

// ─────────────────────────────────────────
// CONTROLE DE FLOOD / SPAM
// ─────────────────────────────────────────
const floodMap = {};
function registrarMensagem(groupJid, senderJid, limite = 5000) {
  if (!floodMap[groupJid]) floodMap[groupJid] = {};
  const agora = Date.now();
  if (!floodMap[groupJid][senderJid]) {
    floodMap[groupJid][senderJid] = { mensagens: [agora] };
  } else {
    floodMap[groupJid][senderJid].mensagens = floodMap[groupJid][senderJid].mensagens.filter(
      ts => agora - ts < limite
    );
    floodMap[groupJid][senderJid].mensagens.push(agora);
  }
  return floodMap[groupJid][senderJid].mensagens.length;
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function toJID(numero) {
  if (!numero) return null;
  return numero.replace(/\D/g, "") + "@s.whatsapp.net";
}

function isAutorizado(db, jid, myJid) {
  return jid === myJid || db.autorizados.includes(jid);
}

function isSilenciado(db, jid) {
  const s = db.silenciados[jid];
  if (!s) return false;
  if (s.tipo === "perm") return true;
  if (s.tipo === "temp" && Date.now() < s.ate) return true;
  delete db.silenciados[jid];
  saveDB(db);
  return false;
}

function temLink(texto) {
  return /(https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/|bit\.ly|t\.me|www\.)/i.test(texto);
}

function formatarTempo(ms) {
  const seg = Math.floor(ms / 1000);
  const min = Math.floor(seg / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m ${seg % 60}s`;
  return `${seg}s`;
}

function aleatorio(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─────────────────────────────────────────
// MAIN BOT
// ─────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: ["Isaac Bot", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);
  iniciarEventosGrupo(sock);

  sock.ev.on("connection.update", ({ qr, connection, lastDisconnect }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") console.log("✅ Isaac Bot conectado!");
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconectando em 3s...");
        setTimeout(startBot, 3000);
      } else {
        console.log("❌ Desconectado. Escaneie o QR novamente.");
      }
    }
  });

  // ─── Fila de apagar ───
  const filaApagar = [];
  let apagando = false;

  async function processarFilaApagar() {
    if (apagando || filaApagar.length === 0) return;
    apagando = true;
    while (filaApagar.length > 0) {
      const item = filaApagar.shift();
      try {
        await sock.sendMessage(item.jid, { delete: item.key });
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.log("Erro ao apagar:", e.message);
      }
    }
    apagando = false;
  }

  function agendarApagar(jid, key) {
    filaApagar.push({ jid, key });
    processarFilaApagar();
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const db = loadDB();
      const from = msg.key.remoteJid;
      const isGroup = from.endsWith("@g.us");
      const sender = isGroup ? msg.key.participant : from;
      const isMe = msg.key.fromMe;
      const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
      const msgType = getContentType(msg.message);

      // ── Cache Anti-Delete ──
      if (!isMe && msgType !== "protocolMessage") {
        db.mensagensSalvas[msg.key.id] = msg;
        const keys = Object.keys(db.mensagensSalvas);
        if (keys.length > 300) delete db.mensagensSalvas[keys[0]];
        saveDB(db);
      }

      // ── Anti-Delete ──
      if (msgType === "protocolMessage" && msg.message.protocolMessage?.type === 3) {
        const idApagada = msg.message.protocolMessage.key.id;
        const msgOriginal = db.mensagensSalvas[idApagada];
        if (msgOriginal) {
          const remetente = msgOriginal.key.participant || msgOriginal.key.remoteJid;
          const local = msgOriginal.key.remoteJid.endsWith("@g.us") ? "📢 Grupo" : "📩 Privado";
          await sock.sendMessage(myJid, {
            text: `🗑️ *ANTI-DELETE ATIVADO*\n*De:* @${remetente.split("@")[0]}\n*Local:* ${local}`,
            mentions: [remetente]
          });
          try {
            await sock.copyNForward(myJid, msgOriginal, false);
          } catch (e) {
            console.log("Erro ao encaminhar msg apagada:", e.message);
          }
          delete db.mensagensSalvas[idApagada];
          saveDB(db);
        }
        continue;
      }

      // ── Anti-View Once ──
      const viewOnceMsg =
        msg.message?.viewOnceMessageV2?.message ||
        msg.message?.viewOnceMessageV2Extension?.message ||
        msg.message?.viewOnceMessage?.message ||
        null;

      if (viewOnceMsg) {
        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          const mediaType = getContentType(viewOnceMsg);
          const caption = viewOnceMsg[mediaType]?.caption || "";
          await sock.sendMessage(myJid, {
            text: `🔓 *ANTI-VIEW ONCE*\n*De:* @${sender.split("@")[0]}`,
            mentions: [sender]
          });
          if (mediaType === "imageMessage") {
            await sock.sendMessage(myJid, { image: buffer, caption: caption ? `${caption}\n_(Salvo automaticamente)_` : "_(Salvo automaticamente)_" });
          } else if (mediaType === "videoMessage") {
            await sock.sendMessage(myJid, { video: buffer, caption: caption ? `${caption}\n_(Salvo automaticamente)_` : "_(Salvo automaticamente)_" });
          }
        } catch (e) {
          console.log("Erro ao recuperar view once:", e.message);
        }
      }

      // ── Log de DMs ──
      if (!isGroup && !isMe && !viewOnceMsg && from !== "status@broadcast") {
        const textoPrivado = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "(Mídia ou outro tipo)";
        await sock.sendMessage(myJid, {
          text: `📩 *NOVA DM*\n*De:* @${sender.split("@")[0]}\n*Mensagem:* ${textoPrivado}`,
          mentions: [sender]
        });
        if (msgType !== "conversation" && msgType !== "extendedTextMessage") {
          try { await sock.copyNForward(myJid, msg, false); } catch (e) { }
        }
      }

      // ── Moderação de Grupos ──
      if (isGroup && !isMe) {
const body =
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text ||
  msg.message?.imageMessage?.caption ||
  msg.message?.videoMessage?.caption || "";

        const autorizado = isAutorizado(db, sender, myJid);
        const isFigurinha = msgType === "stickerMessage";
        const LIMITE_SPAM = isFigurinha ? 4 : 6;
        const qtd = registrarMensagem(from, sender);

        if (!autorizado && qtd > LIMITE_SPAM) {
          db.silenciados[sender] = { tipo: "temp", ate: Date.now() + 2 * 60 * 1000 };
          saveDB(db);
          agendarApagar(from, msg.key);
          await sock.sendMessage(from, { text: `⚠️ @${sender.split("@")[0]} foi silenciado por 2 minutos por spam!`, mentions: [sender] });
          continue;
        }

        if (!autorizado && isSilenciado(db, sender)) {
          agendarApagar(from, msg.key);
          continue;
        }

        if (body && db.bloqueioFrases.length > 0) {
          const fraseBloqueada = contemFraseBloqueada(body, db.bloqueioFrases);
          if (fraseBloqueada && !autorizado) {
            agendarApagar(from, msg.key);
            if (!db.avisosBloqueio[sender]) db.avisosBloqueio[sender] = 0;
            db.avisosBloqueio[sender]++;
            saveDB(db);
            const avisos = db.avisosBloqueio[sender];
            let msgAviso = `⚠️ @${sender.split("@")[0]}, palavra proibida detectada! (Aviso ${avisos}/3)`;
            if (avisos >= 3) {
              db.silenciados[sender] = { tipo: "temp", ate: Date.now() + 10 * 60 * 1000 };
              delete db.avisosBloqueio[sender];
              saveDB(db);
              msgAviso = `🔇 @${sender.split("@")[0]} foi silenciado por 10 minutos por usar palavras proibidas repetidamente!`;
            }
            await sock.sendMessage(from, { text: msgAviso, mentions: [sender] });
            continue;
          }
        }

        if (db.bloqueioAudios && msgType === "audioMessage" && !autorizado) {
          agendarApagar(from, msg.key);
          await sock.sendMessage(from, { text: `🔇 @${sender.split("@")[0]}, áudios estão bloqueados neste grupo!`, mentions: [sender] });
          continue;
        }

        if (db.linksBloqueados && body && temLink(body) && !autorizado) {
          agendarApagar(from, msg.key);
          await sock.sendMessage(from, { text: `🔗 @${sender.split("@")[0]}, links não são permitidos neste grupo!`, mentions: [sender] });
          continue;
        }

        if (db.modoSoLeitura[from] && !autorizado) {
          agendarApagar(from, msg.key);
          continue;
        }

        if (db.figurinhasBloqueadas[from] && isFigurinha && !autorizado) {
          agendarApagar(from, msg.key);
          await sock.sendMessage(from, { text: `🚫 @${sender.split("@")[0]}, figurinhas não são permitidas aqui!`, mentions: [sender] });
          continue;
        }
      }

      // ─────────────────────────────────────────
      // COMANDOS
      // ─────────────────────────────────────────
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption || "";

      if (!body.startsWith("!")) continue;

      const [cmd, ...args] = body.trim().split(" ");
      const comando = cmd.toLowerCase();
      const myJidFull = sock.user.id.split(":")[0] + "@s.whatsapp.net";
      const autorizado = isAutorizado(db, sender, myJidFull);

      // ── !ping ──
      if (comando === "!ping") {
        await sock.sendMessage(from, { text: "🏓 Pong! Estou online e te vigiando... 👀" });
      }

if (["!s", "!fig", "!sticker", "!figurinha"].includes(comando)) {
  try {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage;
    const quotedType = quoted ? getContentType(quoted) : null;

    let mediaMsg = msg;
    let mediaType = msgType;

    if (quoted && ["imageMessage", "videoMessage"].includes(quotedType)) {
      mediaMsg = {
        key: {
          remoteJid: from,
          fromMe: false,
          id: contextInfo.stanzaId,
          participant: contextInfo.participant
        },
        message: quoted
      };

      mediaType = quotedType;
    }

    if (!["imageMessage", "videoMessage"].includes(mediaType)) {
      await sock.sendMessage(from, {
        text: "❌ Manda uma foto/vídeo com !fig ou responde uma mídia com !fig"
      });
      continue;
    }

    const buffer = await downloadMediaMessage(mediaMsg, "buffer", {});

    const sticker = new Sticker(buffer, {
      pack: STICKER_NOME,
      author: STICKER_AUTOR,
      type: StickerTypes.FULL,
      quality: 70,
      id: "isaacbot",
      categories: ["🤖"]
    });

    const stickerBuffer = await sticker.toBuffer();

    await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });

  } catch (e) {
    console.log("Erro ao criar figurinha:", e);
    await sock.sendMessage(from, {
      text: `❌ Erro ao criar figurinha: ${e.message}`
    });
  }
}

      // ── !menu ──
      if (comando === "!menu") {
        await sock.sendMessage(from, {
          text: `🤖 *ISAAC BOT — MENU DE COMANDOS*\n\n` +
            `📋 *Gerais*\n` +
            `!ping — Verifica se o bot está online\n` +
            `!menu — Mostra este menu\n\n` +
            `🔨 *Moderação (apenas autorizados)*\n` +
            `!silenciar @usuário — Silencia permanentemente\n` +
            `!silenciar @usuário Xm — Silencia por X minutos\n` +
            `!dessilenciar @usuário — Remove o silêncio\n` +
            `!silenciados — Lista os silenciados\n\n` +
            `🚫 *Bloqueios (apenas autorizados)*\n` +
            `!bloquearfrase [palavra] — Bloqueia uma palavra/frase\n` +
            `!desbloquearfrase [palavra] — Desbloqueia uma palavra\n` +
            `!listarfrases — Lista palavras bloqueadas\n` +
            `!bloquearaudio — Bloqueia áudios no grupo\n` +
            `!desbloquearaudio — Libera áudios no grupo\n` +
            `!bloquearlink — Bloqueia links no grupo\n` +
            `!desbloquearlink — Libera links no grupo\n\n` +
            `👤 *Autorização (apenas dono)*\n` +
            `!autorizar [número] — Autoriza um usuário\n` +
            `!desautorizar [número] — Remove autorização\n` +
            `!autorizados — Lista os autorizados\n\n` +
            `⚙️ *Outros (apenas autorizados)*\n` +
            `!apagar — Apaga a mensagem respondida\n` +
            `!limparavisos @usuário — Limpa avisos de palavras\n\n` +
            `🌟 *Funções OP*\n` +
            `!bemvindo on/off — Mensagem ao entrar no grupo\n` +
            `!despedida on/off — Mensagem ao sair do grupo\n` +
            `!soleltura on/off — Modo só leitura (só adm fala)\n` +
            `!figurinha on/off — Bloqueia figurinhas no grupo\n` +
            `!rep @usuário + — Dá reputação positiva\n` +
            `!rep @usuário - — Dá reputação negativa\n` +
            `!verep @usuário — Vê a reputação de alguém\n` +
            `!topreputacao — Ranking de reputação\n` +
            `!banir @usuário — Remove do grupo\n` +
            `!promover @usuário — Promove a admin\n` +
            `!rebaixar @usuário — Remove admin\n` +
            `!tagall — Marca todos do grupo\n` +
            `!infogrupo — Info completa do grupo\n` +
            `!infouser @usuário — Info de um membro\n` +
            `!antilink on/off — Liga/desliga bloqueio de link\n` +
            `!listarsilenciados — Lista silenciados com tempo\n\n` +
            `🤖 *Inteligência Artificial*\n` +
            `!ia [pergunta] — Faz uma pergunta para a IA\n` +
            `!iaesquecer — Limpa o histórico da IA\n\n` +
            `😂 *Diversão*\n` +
            `!piada — Conta uma piada aleatória\n` +
            `!curiosidade — Fato curioso aleatório\n` +
            `!motivacao — Mensagem motivacional\n` +
            `!elogio — Elogio do dia\n` +
            `!zoeira — Zoeira amigável\n\n` +
            `🎮 *Jogos*\n` +
            `!quiz — Pergunta de quiz\n` +
            `!gabarito — Resposta do quiz atual\n` +
            `!mito — Mito ou verdade?\n` +
            `!revelar — Revela o mito atual\n` +
            `!vod — Verdade ou Desafio!\n` +
            `!desafio — Desafio aleatório\n` +
            `!dicadesafio — Dica do desafio atual\n` +
            `!8ball [pergunta] — A bola mágica responde\n` +
            `!adivinhe — Adivinhe o número (1-100)\n\n` +
            `🎲 *Sorteios*\n` +
            `!dado — Rola um dado de 6 lados\n` +
            `!moeda — Cara ou coroa\n` +
            `!numero [min] [max] — Número aleatório\n` +
            `!roleta @u1 @u2... — Sorteia entre mencionados\n` +
            `!sortear [item1,item2...] — Sorteia de uma lista\n` +
            `!ship @u1 @u2 — Compatibilidade entre dois 💕`
        });
      }

      // ── !autorizar ──
      if (comando === "!autorizar" && sender === myJidFull) {
        const alvo = toJID(args[0]);
        if (!alvo) return await sock.sendMessage(from, { text: "❌ Número inválido. Use: !autorizar 5511999999999" });
        if (!db.autorizados.includes(alvo)) { db.autorizados.push(alvo); saveDB(db); }
        await sock.sendMessage(from, { text: `✅ @${alvo.split("@")[0]} agora é autorizado!`, mentions: [alvo] });
      }

      // ── !desautorizar ──
      if (comando === "!desautorizar" && sender === myJidFull) {
        const alvo = toJID(args[0]);
        db.autorizados = db.autorizados.filter(j => j !== alvo);
        saveDB(db);
        await sock.sendMessage(from, { text: `✅ @${alvo.split("@")[0]} foi desautorizado.`, mentions: [alvo] });
      }

      // ── !autorizados ──
      if (comando === "!autorizados" && autorizado) {
        if (db.autorizados.length === 0) {
          await sock.sendMessage(from, { text: "📋 Nenhum usuário autorizado." });
        } else {
          const lista = db.autorizados.map(j => `• @${j.split("@")[0]}`).join("\n");
          await sock.sendMessage(from, { text: `📋 *Usuários autorizados:*\n${lista}`, mentions: db.autorizados });
        }
      }

      // ── !silenciar ──
      if (comando === "!silenciar" && autorizado) {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || toJID(args[0]);
        if (!alvo) { await sock.sendMessage(from, { text: "❌ Mencione ou informe o número: !silenciar @usuário ou !silenciar @usuário 10m" }); continue; }
        const tempoArg = args.find(a => /^\d+(m|h)$/.test(a));
        if (tempoArg) {
          const num = parseInt(tempoArg);
          const unidade = tempoArg.endsWith("h") ? 60 : 1;
          const ms = num * unidade * 60 * 1000;
          db.silenciados[alvo] = { tipo: "temp", ate: Date.now() + ms };
          saveDB(db);
          await sock.sendMessage(from, { text: `🔇 @${alvo.split("@")[0]} foi silenciado por ${formatarTempo(ms)}!`, mentions: [alvo] });
        } else {
          db.silenciados[alvo] = { tipo: "perm" };
          saveDB(db);
          await sock.sendMessage(from, { text: `🔇 @${alvo.split("@")[0]} foi silenciado permanentemente!`, mentions: [alvo] });
        }
      }

      // ── !dessilenciar ──
      if (comando === "!dessilenciar" && autorizado) {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || toJID(args[0]);
        if (!alvo) { await sock.sendMessage(from, { text: "❌ Mencione ou informe o número." }); continue; }
        delete db.silenciados[alvo];
        delete db.avisosBloqueio[alvo];
        saveDB(db);
        await sock.sendMessage(from, { text: `✅ @${alvo.split("@")[0]} foi dessilenciado!`, mentions: [alvo] });
      }

      // ── !silenciados ──
      if (comando === "!silenciados" && autorizado) {
        const lista = Object.entries(db.silenciados);
        if (lista.length === 0) {
          await sock.sendMessage(from, { text: "📋 Nenhum usuário silenciado." });
        } else {
          const texto = lista.map(([jid, info]) => {
            if (info.tipo === "perm") return `• @${jid.split("@")[0]} — Permanente`;
            const restante = info.ate - Date.now();
            if (restante <= 0) return null;
            return `• @${jid.split("@")[0]} — ${formatarTempo(restante)} restante`;
          }).filter(Boolean).join("\n");
          await sock.sendMessage(from, { text: `📋 *Silenciados:*\n${texto || "Nenhum ativo."}`, mentions: lista.map(([j]) => j) });
        }
      }

      // ── !bloquearfrase ──
      if (comando === "!bloquearfrase" && autorizado) {
        const frase = args.join(" ").trim().toLowerCase();
        if (!frase) { await sock.sendMessage(from, { text: "❌ Informe a frase: !bloquearfrase [palavra]" }); continue; }
        if (!db.bloqueioFrases.includes(frase)) {
          db.bloqueioFrases.push(frase);
          saveDB(db);
          await sock.sendMessage(from, { text: `✅ A frase "${frase}" foi bloqueada!\n\n_Variações como leetspeak (p0rr@, porr4, etc.) também serão bloqueadas automaticamente._` });
        } else {
          await sock.sendMessage(from, { text: `⚠️ A frase "${frase}" já estava bloqueada.` });
        }
      }

      // ── !desbloquearfrase ──
      if (comando === "!desbloquearfrase" && autorizado) {
        const frase = args.join(" ").trim().toLowerCase();
        if (!frase) { await sock.sendMessage(from, { text: "❌ Informe a frase: !desbloquearfrase [palavra]" }); continue; }
        if (db.bloqueioFrases.includes(frase)) {
          db.bloqueioFrases = db.bloqueioFrases.filter(f => f !== frase);
          saveDB(db);
          await sock.sendMessage(from, { text: `✅ A frase "${frase}" foi desbloqueada!` });
        } else {
          await sock.sendMessage(from, { text: `⚠️ A frase "${frase}" não estava bloqueada.` });
        }
      }

      // ── !listarfrases ──
      if (comando === "!listarfrases" && autorizado) {
        if (db.bloqueioFrases.length === 0) {
          await sock.sendMessage(from, { text: "📋 Nenhuma frase bloqueada." });
        } else {
          await sock.sendMessage(from, { text: `📋 *Frases bloqueadas:*\n${db.bloqueioFrases.map(f => `• ${f}`).join("\n")}` });
        }
      }

      // ── !bloquearaudio / !desbloquearaudio ──
      if (comando === "!bloquearaudio" && autorizado) { db.bloqueioAudios = true; saveDB(db); await sock.sendMessage(from, { text: "🔇 Áudios bloqueados neste grupo!" }); }
      if (comando === "!desbloquearaudio" && autorizado) { db.bloqueioAudios = false; saveDB(db); await sock.sendMessage(from, { text: "✅ Áudios liberados neste grupo!" }); }

      // ── !bloquearlink / !desbloquearlink ──
      if (comando === "!bloquearlink" && autorizado) { db.linksBloqueados = true; saveDB(db); await sock.sendMessage(from, { text: "🔗 Links bloqueados neste grupo!" }); }
      if (comando === "!desbloquearlink" && autorizado) { db.linksBloqueados = false; saveDB(db); await sock.sendMessage(from, { text: "✅ Links liberados neste grupo!" }); }

      // ── !apagar ──
      if (comando === "!apagar" && autorizado) {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedKey = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (quoted && quotedKey) {
          await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: quotedKey, participant: quotedParticipant } });
        } else {
          await sock.sendMessage(from, { text: "❌ Responda a uma mensagem para apagá-la." });
        }
      }

      // ── !limparavisos ──
      if (comando === "!limparavisos" && autorizado) {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || toJID(args[0]);
        if (!alvo) { await sock.sendMessage(from, { text: "❌ Mencione ou informe o número." }); continue; }
        delete db.avisosBloqueio[alvo];
        saveDB(db);
        await sock.sendMessage(from, { text: `✅ Avisos de @${alvo.split("@")[0]} foram limpos!`, mentions: [alvo] });
      }

      // ── !bemvindo / !despedida / !soleltura / !figurinha ──
      for (const [cmdName, campo, onMsg, offMsg] of [
        ["!bemvindo", "bemVindo", "👋 Mensagem de boas-vindas ativada!", "✅ Mensagem de boas-vindas desativada."],
        ["!despedida", "despedida", "🚪 Mensagem de despedida ativada!", "✅ Mensagem de despedida desativada."],
        ["!soleltura", "modoSoLeitura", "🔒 Modo só leitura ativado! Apenas admins podem enviar mensagens.", "✅ Modo só leitura desativado! Todos podem falar."],
        ["!figurinha", "figurinhasBloqueadas", "🚫 Figurinhas bloqueadas neste grupo!", "✅ Figurinhas liberadas!"]
      ]) {
        if (comando === cmdName && autorizado) {
          const op = args[0]?.toLowerCase();
          if (op === "on") { db[campo][from] = true; saveDB(db); await sock.sendMessage(from, { text: onMsg }); }
          else if (op === "off") { db[campo][from] = false; saveDB(db); await sock.sendMessage(from, { text: offMsg }); }
          else { await sock.sendMessage(from, { text: `❌ Use: ${cmdName} on ou ${cmdName} off` }); }
        }
      }

      // ── !rep / !verep / !topreputacao ──
      if (comando === "!rep" && autorizado) {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0];
        const sinal = args.find(a => a === "+" || a === "-");
        if (!alvo || !sinal) { await sock.sendMessage(from, { text: "❌ Use: !rep @usuário + ou !rep @usuário -" }); continue; }
        if (!db.reputacao[alvo]) db.reputacao[alvo] = 0;
        db.reputacao[alvo] += sinal === "+" ? 1 : -1;
        saveDB(db);
        const emoji = sinal === "+" ? "⭐" : "💔";
        await sock.sendMessage(from, { text: `${emoji} Reputação de @${alvo.split("@")[0]}: *${db.reputacao[alvo]} pontos*`, mentions: [alvo] });
      }

      if (comando === "!verep") {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || sender;
        const rep = db.reputacao[alvo] || 0;
        const emoji = rep > 0 ? "⭐" : rep < 0 ? "💔" : "😐";
        await sock.sendMessage(from, { text: `${emoji} Reputação de @${alvo.split("@")[0]}: *${rep} pontos*`, mentions: [alvo] });
      }

      if (comando === "!topreputacao") {
        const lista = Object.entries(db.reputacao).sort(([,a],[,b]) => b - a).slice(0, 10);
        if (lista.length === 0) {
          await sock.sendMessage(from, { text: "📋 Nenhuma reputação registrada ainda." });
        } else {
          const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
          const texto = lista.map(([jid, pts], i) => `${medals[i]} @${jid.split("@")[0]}: *${pts} pts*`).join("\n");
          await sock.sendMessage(from, { text: `🏆 *TOP REPUTAÇÃO*\n\n${texto}`, mentions: lista.map(([j]) => j) });
        }
      }

      // ── !banir / !promover / !rebaixar ──
      if (comando === "!banir" && autorizado && isGroup) {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || toJID(args[0]);
        if (!alvo) { await sock.sendMessage(from, { text: "❌ Mencione quem banir: !banir @usuário" }); continue; }
        try {
          await sock.sendMessage(from, { text: `🔨 @${alvo.split("@")[0]} foi banido do grupo!`, mentions: [alvo] });
          await sock.groupParticipantsUpdate(from, [alvo], "remove");
        } catch (e) { await sock.sendMessage(from, { text: "❌ Não consegui banir. Sou admin?" }); }
      }

      if (comando === "!promover" && autorizado && isGroup) {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || toJID(args[0]);
        if (!alvo) { await sock.sendMessage(from, { text: "❌ Mencione quem promover: !promover @usuário" }); continue; }
        try {
          await sock.groupParticipantsUpdate(from, [alvo], "promote");
          await sock.sendMessage(from, { text: `👑 @${alvo.split("@")[0]} foi promovido a admin!`, mentions: [alvo] });
        } catch (e) { await sock.sendMessage(from, { text: "❌ Não consegui promover. Sou admin?" }); }
      }

      if (comando === "!rebaixar" && autorizado && isGroup) {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || toJID(args[0]);
        if (!alvo) { await sock.sendMessage(from, { text: "❌ Mencione quem rebaixar: !rebaixar @usuário" }); continue; }
        try {
          await sock.groupParticipantsUpdate(from, [alvo], "demote");
          await sock.sendMessage(from, { text: `📉 @${alvo.split("@")[0]} perdeu o cargo de admin!`, mentions: [alvo] });
        } catch (e) { await sock.sendMessage(from, { text: "❌ Não consegui rebaixar. Sou admin?" }); }
      }

      // ── !tagall ──
      if (comando === "!tagall" && autorizado && isGroup) {
        try {
          const meta = await sock.groupMetadata(from);
          const participantes = meta.participants.map(p => p.id);
          const mensagemTag = args.join(" ") || "📢 Atenção a todos!";
          const mencoes = participantes.map(j => `@${j.split("@")[0]}`).join(" ");
          await sock.sendMessage(from, { text: `${mensagemTag}\n\n${mencoes}`, mentions: participantes });
        } catch (e) { await sock.sendMessage(from, { text: "❌ Não consegui buscar os membros." }); }
      }

      // ── !infogrupo ──
      if (comando === "!infogrupo" && isGroup) {
        try {
          const meta = await sock.groupMetadata(from);
          const admins = meta.participants.filter(p => p.admin).map(p => `@${p.id.split("@")[0]}`).join(", ");
          const criado = new Date(meta.creation * 1000).toLocaleDateString("pt-BR");
          await sock.sendMessage(from, {
            text: `📊 *INFO DO GRUPO*\n\n📌 *Nome:* ${meta.subject}\n👥 *Membros:* ${meta.participants.length}\n👑 *Admins:* ${admins || "Nenhum"}\n📅 *Criado em:* ${criado}\n🆔 *ID:* ${from}`,
            mentions: meta.participants.filter(p => p.admin).map(p => p.id)
          });
        } catch (e) { await sock.sendMessage(from, { text: "❌ Não consegui buscar as informações." }); }
      }

      // ── !infouser ──
      if (comando === "!infouser" && isGroup) {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || sender;
        try {
          const meta = await sock.groupMetadata(from);
          const membro = meta.participants.find(p => p.id === alvo);
          const cargo = membro?.admin === "superadmin" ? "👑 Dono" : membro?.admin === "admin" ? "🛡️ Admin" : "👤 Membro";
          const rep = db.reputacao[alvo] || 0;
          const silenciado = isSilenciado(db, alvo) ? "Sim 🔇" : "Não";
          const isAutorz = isAutorizado(db, alvo, myJidFull) ? "Sim ✅" : "Não";
          await sock.sendMessage(from, {
            text: `👤 *INFO DO USUÁRIO*\n\n📱 *Número:* +${alvo.split("@")[0]}\n🏷️ *Cargo:* ${cargo}\n⭐ *Reputação:* ${rep} pts\n🔇 *Silenciado:* ${silenciado}\n✅ *Autorizado:* ${isAutorz}`,
            mentions: [alvo]
          });
        } catch (e) { await sock.sendMessage(from, { text: "❌ Não consegui buscar as informações." }); }
      }

      // ── !antilink ──
      if (comando === "!antilink" && autorizado) {
        const op = args[0]?.toLowerCase();
        if (op === "on") { db.linksBloqueados = true; saveDB(db); await sock.sendMessage(from, { text: "🔗 Anti-link ativado! Links serão apagados." }); }
        else if (op === "off") { db.linksBloqueados = false; saveDB(db); await sock.sendMessage(from, { text: "✅ Anti-link desativado." }); }
        else { await sock.sendMessage(from, { text: "❌ Use: !antilink on ou !antilink off" }); }
      }

      // ═══════════════════════════════════════════
      // 🤖 INTELIGÊNCIA ARTIFICIAL
      // ═══════════════════════════════════════════

      // ── !ia [pergunta] ──
      if (comando === "!ia") {
        const pergunta = args.join(" ").trim();
        if (!pergunta) {
          await sock.sendMessage(from, { text: "❌ Use: !ia [sua pergunta]\n\nExemplo: !ia O que é inteligência artificial?" });
          continue;
        }
if (!GROQ_API_KEY) {
  await sock.sendMessage(from, { text: "❌ API da IA não configurada. Defina a variável GROQ_API_KEY no servidor." });          continue;
        }
        await sock.sendMessage(from, { text: "🤖 Pensando..." });
        const resposta = await perguntarIA(sender, pergunta);
        await sock.sendMessage(from, { text: `🤖 *Isaac IA*\n\n${resposta}` });
      }

      // ── !iaesquecer ──
      if (comando === "!iaesquecer") {
        delete historicoIA[sender];
        await sock.sendMessage(from, { text: "🧹 Histórico da IA apagado! Começamos do zero." });
      }

      // ═══════════════════════════════════════════
      // 😂 DIVERSÃO
      // ═══════════════════════════════════════════

      // ── !piada ──
      if (comando === "!piada") {
        await sock.sendMessage(from, { text: `😂 *PIADA DO DIA*\n\n${aleatorio(PIADAS)}` });
      }

      // ── !curiosidade ──
      if (comando === "!curiosidade") {
        await sock.sendMessage(from, { text: `🧠 *CURIOSIDADE ALEATÓRIA*\n\n${aleatorio(CURIOSIDADES)}` });
      }

      // ── !motivacao ──
      if (comando === "!motivacao") {
        await sock.sendMessage(from, { text: `💪 *MOTIVAÇÃO DO DIA*\n\n${aleatorio(MOTIVACOES)}` });
      }

      // ── !elogio ──
      if (comando === "!elogio") {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || sender;
        const elogio = aleatorio(ELOGIOS);
        await sock.sendMessage(from, {
          text: `🌟 *ELOGIO ESPECIAL para @${alvo.split("@")[0]}*\n\n${elogio}`,
          mentions: [alvo]
        });
      }

      // ── !zoeira ──
      if (comando === "!zoeira") {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || sender;
        const zoeira = aleatorio(ZOEIRAS);
        await sock.sendMessage(from, {
          text: `😂 *ZOEIRA (de boas!) para @${alvo.split("@")[0]}*\n\n${zoeira}\n\n_(Brincadeira! 💙)_`,
          mentions: [alvo]
        });
      }

      // ═══════════════════════════════════════════
      // 🎮 JOGOS
      // ═══════════════════════════════════════════

      // ── !quiz ──
      if (comando === "!quiz") {
        const perguntaQuiz = aleatorio(QUIZ_PERGUNTAS);
        estadoJogo[from] = { tipo: "quiz", dados: perguntaQuiz };
        await sock.sendMessage(from, {
          text: `🎯 *QUIZ TIME!*\n\n❓ ${perguntaQuiz.p}\n\n_Use !gabarito para ver a resposta._`
        });
      }

      // ── !gabarito ──
      if (comando === "!gabarito") {
        const jogo = estadoJogo[from];
        if (!jogo || jogo.tipo !== "quiz") {
          await sock.sendMessage(from, { text: "❌ Nenhum quiz ativo! Use !quiz para começar." });
        } else {
          await sock.sendMessage(from, { text: `✅ *GABARITO*\n\n${jogo.dados.d}` });
          delete estadoJogo[from];
        }
      }

      // ── !mito ──
      if (comando === "!mito") {
        const mitoAleatorio = aleatorio(MITOS);
        estadoJogo[from] = { tipo: "mito", dados: mitoAleatorio };
        await sock.sendMessage(from, {
          text: `🤔 *MITO OU VERDADE?*\n\n"${mitoAleatorio.m}"\n\n_É mito ou verdade? Discuta no grupo! Use !revelar para a resposta._`
        });
      }

      // ── !revelar ──
      if (comando === "!revelar") {
        const jogo = estadoJogo[from];
        if (!jogo || jogo.tipo !== "mito") {
          await sock.sendMessage(from, { text: "❌ Nenhum mito ativo! Use !mito para começar." });
        } else {
          await sock.sendMessage(from, {
            text: `🔍 *REVELAÇÃO*\n\n${jogo.dados.v ? "✅ É VERDADE!" : "❌ É MITO!"}\n\n${jogo.dados.d}`
          });
          delete estadoJogo[from];
        }
      }

      // ── !vod (Verdade ou Desafio) ──
      if (comando === "!vod") {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || sender;
        const vodAleatorio = aleatorio(VERDADE_OU_DESAFIO);
        const tipo = vodAleatorio.tipo === "V" ? "🗣️ VERDADE" : "🎯 DESAFIO";
        await sock.sendMessage(from, {
          text: `🎭 *VERDADE OU DESAFIO!*\n\n@${alvo.split("@")[0]}, você tirou...\n\n*${tipo}*\n\n${vodAleatorio.texto}`,
          mentions: [alvo]
        });
      }

      // ── !desafio ──
      if (comando === "!desafio") {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const alvo = mencionados[0] || sender;
        const desafioAleatorio = aleatorio(DESAFIOS);
        estadoJogo[`desafio_${sender}`] = { tipo: "desafio", dados: desafioAleatorio };
        await sock.sendMessage(from, {
          text: `🎯 *DESAFIO para @${alvo.split("@")[0]}*\n\n${desafioAleatorio}\n\n_Use !dicadesafio se precisar de ajuda!_`,
          mentions: [alvo]
        });
      }

      // ── !dicadesafio ──
      if (comando === "!dicadesafio") {
        const jogoDesafio = estadoJogo[`desafio_${sender}`];
        if (!jogoDesafio) {
          await sock.sendMessage(from, { text: "❌ Nenhum desafio ativo para você! Use !desafio para começar." });
        } else {
          await sock.sendMessage(from, { text: `💡 *DICA:* O desafio é: ${jogoDesafio.dados}` });
        }
      }

      // ── !8ball ──
      if (comando === "!8ball") {
        const pergunta8 = args.join(" ").trim();
        if (!pergunta8) {
          await sock.sendMessage(from, { text: "❌ Faça uma pergunta! Ex: !8ball Vou ficar rico?" });
        } else {
          const resposta8 = aleatorio(BOLA8_RESPOSTAS);
          await sock.sendMessage(from, {
            text: `🎱 *BOLA MÁGICA 8*\n\n❓ ${pergunta8}\n\n${resposta8}`
          });
        }
      }

      // ── !adivinhe (jogo de número) ──
      if (comando === "!adivinhe") {
        const chave = `adivinhe_${isGroup ? from : sender}`;
        const palpiteNum = parseInt(args[0]);

        if (!estadoJogo[chave]) {
          // Inicia novo jogo
          const numero = Math.floor(Math.random() * 100) + 1;
          estadoJogo[chave] = { tipo: "adivinhe", numero, tentativas: 0, maxTentativas: 7 };
          await sock.sendMessage(from, {
            text: `🎲 *ADIVINHE O NÚMERO!*\n\nEstou pensando em um número de 1 a 100.\nVocê tem *7 tentativas*!\n\nUse !adivinhe [número] para tentar!`
          });
        } else if (estadoJogo[chave].tipo === "adivinhe") {
          if (isNaN(palpiteNum) || palpiteNum < 1 || palpiteNum > 100) {
            await sock.sendMessage(from, { text: "❌ Digite um número válido entre 1 e 100!\nEx: !adivinhe 42" });
          } else {
            const jogo = estadoJogo[chave];
            jogo.tentativas++;
            const restam = jogo.maxTentativas - jogo.tentativas;

            if (palpiteNum === jogo.numero) {
              await sock.sendMessage(from, {
                text: `🎉 *ACERTOU!* O número era *${jogo.numero}*!\nVocê acertou em ${jogo.tentativas} tentativa(s)! 🏆`
              });
              delete estadoJogo[chave];
            } else if (jogo.tentativas >= jogo.maxTentativas) {
              await sock.sendMessage(from, {
                text: `😢 *FIM DE JOGO!* O número era *${jogo.numero}*. Tente novamente com !adivinhe!`
              });
              delete estadoJogo[chave];
            } else {
              const dica = palpiteNum < jogo.numero ? "📈 É *maior*!" : "📉 É *menor*!";
              await sock.sendMessage(from, {
                text: `${dica}\n_Restam ${restam} tentativa(s). Continue tentando!_\nUse !adivinhe [número]`
              });
            }
          }
        }
      }

      // ═══════════════════════════════════════════
      // 🎲 SORTEIOS
      // ═══════════════════════════════════════════

      // ── !dado ──
      if (comando === "!dado") {
        const lados = parseInt(args[0]) || 6;
        const ladosVal = Math.min(Math.max(lados, 2), 100); // Entre 2 e 100
        const resultado = Math.floor(Math.random() * ladosVal) + 1;
        const faces = ["⚀","⚁","⚂","⚃","⚄","⚅"];
        const emoji = ladosVal === 6 ? faces[resultado - 1] : "🎲";
        await sock.sendMessage(from, {
          text: `🎲 *ROLAGEM DE DADO* (d${ladosVal})\n\n${emoji} Resultado: *${resultado}*`
        });
      }

      // ── !moeda ──
      if (comando === "!moeda") {
        const resultado = Math.random() < 0.5 ? "👑 CARA" : "🪙 COROA";
        await sock.sendMessage(from, { text: `🪙 *CARA OU COROA*\n\nResultado: *${resultado}*!` });
      }

      // ── !numero ──
      if (comando === "!numero") {
        const min = parseInt(args[0]) || 1;
        const max = parseInt(args[1]) || 100;
        if (min >= max) {
          await sock.sendMessage(from, { text: "❌ O mínimo deve ser menor que o máximo!\nEx: !numero 1 100" });
        } else {
          const resultado = Math.floor(Math.random() * (max - min + 1)) + min;
          await sock.sendMessage(from, {
            text: `🎲 *NÚMERO ALEATÓRIO*\n\nEntre ${min} e ${max}: *${resultado}*`
          });
        }
      }

      // ── !roleta ──
      if (comando === "!roleta") {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mencionados.length < 2) {
          await sock.sendMessage(from, { text: "❌ Mencione pelo menos 2 pessoas!\nEx: !roleta @pessoa1 @pessoa2 @pessoa3" });
        } else {
          const sorteado = aleatorio(mencionados);
          await sock.sendMessage(from, {
            text: `🎰 *ROLETA*\n\n🎉 O sorteado foi: @${sorteado.split("@")[0]}!`,
            mentions: [sorteado]
          });
        }
      }

      // ── !sortear ──
      if (comando === "!sortear") {
        const lista = args.join(" ").split(",").map(i => i.trim()).filter(Boolean);
        if (lista.length < 2) {
          await sock.sendMessage(from, { text: "❌ Informe pelo menos 2 itens separados por vírgula!\nEx: !sortear pizza, hamburguer, sushi" });
        } else {
          const sorteado = aleatorio(lista);
          await sock.sendMessage(from, {
            text: `🎰 *SORTEIO*\n\nOpcões: ${lista.join(", ")}\n\n🎉 Sorteado: *${sorteado}*!`
          });
        }
      }

      // ── !ship ──
      if (comando === "!ship") {
        const mencionados = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mencionados.length < 2) {
          await sock.sendMessage(from, { text: "❌ Mencione 2 pessoas para o ship!\nEx: !ship @pessoa1 @pessoa2" });
        } else {
          const p1 = mencionados[0];
          const p2 = mencionados[1];
          const porcento = Math.floor(Math.random() * 101);
          let emoji, comentario;
          if (porcento >= 90) { emoji = "💘"; comentario = "São almas gêmeas! 😍"; }
          else if (porcento >= 70) { emoji = "❤️"; comentario = "Combinam muito! 😊"; }
          else if (porcento >= 50) { emoji = "💛"; comentario = "Tem potencial! 😏"; }
          else if (porcento >= 30) { emoji = "🧡"; comentario = "Vai com calma... 😅"; }
          else { emoji = "💔"; comentario = "Talvez na próxima vida! 😂"; }

          const barra = "█".repeat(Math.floor(porcento / 10)) + "░".repeat(10 - Math.floor(porcento / 10));

          await sock.sendMessage(from, {
            text: `${emoji} *SHIP METER*\n\n@${p1.split("@")[0]} + @${p2.split("@")[0]}\n\n[${barra}] *${porcento}%*\n\n${comentario}`,
            mentions: [p1, p2]
          });
        }
      }

    } // fim for messages
  });
}

// ─────────────────────────────────────────
// EVENTOS DE GRUPO (entradas e saídas)
// ─────────────────────────────────────────
async function iniciarEventosGrupo(sock) {
  sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
    const db = loadDB();

    for (const participante of participants) {
      if (action === "add" && db.bemVindo[id]) {
        try {
          const meta = await sock.groupMetadata(id);
          await sock.sendMessage(id, {
            text: `👋 Bem-vindo(a) ao *${meta.subject}*, @${participante.split("@")[0]}!\n\nSeja muito bem-vindo(a)! 🎉\nLeia as regras do grupo antes de interagir.`,
            mentions: [participante]
          });
        } catch (e) { console.log("Erro boas-vindas:", e.message); }
      }

      if (action === "remove" && db.despedida[id]) {
        try {
          const meta = await sock.groupMetadata(id);
          await sock.sendMessage(id, {
            text: `🚪 @${participante.split("@")[0]} saiu do grupo *${meta.subject}*. Até mais! 👋`,
            mentions: [participante]
          });
        } catch (e) { console.log("Erro despedida:", e.message); }
      }

      if (action === "add") {
        if (!db.registroEntradas[id]) db.registroEntradas[id] = [];
        db.registroEntradas[id].push({ jid: participante, entrou: new Date().toLocaleString("pt-BR") });
        if (db.registroEntradas[id].length > 50) db.registroEntradas[id].shift();
        saveDB(db);
      }
    }
  });
}

startBot();
