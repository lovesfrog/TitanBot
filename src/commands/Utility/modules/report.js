import { getColor } from '../../../config/bot.js';
import { createEmbed, errorEmbed } from '../../../utils/embeds.js';
import { getGuildConfig } from '../../../services/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';

export default {
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { ephemeral: true });
        if (!deferSuccess) {
            logger.warn('Report interaction defer failed', { userId: interaction.user.id, guildId: interaction.guildId });
            return;
        }

        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const guildId = interaction.guildId;

        const guildConfig = await getGuildConfig(client, guildId);
        const reportChannelId = guildConfig.reportChannelId;

        if (!reportChannelId) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Setup Required', 'The report channel has not been set up. Please ask a moderator to use `/report setchannel` first.')],
            });
        }

        const reportChannel = interaction.guild.channels.cache.get(reportChannelId);
        if (!reportChannel) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Channel Missing', 'The configured report channel is missing or inaccessible. Please ask a moderator to reset it.')],
            });
        }

        try {
            const reportEmbed = createEmbed({
                title: `🚨 NEW USER REPORT: ${targetUser.tag}`,
                description: `**Reported By:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n**Reported User:** ${targetUser.tag} (\`${targetUser.id}\`)`,
            })
                .setColor(getColor('error'))
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: 'Reason', value: reason },
                    { name: 'Reported In Channel', value: interaction.channel.toString(), inline: true },
                    { name: 'Time', value: new Date().toUTCString(), inline: true },
                );

            await reportChannel.send({
                content: `<@&${interaction.guild.ownerId}> New Report!`,
                embeds: [reportEmbed],
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ title: '✅ Report Submitted', description: `Your report against **${targetUser.tag}** has been successfully filed and sent to the moderation team. Thank you!` })],
            });

            logger.info('Report submitted', {
                userId: interaction.user.id,
                reportedUserId: targetUser.id,
                guildId,
                reasonLength: reason.length,
            });
        } catch (error) {
            logger.error('report error:', error);
            await handleInteractionError(interaction, error, { commandName: 'report', source: 'report' });
        }
    },
};
