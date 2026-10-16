const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('عرض قائمة تحذيرات عضو معين')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('العضو المراد فحص تحذيراته')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  async execute(interaction) {}
};
