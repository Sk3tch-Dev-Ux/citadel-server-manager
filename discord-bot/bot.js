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
} = require('discord.js');
require('dotenv').config({ path: '../.env' });

// ─── Config ──────────────────────────────────────────────
const CONFIG = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID,
  apiUrl: process.env.PANEL_API_URL || 'http://localhost:3001',
  apiKey: process.env.DISCORD_BOT_API_KEY || 'bot-secret-key',
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
  if (!CONFIG.adminRoleId) return true; // No role configured = all users are admin
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
    new ButtonBuilder().setCustomId('panel_refresh').setLabel('🔃 Refresh').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
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

client.once('ready', () => {
  console.log(`🤖 Discord bot logged in as ${client.user.tag}`);
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'DayZ Server Panel', type: 3 }],
  });
});

// ─── Slash Command Handlers ──────────────────────────────
client.on('interactionCreate', async (interaction) => {
  // ── Slash Commands ──
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'panel') {
      const data = await panelAction('status');
      const embed = buildStatusEmbed(data);
      embed.setDescription(
        '**Server Control Panel**\nUse the buttons below to manage your DayZ server.\n\n' +
        '🟢 Green = Start  •  🔴 Red = Stop/Kick  •  🔵 Blue = Actions'
      );
      await interaction.reply({ embeds: [embed], components: buildControlPanel() });
    }

    else if (commandName === 'setup') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
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
      // Send as a regular message (not ephemeral) so it persists
      await interaction.reply({ content: '✅ Control panel deployed below.' , ephemeral: true });
      await interaction.channel.send({ embeds: [embed], components: buildControlPanel() });
    }

    else if (commandName === 'status') {
      const data = await panelAction('status');
      const embed = buildStatusEmbed(data);
      if (data.players && data.players.length > 0) {
        const playerList = data.players.map(p => `• ${p.name}`).join('\n');
        embed.addFields({ name: 'Online Players', value: playerList.slice(0, 1024) });
      }
      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'players') {
      const data = await panelAction('players');
      const embed = buildPlayerListEmbed(data.players || []);
      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'rcon') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
      const command = interaction.options.getString('command');
      const result = await panelAction('rcon', { command });
      const embed = new EmbedBuilder()
        .setTitle('🖥️ RCON Command')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Command', value: `\`${command}\`` },
          { name: 'Response', value: `\`\`\`${result.result || result.error || 'No response'}\`\`\`` }
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'broadcast') {
      const message = interaction.options.getString('message');
      await panelAction('message', { message });
      const embed = new EmbedBuilder()
        .setTitle('📢 Message Broadcast')
        .setColor(0x00ff6a)
        .setDescription(`Message sent to all players:\n\`\`\`${message}\`\`\``)
        .setFooter({ text: `Sent by ${interaction.user.tag}` })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'restart') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
      const countdown = interaction.options.getInteger('countdown');
      if (countdown) {
        const embed = new EmbedBuilder()
          .setTitle('🔄 Server Restart Scheduled')
          .setColor(0xffaa00)
          .setDescription(`Server will restart in **${countdown} seconds**.\nPlayers have been notified.`)
          .setTimestamp();
        await panelAction('restart', { countdown });
        await interaction.reply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setTitle('🔄 Restart Server?')
          .setColor(0xffaa00)
          .setDescription('Choose a restart option:');
        await interaction.reply({ embeds: [embed], components: [buildRestartOptions()], ephemeral: true });
      }
    }
  }

  // ── Button Interactions ──
  else if (interaction.isButton()) {
    const { customId } = interaction;

    // Panel buttons
    if (customId === 'panel_status' || customId === 'panel_refresh') {
      const data = await panelAction('status');
      const embed = buildStatusEmbed(data);
      embed.setDescription(
        '**Server Control Panel**\nUse the buttons below to manage your DayZ server.'
      );
      await interaction.update({ embeds: [embed], components: buildControlPanel() });
    }

    else if (customId === 'panel_start') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setTitle('▶️ Start Server?')
        .setColor(0x00ff6a)
        .setDescription('Are you sure you want to start the server?');
      await interaction.reply({ embeds: [embed], components: [buildConfirmRow('start')], ephemeral: true });
    }

    else if (customId === 'panel_stop') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setTitle('⏹️ Stop Server?')
        .setColor(0xff3333)
        .setDescription('⚠️ This will disconnect all players. Are you sure?');
      await interaction.reply({ embeds: [embed], components: [buildConfirmRow('stop')], ephemeral: true });
    }

    else if (customId === 'panel_restart') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setTitle('🔄 Restart Server')
        .setColor(0xffaa00)
        .setDescription('Choose a restart option:');
      await interaction.reply({ embeds: [embed], components: [buildRestartOptions()], ephemeral: true });
    }

    else if (customId === 'panel_players') {
      const data = await panelAction('players');
      const embed = buildPlayerListEmbed(data.players || []);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (customId === 'panel_lock') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
      await panelAction('lock');
      const embed = new EmbedBuilder()
        .setTitle('🔒 Server Locked')
        .setColor(0xffaa00)
        .setDescription('No new players can join.')
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    else if (customId === 'panel_unlock') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
      await panelAction('unlock');
      const embed = new EmbedBuilder()
        .setTitle('🔓 Server Unlocked')
        .setColor(0x00ff6a)
        .setDescription('Players can now join.')
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    else if (customId === 'panel_message') {
      const modal = new ModalBuilder()
        .setCustomId('modal_broadcast')
        .setTitle('📢 Broadcast Message');
      const input = new TextInputBuilder()
        .setCustomId('broadcast_text')
        .setLabel('Message to all players')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Type your announcement here...')
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    }

    else if (customId === 'panel_kick_menu') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
      const data = await panelAction('players');
      const players = data.players || [];
      if (players.length === 0) {
        return interaction.reply({ content: 'No players online to kick.', ephemeral: true });
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
      await interaction.reply({
        content: '👢 Select a player to kick:',
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
      });
    }

    else if (customId === 'panel_rcon') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Admin role required.', ephemeral: true });
      }
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

    // Confirm actions
    else if (customId === 'confirm_start') {
      await panelAction('start');
      const embed = new EmbedBuilder()
        .setTitle('🟡 Server Starting...')
        .setColor(0xffaa00)
        .setDescription('The server is booting up. This may take a minute.')
        .setFooter({ text: `Started by ${interaction.user.tag}` })
        .setTimestamp();
      await interaction.update({ embeds: [embed], components: [] });
    }

    else if (customId === 'confirm_stop') {
      await panelAction('stop');
      const embed = new EmbedBuilder()
        .setTitle('🟡 Server Stopping...')
        .setColor(0xffaa00)
        .setDescription('Shutting down gracefully...')
        .setFooter({ text: `Stopped by ${interaction.user.tag}` })
        .setTimestamp();
      await interaction.update({ embeds: [embed], components: [] });
    }

    else if (customId === 'confirm_cancel') {
      await interaction.update({ content: '❌ Action cancelled.', embeds: [], components: [] });
    }

    // Restart options
    else if (customId === 'restart_now') {
      await panelAction('restart');
      const embed = new EmbedBuilder()
        .setTitle('🔄 Restarting Now')
        .setColor(0xffaa00)
        .setFooter({ text: `Restarted by ${interaction.user.tag}` })
        .setTimestamp();
      await interaction.update({ embeds: [embed], components: [] });
    }

    else if (customId === 'restart_60') {
      await panelAction('restart', { countdown: 60 });
      const embed = new EmbedBuilder()
        .setTitle('🔄 Restart in 60 Seconds')
        .setColor(0xffaa00)
        .setDescription('Players have been warned.')
        .setTimestamp();
      await interaction.update({ embeds: [embed], components: [] });
    }

    else if (customId === 'restart_300') {
      await panelAction('restart', { countdown: 300 });
      const embed = new EmbedBuilder()
        .setTitle('🔄 Restart in 5 Minutes')
        .setColor(0xffaa00)
        .setDescription('Players have been warned.')
        .setTimestamp();
      await interaction.update({ embeds: [embed], components: [] });
    }

    else if (customId === 'restart_cancel') {
      await interaction.update({ content: '❌ Restart cancelled.', embeds: [], components: [] });
    }
  }

  // ── Select Menu Interactions ──
  else if (interaction.isStringSelectMenu()) {
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
  else if (interaction.isModalSubmit()) {
    if (interaction.customId === 'modal_broadcast') {
      const message = interaction.fields.getTextInputValue('broadcast_text');
      await panelAction('message', { message });
      const embed = new EmbedBuilder()
        .setTitle('📢 Message Broadcast')
        .setColor(0x00ff6a)
        .setDescription(`\`\`\`${message}\`\`\``)
        .setFooter({ text: `Sent by ${interaction.user.tag}` })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
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
      await interaction.reply({ embeds: [embed], ephemeral: true });
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
      await interaction.reply({ embeds: [embed] });
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
