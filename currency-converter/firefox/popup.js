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

const amount = document.querySelector("#amount");
const from = document.querySelector("#from");
const to = document.querySelector("#to");
const result = document.querySelector("#result");
const rateText = document.querySelector("#rate");
const error = document.querySelector("#error");
const status = document.querySelector("#status");
const refresh = document.querySelector("#refresh");
const themeToggle = document.querySelector("#theme-toggle");
let rates = null;

for (const [code, name] of Object.entries(CURRENCIES)) {
  from.add(new Option(`${code} — ${name}`, code));
  to.add(new Option(`${code} — ${name}`, code));
}
from.value = "KZT";
to.value = "USD";

function storageGet(key) {
  return new Promise(resolve => browser.storage.local.get(key).then(resolve));
}

function storageSet(value) {
  return browser.storage.local.set(value);
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

function convert() {
  error.textContent = "";
  const value = parseNumber(amount.value);
  if (!Number.isFinite(value) || value < 0) {
    result.textContent = "—";
    rateText.textContent = "";
    error.textContent = "Введите корректную положительную сумму";
    return;
  }
  if (!rates) return;

  const converted = value * rates[from.value] / rates[to.value];
  const unitRate = rates[from.value] / rates[to.value];
  result.textContent = format(converted, to.value);
  rateText.textContent = `1 ${from.value} = ${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 6 }).format(unitRate)} ${to.value}`;
}

async function loadRates(force = false) {
  refresh.disabled = true;
  error.textContent = "";
  try {
    const stored = (await storageGet(CACHE_KEY))[CACHE_KEY];
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
    const stored = (await storageGet(CACHE_KEY))[CACHE_KEY];
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

amount.addEventListener("input", convert);
from.addEventListener("change", convert);
to.addEventListener("change", convert);
document.querySelector("#swap").addEventListener("click", () => {
  [from.value, to.value] = [to.value, from.value];
  convert();
});
refresh.addEventListener("click", () => loadRates(true));
themeToggle.addEventListener("click", async () => {
  const theme = document.body.classList.contains("dark") ? "light" : "dark";
  applyTheme(theme);
  await storageSet({ [THEME_KEY]: theme });
});

storageGet(THEME_KEY).then(saved => {
  const theme = saved[THEME_KEY]
    || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
});
loadRates();
