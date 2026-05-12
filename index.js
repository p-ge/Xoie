const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const chromium = require("@sparticuz/chromium");

puppeteer.use(StealthPlugin());

// --------------- Hardcoded IDs ---------------
const ALLOWED_GUILD_ID = "1453057495034495069";
const ALLOWED_CHANNEL_ID = "1503812507582730321";
// ---------------------------------------------

const TOKEN = process.env.DISCORD_TOKEN;
console.log("DISCORD_TOKEN exists:", !!TOKEN, "length:", TOKEN ? TOKEN.length : 0);
const PORT = process.env.PORT || 3000;

// --------------- Discord Client Setup ---------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --------------- Express Web Server (Render health check) ---------------
const app = express();
app.get("/", (req, res) => res.send("Platoboost bot is online and locked!"));
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// --------------- Utility ---------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------- Platoboost Bypass Logic ---------------
async function bypassPlatoboost(page) {
  const url = page.url();

  if (/gateway\.platoboost\.com\/a\/8\?id=/.test(url)) {
    if (!url.includes("&tk=297h")) {
      const newUrl = url + "&tk=297h";
      console.log("Appending bypass token →", newUrl);
      await page.goto(newUrl, { waitUntil: "networkidle2", timeout: 30000 });
    }
    await page.evaluate(() => {
      const el = document.getElementById("dontfoid");
      if (el) el.remove();
    });

    // Try clicking verify/continue button if present
    try {
      await page.waitForSelector("button", { timeout: 5000 });
      const clicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button")];
        const btn = btns.find(
          (b) =>
            /verify|continue|get key|free/i.test(b.textContent)
        );
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (clicked) {
        console.log("Clicked verify/continue button on gateway");
        await sleep(3000);
      }
    } catch (_) {}
  }

  if (url.includes("linkvertise.com")) {
    console.log("On Linkvertise – waiting for Platoboost headline...");
    try {
      await page.waitForFunction(
        () => {
          const headline = document.querySelector(
            ".content-component__headline.ng-star-inserted"
          );
          return headline && /platoboost/i.test(headline.textContent);
        },
        { timeout: 30000 }
      );
      console.log("Headline found – navigating back");
      await page.goBack({ waitUntil: "networkidle2", timeout: 30000 });
    } catch (e) {
      console.warn("Linkvertise headline wait failed:", e.message);
    }
  }
}

async function extractKey(page) {
  const body = await page.evaluate(() => document.body.innerText);
  // FREE_ style key
  const freeMatch = body.match(/FREE_[a-f0-9]{32}/i);
  if (freeMatch) return freeMatch[0];
  // Generic long token
  const tokenMatch = body.match(/\b[A-Za-z0-9_\-]{40,}\b/);
  if (tokenMatch) return tokenMatch[0];
  throw new Error("No key found on page.");
}

async function fetchKeyFromLink(link) {
  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    defaultViewport: { width: 1366, height: 768 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  // Intercept and block ads/trackers to speed things up
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const blocked = ["doubleclick", "googlesyndication", "adservice", "analytics"];
    if (blocked.some((b) => req.url().includes(b))) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    console.log(`Navigating to ${link}`);
    await page.goto(link, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(4000);

    let attempts = 0;
    while (attempts < 8) {
      const currentUrl = page.url();
      console.log(`[Attempt ${attempts + 1}] URL: ${currentUrl}`);

      const bodyText = await page.evaluate(() => document.body.innerText);

      // Key already on page
      if (/FREE_[a-f0-9]{32}/i.test(bodyText)) {
        console.log("Key found in body, extracting...");
        break;
      }

      if (
        currentUrl.includes("gateway.platoboost.com") ||
        currentUrl.includes("linkvertise.com")
      ) {
        await bypassPlatoboost(page);
        await sleep(3000);
      } else {
        // Still on relay or unknown page, wait a bit
        await sleep(2000);
      }

      attempts++;
    }

    const key = await extractKey(page);
    console.log("Key extracted:", key);
    return key;
  } finally {
    await browser.close();
  }
}

// --------------- Duplicate Link Guard ---------------
const recentLinks = new Set();
function isDuplicate(link) {
  if (recentLinks.has(link)) return true;
  recentLinks.add(link);
  setTimeout(() => recentLinks.delete(link), 60_000); // expire after 60s
  return false;
}

// --------------- Message Handler ---------------
let isProcessing = false;

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content) return;
  if (message.guildId !== ALLOWED_GUILD_ID) return;
  if (message.channelId !== ALLOWED_CHANNEL_ID) return;

  const linkRegex = /https?:\/\/auth\.platorelay\.com\/a\?d=[^\s]+/gi;
  const links = message.content.match(linkRegex);
  if (!links || links.length === 0) return;

  const link = links[0];

  if (isDuplicate(link)) {
    return message.reply("⚠️ This link was already submitted recently.");
  }

  if (isProcessing) {
    return message.reply("⏳ A bypass is already in progress, please wait.");
  }
  isProcessing = true;

  const statusEmbed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🔍 Bypassing Platoboost...")
    .setDescription("Attempting to extract the key. Please wait.")
    .setFooter({ text: "Platoboost Bypass Bot" })
    .setTimestamp();

  const statusMsg = await message.channel.send({ embeds: [statusEmbed] });

  try {
    const key = await fetchKeyFromLink(link);

    const successEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Done Bypass")
      .setDescription(`Key successfully extracted!`)
      .addFields(
        { name: "📱 Mobile Copy", value: `\`\`${key}\`\``, inline: false },
        { name: "💻 PC Copy", value: `\`\`\`${key}\`\`\``, inline: false }
      )
      .setFooter({ text: "Platoboost Bypass Bot" })
      .setTimestamp();

    await statusMsg.edit({ embeds: [successEmbed] });
  } catch (err) {
    console.error("Bypass failed:", err.message);

    const failEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("❌ Bypass Failed")
      .setDescription(
        `The bypass could not complete.\n\`\`\`${err.message}\`\`\``
      )
      .setFooter({ text: "Platoboost Bypass Bot" })
      .setTimestamp();

    await statusMsg.edit({ embeds: [failEmbed] });
  } finally {
    isProcessing = false;
  }
});

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`Locked to guild ${ALLOWED_GUILD_ID}, channel ${ALLOWED_CHANNEL_ID}`);
});

client.login(TOKEN);
