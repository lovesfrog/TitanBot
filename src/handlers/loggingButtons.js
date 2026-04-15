import { PermissionFlagsBits } from 'discord.js';
import { 
  toggleEventLogging, 
  getLoggingStatus, 
  EVENT_TYPES,
  setLoggingEnabled
} from '../services/loggingService.js';
import { 
  parseEventTypeFromButton 
} from '../utils/loggingUi.js';
import { logger } from '../utils/logger.js';
import { buildLoggingDashboardView } from '../commands/Logging/modules/logging_dashboard.js';

const LOGGING_CATEGORIES = [...new Set(Object.values(EVENT_TYPES).map((eventType) => eventType.split('.')[0]))];

export default {
  customIds: ['logging_toggle', 'logging_refresh_status', 'log_dash_toggle', 'log_dash_refresh'],

  async execute(interaction) {
    try {
      
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: '❌ You need **Manage Server** permissions to use this.',
          ephemeral: true
        });
      }

      // Dashboard-specific buttons
      if (interaction.customId === 'log_dash_refresh') {
        return await handleDashboardRefresh(interaction);
      }
      if (interaction.customId.startsWith('log_dash_toggle')) {
        return await handleDashboardToggle(interaction);
      }

      // Legacy /config logging status buttons
      if (interaction.customId === 'logging_refresh_status') {
        return await handleRefresh(interaction);
      }
      if (interaction.customId.startsWith('logging_toggle')) {
        return await handleToggle(interaction);
      }

    } catch (error) {
      logger.error('Error in logging button handler:', error);
      await interaction.reply({
        content: '❌ An error occurred while processing your request.',
        ephemeral: true
      }).catch(() => {});
    }
  }
};

async function handleToggle(interaction) {
  try {
    const eventType = parseEventTypeFromButton(interaction.customId);
    if (!eventType) {
      return interaction.reply({
        content: '❌ Invalid event type.',
        ephemeral: true
      });
    }

    const status = await getLoggingStatus(interaction.client, interaction.guildId);

    if (eventType === 'audit_enabled') {
      const newState = !Boolean(status.enabled);
      await setLoggingEnabled(interaction.client, interaction.guildId, newState);

      const { embed, components } = await buildLoggingDashboardView(interaction, interaction.client);
      return interaction.update({
        embeds: [embed],
        components
      });
    }
    
    if (eventType === 'all') {
      
      const newState = !Object.values(status.enabledEvents).every(v => v !== false);
      const allTypes = Object.values(EVENT_TYPES);
      const categoryTypes = LOGGING_CATEGORIES.map((category) => `${category}.*`);
      
      await toggleEventLogging(interaction.client, interaction.guildId, [...allTypes, ...categoryTypes], newState);
    } else {
      
      const currentState = status.enabledEvents[eventType] !== false;
      const newState = !currentState;
      
      await toggleEventLogging(interaction.client, interaction.guildId, eventType, newState);
    }

    const { embed, components } = await buildLoggingDashboardView(interaction, interaction.client);
    await interaction.update({
      embeds: [embed],
      components
    });

  } catch (error) {
    logger.error('Error toggling logging:', error);
    await interaction.reply({
      content: '❌ An error occurred while toggling logging.',
      ephemeral: true
    });
  }
}

async function handleRefresh(interaction) {
  try {
    const { embed, components } = await buildLoggingDashboardView(interaction, interaction.client);

    await interaction.update({
      embeds: [embed],
      components
    });

  } catch (error) {
    logger.error('Error refreshing logging status:', error);
    await interaction.reply({
      content: '❌ An error occurred while refreshing status.',
      ephemeral: true
    });
  }
}

// ─── Dashboard button handlers ────────────────────────────────────────────────

async function handleDashboardToggle(interaction) {
  try {
    // customId: log_dash_toggle:audit_enabled | log_dash_toggle:all | log_dash_toggle:category.*
    const eventType = interaction.customId.replace('log_dash_toggle:', '');
    if (!eventType) {
      return interaction.reply({ content: '❌ Invalid event type.', ephemeral: true });
    }

    const status = await getLoggingStatus(interaction.client, interaction.guildId);

    if (eventType === 'audit_enabled') {
      await setLoggingEnabled(interaction.client, interaction.guildId, !Boolean(status.enabled));
    } else if (eventType === 'all') {
      const newState = !Object.values(status.enabledEvents).every((v) => v !== false);
      const allTypes = Object.values(EVENT_TYPES);
      const categoryTypes = LOGGING_CATEGORIES.map((c) => `${c}.*`);
      await toggleEventLogging(interaction.client, interaction.guildId, [...allTypes, ...categoryTypes], newState);
    } else {
      const currentState = status.enabledEvents[eventType] !== false;
      await toggleEventLogging(interaction.client, interaction.guildId, eventType, !currentState);
    }

    const { embed, components } = await buildLoggingDashboardView(interaction, interaction.client);
    await interaction.update({ embeds: [embed], components });
  } catch (error) {
    logger.error('Error in dashboard toggle:', error);
    await interaction.reply({ content: '❌ An error occurred while toggling.', ephemeral: true });
  }
}

async function handleDashboardRefresh(interaction) {
  try {
    const { embed, components } = await buildLoggingDashboardView(interaction, interaction.client);
    await interaction.update({ embeds: [embed], components });
  } catch (error) {
    logger.error('Error refreshing logging dashboard:', error);
    await interaction.reply({ content: '❌ An error occurred while refreshing the dashboard.', ephemeral: true });
  }
}
