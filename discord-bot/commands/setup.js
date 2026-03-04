const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { isAdmin } = require('../utils/permissions');
const { buildStatusEmbed } = require('../ui/embeds');
const { buildControlPanel } = require('../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Create a persistent control panel in this channel'),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return await interaction.reply({ content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = interaction.guildId;

    const data = await panelAction('status', {}, guildId, interaction);
    const serversList = await panelAction('servers', {}, guildId, interaction);
    const embed = buildStatusEmbed(data);
    embed.setDescription(
      '**DayZ Server Control Panel**\n\n' +
      'Use the buttons below for quick actions, or select a category from the dropdown for more options.\n\n' +
      '`Status` Refresh  |  `Start` `Stop` `Restart` Server control\n' +
      '`Dropdown` Server, Players, Mods, Intel, Admin Actions categories'
    );

    await interaction.channel.send({ embeds: [embed], components: buildControlPanel(serversList.servers) });
    await interaction.editReply({ content: 'Control panel deployed.' });
  },
};
