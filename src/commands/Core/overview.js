import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getLoggingStatus } from '../../services/loggingService.js';
import { getLevelingConfig } from '../../services/leveling.js';
import { getConfiguration as getJoinToCreateConfiguration } from '../../services/joinToCreateService.js';
import { getWelcomeConfig, getApplicationSettings } from '../../utils/database.js';
import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function pill(enabled) {
    return enabled ? '✅ On' : '❌ Off';
}

async function formatChannelMention(guild, id) {
    if (!id) return '`Not configured`';
    const channel = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
    return channel ? channel.toString() : `⚠️ Missing (${id})`;
}

function formatRoleMention(guild, id) {
    if (!id) return '`Not configured`';
    const role = guild.roles.cache.get(id);
    return role ? role.toString() : `⚠️ Missing (${id})`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('overview')
        .setDescription('Read-only snapshot of all server system statuses.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const [guildConfig, loggingStatus, levelingConfig, welcomeConfig, applicationConfig, joinToCreateConfig] =
                await Promise.all([
                    getGuildConfig(client, interaction.guildId),
                    getLoggingStatus(client, interaction.guildId),
                    getLevelingConfig(client, interaction.guildId),
                    getWelcomeConfig(client, interaction.guildId),
                    getApplicationSettings(client, interaction.guildId),
                    getJoinToCreateConfiguration(client, interaction.guildId),
                ]);

            const verificationEnabled = Boolean(guildConfig.verification?.enabled);
            const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
            const autoRoleId = guildConfig.autoRole || welcomeConfig?.roleIds?.[0];

            // ── Channels ──────────────────────────────────────────────────────
            const [auditChannel, lifecycleChannel, transcriptChannel, reportChannel, birthdayChannel] =
                await Promise.all([
                    formatChannelMention(interaction.guild, loggingStatus.channelId || guildConfig.logging?.channelId || guildConfig.logChannelId),
                    formatChannelMention(interaction.guild, guildConfig.ticketLogsChannelId),
                    formatChannelMention(interaction.guild, guildConfig.ticketTranscriptChannelId),
                    formatChannelMention(interaction.guild, guildConfig.reportChannelId),
                    formatChannelMention(interaction.guild, guildConfig.birthdayChannelId),
                ]);

            const embed = new EmbedBuilder()
                .setTitle('🖥️ System Overview')
                .setDescription(`Read-only snapshot for **${interaction.guild.name}**. Use the relevant command's dashboard to make changes.`)
                .setColor(getColor('primary'))
                .addFields(
                    // ── Core systems ──
                    {
                        name: '⚙️ Core Systems',
                        value: [
                            `🧾 **Audit Logging** — ${pill(Boolean(loggingStatus.enabled))}`,
                            `📈 **Leveling** — ${pill(Boolean(levelingConfig?.enabled))}`,
                            `👋 **Welcome** — ${pill(Boolean(welcomeConfig?.enabled))}`,
                            `👋 **Goodbye** — ${pill(Boolean(welcomeConfig?.goodbyeEnabled))}`,
                            `🎂 **Birthdays** — ${pill(Boolean(guildConfig.birthdayChannelId))}`,
                            `📋 **Applications** — ${pill(Boolean(applicationConfig?.enabled))}`,
                            `✅ **Verification** — ${pill(verificationEnabled)}`,
                            `🤖 **Auto-Verify** — ${pill(autoVerifyEnabled)}`,
                            `🎧 **Join to Create** — ${pill(Boolean(joinToCreateConfig?.enabled))}`,
                            `🛡️ **Auto Role** — ${autoRoleId ? `✅ ${formatRoleMention(interaction.guild, autoRoleId)}` : '❌ Off'}`,
                        ].join('\n'),
                        inline: false,
                    },
                    // ── Channels ──
                    {
                        name: '📡 Configured Channels',
                        value: [
                            `**Audit Log:** ${auditChannel}`,
                            `**Ticket Lifecycle:** ${lifecycleChannel}`,
                            `**Ticket Transcripts:** ${transcriptChannel}`,
                            `**Reports:** ${reportChannel}`,
                            `**Birthdays:** ${birthdayChannel}`,
                        ].join('\n'),
                        inline: false,
                    },
                    // ── Refresh stamp ──
                    {
                        name: '🕒 Snapshot Taken',
                        value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                        inline: true,
                    },
                )
                .setFooter({ text: 'Read-only — run /logging dashboard to manage audit settings' })
                .setTimestamp();

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('overview command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Overview Error', 'Failed to load the system overview.')],
            });
        }
    },
};
