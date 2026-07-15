// manual-test.mjs
//
// Локальний інтеграційний тест: перевіряє mapper -> validator -> cache
// -> pricing -> searcher -> repository БЕЗ реального звернення до
// Google Sheets (бо в цьому середовищі немає мережевого доступу).

import { mapRow } from "./src/catalog/catalogMapper.js";
import { validateAll } from "./src/catalog/catalogValidator.js";
import cache from "./src/catalog/catalogCache.js";
import catalogRepository from "./src/catalog/catalogRepository.js";
import { calculateMarkup } from "./src/pricing/markupCalculator.js";
import { roundPrice } from "./src/pricing/priceFormatter.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

// Симулюємо сирі рядки так, ніби вони прийшли з Google Sheets/CSV
// (масив масивів, у тому ж порядку колонок, що й catalogMapper.js).
// Колонка "Ціна" тепер = ЗАКУПІВЕЛЬНА ціна (costPrice).
const rawRows = [
  // id, name, category, brand, price(cost), oldPrice(cost), currency, description, sizes, colors, quantity, sku, photoUrl, status, createdAt, updatedAt, tags
  ["PRD-001", "Air Force White", "Взуття", "Nike", 1900, "", "грн", "Класичні кеди", "39,40,41,42,43", "білий", 12, "NK-AF1-WHT", "", "active", "2026-01-01", "2026-07-01", "кеди, спорт"],
  ["PRD-002", "Superstar Black", "Взуття", "Adidas", 2100, 2400, "грн", "Легендарні кеди", "38,39,40,41", "чорний", 5, "AD-SS-BLK", "", "active", "2026-01-01", "2026-07-01", "кеди"],
  ["PRD-003", "RS-X", "Взуття", "Puma", 2400, "", "грн", "", "40,41,42,44", "сірий", 0, "PM-RSX", "", "out_of_stock", "2026-01-01", "2026-06-01", "кросівки"],
  ["PRD-004", "", "Взуття", "NoName", 500, "", "грн", "Без назви — має бути відхилений", "", "", 3, "BAD-001", "", "active", "", "", ""],
  ["PRD-005", "Дивний товар", "Взуття", "Test", "не число", "", "грн", "Ціна текстом — має бути відхилений", "", "", 1, "BAD-002", "", "active", "", "", ""],
  ["PRD-006", "Прихований товар", "Взуття", "Hidden", 999, "", "грн", "", "", "", 5, "HID-001", "", "hidden", "", "", ""],
  ["PRD-007", "Округлення тест", "Взуття", "Test", 1533, "", "грн", "", "", "", 2, "ROUND-001", "", "active", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""], // повністю порожній рядок — має бути проігнорований
];

console.log("\n=== 1. Тест CatalogMapper (перейменовані поля costPrice/oldCostPrice) ===");
const mapped = rawRows.map((row, i) => mapRow(row, i + 2));
assert(mapped[7] === null, "Повністю порожній рядок мапиться в null");
assert(mapped[0].name === "Air Force White", "Назва товару читається коректно");
assert(mapped[0].sizes.length === 5, "Розміри розбиваються по комі (5 розмірів)");
assert(mapped[0].costPrice === 1900, "costPrice парситься як число (закупівельна ціна)");
assert(mapped[0].price === undefined, "Поля 'price' на етапі мапера НЕ існує (лише costPrice)");
assert(mapped[1].oldCostPrice === 2400, "oldCostPrice парситься коректно");
assert(mapped[4].costPrice !== mapped[4].costPrice, "Некоректна ціна ('не число') дає NaN у costPrice");

console.log("\n=== 2. Тест CatalogValidator (перевіряє costPrice) ===");
const filtered = mapped.filter(Boolean);
const { valid, errors, warnings } = validateAll(filtered);
assert(valid.length === 5, `Валідних товарів: очікується 5, отримано ${valid.length}`);
assert(errors.length === 2, `Товарів з помилками: очікується 2, отримано ${errors.length}`);
assert(
  errors.some((e) => e.errors.includes("відсутня назва товару")),
  "Товар без назви коректно відхилено"
);
assert(
  errors.some((e) => e.errors.includes("закупівельна ціна не є числом")),
  "Товар з нечисловою закупівельною ціною коректно відхилено"
);

console.log("\n=== 3. Тест MarkupCalculator (чиста математика) ===");
assert(calculateMarkup(1500, "percentage", 30, 0) === 1950, "percentage: 1500 + 30% = 1950");
assert(calculateMarkup(1500, "fixed", 0, 300) === 1800, "fixed: 1500 + 300 грн = 1800");
assert(calculateMarkup(1500, "combined", 30, 100) === 2050, "combined: 1500 +30% +100 грн = 2050 (спочатку %, потім фікс.)");

console.log("\n=== 4. Тест PriceFormatter (округлення) ===");
assert(roundPrice(1992.9, 10) === 1990, "roundPrice(1992.9, 10) округлює до 1990");
assert(roundPrice(1995, 10) === 2000, "roundPrice(1995, 10) округлює до 2000 (за стандартними правилами округлення)");
assert(roundPrice(1949.6, 1) === 1950, "roundPrice(1949.6, 1) округлює до цілого 1950");
assert(roundPrice(1953, 0) === 1953, "roundPrice з roundTo=0 не змінює число");

console.log("\n=== 5. Тест CatalogCache ===");
cache.set(valid);
assert(cache.getActive().length === 5, "Кеш містить 5 товарів після set()");
assert(cache.version === 1, "Версія кешу інкрементувалась після set()");
const versionBeforeError = cache.version;
cache.recordError(new Error("Тестова помилка мережі"));
assert(cache.getActive().length === 5, "Товари ЗАЛИШАЮТЬСЯ в кеші після помилки (fallback працює)");
assert(cache.version === versionBeforeError, "Версія кешу НЕ змінюється при помилці");

console.log("\n=== 6. Тест CatalogRepository + Pricing (formatForPrompt) ===");
// MARKUP_PERCENT=30, PRICE_ROUND_TO=10 за замовчуванням (з .env.example) —
// але process.env у тестовому середовищі порожній, тому pricingConfig
// використає власні дефолти: MARKUP_TYPE=percentage, MARKUP_PERCENT=30, PRICE_ROUND_TO=10.
const promptText = await catalogRepository.formatForPrompt();

assert(promptText.includes("Air Force White"), "У тексті для AI є видимий товар");
assert(!promptText.includes("Прихований товар"), "Прихований (status=hidden) товар НЕ потрапляє в текст для AI");
assert(promptText.includes("Немає в наявності"), "Товар з quantity=0 / out_of_stock позначений як недоступний");

// Air Force White: costPrice=1900, +30% = 2470, округлення до 10 -> 2470 (вже кратне)
assert(promptText.includes("2470 грн"), "Кінцева ціна (з націнкою 30%) показана клієнту: 1900 -> 2470 грн");
assert(!promptText.includes("1900 грн"), "Закупівельна ціна (1900) НЕ показана клієнту напряму");

// Округлення тест: costPrice=1533, +30% = 1992.9, округлення до 10 -> 1990
assert(promptText.includes("1990 грн"), "Округлення кінцевої ціни до 10 грн працює: 1533 -> 1990 грн");

console.log("--- Приклад тексту для system prompt (з націнкою): ---\n" + promptText);

console.log("\n=== 7. Тест: costPrice НІКОЛИ не витікає за межі PricingService ===");
const allPriced = catalogRepository.getAll();
const anyLeaked = allPriced.some((p) => "costPrice" in p || "oldCostPrice" in p);
assert(!anyLeaked, "Жоден товар з getAll() не містить поля costPrice/oldCostPrice");
assert(allPriced.every((p) => typeof p.price === "number" || p.price === null), "Усі товари мають числове поле price (кінцева ціна)");

console.log("\n=== 8. Тест CatalogRepository (search / filter / getBySku) з цінами ===");
const searchResult = catalogRepository.search("nike");
assert(searchResult.length === 1 && searchResult[0].brand === "Nike", "Пошук за брендом 'nike' знаходить Air Force White");
assert(searchResult[0].price === 2470, "Результат пошуку містить КІНЦЕВУ ціну (2470), не закупівельну");

const filterResult = catalogRepository.filter({ inStockOnly: true });
assert(filterResult.every((p) => p.quantity > 0), "Фільтр inStockOnly повертає лише товари з кількістю > 0");
assert(!filterResult.some((p) => p.name === "Прихований товар"), "Прихований товар не з'являється навіть у filter()");

// Superstar Black: costPrice=2100, +30% = 2730 (кратне 10)
const priceFilterResult = catalogRepository.filter({ minPrice: 2500, maxPrice: 3000 });
assert(
  priceFilterResult.some((p) => p.name === "Superstar Black"),
  "Фільтр за КІНЦЕВОЮ ціною (minPrice/maxPrice) знаходить Superstar Black (2730 грн) у діапазоні 2500-3000"
);
assert(
  !priceFilterResult.some((p) => p.name === "Air Force White"),
  "Фільтр за ціною коректно виключає товар поза діапазоном (2470 грн не входить у 2500-3000)"
);

const skuResult = catalogRepository.getBySku("AD-SS-BLK");
assert(skuResult && skuResult.name === "Superstar Black", "Пошук за точним SKU працює");
assert(skuResult.price === 2730, "Товар за SKU містить кінцеву ціну (2730), не закупівельну (2100)");

console.log("\n=== 9. Тест getStatus() (включно з pricing) ===");
const status = catalogRepository.getStatus();
assert(status.productCount === 5, "getStatus() показує правильну кількість товарів");
assert(status.lastError && status.lastError.message === "Тестова помилка мережі", "getStatus() показує останню помилку синхронізації");
assert(status.pricing && status.pricing.percent === 30, "getStatus() показує поточні налаштування націнки");

console.log("\n=== Готово ===");
if (process.exitCode === 1) {
  console.log("\n⚠️  Є провалені тести, дивись FAIL вище.");
} else {
  console.log("\n🎉 Усі тести пройдені успішно.");
}
