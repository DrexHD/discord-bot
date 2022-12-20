const { getModFileChangelog } = require('./api/curseforge');
const logger = require('./logger');
const getJSONResponse = require('./api/getJSONResponse');
const { listProjectVersions } = require('./api/modrinth');
const { TrackedProjects, Guilds } = require('./database/models');
const { EmbedBuilder, codeBlock, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dayjs = require('dayjs');
module.exports = {
  /**
   * Handles sending update notifications to the appropriate guild channels where a project is tracked
   * @param {*} requestedProject - The project's API data
   * @param {*} dbProject - The project's database data
   */
  async sendUpdateEmbed(requestedProject, dbProject, client) {
    let versionData;

    // Behavior is slightly different depending on platform, mostly dependent on the data returned from the initial earlier API call
    switch (dbProject.platform) {
      case 'curseforge': {
        // Call the CurseForge API to get this file's changelog
        const response = await getModFileChangelog(requestedProject.id, requestedProject.latestFiles[requestedProject.latestFiles.length - 1].id);
        if (!response) return logger.warn("A request to CurseForge timed out while getting a project file's changelog");
        if (response.statusCode !== 200) return logger.warn(`Unexpected ${response.statusCode} status code while getting a project files's changelog.`);

        const rawData = await getJSONResponse(response.body);
        versionData = {
          changelog: rawData.data,
          date: requestedProject.latestFiles[requestedProject.latestFiles.length - 1].fileDate,
          iconURL: requestedProject.logo.url,
          name: requestedProject.latestFiles[requestedProject.latestFiles.length - 1].displayName,
          number: requestedProject.latestFiles[requestedProject.latestFiles.length - 1].fileName,
          type: capitalize(releaseTypeToString(requestedProject.latestFiles[requestedProject.latestFiles.length - 1].releaseType)),
          url: `https://www.curseforge.com/minecraft/${classIdToUrlString(requestedProject.classId)}/${requestedProject.slug}/files/${
            requestedProject.latestFilesIndexes[0].fileId
          }`,
        };

        logger.debug(versionData);

        break;
      }
      case 'modrinth': {
        // Call the Modrinth API to get this version's information
        const response = await listProjectVersions(requestedProject.id);
        if (!response) return logger.warn("A request to Modrinth timed out while getting a project's version information");
        if (response.statusCode !== 200) return logger.warn(`Unexpected ${response.statusCode} status code while getting a project's version information.`);

        const rawData = await getJSONResponse(response.body);
        versionData = {
          changelog: rawData[0].changelog,
          date: rawData[0].date_published,
          iconURL: requestedProject.icon_url,
          name: rawData[0].name,
          number: rawData[0].version_number,
          type: capitalize(rawData[0].version_type),
          url: `https://modrinth.com/${requestedProject.project_type}/${requestedProject.slug}/version/${rawData[0].version_number}`,
        };

        logger.debug(versionData);

        break;
      }
      default:
        return logger.warn('Update notification functionality has not been implemented for this platform yet.');
    }

    // Send the notification to each appropriate guild channel
    const trackedProjects = await TrackedProjects.findAll({
      where: {
        projectId: dbProject.id,
      },
    });

    for (const trackedProject of trackedProjects) {
      const guild = client.guilds.cache.get(trackedProject.guildId);
      if (!guild) {
        logger.warn(`Could not find guild with ID ${trackedProject.guildId} in cache. Update notification not sent.`);
        continue;
      }
      const channel = guild.channels.cache.get(trackedProject.channelId);
      if (!channel) {
        logger.warn(`Could not find channel with ID ${trackedProject.channelId} in cache. Update notification not sent.`);
        continue;
      }
      const guildSettings = await Guilds.findByPk(trackedProject.guildId);
      switch (guildSettings.notificationStyle) {
        case 'compact':
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(embedColorData(dbProject.platform))
                .setDescription(`${versionData.number} (${versionData.type})`)
                .setFooter({
                  text: `${dayjs(versionData.date).format('MMM D, YYYY')}`,
                  iconURL: embedAuthorData(dbProject.platform).iconURL ?? null,
                })
                .setTitle(`${dbProject.name} ${versionData.name}`)
                .setURL(versionData.url),
            ],
          });
          break;
        default:
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setAuthor(embedAuthorData(dbProject.platform))
                .setColor(embedColorData(dbProject.platform))
                .setDescription(`**Changelog**: ${codeBlock(trimChangelog(versionData.changelog, guildSettings.changelogMaxLength))}`)
                .setFields(
                  {
                    name: 'Version Name',
                    value: versionData.name,
                  },
                  {
                    name: 'Version Number',
                    value: `${versionData.number}`,
                  },
                  {
                    name: 'Release Type',
                    value: `${versionData.type}`,
                  },
                  {
                    name: 'Date Published',
                    value: `<t:${dayjs(versionData.date).unix()}:f>`,
                  }
                )
                .setThumbnail(versionData.iconURL)
                .setTimestamp()
                .setTitle(`${dbProject.name} has been updated`),
            ],
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setLabel(`View on ${capitalize(dbProject.platform)}`)
                  .setStyle(ButtonStyle.Link)
                  .setURL(versionData.url)
              ),
            ],
          });
      }
    }
  },
};

function classIdToUrlString(classId) {
  switch (classId) {
    case 5:
      return 'bukkit-plugins';
    case 6:
      return 'mc-mods';
    case 12:
      return 'texture-packs';
    case 17:
      return 'worlds';
    case 4471:
      return 'modpacks';
    case 4546:
      return 'customization';
    case 4559:
      return 'mc-addons';
    default:
      return 'unknownClassIdValue';
  }
}

function releaseTypeToString(releaseType) {
  switch (releaseType) {
    case 1:
      return 'release';
    case 2:
      return 'beta';
    case 3:
      return 'alpha';
    default:
      return 'unknownReleaseType';
  }
}

function capitalize(string) {
  return string.replace(string.charAt(0), String.fromCharCode(string.charCodeAt(0) - 32));
}

function embedAuthorData(platform) {
  switch (platform) {
    case 'curseforge':
      return {
        name: 'From curseforge.com',
        iconURL: 'https://i.imgur.com/uA9lFcz.png',
        url: 'https://curseforge.com',
      };
    case 'modrinth':
      return {
        name: 'From modrinth.com',
        iconURL: 'https://i.imgur.com/2XDguyk.png',
        url: 'https://modrinth.com',
      };
    default:
      return {
        name: 'From unknown source',
      };
  }
}

function embedColorData(platform) {
  switch (platform) {
    case 'curseforge':
      return '#f87a1b';
    case 'modrinth':
      return '#1bd96a';
    default:
      return 'DarkGreen';
  }
}

function trimChangelog(changelog, maxLength) {
  const formattedChangelog = formatHtmlChangelog(changelog);
  return formattedChangelog.length > maxLength ? `${formattedChangelog.slice(0, maxLength - 3)}...` : formattedChangelog;
}

function formatHtmlChangelog(changelog) {
  return changelog
    .replace(/<br>/g, '\n') // Fix line breaks
    .replace(/<.*?>/g, '') // Remove HTML tags
    .replace(/&\w*?;/g, ''); // Remove HTMl special characters
}
