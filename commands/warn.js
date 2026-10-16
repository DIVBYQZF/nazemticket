const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('إعطاء تحذير رسمي لعضو في السيرفر')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('العضو المراد تحذيره')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('سبب التحذير')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  async execute(interaction) {}
};
