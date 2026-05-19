/**
 * /help — DM the user a categorized reference of every Citadel slash command,
 * with examples for the ones that have non-obvious arguments.
 *
 * Why a DM and not an ephemeral reply: ephemeral replies disappear when the
 * user closes the Discord app or clicks elsewhere. A DM persists in the
 * user's message history, so they can scroll back to it next time they need
 * to remember which command does what. Falls back to ephemeral if DMs are
 * blocked (privacy setting + bot share no guild → DM channel fails).
 *
 * Audit N13 (2026-05-19).
 */
const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');

// Keep this in sync with the actual command files. The loader auto-discovers
// commands, but we hand-curate the help output so we control grouping +
// examples + which gotchas to surface.
const CATEGORIES = [
  {
    name: 'Server status',
    color: 0x3b82f6,
    commands: [
      { name: '/status',     desc: 'Quick server status (uptime, players, version).' },
      { name: '/players',    desc: 'List players currently online.' },
      { name: '/playerinfo', desc: 'Detailed info for a specific player by SteamID or name.' },
      { name: '/panel',      desc: 'Open the Citadel web panel (returns a deep-link).' },
    ],
  },
  {
    name: 'Player actions',
    color: 0xf59e0b,
    commands: [
      { name: '/kill',       desc: 'Kill a player. Audit-logged.' },
      { name: '/heal',       desc: 'Restore a player to full health.' },
      { name: '/freeze',     desc: 'Freeze / unfreeze a player in place.' },
      { name: '/explode',    desc: 'Detonate a player. (You\'re a server admin, you\'ve earned it.)' },
      { name: '/strip',      desc: 'Remove all of a player\'s gear.' },
      { name: '/teleport',   desc: 'Teleport a player to coordinates or another player.' },
      { name: '/unstuck',    desc: 'Teleport a player to safe ground when they fall through the map.' },
      { name: '/spawnitem',  desc: 'Spawn an item into a player\'s inventory or on the ground.' },
    ],
  },
  {
    name: 'Communication',
    color: 0x22c55e,
    commands: [
      { name: '/dm',        desc: 'Send a private in-game message to a single player.' },
      { name: '/broadcast', desc: 'Send a server-wide announcement visible to all players.' },
    ],
  },
  {
    name: 'Server control',
    color: 0xef4444,
    commands: [
      { name: '/restart',   desc: 'Restart the server. Sends configurable warnings first.' },
      {
        name: '/rcon',
        desc: 'Execute a **raw BattlEye RCON** command — not an in-game chat command.\n'
          + 'Examples: `#login <pwd>`, `#kick <steamid> <reason>`, `say -1 "<msg>"`.\n'
          + 'Use `/broadcast` for chat messages and `/kill` etc. for player actions; this is the escape hatch.',
      },
    ],
  },
  {
    name: 'Setup',
    color: 0xa78bfa,
    commands: [
      { name: '/setup',     desc: 'Pair this Discord guild with a Citadel server (admin-only).' },
    ],
  },
];

function buildHelpEmbeds() {
  return CATEGORIES.map(cat => {
    const lines = cat.commands.map(c => `**${c.name}** — ${c.desc}`).join('\n\n');
    return new EmbedBuilder()
      .setTitle(cat.name)
      .setColor(cat.color)
      .setDescription(lines);
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all Citadel commands with examples (DMed to you).'),

  async execute(interaction) {
    const embeds = buildHelpEmbeds();
    const intro = `Hi <@${interaction.user.id}> — here are the Citadel slash commands you can use in this guild.\n`
      + `Web panel: \`/panel\`.   Docs: <https://dayzexpansion.com>`;

    // Try to DM first — persists in the user's history so they can scroll back.
    try {
      const dm = await interaction.user.createDM();
      await dm.send({ content: intro, embeds });
      await interaction.reply({
        content: 'Sent the command reference to your DMs.',
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // DM failed (privacy block, no shared guild for some bots, etc.) — fall
      // back to an ephemeral reply.
      await interaction.reply({
        content: intro + '\n\n_(Couldn\'t DM you — showing here instead. Enable DMs from server members in your Discord privacy settings if you want this delivered next time.)_',
        embeds,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
