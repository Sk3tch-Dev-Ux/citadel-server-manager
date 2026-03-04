const { SlashCommandBuilder } = require('discord.js');
const { panelAction } = require('../api');
const { buildPlayerListEmbed } = require('../ui/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('players')
    .setDescription('View online players'),

  async execute(interaction) {
    await interaction.deferReply();
    const data = await panelAction('players', {}, interaction.guildId, interaction);
    const embed = buildPlayerListEmbed(data.players || []);
    await interaction.editReply({ embeds: [embed] });
  },
};
