const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { isAdmin } = require('../utils/permissions');
const COLORS = require('../ui/colors');
const logger = require('../logger');

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

    // Validate command — Discord commands go through the same whitelist as web RCON
    // The panel API will validate again, but we can provide early feedback
    try {
      const result = await panelAction('rcon', { command }, interaction.guildId, interaction);

      // Check if the command was rejected by the panel (validation error)
      if (result.error && result.error.includes('not allowed')) {
        const embed = new EmbedBuilder()
          .setTitle('RCON Command Rejected')
          .setColor(COLORS.error)
          .addFields(
            { name: 'Command', value: `\`${command}\`` },
            { name: 'Reason', value: result.error }
          )
          .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle('RCON Command Executed')
        .setColor(COLORS.info)
        .addFields(
          { name: 'Command', value: `\`${command}\`` },
          { name: 'Response', value: `\`\`\`${result.result || result.error || 'Done'}\`\`\`` }
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, 'Discord RCON command failed');
      const embed = new EmbedBuilder()
        .setTitle('RCON Error')
        .setColor(COLORS.error)
        .addFields(
          { name: 'Command', value: `\`${command}\`` },
          { name: 'Error', value: err.message || 'Unknown error' }
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
