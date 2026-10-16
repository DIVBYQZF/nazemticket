const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('مسح عدد معين من الرسائل من القناة الحالية')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('عدد الرسائل المراد مسحها (1 إلى 100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {}
};
