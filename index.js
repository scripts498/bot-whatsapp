const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

ffmpeg.setFfmpegPath(ffmpegPath);

// ─────────────────────────────────────────
//  CONFIGURAÇÕES DO STICKER
//  Mude aqui o nome e autor que aparecem no WhatsApp
// ─────────────────────────────────────────
const STICKER_NOME = "Isaac Bot";
const STICKER_AUTOR = "@isaac";

// ─────────────────────────────────────────
//  INJETA EXIF NO WEBP — necessário para o WhatsApp
//  mobile reconhecer como sticker com nome/autor
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

    // Chunk EXIF no formato RIFF/WebP
    // O WhatsApp mobile lê esse chunk para exibir nome e autor
    const chunkId = Buffer.from("EXIF");
    const chunkSize = Buffer.alloc(4);
    chunkSize.writeUInt32LE(jsonBuf.length, 0);
    const exifChunk = Buffer.concat([chunkId, chunkSize, jsonBuf]);

    // Padding para manter alinhamento de 2 bytes (padrão RIFF)
    const padding = jsonBuf.length % 2 !== 0 ? Buffer.alloc(1) : Buffer.alloc(0);

    // Reconstrói o arquivo WebP inserindo o chunk EXIF
    const riff = webpBuffer.slice(0, 4);   // "RIFF"
    const webpMagic = webpBuffer.slice(8, 12); // "WEBP"
    const rest = webpBuffer.slice(12);         // chunks originais

    const newBody = Buffer.concat([webpMagic, exifChunk, padding, rest]);
    const newSize = Buffer.alloc(4);
    newSize.writeUInt32LE(newBody.length, 0);

    return Buffer.concat([riff, newSize, newBody]);
  } catch (e) {
    console.warn("Aviso: falha ao injetar EXIF:", e.message);
    return webpBuffer; // retorna o original se falhar
  }
}

// ─────────────────────────────────────────
//  BANCO DE DADOS LOCAL (JSON)
// ─────────────────────────────────────────
const DB_PATH = "./db.json";

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({
        autorizados: [],
        silenciados: {},
        bloqueioFrases: [],
        bloqueioAudios: false,
      })
    );
  }
  return JSON.parse(fs.readFileSync(DB_PATH));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
const DONO = "Isaac";

function isAutorizado(db, jid) {
  return db.autorizados.includes(jid);
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

function msgNaoAutorizado() {
  return `Voce nao tem autorizacao para usar comandos!\nPeca autorizacao ao dono deste bot, o nome dele e *${DONO}*.`;
}

function toJID(num) {
  const limpo = num.replace(/\D/g, "");
  return limpo.includes("@") ? limpo : `${limpo}@s.whatsapp.net`;
}

function sortearItem(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .replace(/\s+/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ─────────────────────────────────────────
//  DADOS DE ENTRETENIMENTO
// ─────────────────────────────────────────

const piadas = [
  "Por que o esqueleto nao briga?\nPorque nao tem estomago pra isso! 💀😂",
  "O que o zero disse pro oito?\nQue cinto bonito! 😂",
  "Por que o livro de matematica e triste?\nPorque tem muitos problemas! 📚😅",
  "O que o pato disse pra pata?\nVem ca, quack! 🦆",
  "Por que o computador foi ao medico?\nPorque tava com virus! 💻😷",
  "O que o mar disse pro barco?\nNada! O mar nao fala, seu tonto! 🌊😂",
  "Por que a vassoura ta feliz?\nPorque varreu o problema! 🧹",
  "O que e um peixe sem olho?\nPx! 🐟",
  "Por que o gato foi a escola?\nPra aprender a falar miau em ingles! 🐱",
  "O que o relogio falou pro outro relogio?\nEi, tu ta me seguindo hein! ⌚😂",
  "Por que o espantalho ganhou premio?\nPorque era demais no seu ramo! 🌾",
  "Por que o elefante usa mala pequena?\nPorque ja tem tromba! 🐘😂",
  "Por que o musico foi preso?\nPorque tava em re! 🎵😅",
  "O que e uma formiga deitada?\nUma formiga cansada! 🐜😂",
  "Por que o padeiro nao dorme?\nPorque ele nao quer perder o pao! 🍞😂",
];

const curiosidades = [
  "O cerebro humano tem cerca de 86 bilhoes de neuronios! E mais que estrelas na Via Lactea. 🧠",
  "O polvo tem 3 coracoes e sangue azul! Dois bombam para os pulmoes, um para o corpo. 🐙",
  "O mel nunca estraga! Arqueologos encontraram mel de 3.000 anos no Egito, ainda comestivel. 🍯",
  "O olho humano consegue distinguir cerca de 10 milhoes de cores diferentes! 👁️",
  "Os tubaroes existem ha mais tempo que as arvores — 400 milhoes de anos! 🦈",
  "A Lua se afasta da Terra cerca de 3,8 cm por ano. 🌙",
  "Elefantes sao os unicos animais que nao conseguem pular. 🐘",
  "Uma pessoa passa em media 26 anos dormindo ao longo da vida. 💤",
  "As borboletas provam com os pes! Elas tem receptores de gosto nas patas! 🦋",
  "O oceano cobre 71% da Terra, mas 95% dele ainda e inexplorado. 🌊",
  "As formigas nunca dormem e nao tem pulmoes — respiram por buracos no corpo. 🐜",
  "Bananas sao levemente radioativas! Mas teria que comer milhoes pra sentir efeito. 🍌",
  "Os golfinhos dormem com metade do cerebro acordada para nao afogar. 🐬",
  "A lingua humana e o musculo mais forte do corpo em relacao ao seu tamanho. 👅",
  "A Terra tem mais de 4,5 bilhoes de anos e a vida surgiu 'so' 3,8 bilhoes de anos atras. 🌍",
];

const verdadesOuMito = [
  { frase: "Os humanos usam apenas 10% do cerebro.", resposta: "MITO! Usamos praticamente todas as partes do cerebro, so nao todas ao mesmo tempo. 🧠" },
  { frase: "Raios nunca caem no mesmo lugar duas vezes.", resposta: "MITO! Raios caem no mesmo lugar com frequencia. O Cristo Redentor e atingido varias vezes por ano! ⚡" },
  { frase: "A Grande Muralha da China e visivel do espaco.", resposta: "MITO! E muito estreita para ser vista a olho nu do espaco. Astronautas confirmaram isso. 🧱" },
  { frase: "Os peixes tem memoria de 3 segundos.", resposta: "MITO! Peixes podem ter memoria de meses. Experiencias provam que reconhecem donos! 🐟" },
  { frase: "Cachorros veem apenas preto e branco.", resposta: "MITO! Cachorros enxergam algumas cores como azul e amarelo, so tem menos receptores que humanos. 🐕" },
  { frase: "Acucar deixa criancas hiperativas.", resposta: "MITO! Estudos nao encontraram nenhuma ligacao entre acucar e hiperatividade. 🍬" },
  { frase: "Bananas crescem em arvores.", resposta: "MITO! A bananeira e tecnicamente uma erva gigante, nao uma arvore — nao tem tronco de madeira! 🍌" },
  { frase: "O coracao humano bate cerca de 100 mil vezes por dia.", resposta: "VERDADE! Em media sao 60-100 batimentos por minuto, chegando a ~100 mil por dia. ❤️" },
  { frase: "Humanos e cogumelos compartilham DNA.", resposta: "VERDADE! Fungos sao geneticamente mais proximos dos animais do que das plantas! 🍄" },
  { frase: "A agua quente congela mais rapido que a fria.", resposta: "VERDADE (as vezes)! O Efeito Mpemba e real em certas condicoes, mas ainda intriga cientistas. 🧊" },
];

const desafios = [
  { texto: "Fale uma palavra com 'br' sem repetir nenhuma ja dita no grupo!", dica: "Exemplos: brincar, bravo, brisa, brilho..." },
  { texto: "Escreva o nome de 5 paises em menos de 10 segundos!", dica: "Exemplos: Brasil, Franca, Japao, Mexico, India..." },
  { texto: "Diga um animal para cada letra do alfabeto em sequencia (A, B, C...)!", dica: "A=abelha, B=baleia, C=cachorro..." },
  { texto: "Conte ate 20 em ingles sem errar!", dica: "One, two, three... tente!" },
  { texto: "Fale 3 palavras que rimam com 'sol'!", dica: "Exemplos: col, pol, anzol..." },
  { texto: "Nomeie 5 capitais de paises europeus agora!", dica: "Exemplos: Paris, Roma, Berlim, Madrid, Lisboa..." },
  { texto: "Digite seu nome com os cotovelos no teclado!", dica: "Vale qualquer coisa parecida 😂" },
  { texto: "Fale o nome de 5 musicas sem repetir artista!", dica: "Mostre que tem repertorio!" },
  { texto: "Nomeie 10 marcas de carro em 15 segundos!", dica: "Toyota, Ford, Honda... continue!" },
  { texto: "Fale 5 palavras em ingles relacionadas a comida!", dica: "Exemplos: pizza, burger, cake, rice, soup..." },
];

const verdadesOuDesafio = [
  "Mostre a ultima foto da sua galeria! 📸",
  "Fale algo embaracoso que aconteceu com voce!",
  "Imite alguem do grupo por 30 segundos!",
  "Mande um audio cantando qualquer musica!",
  "Fale o nome de alguem que voce tem crush!",
  "Conte um segredo que nunca contou no grupo!",
  "Mande a foto do seu quarto agora, sem arrumar!",
  "Faca 10 flexoes e mande o video como prova!",
  "Fale 3 defeitos seus honestamente!",
  "Qual foi a coisa mais burra que voce ja fez?",
  "Mande uma selfie sem filtro agora!",
  "Fale o nome de alguem do grupo que voce mais admira e por que!",
  "O que voce faria com 1 milhao de reais?",
  "Revele uma mentira que voce ja contou no grupo!",
  "Imite um animal durante 1 minuto no proximo audio!",
];

const elogios = [
  "Voce e incrivel e o grupo fica muito melhor com voce! 🌟",
  "Sua energia positiva contagia todo mundo! ✨",
  "Voce tem um senso de humor incrivel! 😄",
  "Todo mundo que te conhece tem sorte! 🍀",
  "Voce e tipo WiFi: todo mundo quer estar perto! 📶😂",
  "Voce deixa qualquer conversa mais interessante! 💬",
  "Se a simpatia valesse dinheiro, voce seria bilionario(a)! 💰",
  "Que pessoa top voce e! O mundo precisa de mais gente assim! 🌍",
  "Voce e a pessoa mais legal que eu conheço... digitalmente falando! 🤖❤️",
  "Seu sorriso ilumina o grupo! 😁",
];

const zoeiras = [
  "Olha... nao vou falar nada nao. Mas todo mundo ta pensando. 👀",
  "Eu ia zoar, mas fui programado pra ser educado. Quase! 😂",
  "Uai, cade o cracha de especialista em besteira? Parece que e voce! 🏅",
  "Voce postou isso achando que ia parecer inteligente, ne? 😭😂",
  "To te observando... 👁👁",
  "Alguem chamou o palhaco? Nao? Estranhei voce aparecer entao! 🤡",
  "Voce e unico(a). E nao to dizendo isso como elogio! 😂",
  "O grupo ficou mais animado agora. Mas nao por um bom motivo! 😂",
  "Calma, to aqui so pra brincar! Voce e otimo(a)! 😂❤️",
  "Se burrice doesse, voce taria no hospital agora! (brincadeira hein 😂)",
];

const frasesmotivacionais = [
  "A unica pessoa que pode te parar e voce mesmo. Vai la! 💪",
  "Todo dia e uma nova chance de ser melhor que ontem. 🌅",
  "Sonhos grandes exigem coragem ainda maior. Voce tem! 🚀",
  "Crescimento doi. Estagnacao tambem. Escolha sua dor. 🌱",
  "Voce aguentou 100% dos dias ruins ate agora. Continue! ⚡",
  "Foco, forca e fe. O resto vem com o tempo. 🎯",
  "Nao compare seu capitulo 1 com o capitulo 20 de alguem. 🌟",
  "A motivacao te comeca. O habito te mantem. Construa habitos! 🔥",
  "Errar e aprender. Desistir e a unica derrota real. 💡",
  "O sucesso e a soma de pequenos esforcos repetidos todo dia. 🏆",
];

const perguntasQuiz = [
  { pergunta: "Qual e a capital do Brasil?", resposta: "Brasilia! 🏛️" },
  { pergunta: "Quantos estados tem o Brasil?", resposta: "26 estados + 1 Distrito Federal (27 no total)!" },
  { pergunta: "Qual e o maior planeta do sistema solar?", resposta: "Jupiter! 🪐" },
  { pergunta: "Quem pintou a Mona Lisa?", resposta: "Leonardo da Vinci! 🎨" },
  { pergunta: "Em que ano o Brasil foi descoberto?", resposta: "1500! 🇧🇷" },
  { pergunta: "Qual e o animal mais rapido do mundo?", resposta: "O guepardo (cheetah), ate 120 km/h! 🐆" },
  { pergunta: "Quantos lados tem um hexagono?", resposta: "6 lados! ⬡" },
  { pergunta: "Qual e o maior oceano do mundo?", resposta: "Oceano Pacifico! 🌊" },
  { pergunta: "Quem escreveu Dom Casmurro?", resposta: "Machado de Assis! 📚" },
  { pergunta: "Quantos planetas tem o sistema solar?", resposta: "8 planetas! 🪐" },
  { pergunta: "Qual e o rio mais longo do mundo?", resposta: "Rio Nilo (embora o Amazonas dispute o titulo)! 🌊" },
  { pergunta: "Em que continente fica o Egito?", resposta: "Africa! 🌍" },
  { pergunta: "Qual e a formula da agua?", resposta: "H2O! 💧" },
  { pergunta: "Quem foi o primeiro homem na Lua?", resposta: "Neil Armstrong, em 1969! 🌙" },
  { pergunta: "Qual e o pais mais populoso do mundo?", resposta: "India, com mais de 1,4 bilhao de habitantes! 🇮🇳" },
];

const respostas8ball = [
  "Sim, com certeza! ✅",
  "Definitivamente sim! ✅",
  "Pode contar com isso! ✅",
  "Tudo indica que sim! ✅",
  "Nao tenho certeza... tente de novo. 🤔",
  "As estrelas estao confusas hoje. 🤔",
  "Nao consigo prever agora. 🤔",
  "Nao parece bom... ❌",
  "Minha resposta e nao. ❌",
  "Definitivamente nao! ❌",
  "Hahahaha nao. 😂",
  "O futuro e nebuloso... 🔮",
  "Pergunte de novo mais tarde! 🔄",
  "Com certeza nao! ❌",
  "As forcas do universo dizem SIM! ✨",
];

// ─────────────────────────────────────────
//  IA - Groq com memoria por usuario
// ─────────────────────────────────────────
const historicoIA = {};
const MAX_HISTORICO = 20;

async function perguntarIA(pergunta, senderJid) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY nao configurada!");

  if (!historicoIA[senderJid]) historicoIA[senderJid] = [];
  historicoIA[senderJid].push({ role: "user", content: pergunta });
  if (historicoIA[senderJid].length > MAX_HISTORICO)
    historicoIA[senderJid] = historicoIA[senderJid].slice(-MAX_HISTORICO);

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1024,
      temperature: 0.7,
      messages: [
        { role: "system", content: "Voce e um assistente simpatico e divertido dentro de um grupo do WhatsApp. Responda de forma clara, objetiva e descontraida. Use emojis quando fizer sentido." },
        ...historicoIA[senderJid],
      ],
    }),
  });

  if (!res.ok) {
    historicoIA[senderJid].pop();
    throw new Error(`Erro HTTP ${res.status}`);
  }

  const data = await res.json();
  const texto = data?.choices?.[0]?.message?.content;
  if (!texto) throw new Error("Resposta vazia da Groq");
  historicoIA[senderJid].push({ role: "assistant", content: texto });
  return texto;
}

// ─────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────
let reconnectAttempts = 0;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: ["Isaac Bot", "Chrome", "1.0.0"],
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      reconnectAttempts = 0;
      console.clear();
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("  Isaac Bot — Escaneie o QR Code abaixo");
      console.log("  WhatsApp → Dispositivos Conectados → +");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      qrcode.generate(qr, { small: true });
      console.log("\n Aguardando leitura do QR...\n");
    }
    if (connection === "open") {
      reconnectAttempts = 0;
      console.clear();
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("  Isaac Bot conectado e pronto!");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    }
    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("Deslogado. Delete a pasta auth_info e reinicie.");
        return;
      }
      reconnectAttempts++;
      const delay = Math.min(3000 * reconnectAttempts, 30000);
      console.log(`Reconectando em ${delay / 1000}s...`);
      setTimeout(startBot, delay);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const db = loadDB();
      const from = msg.key.remoteJid;
      const sender = msg.key.participant || from;
      const isGroup = from.endsWith("@g.us");

      if (isGroup && isSilenciado(db, sender)) {
        await sock.sendMessage(from, { delete: msg.key });
        continue;
      }

      const textoMsg =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text || "";

      if (isGroup && textoMsg && !isAutorizado(db, sender)) {
        const textoNorm = normalizarTexto(textoMsg);
        const fraseProibida = db.bloqueioFrases.find((f) =>
          textoNorm.includes(normalizarTexto(f))
        );
        if (fraseProibida) {
          await sock.sendMessage(from, { delete: msg.key });
          await sock.sendMessage(from, {
            text: `A mensagem de @${sender.split("@")[0]} foi removida por conter conteudo proibido.`,
            mentions: [sender],
          });
          continue;
        }
      }

      if (isGroup && db.bloqueioAudios && msg.message?.audioMessage && !isAutorizado(db, sender)) {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.sendMessage(from, {
          text: `Audios estao desativados.\n@${sender.split("@")[0]} teve seu audio removido.`,
          mentions: [sender],
        });
        continue;
      }

      const body =
        textoMsg ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || "";

      if (!body.startsWith("!")) continue;

      const [cmd, ...args] = body.trim().split(" ");
      const comando = cmd.toLowerCase();

      if (comando === "!ping") {
        await sock.sendMessage(from, { text: "🏓 Pong! Bot online!" });
        continue;
      }
      if (comando === "!meuid") {
        await sock.sendMessage(from, { text: `Seu JID:\n*${sender}*` });
        continue;
      }
      if (comando === "!hora") {
        const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        await sock.sendMessage(from, { text: `Horario de Brasilia:\n*${agora}*` });
        continue;
      }
      if (comando === "!calc" || comando === "!calcular") {
        const expressao = args.join(" ").replace(/[^0-9+\-*/.()% ]/g, "");
        if (!expressao) { await sock.sendMessage(from, { text: "Use: !calc 10 + 5 * 2" }); continue; }
        try {
          const resultado = Function('"use strict"; return (' + expressao + ')')();
          await sock.sendMessage(from, { text: `🧮 *CALCULADORA:*\n\n${expressao} = *${resultado}*` });
        } catch { await sock.sendMessage(from, { text: "Expressao invalida!" }); }
        continue;
      }
      if (comando === "!ia" || comando === "!pergunta") {
        const pergunta = args.join(" ").trim();
        if (!pergunta) { await sock.sendMessage(from, { text: "Use: !ia sua pergunta" }); continue; }
        await sock.sendMessage(from, { text: "🤖 Pensando..." });
        try {
          const resposta = await perguntarIA(pergunta, sender);
          await sock.sendMessage(from, { text: `🤖 *IA responde:*\n\n${resposta}` });
        } catch (e) { await sock.sendMessage(from, { text: `Erro na IA: ${e.message}` }); }
        continue;
      }
      if (comando === "!iaesquecer" || comando === "!iaapagar") {
        historicoIA[sender] = [];
        await sock.sendMessage(from, { text: "🧹 Memoria apagada! Novo comeco! 🤖" });
        continue;
      }
      if (comando === "!piada") {
        await sock.sendMessage(from, { text: `😂 *PIADA DO DIA:*\n\n${sortearItem(piadas)}` });
        continue;
      }
      if (comando === "!curiosidade" || comando === "!fato") {
        await sock.sendMessage(from, { text: `🤯 *VOCE SABIA?*\n\n${sortearItem(curiosidades)}` });
        continue;
      }
      if (comando === "!mito") {
        const item = sortearItem(verdadesOuMito);
        await sock.sendMessage(from, { text: `🤔 *VERDADE OU MITO?*\n\n"${item.frase}"\n\nUse *!revelar* pra descobrir!` });
        db._ultimoMito = item.resposta; saveDB(db);
        continue;
      }
      if (comando === "!revelar") {
        await sock.sendMessage(from, { text: `✅ *RESPOSTA:*\n\n${db._ultimoMito || "Use *!mito* primeiro."}` });
        continue;
      }
      if (comando === "!quiz") {
        const q = sortearItem(perguntasQuiz);
        await sock.sendMessage(from, { text: `🧠 *QUIZ!*\n\n❓ ${q.pergunta}\n\nUse *!gabarito* pra conferir!` });
        db._ultimoQuiz = q.resposta; saveDB(db);
        continue;
      }
      if (comando === "!gabarito") {
        await sock.sendMessage(from, { text: `✅ *GABARITO:*\n\n${db._ultimoQuiz || "Use *!quiz* primeiro."}` });
        continue;
      }
      if (comando === "!desafio") {
        const d = sortearItem(desafios);
        await sock.sendMessage(from, { text: `🎯 *DESAFIO LANCADO!*\n\n${d.texto}\n\nQuem aceita? 👀\n_(Use *!dicadesafio* se precisar de ajuda!)_` });
        db._ultimoDesafio = d.dica; saveDB(db);
        continue;
      }
      if (comando === "!dicadesafio") {
        await sock.sendMessage(from, { text: `💡 *DICA:*\n\n${db._ultimoDesafio || "Use *!desafio* primeiro."}` });
        continue;
      }
      if (comando === "!vod" || comando === "!verdadeoudesafio") {
        if (Math.random() < 0.5) {
          await sock.sendMessage(from, { text: `🎭 *VERDADE OU DESAFIO?*\n\nSaiu: *VERDADE!* 😬\n\n👉 ${sortearItem(verdadesOuDesafio)}` });
        } else {
          const d = sortearItem(desafios);
          await sock.sendMessage(from, { text: `🎭 *VERDADE OU DESAFIO?*\n\nSaiu: *DESAFIO!* 💪\n\n👉 ${d.texto}` });
          db._ultimoDesafio = d.dica; saveDB(db);
        }
        continue;
      }
      if (comando === "!elogio") {
        const alvo = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
        await sock.sendMessage(from, { text: `💖 *ELOGIO para @${alvo.split("@")[0]}:*\n\n${sortearItem(elogios)}`, mentions: [alvo] });
        continue;
      }
      if (comando === "!zoeira" || comando === "!zoa") {
        const alvo = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
        await sock.sendMessage(from, { text: `😂 *ZOEIRA em @${alvo.split("@")[0]}:*\n\n${sortearItem(zoeiras)}`, mentions: [alvo] });
        continue;
      }
      if (comando === "!motivacao" || comando === "!animo") {
        await sock.sendMessage(from, { text: `🔥 *MOTIVACAO DO DIA:*\n\n${sortearItem(frasesmotivacionais)}` });
        continue;
      }
      if (comando === "!dado") {
        const lados = parseInt(args[0]) || 6;
        if (lados < 2 || lados > 100) { await sock.sendMessage(from, { text: "Use entre 2 e 100 lados." }); continue; }
        await sock.sendMessage(from, { text: `🎲 *DADO DE ${lados} LADOS:*\n\nSaiu: *${Math.floor(Math.random() * lados) + 1}!*` });
        continue;
      }
      if (comando === "!moeda" || comando === "!cara") {
        await sock.sendMessage(from, { text: `🪙 Saiu: *${Math.random() < 0.5 ? "CARA" : "COROA"}!*` });
        continue;
      }
      if (comando === "!roleta") {
        if (!isGroup) { await sock.sendMessage(from, { text: "Use em grupos!" }); continue; }
        try {
          const meta = await sock.groupMetadata(from);
          const participantes = meta.participants.filter(p => p.id !== sender);
          if (!participantes.length) { await sock.sendMessage(from, { text: "Nao tem mais ninguem!" }); continue; }
          const escolhido = sortearItem(participantes);
          await sock.sendMessage(from, { text: `🎰 *ROLETA!*\n\nParou em *@${escolhido.id.split("@")[0]}!* 🎯`, mentions: [escolhido.id] });
        } catch (e) { await sock.sendMessage(from, { text: "Erro: " + e.message }); }
        continue;
      }
      if (comando === "!sortear") {
        const opcoes = args.join(" ").split(",").map(o => o.trim()).filter(Boolean);
        if (opcoes.length < 2) { await sock.sendMessage(from, { text: "Use: !sortear op1, op2, op3" }); continue; }
        await sock.sendMessage(from, { text: `🎯 *SORTEIO!*\n\n${opcoes.join(" | ")}\n\nEscolhido: *${sortearItem(opcoes)}!* 🎉` });
        continue;
      }
      if (comando === "!numero" || comando === "!num") {
        const min = parseInt(args[0]) || 1;
        const max = parseInt(args[1]) || 100;
        if (min >= max) { await sock.sendMessage(from, { text: "Use: !numero 1 100" }); continue; }
        await sock.sendMessage(from, { text: `🔢 *${Math.floor(Math.random() * (max - min + 1)) + min}!*` });
        continue;
      }
      if (comando === "!8ball" || comando === "!bola8") {
        const p = args.join(" ").trim();
        if (!p) { await sock.sendMessage(from, { text: "Use: !8ball sua pergunta" }); continue; }
        await sock.sendMessage(from, { text: `🎱 *BOLA 8*\n\n❓ ${p}\n\n${sortearItem(respostas8ball)}` });
        continue;
      }
      if (comando === "!ship") {
        const mencoes = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mencoes.length < 2) { await sock.sendMessage(from, { text: "Mencione 2 pessoas!" }); continue; }
        const [p1, p2] = mencoes;
        const n = Math.floor(Math.random() * 101);
        const emoji = n >= 80 ? "💞💍" : n >= 60 ? "❤️" : n >= 40 ? "💛" : n >= 20 ? "🙂" : "💀";
        await sock.sendMessage(from, { text: `💘 *SHIP-O-METRO!*\n\n@${p1.split("@")[0]} + @${p2.split("@")[0]}\n\n${emoji} *${n}%*`, mentions: [p1, p2] });
        continue;
      }
      if (comando === "!adivinhe") {
        const secreto = Math.floor(Math.random() * 10) + 1;
        await sock.sendMessage(from, { text: `🔮 *ADIVINHE!*\n\nNumero de 1 a 10 — use *!chute [numero]*\n(60 segundos!)` });
        db._numeroSecreto = { valor: secreto, expira: Date.now() + 60000 }; saveDB(db);
        continue;
      }
      if (comando === "!chute") {
        const jogo = db._numeroSecreto;
        if (!jogo || Date.now() > jogo.expira) { await sock.sendMessage(from, { text: "Nenhum jogo ativo! Use *!adivinhe*." }); continue; }
        const chute = parseInt(args[0]);
        if (isNaN(chute)) { await sock.sendMessage(from, { text: "Manda um numero!" }); continue; }
        if (chute === jogo.valor) {
          await sock.sendMessage(from, { text: `🎉 *ACERTOU!* Era *${jogo.valor}*! Parabens @${sender.split("@")[0]}!`, mentions: [sender] });
          db._numeroSecreto = null; saveDB(db);
        } else {
          await sock.sendMessage(from, { text: `Errou! O numero e *${chute < jogo.valor ? "maior" : "menor"}* que ${chute}.` });
        }
        continue;
      }

      if (comando === "!menu") {
        await sock.sendMessage(from, {
          text: `╔════════════════════════╗
║  🤖 *MENU ISAAC BOT*  ║
╠════════════════════════╣
║  *🛠️ GERAIS*           ║
║ !ping  !hora  !calc   ║
╠════════════════════════╣
║  *🤖 IA*               ║
║ !ia [pergunta]        ║
║ !iaesquecer           ║
╠════════════════════════╣
║  *😂 DIVERSAO*         ║
║ !piada  !curiosidade  ║
║ !motivacao            ║
║ !elogio  !zoeira      ║
╠════════════════════════╣
║  *🎮 JOGOS*            ║
║ !quiz + !gabarito     ║
║ !mito + !revelar      ║
║ !vod  !desafio        ║
║ !dicadesafio          ║
║ !8ball  !adivinhe     ║
╠════════════════════════╣
║  *🎲 SORTEIOS*         ║
║ !dado  !moeda         ║
║ !numero  !roleta      ║
║ !sortear  !ship       ║
╠════════════════════════╣
║  *🖼️ STICKERS*         ║
║ !sticker  !stickergif ║
╠════════════════════════╣
║  *👑 ADMIN*            ║
║ !autorizar  !banir    ║
║ !silenciar  !promover ║
║ !bloquearfrase        ║
║ !bloquearaudio on/off ║
║ !fechargrupo  !link   ║
║ !apagar               ║
╚════════════════════════╝
Dono: *${DONO}* 👑`,
        });
        continue;
      }

      // ─────────────────────────────────────────
      //  STICKER — CORRIGIDO PARA MOBILE
      //  Injeta chunk EXIF no WebP com nome/autor
      // ─────────────────────────────────────────
      if (comando === "!sticker") {
        try {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const imgMsg = msg.message?.imageMessage || quoted?.imageMessage;

          if (!imgMsg) {
            await sock.sendMessage(from, { text: "Envie uma imagem com *!sticker* ou responda uma imagem." });
            continue;
          }

          await sock.sendMessage(from, { text: "🖼️ Criando sticker..." });

          const msgParaDownload = msg.message?.imageMessage
            ? msg
            : { key: msg.key, message: quoted };

          let buffer;
          try {
            buffer = await downloadMediaMessage(msgParaDownload, "buffer", {}, { reuploadRequest: sock.updateMediaMessage });
          } catch {
            buffer = await downloadMediaMessage(msgParaDownload, "buffer", {});
          }

          if (!buffer || buffer.length === 0) {
            await sock.sendMessage(from, { text: "Nao consegui baixar a imagem. Tente reenviar." });
            continue;
          }

          const tmpIn = `./tmp_in_${Date.now()}.jpg`;
          const tmpOut = `./tmp_out_${Date.now()}.webp`;
          fs.writeFileSync(tmpIn, buffer);

          // Sharp gera o WebP com fundo transparente 512x512
          await sharp(tmpIn)
            .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 90 })
            .toFile(tmpOut);

          // Lê e injeta EXIF com nome/autor — obrigatório para o mobile
          let webp = fs.readFileSync(tmpOut);
          webp = injetarExifNoWebP(webp, STICKER_NOME, STICKER_AUTOR);

          try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch {}

          await sock.sendMessage(from, { sticker: webp });

        } catch (e) {
          console.error("Erro sticker:", e.message);
          await sock.sendMessage(from, { text: "Erro ao criar sticker: " + e.message });
        }
        continue;
      }

      // ─────────────────────────────────────────
      //  STICKER GIF — CORRIGIDO PARA MOBILE
      // ─────────────────────────────────────────
      if (comando === "!stickergif") {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const vidMsg = msg.message?.videoMessage || quoted?.videoMessage;

        if (!vidMsg) {
          await sock.sendMessage(from, { text: "Envie ou cite um video com !stickergif" });
          continue;
        }

        try {
          await sock.sendMessage(from, { text: "🎬 Criando sticker animado..." });

          const buffer = await downloadMediaMessage(
            vidMsg === msg.message?.videoMessage ? msg : { message: quoted },
            "buffer", {}
          );

          const inputPath = `./tmp_input_${Date.now()}.mp4`;
          const outputPath = `./tmp_output_${Date.now()}.webp`;
          fs.writeFileSync(inputPath, buffer);

          await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
              .inputOptions(["-t", "6"])
              .outputOptions([
                "-vcodec", "libwebp",
                "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse",
                "-loop", "0", "-preset", "default", "-an", "-vsync", "0",
              ])
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          });

          let webp = fs.readFileSync(outputPath);
          webp = injetarExifNoWebP(webp, STICKER_NOME, STICKER_AUTOR);

          await sock.sendMessage(from, { sticker: webp });
          try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch {}

        } catch (e) {
          await sock.sendMessage(from, { text: "Erro ao criar sticker animado: " + e.message });
        }
        continue;
      }

      // ─────────────────────────────────────────
      //  COMANDOS COM AUTORIZACAO
      // ─────────────────────────────────────────
      if (!isAutorizado(db, sender)) {
        await sock.sendMessage(from, { text: msgNaoAutorizado() });
        continue;
      }

      if (comando === "!autorizar") {
        const alvo = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? toJID(args[0]) : null);
        if (!alvo) { await sock.sendMessage(from, { text: "Use: !autorizar @pessoa" }); continue; }
        if (!db.autorizados.includes(alvo)) { db.autorizados.push(alvo); saveDB(db); }
        await sock.sendMessage(from, { text: `@${alvo.split("@")[0]} autorizado!`, mentions: [alvo] });
        continue;
      }
      if (comando === "!desautorizar") {
        const alvo = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? toJID(args[0]) : null);
        if (!alvo) { await sock.sendMessage(from, { text: "Use: !desautorizar @pessoa" }); continue; }
        db.autorizados = db.autorizados.filter(j => j !== alvo); saveDB(db);
        await sock.sendMessage(from, { text: `@${alvo.split("@")[0]} desautorizado.`, mentions: [alvo] });
        continue;
      }
      if (comando === "!listaradmins") {
        if (!db.autorizados.length) { await sock.sendMessage(from, { text: "Nenhum autorizado." }); continue; }
        await sock.sendMessage(from, { text: `*Autorizados:*\n${db.autorizados.map(j => `@${j.split("@")[0]}`).join("\n")}`, mentions: db.autorizados });
        continue;
      }
      if (comando === "!banir" || comando === "!remover") {
        if (!isGroup) { await sock.sendMessage(from, { text: "Use em grupos." }); continue; }
        const alvoRaw = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? toJID(args[0]) : null);
        if (!alvoRaw) { await sock.sendMessage(from, { text: `Use: ${comando} @pessoa` }); continue; }
        try {
          const meta = await sock.groupMetadata(from);
          const p = meta.participants.find(p => p.id === alvoRaw || p.id.split("@")[0] === alvoRaw.split("@")[0]);
          const jidReal = p?.id || alvoRaw;
          await sock.groupParticipantsUpdate(from, [jidReal], "remove");
          await sock.sendMessage(from, { text: `@${jidReal.split("@")[0]} ${comando === "!banir" ? "*BANIDO*" : "removido"}.`, mentions: [jidReal] });
        } catch (e) { await sock.sendMessage(from, { text: "Erro: " + e.message }); }
        continue;
      }
      if (comando === "!silenciar") {
        if (!isGroup) { await sock.sendMessage(from, { text: "Use em grupos." }); continue; }
        const alvoRaw = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? toJID(args[0]) : null);
        let alvo = alvoRaw;
        try {
          const meta = await sock.groupMetadata(from);
          const p = meta.participants.find(p => p.id === alvoRaw || p.id.split("@")[0] === alvoRaw?.split("@")[0]);
          if (p) alvo = p.id;
        } catch {}
        const tempo = args.filter(a => !a.startsWith("@")).pop();
        if (!alvo || !tempo) { await sock.sendMessage(from, { text: "Use: !silenciar @pessoa 10m | 2h | 1d | perm" }); continue; }
        if (tempo === "perm") {
          db.silenciados[alvo] = { tipo: "perm", ate: null };
          if (alvoRaw !== alvo) db.silenciados[alvoRaw] = { tipo: "perm", ate: null };
          saveDB(db);
          await sock.sendMessage(from, { text: `@${alvo.split("@")[0]} silenciado *permanentemente*.`, mentions: [alvo] });
        } else {
          const match = tempo.match(/^(\d+)(m|h|d)$/i);
          if (!match) { await sock.sendMessage(from, { text: "Formato: 10m, 2h, 1d ou perm" }); continue; }
          const mult = { m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
          const ate = Date.now() + parseInt(match[1]) * mult;
          db.silenciados[alvo] = { tipo: "temp", ate };
          if (alvoRaw !== alvo) db.silenciados[alvoRaw] = { tipo: "temp", ate };
          saveDB(db);
          await sock.sendMessage(from, { text: `@${alvo.split("@")[0]} silenciado por *${match[1]}${match[2]}*.`, mentions: [alvo] });
        }
        continue;
      }
      if (comando === "!dessilenciar") {
        const alvoRaw = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? toJID(args[0]) : null);
        let alvo = alvoRaw;
        try {
          const meta = await sock.groupMetadata(from);
          const p = meta.participants.find(p => p.id === alvoRaw || p.id.split("@")[0] === alvoRaw?.split("@")[0]);
          if (p) alvo = p.id;
        } catch {}
        if (!alvo) { await sock.sendMessage(from, { text: "Use: !dessilenciar @pessoa" }); continue; }
        delete db.silenciados[alvo]; if (alvoRaw) delete db.silenciados[alvoRaw]; saveDB(db);
        await sock.sendMessage(from, { text: `@${alvo.split("@")[0]} *dessilenciado*.`, mentions: [alvo] });
        continue;
      }
      if (comando === "!bloquearfrase") {
        const frase = args.join(" ");
        if (!frase) { await sock.sendMessage(from, { text: "Use: !bloquearfrase palavra" }); continue; }
        if (!db.bloqueioFrases.includes(frase)) { db.bloqueioFrases.push(frase); saveDB(db); }
        await sock.sendMessage(from, { text: `Bloqueada: *"${frase}"*\n_(Vale mesmo com espacos entre letras!)_` });
        continue;
      }
      if (comando === "!desbloquearfrase") {
        const frase = args.join(" ");
        db.bloqueioFrases = db.bloqueioFrases.filter(f => f !== frase); saveDB(db);
        await sock.sendMessage(from, { text: `Desbloqueada: *"${frase}"*` });
        continue;
      }
      if (comando === "!listarfrases") {
        if (!db.bloqueioFrases.length) { await sock.sendMessage(from, { text: "Nenhuma frase bloqueada." }); continue; }
        await sock.sendMessage(from, { text: `*Frases bloqueadas:*\n${db.bloqueioFrases.map((f, i) => `${i + 1}. "${f}"`).join("\n")}` });
        continue;
      }
      if (comando === "!bloquearaudio") {
        const opcao = args[0]?.toLowerCase();
        if (opcao === "on") { db.bloqueioAudios = true; saveDB(db); await sock.sendMessage(from, { text: "Audios bloqueados!" }); }
        else if (opcao === "off") { db.bloqueioAudios = false; saveDB(db); await sock.sendMessage(from, { text: "Audios liberados!" }); }
        else await sock.sendMessage(from, { text: "Use: !bloquearaudio on | off" });
        continue;
      }
      if (comando === "!promover") {
        if (!isGroup) continue;
        const alvo = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? toJID(args[0]) : null);
        if (!alvo) { await sock.sendMessage(from, { text: "Use: !promover @pessoa" }); continue; }
        await sock.groupParticipantsUpdate(from, [alvo], "promote");
        await sock.sendMessage(from, { text: `@${alvo.split("@")[0]} promovido a *admin*!`, mentions: [alvo] });
        continue;
      }
      if (comando === "!rebaixar") {
        if (!isGroup) continue;
        const alvo = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? toJID(args[0]) : null);
        if (!alvo) { await sock.sendMessage(from, { text: "Use: !rebaixar @pessoa" }); continue; }
        await sock.groupParticipantsUpdate(from, [alvo], "demote");
        await sock.sendMessage(from, { text: `@${alvo.split("@")[0]} rebaixado.`, mentions: [alvo] });
        continue;
      }
      if (comando === "!fechargrupo") {
        if (!isGroup) continue;
        await sock.groupSettingUpdate(from, "announcement");
        await sock.sendMessage(from, { text: "Grupo fechado!" });
        continue;
      }
      if (comando === "!abrirgrupo") {
        if (!isGroup) continue;
        await sock.groupSettingUpdate(from, "not_announcement");
        await sock.sendMessage(from, { text: "Grupo aberto!" });
        continue;
      }
      if (comando === "!link") {
        if (!isGroup) continue;
        const code = await sock.groupInviteCode(from);
        await sock.sendMessage(from, { text: `Link:\nhttps://chat.whatsapp.com/${code}` });
        continue;
      }
      if (comando === "!apagar") {
        const citada = msg.message?.extendedTextMessage?.contextInfo;
        if (!citada?.quotedMessage) { await sock.sendMessage(from, { text: "Cite uma mensagem." }); continue; }
        await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: citada.stanzaId, participant: citada.participant } });
        continue;
      }
    }
  });
}

startBot();