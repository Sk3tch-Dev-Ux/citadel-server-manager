const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { checkCooldown, setCooldown } = require('../utils/cooldowns');
const { buildPlayerInfoEmbed, buildErrorEmbed } = require('../ui/embeds');
const { isValidSteam64 } = require('../utils/sanitize');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playerinfo')
    .setDescription('View detailed player stats')
    .addStringOption(opt =>
      opt.setName('steamid').setDescription('Player Steam64 ID').setRequired(true)
    ),

  async execute(interaction) {
    const remaining = checkCooldown(interaction.user.id, 'playerinfo');
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const data = await panelAction('playerInfo', { steamId }, interaction.guildId, interaction);
    const embed = buildPlayerInfoEmbed(data);
    setCooldown(interaction.user.id, 'playerinfo');
    await interaction.editReply({ embeds: [embed] });
  },
};
