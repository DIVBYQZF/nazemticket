require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  Events,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// 1. إدارة الإعدادات (قراءة من config.json أو استخدام الإعدادات الافتراضية الذكية)
const configPath = path.join(__dirname, 'config.json');
const defaultConfig = {
  supportRoleId: '1558870858540257409',
  ticketCategoryId: '',
  logsChannelId: '1559953450324721757',
  maxTicketsPerUser: 1,
  closeCountdownSeconds: 5,
  ticketCounter: 26,
  namingFormat: 'prefix-number',
  colors: {
    primary: '#5865F2',
    success: '#57F287',
    danger: '#ED4245',
    warning: '#FEE75C',
    secondary: '#2B2D31'
  },
  ticketTypes: [
    {
      id: 'inquiry',
      label: 'استفسار',
      description: 'للمساعدة والإجابة عن أي استفسار أو سؤال',
      emoji: '❓',
      channelPrefix: 'استفسار',
      roleId: '1558870858641055774',
      roleId2: '1558870858540257409'
    },
    {
      id: 'complaint_member',
      label: 'شكوى على عضو',
      description: 'لتقديم بلاغ أو شكوى رسمية ضد عضو أو إداري',
      emoji: '🚨',
      channelPrefix: 'شكوى',
      roleId: '1558870858641055774',
      roleId2: '1558870858540257409'
    },
    {
      id: 'staff_apply',
      label: 'تقديم على الاداره',
      description: 'للتقديم على رتبة في طاقم إدارة السيرفر',
      emoji: '💼',
      channelPrefix: 'تقديم',
      roleId: '1558870858641055774',
      roleId2: '1558870858540257409'
    }
  ]
};

function getConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return { ...defaultConfig, ...JSON.parse(data) };
    }
  } catch (e) {
    console.warn('⚠️ تعذر قراءة config.json، يتم استخدام الإعدادات الافتراضية.');
  }
  return defaultConfig;
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// 2. دوال مساعدة للتذاكر
function parseTicketTopic(topic) {
  if (!topic) return null;
  const parts = topic.split('|').map((p) => p.trim());
  const data = {};
  for (const part of parts) {
    const [key, value] = part.split(':').map((s) => s?.trim());
    if (key && value) data[key] = value;
  }
  return data.ticket_owner ? data : null;
}

function formatTicketTopic({ ownerId, typeId, status = 'open', claimedBy = 'none', createdAt = Date.now() }) {
  return `ticket_owner:${ownerId} | ticket_type:${typeId} | status:${status} | claimed_by:${claimedBy} | created_at:${createdAt}`;
}

function isStaff(member, config, ticketTypeId = null) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (config.supportRoleId && member.roles.cache.has(config.supportRoleId)) return true;
  if (ticketTypeId && Array.isArray(config.ticketTypes)) {
    const specificType = config.ticketTypes.find((t) => t.id === ticketTypeId);
    if (specificType) {
      if (specificType.roleId && member.roles.cache.has(specificType.roleId)) return true;
      if (specificType.roleId2 && member.roles.cache.has(specificType.roleId2)) return true;
    }
  }
  return false;
}

function getLogsChannel(guild, config) {
  if (config.logsChannelId) {
    const ch = guild.channels.cache.get(config.logsChannelId);
    if (ch && ch.isTextBased()) return ch;
  }
  return guild.channels.cache.find(
    (ch) =>
      ch.isTextBased() &&
      (ch.name.includes('لوق') || ch.name.includes('سجل') || ch.name.toLowerCase().includes('log'))
  );
}

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
    console.error('Error sending log:', err);
    return null;
  }
}

async function getOrCreateCategory(guild, config) {
  if (config.ticketCategoryId) {
    const existing = guild.channels.cache.get(config.ticketCategoryId);
    if (existing && existing.type === ChannelType.GuildCategory) return existing;
  }
  const byName = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && (c.name.includes('التذاكر') || c.name.toLowerCase().includes('tickets'))
  );
  if (byName) return byName;

  try {
    return await guild.channels.create({
      name: '🎫・التذاكر',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }]
    });
  } catch (err) {
    return null;
  }
}

// 3. تهيئة بوت ديسكورد
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

client.once(Events.ClientReady, () => {
  console.log('====================================');
  console.log(`🤖 البوت يعمل بنجاح باسم: ${client.user.tag}`);
  console.log(`📊 متصل في ${client.guilds.cache.size} سيرفر(ات).`);
  console.log('====================================');

  client.user.setPresence({
    activities: [{ name: '🎫 نظام التذاكر المتطور | /ticket-setup', type: ActivityType.Watching }],
    status: 'online'
  });
});

// 4. معالجة كافة أوامر السلاش والتفاعلات مباشرة
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const config = getConfig();

    // === أ. أوامر السلاش (Slash Commands) ===
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // 1. أمر إرسال لوحة التذاكر (/ticket-setup)
      if (commandName === 'ticket-setup') {
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        const selectOptions = (config.ticketTypes || []).map((type) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(type.label)
            .setDescription(type.description || 'اضغط لفتح تذكرة')
            .setValue(`ticket_type_${type.id}`)
            .setEmoji(type.emoji || '🎫')
        );

        if (selectOptions.length === 0) {
          return interaction.reply({ content: '❌ لا توجد أقسام تذاكر محددة!', ephemeral: true });
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
            (config.ticketTypes || [])
              .map((t, idx) => `${idx + 1}️⃣ ${t.emoji || '🎫'} **${t.label}:** ${t.description || ''}`)
              .join('\n') +
            '\n\n🔒 **ملاحظة:** سيتم إنشاء روم خاص بينك وبين الإدارة فقط، مع حفظ سجلات التذكرة للرقابة.'
          )
          .setFooter({ text: 'نظام تذاكر ناظم • اضغط على القائمة بالأسفل للبدء', iconURL: interaction.guild.iconURL() });

        await targetChannel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: `✅ تم إرسال لوحة فتح التذاكر بنجاح في القناة: ${targetChannel}`, ephemeral: true });
      }

      // 2. أمر إغلاق التذكرة (/close)
      if (commandName === 'close') {
        return handleTicketCloseRequest(interaction);
      }

      // 3. أمر استلام التذكرة (/claim)
      if (commandName === 'claim') {
        return handleTicketClaim(interaction);
      }

      // 4. أمر إضافة عضو للتذكرة (/add)
      if (commandName === 'add') {
        const meta = parseTicketTopic(interaction.channel.topic);
        if (!meta) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة نشطة.', ephemeral: true });
        const targetUser = interaction.options.getUser('user');
        await interaction.channel.permissionOverwrites.edit(targetUser.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        });
        return interaction.reply({ content: `✅ تمت إضافة ${targetUser} إلى التذكرة بنجاح.` });
      }

      // 5. أمر إزالة عضو من التذكرة (/remove)
      if (commandName === 'remove') {
        const meta = parseTicketTopic(interaction.channel.topic);
        if (!meta) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة نشطة.', ephemeral: true });
        const targetUser = interaction.options.getUser('user');
        if (targetUser.id === meta.ticket_owner) {
          return interaction.reply({ content: '❌ لا يمكنك إزالة صاحب التذكرة الأساسي!', ephemeral: true });
        }
        await interaction.channel.permissionOverwrites.delete(targetUser.id);
        return interaction.reply({ content: `✅ تمت إزالة ${targetUser} من التذكرة.` });
      }

      // 6. أمر تحديد رتبة الدعم (/set-role)
      if (commandName === 'set-role') {
        const role = interaction.options.getRole('role');
        config.supportRoleId = role.id;
        saveConfig(config);
        return interaction.reply({ content: `✅ تم تعيين رتبة الدعم الفني والإدارة إلى: ${role}`, ephemeral: true });
      }

      // 7. أمر تحديد روم اللوقات (/set-logs)
      if (commandName === 'set-logs') {
        const channel = interaction.options.getChannel('channel');
        config.logsChannelId = channel.id;
        saveConfig(config);
        return interaction.reply({ content: `✅ تم تعيين روم اللوقات بنجاح إلى: ${channel}`, ephemeral: true });
      }
    }

    // === ب. القائمة المنسدلة لفتح التذاكر ===
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select_menu') {
      const typeId = interaction.values[0].replace('ticket_type_', '');
      return handleTicketCreate(interaction, typeId);
    }

    // === ج. أزرار التحكم بالتذكرة ===
    if (interaction.isButton()) {
      switch (interaction.customId) {
        case 'ticket_close_request':
          return handleTicketCloseRequest(interaction);
        case 'ticket_close_cancel':
          return interaction.update({ content: '✅ تم إلغاء عملية الإغلاق.', embeds: [], components: [] });
        case 'ticket_close_confirm':
          return handleTicketCloseConfirm(interaction);
        case 'ticket_claim':
          return handleTicketClaim(interaction);
        case 'ticket_transcript':
          return handleTicketTranscript(interaction);
      }
    }
  } catch (err) {
    console.error('Interaction error:', err);
  }
});

// 5. وظائف التذاكر (إنشاء، إغلاق، استلام، وسجلات)
async function handleTicketCreate(interaction, typeId) {
  const config = getConfig();
  const ticketType = config.ticketTypes?.find((t) => t.id === typeId) || config.ticketTypes[0];
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

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
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

  // تجميع الرتب المصرح لها (الرتبة العامة + الرتبة الأولى والثانية المخصصة لهذا القسم)
  const rolesToAdd = new Set();
  if (config.supportRoleId) rolesToAdd.add(config.supportRoleId);
  if (ticketType.roleId) rolesToAdd.add(ticketType.roleId);
  if (ticketType.roleId2) rolesToAdd.add(ticketType.roleId2);

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

  // التسمية بالأرقام المتسلسلة
  const nextCount = (config.ticketCounter || 0) + 1;
  config.ticketCounter = nextCount;
  saveConfig(config);

  const numStr = String(nextCount).padStart(4, '0');
  const prefix = ticketType.channelPrefix || 'تكت';
  const channelName = `${prefix}-${numStr}`;

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
      .setFooter({ text: `تذكرة رقم #${numStr} • نظام تذاكر ناظم`, iconURL: guild.iconURL() })
      .setTimestamp();

    const buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close_request').setLabel('إغلاق التذكرة').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('استلام التذكرة').setStyle(ButtonStyle.Success).setEmoji('🙋‍♂️'),
      new ButtonBuilder().setCustomId('ticket_transcript').setLabel('نسخ المحادثة (للإدارة)').setStyle(ButtonStyle.Secondary).setEmoji('📑')
    );

    const mentions = [user.toString()];
    const specificRoles = [ticketType.roleId, ticketType.roleId2].filter(Boolean);
    if (specificRoles.length > 0) {
      specificRoles.forEach((rId) => mentions.push(`<@&${rId}>`));
    } else if (config.supportRoleId) {
      mentions.push(`<@&${config.supportRoleId}>`);
    }

    await ticketChannel.send({
      content: mentions.join(' '),
      embeds: [welcomeEmbed],
      components: [buttonsRow]
    });

    const displayRolesStr = specificRoles.length > 0
      ? specificRoles.map((rId) => `<@&${rId}>`).join(' ، ')
      : (config.supportRoleId ? `<@&${config.supportRoleId}>` : 'غير محددة');

    await sendTicketLog(guild, {
      title: '🎫 [لوق] تم فتح تذكرة جديدة',
      color: config.colors?.success || '#57F287',
      fields: [
        { name: 'رقم التذكرة', value: `\`#${numStr}\``, inline: true },
        { name: 'القناة', value: `<#${ticketChannel.id}> (\`${ticketChannel.name}\`)`, inline: true },
        { name: 'صاحب التذكرة', value: `${user} (\`${user.id}\`)`, inline: true },
        { name: 'نوع التذكرة', value: `${ticketType.emoji} **${ticketType.label}**`, inline: true },
        { name: 'الرتب المسؤولة', value: displayRolesStr, inline: true }
      ]
    });

    return interaction.editReply({
      content: `✅ تم إنشاء تذكرتك بنجاح برقم **#${numStr}** في القناة: <#${ticketChannel.id}>`
    });
  } catch (err) {
    console.error('Error creating ticket channel:', err);
    return interaction.editReply({
      content: '❌ حدث خطأ أثناء محاولة إنشاء قناة التذكرة. تأكد من إعطاء البوت رتبة أعلى وصلاحية `Manage Channels`.'
    });
  }
}

async function handleTicketCloseRequest(interaction) {
  const config = getConfig();
  const meta = parseTicketTopic(interaction.channel.topic);
  if (!meta) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة نشطة.', ephemeral: true });

  const confirmEmbed = new EmbedBuilder()
    .setColor(config.colors?.warning || '#FEE75C')
    .setTitle('⚠️ تأكيد إغلاق التذكرة')
    .setDescription(
      'هل أنت متأكد من رغبتك في إغلاق هذه التذكرة؟\n' +
      '🔒 **ملاحظة:** سيتم حفظ نسخة كاملة من المحادثة وإرسالها إلى لوقات الإدارة.'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close_confirm').setLabel('نعم، تأكيد الإغلاق').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
    new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary).setEmoji('✖️')
  );

  return interaction.reply({ embeds: [confirmEmbed], components: [row] });
}

async function handleTicketCloseConfirm(interaction) {
  const config = getConfig();
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  if (!meta) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة نشطة.', ephemeral: true });

  await interaction.update({ content: '⏳ جاري أرشفة التذكرة وحفظ السجل للإدارة...', embeds: [], components: [] });

  let transcriptAttachment = null;
  try {
    const discordTranscripts = require('discord-html-transcripts');
    const rawAttachment = await discordTranscripts.createTranscript(channel, {
      limit: -1,
      fileName: `transcript-${channel.name}.html`,
      poweredBy: false,
      hydrate: true
    });
    transcriptAttachment = new AttachmentBuilder(rawAttachment.attachment, { name: `transcript-${channel.name}.html` });
  } catch (err) {
    console.warn('Transcript generation note:', err.message);
  }

  const closedBy = interaction.user;
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
    files: transcriptAttachment ? [transcriptAttachment] : []
  });

  const seconds = config.closeCountdownSeconds || 5;
  await channel.send(`🗑️ تم حفظ نسخة التذكرة للإدارة بنجاح. سيتم حذف القناة نهائياً خلال **${seconds}** ثوانٍ...`);

  setTimeout(async () => {
    try {
      await channel.delete('Ticket closed by user/staff');
    } catch (err) {}
  }, seconds * 1000);
}

async function handleTicketClaim(interaction) {
  const config = getConfig();
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  if (!meta) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة نشطة.', ephemeral: true });

  const member = interaction.member;
  if (!isStaff(member, config, meta.ticket_type)) {
    return interaction.reply({ content: '❌ هذا الزر مخصص لإدارة وقسم هذا النوع من التذاكر فقط.', ephemeral: true });
  }

  if (meta.claimed_by !== 'none') {
    if (meta.claimed_by === interaction.user.id) {
      await channel.setTopic(formatTicketTopic({ ownerId: meta.ticket_owner, typeId: meta.ticket_type, status: meta.status, claimedBy: 'none' }));
      const unclaimEmbed = new EmbedBuilder().setColor(config.colors?.warning || '#FEE75C').setDescription(`⚠️ قام ${interaction.user} بإلغاء استلام التذكرة، وأصبحت متاحة مجدداً للإدارة.`);
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
      return interaction.reply({ content: `⚠️ هذه التذكرة مستلمة بالفعل من قبل <@${meta.claimed_by}>.`, ephemeral: true });
    }
  }

  await channel.setTopic(formatTicketTopic({ ownerId: meta.ticket_owner, typeId: meta.ticket_type, status: meta.status, claimedBy: interaction.user.id }));
  const claimEmbed = new EmbedBuilder().setColor(config.colors?.success || '#57F287').setDescription(`🙋‍♂️ تم استلام التذكرة من قبل **${interaction.user}**. سيكون مسؤولاً عن متابعة الحالة.`);
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

async function handleTicketTranscript(interaction) {
  const config = getConfig();
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  if (!meta) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة نشطة.', ephemeral: true });

  if (!isStaff(interaction.member, config, meta.ticket_type)) {
    return interaction.reply({ content: '❌ عذراً، نسخ سجل التذكرة مخصص فقط لإدارة هذا القسم.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const discordTranscripts = require('discord-html-transcripts');
    const rawAttachment = await discordTranscripts.createTranscript(channel, {
      limit: -1,
      fileName: `transcript-${channel.name}.html`,
      poweredBy: false,
      hydrate: true
    });
    const attachment = new AttachmentBuilder(rawAttachment.attachment, { name: `transcript-${channel.name}.html` });

    await sendTicketLog(interaction.guild, {
      title: '📑 [لوق] تم طلب نسخة سجل التذكرة',
      color: config.colors?.secondary || '#2B2D31',
      fields: [
        { name: 'القناة', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
        { name: 'طلب بواسطة الإداري', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true }
      ],
      files: [attachment]
    });

    const replyEmbed = new EmbedBuilder()
      .setColor(config.colors?.primary || '#5865F2')
      .setTitle('📑 تم إنشاء وحفظ سجل التذكرة بنجاح')
      .setDescription('تم استخراج نسخة المحادثة الكاملة وهي مرفقة بالأسفل للإدارة.');

    return interaction.editReply({ embeds: [replyEmbed], files: [attachment] });
  } catch (err) {
    return interaction.editReply({ content: '❌ تعذر إنشاء السجل، يرجى المحاولة لاحقاً.' });
  }
}

// 6. سيرفر فحص اتصال خفيف جداً لتمكين الاستضافات السحابية المجانية (مثل Render) من إبقاء البوت شغالاً 24/7
if (process.env.PORT) {
  const http = require('http');
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 Nazem Ticket Bot is Online 24/7!');
  }).listen(process.env.PORT, () => {
    console.log(`🌐 [Cloud Host] منفذ السحابة ${process.env.PORT} يعمل بنجاح.`);
  });
}

// 7. تسجيل الدخول إلى ديسكورد
const cleanToken = (process.env.DISCORD_TOKEN || '').trim().replace(/["']/g, '');

if (!cleanToken) {
  console.warn('⚠️ تنبيه: لم يتم تعيين DISCORD_TOKEN!');
} else {
  client.login(cleanToken)
    .then(() => {
      console.log('✅ تم تسجيل الدخول بنجاح إلى ديسكورد!');
    })
    .catch((err) => {
      console.error('❌ خطأ في تسجيل دخول البوت:', err.message || err);
    });
}
