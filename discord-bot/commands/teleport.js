const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { isAdmin } = require('../utils/permissions');
const { checkCooldown, setCooldown } = require('../utils/cooldowns');
const { isValidSteam64, isValidCoordinate } = require('../utils/sanitize');
const { buildErrorEmbed } = require('../ui/embeds');
const COLORS = require('../ui/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teleport')
    .setDescription('Teleport a player (Admin Action)')
    .addStringOption(opt => opt.setName('steamid').setDescription('Player Steam64 ID').setRequired(true))
    .addNumberOption(opt => opt.setName('x').setDescription('X coordinate').setRequired(true))
    .addNumberOption(opt => opt.setName('y').setDescription('Y coordinate').setRequired(true))
    .addNumberOption(opt => opt.setName('z').setDescription('Z coordinate (height)').setRequired(false)),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return await interaction.reply({ content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    }

    const remaining = checkCooldown(interaction.user.id, 'teleport');
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

    const x = interaction.options.getNumber('x');
    const y = interaction.options.getNumber('y');
    const z = interaction.options.getNumber('z') || 0;

    if (!isValidCoordinate(x) || !isValidCoordinate(y)) {
      return await interaction.reply({
        embeds: [buildErrorEmbed('Invalid Input', 'Coordinates must be valid numbers.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await panelAction('actionTeleport', { steamId, x, y, z }, interaction.guildId, interaction);
    const embed = new EmbedBuilder()
      .setTitle('Admin: Teleport')
      .setColor(result.error ? COLORS.error : COLORS.info)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` })
      .setTimestamp();
    setCooldown(interaction.user.id, 'teleport');
    await interaction.editReply({ embeds: [embed] });
  },
};
