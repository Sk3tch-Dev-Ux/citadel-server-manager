const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { checkCooldown, setCooldown } = require('../utils/cooldowns');
const { buildPlayerListEmbed } = require('../ui/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('players')
    .setDescription('View online players'),

  async execute(interaction) {
    const remaining = checkCooldown(interaction.user.id, 'players');
    if (remaining > 0) {
      return await interaction.reply({ content: `Please wait **${remaining}s** before using this again.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();
    const data = await panelAction('players', {}, interaction.guildId, interaction);
    const embed = buildPlayerListEmbed(data.players || []);
    setCooldown(interaction.user.id, 'players');
    await interaction.editReply({ embeds: [embed] });
  },
};
