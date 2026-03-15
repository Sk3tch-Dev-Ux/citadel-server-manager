/**
 * Citadel — Discord Bot Entry Point
 *
 * Slim router that delegates to modular command/handler files.
 * Features: slash commands, button panels, modals, cooldowns, input validation.
 */
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const CONFIG = require('./config');
const logger = require('./lib/logger');
const { panelAction } = require('./api');
const { commands, registerCommands } = require('./commands');
const { handleButton } = require('./handlers/buttons');
const { handleSelectMenu } = require('./handlers/selectMenus');
const { handleModal } = require('./handlers/modals');

// ─── Bot Client ──────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Ready (BUG FIX: Events.ClientReady, not 'clientReady') ──
client.once(Events.ClientReady, async () => {
  logger.info(`Logged in as ${client.user.tag}`);

  // Validate admin role on startup
  if (CONFIG.adminRoleId) {
    await validateAdminRole();
  }

  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'Citadel', type: 3 }],
  });
});

/**
 * Validate ADMIN_ROLE_ID format and existence.
 * Logs clear warnings if role doesn't exist.
 */
async function validateAdminRole() {
  try {
    // Validate format: Discord snowflakes are 17-20 digit numbers
    if (!/^\d{17,20}$/.test(CONFIG.adminRoleId)) {
      logger.error(`DISCORD_ADMIN_ROLE_ID invalid format: "${CONFIG.adminRoleId}". Must be a numeric Discord snowflake (17-20 digits).`);
      logger.error('Admin commands will be disabled.');
      return;
    }

    // Try to fetch the role from the guild
    if (!CONFIG.guildId) {
      logger.warn('DISCORD_GUILD_ID not set. Skipping admin role verification.');
      return;
    }

    try {
      const guild = await client.guilds.fetch(CONFIG.guildId);
      if (!guild) {
        logger.error(`Guild not found: ${CONFIG.guildId}. Admin role verification failed.`);
        return;
      }

      const role = await guild.roles.fetch(CONFIG.adminRoleId);
      if (!role) {
        logger.error(`Admin role not found in guild: ${CONFIG.adminRoleId}`);
        logger.error(`Available roles in ${guild.name}:`);
        const roles = await guild.roles.fetch();
        roles.forEach(r => {
          if (!r.managed) {
            logger.error(`  - ${r.name} (${r.id})`);
          }
        });
        logger.error('Admin commands will be disabled until role is created or DISCORD_ADMIN_ROLE_ID is updated.');
        return;
      }

      logger.info(`Admin role verified: ${role.name} (${role.id})`);
    } catch (err) {
      logger.error(`Failed to verify admin role: ${err.message}`);
      logger.error('Admin commands may not work correctly.');
    }
  } catch (err) {
    logger.error(`Unexpected error during admin role validation: ${err.message}`);
  }
}

client.on('error', (err) => {
  logger.error({ err: err.message }, 'Client error');
});

// ─── Interaction Router ──────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
      return;
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Interaction error');
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Error processing interaction. Check logs.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.editReply({ content: 'Error processing interaction. Check logs.' });
      }
    } catch (err2) {
      logger.error({ err: err2.message }, 'Failed to send error reply');
    }
  }
});

// ─── Multi-Server Presence Rotation ─────────────────────
setInterval(async () => {
  try {
    const serversList = await panelAction('servers');
    const servers = serversList.servers || [];
    if (servers.length === 0) return;

    // Sum players across all running servers
    let totalPlayers = 0;
    let totalMax = 0;
    let runningCount = 0;

    for (const srv of servers) {
      const data = await panelAction('status', { serverId: srv.id });
      if (data.status === 'running') {
        runningCount++;
        totalPlayers += data.playerCount || 0;
        totalMax += data.maxPlayers || 0;
      }
    }

    const statusText = runningCount > 0
      ? `${totalPlayers}/${totalMax} players | ${runningCount} server${runningCount > 1 ? 's' : ''}`
      : 'All servers offline';

    client.user.setPresence({
      status: runningCount > 0 ? 'online' : 'idle',
      activities: [{ name: statusText, type: 3 }],
    });
  } catch { /* ignore */ }
}, 60_000);

// ─── Start ───────────────────────────────────────────────
async function main() {
  if (!CONFIG.token) {
    logger.error('DISCORD_BOT_TOKEN is required. Set it in .env');
    logger.info('\nTo set up the Discord bot:');
    logger.info('1. Go to https://discord.com/developers/applications');
    logger.info('2. Create a New Application');
    logger.info('3. Go to Bot > Add Bot > Copy Token');
    logger.info('4. Go to OAuth2 > URL Generator');
    logger.info('5. Select: bot, applications.commands');
    logger.info('6. Select permissions: Send Messages, Embed Links, Use Slash Commands');
    logger.info('7. Copy the generated URL and invite the bot to your server');
    logger.info('8. Set DISCORD_BOT_TOKEN in your .env file\n');
    process.exit(1);
  }

  await registerCommands(CONFIG.token, CONFIG.clientId, CONFIG.guildId);
  await client.login(CONFIG.token);
}

main().catch((err) => logger.error({ err: err.message }, 'Bot startup failed'));

// ─── Graceful Shutdown ───────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down bot gracefully...`);
  client.destroy();
  logger.info('Discord client destroyed');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
