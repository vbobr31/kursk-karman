// Чат-бот «Умный карман курского школьника» — Cloudflare Worker.
// Telegram webhook: POST /tg   ·   API для сайта: POST /api/chat
// Секреты: BOT_TOKEN, WEBHOOK_SECRET (npx wrangler secret put ...)
import fallbackData from "../../docs/data/events.json";

const SITE = "https://vbobr31.github.io/kursk-karman/";
const DATA_URL = SITE + "data/events.json";
const BANNER = SITE + "img/banner.png";
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_SUM = 1_000_000;

const SYSTEM_PROMPT = `Ты — дружелюбный помощник «Умный карман курского школьника».
Отвечаешь школьникам 12–18 лет из Курской области по-русски, коротко (до 6 предложений), просто и доброжелательно.
Темы: как копить карманные деньги, финансовая грамотность (бюджет, цели, правило 50/30/20, вклады, инфляция — простыми словами),
культурные места Курской области (драмтеатр им. Пушкина, филармония, театр кукол, картинная галерея им. Дейнеки,
краеведческий музей, усадьба Фета «Воробьёвка», Коренная пустынь, мемориал «Курская дуга»), Пушкинская карта.
Главный объект проекта — Курский драматический театр им. А.С. Пушкина (основан в 1792 году): когда уместно, предлагай накопить именно на спектакль в нём.
Не придумывай точные даты, цены и расписания — советуй уточнить на сайте или в кассе учреждения.
Не советуй кредиты, ставки, казино, криптовалюту и рискованные вложения. Если вопрос не по теме — мягко верни к теме.
Не используй Markdown-разметку, можно эмодзи.`;

// ---------------- данные ----------------
async function getData() {
  try {
    const r = await fetch(DATA_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) return await r.json();
  } catch (_) {}
  return fallbackData;
}

const rub = (n) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
function eventTotal(ev, data) {
  const travel = (ev.rides || 0) * (data.travelPerRide || 40) + (ev.extra || 0);
  return { travel, total: (ev.price || 0) + travel };
}
function bar(p) {
  const n = Math.max(0, Math.min(10, Math.round(p / 10)));
  return "▓".repeat(n) + "░".repeat(10 - n) + ` ${Math.min(100, Math.round(p))}%`;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------- состояние пользователя (KV) ----------------
const blank = () => ({ balance: 0, goal: null, step: null, plan: null, coins: 0, quizDone: [], hist: [], ai: [], remind: false });
async function load(env, id) {
  const s = await env.KV.get("u:" + id, "json");
  return Object.assign(blank(), s || {});
}
const save = (env, id, s) => env.KV.put("u:" + id, JSON.stringify(s));

// ---------------- Telegram API ----------------
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
const kb = (rows) => ({ inline_keyboard: rows });
const send = (env, chat_id, text, rows) =>
  tg(env, "sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...(rows ? { reply_markup: kb(rows) } : {}) });

const MENU = [
  [{ text: "⭐ Наш объект: драмтеатр им. Пушкина", callback_data: "ev:drama" }],
  [{ text: "🎭 Афиша", callback_data: "afisha" }, { text: "🎯 Моя цель", callback_data: "goal" }],
  [{ text: "🐷 Копилка", callback_data: "piggy" }, { text: "💡 Советы", callback_data: "tip:0" }],
  [{ text: "🎟 Льготы", callback_data: "benefits" }, { text: "🧠 Викторина", callback_data: "quiz" }],
  [{ text: "🎬 Видео", callback_data: "video" }, { text: "🤖 Спросить ИИ", callback_data: "ai" }],
  [{ text: "🔔 Напоминания", callback_data: "remind" }],
  [{ text: "📱 Открыть приложение", web_app: { url: SITE } }],
];
const BACK = [{ text: "🏠 Меню", callback_data: "menu" }];

const WELCOME = `👋 <b>Привет! Я — Умный карман курского школьника.</b>

⭐ Наш объект культуры — <b>Курский драматический театр им. А.С. Пушкина</b>, один из старейших театров России (с 1792 года).

Помогу накопить на спектакль в нём, а ещё на музей, концерт или поездку по Курской области — без долгов и лишних трат.

<b>Что я умею:</b>
🎭 покажу афишу культурных мест Курска и области
🎯 посчитаю, сколько откладывать в неделю, чтобы успеть
🐷 буду вести твою копилку — пиши <code>+100</code> или <code>-50</code>
💡 дам советы по финансовой грамотности
🎟 расскажу про Пушкинскую карту и льготы
🧠 проведу викторину о Курском крае
🤖 отвечу на вопросы с помощью ИИ

С чего начнём? 👇`;

// ---------------- экраны ----------------
async function showMenu(env, chat) {
  await send(env, chat, "🏠 <b>Главное меню</b>\nВыбери, что сделать:", MENU);
}

async function showAfisha(env, chat, data) {
  const rows = data.events.map((ev) => {
    const { total } = eventTotal(ev, data);
    return [{ text: `${ev.main ? "⭐ " : ""}${ev.emoji} ${ev.title.replace(/^Спектакль в |^Концерт в |^Представление в /, "")} · ${total ? rub(total) : "бесплатно"}`, callback_data: "ev:" + ev.id }];
  });
  rows.push(BACK);
  await send(env, chat, `🎭 <b>Афиша Курского края</b>\nСумма = билет + дорога (ориентировочно, обновлено ${data.updated}).\nВыбери событие:`, rows);
}

async function showEvent(env, chat, data, id) {
  const ev = data.events.find((e) => e.id === id);
  if (!ev) return showAfisha(env, chat, data);
  const { travel, total } = eventTotal(ev, data);
  const travelLine = ev.extra ? `🚌 ${ev.extraTitle}: ~${rub(travel)}` : `🚌 проезд (${ev.rides} поездки): ~${rub(travel)}`;
  const text = `${ev.emoji} <b>${esc(ev.title)}</b>
📍 ${esc(ev.place)}

${esc(ev.about)}

🎫 билет: ${ev.price ? "~" + rub(ev.price) : "вход свободный"}
${travelLine}
💰 <b>итого нужно: ~${rub(total)}</b>${ev.pushkin ? "\n🎟 можно оплатить Пушкинской картой (14+)" : ""}

<i>Цены ориентировочные — уточни на сайте или в кассе.</i>`;
  await send(env, chat, text, [
    [{ text: "🎯 Копить на это", callback_data: "set:" + ev.id }],
    [{ text: "🔎 Узнать расписание", url: "https://yandex.ru/search/?text=" + encodeURIComponent(ev.search) }],
    [{ text: "◀️ Афиша", callback_data: "afisha" }, ...BACK],
  ]);
}

async function showGoal(env, chat, s) {
  if (!s.goal) {
    return send(env, chat, "🎯 У тебя пока нет цели.\nВыбери событие в афише — и я посчитаю план накопления.", [[{ text: "🎭 Открыть афишу", callback_data: "afisha" }], BACK]);
  }
  const p = (s.balance / s.goal.total) * 100;
  let text = `🎯 <b>Цель:</b> ${esc(s.goal.title)}\n💰 нужно: ${rub(s.goal.total)}\n🐷 в копилке: ${rub(s.balance)}\n${bar(p)}`;
  if (s.plan) text += `\n\n📅 План: откладывать <b>${rub(s.plan.perWeek)}</b> в неделю (≈${rub(s.plan.perDay)} в день), срок — ${s.plan.weeks} нед.`;
  if (s.balance >= s.goal.total) text += "\n\n🎉 <b>Цель достигнута! Можно идти за билетом!</b>";
  await send(env, chat, text, [
    [{ text: "🔁 Пересчитать план", callback_data: "set:" + s.goal.id }],
    [{ text: "🐷 Копилка", callback_data: "piggy" }, ...BACK],
  ]);
}

async function showPiggy(env, chat, s) {
  let text = `🐷 <b>Копилка</b>\nБаланс: <b>${rub(s.balance)}</b>`;
  if (s.goal) text += `\nЦель: ${esc(s.goal.title)} — ${rub(s.goal.total)}\n${bar((s.balance / s.goal.total) * 100)}`;
  if (s.goal && s.balance < s.goal.total) text += `\nОсталось: ${rub(s.goal.total - s.balance)}`;
  text += `\n\nЧтобы пополнить или потратить, просто напиши: <code>+150</code> или <code>-40 мороженое</code>`;
  await send(env, chat, text, [
    [{ text: "+50", callback_data: "add:50" }, { text: "+100", callback_data: "add:100" }, { text: "+200", callback_data: "add:200" }],
    [{ text: "−50", callback_data: "add:-50" }, { text: "−100", callback_data: "add:-100" }],
    [{ text: "📜 История", callback_data: "hist" }, ...BACK],
  ]);
}

async function applyMoney(env, chat, s, delta, note) {
  if (s.balance + delta < 0) {
    return send(env, chat, `🙅 В копилке только ${rub(s.balance)} — нельзя потратить ${rub(-delta)}.`, [[{ text: "🐷 Копилка", callback_data: "piggy" }]]);
  }
  s.balance += delta;
  s.hist.unshift({ d: new Date().toISOString().slice(0, 10), v: delta, n: (note || "").slice(0, 40) });
  s.hist = s.hist.slice(0, 20);
  let msg = delta > 0 ? `✅ Отложено ${rub(delta)}. Молодец! 💪` : `📝 Записал трату ${rub(-delta)}${note ? " — " + esc(note) : ""}.`;
  msg += `\nВ копилке: <b>${rub(s.balance)}</b>`;
  if (s.goal) {
    msg += `\n${bar((s.balance / s.goal.total) * 100)}`;
    if (s.balance >= s.goal.total) msg += `\n\n🎉 <b>Ура! Ты накопил на «${esc(s.goal.title)}»!</b>`;
  }
  await send(env, chat, msg, [[{ text: "🐷 Копилка", callback_data: "piggy" }, ...BACK]]);
}

async function showTip(env, chat, data, i) {
  const n = data.tips.length;
  const k = ((i % n) + n) % n;
  await send(env, chat, `${data.tips[k]}\n\n<i>Совет ${k + 1} из ${n}</i>`, [
    [{ text: "➡️ Следующий совет", callback_data: "tip:" + (k + 1) }],
    BACK,
  ]);
}

async function showQuiz(env, chat, s, data) {
  const left = data.quiz.map((_, i) => i).filter((i) => !s.quizDone.includes(i));
  if (!left.length) {
    return send(env, chat, `🏆 Ты ответил на все вопросы!\nТвои курские монеты: <b>${s.coins} 🪙</b>`, [[{ text: "🔄 Пройти заново", callback_data: "qreset" }], BACK]);
  }
  const qi = left[Math.floor(Math.random() * left.length)];
  const q = data.quiz[qi];
  await send(env, chat, `🧠 <b>Вопрос</b> (осталось ${left.length})\n\n${esc(q.q)}`, [
    ...q.a.map((a, ai) => [{ text: a, callback_data: `qa:${qi}:${ai}` }]),
    BACK,
  ]);
}

async function answerQuiz(env, chat, s, data, qi, ai) {
  const q = data.quiz[qi];
  if (!q) return showQuiz(env, chat, s, data);
  const first = !s.quizDone.includes(qi);
  if (first) s.quizDone.push(qi);
  let text;
  if (ai === q.ok) {
    if (first) s.coins += 5;
    text = `✅ <b>Верно!</b> ${first ? "+5 🪙" : ""}\n${esc(q.why)}`;
  } else {
    text = `❌ Не совсем. Правильный ответ: <b>${esc(q.a[q.ok])}</b>\n${esc(q.why)}`;
  }
  text += `\n\nКурские монеты: <b>${s.coins} 🪙</b>`;
  await save(env, chat, s);
  await send(env, chat, text, [[{ text: "➡️ Следующий вопрос", callback_data: "quiz" }], BACK]);
}

async function showVideo(env, chat, data) {
  await send(env, chat, "🎬 <b>Видео о Курском крае и финансах</b>\nВыбери тему — откроется подборка роликов на Rutube:", [
    ...data.videos.map((v) => [{ text: "▶️ " + v.title, url: v.url }]),
    BACK,
  ]);
}

// ---------------- мастер цели ----------------
async function startGoal(env, chat, s, data, id) {
  const ev = data.events.find((e) => e.id === id);
  if (!ev) return showAfisha(env, chat, data);
  const { total } = eventTotal(ev, data);
  s.goal = { id: ev.id, title: ev.title, total };
  s.step = "have";
  s.plan = null;
  await send(env, chat, `🎯 Цель: <b>${esc(ev.title)}</b> — ~${rub(total)}\n\n<b>Шаг 1 из 3.</b> Сколько денег у тебя уже есть?\nНапиши число, например <code>150</code> (если нет — <code>0</code>).`);
}

function parseSum(text) {
  const t = text.replace(/\s/g, "").replace(/₽|руб\.?|р\.?$/gi, "");
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return n <= MAX_SUM ? n : null;
}

async function goalStep(env, chat, s, text) {
  const n = parseSum(text);
  if (s.step === "have") {
    if (n === null) return send(env, chat, "🤔 Мне нужно число — сколько рублей у тебя уже есть. Например: <code>150</code> или <code>0</code>.");
    s.balance = n;
    s.step = "income";
    return send(env, chat, "<b>Шаг 2 из 3.</b> Сколько рублей в неделю ты можешь откладывать?\nНапример: <code>100</code>");
  }
  if (s.step === "income") {
    if (n === null) return send(env, chat, "🤔 Напиши сумму в неделю числом, например <code>100</code>.");
    s.plan = { income: n };
    s.step = "weeks";
    return send(env, chat, "<b>Шаг 3 из 3.</b> Через сколько недель событие? Напиши число от 1 до 52.\nНапример: <code>4</code>");
  }
  if (s.step === "weeks") {
    if (n === null || n < 1 || n > 52) return send(env, chat, "🤔 Нужно число недель от 1 до 52, например <code>4</code>.");
    s.step = null;
    const need = s.goal.total - s.balance;
    const income = s.plan.income;
    if (need <= 0) {
      s.plan = null;
      return send(env, chat, `🎉 У тебя уже есть ${rub(s.balance)} — этого хватает на «${esc(s.goal.title)}»! Можно идти за билетом.`, [BACK]);
    }
    const perWeek = Math.ceil(need / n);
    const perDay = Math.ceil(perWeek / 7);
    s.plan = { income, weeks: n, perWeek, perDay };
    let text = `📊 <b>План накопления</b>\nЦель: ${esc(s.goal.title)} — ${rub(s.goal.total)}\nУже есть: ${rub(s.balance)}\nНе хватает: <b>${rub(need)}</b>\n\n`;
    if (perWeek <= income) {
      text += `✅ Успеваешь! Откладывай <b>${rub(perWeek)} в неделю</b> (≈${rub(perDay)} в день) — и через ${n} нед. цель будет твоей.`;
      if (income > perWeek) text += `\nОстаток ${rub(income - perWeek)} в неделю можно потратить на себя 😉`;
    } else {
      const realWeeks = income > 0 ? Math.ceil(need / income) : null;
      text += `⚠️ Нужно ${rub(perWeek)} в неделю, а ты можешь ${rub(income)}.\n`;
      text += realWeeks ? `При твоём темпе накопишь за <b>${realWeeks} нед.</b>\n` : "";
      text += `\n<b>Что можно сделать:</b>\n• выбрать событие подешевле или бесплатное\n• перенести поход на ${realWeeks || "более поздний"} срок\n• сократить траты (см. советы)\n• использовать Пушкинскую карту, если тебе 14+`;
    }
    await send(env, chat, text, [
      [{ text: "🐷 Открыть копилку", callback_data: "piggy" }, { text: "🔔 Напоминать", callback_data: "remind" }],
      [{ text: "🎟 Льготы", callback_data: "benefits" }, ...BACK],
    ]);
  }
}

// ---------------- ИИ ----------------
async function askAI(env, history) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history.slice(-8)];
  const r = await env.AI.run(AI_MODEL, { messages, max_tokens: 500, temperature: 0.5 });
  return (r && (r.response || r.result?.response) || "").trim() || "Не получилось ответить, попробуй переформулировать 🙂";
}

async function aiReply(env, chat, s, text) {
  await tg(env, "sendChatAction", { chat_id: chat, action: "typing" });
  s.ai.push({ role: "user", content: text.slice(0, 800) });
  let answer;
  try {
    answer = await askAI(env, s.ai);
  } catch (e) {
    answer = "😔 ИИ сейчас недоступен. Попробуй позже или загляни в «Советы».";
  }
  s.ai.push({ role: "assistant", content: answer.slice(0, 1500) });
  s.ai = s.ai.slice(-8);
  await send(env, chat, "🤖 " + esc(answer), [BACK]);
}

// ---------------- обработка апдейтов ----------------
async function handleUpdate(env, upd) {
  const data = await getData();

  if (upd.callback_query) {
    const cq = upd.callback_query;
    const chat = cq.message.chat.id;
    const d = cq.data || "";
    const s = await load(env, chat);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    s.step = null; // любая кнопка прерывает незаконченный мастер цели
    if (d === "menu") await showMenu(env, chat);
    else if (d === "afisha") await showAfisha(env, chat, data);
    else if (d.startsWith("ev:")) await showEvent(env, chat, data, d.slice(3));
    else if (d.startsWith("set:")) await startGoal(env, chat, s, data, d.slice(4));
    else if (d === "goal") await showGoal(env, chat, s);
    else if (d === "piggy") await showPiggy(env, chat, s);
    else if (d.startsWith("add:")) await applyMoney(env, chat, s, parseInt(d.slice(4), 10), "");
    else if (d === "hist") {
      const lines = s.hist.length ? s.hist.map((h) => `${h.d}  ${h.v > 0 ? "+" : ""}${h.v} ₽ ${esc(h.n)}`).join("\n") : "Пока пусто.";
      await send(env, chat, `📜 <b>Последние операции</b>\n<code>${lines}</code>`, [[{ text: "🐷 Копилка", callback_data: "piggy" }, ...BACK]]);
    } else if (d.startsWith("tip:")) await showTip(env, chat, data, parseInt(d.slice(4), 10) || 0);
    else if (d === "benefits") await send(env, chat, data.benefits, [[{ text: "🎟 Пушкинская карта", url: "https://www.culture.ru/pushkinskaya-karta" }], BACK]);
    else if (d === "quiz") await showQuiz(env, chat, s, data);
    else if (d === "qreset") { s.quizDone = []; await showQuiz(env, chat, s, data); }
    else if (d.startsWith("qa:")) { const [, qi, ai] = d.split(":"); await answerQuiz(env, chat, s, data, +qi, +ai); return; }
    else if (d === "video") await showVideo(env, chat, data);
    else if (d === "ai") { s.step = "ai"; await send(env, chat, "🤖 Задай вопрос текстом — про деньги, накопления или культурные места Курска.\nНапример: <i>Как накопить на концерт, если мне дают 300 ₽ в неделю?</i>", [BACK]); }
    else if (d === "remind") {
      s.remind = !s.remind;
      await setSub(env, chat, s.remind);
      await send(env, chat, s.remind ? "🔔 Готово! Каждое воскресенье я напомню отложить деньги и покажу прогресс." : "🔕 Напоминания выключены.", [BACK]);
    } else await showMenu(env, chat);
    await save(env, chat, s);
    return;
  }

  const msg = upd.message;
  if (!msg || !msg.chat) return;
  const chat = msg.chat.id;
  const text = (msg.text || "").trim();
  const s = await load(env, chat);

  if (!text) {
    await send(env, chat, "Я понимаю только текст 🙂 Нажми /menu.");
    return;
  }
  if (text === "/start" || text.startsWith("/start ")) {
    s.step = null;
    await tg(env, "sendPhoto", { chat_id: chat, photo: BANNER, caption: WELCOME, parse_mode: "HTML", reply_markup: kb(MENU) })
      .then((r) => (r.ok ? r : send(env, chat, WELCOME, MENU)));
  } else if (text === "/menu") { s.step = null; await showMenu(env, chat); }
  else if (text === "/afisha") await showAfisha(env, chat, data);
  else if (text === "/goal") await showGoal(env, chat, s);
  else if (text === "/piggy") await showPiggy(env, chat, s);
  else if (text === "/quiz") await showQuiz(env, chat, s, data);
  else if (text === "/help") await send(env, chat, WELCOME, MENU);
  else if (text === "/reset") { await save(env, chat, blank()); await setSub(env, chat, false); await send(env, chat, "🧹 Данные очищены. Начнём заново — /start"); return; }
  else if (["have", "income", "weeks"].includes(s.step)) await goalStep(env, chat, s, text);
  else {
    const m = text.match(/^([+-])\s*(\d{1,7})\s*(?:₽|руб\.?|р\.?)?\s*(.*)$/i);
    if (m) {
      const v = parseInt(m[2], 10);
      if (v === 0 || v > MAX_SUM) await send(env, chat, "🤔 Сумма должна быть от 1 до 1 000 000 ₽.");
      else await applyMoney(env, chat, s, m[1] === "-" ? -v : v, m[3]);
    } else if (/^\d+$/.test(text)) {
      await send(env, chat, "Это пополнение или трата? Напиши со знаком: <code>+" + text + "</code> или <code>-" + text + "</code>");
    } else {
      await aiReply(env, chat, s, text);
    }
  }
  await save(env, chat, s);
}

// ---------------- напоминания ----------------
async function setSub(env, chat, on) {
  const list = (await env.KV.get("subs", "json")) || [];
  const set = new Set(list);
  on ? set.add(chat) : set.delete(chat);
  await env.KV.put("subs", JSON.stringify([...set]));
}

async function sendReminders(env) {
  const list = (await env.KV.get("subs", "json")) || [];
  for (const chat of list) {
    const s = await load(env, chat);
    let text = "🔔 <b>Воскресное напоминание!</b>\nПора отложить деньги в копилку 🐷";
    if (s.goal) {
      text += `\n\n🎯 ${esc(s.goal.title)}\n${bar((s.balance / s.goal.total) * 100)}`;
      if (s.plan?.perWeek) text += `\nПо плану: <b>${rub(s.plan.perWeek)}</b> в неделю.`;
    }
    text += "\n\nНапиши, например, <code>+100</code>";
    await send(env, chat, text, [[{ text: "🐷 Копилка", callback_data: "piggy" }]]);
  }
}

// ---------------- HTTP ----------------
function cors(origin) {
  const ok = origin && (origin.endsWith(".github.io") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1"));
  return {
    "access-control-allow-origin": ok ? origin : "https://vbobr31.github.io",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin",
  };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");

    if (url.pathname === "/tg" && req.method === "POST") {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const upd = await req.json();
      ctx.waitUntil(handleUpdate(env, upd).catch((e) => console.error("update error", e && e.stack)));
      return new Response("ok");
    }

    if (url.pathname === "/api/chat") {
      if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
      if (req.method !== "POST") return new Response("method", { status: 405 });
      let body;
      try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers: cors(origin) }); }
      const history = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }));
      if (!history.length || history[history.length - 1].role !== "user") return new Response("no question", { status: 400, headers: cors(origin) });
      try {
        const answer = await askAI(env, history);
        return Response.json({ answer }, { headers: cors(origin) });
      } catch (e) {
        return Response.json({ answer: "😔 ИИ сейчас недоступен, попробуй позже." }, { status: 503, headers: cors(origin) });
      }
    }

    if (url.pathname === "/cron" && req.method === "POST") {
      if (req.headers.get("x-cron-secret") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      await sendReminders(env);
      return new Response("sent");
    }

    if (url.pathname === "/") return new Response("Умный карман курского школьника — бот работает ✅\n" + SITE, { headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response("not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};
