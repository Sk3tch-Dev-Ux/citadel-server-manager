const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { isAdmin } = require('../utils/permissions');
const { checkCooldown, setCooldown } = require('../utils/cooldowns');
const { buildStatusEmbed } = require('../ui/embeds');
const { buildControlPanel } = require('../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the DayZ server control panel'),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return await interaction.reply({ content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    }
    const remaining = checkCooldown(interaction.user.id, 'panel_status');
    if (remaining > 0) {
      return await interaction.reply({ content: `Please wait **${remaining}s** before using this again.`, flags: MessageFlags.Ephemeral });
    }

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
    setCooldown(interaction.user.id, 'panel_status');
    await interaction.editReply({ content: 'Control panel deployed.' });
  },
};
