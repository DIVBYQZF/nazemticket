const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, saveConfig } = require('../handlers/ticketHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-role')
    .setDescription('تعيين رتبة الدعم الفني والإدارة المسؤولة عن التذاكر')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('الرتبة التي ستتمكن من رؤية واستلام وإدارة التذاكر')
        .setRequired(true)
    ),

  async execute(interaction) {
    const targetRole = interaction.options.getRole('role');
    const config = getConfig();

    config.supportRoleId = targetRole.id;
    const success = saveConfig(config);

    if (success) {
      return interaction.reply({
        content: `✅ تم تعيين رتبة الدعم الفني والإدارة بنجاح إلى: ${targetRole}\n👥 أصحاب هذه الرتبة سيتمكنون من استلام التذاكر والرد عليها ونسخ السجلات.`,
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
