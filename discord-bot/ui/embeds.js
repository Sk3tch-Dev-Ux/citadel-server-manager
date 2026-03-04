/**
 * Discord embed builders for all bot responses.
 */
const { EmbedBuilder } = require('discord.js');
const COLORS = require('./colors');
const { formatPlaytime, formatUptime, progressBar, statusIndicator } = require('../utils/formatting');
const { escapeMarkdown } = require('../utils/sanitize');

function buildStatusEmbed(data) {
  const status = data.status || 'unknown';
  const statusUpper = status.toUpperCase();
  const cpu = data.cpu || 0;
  const ram = data.ram || 0;
  const ramMB = data.ramMB || 0;
  const fps = data.fps || 0;
  const playerCount = data.playerCount || 0;
  const maxPlayers = data.maxPlayers || 60;
  const playerPct = maxPlayers > 0 ? Math.round((playerCount / maxPlayers) * 100) : 0;

  const embed = new EmbedBuilder()
    .setTitle(`${statusIndicator(status)}  ${data.serverName || 'DayZ Server'}`)
    .setColor(COLORS[status] || 0x808080)
    .setTimestamp();

  const fields = [
    { name: '📡 Status', value: `\`${statusUpper}\``, inline: true },
    { name: '👥 Players', value: `\`${playerCount} / ${maxPlayers}\``, inline: true },
    { name: '⏱️ Uptime', value: `\`${formatUptime(data.startedAt)}\``, inline: true },
  ];

  if (status === 'running') {
    fields.push(
      { name: '🖥️ CPU', value: `${progressBar(cpu)} \`${cpu.toFixed(1)}%\``, inline: true },
      { name: '💾 RAM', value: `${progressBar(ram)} \`${ram.toFixed(1)}%\` (${ramMB > 1024 ? (ramMB / 1024).toFixed(1) + ' GB' : ramMB + ' MB'})`, inline: true },
      { name: '📊 FPS', value: `\`${fps.toFixed(1)}\``, inline: true },
    );
  }

  const mapName = (data.map || 'unknown').replace('plus', '+').replace(/^\w/, c => c.toUpperCase());
  fields.push(
    { name: '🗺️ Map', value: `\`${mapName}\``, inline: true },
    { name: '🔌 Connect', value: `\`${data.ip || '0.0.0.0'}:${data.gamePort || 2302}\``, inline: true },
    { name: '🧩 Mods', value: `\`${data.modCount || 0} installed\``, inline: true },
  );

  if (status === 'running' && maxPlayers > 0) {
    embed.setDescription(`**Player Capacity** ${progressBar(playerPct, 20)} \`${playerPct}%\``);
  }

  embed.addFields(fields);
  embed.setFooter({ text: `Citadel${data.serverId ? ' • ' + data.serverId.slice(0, 8) : ''}` });
  return embed;
}

function buildPlayerListEmbed(players) {
  const embed = new EmbedBuilder()
    .setTitle('Online Players')
    .setColor(COLORS.players)
    .setFooter({ text: `${players.length} player(s) online` })
    .setTimestamp();

  if (players.length === 0) {
    embed.setDescription('*No players currently online*');
  } else {
    const hasCftools = players.some(p => p.source === 'cftools' || p.source === 'inhouse');
    const list = players.map((p, i) => {
      const idx = `\`${String(i + 1).padStart(2)}\``;
      const name = `**${escapeMarkdown(p.name)}**`;
      const ping = `${p.ping || '?'}ms`;
      if (hasCftools) {
        const banWarning = (p.bans && p.bans.count > 0) ? ' :warning:' : '';
        return `${idx} ${name} — ${ping}${banWarning}`;
      }
      return `${idx} ${name} — ${ping}`;
    }).join('\n');
    embed.setDescription(list.slice(0, 4000));
    if (hasCftools) {
      const withBans = players.filter(p => p.bans && p.bans.count > 0).length;
      if (withBans > 0) {
        embed.addFields({ name: 'Flagged Players', value: `${withBans} player(s) with previous bans`, inline: false });
      }
    }
  }
  return embed;
}

function buildLeaderboardEmbed(entries) {
  const embed = new EmbedBuilder()
    .setTitle('Leaderboard')
    .setColor(COLORS.intel)
    .setTimestamp();

  if (!entries || entries.length === 0) {
    embed.setDescription('*No leaderboard data*');
  } else {
    const hasCftools = entries.some(e => e.kdratio != null || e.playtime != null);
    if (hasCftools) {
      const list = entries.map((s, i) => {
        const rank = `\`${String(i + 1).padStart(2)}\``;
        const kd = s.kdratio != null ? ` | K/D: ${s.kdratio.toFixed(2)}` : '';
        const pt = s.playtime ? ` | ${formatPlaytime(s.playtime)}` : '';
        return `${rank} **${escapeMarkdown(s.player)}** — ${s.kills}K / ${s.deaths}D${kd}${pt}`;
      }).join('\n');
      embed.setDescription(list.slice(0, 4000));
    } else {
      const list = entries.map((s, i) =>
        `\`${String(i + 1).padStart(2)}\` **${escapeMarkdown(s.player)}** — ${s.score} pts`
      ).join('\n');
      embed.setDescription(list.slice(0, 4000));
    }
  }
  return embed;
}

function buildPlayerInfoEmbed(data) {
  const embed = new EmbedBuilder()
    .setTitle(`Player: ${(data.names && data.names[0]) || 'Unknown'}`)
    .setColor(COLORS.info)
    .setTimestamp();

  if (data.error) {
    embed.setDescription(`Error: ${data.error}`);
    return embed;
  }

  const fields = [];
  if (data.names && data.names.length > 1) fields.push({ name: 'Known Names', value: data.names.slice(0, 5).join(', '), inline: false });
  fields.push({ name: 'Kills', value: `\`${data.kills || 0}\``, inline: true });
  fields.push({ name: 'Deaths', value: `\`${data.deaths || 0}\``, inline: true });
  fields.push({ name: 'K/D Ratio', value: `\`${(data.kdratio || 0).toFixed(2)}\``, inline: true });
  if (data.longestKill) fields.push({ name: 'Longest Kill', value: `\`${data.longestKill}m\``, inline: true });
  if (data.longestShot) fields.push({ name: 'Longest Shot', value: `\`${data.longestShot}m\``, inline: true });
  if (data.playtime) fields.push({ name: 'Playtime', value: `\`${formatPlaytime(data.playtime)}\``, inline: true });
  if (data.sessions) fields.push({ name: 'Sessions', value: `\`${data.sessions}\``, inline: true });

  embed.addFields(fields);
  return embed;
}

/** Standardized error embed */
function buildErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(COLORS.error)
    .setDescription(description)
    .setTimestamp();
}

/** Standardized success embed */
function buildSuccessEmbed(title, description, footer) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(COLORS.success)
    .setDescription(description)
    .setTimestamp();
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

module.exports = {
  buildStatusEmbed,
  buildPlayerListEmbed,
  buildLeaderboardEmbed,
  buildPlayerInfoEmbed,
  buildErrorEmbed,
  buildSuccessEmbed,
};
