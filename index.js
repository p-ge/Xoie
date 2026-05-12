const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const chromium = require("@sparticuz/chromium");

puppeteer.use(StealthPlugin());

// --------------- Hardcoded IDs ---------------
const ALLOWED_GUILD_ID = "1453057495034495069";   // Your server
const ALLOWED_CHANNEL_ID = "1503812507582730321"; // #bypass-link channel
// ------------------------------------------

const TOKEN = process.env.DISCORD_TOKEN;  // Set on Render
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
  }

  if (url.includes("linkvertise.com")) {
    console.log("On Linkvertise – waiting for Platoboost headline...");
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
    await page.goBack();
  }
}

async function extractKey(page) {
  const body = await page.evaluate(() => document.body.innerText);
  const freeMatch = body.match(/FREE_[a-f0-9]{32}/i);
  if (freeMatch) return freeMatch[0];
  const tokenMatch = body.match(/\b[A-Za-z0-9+/=]{40,}\b/);
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

  try {
    console.log(`Navigating to ${link}`);
    await page.goto(link, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForTimeout(4000);

    let attempts = 0;
    while (attempts < 5) {
      const currentUrl = page.url();
      if (
        currentUrl.includes("gateway.platoboost.com") ||
        currentUrl.includes("linkvertise.com")
      ) {
        await bypassPlatoboost(page);
        await page.waitForTimeout(3000);
      } else if (
        /FREE_/.test(await page.evaluate(() => document.body.innerText))
      ) {
        break;
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

// --------------- Message Handler ---------------
let isProcessing = false;

client.on("messageCreate", async (message) => {
  // Ignore bots, empty messages, other servers, other channels
  if (message.author.bot || !message.content) return;
  if (message.guildId !== ALLOWED_GUILD_ID) return;
  if (message.channelId !== ALLOWED_CHANNEL_ID) return;

  const linkRegex = /https?:\/\/auth\.platorelay\.com\/a\?d=[^\s]+/gi;
  const links = message.content.match(linkRegex);
  if (!links || links.length === 0) return;

  if (isProcessing) {
    return message.reply("⏳ A bypass is already in progress, please wait.");
  }
  isProcessing = true;

  // Yellow embed – "Bypassing..."
  const statusEmbed = new EmbedBuilder()
    .setColor(0xf1c40f) // yellow
    .setTitle("🔍 Bypassing Platoboost...")
    .setDescription("Attempting to extract the key. Please wait.")
    .setFooter({ text: "Platoboost Bypass Bot" })
    .setTimestamp();

  const statusMsg = await message.channel.send({ embeds: [statusEmbed] });

  try {
    const key = await fetchKeyFromLink(links[0]);

    // Green embed – "Done Bypass"
    const successEmbed = new EmbedBuilder()
      .setColor(0x2ecc71) // green
      .setTitle("✅ Done Bypass")
      .addFields(
        {
          name: "📱 Mobile Copy",
          value: `\`\`${key}\`\``,
          inline: false,
        },
        {
          name: "💻 PC Copy",
          value: `\`\`\`${key}\`\`\``,
          inline: false,
        }
      )
      .setFooter({ text: "Platoboost Bypass Bot" })
      .setTimestamp();

    await statusMsg.edit({ embeds: [successEmbed] });
  } catch (err) {
    console.error("Bypass failed:", err);

    const failEmbed = new EmbedBuilder()
      .setColor(0xe74c3c) // red
      .setTitle("❌ Bypass Failed")
      .setDescription("The page may have changed or the link is invalid.")
      .setFooter({ text: "Platoboost Bypass Bot" })
      .setTimestamp();

    await statusMsg.edit({ embeds: [failEmbed] });
  } finally {
    isProcessing = false;
  }
});

// --------------- Ready ---------------
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`Locked to guild ${ALLOWED_GUILD_ID}, channel ${ALLOWED_CHANNEL_ID}`);
});

client.login(TOKEN);
