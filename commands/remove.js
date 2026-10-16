const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { parseTicketTopic, isStaff, getConfig } = require('../handlers/ticketHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('إزالة عضو من التذكرة الحالية')
    .addUserOption((option) =>
      option.setName('user').setDescription('العضو المراد إزالته').setRequired(true)
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
    if (targetUser.id === meta.ticket_owner) {
      return interaction.reply({
        content: '❌ لا يمكنك إزالة صاحب التذكرة الأساسي!',
        ephemeral: true
      });
    }

    try {
      await channel.permissionOverwrites.delete(targetUser.id);

      const embed = new EmbedBuilder()
        .setColor(config.colors?.warning || '#FEE75C')
        .setDescription(`🚫 تمت إزالة العضو ${targetUser} من التذكرة بواسطة ${interaction.user}.`);

      const { sendTicketLog } = require('../handlers/ticketHandler');
      await sendTicketLog(interaction.guild, {
        title: '➖ [لوق] إزالة عضو من التذكرة',
        color: config.colors?.warning || '#FEE75C',
        fields: [
          { name: 'القناة', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
          { name: 'العضو المزال', value: `${targetUser} (\`${targetUser.id}\`)`, inline: true },
          { name: 'بواسطة الإداري', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true }
        ]
      });

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Error removing user from ticket:', err);
      return interaction.reply({
        content: '❌ فشل إزالة العضو من التذكرة.',
        ephemeral: true
      });
    }
  }
};
