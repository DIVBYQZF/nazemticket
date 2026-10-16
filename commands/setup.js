const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType
} = require('discord.js');
const { getConfig } = require('../handlers/ticketHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('إرسال لوحة فتح التذاكر في القناة المحددة')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('القناة التي سيتم إرسال اللوحة فيها (افتراضياً القناة الحالية)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const config = getConfig();
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    const selectOptions = (config.ticketTypes || []).map((type) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(type.label)
        .setDescription(type.description || 'اضغط لفتح تذكرة')
        .setValue(`ticket_type_${type.id}`)
        .setEmoji(type.emoji || '🎫')
    );

    if (selectOptions.length === 0) {
      return interaction.reply({
        content: '❌ لم يتم العثور على أي أقسام تذاكر في ملف `config.json`!',
        ephemeral: true
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_select_menu')
      .setPlaceholder('اختر القسم المناسب لفتح تذكرة...')
      .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setColor(config.colors?.primary || '#5865F2')
      .setTitle('📩 مركز المساعدة والتواصل - تذاكر السيرفر')
      .setDescription(
        'مرحباً بك في مركز تذاكر السيرفر!\n\n' +
        'يرجى اختيار القسم المناسب لطلبك من القائمة المنسدلة بالأسفل:\n' +
        '1️⃣ ❓ **استفسار:** لطرح أي سؤال أو استفسار عام.\n' +
        '2️⃣ 🚨 **شكوى على عضو:** لتقديم شكوى أو بلاغ عن مخالفة لقوانين السيرفر.\n' +
        '3️⃣ 💼 **تقديم على الاداره:** للتقديم والانضمام لطاقم إدارة السيرفر.\n\n' +
        '🔒 **ملاحظة:** سيتم إنشاء روم خاص بينك وبين الإدارة فقط، مع حفظ سجلات التذكرة للرقابة.'
      )
      .setFooter({
        text: `${interaction.guild.name} • انقر بالأسفل لفتح تذكرة`,
        iconURL: interaction.guild.iconURL()
      })
      .setTimestamp();

    try {
      await targetChannel.send({
        embeds: [embed],
        components: [row]
      });

      return interaction.reply({
        content: `✅ تم إرسال لوحة التذاكر بنجاح في القناة: ${targetChannel}`,
        ephemeral: true
      });
    } catch (err) {
      console.error('Error sending ticket panel:', err);
      return interaction.reply({
        content: '❌ فشل إرسال اللوحة في القناة. تأكد من صلاحيات البوت في تلك القناة.',
        ephemeral: true
      });
    }
  }
};
