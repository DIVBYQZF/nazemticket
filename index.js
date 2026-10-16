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
  AttachmentBuilder,
  AuditLogEvent
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

// ==========================================
// 1. إدارة الإعدادات والبيانات
// ==========================================
const configPath = path.join(__dirname, 'config.json');
const warningsPath = path.join(__dirname, 'warnings.json');

const defaultConfig = {
  supportRoleId: '1558870858540257409',
  ticketCategoryId: '',
  logsChannelId: '1559953450324721757',
  securityLogsChannelId: '1559953450324721757',
  maxTicketsPerUser: 1,
  closeCountdownSeconds: 5,
  ticketCounter: 31,
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
  ],
  protection: {
    antiSpam: true,
    antiSpamLimit: 5,
    antiSpamMuteMinutes: 5,
    antiLinks: true,
    antiInvites: true,
    antiBots: true,
    antiNuke: true,
    maxChannelDeletes: 3,
    maxRoleDeletes: 3,
    maxBans: 3,
    maxKicks: 3,
    whitelistRoles: ['1558870858540257409', '1558870858641055774']
  },
  welcome: {
    enabled: true,
    channelId: '',
    message: '👋 أهلاً بك يا {user} في سيرفر **{server}**! أنرت مجتمعنا 🎉',
    autoRoleId: ''
  },
  dashboard: {
    adminPassword: 'nazem'
  }
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

function getWarnings() {
  try {
    if (fs.existsSync(warningsPath)) {
      return JSON.parse(fs.readFileSync(warningsPath, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveWarnings(data) {
  try {
    fs.writeFileSync(warningsPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// ==========================================
// 2. دوال مساعدة للتذاكر والحماية
// ==========================================
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

function isWhitelisted(member, config) {
  if (!member) return false;
  if (member.id === member.guild?.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const wlRoles = config.protection?.whitelistRoles || [];
  return member.roles.cache.some((r) => wlRoles.includes(r.id));
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

function getSecurityLogsChannel(guild, config) {
  if (config.securityLogsChannelId) {
    const ch = guild.channels.cache.get(config.securityLogsChannelId);
    if (ch && ch.isTextBased()) return ch;
  }
  return getLogsChannel(guild, config);
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

async function sendSecurityAlert(guild, { title, description, color, fields = [] }) {
  try {
    const config = getConfig();
    const ch = getSecurityLogsChannel(guild, config);
    if (!ch) return null;

    const embed = new EmbedBuilder()
      .setColor(color || config.colors?.danger || '#ED4245')
      .setTitle(`🛡️ [حماية السيرفر] ${title}`)
      .setDescription(description)
      .setTimestamp();

    if (fields.length > 0) embed.addFields(fields);
    return await ch.send({ embeds: [embed] });
  } catch (e) {
    console.error('Error sending security alert:', e);
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

// دالة لتنسيق واستخراج رسائل الشات للتذاكر
async function getChannelTranscriptFormatted(channel) {
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    const msgs = Array.from(fetched.values()).reverse();
    const lines = [];

    for (const m of msgs) {
      if (m.author.bot && m.embeds.length > 0 && !m.content) continue;
      const timeStr = m.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const name = m.member?.displayName || m.author.username;
      let content = m.cleanContent || m.content || '';
      if (m.attachments.size > 0) {
        const attNames = m.attachments.map((a) => `[📁 ${a.name}]`).join(' ');
        content = content ? `${content} ${attNames}` : attNames;
      }
      if (content.trim()) {
        lines.push(`\`[${timeStr}]\` **${name}**: ${content.trim()}`);
      }
    }
    return lines;
  } catch (err) {
    return [];
  }
}

// ==========================================
// 3. تهيئة بوت ديسكورد
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
});

client.once(Events.ClientReady, () => {
  console.log('====================================');
  console.log(`🤖 بوت ناظم الشامل يعمل بنجاح باسم: ${client.user.tag}`);
  console.log(`📊 متصل في ${client.guilds.cache.size} سيرفر(ات).`);
  console.log('====================================');

  client.user.setPresence({
    activities: [{ name: '🛡️ نظام الحماية والتذاكر الشامل | /security', type: ActivityType.Watching }],
    status: 'online'
  });
});

// ==========================================
// 4. معالجة أوامر السلاش والتفاعلات
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const config = getConfig();

    // === أوامر السلاش ===
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
          .setCustomId('select_ticket_type')
          .setPlaceholder('اختر القسم المناسب لمساعدتك...')
          .addOptions(selectOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const setupEmbed = new EmbedBuilder()
          .setColor(config.colors?.primary || '#5865F2')
          .setTitle('🎫 نظام الدعم الفني والتذاكر | مجتمع ناظم')
          .setDescription(
            'مرحباً بك في قسم المساعدة والدعم الفني الخاص بمجتمع ناظم.\n\n' +
            'يرجى اختيار القسم المناسب لموضوعك من القائمة بالأسفل، وسيتواجد معك فريق الإدارة المختص بأسرع وقت.\n\n' +
            '⚠️ **تنبيه:** يرجى عدم فتح تذاكر عشوائية أو بدون سبب لتجنب العقوبة.'
          )
          .setFooter({ text: 'نظام التذاكر المتطور | Nazem Community' })
          .setTimestamp();

        await targetChannel.send({ embeds: [setupEmbed], components: [row] });
        return interaction.reply({ content: `✅ تم إرسال لوحة التذاكر بنجاح إلى ${targetChannel}!`, ephemeral: true });
      }

      // 2. إغلاق التذكرة (/close)
      if (commandName === 'close') {
        return handleTicketCloseRequest(interaction);
      }

      // 3. استلام التذكرة (/claim)
      if (commandName === 'claim') {
        return handleTicketClaim(interaction);
      }

      // 4. إضافة عضو للتذكرة (/add)
      if (commandName === 'add') {
        const channel = interaction.channel;
        const meta = parseTicketTopic(channel.topic);
        if (!meta) return interaction.reply({ content: '❌ هذا الأمر يستخدم داخل روم التذكرة فقط.', ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        await channel.permissionOverwrites.edit(targetUser.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        });

        const addEmbed = new EmbedBuilder()
          .setColor(config.colors?.success || '#57F287')
          .setDescription(`✅ تمت إضافة ${targetUser} إلى التذكرة بنجاح.`);

        await sendTicketLog(interaction.guild, {
          title: '➕ [لوق] إضافة عضو إلى تذكرة',
          fields: [
            { name: 'القناة', value: `<#${channel.id}>`, inline: true },
            { name: 'العضو المضاف', value: `${targetUser} (\`${targetUser.id}\`)`, inline: true },
            { name: 'بواسطة', value: `${interaction.user}`, inline: true }
          ]
        });

        return interaction.reply({ embeds: [addEmbed] });
      }

      // 5. إزالة عضو من التذكرة (/remove)
      if (commandName === 'remove') {
        const channel = interaction.channel;
        const meta = parseTicketTopic(channel.topic);
        if (!meta) return interaction.reply({ content: '❌ هذا الأمر يستخدم داخل روم التذكرة فقط.', ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        if (targetUser.id === meta.ticket_owner) {
          return interaction.reply({ content: '❌ لا يمكنك إزالة صاحب التذكرة الأصلي!', ephemeral: true });
        }

        await channel.permissionOverwrites.delete(targetUser.id);
        const removeEmbed = new EmbedBuilder()
          .setColor(config.colors?.danger || '#ED4245')
          .setDescription(`🚫 تمت إزالة ${targetUser} من التذكرة بنجاح.`);

        await sendTicketLog(interaction.guild, {
          title: '➖ [لوق] إزالة عضو من تذكرة',
          fields: [
            { name: 'القناة', value: `<#${channel.id}>`, inline: true },
            { name: 'العضو المزال', value: `${targetUser} (\`${targetUser.id}\`)`, inline: true },
            { name: 'بواسطة', value: `${interaction.user}`, inline: true }
          ]
        });

        return interaction.reply({ embeds: [removeEmbed] });
      }

      // 6. أمر فحص الحماية (/security)
      if (commandName === 'security') {
        const p = config.protection || {};
        const embed = new EmbedBuilder()
          .setTitle('🛡️ حالة درع الحماية والأمان الخاص بسيرفر ناظم')
          .setColor(config.colors?.primary || '#5865F2')
          .addFields(
            { name: 'مانع السبام (Anti-Spam)', value: p.antiSpam ? '✅ مفعل (كتم تلقائي)' : '❌ معطل', inline: true },
            { name: 'مانع الروابط (Anti-Links)', value: p.antiLinks ? '✅ مفعل' : '❌ معطل', inline: true },
            { name: 'مانع البوتات (Anti-Bots)', value: p.antiBots ? '✅ مفعل (طرد فوري)' : '❌ معطل', inline: true },
            { name: 'درع التخريب (Anti-Nuke)', value: p.antiNuke ? '✅ مفعل (سحب الرتب فوراً)' : '❌ معطل', inline: true },
            { name: 'الترحيب التلقائي', value: config.welcome?.enabled ? '✅ مفعل' : '❌ معطل', inline: true },
            { name: 'رابط لوحة التحكم', value: `\`http://85.202.160.151:2220\``, inline: false }
          )
          .setFooter({ text: 'يمكنك تعديل كافة إعدادات الحماية من الداش بورد' })
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // 7. أوامر الإشراف والمودريشن (/warn, /warnings, /timeout, /ban, /kick, /clear, /lock, /unlock)
      if (commandName === 'warn') {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'بدون سبب محدد';
        const warns = getWarnings();
        if (!warns[target.id]) warns[target.id] = [];
        
        warns[target.id].push({
          id: Date.now().toString(),
          reason,
          moderator: interaction.user.tag,
          timestamp: Date.now()
        });
        saveWarnings(warns);

        const embed = new EmbedBuilder()
          .setColor(config.colors?.warning || '#FEE75C')
          .setTitle('⚠️ تم إعطاء تحذير رسمي')
          .setDescription(`تم تحذير العضو ${target} بنجاح.\n**السبب:** ${reason}\n**إجمالي تحذيرات العضو:** ${warns[target.id].length}`);

        try {
          await target.send(`⚠️ لقد تلقيت تحذيراً في سيرفر **${interaction.guild.name}**.\n**السبب:** ${reason}`);
        } catch (e) {}

        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'warnings') {
        const target = interaction.options.getUser('user');
        const warns = getWarnings()[target.id] || [];

        if (warns.length === 0) {
          return interaction.reply({ content: `✅ العضو ${target} ليس لديه أي تحذيرات مسجلة.`, ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor(config.colors?.warning || '#FEE75C')
          .setTitle(`📋 سجل تحذيرات ${target.tag}`)
          .setDescription(
            warns.map((w, i) => `**#${i + 1}** | السبب: \`${w.reason}\` | بواسطة: ${w.moderator} | <t:${Math.floor(w.timestamp / 1000)}:R>`).join('\n')
          );

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === 'clear-warnings') {
        const target = interaction.options.getUser('user');
        const warns = getWarnings();
        delete warns[target.id];
        saveWarnings(warns);
        return interaction.reply({ content: `✅ تم مسح جميع تحذيرات العضو ${target} بنجاح.`, ephemeral: true });
      }

      if (commandName === 'timeout') {
        const targetUser = interaction.options.getUser('user');
        const minutes = interaction.options.getInteger('minutes');
        const reason = interaction.options.getString('reason') || 'إدارة السيرفر';
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!member) return interaction.reply({ content: '❌ تعذر العثور على العضو.', ephemeral: true });
        if (!member.moderatable) return interaction.reply({ content: '❌ لا أملك صلاحية كتم هذا العضو (رتبته أعلى مني).', ephemeral: true });

        await member.timeout(minutes * 60 * 1000, reason);
        return interaction.reply({ content: `🔇 تم كتم ${targetUser} لمدة **${minutes}** دقيقة. السبب: ${reason}` });
      }

      if (commandName === 'ban') {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'إدارة السيرفر';
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (member && !member.bannable) return interaction.reply({ content: '❌ لا أملك صلاحية حظر هذا العضو.', ephemeral: true });

        await interaction.guild.bans.create(target.id, { reason });
        return interaction.reply({ content: `🔨 تم حظر ${target} بنجاح من السيرفر. السبب: ${reason}` });
      }

      if (commandName === 'kick') {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'إدارة السيرفر';
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!member || !member.kickable) return interaction.reply({ content: '❌ لا يمكن طرد هذا العضو.', ephemeral: true });

        await member.kick(reason);
        return interaction.reply({ content: `👢 تم طرد ${target} بنجاح من السيرفر. السبب: ${reason}` });
      }

      if (commandName === 'clear') {
        const amount = interaction.options.getInteger('amount');
        const deleted = await interaction.channel.bulkDelete(amount, true);
        return interaction.reply({ content: `🧹 تم مسح **${deleted.size}** رسالة بنجاح.`, ephemeral: true });
      }

      if (commandName === 'lock') {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
        return interaction.reply({ content: '🔒 تم قفل هذه القناة ومنع الأعضاء من الكتابة.' });
      }

      if (commandName === 'unlock') {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
        return interaction.reply({ content: '🔓 تم فتح هذه القناة والسماح للأعضاء بالكتابة مجدداً.' });
      }
    }

    // === تفاعلات القوائم والأزرار للتذاكر ===
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_type') {
      return handleTicketCreation(interaction);
    }

    if (interaction.isButton()) {
      const { customId } = interaction;
      if (customId === 'btn_ticket_close') return handleTicketCloseRequest(interaction);
      if (customId === 'btn_ticket_claim') return handleTicketClaim(interaction);
      if (customId === 'btn_ticket_transcript') return handleTicketTranscript(interaction);
      if (customId === 'btn_confirm_close') return handleTicketCloseConfirm(interaction);
      if (customId === 'btn_cancel_close') return interaction.update({ content: '✅ تم إلغاء طلب إغلاق التذكرة.', embeds: [], components: [] });
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '❌ حدث خطأ غير متوقع أثناء معالجة الطلب.', ephemeral: true }).catch(() => {});
    }
  }
});

// ==========================================
// 5. وظائف التذاكر التفصيلية
// ==========================================
async function handleTicketCreation(interaction) {
  const config = getConfig();
  const selectedValue = interaction.values[0];
  const typeId = selectedValue.replace('ticket_type_', '');
  const ticketType = (config.ticketTypes || []).find((t) => t.id === typeId);

  if (!ticketType) {
    return interaction.reply({ content: '❌ نوع التذكرة غير معروف أو محذوف.', ephemeral: true });
  }

  const guild = interaction.guild;
  const user = interaction.user;

  // فحص الحد الأقصى للتذاكر
  const maxLimit = config.maxTicketsPerUser || 1;
  const existingTickets = guild.channels.cache.filter((c) => {
    if (!c.name.includes('-')) return false;
    const meta = parseTicketTopic(c.topic);
    return meta && meta.ticket_owner === user.id && meta.status === 'open';
  });

  if (existingTickets.size >= maxLimit) {
    return interaction.reply({
      content: `⚠️ لديك تذكرة مفتوحة بالفعل (${existingTickets.first()}). يرجى إنهاؤها قبل فتح تذكرة جديدة.`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const category = await getOrCreateCategory(guild, config);

  // حساب الرقم المتسلسل
  const currentCount = config.ticketCounter || 31;
  const formattedNumber = String(currentCount).padStart(4, '0');
  const channelPrefix = ticketType.channelPrefix || 'تذكرة';
  const channelName = `${channelPrefix}-${formattedNumber}`;

  // تحديث العداد في config.json
  config.ticketCounter = currentCount + 1;
  saveConfig(config);

  // تجهيز الصلاحيات للرتبتين ولصاحب التذكرة
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
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    }
  ];

  if (ticketType.roleId && guild.roles.cache.has(ticketType.roleId)) {
    permissionOverwrites.push({
      id: ticketType.roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }

  if (ticketType.roleId2 && guild.roles.cache.has(ticketType.roleId2) && ticketType.roleId2 !== ticketType.roleId) {
    permissionOverwrites.push({
      id: ticketType.roleId2,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }

  const channelTopic = formatTicketTopic({
    ownerId: user.id,
    typeId: ticketType.id,
    status: 'open',
    claimedBy: 'none',
    createdAt: Date.now()
  });

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category ? category.id : null,
    topic: channelTopic,
    permissionOverwrites
  });

  // رسالة الترحيب وأزرار التحكم بالتذكرة
  const welcomeEmbed = new EmbedBuilder()
    .setColor(config.colors?.primary || '#5865F2')
    .setTitle(`🎫 ${ticketType.label} | #${formattedNumber}`)
    .setDescription(
      `أهلاً بك يا ${user} في تذكرتك الخاصة بمجتمع ناظم.\n\n` +
      `**القسم:** ${ticketType.emoji || '🎫'} ${ticketType.label}\n` +
      `**الوصف:** ${ticketType.description || 'لا يوجد'}\n\n` +
      'يرجى توضيح طلبك أو استفسارك بالتفصيل وسيقوم الطاقم الإداري بمتابعتك فوراً.'
    )
    .setFooter({ text: 'لإغلاق التذكرة أو نسخ المحادثة استخدم الأزرار بالأسفل' })
    .setTimestamp();

  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_ticket_close').setLabel('إغلاق التذكرة').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('btn_ticket_claim').setLabel('استلام التذكرة').setEmoji('🙋‍♂️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('btn_ticket_transcript').setLabel('سجل المحادثة').setEmoji('📑').setStyle(ButtonStyle.Secondary)
  );

  const mentions = [user.toString()];
  if (ticketType.roleId) mentions.push(`<@&${ticketType.roleId}>`);
  if (ticketType.roleId2 && ticketType.roleId2 !== ticketType.roleId) mentions.push(`<@&${ticketType.roleId2}>`);

  await channel.send({ content: mentions.join(' '), embeds: [welcomeEmbed], components: [buttonsRow] });

  await sendTicketLog(guild, {
    title: '🟢 [لوق] تم فتح تذكرة جديدة',
    color: config.colors?.success || '#57F287',
    fields: [
      { name: 'القناة', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
      { name: 'صاحب التذكرة', value: `${user} (\`${user.id}\`)`, inline: true },
      { name: 'القسم', value: `${ticketType.emoji || '🎫'} ${ticketType.label}`, inline: true }
    ]
  });

  return interaction.editReply({ content: `✅ تم فتح تذكرتك بنجاح: ${channel}` });
}

async function handleTicketCloseRequest(interaction) {
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  if (!meta) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة نشطة.', ephemeral: true });

  const confirmEmbed = new EmbedBuilder()
    .setColor('#ED4245')
    .setTitle('⚠️ تأكيد إغلاق التذكرة')
    .setDescription('هل أنت متأكد من رغبتك في إغلاق هذه التذكرة وحفظ سجل المحادثة؟');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_confirm_close').setLabel('نعم، أغلق التذكرة').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('btn_cancel_close').setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({ embeds: [confirmEmbed], components: [row] });
}

async function handleTicketCloseConfirm(interaction) {
  const config = getConfig();
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  if (!meta) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة نشطة.', ephemeral: true });

  await interaction.update({ content: '⏳ جاري أرشفة المحادثة وحفظ السجل للإدارة...', embeds: [], components: [] });

  const transcriptLines = await getChannelTranscriptFormatted(channel);
  let transcriptText = transcriptLines.length > 0 ? transcriptLines.join('\n') : 'لا توجد رسائل مسجلة في هذه التذكرة.';

  let textAttachment = null;
  if (transcriptLines.length > 0) {
    const rawText = transcriptLines.map((l) => l.replace(/[`*]/g, '')).join('\r\n');
    textAttachment = new AttachmentBuilder(Buffer.from(rawText, 'utf-8'), { name: `chat-${channel.name}.txt` });
  }

  if (transcriptText.length > 3000) {
    transcriptText = '...(تم اقتطاع الرسائل القديمة للطول)...\n\n' + transcriptText.slice(-3000);
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
    title: '🔒 [لوق] تم إغلاق تذكرة وحفظ سجل المحادثة للإدارة',
    description: `### 📜 سجل رسائل التذكرة:\n${transcriptText}`,
    color: config.colors?.danger || '#ED4245',
    fields: logFields,
    files: textAttachment ? [textAttachment] : []
  });

  const seconds = config.closeCountdownSeconds || 5;
  await channel.send(`🗑️ تم توثيق التذكرة بنجاح. سيتم حذف القناة نهائياً خلال **${seconds}** ثوانٍ...`);

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
    const transcriptLines = await getChannelTranscriptFormatted(channel);
    let transcriptText = transcriptLines.length > 0 ? transcriptLines.join('\n') : 'لا توجد رسائل مكتوبة في هذه التذكرة.';

    let textAttachment = null;
    if (transcriptLines.length > 0) {
      const rawText = transcriptLines.map((l) => l.replace(/[`*]/g, '')).join('\r\n');
      textAttachment = new AttachmentBuilder(Buffer.from(rawText, 'utf-8'), { name: `chat-${channel.name}.txt` });
    }

    if (transcriptText.length > 3000) {
      transcriptText = '...(تم اختصار الرسائل الأولى لطول المحادثة)...\n\n' + transcriptText.slice(-3000);
    }

    await sendTicketLog(interaction.guild, {
      title: '📑 [لوق] طلب نسخة من سجل المحادثة',
      description: `### 📜 سجل رسائل التذكرة:\n${transcriptText}`,
      color: config.colors?.secondary || '#2B2D31',
      fields: [
        { name: 'القناة', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
        { name: 'طلب بواسطة الإداري', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true }
      ],
      files: textAttachment ? [textAttachment] : []
    });

    const replyEmbed = new EmbedBuilder()
      .setColor(config.colors?.primary || '#5865F2')
      .setTitle('📑 تم توثيق وحفظ سجل المحادثة في روم اللوق بنجاح')
      .setDescription(`تم إرسال كامل محادثات التذكرة مباشرة إلى روم السجلات.`);

    return interaction.editReply({ embeds: [replyEmbed], files: textAttachment ? [textAttachment] : [] });
  } catch (err) {
    return interaction.editReply({ content: '❌ تعذر إنشاء السجل، يرجى المحاولة لاحقاً.' });
  }
}

// ==========================================
// 6. درع الحماية الفوري (Anti-Spam, Anti-Links, Anti-Nuke, Anti-Bot)
// ==========================================
const userSpamMap = new Map();
const antiNukeTracker = {
  channelDeletes: new Map(),
  roleDeletes: new Map(),
  bans: new Map(),
  kicks: new Map()
};

function trackAction(map, userId, limit, windowMs = 10000) {
  const now = Date.now();
  const times = (map.get(userId) || []).filter((t) => now - t < windowMs);
  times.push(now);
  map.set(userId, times);
  return times.length >= limit;
}

// أ. مانع السبام والروابط في الشات
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  const config = getConfig();
  const p = config.protection || {};
  const member = message.member;

  // فحص الوايت لست
  if (isWhitelisted(member, config)) return;

  // 1. مانع الروابط والدعوات
  if (p.antiLinks || p.antiInvites) {
    const linkRegex = /(https?:\/\/|discord\.gg\/|discord\.com\/invite\/)/i;
    if (linkRegex.test(message.content)) {
      try {
        await message.delete();
        await message.channel.send(`⚠️ ${message.author} يمنع نشر الروابط أو الدعوات في هذا السيرفر!`).then((m) => setTimeout(() => m.delete().catch(() => {}), 5000));
        await sendSecurityAlert(message.guild, {
          title: 'محاولة نشر رابط محظور',
          description: `قام العضو ${message.author} بنشر رابط في <#${message.channel.id}> وتم حذفه فوراً.`,
          fields: [{ name: 'محتوى الرسالة', value: `\`${message.content.slice(0, 500)}\`` }]
        });
      } catch (e) {}
      return;
    }
  }

  // 2. مانع السبام والفلود
  if (p.antiSpam) {
    const now = Date.now();
    const spamLimit = p.antiSpamLimit || 5;
    const timestamps = (userSpamMap.get(message.author.id) || []).filter((t) => now - t < 5000);
    timestamps.push(now);
    userSpamMap.set(message.author.id, timestamps);

    if (timestamps.length >= spamLimit) {
      userSpamMap.delete(message.author.id);
      try {
        await message.delete();
        const muteMin = p.antiSpamMuteMinutes || 5;
        if (member && member.moderatable) {
          await member.timeout(muteMin * 60 * 1000, 'Anti-Spam Triggered');
          await message.channel.send(`🔇 ${message.author} تم كتمك لمدة **${muteMin}** دقائق بسبب إرسال رسائل مفرطة (سبام).`);
        }
        await sendSecurityAlert(message.guild, {
          title: 'كتم تلقائي (Anti-Spam)',
          description: `قام العضو ${message.author} بعمل سبام في <#${message.channel.id}> وتم كتمه تلقائياً.`
        });
      } catch (e) {}
    }
  }
});

// ب. مانع دخول البوتات غير الموثقة والترحيب بالأعضاء
client.on(Events.GuildMemberAdd, async (member) => {
  const config = getConfig();

  // 1. مانع البوتات
  if (member.user.bot && config.protection?.antiBots) {
    try {
      const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 });
      const entry = logs.entries.first();
      const executor = entry?.executor;

      if (executor && executor.id !== member.guild.ownerId) {
        const executorMember = await member.guild.members.fetch(executor.id).catch(() => null);
        if (!isWhitelisted(executorMember, config)) {
          await member.kick('Anti-Bot: Unauthorized bot addition');
          await sendSecurityAlert(member.guild, {
            title: 'طرد بوت غير مصرح به (Anti-Bot)',
            description: `قام ${executor} بمحاولة إدخال بوت (${member.user.tag})، وتم طرد البوت فوراً لحماية السيرفر.`
          });
          return;
        }
      }
    } catch (e) {}
  }

  // 2. نظام الترحيب والرتب التلقائية
  if (!member.user.bot && config.welcome?.enabled) {
    try {
      // إعطاء الرتبة التلقائية
      if (config.welcome.autoRoleId) {
        const role = member.guild.roles.cache.get(config.welcome.autoRoleId);
        if (role) await member.roles.add(role).catch(() => {});
      }

      // إرسال رسالة الترحيب
      if (config.welcome.channelId) {
        const ch = member.guild.channels.cache.get(config.welcome.channelId);
        if (ch && ch.isTextBased()) {
          const rawMsg = config.welcome.message || 'أهلاً بك {user} في سيرفر {server}!';
          const text = rawMsg.replace('{user}', `${member}`).replace('{server}', member.guild.name);
          const welcomeEmbed = new EmbedBuilder()
            .setColor(config.colors?.primary || '#5865F2')
            .setTitle(`🎉 عضو جديد انضم لمجتمع ${member.guild.name}!`)
            .setDescription(text)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `أنت العضو رقم #${member.guild.memberCount}` })
            .setTimestamp();

          await ch.send({ embeds: [welcomeEmbed] });
        }
      }
    } catch (e) {}
  }
});

// ج. درع الـ Anti-Nuke (مراقبة الحذف والتخريب)
client.on(Events.ChannelDelete, async (channel) => {
  const config = getConfig();
  if (!config.protection?.antiNuke || !channel.guild) return;
  try {
    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const entry = logs.entries.first();
    const executor = entry?.executor;
    if (!executor || executor.id === client.user.id || executor.id === channel.guild.ownerId) return;

    const limit = config.protection.maxChannelDeletes || 3;
    if (trackAction(antiNukeTracker.channelDeletes, executor.id, limit)) {
      const execMember = await channel.guild.members.fetch(executor.id).catch(() => null);
      if (execMember && execMember.manageable) {
        // تجريد الإداري من كافة رتبه فوراً لإيقاف التخريب
        await execMember.roles.set([], 'Anti-Nuke: Mass Channel Deletion Detected');
      }
      await sendSecurityAlert(channel.guild, {
        title: '🚨 تفعيل درع الحماية الفوري (Anti-Nuke)',
        description: `⚠️ المشرف ${executor} قام بحذف رومات بشكل متكرر! تم تجريده من كافة الرتب فوراً لحماية السيرفر.`
      });
    }
  } catch (e) {}
});

client.on(Events.GuildRoleDelete, async (role) => {
  const config = getConfig();
  if (!config.protection?.antiNuke || !role.guild) return;
  try {
    const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
    const entry = logs.entries.first();
    const executor = entry?.executor;
    if (!executor || executor.id === client.user.id || executor.id === role.guild.ownerId) return;

    const limit = config.protection.maxRoleDeletes || 3;
    if (trackAction(antiNukeTracker.roleDeletes, executor.id, limit)) {
      const execMember = await role.guild.members.fetch(executor.id).catch(() => null);
      if (execMember && execMember.manageable) {
        await execMember.roles.set([], 'Anti-Nuke: Mass Role Deletion Detected');
      }
      await sendSecurityAlert(role.guild, {
        title: '🚨 تفعيل درع الحماية الفوري (Anti-Nuke)',
        description: `⚠️ المشرف ${executor} قام بحذف رتب بشكل متكرر! تم تجريده من كافة الرتب فوراً.`
      });
    }
  } catch (e) {}
});

// ==========================================
// 7. الداش بورد (Express Web Dashboard & REST API)
// ==========================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dashboard', 'public')));

// Middleware للتحقق من التوكن البسيط
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && auth.replace('Bearer ', '').trim() === 'nazem_auth_session') {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// تسجيل دخول الداش بورد
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const config = getConfig();
  const currentPass = config.dashboard?.adminPassword || 'nazem';
  if (password === currentPass) {
    return res.json({ success: true, token: 'nazem_auth_session' });
  }
  return res.status(403).json({ success: false, message: 'Invalid Password' });
});

// إحصائيات البوت الحية
app.get('/api/stats', authMiddleware, (req, res) => {
  let membersCount = 0;
  client.guilds.cache.forEach((g) => { membersCount += g.memberCount || 0; });

  return res.json({
    botTag: client.isReady() ? client.user.tag : 'Nazem Ticket',
    guildsCount: client.guilds.cache.size,
    membersCount,
    uptime: client.uptime,
    ping: client.ws.ping
  });
});

// جلب الإعدادات الحالية
app.get('/api/config', authMiddleware, (req, res) => {
  return res.json(getConfig());
});

// حفظ وتحديث الإعدادات فوراً
app.post('/api/config', authMiddleware, (req, res) => {
  const newConfig = req.body;
  if (!newConfig) return res.status(400).json({ error: 'Invalid config' });

  const success = saveConfig(newConfig);
  if (success) {
    return res.json({ success: true });
  }
  return res.status(500).json({ error: 'Failed to write config' });
});

// جلب التحذيرات
app.get('/api/warnings', authMiddleware, (req, res) => {
  return res.json(getWarnings());
});

// حذف تحذير
app.delete('/api/warnings/:userId/:warnId', authMiddleware, (req, res) => {
  const { userId, warnId } = req.params;
  const warns = getWarnings();
  if (warns[userId]) {
    warns[userId] = warns[userId].filter((w) => w.id !== warnId);
    if (warns[userId].length === 0) delete warns[userId];
    saveWarnings(warns);
  }
  return res.json({ success: true });
});

// فحص الاتصال الخفيف
app.get('/diag', (req, res) => {
  res.json({
    status: client.isReady() ? 'online' : 'connecting',
    tag: client.user?.tag || null,
    guilds: client.guilds.cache.map((g) => ({ id: g.id, name: g.name }))
  });
});

const PORT = process.env.PORT || 2220;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 [Dashboard] لوحة تحكم بوت ناظم تعمل الآن على المنفذ: ${PORT}`);
});

// ==========================================
// 8. تسجيل الدخول إلى ديسكورد
// ==========================================
const fallbackToken = Buffer.from('TVRVMU9UZzROVE16TWpBd01EZ3dORGt5TlEuR0hGTmZZLjhHN2psWTFoZS16aGp1UjJscnFTY3VpeWt3ZC11eWREdGR6UVo0', 'base64').toString('utf8');
const cleanToken = (process.env.DISCORD_TOKEN || fallbackToken).trim().replace(/["']/g, '');

client.login(cleanToken)
  .then(() => {
    console.log('✅ تم تسجيل الدخول بنجاح إلى ديسكورد!');
  })
  .catch((err) => {
    console.error('❌ خطأ في تسجيل دخول البوت:', err.message || err);
  });
