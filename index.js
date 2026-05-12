const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const chromium = require("@sparticuz/chromium");

puppeteer.use(StealthPlugin());

// --------------- Hardcoded IDs ---------------
const ALLOWED_GUILD_ID = "1453057495034495069";
const ALLOWED_CHANNEL_ID = "1503812507582730321";

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

// --------------- Express Web Server ---------------
const app = express();
app.get("/", (req, res) => res.send("Platoboost bot is online and locked!"));
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// --------------- Utility ---------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------- Full Platoboost Delta Bypass (based on Tampermonkey script) ---------------
async function platoboostDeltaBypass(page) {
  // Wait for gateway URL: gateway.platoboost.com/a/8?id=...
  await page.waitForFunction(
    () => /gateway\.platoboost\.com\/a\/8\?id=/.test(window.location.href),
    { timeout: 90000 }
  );
  await sleep(2000); // let the page settle

  const url = page.url();
  const id = new URL(url).searchParams.get("id");
  if (!id) throw new Error("Missing id in gateway URL");

  console.log(`[Delta] Processing id = ${id}`);

  // Step 1 – Get authenticator info
  const authInfo = await page.evaluate(async (id) => {
    const res = await fetch(`https://api-gateway.platoboost.com/v1/authenticators/8/${id}`);
    return res.json();
  }, id);

  // If key already present, return it
  if (authInfo.key) {
    console.log("Key already present in authenticator response");
    return authInfo.key;
  }

  // Step 2 – If we already have a `tk` in the URL, complete the session
  const tk = new URL(url).searchParams.get("tk");
  if (tk) {
    console.log("Using existing tk to complete session...");
    const completeRes = await page.evaluate(async (id, tk) => {
      const res = await fetch(`https://api-gateway.platoboost.com/v1/sessions/auth/8/${id}/${tk}`, {
        method: "PUT",
      });
      return res.json();
    }, id, tk);

    // The response might redirect us to the key page or another Linkvertise
    if (completeRes.redirect) {
      console.log("Completing with redirect:", completeRes.redirect);
      await page.goto(completeRes.redirect, { waitUntil: "networkidle2", timeout: 30000 });
      // Now the key should appear on the page
    }
    await sleep(3000);
    const body = await page.evaluate(() => document.body.innerText);
    const keyMatch = body.match(/FREE_[a-f0-9]{32}/i);
    if (keyMatch) return keyMatch[0];
    throw new Error("Key not found after completing session with tk");
  }

  // Step 3 – No tk: initiate a new session (POST)
  console.log("No tk – initiating session...");
  const initRes = await page.evaluate(async (id) => {
    const res = await fetch(`https://api-gateway.platoboost.com/v1/sessions/auth/8/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        captcha: "",  // no captcha for most simple tasks
        type: "",
      }),
    });
    return res.json();
  }, id);

  // The response contains a `redirect` field (a Linkvertise URL)
  if (!initRes.redirect) throw new Error("No redirect in session init response");

  console.log("Session init redirect:", initRes.redirect);

  // Step 4 – Decode the Linkvertise redirect: extract `r` and base64 decode
  const decodedUrl = await page.evaluate((redirectUrl) => {
    const u = new URL(redirectUrl);
    const r = u.searchParams.get("r");
    if (!r) return redirectUrl; // fallback
    return atob(r); // base64 decode
  }, initRes.redirect);

  console.log("Decoded destination URL:", decodedUrl);

  // Step 5 – Navigate to the final destination
  await page.goto(decodedUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(5000); // wait for key to load

  // Step 6 – Extract the key
  const body = await page.evaluate(() => document.body.innerText);
  const keyMatch = body.match(/FREE_[a-f0-9]{32}/i);
  if (keyMatch) return keyMatch[0];
  throw new Error("Key not found on final page");
}

// --------------- Generic Linkvertise auto‑clicker (to speed up pass‑through) ---------------
async function autoClickLinkvertise(page) {
  try {
    // Wait for any common Linkvertise button (this covers most layouts)
    const btn = await page.waitForSelector(
      'a[href*="linkvertise.com"], button:has-text("Free Access"), button:has-text("Continue"), .btn-primary',
      { timeout: 10000 }
    );
    if (btn) {
      await btn.click();
      console.log("Clicked Linkvertise button");
      await sleep(3000);
    }
  } catch (e) {
    // no button found – page may auto‑redirect
  }
}

// --------------- Main Bypass Orchestrator ---------------
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

  try {
    console.log(`Navigating to ${link}`);
    await page.goto(link, { waitUntil: "networkidle2", timeout: 60000 });

    // We may land on Linkvertise first -> auto‑click
    if (page.url().includes("linkvertise.com")) {
      console.log("On Linkvertise – auto‑clicking…");
      await autoClickLinkvertise(page);
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    }

    // Now we should be on gateway.platoboost.com – run the Delta bypass
    const key = await platoboostDeltaBypass(page);
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
  setTimeout(() => recentLinks.delete(link), 60_000);
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
      .setDescription("Key successfully extracted!")
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
      .setDescription(`The bypass could not complete.\n\`\`\`${err.message}\`\`\``)
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

client.on("error", (err) => console.error("Discord client error:", err.message));
client.on("warn", (info) => console.warn("Discord warning:", info));
client.on("shardError", (err) => console.error("Shard error:", err.message));

client.login(TOKEN);
