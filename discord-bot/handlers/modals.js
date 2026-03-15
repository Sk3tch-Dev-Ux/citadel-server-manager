/**
 * Modal submission handlers.
 */
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { panelAction } = require('../api');
const { setCooldown } = require('../utils/cooldowns');
const { sanitizeBroadcast, isValidSteam64, isValidCoordinate, isValidWorkshopId } = require('../utils/sanitize');
const COLORS = require('../ui/colors');
const { buildSuccessEmbed, buildErrorEmbed, buildPlayerInfoEmbed } = require('../ui/embeds');

async function handleModal(interaction) {
  const modalId = interaction.customId;
  const guildId = interaction.guildId;

  // All modal handlers defer first (API calls take time)
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // ── Broadcast ──
  if (modalId === 'modal_broadcast') {
    const raw = interaction.fields.getTextInputValue('broadcast_text');
    const message = sanitizeBroadcast(raw);
    if (!message) return await interaction.editReply({ embeds: [buildErrorEmbed('Broadcast Failed', 'Message is empty.')] });

    const result = await panelAction('message', { message }, guildId, interaction);
    if (result.error) return await interaction.editReply({ embeds: [buildErrorEmbed('Broadcast Failed', result.error)] });

    setCooldown(interaction.user.id, 'panel_message');
    await interaction.editReply({ embeds: [buildSuccessEmbed('Message Broadcast', `\`\`\`${message}\`\`\``, `Sent by ${interaction.user.tag}`)] });
    return;
  }

  // ── RCON ──
  if (modalId === 'modal_rcon') {
    const command = interaction.fields.getTextInputValue('rcon_command');
    if (!command.trim()) return await interaction.editReply({ embeds: [buildErrorEmbed('RCON', 'Command is empty.')] });

    const result = await panelAction('rcon', { command }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_rcon');
    const embed = new EmbedBuilder()
      .setTitle('RCON').setColor(COLORS.info)
      .addFields(
        { name: 'Command', value: `\`${command}\`` },
        { name: 'Response', value: `\`\`\`${result.result || result.error || 'Done'}\`\`\`` }
      ).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Kick ──
  if (modalId.startsWith('modal_kick_')) {
    const playerId = modalId.replace('modal_kick_', '');
    const reason = interaction.fields.getTextInputValue('kick_reason') || 'Kicked via Discord';
    const result = await panelAction('kick', { playerId, reason }, guildId, interaction);

    setCooldown(interaction.user.id, 'panel_kick_menu');
    const embed = new EmbedBuilder()
      .setTitle('Player Kicked').setColor(COLORS.error)
      .addFields({ name: 'Player', value: playerId }, { name: 'Reason', value: reason })
      .setFooter({ text: `Kicked by ${interaction.user.tag}` }).setTimestamp();
    if (result.error) embed.addFields({ name: 'Error', value: result.error });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Player Info ──
  if (modalId === 'modal_player_info') {
    const steamId = interaction.fields.getTextInputValue('player_steamid').trim();
    if (!isValidSteam64(steamId)) {
      return await interaction.editReply({ embeds: [buildErrorEmbed('Invalid Input', 'Steam64 ID must be a 17-digit number starting with 7656119.')] });
    }
    const data = await panelAction('playerInfo', { steamId }, guildId, interaction);
    const embed = buildPlayerInfoEmbed(data);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Teleport ──
  if (modalId.startsWith('modal_gl_teleport_')) {
    const steamId = modalId.replace('modal_gl_teleport_', '');
    const xRaw = interaction.fields.getTextInputValue('tp_x');
    const yRaw = interaction.fields.getTextInputValue('tp_y');
    const zRaw = interaction.fields.getTextInputValue('tp_z') || '0';

    if (!isValidCoordinate(xRaw) || !isValidCoordinate(yRaw) || !isValidCoordinate(zRaw)) {
      return await interaction.editReply({ embeds: [buildErrorEmbed('Invalid Input', 'Coordinates must be valid numbers.')] });
    }

    const result = await panelAction('actionTeleport', {
      steamId, x: parseFloat(xRaw), y: parseFloat(yRaw), z: parseFloat(zRaw),
    }, guildId, interaction);

    setCooldown(interaction.user.id, 'panel_gl_teleport');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Teleport')
      .setColor(result.error ? COLORS.error : COLORS.info)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Spawn Item ──
  if (modalId.startsWith('modal_gl_spawn_')) {
    const steamId = modalId.replace('modal_gl_spawn_', '');
    const itemClass = interaction.fields.getTextInputValue('item_class').trim();
    const qtyRaw = interaction.fields.getTextInputValue('item_qty');
    const quantity = Math.min(Math.max(parseInt(qtyRaw) || 1, 1), 100);

    if (!itemClass) return await interaction.editReply({ embeds: [buildErrorEmbed('Invalid Input', 'Item class name is required.')] });

    const result = await panelAction('actionSpawnItem', { steamId, itemClass, quantity }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_gl_spawn');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Spawn Item')
      .setColor(result.error ? COLORS.error : COLORS.success)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Action completed'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Message Player ──
  if (modalId.startsWith('modal_gl_message_')) {
    const steamId = modalId.replace('modal_gl_message_', '');
    const raw = interaction.fields.getTextInputValue('msg_text');
    const message = sanitizeBroadcast(raw);
    if (!message) return await interaction.editReply({ embeds: [buildErrorEmbed('Message Failed', 'Message is empty.')] });

    const result = await panelAction('actionMessage', { steamId, message }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_gl_message');
    const embed = new EmbedBuilder()
      .setTitle('Admin: Message Player')
      .setColor(result.error ? COLORS.error : COLORS.success)
      .setDescription(result.error ? `Error: ${result.error}` : (result.message || 'Message sent'))
      .setFooter({ text: `By ${interaction.user.tag}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Mod Install ──
  if (modalId === 'modal_mod_install') {
    const workshopId = interaction.fields.getTextInputValue('mod_workshopid').trim();
    const name = interaction.fields.getTextInputValue('mod_name').trim();

    if (!isValidWorkshopId(workshopId)) {
      return await interaction.editReply({ embeds: [buildErrorEmbed('Invalid Input', 'Workshop ID must be a numeric string.')] });
    }
    if (!name) return await interaction.editReply({ embeds: [buildErrorEmbed('Invalid Input', 'Mod name is required.')] });

    const result = await panelAction('modInstall', { workshopId, name }, guildId, interaction);
    setCooldown(interaction.user.id, 'panel_mod_install');
    await interaction.editReply({
      content: result.error ? `Error: ${result.error}` : `Mod **${name}** (${workshopId}) install started.`,
    });
    return;
  }

  // ── Mod Uninstall / Enable / Disable ──
  if (['modal_mod_uninstall', 'modal_mod_enable', 'modal_mod_disable'].includes(modalId)) {
    const workshopId = interaction.fields.getTextInputValue('mod_workshopid').trim();
    if (!isValidWorkshopId(workshopId)) {
      return await interaction.editReply({ embeds: [buildErrorEmbed('Invalid Input', 'Workshop ID must be a numeric string.')] });
    }

    const actionMap = {
      modal_mod_uninstall: 'modUninstall',
      modal_mod_enable: 'modEnable',
      modal_mod_disable: 'modDisable',
    };
    const verbMap = {
      modal_mod_uninstall: 'uninstalled',
      modal_mod_enable: 'enabled',
      modal_mod_disable: 'disabled',
    };

    const result = await panelAction(actionMap[modalId], { workshopId }, guildId, interaction);
    setCooldown(interaction.user.id, modalId.replace('modal_', 'panel_'));
    await interaction.editReply({
      content: result.error ? `Error: ${result.error}` : `Mod ${workshopId} ${verbMap[modalId]}.`,
    });
    return;
  }

  // Fallback for unknown modal IDs
  console.warn(`[modals] No handler for modalId: ${modalId}`);
  await interaction.editReply({ content: 'This action is not available.' });
}

module.exports = { handleModal };
