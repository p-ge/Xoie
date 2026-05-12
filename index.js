// ========================================================
//  Platoboost Discord Bot – auto-bypass & key delivery
// ========================================================
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const chromium = require("@sparticuz/chromium");
const fs = require("fs");

puppeteer.use(StealthPlugin());

// --------------- Configuration ---------------
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;

let ALLOWED_CHANNEL_ID = null;
const CHANNEL_FILE = "channel.txt";

if (fs.existsSync(CHANNEL_FILE)) {
  ALLOWED_CHANNEL_ID = fs.readFileSync(CHANNEL_FILE, "utf8").trim();
  console.log(`Loaded allowed channel ID: ${ALLOWED_CHANNEL_ID}`);
}

// --------------- Discord Client Setup ---------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --------------- Express Web Server (for Render) ---------------
const app = express();
app.get("/", (req, res) => res.send("Platoboost bot is online!"));
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// --------------- Discord Slash Command Registration ---------------
const commands = [
  new SlashCommandBuilder()
    .setName("set_channel")
    .setDescription("Restrict bot to only reply in this channel (admin only)")
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("The channel to allow")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(0),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
})();

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
        const headline = document.querySelector(".content-component__headline.ng-star-inserted");
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
      if (currentUrl.includes("gateway.platoboost.com") || currentUrl.includes("linkvertise.com")) {
        await bypassPlatoboost(page);
        await page.waitForTimeout(3000);
      } else if (/FREE_/.test(await page.evaluate(() => document.body.innerText))) {
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

// --------------- Message Handling ---------------
let isProcessing = false;

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content) return;

  if (ALLOWED_CHANNEL_ID && message.channel.id !== ALLOWED_CHANNEL_ID) return;

  const linkRegex = /https?:\/\/auth\.platorelay\.com\/a\?d=[^\s]+/gi;
  const links = message.content.match(linkRegex);
  if (!links || links.length === 0) return;

  if (isProcessing) {
    return message.reply("⏳ A bypass is already in progress, please wait.");
  }

  isProcessing = true;
  const statusMsg = await message.reply("🔍 Bypassing Platoboost...");

  try {
    const key = await fetchKeyFromLink(links[0]);
    await message.channel.send(`🎉 **Your Key:** \`\`\`${key}\`\`\``);
    await statusMsg.delete().catch(() => {});
  } catch (err) {
    console.error("Bypass failed:", err);
    await statusMsg.edit("❌ Failed to extract the key. The page may have changed or the link is invalid.");
  } finally {
    isProcessing = false;
  }
});

// --------------- Slash Command Handler ---------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "set_channel") {
    const channel = interaction.options.getChannel("channel");
    ALLOWED_CHANNEL_ID = channel.id;

    fs.writeFileSync(CHANNEL_FILE, channel.id, "utf8");
    await interaction.reply({
      content: `✅ Bot will now only respond in ${channel}.`,
      ephemeral: true,
    });
  }
});

// --------------- Ready Event ---------------
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// --------------- Start the Bot ---------------
client.login(TOKEN);
