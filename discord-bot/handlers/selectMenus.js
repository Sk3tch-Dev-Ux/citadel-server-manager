/**
 * Select menu interaction handlers.
 */
const { EmbedBuilder, ActionRowBuilder, MessageFlags } = require('discord.js');
const { panelAction, safeReply, selectedServers } = require('../api');
const { setCooldown } = require('../utils/cooldowns');
const COLORS = require('../ui/colors');
const { buildStatusEmbed } = require('../ui/embeds');
const {
  buildControlPanel, buildServerButtons, buildPlayersButtons,
  buildModsButtons, buildIntelButtons, buildAdminActionButtons,
  buildKickModal, buildTeleportModal, buildSpawnItemModal,
  buildMessagePlayerModal,
} = require('../ui/components');

async function handleSelectMenu(interaction) {
  const guildId = interaction.guildId;
  const customId = interaction.customId;

  // ── Server Switcher ──
  if (customId === 'server_select') {
    const serverId = interaction.values[0];
    selectedServers.set(guildId, serverId);
    const data = await panelAction('status', {}, guildId, interaction);
    const serversList = await panelAction('servers', {}, guildId, interaction);
    const embed = buildStatusEmbed(data);
    embed.setDescription('Use the buttons and dropdown below to manage the server.');
    await interaction.update({ embeds: [embed], components: buildControlPanel(serversList.servers) });
    return;
  }

  // ── Category Select ──
  if (customId === 'category_select') {
    const selected = interaction.values[0];
    const CATEGORY_MAP = {
      cat_server: {
        title: 'Server Controls',
        desc: 'Lock or unlock the server, broadcast messages, or send RCON commands.',
        color: COLORS.info,
        components: [buildServerButtons()],
      },
      cat_players: {
        title: 'Player Management',
        desc: 'View online players, kick players, manage bans, or look up player stats.',
        color: COLORS.players,
        components: [buildPlayersButtons()],
      },
      cat_mods: {
        title: 'Mod Management',
        desc: 'View, install, uninstall, enable, or disable Steam Workshop mods.',
        color: COLORS.mods,
        components: buildModsButtons(),
      },
      cat_intel: {
        title: 'Server Intel',
        desc: 'Live feeds, player stats, and server data.',
        color: COLORS.intel,
        components: buildIntelButtons(),
      },
      cat_actions: {
        title: 'Admin Actions',
        desc: 'Heal, kill, teleport players, or spawn items on the server.',
        color: COLORS.actions,
        components: buildAdminActionButtons(),
      },
    };

    const cat = CATEGORY_MAP[selected];
    if (cat) {
      const embed = new EmbedBuilder().setTitle(cat.title).setDescription(cat.desc).setColor(cat.color);
      await safeReply(interaction, { embeds: [embed], components: cat.components, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // ── Kick Player Select ──
  if (customId === 'select_kick_player') {
    const playerId = interaction.values[0];
    await interaction.showModal(buildKickModal(playerId));
    return;
  }

  // ── Admin Action Player Selects ──
  if (customId === 'select_gl_heal') {
    const steamId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionHeal', { steamId }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_gl_heal');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Heal')
      .setColor(result.error ? COLORS.error : COLORS.success)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (customId === 'select_gl_kill') {
    const steamId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionKill', { steamId }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_gl_kill');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Kill')
      .setColor(result.error ? COLORS.error : COLORS.warning)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (customId === 'select_gl_teleport') {
    const steamId = interaction.values[0];
    await interaction.showModal(buildTeleportModal(steamId));
    return;
  }

  if (customId === 'select_gl_spawn') {
    const steamId = interaction.values[0];
    await interaction.showModal(buildSpawnItemModal(steamId));
    return;
  }

  // ── Unstuck ──
  if (customId === 'select_gl_unstuck') {
    const steamId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionUnstuck', { steamId }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_gl_unstuck');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Unstuck')
      .setColor(result.error ? COLORS.error : COLORS.success)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Freeze ──
  if (customId === 'select_gl_freeze') {
    const steamId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionFreeze', { steamId, frozen: 1 }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_gl_freeze');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Freeze')
      .setColor(result.error ? COLORS.error : COLORS.warning)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Strip Gear ──
  if (customId === 'select_gl_strip') {
    const steamId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionStrip', { steamId }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_gl_strip');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Strip Gear')
      .setColor(result.error ? COLORS.error : COLORS.warning)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Explode ──
  if (customId === 'select_gl_explode') {
    const steamId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionExplode', { steamId }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_gl_explode');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Explode')
      .setColor(result.error ? COLORS.error : COLORS.warning)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Message Player (opens modal) ──
  if (customId === 'select_gl_message') {
    const steamId = interaction.values[0];
    await interaction.showModal(buildMessagePlayerModal(steamId));
    return;
  }
}

module.exports = { handleSelectMenu };
