import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, "catalog.json");

/**
 * Reads catalog.json and formats it as a plain-text product list
 * suitable for inserting into the system prompt.
 */
async function formatForPrompt() {
  const raw = await fs.readFile(CATALOG_PATH, "utf-8");
  const products = JSON.parse(raw);

  return products
    .map((p) => {
      const sizes = p.sizes && p.sizes.length ? `Розміри: ${p.sizes.join(", ")}.` : "";
      const status = p.available ? "В наявності." : "Немає в наявності.";
      return `- ${p.name} — ${p.price} грн. ${sizes} ${status}`.replace(/\s+/g, " ").trim();
    })
    .join("\n");
}

export default { formatForPrompt };
