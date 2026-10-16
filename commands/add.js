const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { parseTicketTopic, isStaff, getConfig } = require('../handlers/ticketHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('إضافة عضو إلى التذكرة الحالية')
    .addUserOption((option) =>
      option.setName('user').setDescription('العضو المراد إضافته').setRequired(true)
    ),

  async execute(interaction) {
    const config = getConfig();
    if (!isStaff(interaction.member, config)) {
      return interaction.reply({
        content: '❌ هذا الأمر متاح فقط لفريق الدعم والإدارة.',
        ephemeral: true
      });
    }

    const channel = interaction.channel;
    const meta = parseTicketTopic(channel.topic);
    if (!meta) {
      return interaction.reply({
        content: '❌ هذا الأمر يمكن استخدامه فقط داخل قنوات التذاكر.',
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('user');
    if (targetUser.bot) {
      return interaction.reply({
        content: '❌ لا يمكنك إضافة بوت إلى التذكرة.',
        ephemeral: true
      });
    }

    try {
      await channel.permissionOverwrites.edit(targetUser.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true
      });

      const embed = new EmbedBuilder()
        .setColor(config.colors?.success || '#57F287')
        .setDescription(`✅ تمت إضافة العضو ${targetUser} إلى التذكرة بواسطة ${interaction.user}.`);

      const { sendTicketLog } = require('../handlers/ticketHandler');
      await sendTicketLog(interaction.guild, {
        title: '➕ [لوق] إضافة عضو إلى التذكرة',
        color: config.colors?.success || '#57F287',
        fields: [
          { name: 'القناة', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
          { name: 'العضو المضاف', value: `${targetUser} (\`${targetUser.id}\`)`, inline: true },
          { name: 'بواسطة الإداري', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true }
        ]
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Error adding user to ticket:', err);
      return interaction.reply({
        content: '❌ فشل إضافة العضو إلى التذكرة.',
        ephemeral: true
      });
    }
  }
};
