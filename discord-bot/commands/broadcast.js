const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { isAdmin } = require('../utils/permissions');
const { sanitizeBroadcast } = require('../utils/sanitize');
const { buildSuccessEmbed, buildErrorEmbed } = require('../ui/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('Send a global message to all players')
    .addStringOption(opt =>
      opt.setName('message').setDescription('Message to broadcast').setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return await interaction.reply({ content: 'Admin role required.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();

    const raw = interaction.options.getString('message');
    const message = sanitizeBroadcast(raw);
    if (!message) {
      return await interaction.editReply({ embeds: [buildErrorEmbed('Broadcast Failed', 'Message is empty after sanitization.')] });
    }

    const result = await panelAction('message', { message }, interaction.guildId, interaction);
    if (result.error) {
      return await interaction.editReply({ embeds: [buildErrorEmbed('Broadcast Failed', result.error)] });
    }

    await interaction.editReply({
      embeds: [buildSuccessEmbed('Message Broadcast', `\`\`\`${message}\`\`\``, `Sent by ${interaction.user.tag}`)],
    });
  },
};
