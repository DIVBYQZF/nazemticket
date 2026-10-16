const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('كتم (تايم أوت) عضو لفترة زمنية محددة')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('العضو المراد كتمه')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('minutes')
        .setDescription('مدة الكتم بالدقائق (مثال: 10)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('سبب الكتم')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  async execute(interaction) {}
};
