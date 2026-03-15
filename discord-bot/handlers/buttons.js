/**
 * Button interaction handlers.
 * Uses a dispatch map instead of if/else chain.
 */
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { panelAction, safeReply } = require('../api');
const { isAdmin } = require('../utils/permissions');
const { checkCooldown, setCooldown } = require('../utils/cooldowns');
const { escapeMarkdown } = require('../utils/sanitize');
const COLORS = require('../ui/colors');
const { buildStatusEmbed, buildPlayerListEmbed, buildLeaderboardEmbed } = require('../ui/embeds');
const {
  buildControlPanel, buildServerButtons, buildPlayersButtons, buildModsButtons,
  buildIntelButtons, buildAdminActionButtons, buildRestartOptions, buildConfirmRow,
  buildPlayerSelectMenu, buildBroadcastModal, buildRconModal, buildPlayerInfoModal,
  buildMessagePlayerModal, buildModInstallModal, buildModActionModal,
} = require('../ui/components');

// ── Helper: admin gate + cooldown check ──
async function adminGate(interaction, action) {
  if (!isAdmin(interaction)) {
    await safeReply(interaction, { content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    return false;
  }
  const remaining = checkCooldown(interaction.user.id, action);
  if (remaining > 0) {
    await safeReply(interaction, { content: `Please wait **${remaining}s** before using this again.`, flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

// ── Status / Refresh ──
async function handleStatusRefresh(interaction) {
  const guildId = interaction.guildId;
  const data = await panelAction('status', {}, guildId, interaction);
  const serversList = await panelAction('servers', {}, guildId, interaction);
  const embed = buildStatusEmbed(data);
  embed.setDescription('Use the buttons and dropdown below to manage the server.');
  await interaction.update({ embeds: [embed], components: buildControlPanel(serversList.servers) });
}

// ── Start / Stop / Restart ──
async function handleStart(interaction) {
  if (!await adminGate(interaction, 'confirm_start')) return;
  await safeReply(interaction, { content: 'Are you sure you want to **start** the server?', components: [buildConfirmRow('start')], flags: MessageFlags.Ephemeral });
}

async function handleStop(interaction) {
  if (!await adminGate(interaction, 'confirm_stop')) return;
  await safeReply(interaction, { content: 'Are you sure you want to **stop** the server?', components: [buildConfirmRow('stop')], flags: MessageFlags.Ephemeral });
}

async function handleRestart(interaction) {
  if (!await adminGate(interaction, 'restart_now')) return;
  await safeReply(interaction, { content: 'Choose a restart option:', components: [buildRestartOptions()], flags: MessageFlags.Ephemeral });
}

// ── Server Controls ──
async function handleLock(interaction) {
  if (!await adminGate(interaction, 'panel_lock')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await panelAction('lock', {}, interaction.guildId, interaction);
  setCooldown(interaction.user.id, 'panel_lock');
  await interaction.editReply({ content: result.error ? `Error: ${result.error}` : 'Server locked.' });
}

async function handleUnlock(interaction) {
  if (!await adminGate(interaction, 'panel_unlock')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await panelAction('unlock', {}, interaction.guildId, interaction);
  setCooldown(interaction.user.id, 'panel_unlock');
  await interaction.editReply({ content: result.error ? `Error: ${result.error}` : 'Server unlocked.' });
}

async function showBroadcastModal(interaction) {
  if (!isAdmin(interaction)) return await safeReply(interaction, { content: 'Admin role required.', flags: MessageFlags.Ephemeral });
  await interaction.showModal(buildBroadcastModal());
}

async function showRconModal(interaction) {
  if (!isAdmin(interaction)) return await safeReply(interaction, { content: 'Admin role required.', flags: MessageFlags.Ephemeral });
  await interaction.showModal(buildRconModal());
}

// ── Players ──
async function handlePlayers(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const data = await panelAction('players', {}, interaction.guildId, interaction);
  const embed = buildPlayerListEmbed(data.players || []);
  await interaction.editReply({ embeds: [embed] });
}

async function showPlayerInfoModal(interaction) {
  await interaction.showModal(buildPlayerInfoModal());
}

async function handleKickMenu(interaction) {
  if (!await adminGate(interaction, 'panel_kick_menu')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const data = await panelAction('players', {}, interaction.guildId, interaction);
  const players = data.players || [];
  if (players.length === 0) {
    return await interaction.editReply({ content: 'No players online to kick.' });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId('select_kick_player')
    .setPlaceholder('Select a player to kick')
    .addOptions(players.slice(0, 25).map(p => ({
      label: (p.name || `Player ${p.id}`).slice(0, 100),
      value: p.id || p.name,
      description: `Ping: ${p.ping || '?'}ms`,
    })));
  await interaction.editReply({ content: 'Select a player to kick:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleBanWhitelist(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const bans = await panelAction('banWhitelist', {}, interaction.guildId, interaction);
  const embed = new EmbedBuilder()
    .setTitle('Ban List').setColor(COLORS.error)
    .setDescription(bans?.entries?.length
      ? bans.entries.map(b => `**${escapeMarkdown(b.player)}** — ${b.status} ${b.reason ? `(${b.reason})` : ''}`).join('\n')
      : '*No ban data*')
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

// ── Mods ──
async function handleModList(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const mods = await panelAction('mods', {}, interaction.guildId, interaction);
  const list = Array.isArray(mods) ? mods : (mods.mods || []);
  const embed = new EmbedBuilder()
    .setTitle('Installed Mods').setColor(COLORS.mods)
    .setDescription(list.length
      ? list.map(m => `\`${m.enabled ? 'ON ' : 'OFF'}\` **${escapeMarkdown(m.name)}** — ${m.workshopId}`).join('\n')
      : '*No mods installed*')
    .setFooter({ text: `${list.length} mod(s) installed` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleModStatus(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const status = await panelAction('modStatus', {}, interaction.guildId, interaction);
  const embed = new EmbedBuilder()
    .setTitle('Mod Install Status').setColor(COLORS.mods)
    .setDescription(status && Object.keys(status).length
      ? Object.entries(status).map(([id, s]) => `**${escapeMarkdown(s.name)}** (${id}) — ${s.status} ${s.progress}%`).join('\n')
      : '*No active installs*')
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function showModInstall(interaction) {
  if (!isAdmin(interaction)) return await safeReply(interaction, { content: 'Admin role required.', flags: MessageFlags.Ephemeral });
  await interaction.showModal(buildModInstallModal());
}

async function showModUninstall(interaction) {
  if (!isAdmin(interaction)) return await safeReply(interaction, { content: 'Admin role required.', flags: MessageFlags.Ephemeral });
  await interaction.showModal(buildModActionModal('modal_mod_uninstall', 'Uninstall Mod'));
}

async function showModEnable(interaction) {
  if (!isAdmin(interaction)) return await safeReply(interaction, { content: 'Admin role required.', flags: MessageFlags.Ephemeral });
  await interaction.showModal(buildModActionModal('modal_mod_enable', 'Enable Mod'));
}

async function showModDisable(interaction) {
  if (!isAdmin(interaction)) return await safeReply(interaction, { content: 'Admin role required.', flags: MessageFlags.Ephemeral });
  await interaction.showModal(buildModActionModal('modal_mod_disable', 'Disable Mod'));
}

// ── Intel ──
async function handleChatFeed(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const chat = await panelAction('chatFeed', {}, interaction.guildId, interaction);
  const embed = new EmbedBuilder()
    .setTitle('Live Chat Feed').setColor(COLORS.intel)
    .setDescription(chat.messages?.length
      ? chat.messages.map(m => `**${escapeMarkdown(m.player)}**: ${escapeMarkdown(m.text)}`).join('\n')
      : '*No recent chat messages*')
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleWatchList(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const watch = await panelAction('watchList', {}, interaction.guildId, interaction);
  const embed = new EmbedBuilder()
    .setTitle('Watch List').setColor(COLORS.warning)
    .setDescription(watch.players?.length
      ? watch.players.map(p => `**${escapeMarkdown(p.name)}** — ${p.reason || 'No reason'}`).join('\n')
      : '*No players on watch list*')
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleKillfeed(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const feed = await panelAction('killfeed', {}, interaction.guildId, interaction);
  const embed = new EmbedBuilder()
    .setTitle('Killfeed').setColor(COLORS.error)
    .setDescription(feed.kills?.length
      ? feed.kills.map(k => `**${escapeMarkdown(k.victim)}** killed by **${escapeMarkdown(k.killer)}** (${k.method || 'unknown'})`).join('\n')
      : '*No recent kills*')
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handlePriorityQueue(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const queue = await panelAction('priorityQueue', {}, interaction.guildId, interaction);
  const embed = new EmbedBuilder()
    .setTitle('Priority Queue').setColor(COLORS.info)
    .setDescription(queue.entries?.length
      ? queue.entries.map(q => `**${escapeMarkdown(q.name)}** — ${q.role || 'Player'}`).join('\n')
      : '*No players in queue*')
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleTimeWeather(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const tw = await panelAction('timeWeather', {}, interaction.guildId, interaction);
  const embed = new EmbedBuilder()
    .setTitle('Time & Weather').setColor(COLORS.intel)
    .setDescription(tw?.info || '*No data available*')
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleLeaderboard(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const stats = await panelAction('leaderboard', {}, interaction.guildId, interaction);
  const embed = buildLeaderboardEmbed(stats?.entries);
  await interaction.editReply({ embeds: [embed] });
}

// ── Admin Actions ──
async function handleAdminHeal(interaction) {
  if (!await adminGate(interaction, 'panel_gl_heal')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_heal', 'Select a player to heal', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to heal:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleAdminKill(interaction) {
  if (!await adminGate(interaction, 'panel_gl_kill')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_kill', 'Select a player to kill', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to kill:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleAdminTeleport(interaction) {
  if (!await adminGate(interaction, 'panel_gl_teleport')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_teleport', 'Select a player to teleport', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to teleport:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleAdminSpawn(interaction) {
  if (!await adminGate(interaction, 'panel_gl_spawn')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_spawn', 'Select a player to receive items', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to spawn items on:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleAdminUnstuck(interaction) {
  if (!await adminGate(interaction, 'panel_gl_unstuck')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_unstuck', 'Select a player to unstuck', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to unstuck:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleAdminFreeze(interaction) {
  if (!await adminGate(interaction, 'panel_gl_freeze')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_freeze', 'Select a player to freeze', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to freeze:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleAdminStrip(interaction) {
  if (!await adminGate(interaction, 'panel_gl_strip')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_strip', 'Select a player to strip gear from', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to strip gear from:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleAdminExplode(interaction) {
  if (!await adminGate(interaction, 'panel_gl_explode')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_explode', 'Select a player to explode', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to explode:', components: [new ActionRowBuilder().addComponents(select)] });
}

async function handleAdminMessage(interaction) {
  if (!await adminGate(interaction, 'panel_gl_message')) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const select = await buildPlayerSelectMenu('select_gl_message', 'Select a player to message', interaction.guildId);
  if (!select) return await interaction.editReply({ content: 'No players online.' });
  await interaction.editReply({ content: 'Select a player to send a message to:', components: [new ActionRowBuilder().addComponents(select)] });
}

// ── Confirm / Restart Buttons ──
async function handleConfirmStart(interaction) {
  await interaction.deferUpdate();
  const result = await panelAction('start', {}, interaction.guildId, interaction);
  setCooldown(interaction.user.id, 'confirm_start');
  if (result.error) return await interaction.editReply({ content: `Error: ${result.error}`, embeds: [], components: [] });
  const embed = new EmbedBuilder()
    .setTitle('Server Starting').setColor(COLORS.starting)
    .setDescription(result.message === 'Starting...' ? 'The server is booting up. This may take a minute.' : (result.message || 'Starting...'))
    .setFooter({ text: `Started by ${interaction.user.tag}` }).setTimestamp();
  await interaction.editReply({ embeds: [embed], components: [] });
}

async function handleConfirmStop(interaction) {
  await interaction.deferUpdate();
  const result = await panelAction('stop', {}, interaction.guildId, interaction);
  setCooldown(interaction.user.id, 'confirm_stop');
  if (result.error) return await interaction.editReply({ content: `Error: ${result.error}`, embeds: [], components: [] });
  const embed = new EmbedBuilder()
    .setTitle('Server Stopping').setColor(COLORS.warning)
    .setDescription('Shutting down gracefully...')
    .setFooter({ text: `Stopped by ${interaction.user.tag}` }).setTimestamp();
  await interaction.editReply({ embeds: [embed], components: [] });
}

async function handleConfirmCancel(interaction) {
  await interaction.update({ content: 'Action cancelled.', embeds: [], components: [] });
}

async function handleRestartNow(interaction) {
  await interaction.deferUpdate();
  const result = await panelAction('restart', {}, interaction.guildId, interaction);
  setCooldown(interaction.user.id, 'restart_now');
  if (result.error) return await interaction.editReply({ content: `Error: ${result.error}`, embeds: [], components: [] });
  const embed = new EmbedBuilder()
    .setTitle('Restarting Now').setColor(COLORS.warning)
    .setFooter({ text: `Restarted by ${interaction.user.tag}` }).setTimestamp();
  await interaction.editReply({ embeds: [embed], components: [] });
}

async function handleRestart60(interaction) {
  await interaction.deferUpdate();
  const result = await panelAction('restart', { countdown: 60 }, interaction.guildId, interaction);
  setCooldown(interaction.user.id, 'restart_60');
  if (result.error) return await interaction.editReply({ content: `Error: ${result.error}`, embeds: [], components: [] });
  const embed = new EmbedBuilder()
    .setTitle('Restart in 60 Seconds').setColor(COLORS.warning)
    .setDescription('Players have been warned.').setTimestamp();
  await interaction.editReply({ embeds: [embed], components: [] });
}

async function handleRestart300(interaction) {
  await interaction.deferUpdate();
  const result = await panelAction('restart', { countdown: 300 }, interaction.guildId, interaction);
  setCooldown(interaction.user.id, 'restart_300');
  if (result.error) return await interaction.editReply({ content: `Error: ${result.error}`, embeds: [], components: [] });
  const embed = new EmbedBuilder()
    .setTitle('Restart in 5 Minutes').setColor(COLORS.warning)
    .setDescription('Players have been warned.').setTimestamp();
  await interaction.editReply({ embeds: [embed], components: [] });
}

async function handleRestartCancel(interaction) {
  await interaction.update({ content: 'Restart cancelled.', embeds: [], components: [] });
}

// ── Dispatch Map ──
const BUTTON_HANDLERS = {
  panel_status: handleStatusRefresh,
  panel_refresh: handleStatusRefresh,
  panel_start: handleStart,
  panel_stop: handleStop,
  panel_restart: handleRestart,
  panel_lock: handleLock,
  panel_unlock: handleUnlock,
  panel_message: showBroadcastModal,
  panel_rcon: showRconModal,
  panel_players: handlePlayers,
  panel_player_info: showPlayerInfoModal,
  panel_kick_menu: handleKickMenu,
  panel_ban_whitelist: handleBanWhitelist,
  panel_mod_list: handleModList,
  panel_mod_status: handleModStatus,
  panel_mod_install: showModInstall,
  panel_mod_uninstall: showModUninstall,
  panel_mod_enable: showModEnable,
  panel_mod_disable: showModDisable,
  panel_chat_feed: handleChatFeed,
  panel_watch_list: handleWatchList,
  panel_killfeed: handleKillfeed,
  panel_priority_queue: handlePriorityQueue,
  panel_time_weather: handleTimeWeather,
  panel_leaderboard: handleLeaderboard,
  panel_gl_heal: handleAdminHeal,
  panel_gl_kill: handleAdminKill,
  panel_gl_teleport: handleAdminTeleport,
  panel_gl_spawn: handleAdminSpawn,
  panel_gl_unstuck: handleAdminUnstuck,
  panel_gl_freeze: handleAdminFreeze,
  panel_gl_strip: handleAdminStrip,
  panel_gl_explode: handleAdminExplode,
  panel_gl_message: handleAdminMessage,
  confirm_start: handleConfirmStart,
  confirm_stop: handleConfirmStop,
  confirm_cancel: handleConfirmCancel,
  restart_now: handleRestartNow,
  restart_60: handleRestart60,
  restart_300: handleRestart300,
  restart_cancel: handleRestartCancel,
};

async function handleButton(interaction) {
  const handler = BUTTON_HANDLERS[interaction.customId];
  if (handler) {
    await handler(interaction);
  } else {
    console.warn(`[buttons] No handler for customId: ${interaction.customId}`);
    await safeReply(interaction, { content: 'This action is not available.', flags: MessageFlags.Ephemeral });
  }
}

module.exports = { handleButton };
