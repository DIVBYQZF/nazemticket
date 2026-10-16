const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig, saveConfig } = require('../handlers/ticketHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-logs')
    .setDescription('تعيين روم السجلات واللوقات الخاصة بالتذاكر للإدارة')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('الروم المراد إرسال لوقات وسجلات التذاكر فيها')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel');
    const config = getConfig();

    config.logsChannelId = targetChannel.id;
    const success = saveConfig(config);

    if (success) {
      return interaction.reply({
        content: `✅ تم تعيين روم اللوقات وسجلات الإدارة بنجاح إلى: ${targetChannel}\n🔒 سيتم إرسال جميع أحداث التذاكر ونسخ الـ Transcripts إلى هذه الروم للإدارة فقط.`,
        ephemeral: true
      });
    } else {
      return interaction.reply({
        content: '❌ حدث خطأ أثناء حفظ الإعدادات في ملف `config.json`.',
        ephemeral: true
      });
    }
  }
};
