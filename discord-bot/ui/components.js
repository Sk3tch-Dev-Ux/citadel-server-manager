/**
 * Discord UI component builders (buttons, select menus, modals).
 */
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { panelAction } = require('../api');

function buildControlPanel(servers = null) {
  const coreButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_status').setLabel('Status').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_start').setLabel('Start').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_stop').setLabel('Stop').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel_restart').setLabel('Restart').setStyle(ButtonStyle.Primary),
  );

  const categorySelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('category_select')
      .setPlaceholder('Select a category...')
      .addOptions(
        { label: 'Server', value: 'cat_server', description: 'Lock, Unlock, Broadcast, RCON' },
        { label: 'Players', value: 'cat_players', description: 'Player list, Kick, Ban list' },
        { label: 'Mods', value: 'cat_mods', description: 'Install, Uninstall, Enable, Disable' },
        { label: 'Intel', value: 'cat_intel', description: 'Chat, Killfeed, Watchlist, Leaderboard' },
        { label: 'Admin Actions', value: 'cat_actions', description: 'Heal, Kill, Freeze, Teleport, Spawn & more' },
      )
  );

  const rows = [coreButtons, categorySelect];

  if (servers && servers.length > 1) {
    const serverSelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('server_select')
        .setPlaceholder('🖥️ Switch server...')
        .addOptions(
          servers.slice(0, 25).map(s => ({
            label: s.name.slice(0, 100),
            value: s.id,
            description: `${s.status === 'running' ? '🟢' : '🔴'} ${s.playerCount}/${s.maxPlayers} players • ${(s.map || 'unknown').replace('plus', '+')}`.slice(0, 100),
          }))
        )
    );
    rows.push(serverSelect);
  }

  return rows;
}

function buildServerButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_lock').setLabel('Lock').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_unlock').setLabel('Unlock').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_message').setLabel('Broadcast').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_rcon').setLabel('RCON').setStyle(ButtonStyle.Secondary),
  );
}

function buildPlayersButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_players').setLabel('Player List').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_kick_menu').setLabel('Kick Player').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel_ban_whitelist').setLabel('Ban List').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_player_info').setLabel('Player Info').setStyle(ButtonStyle.Primary),
  );
}

function buildModsButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_mod_list').setLabel('Mod List').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_mod_status').setLabel('Mod Status').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_mod_install').setLabel('Install').setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_mod_uninstall').setLabel('Uninstall').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('panel_mod_enable').setLabel('Enable').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('panel_mod_disable').setLabel('Disable').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildIntelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_chat_feed').setLabel('Chat Feed').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_killfeed').setLabel('Killfeed').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_watch_list').setLabel('Watch List').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_priority_queue').setLabel('Priority Queue').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_leaderboard').setLabel('Leaderboard').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_time_weather').setLabel('Time & Weather').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildAdminActionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_gl_heal').setLabel('Heal').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('panel_gl_unstuck').setLabel('Unstuck').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('panel_gl_spawn').setLabel('Spawn Item').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_gl_teleport').setLabel('Teleport').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_gl_message').setLabel('Message').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_gl_freeze').setLabel('Freeze').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_gl_strip').setLabel('Strip Gear').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_gl_kill').setLabel('Kill').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('panel_gl_explode').setLabel('Explode').setStyle(ButtonStyle.Danger),
    ),
  ];
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
    new ButtonBuilder().setCustomId(`confirm_${action}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('confirm_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Build a player select menu from online players.
 */
async function buildPlayerSelectMenu(customId, placeholder, guildId) {
  const data = await panelAction('players', {}, guildId);
  const players = data.players || [];
  if (players.length === 0) return null;
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(
      players.slice(0, 25).map(p => ({
        label: (p.name || `Player ${p.id}`).slice(0, 100),
        value: p.steamId || p.id || p.name,
        description: `Ping: ${p.ping || '?'}ms${p.steamId ? ` | ${p.steamId}` : ''}`.slice(0, 100),
      }))
    );
}

/**
 * Build common modals used across handlers.
 */
function buildBroadcastModal() {
  const modal = new ModalBuilder().setCustomId('modal_broadcast').setTitle('Broadcast Message');
  const input = new TextInputBuilder()
    .setCustomId('broadcast_text').setLabel('Message')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter the message to broadcast to all players')
    .setMaxLength(256).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildRconModal() {
  const modal = new ModalBuilder().setCustomId('modal_rcon').setTitle('RCON Command');
  const input = new TextInputBuilder()
    .setCustomId('rcon_command').setLabel('Command')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. #restart, kick 5, say -1 Hello')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildPlayerInfoModal() {
  const modal = new ModalBuilder().setCustomId('modal_player_info').setTitle('Player Info Lookup');
  const input = new TextInputBuilder()
    .setCustomId('player_steamid').setLabel('Steam64 ID')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 76561198012102485')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildKickModal(playerId) {
  const modal = new ModalBuilder().setCustomId(`modal_kick_${playerId}`).setTitle('Kick Player');
  const input = new TextInputBuilder()
    .setCustomId('kick_reason').setLabel('Reason (optional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Rule violation, etc.')
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildTeleportModal(steamId) {
  const modal = new ModalBuilder().setCustomId(`modal_gl_teleport_${steamId}`).setTitle('Teleport Player');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tp_x').setLabel('X Coordinate').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tp_y').setLabel('Y Coordinate').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tp_z').setLabel('Z Coordinate (height, optional)').setStyle(TextInputStyle.Short).setRequired(false)),
  );
  return modal;
}

function buildSpawnItemModal(steamId) {
  const modal = new ModalBuilder().setCustomId(`modal_gl_spawn_${steamId}`).setTitle('Spawn Item');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_class').setLabel('Item Class Name').setStyle(TextInputStyle.Short).setPlaceholder('e.g. Hatchet, AKM, BandageDressing').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_qty').setLabel('Quantity (default: 1, max: 100)').setStyle(TextInputStyle.Short).setRequired(false)),
  );
  return modal;
}

function buildMessagePlayerModal(steamId) {
  const modal = new ModalBuilder().setCustomId(`modal_gl_message_${steamId}`).setTitle('Message Player');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('msg_text').setLabel('Message').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter a message to send to this player').setMaxLength(256).setRequired(true)),
  );
  return modal;
}

function buildModInstallModal() {
  const modal = new ModalBuilder().setCustomId('modal_mod_install').setTitle('Install Mod');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mod_workshopid').setLabel('Workshop ID').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mod_name').setLabel('Mod Name').setStyle(TextInputStyle.Short).setRequired(true)),
  );
  return modal;
}

function buildModActionModal(customId, title) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const input = new TextInputBuilder().setCustomId('mod_workshopid').setLabel('Workshop ID').setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

module.exports = {
  buildControlPanel, buildServerButtons, buildPlayersButtons,
  buildModsButtons, buildIntelButtons, buildAdminActionButtons,
  buildRestartOptions, buildConfirmRow, buildPlayerSelectMenu,
  buildBroadcastModal, buildRconModal, buildPlayerInfoModal,
  buildKickModal, buildTeleportModal, buildSpawnItemModal,
  buildMessagePlayerModal, buildModInstallModal, buildModActionModal,
};
