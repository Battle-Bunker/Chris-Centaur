"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const configStore_1 = require("../server/configStore");
const game_config_1 = require("../config/game-config");
const router = (0, express_1.Router)();
const configStore = new configStore_1.ConfigStore();
/**
 * Get current configuration values
 * Merges stored values with defaults
 */
router.get('/api/config', async (req, res) => {
    try {
        // Get stored config
        const storedConfig = await configStore.getAll();
        // Merge with defaults (stored values override defaults)
        const mergedConfig = {
            ...game_config_1.DEFAULT_CONFIG,
            ...storedConfig
        };
        res.json({
            config: mergedConfig,
            defaults: game_config_1.DEFAULT_CONFIG
        });
    }
    catch (error) {
        console.error('Error getting config:', error);
        res.status(500).json({
            error: 'Failed to get configuration',
            config: game_config_1.DEFAULT_CONFIG,
            defaults: game_config_1.DEFAULT_CONFIG
        });
    }
});
/**
 * Update configuration values
 */
router.post('/api/config', async (req, res) => {
    try {
        const updates = req.body;
        // Validate that we're only updating known config keys
        const validKeys = Object.keys(game_config_1.DEFAULT_CONFIG);
        const updateKeys = Object.keys(updates);
        const invalidKeys = updateKeys.filter(key => !validKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({
                error: `Invalid configuration keys: ${invalidKeys.join(', ')}`
            });
        }
        // Validate numeric values
        for (const [key, value] of Object.entries(updates)) {
            if (typeof game_config_1.DEFAULT_CONFIG[key] === 'number' && typeof value !== 'number') {
                return res.status(400).json({
                    error: `Configuration key '${key}' must be a number`
                });
            }
        }
        // Save to store
        await configStore.setMultiple(updates);
        // Return merged config
        const storedConfig = await configStore.getAll();
        const mergedConfig = {
            ...game_config_1.DEFAULT_CONFIG,
            ...storedConfig
        };
        res.json({
            success: true,
            config: mergedConfig
        });
    }
    catch (error) {
        console.error('Error updating config:', error);
        res.status(500).json({
            error: 'Failed to update configuration'
        });
    }
});
/**
 * Reset configuration to defaults
 */
router.delete('/api/config', async (req, res) => {
    try {
        await configStore.clear();
        res.json({
            success: true,
            config: game_config_1.DEFAULT_CONFIG
        });
    }
    catch (error) {
        console.error('Error resetting config:', error);
        res.status(500).json({
            error: 'Failed to reset configuration'
        });
    }
});
exports.default = router;
