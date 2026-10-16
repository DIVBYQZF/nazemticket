const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('حظر عضو نهائياً من السيرفر')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('العضو المراد حظره')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('سبب الحظر')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async execute(interaction) {}
};
