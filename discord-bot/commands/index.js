/**
 * Command auto-loader and registrar.
 */
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = new Map();

// Auto-load all command files in this directory
const commandFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'index.js');
for (const file of commandFiles) {
  const cmd = require(path.join(__dirname, file));
  if (cmd.data && cmd.execute) {
    commands.set(cmd.data.name, cmd);
  } else {
    console.warn(`[commands] Skipping ${file} — missing 'data' or 'execute'`);
  }
}

async function registerCommands(token, clientId, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);
  const body = Array.from(commands.values()).map(c => c.data.toJSON());
  console.log(`Registering ${body.length} slash commands...`);
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
    }
    console.log('Slash commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

module.exports = { commands, registerCommands };
