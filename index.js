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
const { createCanvas, loadImage } = require('@napi-rs/canvas');

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
    autoRoleId: '',
    sendImageCard: true
  },
  logs: {
    enabled: true,
    general: '1559953450324721757',
    messages: '',
    voice: '',
    members: '',
    roles: '',
    logMessageDelete: true,
    logMessageUpdate: true,
    logVoiceState: true,
    logMemberJoinLeave: true,
    logMemberRoleChange: true,
    logChannelChange: true,
    logRoleChange: true
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
// 2. دوال مساعدة للتذاكر والحماية والسجلات
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

// جلب قناة اللوق المستهدفة بحسب الفئة
function getTargetLogChannel(guild, category = 'general') {
  const config = getConfig();
  if (config.logs && config.logs.enabled === false) return null;
  const logsCfg = config.logs || {};

  const specificId = logsCfg[category];
  if (specificId) {
    const ch = guild.channels.cache.get(specificId);
    if (ch && ch.isTextBased()) return ch;
  }

  const genId = logsCfg.general || config.logsChannelId;
  if (genId) {
    const ch = guild.channels.cache.get(genId);
    if (ch && ch.isTextBased()) return ch;
  }

  return guild.channels.cache.find(
    (ch) => ch.isTextBased() && (ch.name.includes('لوق') || ch.name.includes('سجل') || ch.name.toLowerCase().includes('log'))
  );
}

async function sendServerEventLog(guild, category, { title, description, color, fields = [] }) {
  try {
    const ch = getTargetLogChannel(guild, category);
    if (!ch) return null;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color || '#5865F2')
      .setTimestamp();

    if (description) embed.setDescription(description);
    if (fields.length > 0) embed.addFields(fields);
    return await ch.send({ embeds: [embed] });
  } catch (e) {}
}

async function sendTicketLog(guild, { title, description, color, fields = [], files = [] }) {
  try {
    const ch = getTargetLogChannel(guild, 'general');
    if (!ch) return null;

    const embed = new EmbedBuilder()
      .setColor(color || '#5865F2')
      .setTitle(title)
      .setTimestamp();

    if (description) embed.setDescription(description);
    if (fields.length > 0) embed.addFields(fields);

    const payload = { embeds: [embed] };
    if (files.length > 0) payload.files = files;

    return await ch.send(payload);
  } catch (err) {
    console.error('Error sending ticket log:', err);
    return null;
  }
}

async function sendSecurityAlert(guild, { title, description, color, fields = [] }) {
  try {
    const config = getConfig();
    let ch = null;
    if (config.securityLogsChannelId) {
      ch = guild.channels.cache.get(config.securityLogsChannelId);
    }
    if (!ch) ch = getTargetLogChannel(guild, 'general');
    if (!ch) return null;

    const embed = new EmbedBuilder()
      .setColor(color || config.colors?.danger || '#ED4245')
      .setTitle(`🛡️ [درع الحماية] ${title}`)
      .setDescription(description)
      .setTimestamp();

    if (fields.length > 0) embed.addFields(fields);
    return await ch.send({ embeds: [embed] });
  } catch (e) {}
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

// توليد صورة كرت الترحيب الاحترافية
async function generateWelcomeCard(member) {
  try {
    const width = 1000;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. تدرج الخلفية الفخم
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#0a0b14');
    bgGrad.addColorStop(0.5, '#121424');
    bgGrad.addColorStop(1, '#1b1d33');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. دوائر توهج جمالية
    ctx.save();
    ctx.fillStyle = 'rgba(88, 101, 242, 0.16)';
    ctx.beginPath();
    ctx.arc(880, 50, 220, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(87, 242, 135, 0.1)';
    ctx.beginPath();
    ctx.arc(120, 360, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 3. إطار الصورة مع زوايا ناعمة
    ctx.strokeStyle = '#272b4d';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, width - 16, height - 16);

    // 4. صورة أفتار العضو دائرية
    const avatarX = 180;
    const avatarY = 200;
    const avatarRadius = 95;

    // توهج خلف الأفتار
    ctx.save();
    ctx.shadowColor = '#5865f2';
    ctx.shadowBlur = 25;
    ctx.strokeStyle = '#5865f2';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarRadius + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // رسم صورة العضو
    try {
      const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
      const avatarImg = await loadImage(avatarUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
      ctx.restore();
    } catch (e) {
      ctx.fillStyle = '#232742';
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. النصوص
    ctx.fillStyle = '#949ba4';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('WELCOME TO ' + member.guild.name.toUpperCase(), 340, 140);

    const displayName = member.user.displayName || member.user.username;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px sans-serif';
    const truncatedName = displayName.length > 18 ? displayName.slice(0, 16) + '...' : displayName;
    ctx.fillText(truncatedName, 340, 205);

    // 6. شارة رقم العضو
    ctx.fillStyle = 'rgba(88, 101, 242, 0.25)';
    ctx.fillRect(340, 240, 280, 48);
    ctx.strokeStyle = '#5865f2';
    ctx.lineWidth = 2;
    ctx.strokeRect(340, 240, 280, 48);

    ctx.fillStyle = '#57f287';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(`MEMBER #${member.guild.memberCount}`, 370, 273);

    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('Welcome card generation error:', err);
    return null;
  }
}

// ==========================================
// 3. تهيئة بوت ديسكورد مع كافة الـ Intents
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
});

client.once(Events.ClientReady, () => {
  console.log('====================================');
  console.log(`🤖 بوت ناظم الشامل يعمل بنجاح باسم: ${client.user.tag}`);
  console.log(`📊 متصل في ${client.guilds.cache.size} سيرفر(ات).`);
  console.log('====================================');

  client.user.setPresence({
    activities: [{ name: '🛡️ نظام الحماية والتذاكر واللوقات الشاملة | /security', type: ActivityType.Watching }],
    status: 'online'
  });
});

// ==========================================
// 4. معالجة أوامر السلاش والتفاعلات
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const config = getConfig();

    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

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

      if (commandName === 'close') return handleTicketCloseRequest(interaction);
      if (commandName === 'claim') return handleTicketClaim(interaction);

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
            { name: 'السجلات الشاملة (Logs)', value: config.logs?.enabled ? '✅ مفعلة بالكامل' : '❌ معطلة', inline: true },
            { name: 'رابط لوحة التحكم', value: `\`http://85.202.160.151:2220\``, inline: false }
          )
          .setFooter({ text: 'يمكنك تعديل كافة إعدادات الحماية واللوقات من الداش بورد' })
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

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
        if (!member.moderatable) return interaction.reply({ content: '❌ لا أملك صلاحية كتم هذا العضو.', ephemeral: true });

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
  }
});

// ==========================================
// 5. وظائف التذاكر
// ==========================================
async function handleTicketCreation(interaction) {
  const config = getConfig();
  const selectedValue = interaction.values[0];
  const typeId = selectedValue.replace('ticket_type_', '');
  const ticketType = (config.ticketTypes || []).find((t) => t.id === typeId);

  if (!ticketType) return interaction.reply({ content: '❌ نوع التذكرة غير معروف أو محذوف.', ephemeral: true });

  const guild = interaction.guild;
  const user = interaction.user;

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
  const currentCount = config.ticketCounter || 31;
  const formattedNumber = String(currentCount).padStart(4, '0');
  const channelPrefix = ticketType.channelPrefix || 'تذكرة';
  const channelName = `${channelPrefix}-${formattedNumber}`;

  config.ticketCounter = currentCount + 1;
  saveConfig(config);

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
// 6. درع الحماية (Anti-Spam, Anti-Links, Anti-Nuke, Anti-Bot)
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

// ==========================================
// 7. مركز اللوقات الشاملة وتوثيق السيرفر (All Server Logs)
// ==========================================

// أ. لوق حذف الرسائل
client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.author?.bot) return;
  const config = getConfig();
  if (config.logs?.logMessageDelete === false) return;

  const content = message.cleanContent || message.content || '*(رسالة بدون نص / صورة فقط)*';
  const fields = [
    { name: 'صاحب الرسالة', value: `${message.author} (\`${message.author?.id}\`)`, inline: true },
    { name: 'القناة', value: `<#${message.channel.id}>`, inline: true },
    { name: 'محتوى الرسالة المحذوفة', value: `\`\`\`${content.slice(0, 900)}\`\`\`` }
  ];

  if (message.attachments.size > 0) {
    fields.push({
      name: 'المرفقات',
      value: message.attachments.map((a) => `[${a.name}](${a.url})`).join('\n')
    });
  }

  await sendServerEventLog(message.guild, 'messages', {
    title: '🗑️ [لوق الرسائل] تم حذف رسالة',
    color: '#ED4245',
    fields
  });
});

// ب. لوق تعديل الرسائل
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  const config = getConfig();
  if (config.logs?.logMessageUpdate === false) return;

  const oldText = oldMsg.cleanContent || oldMsg.content || '*(فارغ)*';
  const newText = newMsg.cleanContent || newMsg.content || '*(فارغ)*';

  await sendServerEventLog(oldMsg.guild, 'messages', {
    title: '✏️ [لوق الرسائل] تم تعديل رسالة',
    color: '#FEE75C',
    fields: [
      { name: 'الكاتب', value: `${oldMsg.author} (\`${oldMsg.author?.id}\`)`, inline: true },
      { name: 'القناة', value: `<#${oldMsg.channel.id}>`, inline: true },
      { name: 'رابط الرسالة', value: `[اضغط هنا للذهاب للرسالة](${newMsg.url})`, inline: true },
      { name: 'قبل التعديل', value: `\`\`\`${oldText.slice(0, 450)}\`\`\`` },
      { name: 'بعد التعديل', value: `\`\`\`${newText.slice(0, 450)}\`\`\`` }
    ]
  });
});

// ج. لوق الرومات الصوتية (دخول، خروج، انتقال)
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const config = getConfig();
  if (config.logs?.logVoiceState === false) return;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  // دخول روم صوتي
  if (!oldState.channelId && newState.channelId) {
    await sendServerEventLog(guild, 'voice', {
      title: '🔊 [لوق الصوتيات] دخول روم صوتي',
      color: '#57F287',
      fields: [
        { name: 'العضو', value: `${member} (\`${member.id}\`)`, inline: true },
        { name: 'الروم الصوتي', value: `<#${newState.channelId}>`, inline: true }
      ]
    });
  }
  // خروج من روم صوتي
  else if (oldState.channelId && !newState.channelId) {
    await sendServerEventLog(guild, 'voice', {
      title: '🔇 [لوق الصوتيات] مغادرة روم صوتي',
      color: '#ED4245',
      fields: [
        { name: 'العضو', value: `${member} (\`${member.id}\`)`, inline: true },
        { name: 'الروم الصوتي', value: `<#${oldState.channelId}>`, inline: true }
      ]
    });
  }
  // انتقال بين رومات صوتية
  else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    await sendServerEventLog(guild, 'voice', {
      title: '🔄 [لوق الصوتيات] انتقال بين رومات صوتية',
      color: '#5865F2',
      fields: [
        { name: 'العضو', value: `${member} (\`${member.id}\`)`, inline: true },
        { name: 'من روم', value: `<#${oldState.channelId}>`, inline: true },
        { name: 'إلى روم', value: `<#${newState.channelId}>`, inline: true }
      ]
    });
  }
});

// د. لوق تحديث بيانات ورتب ونك نيم الأعضاء
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const guild = newMember.guild;
  const config = getConfig();
  if (config.logs?.logMemberRoleChange === false) return;

  // تغيير الاسم المستعار (Nickname)
  if (oldMember.nickname !== newMember.nickname) {
    await sendServerEventLog(guild, 'members', {
      title: '📝 [لوق الأعضاء] تغيير الاسم المستعار',
      color: '#5865F2',
      fields: [
        { name: 'العضو', value: `${newMember} (\`${newMember.id}\`)`, inline: true },
        { name: 'الاسم القديم', value: oldMember.nickname || oldMember.user.username, inline: true },
        { name: 'الاسم الجديد', value: newMember.nickname || newMember.user.username, inline: true }
      ]
    });
  }

  // تغيير الرتب
  const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
  const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

  if (addedRoles.size > 0 || removedRoles.size > 0) {
    const fields = [{ name: 'العضو', value: `${newMember} (\`${newMember.id}\`)`, inline: true }];
    if (addedRoles.size > 0) {
      fields.push({ name: '🟢 الرتب المضافة', value: addedRoles.map((r) => `${r}`).join(', ') });
    }
    if (removedRoles.size > 0) {
      fields.push({ name: '🔴 الرتب المزالة', value: removedRoles.map((r) => `${r}`).join(', ') });
    }

    await sendServerEventLog(guild, 'roles', {
      title: '🏷️ [لوق الرتب] تعديل رتب عضو',
      color: '#5865F2',
      fields
    });
  }
});

// هـ. لوق مغادرة الأعضاء
client.on(Events.GuildMemberRemove, async (member) => {
  const guild = member.guild;
  const config = getConfig();
  if (config.logs?.logMemberJoinLeave === false) return;

  const roles = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => `${r}`).join(', ') || 'لا توجد';

  await sendServerEventLog(guild, 'members', {
    title: '🚪 [لوق الأعضاء] مغادرة عضو',
    color: '#ED4245',
    fields: [
      { name: 'العضو', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
      { name: 'الرتب التي كان يحملها', value: roles }
    ]
  });
});

// و. لوق إنشاء وحذف الرومات
client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;
  const config = getConfig();
  if (config.logs?.logChannelChange === false) return;

  await sendServerEventLog(channel.guild, 'roles', {
    title: '📁 [لوق الرومات] تم إنشاء روم جديد',
    color: '#57F287',
    fields: [
      { name: 'اسم الروم', value: `${channel.name} (<#${channel.id}>)`, inline: true },
      { name: 'النوع', value: `${channel.type}`, inline: true }
    ]
  });
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  const config = getConfig();
  if (config.logs?.logChannelChange === false) return;

  await sendServerEventLog(channel.guild, 'roles', {
    title: '🗑️ [لوق الرومات] تم حذف روم',
    color: '#ED4245',
    fields: [{ name: 'اسم الروم المحذوف', value: `\`${channel.name}\``, inline: true }]
  });
});

// ز. لوق إنشاء وحذف الرتب
client.on(Events.GuildRoleCreate, async (role) => {
  const config = getConfig();
  if (config.logs?.logRoleChange === false) return;

  await sendServerEventLog(role.guild, 'roles', {
    title: '👑 [لوق الرتب] تم إنشاء رتبة جديدة',
    color: '#57F287',
    fields: [
      { name: 'الرتبة', value: `${role} (\`${role.name}\`)`, inline: true },
      { name: 'اللون', value: `${role.hexColor}`, inline: true }
    ]
  });
});

client.on(Events.GuildRoleDelete, async (role) => {
  const config = getConfig();
  if (config.logs?.logRoleChange === false) return;

  await sendServerEventLog(role.guild, 'roles', {
    title: '🗑️ [لوق الرتب] تم حذف رتبة',
    color: '#ED4245',
    fields: [{ name: 'اسم الرتبة المحذوفة', value: `\`${role.name}\``, inline: true }]
  });
});

// ح. لوق الحظر وفك الحظر
client.on(Events.GuildBanAdd, async (ban) => {
  await sendServerEventLog(ban.guild, 'general', {
    title: '🔨 [لوق العقوبات] تم حظر عضو (BAN)',
    color: '#ED4245',
    fields: [
      { name: 'العضو المحظور', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true },
      { name: 'السبب', value: ban.reason || 'لم يحدد سبب', inline: true }
    ]
  });
});

client.on(Events.GuildBanRemove, async (ban) => {
  await sendServerEventLog(ban.guild, 'general', {
    title: '🔓 [لوق العقوبات] تم فك حظر عضو (UNBAN)',
    color: '#57F287',
    fields: [{ name: 'العضو', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true }]
  });
});

// ط. رسائل الشات (مانع السبام والروابط)
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  const config = getConfig();
  const p = config.protection || {};
  const member = message.member;

  if (isWhitelisted(member, config)) return;

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

// ي. دخول الأعضاء: مانع البوتات + الترحيب الفخم بصورة الكرت الاحترافية + لوق الدخول
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

  // 2. لوق دخول العضو
  if (config.logs?.logMemberJoinLeave !== false) {
    const accountCreated = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;
    await sendServerEventLog(member.guild, 'members', {
      title: '📥 [لوق الأعضاء] انضمام عضو جديد',
      color: '#57F287',
      fields: [
        { name: 'العضو', value: `${member} (\`${member.id}\`)`, inline: true },
        { name: 'تاريخ إنشاء الحساب', value: accountCreated, inline: true },
        { name: 'رقم العضو في السيرفر', value: `#${member.guild.memberCount}`, inline: true }
      ]
    });
  }

  // 3. نظام الترحيب مع صورة الكرت الترحيبية
  if (!member.user.bot && config.welcome?.enabled) {
    try {
      if (config.welcome.autoRoleId) {
        const role = member.guild.roles.cache.get(config.welcome.autoRoleId);
        if (role) await member.roles.add(role).catch(() => {});
      }

      if (config.welcome.channelId) {
        const ch = member.guild.channels.cache.get(config.welcome.channelId);
        if (ch && ch.isTextBased()) {
          const rawMsg = config.welcome.message || 'أهلاً بك {user} في سيرفر {server}!';
          const text = rawMsg.replace('{user}', `${member}`).replace('{server}', member.guild.name);

          const welcomeEmbed = new EmbedBuilder()
            .setColor(config.colors?.primary || '#5865F2')
            .setTitle(`🎉 عضو جديد انضم لمجتمع ${member.guild.name}!`)
            .setDescription(text)
            .setFooter({ text: `أنت العضو رقم #${member.guild.memberCount}` })
            .setTimestamp();

          const payload = { embeds: [welcomeEmbed] };

          // توليد وإرفاق صورة كرت الترحيب
          if (config.welcome.sendImageCard !== false) {
            const cardBuffer = await generateWelcomeCard(member);
            if (cardBuffer) {
              const attachment = new AttachmentBuilder(cardBuffer, { name: 'welcome-card.png' });
              welcomeEmbed.setImage('attachment://welcome-card.png');
              payload.files = [attachment];
            }
          }

          await ch.send(payload);
        }
      }
    } catch (e) {
      console.error('Welcome message error:', e);
    }
  }
});

// ك. درع الـ Anti-Nuke (مراقبة الحذف المتكرر)
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
// 8. الداش بورد (Express Web Dashboard & REST API)
// ==========================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dashboard', 'public')));

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && auth.replace('Bearer ', '').trim() === 'nazem_auth_session') {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const config = getConfig();
  const currentPass = config.dashboard?.adminPassword || 'nazem';
  if (password === currentPass) {
    return res.json({ success: true, token: 'nazem_auth_session' });
  }
  return res.status(403).json({ success: false, message: 'Invalid Password' });
});

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

app.get('/api/config', authMiddleware, (req, res) => {
  return res.json(getConfig());
});

app.post('/api/config', authMiddleware, (req, res) => {
  const newConfig = req.body;
  if (!newConfig) return res.status(400).json({ error: 'Invalid config' });

  const success = saveConfig(newConfig);
  if (success) {
    return res.json({ success: true });
  }
  return res.status(500).json({ error: 'Failed to write config' });
});

app.get('/api/warnings', authMiddleware, (req, res) => {
  return res.json(getWarnings());
});

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
// 9. تسجيل الدخول إلى ديسكورد
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
