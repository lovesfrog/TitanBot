import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    UserSelectMenuBuilder,
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
import { getGuildConfig } from '../../../services/guildConfig.js';
import { getGuildConfigKey } from '../../../utils/database.js';
import { getUserTicketCount } from '../../../services/ticket.js';

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(config, guild) {
    const panelChannel = config.ticketPanelChannelId ? `<#${config.ticketPanelChannelId}>` : '`Not set`';
    const staffRole = config.ticketStaffRoleId ? `<@&${config.ticketStaffRoleId}>` : '`Not set`';
    const ticketLogsChannel = config.ticketLogsChannelId ? `<#${config.ticketLogsChannelId}>` : '`Not set`';
    const transcriptChannel = config.ticketTranscriptChannelId ? `<#${config.ticketTranscriptChannelId}>` : '`Not set`';
    
    // Get category names from guild
    const openCategoryChannel = config.ticketCategoryId ? guild.channels.cache.get(config.ticketCategoryId) : null;
    const openCategory = openCategoryChannel ? openCategoryChannel.toString() : '`Not set`';
    
    const closedCategoryChannel = config.ticketClosedCategoryId ? guild.channels.cache.get(config.ticketClosedCategoryId) : null;
    const closedCategory = closedCategoryChannel ? closedCategoryChannel.toString() : '`Not set`';

    const rawMsg = config.ticketPanelMessage || 'Click the button below to create a support ticket.';
    const panelMsg = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;
    const btnLabel = `\`${config.ticketButtonLabel || 'Create Ticket'}\``;

    return new EmbedBuilder()
        .setTitle('🎫 Ticket System Dashboard')
        .setDescription(`Manage ticket system settings for **${guild.name}**.\nSelect an option below to modify a setting.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '📢 Panel Channel', value: panelChannel, inline: true },
            { name: '🛡️ Staff Role', value: staffRole, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '📁 Open Tickets Category', value: openCategory, inline: true },
            { name: '📂 Closed Tickets Category', value: closedCategory, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '📝 Panel Message', value: panelMsg, inline: false },
            { name: '🏷️ Button Label', value: btnLabel, inline: true },
            { name: '🔢 Max Tickets/User', value: String(config.maxTicketsPerUser || 3), inline: true },
            { name: '📬 DM on Close', value: config.dmOnClose !== false ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '🎫 Ticket Logs Channel', value: ticketLogsChannel, inline: true },
            { name: '📜 Transcript Channel', value: transcriptChannel, inline: true },
        )
        .setFooter({ text: 'Select an option below • Dashboard closes after 10 minutes of inactivity' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`ticket_config_${guildId}`)
        .setPlaceholder('Select a setting to configure...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Edit Panel Message')
                .setDescription('Change the message displayed on the ticket creation panel')
                .setValue('panel_message')
                .setEmoji('📝'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Edit Button Label')
                .setDescription('Change the label on the Create Ticket button')
                .setValue('button_label')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Change Open Tickets Category')
                .setDescription('Category where new tickets are created')
                .setValue('open_category')
                .setEmoji('📁'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Change Closed Tickets Category')
                .setDescription('Category where closed tickets are moved')
                .setValue('closed_category')
                .setEmoji('📂'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Set Max Tickets per User')
                .setDescription('Limit how many open tickets one user can have at once')
                .setValue('max_tickets')
                .setEmoji('🔢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Set Ticket Logs Channel')
                .setDescription('Channel to receive ticket feedback, lifecycle events, and logs')
                .setValue('logs_channel')
                .setEmoji('🎫'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Set Transcript Channel')
                .setDescription('Channel to receive auto-generated transcripts on deletion')
                .setValue('transcript_channel')
                .setEmoji('📜'),
        );
}

function buildButtonRow(guildConfig, guildId, disabled = false) {
    const dmEnabled = guildConfig.dmOnClose !== false;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_cfg_dm_toggle_${guildId}`)
            .setLabel('DM on Close')
            .setStyle(dmEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji(dmEnabled ? '📬' : '📭')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`ticket_cfg_staff_role_btn_${guildId}`)
            .setLabel('Staff Role')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🛡️')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`ticket_cfg_delete_${guildId}`)
            .setLabel('Delete System')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, guildConfig, guildId) {
    const buttonRow = buildButtonRow(guildConfig, guildId);
    const selectRow = new ActionRowBuilder().addComponents(buildSelectMenu(guildId));
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(guildConfig, rootInteraction.guild)],
        components: [buttonRow, selectRow],
    }).catch(() => {});
}

/**
 * Attempts to find and edit the live ticket panel message in the panel channel.
 * Returns true if the panel was found and updated, false otherwise.
 */
async function updateLivePanel(client, guild, config) {
    if (!config.ticketPanelChannelId) return false;
    try {
        const channel = await guild.channels.fetch(config.ticketPanelChannelId).catch(() => null);
        if (!channel) return false;

        const messages = await channel.messages.fetch({ limit: 50 });
        const panelMsg = messages.find(
            m =>
                m.author.id === client.user.id &&
                m.components?.length > 0 &&
                m.components[0]?.components?.[0]?.customId === 'create_ticket',
        );
        if (!panelMsg) return false;

        const updatedEmbed = new EmbedBuilder()
            .setTitle('🎫 Support Tickets')
            .setDescription(config.ticketPanelMessage || 'Click the button below to create a support ticket.')
            .setColor(getColor('info'));

        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel(config.ticketButtonLabel || 'Create Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📩'),
        );

        await panelMsg.edit({ embeds: [updatedEmbed], components: [button] });
        return true;
    } catch (error) {
        logger.warn('Failed to update live ticket panel:', error.message);
        return false;
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);

            if (!guildConfig.ticketPanelChannelId) {
                throw new TitanBotError(
                    'Ticket system not configured',
                    ErrorTypes.CONFIGURATION,
                    'The ticket system has not been set up yet. Run `/ticket setup` first to configure it.',
                );
            }

            const selectMenu = buildSelectMenu(guildId);
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);
            const buttonRow = buildButtonRow(guildConfig, guildId);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(guildConfig, interaction.guild)],
                components: [buttonRow, selectRow],
            });

            const replyMessage = await interaction.fetchReply().catch(() => null);
            const replyMessageId = replyMessage?.id;

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    i.customId === `ticket_config_${guildId}` &&
                    (!replyMessageId || i.message.id === replyMessageId),
                time: 600_000,
            });

            const buttonCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    (!replyMessageId || i.message.id === replyMessageId) &&
                    (i.customId === `ticket_cfg_dm_toggle_${guildId}` ||
                        i.customId === `ticket_cfg_staff_role_btn_${guildId}` ||
                        i.customId === `ticket_cfg_delete_${guildId}`),

                time: 600_000,
            });

            collector.on('collect', async (selectInteraction) => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'panel_message':
                            await handlePanelMessage(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'button_label':
                            await handleButtonLabel(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'staff_role':
                            await handleStaffRole(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'open_category':
                            await handleOpenCategory(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'closed_category':
                            await handleClosedCategory(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'max_tickets':
                            await handleMaxTickets(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'logs_channel':
                            await handleLogsChannel(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'transcript_channel':
                            await handleTranscriptChannel(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Ticket config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected ticket config menu error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'An error occurred while processing your selection.'
                            : 'An unexpected error occurred while updating the configuration.';

                    // Already deferred at the top of the collector
                    await selectInteraction
                        .followUp({
                            embeds: [errorEmbed('Configuration Error', errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            buttonCollector.on('collect', async (btnInteraction) => {
                try {
                    if (btnInteraction.customId === `ticket_cfg_dm_toggle_${guildId}`) {
                        await handleDmOnClose(btnInteraction, interaction, guildConfig, guildId, client);
                    } else if (btnInteraction.customId === `ticket_cfg_staff_role_btn_${guildId}`) {
                        await handleStaffRole(btnInteraction, interaction, guildConfig, guildId, client);
                    } else if (btnInteraction.customId === `ticket_cfg_delete_${guildId}`) {
                        await handleDeleteSystem(btnInteraction, interaction, guildConfig, guildId, client);
                    }
                } catch (error) {
                    if (error.code === 40060) return;
                    if (error instanceof TitanBotError) {
                        logger.debug(`Ticket config button error: ${error.message}`);
                    } else {
                        logger.error('Unexpected ticket config button error:', error);
                    }
                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'An error occurred while processing your selection.'
                            : 'An unexpected error occurred while updating the configuration.';
                    
                    // Already deferred at the top of the collector
                    await btnInteraction
                        .followUp({
                            embeds: [errorEmbed('Configuration Error', errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            collector.on('end', async (collected, reason) => {
                buttonCollector.stop();
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
            logger.error('Unexpected error in ticket_config:', error);
            throw new TitanBotError(
                `Ticket config failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the ticket configuration dashboard.',
            );
        }
    },
};

// ─── Panel Message ────────────────────────────────────────────────────────────

async function handlePanelMessage(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('ticket_cfg_panel_msg')
        .setTitle('Edit Panel Message')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_msg_input')
                    .setLabel('Panel Message')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(
                        guildConfig.ticketPanelMessage ||
                            'Click the button below to create a support ticket.',
                    )
                    .setMaxLength(2000)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('Click the button below to create a support ticket.'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'ticket_cfg_panel_msg' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newMessage = submitted.fields.getTextInputValue('panel_msg_input').trim();
    guildConfig.ticketPanelMessage = newMessage;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    const panelUpdated = await updateLivePanel(client, rootInteraction.guild, guildConfig);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Panel Message Updated',
                `The panel message has been updated.${
                    panelUpdated
                        ? '\nThe live ticket panel has also been refreshed.'
                        : '\n> **Note:** The live panel could not be located. The new message will apply the next time you run `/ticket setup`.'
                }`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

// ─── Button Label ─────────────────────────────────────────────────────────────

async function handleButtonLabel(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('ticket_cfg_btn_label')
        .setTitle('Edit Button Label')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('btn_label_input')
                    .setLabel('Button Label (max 80 characters)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(guildConfig.ticketButtonLabel || 'Create Ticket')
                    .setMaxLength(80)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('Create Ticket'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'ticket_cfg_btn_label' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newLabel = submitted.fields.getTextInputValue('btn_label_input').trim();
    guildConfig.ticketButtonLabel = newLabel;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    const panelUpdated = await updateLivePanel(client, rootInteraction.guild, guildConfig);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Button Label Updated',
                `Button label changed to \`${newLabel}\`.${
                    panelUpdated
                        ? '\nThe live ticket panel button has also been updated.'
                        : '\n> **Note:** The live panel could not be located. The new label will apply the next time you run `/ticket setup`.'
                }`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

// ─── Staff Role ───────────────────────────────────────────────────────────────

async function handleStaffRole(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('ticket_cfg_staff_role')
        .setPlaceholder('Select the staff role...')
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(roleSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🛡️ Change Staff Role')
                .setDescription(
                    `**Current:** ${guildConfig.ticketStaffRoleId ? `<@&${guildConfig.ticketStaffRoleId}>` : '`Not set`'}\n\nSelect the role that should have staff access to manage tickets.`,
                )
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_staff_role',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        guildConfig.ticketStaffRoleId = role.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await roleInteraction.followUp({
            embeds: [successEmbed('✅ Staff Role Updated', `Staff role set to ${role}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Timed Out', 'No role was selected. The staff role was not changed.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Open Tickets Category ────────────────────────────────────────────────────

async function handleOpenCategory(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ticket_cfg_open_cat')
        .setPlaceholder('Select a category...')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(channelSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📁 Change Open Tickets Category')
                .setDescription(
                    `**Current:** ${guildConfig.ticketCategoryId ? `<#${guildConfig.ticketCategoryId}>` : '`Not set`'}\n\nSelect the category where new tickets will be created.`,
                )
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const catCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_open_cat',
        time: 60_000,
        max: 1,
    });

    catCollector.on('collect', async catInteraction => {
        await catInteraction.deferUpdate();
        const category = catInteraction.channels.first();

        guildConfig.ticketCategoryId = category.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await catInteraction.followUp({
            embeds: [
                successEmbed(
                    '✅ Open Category Updated',
                    `New tickets will now be created in **${category.name}**.`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    catCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [
                        errorEmbed('Timed Out', 'No category was selected. The setting was not changed.'),
                    ],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Closed Tickets Category ──────────────────────────────────────────────────

async function handleClosedCategory(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client,
) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ticket_cfg_closed_cat')
        .setPlaceholder('Select a category...')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(channelSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📂 Change Closed Tickets Category')
                .setDescription(
                    `**Current:** ${guildConfig.ticketClosedCategoryId ? `<#${guildConfig.ticketClosedCategoryId}>` : '`Not set`'}\n\nSelect the category where closed tickets will be moved.`,
                )
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const catCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_closed_cat',
        time: 60_000,
        max: 1,
    });

    catCollector.on('collect', async catInteraction => {
        await catInteraction.deferUpdate();
        const category = catInteraction.channels.first();

        guildConfig.ticketClosedCategoryId = category.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await catInteraction.followUp({
            embeds: [
                successEmbed(
                    '✅ Closed Category Updated',
                    `Closed tickets will now be moved to **${category.name}**.`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    catCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [
                        errorEmbed('Timed Out', 'No category was selected. The setting was not changed.'),
                    ],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Max Tickets per User ─────────────────────────────────────────────────────

async function handleMaxTickets(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('ticket_cfg_max_tickets')
        .setTitle('Set Max Tickets per User')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('max_tickets_input')
                    .setLabel('Max Open Tickets (1–10)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(guildConfig.maxTicketsPerUser || 3))
                    .setMaxLength(2)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('3'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'ticket_cfg_max_tickets' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const raw = submitted.fields.getTextInputValue('max_tickets_input').trim();
    const newMax = parseInt(raw, 10);

    if (isNaN(newMax) || newMax < 1 || newMax > 10) {
        await submitted.reply({
            embeds: [errorEmbed('Invalid Value', 'Max tickets must be a whole number between **1** and **10**.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    guildConfig.maxTicketsPerUser = newMax;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Max Tickets Updated',
                `Users can now have at most **${newMax}** open ticket${newMax !== 1 ? 's' : ''} at a time.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

// ─── DM on Close Toggle ───────────────────────────────────────────────────────

async function handleDmOnClose(btnInteraction, rootInteraction, guildConfig, guildId, client) {
    await btnInteraction.deferUpdate();

    const newState = guildConfig.dmOnClose === false;
    guildConfig.dmOnClose = newState;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    await btnInteraction.followUp({
        embeds: [
            successEmbed(
                '✅ DM on Close Updated',
                `Users will **${newState ? 'now' : 'no longer'}** receive a DM when their ticket is closed.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

// ─── Feedback Logs Channel ────────────────────────────────────────────────────

async function handleLogsChannel(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ticket_cfg_logs_channel')
        .setPlaceholder('Select a channel...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🎫 Select Ticket Logs Channel')
                .setDescription('Choose where ticket feedback, lifecycle events (open, close, claim, etc.), and other logs will be sent.')
                .setColor(getColor('info'))
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral
    });

    const collector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_logs_channel',
        time: 60_000,
        max: 1
    });

    collector.on('collect', async channelInteraction => {
        await channelInteraction.deferUpdate();
        const channel = channelInteraction.channels.first();

        guildConfig.ticketLogsChannelId = channel.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await channelInteraction.followUp({
            embeds: [successEmbed('✅ Logs Channel Updated', `Ticket logs will be sent to ${channel}`)],
            flags: MessageFlags.Ephemeral
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction.followUp({
                embeds: [errorEmbed('Timed Out', 'No channel selected. No changes were made.')],
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    });
}

// ─── Transcript Channel ───────────────────────────────────────────────────────

async function handleTranscriptChannel(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ticket_cfg_transcript_channel')
        .setPlaceholder('Select a channel...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📜 Select Transcript Channel')
                .setDescription('Choose where auto-generated transcripts will be sent when tickets are deleted.')
                .setColor(getColor('info'))
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral
    });

    const collector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_transcript_channel',
        time: 60_000,
        max: 1
    });

    collector.on('collect', async channelInteraction => {
        await channelInteraction.deferUpdate();
        const channel = channelInteraction.channels.first();

        guildConfig.ticketTranscriptChannelId = channel.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await channelInteraction.followUp({
            embeds: [successEmbed('✅ Transcript Channel Updated', `Transcripts will be sent to ${channel}`)],
            flags: MessageFlags.Ephemeral
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction.followUp({
                embeds: [errorEmbed('Timed Out', 'No channel selected. No changes were made.')],
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    });
}

// ─── Check User Tickets ───────────────────────────────────────────────────────

async function handleCheckUser(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('ticket_cfg_check_user')
        .setPlaceholder('Select a user to check...')
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(userSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🔍 Check User Tickets')
                .setDescription('Select a user to view their current open ticket count.')
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const userCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.UserSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_check_user',
        time: 60_000,
        max: 1,
    });

    userCollector.on('collect', async userInteraction => {
        await userInteraction.deferUpdate();
        const targetUser = userInteraction.users.first();
        const maxTickets = guildConfig.maxTicketsPerUser || 3;
        const openCount = await getUserTicketCount(guildId, targetUser.id);
        const atLimit = openCount >= maxTickets;

        await userInteraction.followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`🎫 Ticket Check — ${targetUser.username}`)
                    .setDescription(
                        `**Open Tickets:** ${openCount} / ${maxTickets}\n` +
                            `**Remaining:** ${Math.max(0, maxTickets - openCount)}\n\n` +
                            (atLimit
                                ? '⚠️ This user has reached their ticket limit.'
                                : '✅ This user can still open more tickets.'),
                    )
                    .setColor(atLimit ? getColor('error') : getColor('success'))
                    .setThumbnail(targetUser.displayAvatarURL({ size: 64 }))
                    .setTimestamp(),
            ],
            flags: MessageFlags.Ephemeral,
        });
    });

    userCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Timed Out', 'No user was selected.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Delete Ticket System ─────────────────────────────────────────────────────

async function handleDeleteSystem(btnInteraction, rootInteraction, guildConfig, guildId, client) {
    const deleteModal = new ModalBuilder()
        .setCustomId('ticket_delete_confirm_modal')
        .setTitle('Delete Ticket System')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('delete_confirmation')
                    .setLabel('Type "DELETE" to confirm')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('DELETE')
                    .setMaxLength(6)
                    .setMinLength(6)
                    .setRequired(true)
            )
        );

    await btnInteraction.showModal(deleteModal);

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'ticket_delete_confirm_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        await refreshDashboard(rootInteraction, guildConfig, guildId);
        return;
    }

    const confirmation = submitted.fields.getTextInputValue('delete_confirmation').trim();

    if (confirmation !== 'DELETE') {
        await submitted.reply({
            embeds: [errorEmbed('Incorrect Confirmation', 'You must type "DELETE" exactly to confirm deletion.')],
            flags: MessageFlags.Ephemeral,
        });
        await refreshDashboard(rootInteraction, guildConfig, guildId);
        return;
    }

    await submitted.deferUpdate();

    const keysToDelete = [
        'ticketPanelChannelId',
        'ticketPanelMessageId',
        'ticketStaffRoleId',
        'ticketCategoryId',
        'ticketClosedCategoryId',
        'ticketPanelMessage',
        'ticketButtonLabel',
        'maxTicketsPerUser',
        'dmOnClose',
    ];

    // Delete the panel embed from Discord
    if (guildConfig.ticketPanelChannelId) {
        try {
            const panelChannel = await client.guilds.cache.get(guildId)?.channels.fetch(guildConfig.ticketPanelChannelId).catch(() => null);
            if (panelChannel) {
                if (guildConfig.ticketPanelMessageId) {
                    const panelMessage = await panelChannel.messages.fetch(guildConfig.ticketPanelMessageId).catch(() => null);
                    if (panelMessage) await panelMessage.delete().catch(() => {});
                } else {
                    // Fallback: scan for the panel by button customId
                    const messages = await panelChannel.messages.fetch({ limit: 50 }).catch(() => null);
                    if (messages) {
                        const found = messages.find(
                            m => m.author.id === client.user.id &&
                                m.components?.[0]?.components?.[0]?.customId === 'create_ticket'
                        );
                        if (found) await found.delete().catch(() => {});
                    }
                }
            }
        } catch (panelDeleteError) {
            logger.warn('Could not delete ticket panel message:', panelDeleteError.message);
        }
    }

    // Clear all open ticket records for the guild from the database
    try {
        const { pgConfig } = await import('../../../config/postgres.js');
        if (client.db?.db?.pool && typeof client.db.db.isAvailable === 'function' && client.db.db.isAvailable()) {
            await client.db.db.pool.query(
                `DELETE FROM ${pgConfig.tables.tickets} WHERE guild_id = $1`,
                [guildId]
            );
        }
    } catch (ticketDeleteError) {
        logger.warn('Could not clear ticket records from database:', ticketDeleteError.message);
    }

    for (const key of keysToDelete) {
        delete guildConfig[key];
    }
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    await submitted.followUp({
        embeds: [
            successEmbed(
                '✅ Ticket System Deleted',
                'All ticket system configuration has been cleared. Run `/ticket setup` to set it up again.',
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [
            new EmbedBuilder()
                .setTitle('🗑️ Ticket System Deleted')
                .setDescription('The ticket system configuration has been cleared.')
                .setColor(getColor('error'))
                .setTimestamp(),
        ],
        components: [],
    }).catch(() => {});
}