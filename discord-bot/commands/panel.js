const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { buildStatusEmbed } = require('../ui/embeds');
const { buildControlPanel } = require('../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the DayZ server control panel'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = interaction.guildId;

    const data = await panelAction('status', {}, guildId, interaction);
    if (data.error) {
      return await interaction.editReply({ content: `Error: ${data.error}` });
    }

    const serversList = await panelAction('servers', {}, guildId, interaction);
    const embed = buildStatusEmbed(data);
    embed.setDescription('Use the buttons and dropdown below to manage the server.');

    await interaction.channel.send({ embeds: [embed], components: buildControlPanel(serversList.servers) });
    await interaction.editReply({ content: 'Control panel deployed.' });
  },
};
