const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { isAdmin } = require('../utils/permissions');
const { checkCooldown, setCooldown } = require('../utils/cooldowns');
const { isValidSteam64 } = require('../utils/sanitize');
const { buildErrorEmbed } = require('../ui/embeds');
const COLORS = require('../ui/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('freeze')
    .setDescription('Freeze or unfreeze a player (Admin Action)')
    .addStringOption(opt =>
      opt.setName('steamid').setDescription('Player Steam64 ID').setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('unfreeze').setDescription('Set to true to unfreeze the player').setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return await interaction.reply({ content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    }

    const remaining = checkCooldown(interaction.user.id, 'freeze');
    if (remaining > 0) {
      return await interaction.reply({ content: `Please wait **${remaining}s** before using this again.`, flags: MessageFlags.Ephemeral });
    }

    const steamId = interaction.options.getString('steamid');
    if (!isValidSteam64(steamId)) {
      return await interaction.reply({
        embeds: [buildErrorEmbed('Invalid Input', 'Steam64 ID must be a 17-digit number starting with 7656119.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const unfreeze = interaction.options.getBoolean('unfreeze') || false;
    const frozen = unfreeze ? 0 : 1;
    const label = unfreeze ? 'Unfreeze' : 'Freeze';

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionFreeze', { steamId, frozen }, interaction.guildId, interaction);
    const embed = new EmbedBuilder()
      .setTitle(`Admin: ${label}`)
      .setColor(result.error ? COLORS.error : COLORS.warning)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` })
      .setTimestamp();
    setCooldown(interaction.user.id, 'freeze', 'admin');
    await interaction.editReply({ embeds: [embed] });
  },
};
