const API_URL = "https://nationalbank.kz/rss/rates_all.xml";
const CURRENCIES = {
  KZT: "Казахстанский тенге",
  RUB: "Российский рубль",
  USD: "Доллар США",
  EUR: "Евро",
  CNY: "Китайский юань"
};
const CACHE_KEY = "nbkRatesV1";
const THEME_KEY = "theme";
const CACHE_TTL = 6 * 60 * 60 * 1000;

const status = document.querySelector("#status");
const refresh = document.querySelector("#refresh");
const themeToggle = document.querySelector("#theme-toggle");
const error = document.querySelector("#error");
const container = document.querySelector("#converters");
const addButton = document.querySelector("#add");
let rates = null;
let cards = [];
let nextId = 0;
let saveQueue = Promise.resolve();
const storage = typeof browser !== "undefined" ? browser.storage.local : chrome.storage.local;
function storageGet(key) {
  if (typeof browser !== "undefined") return storage.get(key);
  return new Promise(resolve => storage.get(key, resolve));
}
function storageSet(value) {
  if (typeof browser !== "undefined") return storage.set(value);
  return new Promise(resolve => storage.set(value, resolve));
}
function saveCards() {
  const converters = cards.map(card => ({ amount: card.amount.value, from: card.from.value, to: card.to.value }));
  saveQueue = saveQueue.then(() => storageSet({ converters }));
}
function addCard(saved = { amount: "1", from: "KZT", to: "USD" }) {
  const element = document.querySelector("#converter-template").content.firstElementChild.cloneNode(true);
  const card = { element };
  for (const field of ["amount", "from", "to", "result", "rate", "error"]) card[field] = element.querySelector(`[data-field="${field}"]`);
  const id = nextId++;
  for (const field of ["amount", "from", "to"]) {
    card[field].id = `${field}-${id}`;
    element.querySelector(`[data-label="${field}"]`).htmlFor = card[field].id;
  }
  card.error.id = `error-${id}`;
  card.amount.setAttribute("aria-describedby", card.error.id);
  for (const [code, name] of Object.entries(CURRENCIES)) {
    for (const select of [card.from, card.to]) {
      const option = new Option(code, code);
      option.title = `${code} — ${name}`;
      select.add(option);
    }
  }
  card.amount.value = typeof saved.amount === "string" ? saved.amount : "1";
  card.from.value = CURRENCIES[saved.from] ? saved.from : "KZT";
  card.to.value = CURRENCIES[saved.to] ? saved.to : "USD";
  const update = () => { convertCard(card); saveCards(); };
  card.amount.addEventListener("input", update);
  card.from.addEventListener("change", update);
  card.to.addEventListener("change", update);
  element.querySelector(".swap").addEventListener("click", () => {
    [card.from.value, card.to.value] = [card.to.value, card.from.value];
    update();
  });
  element.querySelector(".remove").addEventListener("click", () => {
    cards = cards.filter(item => item !== card);
    element.remove(); updateLayout(); saveCards();
  });
  cards.push(card); container.append(element); updateLayout(); convertCard(card);
}
function updateLayout() {
  document.body.classList.toggle("multiple", cards.length > 1);
  cards.forEach((card, index) => {
    card.element.querySelector(".card-title").textContent = `Конвертер ${index + 1}`;
    card.element.querySelector(".remove").disabled = cards.length === 1;
  });
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark", isDark);
  themeToggle.textContent = isDark ? "☀" : "☾";
  themeToggle.title = isDark ? "Включить светлую тему" : "Включить тёмную тему";
  themeToggle.setAttribute("aria-label", themeToggle.title);
}

function parseNumber(value) {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  return normalized === "" ? NaN : Number(normalized);
}

function format(value, currency) {
  return new Intl.NumberFormat("ru-KZ", {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 100 ? 2 : 4
  }).format(value);
}

function parseRates(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Нацбанк вернул некорректные данные");

  const parsed = { KZT: 1 };
  for (const item of doc.querySelectorAll("item")) {
    const code = item.querySelector("title")?.textContent?.trim();
    if (!CURRENCIES[code]) continue;
    const value = Number(item.querySelector("description")?.textContent?.trim().replace(",", "."));
    const quantity = Number(item.querySelector("quant")?.textContent?.trim() || "1");
    if (Number.isFinite(value) && value > 0 && Number.isFinite(quantity) && quantity > 0) {
      parsed[code] = value / quantity;
    }
  }

  const missing = Object.keys(CURRENCIES).filter(code => parsed[code] == null);
  if (missing.length) throw new Error(`Нет курса: ${missing.join(", ")}`);
  return parsed;
}

function convertCard(card) {
  const { amount, from, to, result, rate: rateText, error } = card;
  error.textContent = "";
  const value = parseNumber(amount.value);
  if (!Number.isFinite(value) || value < 0) {
    result.textContent = "—"; rateText.textContent = "";
    error.textContent = "Введите число не меньше нуля";
    return;
  }
  if (!rates) return;
  const unitRate = rates[from.value] / rates[to.value];
  const converted = value * unitRate;
  if (!Number.isFinite(converted)) {
    result.textContent = "—"; rateText.textContent = "";
    error.textContent = "Слишком большая сумма"; return;
  }
  result.textContent = format(converted, to.value);
  rateText.textContent = `1 ${from.value} = ${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 6 }).format(unitRate)} ${to.value}`;
}
function convert() { cards.forEach(convertCard); }

async function loadRates(force = false) {
  refresh.disabled = true;
  error.textContent = "";
  try {
    const cached = await storageGet([CACHE_KEY, "rates"]);
    const stored = cached[CACHE_KEY] || (cached.rates && { rates: cached.rates.map, date: cached.rates.date, savedAt: cached.rates.saved });
    if (!force && stored && Date.now() - stored.savedAt < CACHE_TTL) {
      rates = stored.rates;
      status.textContent = `Курс НБК на ${stored.date}`;
      convert();
      return;
    }

    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Ошибка HTTP ${response.status}`);
    const text = await response.text();
    rates = parseRates(text);
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const date = doc.querySelector("item > pubDate")?.textContent?.trim()
      || new Date().toLocaleDateString("ru-KZ");
    await storageSet({ [CACHE_KEY]: { rates, date, savedAt: Date.now() } });
    status.textContent = `Курс НБК на ${date}`;
    convert();
  } catch (cause) {
    const cached = await storageGet([CACHE_KEY, "rates"]);
    const stored = cached[CACHE_KEY] || (cached.rates && { rates: cached.rates.map, date: cached.rates.date, savedAt: cached.rates.saved });
    if (stored) {
      rates = stored.rates;
      status.textContent = `Сохранённый курс на ${stored.date}`;
      error.textContent = "Не удалось обновить курс — показаны последние сохранённые данные";
      convert();
    } else {
      status.textContent = "Курс недоступен";
      error.textContent = `Не удалось получить данные: ${cause.message}`;
    }
  } finally {
    refresh.disabled = false;
  }
}

addButton.addEventListener("click", () => {
  const last = cards[cards.length - 1];
  addCard({ amount: "1", from: last.to.value, to: last.from.value });
  saveCards();
});
refresh.addEventListener("click", () => loadRates(true));
themeToggle.addEventListener("click", async () => {
  const theme = document.body.classList.contains("dark") ? "light" : "dark";
  applyTheme(theme);
  await storageSet({ [THEME_KEY]: theme });
});
async function initialize() {
  const saved = await storageGet([THEME_KEY, "converters"]);
  applyTheme(saved[THEME_KEY] || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  if (Array.isArray(saved.converters) && saved.converters.length) {
    saved.converters.filter(item => item && typeof item === "object").forEach(addCard);
  }
  if (!cards.length) addCard();
  addButton.disabled = false;
  loadRates();
}
initialize();
