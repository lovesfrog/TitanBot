/**
 * Interaction Validator & Recovery System
 * 
 * Prevents and handles "Unknown Interaction" (error 10062) errors
 * by validating interaction state before responding and gracefully
 * handling expired interactions.
 */

import { logger } from './logger.js';

// Error code for expired/unknown interactions
const EXPIRED_INTERACTION_CODE = 10062;
const INTERACTION_NOT_REPLIED_CODE = 40060;

/**
 * Check if an interaction is still valid and can be responded to
 * @param {Interaction} interaction - The interaction to validate
 * @returns {boolean} True if the interaction can be responded to
 */
export function isInteractionValid(interaction) {
    if (!interaction || !interaction.id || !interaction.token) {
        return false;
    }
    
    // Check if interaction is already handled
    if (interaction.deferred || interaction.replied) {
        return true; // Can still edit
    }
    
    // Check timestamp - interactions expire after ~3 seconds without a response
    const ageMs = Date.now() - interaction.createdTimestamp;
    if (ageMs > 2800) { // 2.8 seconds buffer for safety
        return false;
    }
    
    return true;
}

/**
 * Safely defer an interaction with error recovery
 * @param {Interaction} interaction - The interaction to defer
 * @param {Object} options - Defer options
 * @returns {Promise<boolean>} True if deferral was successful
 */
export async function safeDeferInteraction(interaction, options = {}) {
    try {
        if (!isInteractionValid(interaction)) {
            logger.warn('Interaction expired before deferral', {
                event: 'interaction.expired_before_defer',
                interactionId: interaction?.id,
                age: Date.now() - (interaction?.createdTimestamp || 0)
            });
            return false;
        }

        if (interaction.deferred) {
            return true;
        }

        await interaction.deferUpdate(options);
        return true;
    } catch (error) {
        if (error.code === EXPIRED_INTERACTION_CODE || error.code === INTERACTION_NOT_REPLIED_CODE) {
            logger.warn('Interaction expired during deferral', {
                event: 'interaction.expired_during_defer',
                errorCode: error.code,
                customId: interaction?.customId,
                userId: interaction?.user?.id
            });
            return false;
        }
        throw error;
    }
}

/**
 * Safely show a modal on an interaction with error recovery
 * @param {Interaction} interaction - The interaction to show modal on
 * @param {Modal} modal - The modal to display
 * @returns {Promise<boolean>} True if modal was successfully shown
 */
export async function safeShowModal(interaction, modal) {
    try {
        if (!isInteractionValid(interaction)) {
            logger.warn('Interaction expired before modal show', {
                event: 'interaction.expired_before_modal',
                interactionId: interaction?.id,
                modalId: modal?.data?.custom_id
            });
            return false;
        }

        if (interaction.deferred || interaction.replied) {
            logger.warn('Attempted to show modal on already-responded interaction', {
                event: 'interaction.already_responded_modal',
                customId: interaction?.customId
            });
            return false;
        }

        await interaction.showModal(modal);
        return true;
    } catch (error) {
        if (error.code === EXPIRED_INTERACTION_CODE || error.code === INTERACTION_NOT_REPLIED_CODE) {
            logger.warn('Interaction expired during modal show', {
                event: 'interaction.expired_during_modal',
                errorCode: error.code,
                customId: interaction?.customId,
                userId: interaction?.user?.id
            });
            return false;
        }
        throw error;
    }
}

/**
 * Wrapper for interaction handlers to catch expired interactions silently
 * @param {Function} handler - The handler function
 * @returns {Function} Wrapped handler that catches expired interactions
 */
export function withExpiredInteractionHandler(handler) {
    return async (...args) => {
        try {
            return await handler(...args);
        } catch (error) {
            // Check if it's an expired interaction error
            if (error.code === EXPIRED_INTERACTION_CODE || error.code === INTERACTION_NOT_REPLIED_CODE) {
                const interaction = args.find(arg => 
                    arg && typeof arg === 'object' && (arg.id && arg.token)
                );
                
                logger.warn('Handler failed due to expired interaction', {
                    event: 'interaction.handler_expired',
                    errorCode: error.code,
                    customId: interaction?.customId,
                    userId: interaction?.user?.id,
                    handlerName: handler.name || 'anonymous'
                });
                
                // Silently return instead of crashing
                return null;
            }
            
            // Re-throw non-expired-interaction errors
            throw error;
        }
    };
}

export default {
    isInteractionValid,
    safeDeferInteraction,
    safeShowModal,
    withExpiredInteractionHandler,
    EXPIRED_INTERACTION_CODE,
    INTERACTION_NOT_REPLIED_CODE
};
