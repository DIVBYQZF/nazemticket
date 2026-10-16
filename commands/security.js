const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('عرض حالة درع الحماية والأمان الخاص بالسيرفر')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {}
};
