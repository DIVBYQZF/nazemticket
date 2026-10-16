const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('طرد عضو من السيرفر')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('العضو المراد طرده')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('سبب الطرد')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  async execute(interaction) {}
};
