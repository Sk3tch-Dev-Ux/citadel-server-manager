const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { panelAction, safeReply } = require('../api');
const { isAdmin } = require('../utils/permissions');
const { checkCooldown, setCooldown } = require('../utils/cooldowns');
const { buildRestartOptions } = require('../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart the server with optional countdown')
    .addIntegerOption(opt =>
      opt.setName('countdown').setDescription('Countdown in seconds before restart').setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return await interaction.reply({ content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    }

    const remaining = checkCooldown(interaction.user.id, 'restart');
    if (remaining > 0) {
      return await interaction.reply({ content: `Please wait **${remaining}s** before using this again.`, flags: MessageFlags.Ephemeral });
    }

    const countdown = interaction.options.getInteger('countdown');
    if (countdown) {
      await interaction.deferReply();
      await panelAction('restart', { countdown }, interaction.guildId, interaction);
      setCooldown(interaction.user.id, 'restart');
      await interaction.editReply({ content: `Server restarting in **${countdown}** seconds. Players have been warned.` });
    } else {
      setCooldown(interaction.user.id, 'restart');
      await safeReply(interaction, {
        content: 'Choose a restart option:',
        components: [buildRestartOptions()],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
