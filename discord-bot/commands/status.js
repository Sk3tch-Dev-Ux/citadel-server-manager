const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { checkCooldown, setCooldown } = require('../utils/cooldowns');
const { buildStatusEmbed } = require('../ui/embeds');
const { escapeMarkdown } = require('../utils/sanitize');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Quick server status check'),

  async execute(interaction) {
    const remaining = checkCooldown(interaction.user.id, 'status');
    if (remaining > 0) {
      return await interaction.reply({ content: `Please wait **${remaining}s** before using this again.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();
    const data = await panelAction('status', {}, interaction.guildId, interaction);
    const embed = buildStatusEmbed(data);

    if (data.players && data.players.length > 0) {
      const playerList = data.players.map(p => escapeMarkdown(p.name)).join('\n');
      embed.addFields({ name: 'Online Players', value: playerList.slice(0, 1024) });
    }

    setCooldown(interaction.user.id, 'status');
    await interaction.editReply({ embeds: [embed] });
  },
};
