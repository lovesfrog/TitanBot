import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getLevelingConfig, saveLevelingConfig } from '../../../services/leveling.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild) {
    const channel = cfg.levelUpChannel ? `<#${cfg.levelUpChannel}>` : '`Not set`';
    const xpMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 15;
    const xpMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 25;
    const cooldown = cfg.xpCooldown ?? 60;
    const rawMsg = cfg.levelUpMessage || '{user} has leveled up to level {level}!';
    const msgPreview = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;

    return new EmbedBuilder()
        .setTitle('📊 Leveling System Dashboard')
        .setDescription(`Manage leveling settings for **${guild.name}**.\nSelect an option below to modify a setting.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '📢 Level-up Channel', value: channel, inline: true },
            { name: '⚙️ System Status', value: cfg.enabled ? '✅ **Enabled**' : '❌ **Disabled**', inline: true },
            { name: '📣 Announcements', value: cfg.announceLevelUp !== false ? '✅ **Enabled**' : '❌ **Disabled**', inline: true },
            { name: '🎲 XP per Message', value: `\`${xpMin} – ${xpMax}\``, inline: true },
            { name: '⏱️ XP Cooldown', value: `\`${cooldown}s\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '💬 Level-up Message', value: msgPreview, inline: false },
        )
        .setFooter({ text: 'Dashboard closes after 10 minutes of inactivity' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`level_cfg_${guildId}`)
        .setPlaceholder('Select a setting to configure...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Change Level-up Channel')
                .setDescription('Set the channel where level-up notifications are sent')
                .setValue('channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Edit Level-up Message')
                .setDescription('Customise the message shown when a user levels up')
                .setValue('message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Set XP Range')
                .setDescription('Set the minimum and maximum XP rewarded per message')
                .setValue('xp_range')
                .setEmoji('🎲'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Set XP Cooldown')
                .setDescription('Seconds between XP grants for the same user')
                .setValue('xp_cooldown')
                .setEmoji('⏱️'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const announceOn = cfg.announceLevelUp !== false;
    const systemOn = cfg.enabled !== false;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`level_cfg_toggle_announce_${guildId}`)
            .setLabel('Announcements')
            .setStyle(announceOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('📣')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`level_cfg_toggle_system_${guildId}`)
            .setLabel('Leveling')
            .setStyle(systemOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('⚡')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId) {
    const selectMenu = buildSelectMenu(guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(cfg, rootInteraction.guild)],
        components: [
            buildButtonRow(cfg, guildId),
            new ActionRowBuilder().addComponents(selectMenu),
        ],
    }).catch(() => {});
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const cfg = await getLevelingConfig(client, guildId);

            if (!cfg.configured) {
                throw new TitanBotError(
                    'Leveling system not configured',
                    ErrorTypes.CONFIGURATION,
                    'The leveling system has not been set up yet. Run `/level setup` first to configure it.',
                );
            }

            const selectMenu = buildSelectMenu(guildId);
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: [buildButtonRow(cfg, guildId), selectRow],
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `level_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'channel':
                            await handleChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'message':
                            await handleMessage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'xp_range':
                            await handleXpRange(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'xp_cooldown':
                            await handleXpCooldown(selectInteraction, interaction, cfg, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Leveling config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected leveling dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'An error occurred while processing your selection.'
                            : 'An unexpected error occurred while updating the configuration.';

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await selectInteraction
                        .followUp({
                            embeds: [errorEmbed('Configuration Error', errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            // ── Button collector for the two toggle buttons ──────────────────
            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    (i.customId === `level_cfg_toggle_announce_${guildId}` ||
                        i.customId === `level_cfg_toggle_system_${guildId}`),
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    await btnInteraction.deferUpdate().catch(() => null);
                } catch (err) {
                    logger.debug('Button interaction already expired:', err.message);
                    return;
                }
                const isAnnounce = btnInteraction.customId === `level_cfg_toggle_announce_${guildId}`;

                if (isAnnounce) {
                    cfg.announceLevelUp = cfg.announceLevelUp === false;
                    await saveLevelingConfig(client, guildId, cfg);
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ Announcements Updated',
                                `Level-up announcements are now **${cfg.announceLevelUp ? 'enabled' : 'disabled'}**.`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    const wasEnabled = cfg.enabled !== false;
                    cfg.enabled = !wasEnabled;
                    await saveLevelingConfig(client, guildId, cfg);
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ System Updated',
                                `The leveling system is now **${cfg.enabled ? 'enabled' : 'disabled'}**.${!cfg.enabled ? '\nUsers will not earn XP until the system is re-enabled.' : ''}`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                }

                await refreshDashboard(interaction, cfg, guildId);
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle('⏰ Dashboard Timed Out')
                        .setDescription('This dashboard has been closed due to inactivity. Please run the command again to continue.')
                        .setColor(getColor('error'));
                    
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [timeoutEmbed],
                        components: [],
                    }).catch(() => {});
                }
            });

            btnCollector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle('⏰ Dashboard Timed Out')
                        .setDescription('This dashboard has been closed due to inactivity. Please run the command again to continue.')
                        .setColor(getColor('error'));
                    
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [timeoutEmbed],
                        components: [],
                    }).catch(() => {});
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in level_dashboard:', error);
            throw new TitanBotError(
                `Level dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the leveling dashboard.',
            );
        }
    },
};

// ─── Change Level-up Channel ──────────────────────────────────────────────────

async function handleChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('level_cfg_channel')
        .setPlaceholder('Select a text channel...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(channelSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📢 Change Level-up Channel')
                .setDescription(
                    `**Current:** ${cfg.levelUpChannel ? `<#${cfg.levelUpChannel}>` : '`Not set`'}\n\nSelect the channel where level-up notifications will be sent.`,
                )
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'level_cfg_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        await chanInteraction.deferUpdate();
        const channel = chanInteraction.channels.first();

        if (!botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
            await chanInteraction.followUp({
                embeds: [
                    errorEmbed(
                        'Missing Permissions',
                        `I need **SendMessages** and **EmbedLinks** permissions in ${channel} to send level-up notifications.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        cfg.levelUpChannel = channel.id;
        await saveLevelingConfig(client, guildId, cfg);

        await chanInteraction.followUp({
            embeds: [
                successEmbed(
                    '✅ Channel Updated',
                    `Level-up notifications will now be sent in ${channel}.`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [
                        errorEmbed('Timed Out', 'No channel was selected. The setting was not changed.'),
                    ],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Edit Level-up Message ────────────────────────────────────────────────────

async function handleMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('level_cfg_message')
        .setTitle('Edit Level-up Message')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message_input')
                    .setLabel('Message ({user} and {level} are available)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.levelUpMessage || '{user} has leveled up to level {level}!')
                    .setMaxLength(500)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('{user} has leveled up to level {level}!'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'level_cfg_message' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newMessage = submitted.fields.getTextInputValue('message_input').trim();

    if (!newMessage.includes('{user}') && !newMessage.includes('{level}')) {
        logger.warn(
            `Level-up message set without {user} or {level} placeholders in guild ${guildId}`,
        );
    }

    cfg.levelUpMessage = newMessage;
    await saveLevelingConfig(client, guildId, cfg);

    const preview = newMessage.replace('{user}', '@User').replace('{level}', '5');

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Message Updated',
                `Level-up message saved.\n**Preview:** ${preview}`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Set XP Range ─────────────────────────────────────────────────────────────

async function handleXpRange(selectInteraction, rootInteraction, cfg, guildId, client) {
    const currentMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 15;
    const currentMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 25;

    const modal = new ModalBuilder()
        .setCustomId('level_cfg_xp_range')
        .setTitle('Set XP Range per Message')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('xp_min_input')
                    .setLabel('Minimum XP (1–500)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(currentMin))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('15'),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('xp_max_input')
                    .setLabel('Maximum XP (1–500)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(currentMax))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('25'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'level_cfg_xp_range' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawMin = submitted.fields.getTextInputValue('xp_min_input').trim();
    const rawMax = submitted.fields.getTextInputValue('xp_max_input').trim();
    const newMin = parseInt(rawMin, 10);
    const newMax = parseInt(rawMax, 10);

    if (isNaN(newMin) || isNaN(newMax) || newMin < 1 || newMax < 1 || newMin > 500 || newMax > 500) {
        await submitted.reply({
            embeds: [
                errorEmbed('Invalid Values', 'Both XP values must be whole numbers between **1** and **500**.'),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (newMin > newMax) {
        await submitted.reply({
            embeds: [
                errorEmbed('Invalid Range', 'Minimum XP cannot be greater than maximum XP.'),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    cfg.xpRange = { min: newMin, max: newMax };
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ XP Range Updated',
                `Users will now earn between **${newMin}** and **${newMax}** XP per message.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Set XP Cooldown ──────────────────────────────────────────────────────────

async function handleXpCooldown(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('level_cfg_cooldown')
        .setTitle('Set XP Cooldown')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cooldown_input')
                    .setLabel('Cooldown in seconds (0–3600)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.xpCooldown ?? 60))
                    .setMaxLength(4)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('60'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'level_cfg_cooldown' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const raw = submitted.fields.getTextInputValue('cooldown_input').trim();
    const newCooldown = parseInt(raw, 10);

    if (isNaN(newCooldown) || newCooldown < 0 || newCooldown > 3600) {
        await submitted.reply({
            embeds: [
                errorEmbed(
                    'Invalid Value',
                    'Cooldown must be a whole number between **0** and **3600** seconds.',
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    cfg.xpCooldown = newCooldown;
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Cooldown Updated',
                `XP cooldown set to **${newCooldown} second${newCooldown !== 1 ? 's' : ''}**.${newCooldown === 0 ? '\n> ⚠️ A cooldown of 0 means XP is granted on every message.' : ''}`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

