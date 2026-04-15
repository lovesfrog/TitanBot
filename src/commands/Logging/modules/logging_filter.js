import { PermissionsBitField } from 'discord.js';
import { errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getGuildConfig, setGuildConfig } from '../../../services/guildConfig.js';
import { logEvent } from '../../../utils/moderation.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permissions to manage log filters.')],
            });
        }

        if (!client.db) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Database Error', 'Database not initialized.')],
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const type = interaction.options.getString('type');
        const entityId = interaction.options.getString('id');
        const guildId = interaction.guildId;

        const currentConfig = await getGuildConfig(client, guildId);
        if (!currentConfig.logIgnore) {
            currentConfig.logIgnore = { users: [], channels: [] };
        }

        let targetArray;
        let entityType;
        let entityName;

        if (type === 'user') {
            targetArray = currentConfig.logIgnore.users;
            entityType = 'User';
            const member = await interaction.guild.members.fetch(entityId).catch(() => null);
            entityName = member ? member.user.tag : `ID: ${entityId}`;
        } else if (type === 'channel') {
            targetArray = currentConfig.logIgnore.channels;
            entityType = 'Channel';
            const channel = interaction.guild.channels.cache.get(entityId);
            entityName = channel ? `#${channel.name}` : `ID: ${entityId}`;
        } else {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Invalid Type', "Choose `user` or `channel`.")],
            });
        }

        let successMessage;

        if (subcommand === 'add') {
            if (targetArray.includes(entityId)) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Already Filtered', `${entityType} **${entityName}** is already on the ignore list.`)],
                });
            }
            targetArray.push(entityId);
            successMessage = `${entityType} **${entityName}** added to the log ignore list. Events from them will not be logged.`;
        } else if (subcommand === 'remove') {
            const index = targetArray.indexOf(entityId);
            if (index === -1) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Not Filtered', `${entityType} **${entityName}** was not on the ignore list.`)],
                });
            }
            targetArray.splice(index, 1);
            successMessage = `${entityType} **${entityName}** removed from the log ignore list. Events will now be logged.`;
        } else {
            return;
        }

        try {
            await setGuildConfig(client, guildId, currentConfig);

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Log Filter Updated',
                    target: `Filter ${subcommand}`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    metadata: { entityType, loggingEnabled: currentConfig.enableLogging },
                },
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Filter Updated', successMessage)],
            });
        } catch (error) {
            logger.error('logging filter error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Database Error', 'Failed to save the filter change.')],
            });
        }
    },
};
