import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError } from '../../utils/errorHandler.js';
import greetDashboard from './modules/greet_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName('greet')
        .setDescription('Manage welcome & goodbye settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Open the welcome & goodbye configuration dashboard'),
        ),

    async execute(interaction, config, client) {
        try {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [
                        errorEmbed(
                            'Missing Permissions',
                            'You need the **Manage Server** permission to use `/greet`.',
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'dashboard':
                    return await greetDashboard.execute(interaction, config, client);
                default:
                    logger.warn(`Unknown /greet subcommand: ${subcommand}`);
            }
        } catch (error) {
            if (error instanceof TitanBotError) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('Configuration Error', error.userMessage || 'Something went wrong.')],
                    flags: MessageFlags.Ephemeral,
                });
            }
            await handleInteractionError(interaction, error, { command: 'greet' });
        }
    },
};
