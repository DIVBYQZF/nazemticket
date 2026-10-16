require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('❌ يرجى التأكد من تعبئة DISCORD_TOKEN و CLIENT_ID في ملف .env');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  } else {
    console.warn(`[تحذير] الملف في ${filePath} يفتقر إلى خاصية data أو execute المطلوبة.`);
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`⏳ جاري تسجيل ${commands.length} من أوامر السلاش (/) ...`);

    let data;
    if (guildId && guildId.trim() !== '' && guildId !== clientId) {
      // تسجيل خاص بالسيرفر (يظهر فورياً بدون تأخير)
      data = await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`✅ تم تسجيل ${data.length} أمر بنجاح للسيرفر: ${guildId}`);
    } else {
      // تسجيل عام لجميع السيرفرات (Global)
      data = await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log(`✅ تم تسجيل ${data.length} أمر بنجاح بشكل عام لجميع السيرفرات (Global).`);
    }
  } catch (error) {
    console.error('❌ حدث خطأ أثناء تسجيل الأوامر:', error);
  }
})();
