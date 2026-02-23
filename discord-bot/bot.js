/**
 * DayZ Server Panel - Discord Bot
 * 
 * Provides button-based server control through Discord.
 * Features:
 *   - /panel command: Spawns the main control panel with buttons
 *   - /status: Quick server status check
 *   - /players: View online players
 *   - /rcon: Send RCON commands (admin only)
 *   - /message: Broadcast message to server
 *   - /restart: Schedule a restart with countdown
 * 
 * Button Modules:
 *   - Server Control (Start/Stop/Restart/Lock/Unlock)
 *   - Player Management (View/Kick/Ban)
 *   - Quick Actions (Status/Message/Logs)
 */

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
// Ensure `fetch` is available in both Node (global) and when using `node-fetch` (CJS/ESM)
let fetch;
try {
  if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch.bind(globalThis);
  } else {
    const nf = require('node-fetch');
    fetch = nf && (nf.default || nf);
  }
} catch (err) {
  console.warn('fetch unavailable (no global fetch and node-fetch import failed)', err);
}
require('dotenv').config({ path: '../.env' });

// ─── Config ──────────────────────────────────────────────
const CONFIG = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID,
  apiUrl: process.env.PANEL_API_URL || 'http://localhost:3001',
  apiKey: process.env.DISCORD_BOT_API_KEY || (() => { console.error('FATAL: DISCORD_BOT_API_KEY environment variable is required. Set it in .env'); process.exit(1); })(),
};

// ─── API Helper ──────────────────────────────────────────
async function panelAction(action, params = {}) {
  try {
    const res = await fetch(`${CONFIG.apiUrl}/api/discord/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, apiKey: CONFIG.apiKey, params }),
    });
    return await res.json();
  } catch (err) {
    return { error: `API connection failed: ${err.message}` };
  }
}

// Safe reply helper: uses reply if not already replied/deferred, otherwise followUp
async function safeReply(interaction, options) {
  try {
    if (!interaction) return;
    if (!interaction.replied && !interaction.deferred) {
      return await interaction.reply(options);
    }
    const flags = options.flags ?? MessageFlags.Ephemeral;
    return await interaction.followUp(Object.assign({}, options, { flags }));
  } catch (err) {
    console.error('[safeReply] error', err);
  }
}

// ─── Status Indicators ───────────────────────────────────
const STATUS_COLORS = {
  running: 0x00ff6a,
  stopped: 0xff3333,
  starting: 0xffaa00,
  stopping: 0xffaa00,
  crashed: 0xff0000,
};

const STATUS_EMOJI = {
  running: '🟢',
  stopped: '🔴',
  starting: '🟡',
  stopping: '🟡',
  crashed: '💥',
};

// ─── Permission Check ────────────────────────────────────
function isAdmin(interaction) {
  // Fail-closed: if no admin role is configured, deny all admin actions
  if (!CONFIG.adminRoleId) {
    console.warn('[security] DISCORD_ADMIN_ROLE_ID not configured - all admin actions denied. Set it in .env');
    return false;
  }
  return interaction.member.roles.cache.has(CONFIG.adminRoleId);
}

// ─── Embed Builders ──────────────────────────────────────
function buildStatusEmbed(data) {
  return new EmbedBuilder()
    .setTitle(`${STATUS_EMOJI[data.status] || '❓'} ${data.serverName || 'DayZ Server'}`)
    .setColor(STATUS_COLORS[data.status] || 0x808080)
    .addFields(
      { name: 'Status', value: `\`${data.status?.toUpperCase()}\``, inline: true },
      { name: 'Players', value: `\`${data.playerCount || 0}/${data.maxPlayers || 60}\``, inline: true },
    )
    .setFooter({ text: 'DayZ Panel • Last updated' })
    .setTimestamp();
}

function buildPlayerListEmbed(players) {
  const embed = new EmbedBuilder()
    .setTitle('👥 Online Players')
    .setColor(0x5865f2)
    .setFooter({ text: `${players.length} player(s) online` })
    .setTimestamp();

  if (players.length === 0) {
    embed.setDescription('*No players currently online*');
  } else {
    const list = players.map((p, i) =>
      `\`${String(i + 1).padStart(2)}\` **${p.name}** • ${p.ping || '?'}ms`
    ).join('\n');
    embed.setDescription(list.slice(0, 4000));
  }

  return embed;
}

// ─── Button Row Builders ─────────────────────────────────
function buildControlPanel() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_status').setLabel('📊 Status').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_start').setLabel('▶️ Start').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel_restart').setLabel('🔄 Restart').setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_players').setLabel('👥 Players').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_lock').setLabel('🔒 Lock').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_unlock').setLabel('🔓 Unlock').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_message').setLabel('📢 Broadcast').setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_kick_menu').setLabel('👢 Kick Player').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel_rcon').setLabel('🖥️ RCON').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_mod_list').setLabel('📦 Mods').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_mod_status').setLabel('⏳ Mod Status').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_mod_install').setLabel('➕ Install Mod').setStyle(ButtonStyle.Success),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_mod_uninstall').setLabel('🗑️ Uninstall Mod').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel_mod_enable').setLabel('✅ Enable Mod').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_mod_disable').setLabel('🚫 Disable Mod').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_chat_feed').setLabel('💬 Chat Feed').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_watch_list').setLabel('🔔 Watch List').setStyle(ButtonStyle.Secondary),
  );

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_killfeed').setLabel('☠️ Killfeed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_priority_queue').setLabel('🚦 Priority Queue').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_time_weather').setLabel('⏰ Time/Weather').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_leaderboard').setLabel('🏆 Leaderboard').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_ban_whitelist').setLabel('🚫 Ban/Whitelist').setStyle(ButtonStyle.Danger),
  );

  return [row1, row2, row3, row4, row5];
}

function buildRestartOptions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('restart_now').setLabel('Restart Now').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('restart_60').setLabel('60s Countdown').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('restart_300').setLabel('5m Countdown').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('restart_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

function buildConfirmRow(action) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_${action}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('confirm_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary),
  );
}

// ─── Slash Commands Registration ─────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the DayZ server control panel'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Quick server status check'),

  new SlashCommandBuilder()
    .setName('players')
    .setDescription('View online players'),

  new SlashCommandBuilder()
    .setName('rcon')
    .setDescription('Send an RCON command to the server')
    .addStringOption(opt =>
      opt.setName('command').setDescription('The RCON command to execute').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('Send a global message to all players')
    .addStringOption(opt =>
      opt.setName('message').setDescription('Message to broadcast').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart the server with optional countdown')
    .addIntegerOption(opt =>
      opt.setName('countdown').setDescription('Countdown in seconds before restart').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Create a persistent control panel in this channel'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(CONFIG.token);
  try {
    console.log('Registering slash commands...');
    if (CONFIG.guildId) {
      await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId), {
        body: commands.map(c => c.toJSON()),
      });
    } else {
      await rest.put(Routes.applicationCommands(CONFIG.clientId), {
        body: commands.map(c => c.toJSON()),
      });
    }
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ─── Bot Client ──────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('clientReady', () => {
  console.log(`🤖 Discord bot logged in as ${client.user.tag}`);
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'DayZ Server Panel', type: 3 }],
  });
});

client.on('error', (err) => {
  console.error('[client] error', err);
});

// ─── Interaction Handler ─────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  try {
    const customId = interaction.customId || null;
    console.log(`[interaction] id=${interaction.id} user=${interaction.user?.tag} type=${interaction.type}`);

    // ── Button Interactions ──
    if (interaction.isButton && interaction.isButton()) {
      const btnId = customId;

      // Status / Refresh
      if (btnId === 'panel_status' || btnId === 'panel_refresh') {
        const data = await panelAction('status');
        const embed = buildStatusEmbed(data);
        embed.setDescription(
          '**Server Control Panel**\nUse the buttons below to manage your DayZ server.'
        );
        await interaction.update({ embeds: [embed], components: buildControlPanel() });
      }

      // Start → confirm
      else if (btnId === 'panel_start') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        await safeReply(interaction, {
          content: '⚠️ Are you sure you want to **start** the server?',
          components: [buildConfirmRow('start')],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Stop → confirm
      else if (btnId === 'panel_stop') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        await safeReply(interaction, {
          content: '⚠️ Are you sure you want to **stop** the server?',
          components: [buildConfirmRow('stop')],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Restart → options
      else if (btnId === 'panel_restart') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        await safeReply(interaction, {
          content: '🔄 Choose a restart option:',
          components: [buildRestartOptions()],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Lock
      else if (btnId === 'panel_lock') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const result = await panelAction('lock');
        await safeReply(interaction, { content: result.error ? `❌ ${result.error}` : '🔒 Server locked.', flags: MessageFlags.Ephemeral });
      }

      // Unlock
      else if (btnId === 'panel_unlock') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const result = await panelAction('unlock');
        await safeReply(interaction, { content: result.error ? `❌ ${result.error}` : '🔓 Server unlocked.', flags: MessageFlags.Ephemeral });
      }

      // Broadcast → modal
      else if (btnId === 'panel_message') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const modal = new ModalBuilder()
          .setCustomId('modal_broadcast')
          .setTitle('📢 Broadcast Message');
        const input = new TextInputBuilder()
          .setCustomId('broadcast_text')
          .setLabel('Message')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter the message to broadcast to all players')
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
      }

      // Players
      else if (btnId === 'panel_players') {
        const data = await panelAction('players');
        const embed = buildPlayerListEmbed(data.players || []);
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Kick menu
      else if (btnId === 'panel_kick_menu') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const data = await panelAction('players');
        const players = data.players || [];
        if (players.length === 0) {
          return await safeReply(interaction, { content: 'No players online to kick.', flags: MessageFlags.Ephemeral });
        }
        const select = new StringSelectMenuBuilder()
          .setCustomId('select_kick_player')
          .setPlaceholder('Select a player to kick')
          .addOptions(
            players.slice(0, 25).map(p => ({
              label: p.name || `Player ${p.id}`,
              value: p.id || p.name,
              description: `Ping: ${p.ping || '?'}ms`,
            }))
          );
        await safeReply(interaction, {
          content: '👢 Select a player to kick:',
          components: [new ActionRowBuilder().addComponents(select)],
          flags: MessageFlags.Ephemeral,
        });
      }

      // RCON → modal
      else if (btnId === 'panel_rcon') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const modal = new ModalBuilder()
          .setCustomId('modal_rcon')
          .setTitle('🖥️ RCON Command');
        const input = new TextInputBuilder()
          .setCustomId('rcon_command')
          .setLabel('Command')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. #restart, kick 5, say -1 Hello')
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
      }

      // Mod list
      else if (btnId === 'panel_mod_list') {
        const mods = await panelAction('mods');
        const list = Array.isArray(mods) ? mods : (mods.mods || []);
        const embed = new EmbedBuilder()
          .setTitle('📦 Installed Mods')
          .setColor(0x5865f2)
          .setDescription(list.length ? list.map(m => `• **${m.name}** (${m.workshopId}) ${m.enabled ? '✅ Enabled' : '❌ Disabled'}`).join('\n') : '*No mods installed*')
          .setFooter({ text: `${list.length} mod(s) installed` })
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Mod status
      else if (btnId === 'panel_mod_status') {
        const status = await panelAction('modStatus');
        const embed = new EmbedBuilder()
          .setTitle('⏳ Mod Install Status')
          .setColor(0x5865f2)
          .setDescription(status && Object.keys(status).length ? Object.entries(status).map(([id, s]) => `• **${s.name}** (${id}): ${s.status} (${s.progress}%)`).join('\n') : '*No active installs*')
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Mod install → modal
      else if (btnId === 'panel_mod_install') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const modal = new ModalBuilder()
          .setCustomId('modal_mod_install')
          .setTitle('➕ Install Mod');
        const inputId = new TextInputBuilder()
          .setCustomId('mod_workshopid')
          .setLabel('Workshop ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const inputName = new TextInputBuilder()
          .setCustomId('mod_name')
          .setLabel('Mod Name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(inputId),
          new ActionRowBuilder().addComponents(inputName)
        );
        await interaction.showModal(modal);
      }

      // Mod uninstall → modal
      else if (btnId === 'panel_mod_uninstall') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const modal = new ModalBuilder()
          .setCustomId('modal_mod_uninstall')
          .setTitle('🗑️ Uninstall Mod');
        const inputId = new TextInputBuilder()
          .setCustomId('mod_workshopid')
          .setLabel('Workshop ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(inputId));
        await interaction.showModal(modal);
      }

      // Mod enable → modal
      else if (btnId === 'panel_mod_enable') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const modal = new ModalBuilder()
          .setCustomId('modal_mod_enable')
          .setTitle('✅ Enable Mod');
        const inputId = new TextInputBuilder()
          .setCustomId('mod_workshopid')
          .setLabel('Workshop ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(inputId));
        await interaction.showModal(modal);
      }

      // Mod disable → modal
      else if (btnId === 'panel_mod_disable') {
        if (!isAdmin(interaction)) return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        const modal = new ModalBuilder()
          .setCustomId('modal_mod_disable')
          .setTitle('🚫 Disable Mod');
        const inputId = new TextInputBuilder()
          .setCustomId('mod_workshopid')
          .setLabel('Workshop ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(inputId));
        await interaction.showModal(modal);
      }

      // Chat feed
      else if (btnId === 'panel_chat_feed') {
        const chat = await panelAction('chatFeed');
        const embed = new EmbedBuilder()
          .setTitle('💬 Live Chat Feed')
          .setColor(0x5865f2)
          .setDescription(chat.messages && chat.messages.length ? chat.messages.map(m => `• **${m.player}**: ${m.text}`).join('\n') : '*No recent chat messages*')
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Watch list
      else if (btnId === 'panel_watch_list') {
        const watch = await panelAction('watchList');
        const embed = new EmbedBuilder()
          .setTitle('🔔 Watch List Notifications')
          .setColor(0xffaa00)
          .setDescription(watch.players && watch.players.length ? watch.players.map(p => `• **${p.name}** (${p.reason || 'No reason'})`).join('\n') : '*No players on watch list*')
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Killfeed
      else if (btnId === 'panel_killfeed') {
        const feed = await panelAction('killfeed');
        const embed = new EmbedBuilder()
          .setTitle('☠️ Delayed Killfeed')
          .setColor(0xff3333)
          .setDescription(feed.kills && feed.kills.length ? feed.kills.map(k => `• **${k.victim}** killed by **${k.killer}** (${k.method || 'unknown'})`).join('\n') : '*No recent kills*')
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Priority queue
      else if (btnId === 'panel_priority_queue') {
        const queue = await panelAction('priorityQueue');
        const embed = new EmbedBuilder()
          .setTitle('🚦 Priority Queue')
          .setColor(0x3b82f6)
          .setDescription(queue.entries && queue.entries.length ? queue.entries.map(q => `• **${q.name}** (${q.role || 'Player'})`).join('\n') : '*No players in queue*')
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Time/weather
      else if (btnId === 'panel_time_weather') {
        const tw = await panelAction('timeWeather');
        const embed = new EmbedBuilder()
          .setTitle('⏰ Time & Weather')
          .setColor(0x00bfff)
          .setDescription(tw && tw.info ? tw.info : '*No data available*')
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Leaderboard
      else if (btnId === 'panel_leaderboard') {
        const stats = await panelAction('leaderboard');
        const embed = new EmbedBuilder()
          .setTitle('🏆 Leaderboard / Stats')
          .setColor(0xffd700)
          .setDescription(stats && stats.entries ? stats.entries.map(s => `• **${s.player}**: ${s.score} pts`).join('\n') : '*No leaderboard data*')
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Ban/whitelist
      else if (btnId === 'panel_ban_whitelist') {
        const bans = await panelAction('banWhitelist');
        const embed = new EmbedBuilder()
          .setTitle('🚫 Ban / Whitelist')
          .setColor(0xff3333)
          .setDescription(bans && bans.entries ? bans.entries.map(b => `• **${b.player}**: ${b.status} (${b.reason || ''})`).join('\n') : '*No ban/whitelist data*')
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Confirm actions
      else if (btnId === 'confirm_start') {
        const result = await panelAction('start');
        if (result.error) {
          await interaction.update({ content: `❌ ${result.error}`, embeds: [], components: [] });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('🟡 Server Starting...')
          .setColor(0xffaa00)
          .setDescription(result.message === 'Starting...' ? 'The server is booting up. This may take a minute.' : result.message)
          .setFooter({ text: `Started by ${interaction.user.tag}` })
          .setTimestamp();
        await interaction.update({ embeds: [embed], components: [] });
      }

      else if (btnId === 'confirm_stop') {
        const result = await panelAction('stop');
        if (result.error) {
          await interaction.update({ content: `❌ ${result.error}`, embeds: [], components: [] });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('🟡 Server Stopping...')
          .setColor(0xffaa00)
          .setDescription('Shutting down gracefully...')
          .setFooter({ text: `Stopped by ${interaction.user.tag}` })
          .setTimestamp();
        await interaction.update({ embeds: [embed], components: [] });
      }

      else if (btnId === 'confirm_cancel') {
        await interaction.update({ content: '❌ Action cancelled.', embeds: [], components: [] });
      }

      // Restart options
      else if (btnId === 'restart_now') {
        const result = await panelAction('restart');
        if (result.error) {
          await interaction.update({ content: `❌ ${result.error}`, embeds: [], components: [] });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('🔄 Restarting Now')
          .setColor(0xffaa00)
          .setFooter({ text: `Restarted by ${interaction.user.tag}` })
          .setTimestamp();
        await interaction.update({ embeds: [embed], components: [] });
      }

      else if (btnId === 'restart_60') {
        const result = await panelAction('restart', { countdown: 60 });
        if (result.error) {
          await interaction.update({ content: `❌ ${result.error}`, embeds: [], components: [] });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('🔄 Restart in 60 Seconds')
          .setColor(0xffaa00)
          .setDescription('Players have been warned.')
          .setTimestamp();
        await interaction.update({ embeds: [embed], components: [] });
      }

      else if (btnId === 'restart_300') {
        const result = await panelAction('restart', { countdown: 300 });
        if (result.error) {
          await interaction.update({ content: `❌ ${result.error}`, embeds: [], components: [] });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('🔄 Restart in 5 Minutes')
          .setColor(0xffaa00)
          .setDescription('Players have been warned.')
          .setTimestamp();
        await interaction.update({ embeds: [embed], components: [] });
      }

      else if (btnId === 'restart_cancel') {
        await interaction.update({ content: '❌ Restart cancelled.', embeds: [], components: [] });
      }
    }

    // ── Slash Commands ──
    else if (interaction.isChatInputCommand && interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'panel') {
        await safeReply(interaction, { content: 'Deploying control panel...', flags: MessageFlags.Ephemeral });
        let data;
        try {
          data = await panelAction('status');
        } catch (err) {
          await interaction.followUp({ content: '❌ Failed to fetch server status. Please try again later.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (data && data.error) {
          await interaction.followUp({ content: `❌ ${data.error}`, flags: MessageFlags.Ephemeral });
          return;
        }
        const embed = buildStatusEmbed(data);
        embed.setDescription(
          '**Server Control Panel**\nUse the buttons below to manage your DayZ server.\n\n' +
          '🟢 Green = Start  •  🔴 Red = Stop/Kick  •  🔵 Blue = Actions'
        );
        await interaction.channel.send({ embeds: [embed], components: buildControlPanel() });
        await interaction.followUp({ content: '✅ Control panel deployed below.', flags: MessageFlags.Ephemeral });
      }

      else if (commandName === 'setup') {
        if (!isAdmin(interaction)) {
          return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        }
        const data = await panelAction('status');
        const embed = buildStatusEmbed(data);
        embed.setDescription(
          '**🎮 DayZ Server Control Panel**\n\n' +
          'Use the buttons below to manage the server.\n' +
          'Status updates automatically when actions are taken.\n\n' +
          '`▶️` Start  •  `⏹️` Stop  •  `🔄` Restart  •  `🔒` Lock/Unlock\n' +
          '`👥` Players  •  `👢` Kick  •  `📢` Broadcast  •  `🖥️` RCON'
        );
        await safeReply(interaction, { content: '✅ Control panel deployed below.', flags: MessageFlags.Ephemeral });
        await interaction.channel.send({ embeds: [embed], components: buildControlPanel() });
      }

      else if (commandName === 'status') {
        const data = await panelAction('status');
        const embed = buildStatusEmbed(data);
        if (data.players && data.players.length > 0) {
          const playerList = data.players.map(p => `• ${p.name}`).join('\n');
          embed.addFields({ name: 'Online Players', value: playerList.slice(0, 1024) });
        }
        await safeReply(interaction, { embeds: [embed] });
      }

      else if (commandName === 'players') {
        const data = await panelAction('players');
        const embed = buildPlayerListEmbed(data.players || []);
        await safeReply(interaction, { embeds: [embed] });
      }

      else if (commandName === 'rcon') {
        if (!isAdmin(interaction)) {
          return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        }
        const command = interaction.options.getString('command');
        const result = await panelAction('rcon', { command });
        const embed = new EmbedBuilder()
          .setTitle('🖥️ RCON')
          .setColor(0x5865f2)
          .addFields(
            { name: 'Command', value: `\`${command}\`` },
            { name: 'Response', value: `\`\`\`${result.result || result.error || 'Done'}\`\`\`` }
          )
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      else if (commandName === 'broadcast') {
        if (!isAdmin(interaction)) {
          return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        }
        const message = interaction.options.getString('message');
        await panelAction('message', { message });
        const embed = new EmbedBuilder()
          .setTitle('📢 Message Broadcast')
          .setColor(0x00ff6a)
          .setDescription(`\`\`\`${message}\`\`\``)
          .setFooter({ text: `Sent by ${interaction.user.tag}` })
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed] });
      }

      else if (commandName === 'restart') {
        if (!isAdmin(interaction)) {
          return await safeReply(interaction, { content: '❌ Admin role required.', flags: MessageFlags.Ephemeral });
        }
        const countdown = interaction.options.getInteger('countdown');
        if (countdown) {
          await panelAction('restart', { countdown });
          await safeReply(interaction, { content: `🔄 Server restarting in **${countdown}** seconds. Players have been warned.` });
        } else {
          await safeReply(interaction, {
            content: '🔄 Choose a restart option:',
            components: [buildRestartOptions()],
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }

    // ── Select Menu Interactions ──
    else if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_kick_player') {
        const playerId = interaction.values[0];
        const modal = new ModalBuilder()
          .setCustomId(`modal_kick_${playerId}`)
          .setTitle('👢 Kick Player');
        const input = new TextInputBuilder()
          .setCustomId('kick_reason')
          .setLabel('Reason (optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Rule violation, etc.')
          .setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
      }
    }

    // ── Modal Submissions ──
    else if (interaction.isModalSubmit && interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_broadcast') {
        const message = interaction.fields.getTextInputValue('broadcast_text');
        await panelAction('message', { message });
        const embed = new EmbedBuilder()
          .setTitle('📢 Message Broadcast')
          .setColor(0x00ff6a)
          .setDescription(`\`\`\`${message}\`\`\``)
          .setFooter({ text: `Sent by ${interaction.user.tag}` })
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed] });
      }

      else if (interaction.customId === 'modal_rcon') {
        const command = interaction.fields.getTextInputValue('rcon_command');
        const result = await panelAction('rcon', { command });
        const embed = new EmbedBuilder()
          .setTitle('🖥️ RCON')
          .setColor(0x5865f2)
          .addFields(
            { name: 'Command', value: `\`${command}\`` },
            { name: 'Response', value: `\`\`\`${result.result || result.error || 'Done'}\`\`\`` }
          )
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      else if (interaction.customId.startsWith('modal_kick_')) {
        const playerId = interaction.customId.replace('modal_kick_', '');
        const reason = interaction.fields.getTextInputValue('kick_reason') || 'Kicked via Discord';
        await panelAction('kick', { playerId, reason });
        const embed = new EmbedBuilder()
          .setTitle('👢 Player Kicked')
          .setColor(0xff3333)
          .addFields(
            { name: 'Player', value: playerId },
            { name: 'Reason', value: reason }
          )
          .setFooter({ text: `Kicked by ${interaction.user.tag}` })
          .setTimestamp();
        await safeReply(interaction, { embeds: [embed] });
      }

      else if (interaction.customId === 'modal_mod_install') {
        const workshopId = interaction.fields.getTextInputValue('mod_workshopid');
        const name = interaction.fields.getTextInputValue('mod_name');
        const result = await panelAction('modInstall', { workshopId, name });
        await safeReply(interaction, { content: result.error ? `❌ ${result.error}` : `✅ Mod **${name}** (${workshopId}) install started.`, flags: MessageFlags.Ephemeral });
      }

      else if (interaction.customId === 'modal_mod_uninstall') {
        const workshopId = interaction.fields.getTextInputValue('mod_workshopid');
        const result = await panelAction('modUninstall', { workshopId });
        await safeReply(interaction, { content: result.error ? `❌ ${result.error}` : `✅ Mod ${workshopId} uninstalled.`, flags: MessageFlags.Ephemeral });
      }

      else if (interaction.customId === 'modal_mod_enable') {
        const workshopId = interaction.fields.getTextInputValue('mod_workshopid');
        const result = await panelAction('modEnable', { workshopId });
        await safeReply(interaction, { content: result.error ? `❌ ${result.error}` : `✅ Mod ${workshopId} enabled.`, flags: MessageFlags.Ephemeral });
      }

      else if (interaction.customId === 'modal_mod_disable') {
        const workshopId = interaction.fields.getTextInputValue('mod_workshopid');
        const result = await panelAction('modDisable', { workshopId });
        await safeReply(interaction, { content: result.error ? `❌ ${result.error}` : `🚫 Mod ${workshopId} disabled.`, flags: MessageFlags.Ephemeral });
      }
    }

  } catch (err) {
    console.error('[interaction] error', err);
    try {
      if (interaction && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Error processing interaction. Check logs.', flags: MessageFlags.Ephemeral });
      }
    } catch (err2) {
      console.error('[interaction] failed to send error reply', err2);
    }
  }
});

// ─── Auto-Status Updates ─────────────────────────────────
// Update bot presence with player count every 60 seconds
setInterval(async () => {
  try {
    const data = await panelAction('status');
    const statusText = data.status === 'running'
      ? `${data.playerCount}/${data.maxPlayers} players`
      : `Server ${data.status}`;
    client.user.setPresence({
      status: data.status === 'running' ? 'online' : 'idle',
      activities: [{ name: statusText, type: 3 }],
    });
  } catch { /* ignore */ }
}, 60000);

// ─── Start ───────────────────────────────────────────────
async function main() {
  if (!CONFIG.token) {
    console.error('❌ DISCORD_BOT_TOKEN is required. Set it in .env');
    console.log('\nTo set up the Discord bot:');
    console.log('1. Go to https://discord.com/developers/applications');
    console.log('2. Create a New Application');
    console.log('3. Go to Bot → Add Bot → Copy Token');
    console.log('4. Go to OAuth2 → URL Generator');
    console.log('5. Select: bot, applications.commands');
    console.log('6. Select permissions: Send Messages, Embed Links, Use Slash Commands');
    console.log('7. Copy the generated URL and invite the bot to your server');
    console.log('8. Set DISCORD_BOT_TOKEN in your .env file\n');
    process.exit(1);
  }

  await registerCommands();
  await client.login(CONFIG.token);
}

main().catch(console.error);

// ─── Graceful Shutdown ───────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down bot gracefully...`);
  client.destroy();
  console.log('Discord client destroyed');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
