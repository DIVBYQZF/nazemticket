const { SlashCommandBuilder } = require('discord.js');
const { handleTicketCloseRequest } = require('../handlers/ticketHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('إغلاق التذكرة الحالية'),

  async execute(interaction) {
    return handleTicketCloseRequest(interaction);
  }
};
