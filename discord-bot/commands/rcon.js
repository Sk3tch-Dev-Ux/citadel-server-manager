const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { isAdmin } = require('../utils/permissions');
const COLORS = require('../ui/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rcon')
    .setDescription('Send an RCON command to the server')
    .addStringOption(opt =>
      opt.setName('command').setDescription('The RCON command to execute').setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return await interaction.reply({ content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const command = interaction.options.getString('command');
    const result = await panelAction('rcon', { command }, interaction.guildId, interaction);

    const embed = new EmbedBuilder()
      .setTitle('RCON')
      .setColor(COLORS.info)
      .addFields(
        { name: 'Command', value: `\`${command}\`` },
        { name: 'Response', value: `\`\`\`${result.result || result.error || 'Done'}\`\`\`` }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};
