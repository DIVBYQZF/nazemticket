const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('Error reading config.json:', err);
    return {};
  }
}

function saveConfig(updatedConfig) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving config.json:', err);
    return false;
  }
}

// قراءة بيانات التذكرة من Topic القناة
function parseTicketTopic(topic) {
  if (!topic) return null;
  const parts = topic.split('|').map((p) => p.trim());
  const data = {};
  for (const part of parts) {
    const [key, value] = part.split(':').map((s) => s?.trim());
    if (key && value) {
      data[key] = value;
    }
  }
  return data.ticket_owner ? data : null;
}

// تنسيق Topic التذكرة
function formatTicketTopic({ ownerId, typeId, status = 'open', claimedBy = 'none', createdAt = Date.now() }) {
  return `ticket_owner:${ownerId} | ticket_type:${typeId} | status:${status} | claimed_by:${claimedBy} | created_at:${createdAt}`;
}

// التحقق من صلاحيات إدارة التذكرة مع دعم رتب متعددة لكل قسم
function isStaff(member, config, ticketTypeId = null) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (config.supportRoleId && member.roles.cache.has(config.supportRoleId)) return true;
  if (Array.isArray(config.supportRoleIds)) {
    if (config.supportRoleIds.some((id) => id && member.roles.cache.has(id))) return true;
  }
  if (ticketTypeId && Array.isArray(config.ticketTypes)) {
    const specificType = config.ticketTypes.find((t) => t.id === ticketTypeId);
    if (specificType) {
      if (specificType.roleId && member.roles.cache.has(specificType.roleId)) return true;
      if (specificType.roleId2 && member.roles.cache.has(specificType.roleId2)) return true;
      if (Array.isArray(specificType.roleIds)) {
        if (specificType.roleIds.some((id) => id && member.roles.cache.has(id))) return true;
      }
    }
  }
  return false;
}

// البحث عن روم اللوجات المخصص
function getLogsChannel(guild, config) {
  if (config.logsChannelId) {
    const ch = guild.channels.cache.get(config.logsChannelId);
    if (ch && ch.isTextBased()) return ch;
  }
  return guild.channels.cache.find(
    (ch) =>
      ch.isTextBased() &&
      (ch.name.includes('لوق') ||
        ch.name.includes('سجل') ||
        ch.name.toLowerCase().includes('ticket-log') ||
        ch.name.toLowerCase().includes('tickets-log') ||
        ch.name.toLowerCase().includes('log'))
  );
}

// إرسال اللوج إلى روم الإدارة
async function sendTicketLog(guild, { title, description, color, fields = [], files = [] }) {
  try {
    const config = getConfig();
    const logsChannel = getLogsChannel(guild, config);
    if (!logsChannel) return null;

    const embed = new EmbedBuilder()
      .setColor(color || config.colors?.primary || '#5865F2')
      .setTitle(title)
      .setTimestamp();

    if (description) embed.setDescription(description);
    if (fields.length > 0) embed.addFields(fields);

    const payload = { embeds: [embed] };
    if (files.length > 0) payload.files = files;

    return await logsChannel.send(payload);
  } catch (err) {
    console.error('Error sending ticket log:', err);
    return null;
  }
}

// البحث عن تصنيف التذاكر أو إنشاؤه تلقائياً
async function getOrCreateCategory(guild, config) {
  if (config.ticketCategoryId) {
    const existing = guild.channels.cache.get(config.ticketCategoryId);
    if (existing && existing.type === ChannelType.GuildCategory) {
      return existing;
    }
  }

  // البحث بالاسم
  const byName = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildCategory &&
      (c.name.includes('التذاكر') || c.name.toLowerCase().includes('tickets'))
  );
  if (byName) return byName;

  // إنشاء تصنيف جديد
  try {
    const newCategory = await guild.channels.create({
      name: '🎫・التذاكر',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        }
      ]
    });
    return newCategory;
  } catch (err) {
    console.error('Could not create category:', err);
    return null;
  }
}

// إنشاء تذكرة جديدة (تسمية بالأرقام وتخصيص الرتب لكل خيار)
async function handleTicketCreate(interaction, typeId) {
  const config = getConfig();
  const ticketType = config.ticketTypes?.find((t) => t.id === typeId) || {
    id: 'inquiry',
    label: 'استفسار',
    emoji: '❓',
    channelPrefix: 'استفسار',
    roleId: ''
  };

  const guild = interaction.guild;
  const user = interaction.user;

  // فحص الحد الأقصى للتذاكر المفتوحة لكل عضو
  const maxTickets = config.maxTicketsPerUser || 1;
  const userOpenTickets = guild.channels.cache.filter((ch) => {
    if (!ch.topic) return false;
    const meta = parseTicketTopic(ch.topic);
    return meta && meta.ticket_owner === user.id && meta.status === 'open';
  });

  if (userOpenTickets.size >= maxTickets) {
    const existing = userOpenTickets.first();
    return interaction.reply({
      content: `⚠️ لديك تذكرة مفتوحة بالفعل: <#${existing.id}>. يرجى إغلاقها أولاً قبل فتح تذكرة جديدة.`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const category = await getOrCreateCategory(guild, config);

  // إعداد الصلاحيات الأساسية
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];

  // إضافة الرتب المصرح لها (الرتبة العامة + الرتب المخصصة لهذا القسم)
  const rolesToAdd = new Set();
  if (config.supportRoleId) rolesToAdd.add(config.supportRoleId);
  if (Array.isArray(config.supportRoleIds)) config.supportRoleIds.forEach((id) => id && rolesToAdd.add(id));
  if (ticketType.roleId) rolesToAdd.add(ticketType.roleId);
  if (ticketType.roleId2) rolesToAdd.add(ticketType.roleId2);
  if (Array.isArray(ticketType.roleIds)) ticketType.roleIds.forEach((id) => id && rolesToAdd.add(id));

  for (const roleId of rolesToAdd) {
    const role = guild.roles.cache.get(roleId);
    if (role) {
      permissionOverwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      });
    }
  }

  // توليد رقم التذكرة المتسلسل بدلاً من اسم العضو
  const nextCount = (config.ticketCounter || 0) + 1;
  config.ticketCounter = nextCount;
  saveConfig(config);

  const numStr = String(nextCount).padStart(4, '0');
  let channelName;
  if (config.namingFormat === 'number-only') {
    channelName = `${numStr}`;
  } else if (config.namingFormat === 'ticket-number') {
    channelName = `ticket-${numStr}`;
  } else {
    // prefix-number (الافتراضي: مثل شكوى-0001 أو استفسار-0001)
    const prefix = ticketType.channelPrefix || 'تكت';
    channelName = `${prefix}-${numStr}`;
  }

  try {
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category ? category.id : null,
      topic: formatTicketTopic({
        ownerId: user.id,
        typeId: ticketType.id,
        status: 'open',
        claimedBy: 'none',
        createdAt: Date.now()
      }),
      permissionOverwrites
    });

    // إرسال رسالة الترحيب في التذكرة
    const welcomeEmbed = new EmbedBuilder()
      .setColor(config.colors?.primary || '#5865F2')
      .setTitle(`${ticketType.emoji} تذكرة رقم: #${numStr} (${ticketType.label})`)
      .setDescription(
        `مرحباً بك ${user}! 👋\n\n` +
        `شكراً لتواصلك معنا. يرجى توضيح طلبك أو استفسارك بالتفصيل وسيقوم فريق الإدارة والدعم المختص بمتابعتك بأسرع وقت.`
      )
      .addFields(
        { name: '👤 صاحب التذكرة', value: `${user} (\`${user.id}\`)`, inline: true },
        { name: '📂 القسم', value: `${ticketType.emoji} ${ticketType.label}`, inline: true },
        { name: '📌 الحالة', value: '⏳ قيد الانتظار', inline: true }
      )
      .setFooter({ text: `تذكرة رقم #${numStr} • نظام التذاكر المتطور`, iconURL: guild.iconURL() })
      .setTimestamp();

    const buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_close_request')
        .setLabel('إغلاق التذكرة')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒'),
      new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('استلام التذكرة')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🙋‍♂️'),
      new ButtonBuilder()
        .setCustomId('ticket_transcript')
        .setLabel('نسخ المحادثة (للإدارة)')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📑')
    );

    // منشن صاحب التذكرة مع كافة الرتب المخصصة لهذا القسم
    const mentions = [user.toString()];
    const specificRoles = [];
    if (ticketType.roleId) specificRoles.push(ticketType.roleId);
    if (ticketType.roleId2) specificRoles.push(ticketType.roleId2);
    if (Array.isArray(ticketType.roleIds)) specificRoles.push(...ticketType.roleIds);

    const uniqueRoles = [...new Set(specificRoles)].filter(Boolean);
    if (uniqueRoles.length > 0) {
      uniqueRoles.forEach((rId) => mentions.push(`<@&${rId}>`));
    } else if (config.supportRoleId) {
      mentions.push(`<@&${config.supportRoleId}>`);
    }

    await ticketChannel.send({
      content: mentions.join(' '),
      embeds: [welcomeEmbed],
      components: [buttonsRow]
    });

    const displayRolesStr = uniqueRoles.length > 0
      ? uniqueRoles.map((rId) => `<@&${rId}>`).join(' ، ')
      : (config.supportRoleId ? `<@&${config.supportRoleId}>` : 'غير محددة');

    // تسجيل لوق فتح التذكرة
    await sendTicketLog(guild, {
      title: '🎫 [لوق] تم فتح تذكرة جديدة',
      color: config.colors?.success || '#57F287',
      fields: [
        { name: 'رقم التذكرة', value: `\`#${numStr}\``, inline: true },
        { name: 'القناة', value: `<#${ticketChannel.id}> (\`${ticketChannel.name}\`)`, inline: true },
        { name: 'صاحب التذكرة', value: `${user} (\`${user.id}\`)`, inline: true },
        { name: 'نوع التذكرة', value: `${ticketType.emoji} **${ticketType.label}**`, inline: true },
        {
          name: 'الرتب المسؤولة',
          value: displayRolesStr,
          inline: true
        }
      ]
    });

    return interaction.editReply({
      content: `✅ تم إنشاء تذكرتك بنجاح برقم **#${numStr}** في القناة: <#${ticketChannel.id}>`
    });
  } catch (err) {
    console.error('Error creating ticket channel:', err);
    return interaction.editReply({
      content: '❌ حدث خطأ أثناء محاولة إنشاء قناة التذكرة. تأكد من إعطاء البوت صلاحية `Manage Channels`.'
    });
  }
}

// طلب إغلاق التذكرة (تأكيد)
async function handleTicketCloseRequest(interaction) {
  const config = getConfig();
  const meta = parseTicketTopic(interaction.channel.topic);
  if (!meta) {
    return interaction.reply({
      content: '❌ هذه القناة ليست تذكرة نشطة.',
      ephemeral: true
    });
  }

  const confirmEmbed = new EmbedBuilder()
    .setColor(config.colors?.warning || '#FEE75C')
    .setTitle('⚠️ تأكيد إغلاق التذكرة')
    .setDescription(
      'هل أنت متأكد من رغبتك في إغلاق هذه التذكرة؟\n' +
      '🔒 **ملاحظة:** سيتم حفظ نسخة كاملة من المحادثة (Transcript) وإرسالها إلى لوقات الإدارة فقط.'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_confirm')
      .setLabel('نعم، تأكيد الإغلاق')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId('ticket_close_cancel')
      .setLabel('إلغاء')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✖️')
  );

  return interaction.reply({
    embeds: [confirmEmbed],
    components: [row]
  });
}

// إلغاء إغلاق التذكرة
async function handleTicketCloseCancel(interaction) {
  return interaction.update({
    content: '✅ تم إلغاء عملية الإغلاق.',
    embeds: [],
    components: []
  });
}

// توليد نسخة السجل وتجهيز ملف المحادثة المرفق
async function generateAndSaveTranscript(channel) {
  try {
    const rawAttachment = await discordTranscripts.createTranscript(channel, {
      limit: -1,
      fileName: `transcript-${channel.name}.html`,
      poweredBy: false,
      hydrate: true
    });

    const fileName = `transcript-${channel.name}-${Date.now().toString(36)}.html`;
    const attachment = new AttachmentBuilder(rawAttachment.attachment, { name: fileName });

    return {
      attachment,
      fileName
    };
  } catch (err) {
    console.error('Error generating transcript:', err);
    return null;
  }
}

// تأكيد وإتمام إغلاق التذكرة
async function handleTicketCloseConfirm(interaction) {
  const config = getConfig();
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  if (!meta) {
    return interaction.reply({
      content: '❌ هذه القناة ليست تذكرة نشطة.',
      ephemeral: true
    });
  }

  await interaction.update({
    content: '⏳ جاري إغلاق التذكرة وتجهيز السجل الخاص بالإدارة...',
    embeds: [],
    components: []
  });

  // تحديث حالة Topic
  await channel
    .setTopic(
      formatTicketTopic({
        ownerId: meta.ticket_owner,
        typeId: meta.ticket_type,
        status: 'closed',
        claimedBy: meta.claimed_by,
        createdAt: meta.created_at || Date.now()
      })
    )
    .catch(() => {});

  const transcriptData = await generateAndSaveTranscript(channel);
  const closedBy = interaction.user;

  // إرسال السجل (Transcript) حصرياً إلى روم السجلات الخاص بالإدارة فقط
  const logFields = [
    { name: 'القناة', value: `\`${channel.name}\``, inline: true },
    { name: 'صاحب التذكرة', value: `<@${meta.ticket_owner}> (\`${meta.ticket_owner}\`)`, inline: true },
    { name: 'أُغلقت بواسطة', value: `${closedBy} (\`${closedBy.id}\`)`, inline: true },
    { name: 'المستلم', value: meta.claimed_by !== 'none' ? `<@${meta.claimed_by}>` : 'لم تُستلم', inline: true },
    { name: 'نوع التذكرة', value: `\`${meta.ticket_type || 'عام'}\``, inline: true }
  ];

  await sendTicketLog(interaction.guild, {
    title: '🔒 [لوق] تم إغلاق تذكرة وحفظ نسختها للإدارة',
    color: config.colors?.danger || '#ED4245',
    fields: logFields,
    files: transcriptData && transcriptData.attachment ? [transcriptData.attachment] : []
  });

  const seconds = config.closeCountdownSeconds || 5;
  await channel.send(`🗑️ تم حفظ نسخة التذكرة للإدارة بنجاح. سيتم حذف القناة نهائياً خلال **${seconds}** ثوانٍ...`);

  setTimeout(async () => {
    try {
      await channel.delete('Ticket closed by user/staff');
    } catch (err) {
      console.error('Failed to delete channel:', err);
    }
  }, seconds * 1000);
}

// استلام أو إلغاء استلام التذكرة (يدعم فحص رتبة القسم الخاص)
async function handleTicketClaim(interaction) {
  const config = getConfig();
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  if (!meta) {
    return interaction.reply({
      content: '❌ هذه القناة ليست تذكرة نشطة.',
      ephemeral: true
    });
  }

  const member = interaction.member;
  if (!isStaff(member, config, meta.ticket_type)) {
    return interaction.reply({
      content: '❌ هذا الزر مخصص لإدارة وقسم هذا النوع من التذاكر فقط.',
      ephemeral: true
    });
  }

  if (meta.claimed_by !== 'none') {
    if (meta.claimed_by === interaction.user.id) {
      // إلغاء الاستلام
      await channel.setTopic(
        formatTicketTopic({
          ownerId: meta.ticket_owner,
          typeId: meta.ticket_type,
          status: meta.status,
          claimedBy: 'none',
          createdAt: meta.created_at || Date.now()
        })
      );

      const unclaimEmbed = new EmbedBuilder()
        .setColor(config.colors?.warning || '#FEE75C')
        .setDescription(`⚠️ قام ${interaction.user} بإلغاء استلام التذكرة، وأصبحت متاحة مجدداً للإدارة.`);

      // تسجيل لوق إلغاء الاستلام
      await sendTicketLog(interaction.guild, {
        title: '⚠️ [لوق] إلغاء استلام تذكرة',
        color: config.colors?.warning || '#FEE75C',
        fields: [
          { name: 'القناة', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
          { name: 'الإداري', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true }
        ]
      });

      return interaction.reply({ embeds: [unclaimEmbed] });
    } else {
      return interaction.reply({
        content: `⚠️ هذه التذكرة مستلمة بالفعل من قبل <@${meta.claimed_by}>.`,
        ephemeral: true
      });
    }
  }

  // استلام التذكرة
  await channel.setTopic(
    formatTicketTopic({
      ownerId: meta.ticket_owner,
      typeId: meta.ticket_type,
      status: meta.status,
      claimedBy: interaction.user.id,
      createdAt: meta.created_at || Date.now()
    })
  );

  const claimEmbed = new EmbedBuilder()
    .setColor(config.colors?.success || '#57F287')
    .setDescription(`🙋‍♂️ تم استلام التذكرة من قبل **${interaction.user}**. سيكون مسؤولاً عن متابعة الحالة.`);

  // تسجيل لوق الاستلام
  await sendTicketLog(interaction.guild, {
    title: '🙋‍♂️ [لوق] تم استلام تذكرة',
    color: config.colors?.success || '#57F287',
    fields: [
      { name: 'القناة', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
      { name: 'المستلم', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
      { name: 'صاحب التذكرة', value: `<@${meta.ticket_owner}>`, inline: true }
    ]
  });

  return interaction.reply({ embeds: [claimEmbed] });
}

// تصدير سجل التذكرة فورياً (خاص بالإدارة المسؤولة فقط)
async function handleTicketTranscript(interaction) {
  const config = getConfig();
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  if (!meta) {
    return interaction.reply({
      content: '❌ هذه القناة ليست تذكرة نشطة.',
      ephemeral: true
    });
  }

  // فحص الصلاحية: مخصص لإدارة هذا القسم
  if (!isStaff(interaction.member, config, meta.ticket_type)) {
    return interaction.reply({
      content: '❌ عذراً، نسخ سجل التذكرة مخصص فقط لإدارة هذا القسم.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const transcriptData = await generateAndSaveTranscript(channel);
    if (!transcriptData) {
      return interaction.editReply({
        content: '❌ تعذر إنشاء السجل، يرجى المحاولة لاحقاً.'
      });
    }

    // إرسال نسخة في لوقات الإدارة أيضاً
    await sendTicketLog(interaction.guild, {
      title: '📑 [لوق] تم طلب نسخة سجل التذكرة',
      color: config.colors?.secondary || '#2B2D31',
      fields: [
        { name: 'القناة', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
        { name: 'طلب بواسطة الإداري', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true }
      ],
      files: [transcriptData.attachment]
    });

    const replyEmbed = new EmbedBuilder()
      .setColor(config.colors?.primary || '#5865F2')
      .setTitle('📑 تم إنشاء وحفظ سجل التذكرة بنجاح')
      .setDescription(
        `تم استخراج نسخة كاملة من المحادثة بصيغة HTML وهي مرفقة بالأسفل للإدارة.\n\n` +
        `📥 *يمكنك تحميل الملف وفتحه في أي متصفح (مثل Chrome أو Edge) لعرض المحادثة بتصميم ديسكورد الكامل.*`
      );

    return interaction.editReply({
      embeds: [replyEmbed],
      files: [transcriptData.attachment]
    });
  } catch (err) {
    console.error('Error generating transcript:', err);
    return interaction.editReply({
      content: '❌ تعذر إنشاء السجل، يرجى المحاولة لاحقاً.'
    });
  }
}

module.exports = {
  getConfig,
  saveConfig,
  isStaff,
  getLogsChannel,
  sendTicketLog,
  parseTicketTopic,
  formatTicketTopic,
  handleTicketCreate,
  handleTicketCloseRequest,
  handleTicketCloseCancel,
  handleTicketCloseConfirm,
  handleTicketClaim,
  handleTicketTranscript
};
