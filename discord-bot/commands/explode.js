const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { isAdmin } = require('../utils/permissions');
const { isValidSteam64 } = require('../utils/sanitize');
const { buildErrorEmbed } = require('../ui/embeds');
const COLORS = require('../ui/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('explode')
    .setDescription('Explode a player (Admin Action)')
    .addStringOption(opt =>
      opt.setName('steamid').setDescription('Player Steam64 ID').setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return await interaction.reply({ content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    }

    const steamId = interaction.options.getString('steamid');
    if (!isValidSteam64(steamId)) {
      return await interaction.reply({
        embeds: [buildErrorEmbed('Invalid Input', 'Steam64 ID must be a 17-digit number starting with 7656119.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionExplode', { steamId }, interaction.guildId, interaction);
    const embed = new EmbedBuilder()
      .setTitle('Admin: Explode')
      .setColor(result.error ? COLORS.error : COLORS.error)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};
