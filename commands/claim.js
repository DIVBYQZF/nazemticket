const { SlashCommandBuilder } = require('discord.js');
const { handleTicketClaim } = require('../handlers/ticketHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('استلام أو إلغاء استلام التذكرة الحالية'),

  async execute(interaction) {
    return handleTicketClaim(interaction);
  }
};
